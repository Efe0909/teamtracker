//! IKI SITENIN DE kullandigi uclar — ORTAK sablon + ORTAK uc (KNOW-265).
//! Mobil ikinci kopya YAZMAZ. Bu dosya bolunurse iki site ayrisir.
use axum::{routing::{get, post}, Router};
use crate::{handlers::shared as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(h::home))
        .route("/favicon.ico", get(h::favicon))
        .route("/whoami", get(h::whoami))
        .route("/mentions", get(h::mentions))
        .route("/tags", get(h::tags))
        .route("/settings/notify", post(h::set_notify_level))
        // Web push
        .route("/vapid", get(h::vapid_key))
        .route("/subscribe", post(h::subscribe))
        // Yalniz sahte kimlik modunda baglanir (config.fake_identity());
        // yayinda bu iki uc HIC KAYDEDILMEZ, 404 doner.
        .route("/switch/{user_id}", post(h::switch_user))
        .route("/test/notification", post(h::test_notification))
}
