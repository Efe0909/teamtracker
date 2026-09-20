//! Paylasilan surec durumu.
//!
//! Python'da bunlar modul globaliydi (`db.pool()`, `service.TREE`, `config.X`)
//! ve her yerden import edilebiliyordu. axum handler'lari duz fonksiyon —
//! ortuk global yok, istekte gelmeyen her sey buradan tasinir.

use std::sync::{Arc, RwLock};

use axum::extract::FromRef;
use axum_extra::extract::cookie::Key;
use minijinja::Environment;
use sqlx::PgPool;

use crate::{config::Config, db::tree::{NodeRow, TreeIndex}};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub cfg: Arc<Config>,
    /// Okuma surekli (her yetki kontrolu `is_descendant` cagiriyor), yazma
    /// nadir (yapi degisince komple yeniden kurulur) — RwLock tam bu profil.
    ///
    /// `std::sync::RwLock` BILEREK: guard'i `.await` uzerinden tasiyamazsin,
    /// derlenmez. Agac okumasi mikrosaniye; kilidi tutarken await etmek zaten
    /// hata olurdu. `tokio::sync::RwLock` buna izin verir ve sorunu gizler.
    pub tree: Arc<RwLock<TreeIndex>>,
    pub tpl: Arc<Environment<'static>>,
    /// Cerez imzalama anahtari. `SignedCookieJar` bunu state'ten `FromRef`
    /// ile aliyor — extractor'in calismasinin sarti.
    pub key: Key,
}

/// `SignedCookieJar` icin. Anahtari her istekte yeniden turetmek yerine
/// state'te tutuyoruz: turetme ucuz degil ve her istekte yapiliyordu.
impl FromRef<AppState> for Key {
    fn from_ref(st: &AppState) -> Self {
        st.key.clone()
    }
}

impl AppState {
    pub async fn new(pool: PgPool, cfg: Config) -> Result<Self, sqlx::Error> {
        let cfg_for_key = cfg.clone();
        let tree = load_tree(&pool).await?;
        let mut env = Environment::new();
        env.set_loader(minijinja::path_loader("templates"));
        // `static('/static/x.css')` — Python'daki static_url'in karsiligi.
        // Bugun kimlik damgasi yok; onbellek kirma gerekince TEK yer burasi.
        env.add_function("static", |path: String| path);
        // Ray'deki kullanici degistirici yalniz sahte kimlikte cizilir.
        let fake = cfg.fake_identity();
        env.add_function("fake_identity", move || fake);
        // Cevrimici: satirdaki last_seen_at esikten yeni mi. Ayri bir sorgu
        // YOK — kimlik cozulen her istek damgayi tazeliyor.
        env.add_function("online", |v: minijinja::Value| {
            v.get_attr("last_seen_at").ok()
                .and_then(|t| t.as_str().and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(s).ok()
                }))
                .map(|t| chrono::Utc::now().signed_duration_since(t)
                     < chrono::Duration::minutes(2))   // shared/auth.ONLINE_THRESHOLD
                .unwrap_or(false)
        });
        // Anma vurgusu. Mesaj govdesi HAM metin saklanir (messages.body) —
        // HTML uretilip veritabanina YAZILMAZ, yoksa kacis kurali iki yere
        // dagilirdi. Vurgu OKUMA aninda: once kacilir, sonra @anahtar sarilir.
        //
        // `|safe` donduruyoruz, o yuzden kacis BURADA elle yapilmali.
        env.add_filter("mention", |text: Option<&str>| {
            static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
            let re = RE.get_or_init(|| regex::Regex::new(r"@([\w.\-]+)").expect("sabit desen"));

            let mut safe = String::new();
            for ch in text.unwrap_or("").chars() {
                match ch {
                    '&' => safe.push_str("&amp;"),
                    '<' => safe.push_str("&lt;"),
                    '>' => safe.push_str("&gt;"),
                    '"' => safe.push_str("&quot;"),
                    '\'' => safe.push_str("&#x27;"),
                    _ => safe.push(ch),
                }
            }
            // @all / @here / @team GRUP anmasi — ayri sinif alir.
            const GROUPS: &[&str] = &["all", "here", "team"];
            let out = re.replace_all(&safe, |c: &regex::Captures| {
                let who = &c[1];
                let grp = if GROUPS.contains(&who.to_lowercase().as_str()) { " grp" } else { "" };
                format!("<span class=\"mention{grp}\">@{who}</span>")
            }).into_owned();
            minijinja::Value::from_safe_string(out)
        });
        env.add_function("notify_levels", || {
            crate::push::NOTIFY_LEVELS.iter().copied()
                .collect::<std::collections::BTreeMap<_, _>>()
        });

        // minijinja'nin varsayilan HTML kacisi `/` karakterini de kaciriyor
        // (`&#x2f;`); Jinja2 kacirmiyor. Tarayici icin fark yok ama cikti
        // Python'unkiyle AYNI olmali — aksi halde her href karsilastirmasi,
        // testler dahil, ayrisir. Jinja2'nin kumesi: & < > " '
        env.set_formatter(|out, state, value| {
            use minijinja::{escape_formatter, AutoEscape};
            if state.auto_escape() == AutoEscape::Html && !value.is_safe() {
                if let Some(s) = value.as_str() {
                    // Kacirilmayan dilimleri TOPLU yaz, karakter karakter degil.
                    let mut last = 0usize;
                    for (i, ch) in s.char_indices() {
                        let ent = match ch {
                            '&' => "&amp;",
                            '<' => "&lt;",
                            '>' => "&gt;",
                            '"' => "&quot;",
                            '\'' => "&#x27;",
                            _ => continue,
                        };
                        out.write_str(&s[last..i])?;
                        out.write_str(ent)?;
                        last = i + ch.len_utf8();
                    }
                    out.write_str(&s[last..])?;
                    return Ok(());
                }
            }
            escape_formatter(out, state, value)
        });
        // NOT: minijinja sablonlari bir kez derleyip onbellekte tutuyor;
        // sablon degisikligi RESTART istiyor. Otomatik yeniden yukleme ayri
        // bir crate (minijinja-autoreload) — gelistirme kolayligi icin
        // bagimlilik eklenmedi.
        Ok(AppState {
            pool,
            cfg: Arc::new(cfg),
            tree: Arc::new(RwLock::new(tree)),
            key: crate::auth::key_from(&cfg_for_key),
            tpl: Arc::new(env),
        })
    }

    /// Yapi her degistiginde cagrilir. KISMI GUNCELLEME YOK (KNOW-179):
    /// birkac bin dugumde tam kurulum mikrosaniyeler surer, kismi guncelleme
    /// hata kaynagidir.
    pub async fn rebuild_tree(&self) -> Result<(), sqlx::Error> {
        let fresh = load_tree(&self.pool).await?;
        *self.tree.write().expect("agac kilidi zehirlenmis") = fresh;
        Ok(())
    }
}

async fn load_tree(pool: &PgPool) -> Result<TreeIndex, sqlx::Error> {
    let rows: Vec<NodeRow> = sqlx::query_as(
        "select id, parent_id, name, node_type, sort_order, is_active from nodes",
    )
    .fetch_all(pool)
    .await?;
    Ok(TreeIndex::build(rows))
}
