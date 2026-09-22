//! JSON API — Rust'in disariya actigi TEK yuzey (spec/15-sinirlar.md).
//!
//! HTML, sablon, statik dosya YOK: on yuz (frontend/) statik derlenir, nginx
//! verir. Butun uclar `/api` altinda; nginx yalniz bu oneki buraya vekiller.
//! Host ayrimi (app./dashboard./apex) on yuzun isi, burada yok.

mod auth;
mod chats;
mod common;
mod meta;
mod records;

use axum::{
    extract::State,
    routing::{get, patch, post},
    Json, Router,
};
use axum_extra::extract::cookie::SignedCookieJar;
use serde::Serialize;
use uuid::Uuid;

use crate::{auth::CurrentUser, error::{AppError, Result}, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/me", get(me))
        .route("/api/auth/google", get(auth::google_start))
        .route("/api/auth/callback", get(auth::google_callback))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/dev-login", get(auth::dev_login))
        .route("/api/meta", get(meta::meta))
        .route("/api/records", get(records::list).post(records::create))
        .route("/api/records/{id}", get(records::get).patch(records::patch))
        .route("/api/records/{id}/actions", post(records::add_action))
        .route("/api/actions/mine", get(records::my_actions))
        .route("/api/actions/{id}", patch(records::patch_action))
        .route("/api/chats/{id}/feed", get(chats::feed))
        .route("/api/chats/{id}/messages", post(chats::post))
        // Bilinmeyen yol da JSON: istemci hic HTML gormez.
        .fallback(|| async { AppError::NotFound })
}

#[derive(Serialize)]
struct Me {
    user: Option<MeUser>,
    /// "google" | "fake" — on yuz hangi giris formunu cizecegini buradan bilir.
    auth: &'static str,
    /// Degistiren isteklerde `X-CSRF-Token` olarak geri gelir. Oturum yoksa null.
    csrf: Option<String>,
    /// YALNIZ sahte kimlikte: gelistirme giris formu icin kullanici listesi.
    #[serde(skip_serializing_if = "Option::is_none")]
    dev_users: Option<Vec<DevUser>>,
}

#[derive(Serialize)]
struct MeUser {
    id: Uuid,
    name: String,
    email: String,
    color: Option<String>,
    is_admin: bool,
}

#[derive(Serialize, sqlx::FromRow)]
struct DevUser {
    id: Uuid,
    name: String,
    color: Option<String>,
}

async fn me(State(st): State<AppState>, jar: SignedCookieJar, user: Option<CurrentUser>) -> Result<Json<Me>> {
    let fake = st.cfg.fake_identity();
    let dev_users = if fake {
        Some(sqlx::query_as("select id, name, color from users where is_active order by name")
            .fetch_all(&st.pool).await?)
    } else {
        None
    };
    // Token yalniz kullanici GERCEKTEN cozulduyse: kapatilmis hesabin cerezi
    // hala imzali olabilir.
    let csrf = user.as_ref()
        .and_then(|_| crate::auth::read_session(&jar, &st.cfg))
        .map(|s| s.csrf);
    Ok(Json(Me {
        user: user.map(|CurrentUser(u)| MeUser {
            id: u.id, name: u.name, email: u.email, color: u.color, is_admin: u.is_admin,
        }),
        auth: if fake { "fake" } else { "google" },
        csrf,
        dev_users,
    }))
}
