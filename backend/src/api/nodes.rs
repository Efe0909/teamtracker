//! HTTP handlers for the reference data tree.

use axum::{extract::{Path, State}, Json};
use uuid::Uuid;

use crate::{
    api::common::Body,
    auth::CurrentUser,
    domain::nodes::{self, NewNode, NodePatch, TreeView},
    error::Result,
    state::AppState,
};

pub async fn tree(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<TreeView>> {
    Ok(Json(nodes::tree(&st, &me).await?))
}

pub async fn create(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(body): Body<NewNode>,
) -> Result<Json<TreeView>> {
    Ok(Json(nodes::create(&st, &me, body).await?))
}

pub async fn patch(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(patch): Body<NodePatch>,
) -> Result<Json<TreeView>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(nodes::patch(&st, &me, id, patch).await?))
}

pub async fn delete(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<TreeView>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(nodes::delete(&st, &me, id).await?))
}

pub async fn favorite(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Vec<Uuid>>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(nodes::favorite(&st, &me, id).await?))
}

pub async fn unfavorite(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Vec<Uuid>>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(nodes::unfavorite(&st, &me, id).await?))
}
