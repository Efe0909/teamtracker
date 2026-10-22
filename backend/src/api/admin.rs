use axum::{extract::{Path, State}, http::HeaderMap, Json};

use crate::{
    api::common::{self, Body},
    audit,
    auth::CurrentUser,
    domain::admin,
    error::Result,
    state::AppState,
};

pub(crate) use crate::domain::admin::{AdminView, NewUser, PersonUse, RoleIn, UserOp};

pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<AdminView>> {
    admin::get(&st, &me).await.map(Json)
}

pub async fn add_user(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewUser>) -> Result<Json<AdminView>> {
    admin::add_user(&st, &me, b).await.map(Json)
}

pub async fn patch_user(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>, Body(op): Body<UserOp>) -> Result<Json<AdminView>> {
    admin::patch_user(&st, &me, common::id(&raw)?, op, audit::client_ip(&headers)).await.map(Json)
}

pub async fn create_role(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(b): Body<RoleIn>) -> Result<Json<AdminView>> {
    admin::create_role(&st, &me, b, audit::client_ip(&headers)).await.map(Json)
}

pub async fn patch_role(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<RoleIn>) -> Result<Json<AdminView>> {
    admin::patch_role(&st, &me, common::id(&raw)?, b).await.map(Json)
}

pub async fn delete_role(State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>) -> Result<Json<AdminView>> {
    admin::delete_role(&st, &me, common::id(&raw)?, audit::client_ip(&headers)).await.map(Json)
}

pub async fn activity(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<PersonUse>>> {
    admin::activity(&st, &me).await.map(Json)
}
