//! HTTP handlers for record cards.

use axum::{extract::{Path, State}, Json};

use crate::{
    api::common::Body,
    auth::CurrentUser,
    domain::{cards, records::Detail},
    error::Result,
    state::AppState,
};

use crate::domain::cards::{AttachIn, CardIn, SignupIn, VoteIn};

pub async fn create(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<CardIn>,
) -> Result<Json<Detail>> {
    let record_id = crate::api::common::id(&raw)?;
    Ok(Json(cards::create(&st, &me, record_id, b).await?))
}

pub async fn patch(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<CardIn>,
) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(cards::patch(&st, &me, id, b).await?))
}

pub async fn delete(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(cards::delete(&st, &me, id).await?))
}

pub async fn signup(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<SignupIn>,
) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(cards::signup(&st, &me, id, b).await?))
}

pub async fn vote(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<VoteIn>,
) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(cards::vote(&st, &me, id, b).await?))
}

pub async fn attach(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<AttachIn>,
) -> Result<Json<Detail>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(cards::attach(&st, &me, id, b).await?))
}
