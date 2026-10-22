use axum::{extract::State, http::HeaderMap, Json};

use crate::{
    api::common::Body,
    audit,
    auth::CurrentUser,
    decision::QualityConfig,
    domain::quality,
    error::Result,
    state::AppState,
};

pub(crate) use crate::domain::quality::{QualityView, TryIn};

pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<QualityView>> {
    quality::get(&st, &me).await.map(Json)
}

pub async fn put(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(cfg): Body<QualityConfig>) -> Result<Json<QualityView>> {
    quality::put(&st, &me, audit::client_ip(&headers), cfg).await.map(Json)
}

pub async fn reset(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap) -> Result<Json<QualityView>> {
    quality::reset(&st, &me, audit::client_ip(&headers)).await.map(Json)
}

pub async fn try_it(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<TryIn>) -> Result<Json<crate::decision::Quality>> {
    quality::try_it(&st, &me, b).await.map(Json)
}
