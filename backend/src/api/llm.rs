use axum::{extract::{Path, State}, http::HeaderMap, Json};
use serde_json::Value;

use crate::{
    api::common::{self, Body},
    audit,
    auth::CurrentUser,
    domain::llm,
    error::Result,
    redact::LlmConfig,
    state::AppState,
};

pub(crate) use crate::domain::llm::{load, require};
pub(crate) use crate::domain::llm::{
    ActiveIn, LimitIn, LimitRow, LlmView, NewProfileIn, ProfileIn, ProfileView, PromptIn,
    PromptsView, RedactIn, TaskIn, TaskView, TryIn,
};

pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<LlmView>> {
    llm::get(&st, &me).await.map(Json)
}

pub async fn put(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(cfg): Body<LlmConfig>) -> Result<Json<LlmView>> {
    llm::put(&st, &me, audit::client_ip(&headers), cfg).await.map(Json)
}

pub async fn redact_try(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<RedactIn>) -> Result<Json<Value>> {
    llm::redact_try(&st, &me, b).await.map(Json)
}

pub async fn reset(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap) -> Result<Json<LlmView>> {
    llm::reset(&st, &me, audit::client_ip(&headers)).await.map(Json)
}

pub async fn list_limits(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<LimitRow>>> {
    llm::list_limits(&st, &me).await.map(Json)
}

pub async fn put_limit(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>, Body(b): Body<LimitIn>) -> Result<Json<ProfileView>> {
    llm::put_limit(&st, &me, audit::client_ip(&headers), common::id(&raw)?, b).await.map(Json)
}

pub async fn delete_limit(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>) -> Result<Json<ProfileView>> {
    llm::delete_limit(&st, &me, audit::client_ip(&headers), common::id(&raw)?).await.map(Json)
}

pub async fn list_profiles(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<ProfileView>>> {
    llm::list_profiles(&st, &me).await.map(Json)
}

pub async fn get_profile(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<ProfileView>> {
    llm::get_profile(&st, &me, common::id(&raw)?).await.map(Json)
}

pub async fn create_profile(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(b): Body<NewProfileIn>) -> Result<Json<ProfileView>> {
    llm::create_profile(&st, &me, audit::client_ip(&headers), b).await.map(Json)
}

pub async fn put_profile(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>, Body(b): Body<ProfileIn>) -> Result<Json<ProfileView>> {
    llm::put_profile(&st, &me, audit::client_ip(&headers), common::id(&raw)?, b).await.map(Json)
}

pub async fn delete_profile(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>) -> Result<Json<Vec<ProfileView>>> {
    llm::delete_profile(&st, &me, audit::client_ip(&headers), common::id(&raw)?).await.map(Json)
}

pub async fn list_tasks(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<TaskView>>> {
    llm::list_tasks(&st, &me).await.map(Json)
}

pub async fn get_task(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<TaskView>> {
    llm::get_task(&st, &me, &raw).await.map(Json)
}

pub async fn put_task(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>, Body(b): Body<TaskIn>) -> Result<Json<TaskView>> {
    llm::put_task(&st, &me, audit::client_ip(&headers), &raw, b).await.map(Json)
}

pub async fn try_it(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<TryIn>) -> Result<Json<Value>> {
    llm::try_it(&st, &me, b).await.map(Json)
}

pub async fn get_prompts(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<PromptsView>> {
    llm::get_prompts(&st, &me, &raw).await.map(Json)
}

pub async fn add_prompt(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<PromptIn>) -> Result<Json<PromptsView>> {
    llm::add_prompt(&st, &me, &raw, b).await.map(Json)
}

pub async fn activate_prompt(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>, Body(b): Body<ActiveIn>) -> Result<Json<PromptsView>> {
    llm::activate_prompt(&st, &me, audit::client_ip(&headers), &raw, b).await.map(Json)
}
