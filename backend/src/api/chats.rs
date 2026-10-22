//! HTTP handlers for chat feeds and messages.

use axum::{extract::{Path, State}, Json};

use crate::{
    api::common::Body,
    auth::CurrentUser,
    domain::chats::{self, Feed, InboxChat, NewMessage, Posted},
    error::Result,
    state::AppState,
};

pub(crate) use crate::domain::chats::authorize_read;

pub async fn inbox(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<InboxChat>>> {
    Ok(Json(chats::inbox(&st, &me).await?))
}

pub async fn feed(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Feed>> {
    let chat = crate::api::common::id(&raw)?;
    Ok(Json(chats::feed(&st, &me, chat).await?))
}

pub async fn post(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<NewMessage>,
) -> Result<Json<Posted>> {
    let chat = crate::api::common::id(&raw)?;
    Ok(Json(chats::post(&st, &me, chat, b).await?))
}
