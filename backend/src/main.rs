//! Giris: yapilandirma, havuz, agac indeksi, ara katman sirasi, JSON API.
//!
//! TEK SUREC sart: agac indeksi surec bellekte (KNOW-85). Yatay olcekleme
//! istenirse once TreeIndex tek yaziciya tasinmali.

mod api;
mod audit;
mod auth;
mod bootstrap;
mod channel;
mod config;
mod csrf;
// Alan katmani: agac, kapsam, filtre, akis. Butunu Python'dan tasindi, JSON
// uclari geldikce kullanilacak; o zamana kadar olu kod uyarisi susturuldu.
#[allow(dead_code)]
mod db;
mod error;
mod media;
mod mentions;
#[allow(dead_code)]
mod models;
mod mail;
mod push;
mod ratelimit;
mod state;
mod webpush;

use std::net::SocketAddr;

use tower_http::trace::TraceLayer;

use state::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // `ekiptakip vapid-keygen`: web push anahtar cifti (ortam degiskeni satirlari).
    if std::env::args().nth(1).as_deref() == Some("vapid-keygen") {
        let (private, public) = webpush::keygen();
        println!("VAPID_PRIVATE={private}\nVAPID_PUBLIC={public}");
        return Ok(());
    }
    tracing_subscriber::fmt::init();

    let cfg = config::Config::from_env()?;
    let pool = db::pool::connect(&cfg.database_url).await?;
    db::migrate(&pool).await?;
    if let Some(path) = &cfg.bootstrap_admins_file {
        bootstrap::admins(&pool, path).await;
    }
    media::sync_volume(&pool, &cfg.media_root).await;
    // Supurme gunde bir, ilki acilistan hemen sonra (KNOW-278).
    let sweep_pool = pool.clone();
    tokio::spawn(async move {
        let mut every = tokio::time::interval(std::time::Duration::from_secs(24 * 3600));
        loop {
            every.tick().await;
            match media::sweep(&sweep_pool).await {
                Ok((0, 0)) => {}
                Ok((chats, files)) => tracing::info!("supurme: {chats} sohbet, {files} ek"),
                Err(e) => tracing::error!("supurme: {e}"),
            }
        }
    });

    // Agac ACILISTA tek sorguyla kurulur, her istekte SQL'e gidilmez (KNOW-179).
    let addr = SocketAddr::new(cfg.bind, cfg.port);
    let state = AppState::new(pool, cfg).await?;
    // Posta kuyrugu tuketici (anahtar varsa).
    if let Some(resend) = state.mailer.clone() {
        tokio::spawn(mail::run_outbox(state.pool.clone(), resend));
    }

    // axum'da SON eklenen katman EN DISTA calisir:
    //   TraceLayer -> denetim (403) -> CSRF kapisi -> rotalar
    // Denetim CSRF'in disinda: kapinin reddi de bir 403.
    let app = api::router()
        .layer(axum::middleware::from_fn_with_state(state.clone(), csrf::gate))
        .layer(axum::middleware::from_fn_with_state(state.clone(), audit::forbidden))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("dinleniyor: {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
