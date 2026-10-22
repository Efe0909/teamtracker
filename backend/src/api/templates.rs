use axum::{extract::{Path, State}, Json};

use crate::{
    api::common::{self, Body},
    auth::CurrentUser,
    domain::templates,
    error::Result,
    state::AppState,
};

pub(crate) use crate::domain::templates::{Template, TemplateIn};

pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<Template>>> {
    templates::list(&st, &me).await.map(Json)
}

pub async fn create(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<TemplateIn>) -> Result<Json<Template>> {
    templates::create(&st, &me, b).await.map(Json)
}

pub async fn replace(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<TemplateIn>) -> Result<Json<Template>> {
    templates::replace(&st, &me, common::id(&raw)?, b).await.map(Json)
}

pub async fn delete(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<serde_json::Value>> {
    templates::delete(&st, &me, common::id(&raw)?).await.map(Json)
}
