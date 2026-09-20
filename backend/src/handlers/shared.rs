//! `routes/shared.rs` karsiligi — istek govdesi, yetki, YAZMA yolu.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use uuid::Uuid;

use crate::{auth::CurrentUser, error::Result, state::AppState};

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

pub async fn switch_user() -> Response {
    todo!("shared::switch_user")
}

pub async fn test_notification() -> Response {
    todo!("shared::test_notification")
}
