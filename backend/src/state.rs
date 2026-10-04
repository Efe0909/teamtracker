//! Paylasilan surec durumu.
//!
//! Python'da bunlar modul globaliydi (`db.pool()`, `service.TREE`, `config.X`)
//! ve her yerden import edilebiliyordu. axum handler'lari duz fonksiyon —
//! ortuk global yok, istekte gelmeyen her sey buradan tasinir.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, RwLock},
    time::Instant,
};

use axum::extract::FromRef;
use axum_extra::extract::cookie::Key;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{config::{Config, Service}, db::tree::{NodeRow, TreeIndex}, ratelimit::RateLimit};

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
    /// Cerez imzalama anahtari. `SignedCookieJar` bunu state'ten `FromRef`
    /// ile aliyor — extractor'in calismasinin sarti.
    pub key: Key,
    /// Disari giden HTTP (Google). Baglanti havuzu icinde; istek basina
    /// yeniden kurulmaz.
    pub http: reqwest::Client,
    /// Giris uclarinin hiz siniri (IP basina).
    pub login_limit: Arc<RateLimit>,
    /// Kullanici basina son `last_seen_at` YAZMA ani (`auth::touch_presence`).
    /// Surec bellegi yeter: tek surec zaten sart (KNOW-85). Anahtar sayisi
    /// kullanici sayisiyla sinirli, temizlik gerekmiyor.
    pub presence: Arc<Mutex<HashMap<Uuid, Instant>>>,
    /// Yapi yazmalari (dugum ekle/tasi/sil...) SIRAYLA: dogrulama agacin
    /// bellekteki kopyasina bakiyor, yazma ve yeniden kurulum ondan sonra.
    /// Iki es zamanli tasima ayni eski agaca bakip birlikte bir halka
    /// kurabilirdi (A'yi B'nin, B'yi A'nin altina). tokio Mutex: kilit
    /// await boyunca tutulur. ponytail: tek surec (KNOW-85); yatayda
    /// veritabani kilidi gerekir.
    pub structure: Arc<tokio::sync::Mutex<()>>,
    /// Yazilmamis istek sayaclari (kisi basina); dakikada bir `user_activity`ye akar.
    pub pending_requests: Arc<Mutex<HashMap<Uuid, u32>>>,
    /// Web push anahtari; yoksa push KAPALI (liste calisir).
    pub vapid: Option<Arc<crate::webpush::Vapid>>,
    /// Resend istemcisi; yoksa posta kuyrukta bekler.
    pub mailer: Option<Arc<crate::mail::Resend>>,
    /// Kalite kapisinin sorulari ve esikleri (`quality_config`); yonetimden
    /// degisince burasi da guncellenir. Kilit await boyunca tutulmaz.
    pub quality: Arc<RwLock<crate::decision::QualityConfig>>,
}

impl FromRef<AppState> for Key {
    fn from_ref(st: &AppState) -> Self {
        st.key.clone()
    }
}

impl AppState {
    pub async fn new(pool: PgPool, cfg: Config) -> Result<Self, Box<dyn std::error::Error>> {
        let tree = load_tree(&pool).await?;
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()?;
        // Dis servis kapisi TEK: `external_on` (manifest external_off + anahtar).
        let vapid = cfg.external_on(Service::Push)
            .then(|| crate::webpush::Vapid::new(&cfg.vapid_private, &cfg.vapid_sub)).flatten().map(Arc::new);
        if vapid.is_none() {
            tracing::info!("web push kapali (VAPID_PRIVATE yok/bozuk ya da manifest external_off)");
        }
        let mailer = cfg.external_on(Service::Resend)
            .then(|| crate::mail::Resend::new(&cfg)).flatten().map(Arc::new);
        if mailer.is_none() {
            tracing::info!("posta kapali (RESEND_API_KEY yok ya da manifest external_off): yalniz kuyruga yazilir");
        }
        if !cfg.external_on(Service::Decision) {
            tracing::info!("kalite kontrolu kapali (OPENROUTER_API_KEY yok ya da manifest external_off): yalniz uzunluk kurali");
        }
        let quality = Arc::new(RwLock::new(crate::decision::load(&pool).await));
        Ok(AppState {
            vapid,
            mailer,
            quality,
            pending_requests: Arc::default(),
            pool,
            key: crate::auth::key_from(&cfg),
            cfg: Arc::new(cfg),
            tree: Arc::new(RwLock::new(tree)),
            http,
            // spec/70-guvenlik.md: IP basina dakikada 10.
            login_limit: Arc::new(RateLimit::new(10, std::time::Duration::from_secs(60))),
            presence: Arc::default(),
            structure: Arc::default(),
        })
    }

    /// Yapi her degistiginde cagrilir. KISMI GUNCELLEME YOK (KNOW-179):
    /// birkac bin dugumde tam kurulum mikrosaniyeler surer, kismi guncelleme
    /// hata kaynagidir.
    pub async fn rebuild_tree(&self) -> Result<(), sqlx::Error> {
        let fresh = load_tree(&self.pool).await?;
        // Zehirli kilit: yazan bir panik yasadi. Agac yine de tamamen
        // yeniden kuruluyor, eski deger kullanilmiyor — kurtarmak guvenli.
        *self.tree.write().unwrap_or_else(|e| e.into_inner()) = fresh;
        Ok(())
    }
}

async fn load_tree(pool: &PgPool) -> Result<TreeIndex, sqlx::Error> {
    let rows: Vec<NodeRow> = sqlx::query_as(
        "select id, parent_id, name, node_type, sort_order, is_active, key, shape, attrs from nodes",
    )
    .fetch_all(pool)
    .await?;
    Ok(TreeIndex::build(rows))
}
