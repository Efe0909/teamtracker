//! HTTP handlers for the home screen and team membership views.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use crate::{
    api::common::Body,
    auth::CurrentUser,
    domain::home::{self, Home, MemberIn, TeamView},
    error::Result,
    state::AppState,
};

pub(crate) use crate::domain::home::manage_teams;

pub async fn home(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Home>> {
    Ok(Json(home::home(&st, &me).await?))
}

pub async fn pin(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(slug): Path<String>,
) -> Result<StatusCode> {
    home::pin(&st, &me, &slug).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unpin(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(slug): Path<String>,
) -> Result<StatusCode> {
    home::unpin(&st, &me, &slug).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn teams(State(st): State<AppState>, CurrentUser(_): CurrentUser) -> Result<Json<Vec<TeamView>>> {
    Ok(Json(home::teams(&st).await?))
}

pub async fn team(
    State(st): State<AppState>, CurrentUser(_): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<TeamView>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(home::team(&st, id).await?))
}

pub async fn set_member(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<MemberIn>,
) -> Result<Json<TeamView>> {
    let team = crate::api::common::id(&raw)?;
    Ok(Json(home::set_member(&st, &me, team, b).await?))
}

pub async fn drop_member(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, user)): Path<(String, String)>,
) -> Result<Json<TeamView>> {
    let team = crate::api::common::id(&raw)?;
    let user = crate::api::common::id(&user)?;
    Ok(Json(home::drop_member(&st, &me, team, user).await?))
}
