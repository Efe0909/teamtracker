//! HTTP edge for records and actions.

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use crate::{
    api::common::Body,
    auth::CurrentUser,
    domain::records::{self, ActionPatchBody, CardOrder, Decision, Detail, MyAction, NewAction, NewRecord, Patched, RecordPatchBody, RecordSummary},
    error::Result,
    state::AppState,
};

pub async fn list(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<RecordSummary>>> {
    Ok(Json(records::list(&st, &me, params).await?))
}

pub async fn get(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(records::get(&st, &me, id).await?))
}

pub async fn create(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewRecord>,
) -> Result<(StatusCode, Json<records::Created>)> {
    Ok((StatusCode::CREATED, Json(records::create(&st, &me, b).await?)))
}

pub async fn patch(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(body): Body<RecordPatchBody>,
) -> Result<Json<Patched>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(records::patch(&st, &me, id, body).await?))
}

pub async fn add_action(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<NewAction>,
) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(records::add_action(&st, &me, id, b).await?))
}

pub async fn patch_action(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(body): Body<ActionPatchBody>,
) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(records::patch_action(&st, &me, id, body).await?))
}

pub async fn my_actions(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<MyAction>>> {
    Ok(Json(records::my_actions(&st, &me).await?))
}

pub async fn add_participant(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, user)): Path<(String, String)>,
) -> Result<Json<Detail>> {
    let record = crate::api::common::id(&raw)?;
    let user = crate::api::common::id(&user)?;
    Ok(Json(records::add_participant(&st, &me, record, user).await?))
}

pub async fn remove_participant(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, user)): Path<(String, String)>,
) -> Result<Json<Detail>> {
    let record = crate::api::common::id(&raw)?;
    let user = crate::api::common::id(&user)?;
    Ok(Json(records::remove_participant(&st, &me, record, user).await?))
}

pub async fn pin(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(records::pin(&st, &me, id).await?))
}

pub async fn unpin(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(records::unpin(&st, &me, id).await?))
}

pub async fn set_card_order(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<CardOrder>,
) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(records::set_card_order(&st, &me, id, b).await?))
}

pub async fn join(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(records::join(&st, &me, id).await?))
}

pub async fn cancel_join(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(records::cancel_join(&st, &me, id).await?))
}

pub async fn decide_join(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, user)): Path<(String, String)>, Body(b): Body<Decision>,
) -> Result<Json<Detail>> {
    let record = crate::api::common::id(&raw)?;
    let user = crate::api::common::id(&user)?;
    Ok(Json(records::decide_join(&st, &me, record, user, b).await?))
}
