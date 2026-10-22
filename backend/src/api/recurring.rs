use axum::{extract::{Path, State}, Json};

use crate::{
    api::common::{self, Body},
    auth::CurrentUser,
    domain::recurring,
    error::Result,
    state::AppState,
};

pub(crate) use crate::domain::recurring::{Recurring, RecurringIn, RecurringPatch};

pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<Recurring>>> {
    recurring::list(&st, &me).await.map(Json)
}

pub async fn create(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<RecurringIn>) -> Result<Json<Recurring>> {
    recurring::create(&st, &me, b).await.map(Json)
}

pub async fn patch(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<RecurringPatch>) -> Result<Json<Recurring>> {
    recurring::patch(&st, &me, common::id(&raw)?, b).await.map(Json)
}

pub async fn delete(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<serde_json::Value>> {
    recurring::delete(&st, &me, common::id(&raw)?).await.map(Json)
}
