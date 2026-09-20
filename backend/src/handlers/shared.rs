//! `routes/shared.rs` karsiligi — istek govdesi, yetki, YAZMA yolu.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use uuid::Uuid;

use axum::{extract::Path, http::HeaderMap, response::Redirect};
use axum_extra::extract::cookie::SignedCookieJar;

use crate::{auth::CurrentUser, error::{AppError, Result}, models::user::User, state::AppState};

/// Iki yuzun cakistigi TEK yol. Mobil yuz de masaustu yuzu de KOKTE duruyor
/// ("/m" yok), o yuzden "/" iki router'da birden tanimlanamaz — Host'a gore
/// burada dagitiliyor.
pub async fn home(
    state: State<AppState>,
    user: CurrentUser,
) -> Result<Response> {
    // TODO(mobil): Host app.* ise mobile::todo_page.
    crate::handlers::dashboard::home(state, user).await
}

pub async fn favicon() -> Response {
    todo!("shared::favicon")
}

/// Kimlik testi ucu — iki alan adinda da calisir.
///
/// `scope` alani v1'de `users.scope_node_id`'den geliyordu; o sutun dustu
/// (spec/21-sema-v2.md §11). Dal izni artik `user_node_scopes`, yani COK
/// satir — tek bir ad donduremiyoruz, izinli dallarin adlari doner.
pub async fn whoami(
    State(st): State<AppState>,
    user: Option<CurrentUser>,
) -> Result<Response> {
    let Some(CurrentUser(u)) = user else {
        // Kapi gevserse gurultusuz duralim.
        return Ok((StatusCode::UNAUTHORIZED, Json(json!({"hata": "oturum yok"}))).into_response());
    };
    let branches: Vec<Uuid> = sqlx::query_scalar(
        "select node_id from user_node_scopes where user_id = $1")
        .bind(u.id).fetch_all(&st.pool).await?;
    let tree = st.tree.read().expect("agac kilidi zehirlenmis");
    let scopes: Vec<&str> = branches.iter().map(|&n| tree.name(n)).collect();

    Ok(Json(json!({
        "id": u.id, "name": u.name, "email": u.email,
        "is_admin": u.is_admin,
        "scope": scopes,
    })).into_response())
}

pub async fn mentions() -> Response {
    todo!("shared::mentions")
}

pub async fn tags() -> Response {
    todo!("shared::tags")
}

pub async fn set_notify_level() -> Response {
    todo!("shared::set_notify_level")
}

pub async fn vapid_key() -> Response {
    todo!("shared::vapid_key")
}

pub async fn subscribe() -> Response {
    todo!("shared::subscribe")
}

/// Kullanici degistirme — YALNIZCA sahte kimlik modunda.
///
/// Yayin kurulumunda bu rota da calismaz: `Config` sahte kimligi acilista
/// reddediyor, ama uc yine de kendi kapisini tutuyor — rota tablosuna bakan
/// biri "bu yayinda da var mi" diye merak etmesin.
pub async fn switch_user(
    State(st): State<AppState>,
    jar: SignedCookieJar,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Response> {
    if !st.cfg.fake_identity() {
        return Err(AppError::NotFound("sayfa yok".into()));
    }
    if User::active(&st.pool, user_id).await?.is_none() {
        return Err(AppError::NotFound("kullanıcı yok".into()));
    }
    let jar = crate::auth::open_session(jar, &st.cfg, user_id);

    // Geldigi sayfaya don. Referer'in YALNIZ YOLU alinir — tam URL'yi
    // kullanmak acik yonlendirme olurdu.
    let back = headers.get(axum::http::header::REFERER)
        .and_then(|v| v.to_str().ok())
        .and_then(|r| r.split_once("://").map(|(_, rest)| rest).unwrap_or(r)
            .find('/').map(|i| {
                let raw = r.split_once("://").map(|(_, rest)| &rest[i..]).unwrap_or(&r[i..]);
                raw.split(['?', '#']).next().unwrap_or("/").to_string()
            }))
        .filter(|p| p.starts_with('/'))
        .unwrap_or_else(|| "/".into());

    Ok((jar, Redirect::to(&back)).into_response())
}

pub async fn test_notification() -> Response {
    todo!("shared::test_notification")
}
