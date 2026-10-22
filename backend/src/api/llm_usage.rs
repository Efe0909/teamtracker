use axum::{extract::{Path, Query, State}, Json};

use crate::{
    api::common,
    auth::CurrentUser,
    domain::llm_usage,
    error::Result,
    state::AppState,
};

pub(crate) use crate::domain::llm_usage::{
    CallDetail, CallsView, FilterIn, KeyView, ModelsView, RefreshIn, StatusView, UsageView,
};

pub async fn usage(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<FilterIn>) -> Result<Json<UsageView>> {
    llm_usage::usage(&st, &me, q).await.map(Json)
}

pub async fn calls(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<FilterIn>) -> Result<Json<CallsView>> {
    llm_usage::calls(&st, &me, q).await.map(Json)
}

pub async fn call(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<CallDetail>> {
    llm_usage::call(&st, &me, common::id(&raw)?).await.map(Json)
}

pub async fn status(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<StatusView>> {
    llm_usage::status(&st, &me).await.map(Json)
}

pub async fn key(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<RefreshIn>) -> Result<Json<KeyView>> {
    llm_usage::key(&st, &me, q).await.map(Json)
}

pub async fn models(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<RefreshIn>) -> Result<Json<ModelsView>> {
    llm_usage::models(&st, &me, q).await.map(Json)
}
