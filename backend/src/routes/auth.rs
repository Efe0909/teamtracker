//! Kimlik uclari. HER IKI hostta acik — mobil alan adinda giris imkansizlasmasin
//! (KNOW-25). Yalniz `openid email profile` kapsami isteniyor, parola yok (KNOW-92).
use axum::{routing::{get, post}, Router};
use crate::{handlers::auth as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/login", get(h::login_page))
        .route("/login/callback", get(h::login_callback))
        .route("/logout", post(h::logout))
}
