//! `GET /api/meta` — ön yüzün sözlüğü.

use axum::{extract::State, Json};

use crate::{auth::CurrentUser, domain::meta::{self, Meta}, error::Result, state::AppState};

pub async fn meta(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Meta>> {
    Ok(Json(meta::get(&st, &me).await?))
}
