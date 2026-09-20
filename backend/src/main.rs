//! Giris: yapilandirma, havuz, agac indeksi, ara katman sirasi, statik dosyalar.
//!
//! TEK SUREC sart: agac indeksi surec bellekte (KNOW-85). Yatay olcekleme
//! istenirse once TreeIndex tek yaziciya tasinmali.

mod auth;
mod config;
mod db;
mod error;
mod handlers;
mod media;
mod models;
mod push;
mod render;
mod routes;
mod state;

use std::net::SocketAddr;

use axum::Router;
use tower_http::{services::ServeDir, trace::TraceLayer};

use state::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    let cfg = config::Config::from_env()?;
    let pool = db::pool::connect(&cfg.database_url).await?;
    db::migrate(&pool).await?;

    // Agac ACILISTA tek sorguyla kurulur, her istekte SQL'e gidilmez (KNOW-179).
    let state = AppState::new(pool, cfg.clone()).await?;

    let app = Router::new()
        .merge(routes::router())
        // Statik: ortak kokte, site dosyalari kendi alt yolunda — nginx de
        // boyle ayiriyor, ikisi ayni kalmali.
        .nest_service("/static/d", ServeDir::new("static/dashboard"))
        .nest_service("/static/m", ServeDir::new("static/mobile"))
        .nest_service("/static", ServeDir::new("static/shared"))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // ARA KATMAN SIRASI KRITIK (KNOW-23) — routes::router() icinde kuruluyor:
    //   oturum cerezi -> giris kapisi -> guvenlik basliklari -> CSRF -> rotalar
    // Sira degisirse CSRF ve giris kapisi SESSIZCE bozulur. Testle sabitle.

    let addr = SocketAddr::from(([0, 0, 0, 0], cfg.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("dinleniyor: {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
