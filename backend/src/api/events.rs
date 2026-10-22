//! Etkinlik API handler'lari.

use axum::{extract::{Path, Query, State}, http::header, response::{IntoResponse, Response}, Json};
use crate::{api::common::{self, Body}, auth::CurrentUser, domain::events as domain_events, domain::events::*, error::Result, state::AppState};

pub(crate) use domain_events::{known_names, material_sample, try_suggest};

pub async fn list(State(st): State<AppState>, CurrentUser(_me): CurrentUser) -> Result<Json<Vec<EventRow>>> {
    Ok(Json(domain_events::list(&st).await?))
}

pub async fn get(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::get(&st, &me, id).await?))
}

pub async fn create(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewEvent>,
) -> Result<Json<Created>> {
    Ok(Json(domain_events::create(&st, &me, b).await?))
}

pub async fn patch(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(EventPatchBody { patch: p, quality_override }): Body<EventPatchBody>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::patch(&st, &me, id, EventPatchBody { patch: p, quality_override }).await?))
}

pub async fn put_participant(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, user)): Path<(String, String)>, Body(b): Body<ParticipantBody>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let user = common::id(&user)?;
    Ok(Json(domain_events::put_participant(&st, &me, id, user, b).await?))
}

pub async fn remove_participant(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, user)): Path<(String, String)>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let user = common::id(&user)?;
    Ok(Json(domain_events::remove_participant(&st, &me, id, user).await?))
}

pub async fn put_team(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, team)): Path<(String, String)>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let team = common::id(&team)?;
    Ok(Json(domain_events::put_team(&st, &me, id, team).await?))
}

pub async fn remove_team(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, team)): Path<(String, String)>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let team = common::id(&team)?;
    Ok(Json(domain_events::remove_team(&st, &me, id, team).await?))
}

pub async fn add_checkpoint(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewCheckpoint>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::add_checkpoint(&st, &me, id, b).await?))
}

pub async fn patch_checkpoint(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<CheckpointPatch>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::patch_checkpoint(&st, &me, id, b).await?))
}

pub async fn delete_checkpoint(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::delete_checkpoint(&st, &me, id).await?))
}

pub async fn request_checkpoint(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewRequest>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::request_checkpoint(&st, &me, id, b).await?))
}

pub async fn resolve_request(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<Resolve>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::resolve_request(&st, &me, id, b).await?))
}

pub async fn add_widget(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewWidget>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::add_widget(&st, &me, id, b).await?))
}

pub async fn delete_widget(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::delete_widget(&st, &me, id).await?))
}

pub async fn add_material(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewMaterial>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::add_material(&st, &me, id, b).await?))
}

pub async fn patch_material(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<MaterialPatch>,
) -> Result<Json<MatReply>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::patch_material(&st, &me, id, b).await?))
}

pub async fn delete_material(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<MatReply>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::delete_material(&st, &me, id).await?))
}

pub async fn add_provider(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewProvider>,
) -> Result<Json<MatReply>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::add_provider(&st, &me, id, b).await?))
}

pub async fn delete_provider(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<MatReply>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::delete_provider(&st, &me, id).await?))
}

pub async fn patch_provider(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<ProviderPatch>,
) -> Result<Json<MatReply>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::patch_provider(&st, &me, id, b).await?))
}

pub async fn set_purchased(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<PurchasedPatch>,
) -> Result<Json<Material>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::set_purchased(&st, &me, id, b).await?))
}

pub(crate) async fn llm_context(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Query(q): Query<Params>,
) -> Result<Json<Context>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::llm_context(&st, &me, id, q).await?))
}

pub(crate) async fn llm_restore(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<RestoreIn>,
) -> Result<Json<RestoreOut>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::llm_restore(&st, &me, id, b).await?))
}

pub(crate) async fn material_suggestions(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<SuggestIn>,
) -> Result<Json<SuggestOut>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::material_suggestions(&st, &me, id, b).await?))
}

pub(crate) async fn reject_suggestion(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, sraw)): Path<(String, String)>,
) -> Result<axum::http::StatusCode> {
    let id = common::id(&raw)?;
    let sid = common::id(&sraw)?;
    domain_events::reject_suggestion(&st, &me, id, sid).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub(crate) async fn material_brief(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Query(q): Query<Params>,
) -> Result<Json<MaterialBrief>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_events::material_brief(&st, &me, id, q).await?))
}

pub async fn purchases_xlsx(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Response> {
    let id = common::id(&raw)?;
    let file = domain_events::purchases_xlsx(&st, &me, id).await?;
    Ok(([
        (header::CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string()),
        (header::CACHE_CONTROL, "no-store".into()),
        (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", file.file_name)),
    ], file.bytes).into_response())
}
