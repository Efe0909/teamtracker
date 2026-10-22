//! HTTP handlers for teams and pillars.

use axum::{extract::{Path, State}, http::StatusCode, Json};
use crate::{
    api::common::Body,
    auth::CurrentUser,
    domain::teams::{self, CreatedPillar, CreatedTeam, NewTeam, PillarPatch, TeamPatch},
    error::Result,
    state::AppState,
};

pub async fn create_team(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(body): Body<NewTeam>,
) -> Result<(StatusCode, Json<CreatedTeam>)> {
    Ok((StatusCode::CREATED, Json(teams::create_team(&st, &me, body).await?)))
}
pub async fn patch_team(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(patch): Body<TeamPatch>,
) -> Result<StatusCode> {
    teams::patch_team(&st, &me, crate::api::common::id(&raw)?, patch).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_team(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<StatusCode> {
    teams::delete_team(&st, &me, crate::api::common::id(&raw)?).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn link_node(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((team, node)): Path<(String, String)>,
) -> Result<StatusCode> {
    teams::link_node(&st, &me, crate::api::common::id(&team)?, crate::api::common::id(&node)?).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unlink_node(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((team, node)): Path<(String, String)>,
) -> Result<StatusCode> {
    teams::unlink_node(&st, &me, crate::api::common::id(&team)?, crate::api::common::id(&node)?).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn create_pillar(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(body): Body<NewTeam>,
) -> Result<(StatusCode, Json<CreatedPillar>)> {
    Ok((StatusCode::CREATED, Json(teams::create_pillar(&st, &me, body).await?)))
}

pub async fn patch_pillar(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(patch): Body<PillarPatch>,
) -> Result<StatusCode> {
    teams::patch_pillar(&st, &me, crate::api::common::id(&raw)?, patch).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_pillar(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<StatusCode> {
    teams::delete_pillar(&st, &me, crate::api::common::id(&raw)?).await?;
    Ok(StatusCode::NO_CONTENT)
}
