//! Paylasilan surec durumu.
//!
//! Python'da bunlar modul globaliydi (`db.pool()`, `service.TREE`, `config.X`)
//! ve her yerden import edilebiliyordu. axum handler'lari duz fonksiyon —
//! ortuk global yok, istekte gelmeyen her sey buradan tasinir.

use std::sync::{Arc, RwLock};

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
}

impl AppState {
    pub async fn new(pool: PgPool, cfg: Config) -> Result<Self, sqlx::Error> {
        let tree = load_tree(&pool).await?;
        let mut env = Environment::new();
        env.set_loader(minijinja::path_loader("templates"));
        // `static('/static/x.css')` — Python'daki static_url'in karsiligi.
        // Bugun kimlik damgasi yok; onbellek kirma gerekince TEK yer burasi.
        env.add_function("static", |path: String| path);

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
