//! Giris: yapilandirma, havuz, agac indeksi, ara katman sirasi, JSON API.
//!
//! TEK SUREC sart: agac indeksi surec bellekte (KNOW-85). Yatay olcekleme
//! istenirse once TreeIndex tek yaziciya tasinmali.

mod api;
mod auth;
mod config;
mod csrf;
// Alan katmani: agac, kapsam, filtre, akis. Butunu Python'dan tasindi, JSON
// uclari geldikce kullanilacak; o zamana kadar olu kod uyarisi susturuldu.
#[allow(dead_code)]
mod db;
mod error;
#[allow(dead_code)]
mod media;
#[allow(dead_code)]
mod models;
#[allow(dead_code)]
mod push;
mod ratelimit;
mod state;

use std::net::SocketAddr;

use tower_http::trace::TraceLayer;

use state::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    let cfg = config::Config::from_env()?;
    let pool = db::pool::connect(&cfg.database_url).await?;
    db::migrate(&pool).await?;

    // Agac ACILISTA tek sorguyla kurulur, her istekte SQL'e gidilmez (KNOW-179).
    let addr = SocketAddr::new(cfg.bind, cfg.port);
    let state = AppState::new(pool, cfg).await?;

    // axum'da SON eklenen katman EN DISTA calisir:
    //   TraceLayer -> CSRF kapisi -> rotalar
    let app = api::router()
        .layer(axum::middleware::from_fn_with_state(state.clone(), csrf::gate))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("dinleniyor: {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
