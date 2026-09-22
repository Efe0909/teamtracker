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

use crate::{config::Config, db::tree::{NodeRow, TreeIndex}, ratelimit::RateLimit};

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
        Ok(AppState {
            pool,
            key: crate::auth::key_from(&cfg),
            cfg: Arc::new(cfg),
            tree: Arc::new(RwLock::new(tree)),
            http,
            // spec/70-guvenlik.md: IP basina dakikada 10.
            login_limit: Arc::new(RateLimit::new(10, std::time::Duration::from_secs(60))),
            presence: Arc::default(),
        })
    }

    /// Yapi her degistiginde cagrilir. KISMI GUNCELLEME YOK (KNOW-179):
    /// birkac bin dugumde tam kurulum mikrosaniyeler surer, kismi guncelleme
    /// hata kaynagidir.
    #[allow(dead_code)] // ilk yapi yazma ucuyla kullanilacak
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
        "select id, parent_id, name, node_type, sort_order, is_active from nodes",
    )
    .fetch_all(pool)
    .await?;
    Ok(TreeIndex::build(rows))
}
