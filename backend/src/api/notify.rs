//! HTTP handlers for notifications and push subscriptions.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use crate::{
    api::common::Body,
    auth::CurrentUser,
    domain::notify::{self, ChatPref, NoticeList, Prefs, PrefsPatch, Subscription, Unsubscribe, VapidKey},
    error::Result,
    state::AppState,
};

pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<NoticeList>> {
    Ok(Json(notify::list(&st, &me).await?))
}

pub async fn seen(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<StatusCode> {
    notify::seen(&st, &me).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn prefs(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Prefs>> {
    Ok(Json(notify::prefs(&st, &me).await?))
}

pub async fn patch_prefs(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(p): Body<PrefsPatch>,
) -> Result<Json<Prefs>> {
    Ok(Json(notify::patch_prefs(&st, &me, p).await?))
}

pub async fn set_chat(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<ChatPref>,
) -> Result<Json<Prefs>> {
    let chat = crate::api::common::id(&raw)?;
    Ok(Json(notify::set_chat(&st, &me, chat, b).await?))
}

pub async fn subscribe(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<Subscription>,
) -> Result<StatusCode> {
    notify::subscribe(&st, &me, b).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unsubscribe(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<Unsubscribe>,
) -> Result<StatusCode> {
    notify::unsubscribe(&st, &me, b).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn vapid(State(st): State<AppState>, CurrentUser(_): CurrentUser) -> Json<VapidKey> {
    Json(notify::vapid(&st))
}
