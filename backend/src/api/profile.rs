//! HTTP handlers for the signed-in user's profile.

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};

use crate::{
    api::common::Body,
    auth::CurrentUser,
    domain::profile::{self, NameIn, ProfilePatch},
    error::Result,
    state::AppState,
};

pub async fn rename(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(p): Body<NameIn>,
) -> Result<StatusCode> {
    let id = crate::api::common::id(&raw)?;
    profile::rename(&st, &me, id, p).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn patch(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(p): Body<ProfilePatch>,
) -> Result<StatusCode> {
    profile::patch(&st, &me, p).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn export(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Response> {
    let body = profile::export(&st, &me).await?;
    Ok((
        [(header::CONTENT_DISPOSITION, "attachment; filename=\"ekiptakip-verilerim.json\"")],
        Json(body),
    ).into_response())
}
