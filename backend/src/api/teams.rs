//! Takim ve pillar YAZMA uclari (spec/22-takim-pillar.md).
//!
//! Okuma `home.rs` (`/api/teams`) ve `meta.rs` (`/api/meta`). Yetki: yazma
//! `manage_teams` ya da admin; pillar SILME yalniz admin. Cok satirli her
//! yazma tek islemde. Agaca dokunmuyoruz (yalniz `team_nodes` baglari), bu
//! yuzden `AppState.structure` kilidi gerekmiyor.
//!
//! Her pillar'in bir OZEL takimi var (`pillars.team_id`): ad/aciklama/renk
//! pillar'dan takima yazilir, takimin ADI `PATCH /api/teams/{id}`'den degismez.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    api::{
        common::{self, Body},
        home::manage_teams,
    },
    auth::CurrentUser,
    error::{AppError, Result},
    state::AppState,
};

const NAME_MAX: usize = 200;
const TEXT_MAX: usize = 4000;
const COLOR_MAX: usize = 32;

type Tx<'a> = sqlx::Transaction<'a, sqlx::Postgres>;

fn name_of(raw: String) -> Result<String> {
    common::text(Some(raw), NAME_MAX, "invalid_name")?.ok_or(AppError::BadRequest("invalid_name"))
}

fn check_name(name: &str) -> Result<()> {
    common::min_chars(Some(name), common::NAME_MIN, "name_too_short")
}

fn check_description(description: Option<&str>, bypass_quality: bool) -> Result<()> {
    if bypass_quality { return Ok(()); }
    if let Some(value) = description.filter(|s| !s.trim().is_empty()) {
        common::min_chars(Some(value), common::DESC_MIN, "description_too_short")?;
    }
    Ok(())
}

/// Tekil ihlali (teams.name / pillars.name) 409 `name_taken`; gerisi 500.
fn name_taken(e: sqlx::Error) -> AppError {
    match e.as_database_error() {
        Some(d) if d.is_unique_violation() => AppError::Conflict("name_taken"),
        _ => AppError::Db(e),
    }
}

async fn wall(
    tx: &mut Tx<'_>, chat: Uuid, actor: Uuid, verb: &str, subject: &str,
    target: Option<&str>, detail: Option<String>,
) -> Result<()> {
    sqlx::query(
        "insert into activity (chat_id, actor_id, verb, subject_label, target_label, detail)
         values ($1, $2, $3, $4, $5, $6)")
        .bind(chat).bind(actor).bind(verb).bind(subject).bind(target).bind(detail)
        .execute(&mut **tx).await?;
    Ok(())
}

/// Banner'i yaz; ek yoksa ya da silinmisse 400 (`invalid_banner`).
async fn set_banner(tx: &mut Tx<'_>, team: Uuid, banner: Option<Uuid>) -> Result<()> {
    if let Some(a) = banner {
        let ok: bool = sqlx::query_scalar(
            "select exists(select 1 from attachments where id = $1 and deleted_at is null)")
            .bind(a).fetch_one(&mut **tx).await?;
        if !ok {
            return Err(AppError::BadRequest("invalid_banner"));
        }
    }
    sqlx::query("update teams set banner_id = $2 where id = $1")
        .bind(team).bind(banner).execute(&mut **tx).await?;
    Ok(())
}

/// Sohbet + takim satiri; `team_created` duvara yazilir. (id, chat_id) doner.
async fn insert_team(
    tx: &mut Tx<'_>, actor: Uuid, name: &str, description: Option<&str>, color: Option<&str>,
) -> Result<(Uuid, Uuid)> {
    let chat: Uuid = sqlx::query_scalar("insert into chats default values returning id")
        .fetch_one(&mut **tx).await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into teams (name, description, color, chat_id) values ($1, $2, $3, $4)
         returning id")
        .bind(name).bind(description).bind(color).bind(chat)
        .fetch_one(&mut **tx).await.map_err(name_taken)?;
    wall(tx, chat, actor, "team_created", name, None, None).await?;
    Ok((id, chat))
}

#[derive(Serialize)]
pub struct CreatedTeam {
    id: Uuid,
}

#[derive(Serialize)]
pub struct CreatedPillar {
    id: Uuid,
    team_id: Uuid,
}

// --- takimlar ----------------------------------------------------------------

#[derive(Deserialize)]
pub struct NewTeam {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    color: Option<String>,
}

pub async fn create_team(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewTeam>,
) -> Result<(StatusCode, Json<CreatedTeam>)> {
    manage_teams(&st, &me).await?;
    let bypass_quality = common::has_scope(&st, &me, "bypass_text_quality").await?;
    let name = name_of(b.name)?;
    check_name(&name)?;
    let description = common::text(b.description, TEXT_MAX, "invalid_description")?;
    check_description(description.as_deref(), bypass_quality)?;
    let color = common::text(b.color, COLOR_MAX, "invalid_color")?;
    let mut tx = st.pool.begin().await?;
    let (id, _) = insert_team(&mut tx, me.id, &name, description.as_deref(), color.as_deref()).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(CreatedTeam { id })))
}

/// Verilmeyen alan DEGISMEZ, `null` siler.
#[derive(Deserialize)]
pub struct TeamPatch {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, deserialize_with = "common::present")]
    description: Option<Option<String>>,
    #[serde(default, deserialize_with = "common::present")]
    color: Option<Option<String>>,
    /// Yuklenmis ek (`/api/attachments`); `null` banner'i kaldirir.
    #[serde(default, deserialize_with = "common::present")]
    banner_id: Option<Option<Uuid>>,
}

pub async fn patch_team(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(p): Body<TeamPatch>,
) -> Result<StatusCode> {
    manage_teams(&st, &me).await?;
    let bypass_quality = common::has_scope(&st, &me, "bypass_text_quality").await?;
    let id = common::id(&raw)?;
    let name = p.name.map(name_of).transpose()?;
    let description = p.description
        .map(|d| common::text(d, TEXT_MAX, "invalid_description")).transpose()?;
    let color = p.color.map(|c| common::text(c, COLOR_MAX, "invalid_color")).transpose()?;

    let mut tx = st.pool.begin().await?;
    let (old_name, old_description, old_color, chat, is_pillar): (
        String, Option<String>, Option<String>, Uuid, bool,
    ) = sqlx::query_as(
        "select t.name, t.description, t.color, t.chat_id,
                exists(select 1 from pillars p where p.team_id = t.id)
           from teams t where t.id = $1 for update")
        .bind(id).fetch_optional(&mut *tx).await?.ok_or(AppError::NotFound)?;
    let next_name = name.unwrap_or_else(|| old_name.clone());
    if next_name != old_name {
        common::min_chars(Some(&next_name), common::NAME_MIN, "name_too_short")?;
    }
    let next_description = description.clone().unwrap_or_else(|| old_description.clone());
    if next_description != old_description {
        check_description(next_description.as_deref(), bypass_quality)?;
    }
    if is_pillar && next_name != old_name {
        return Err(AppError::Conflict("team_is_pillar"));
    }
    sqlx::query("update teams set name = $2, description = $3, color = $4 where id = $1")
        .bind(id).bind(&next_name)
        .bind(description.unwrap_or(old_description)).bind(color.unwrap_or(old_color))
        .execute(&mut *tx).await.map_err(name_taken)?;
    if let Some(banner) = p.banner_id {
        set_banner(&mut tx, id, banner).await?;
    }
    if next_name != old_name {
        wall(&mut tx, chat, me.id, "team_renamed", &next_name, None,
            Some(json!({ "from": old_name, "to": next_name }).to_string())).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_team(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<StatusCode> {
    manage_teams(&st, &me).await?;
    let id = common::id(&raw)?;
    let is_pillar: Option<bool> = sqlx::query_scalar(
        "select exists(select 1 from pillars p where p.team_id = t.id) from teams t where t.id = $1")
        .bind(id).fetch_optional(&st.pool).await?;
    match is_pillar {
        None => return Err(AppError::NotFound),
        Some(true) => return Err(AppError::Conflict("team_is_pillar")),
        Some(false) => {}
    }
    // Sohbet tetikleyiciyle gider, records.team_id null olur (FK).
    // Arada pillar'a baglanamaz (pillar'i yalniz POST /api/pillars kurar);
    // yarisa kalirsa FK restrict 500 verir, kabul.
    sqlx::query("delete from teams where id = $1").bind(id).execute(&st.pool).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// IDEMPOTENT: baglanti zaten varsa yazma da gecmis de yok.
pub async fn link_node(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, node)): Path<(String, String)>,
) -> Result<StatusCode> {
    manage_teams(&st, &me).await?;
    let team = common::id(&raw)?;
    let node = common::id(&node)?;
    let mut tx = st.pool.begin().await?;
    let (team_name, chat): (String, Uuid) =
        sqlx::query_as("select name, chat_id from teams where id = $1")
            .bind(team).fetch_optional(&mut *tx).await?.ok_or(AppError::NotFound)?;
    let node_name: String =
        sqlx::query_scalar("select name from nodes where id = $1 and is_active")
            .bind(node).fetch_optional(&mut *tx).await?
            .ok_or(AppError::BadRequest("invalid_node"))?;
    // Takim yalniz birime baglanir (spec/74 §4.7).
    if !crate::refdata::under(&common::tree(&st), node, crate::refdata::UNITS) {
        return Err(AppError::BadRequest("unit_outside_units"));
    }
    let inserted = sqlx::query(
        "insert into team_nodes (team_id, node_id, linked_by) values ($1, $2, $3)
         on conflict do nothing")
        .bind(team).bind(node).bind(me.id).execute(&mut *tx).await?.rows_affected();
    if inserted > 0 {
        wall(&mut tx, chat, me.id, "team_node_linked", &team_name, Some(&node_name), None).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Baglanti yoksa da 204 (gecmis yazilmaz).
pub async fn unlink_node(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, node)): Path<(String, String)>,
) -> Result<StatusCode> {
    manage_teams(&st, &me).await?;
    let team = common::id(&raw)?;
    let node = common::id(&node)?;
    let mut tx = st.pool.begin().await?;
    let (team_name, chat): (String, Uuid) =
        sqlx::query_as("select name, chat_id from teams where id = $1")
            .bind(team).fetch_optional(&mut *tx).await?.ok_or(AppError::NotFound)?;
    let node_name: Option<String> = sqlx::query_scalar(
        "delete from team_nodes t using nodes n
          where t.team_id = $1 and t.node_id = $2 and n.id = t.node_id returning n.name")
        .bind(team).bind(node).fetch_optional(&mut *tx).await?;
    if let Some(node_name) = node_name {
        wall(&mut tx, chat, me.id, "team_node_unlinked", &team_name, Some(&node_name), None).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// --- pillar'lar --------------------------------------------------------------

pub async fn create_pillar(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewTeam>,
) -> Result<(StatusCode, Json<CreatedPillar>)> {
    manage_teams(&st, &me).await?;
    let bypass_quality = common::has_scope(&st, &me, "bypass_text_quality").await?;
    let name = name_of(b.name)?;
    check_name(&name)?;
    let description = common::text(b.description, TEXT_MAX, "invalid_description")?;
    check_description(description.as_deref(), bypass_quality)?;
    let color = common::text(b.color, COLOR_MAX, "invalid_color")?;
    let mut tx = st.pool.begin().await?;
    let (team_id, _) = insert_team(&mut tx, me.id, &name, description.as_deref(), color.as_deref()).await?;
    // Sona ekle: sira elle verilmiyor (agactaki kural).
    let id: Uuid = sqlx::query_scalar(
        "insert into pillars (name, description, color, team_id, created_by, sort_order)
         values ($1, $2, $3, $4, $5, (select coalesce(max(sort_order), -1) + 1 from pillars))
         returning id")
        .bind(&name).bind(&description).bind(&color).bind(team_id).bind(me.id)
        .fetch_one(&mut *tx).await.map_err(name_taken)?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(CreatedPillar { id, team_id })))
}

#[derive(Deserialize)]
pub struct PillarPatch {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, deserialize_with = "common::present")]
    description: Option<Option<String>>,
    #[serde(default, deserialize_with = "common::present")]
    color: Option<Option<String>>,
    #[serde(default)]
    is_active: Option<bool>,
    #[serde(default)]
    sort_order: Option<i32>,
    /// Ozel takimin banner'i; bkz. `TeamPatch::banner_id`.
    #[serde(default, deserialize_with = "common::present")]
    banner_id: Option<Option<Uuid>>,
}

pub async fn patch_pillar(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(p): Body<PillarPatch>,
) -> Result<StatusCode> {
    manage_teams(&st, &me).await?;
    let bypass_quality = common::has_scope(&st, &me, "bypass_text_quality").await?;
    let id = common::id(&raw)?;
    let name = p.name.map(name_of).transpose()?;
    let description = p.description
        .map(|d| common::text(d, TEXT_MAX, "invalid_description")).transpose()?;
    let color = p.color.map(|c| common::text(c, COLOR_MAX, "invalid_color")).transpose()?;

    let mut tx = st.pool.begin().await?;
    #[derive(sqlx::FromRow)]
    struct Row {
        name: String,
        description: Option<String>,
        color: Option<String>,
        team_id: Uuid,
        is_active: bool,
        sort_order: i32,
        chat_id: Uuid,
    }
    let old: Row = sqlx::query_as(
        "select p.name, p.description, p.color, p.team_id, p.is_active, p.sort_order, t.chat_id
           from pillars p join teams t on t.id = p.team_id where p.id = $1 for update of p")
        .bind(id).fetch_optional(&mut *tx).await?.ok_or(AppError::NotFound)?;
    let next_name = name.unwrap_or_else(|| old.name.clone());
    let next_description = description.unwrap_or_else(|| old.description.clone());
    if next_name != old.name {
        check_name(&next_name)?;
    }
    if next_description != old.description {
        check_description(next_description.as_deref(), bypass_quality)?;
    }
    let next_color = color.unwrap_or(old.color);
    sqlx::query(
        "update pillars set name = $2, description = $3, color = $4, is_active = $5,
                            sort_order = $6 where id = $1")
        .bind(id).bind(&next_name).bind(&next_description).bind(&next_color)
        .bind(p.is_active.unwrap_or(old.is_active)).bind(p.sort_order.unwrap_or(old.sort_order))
        .execute(&mut *tx).await.map_err(name_taken)?;
    // Ad/aciklama/renk ozel takima da yazilir.
    sqlx::query("update teams set name = $2, description = $3, color = $4 where id = $1")
        .bind(old.team_id).bind(&next_name).bind(&next_description).bind(&next_color)
        .execute(&mut *tx).await.map_err(name_taken)?;
    if let Some(banner) = p.banner_id {
        set_banner(&mut tx, old.team_id, banner).await?;
    }
    if next_name != old.name {
        wall(&mut tx, old.chat_id, me.id, "team_renamed", &next_name, None,
            Some(json!({ "from": old.name, "to": next_name }).to_string())).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Yalniz admin. Pillar + ozel takim + sohbet gider; `records.pillar_id` ve
/// `records.team_id` NULL olur (FK).
pub async fn delete_pillar(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<StatusCode> {
    if !me.is_admin {
        return Err(AppError::Forbidden);
    }
    let id = common::id(&raw)?;
    let mut tx = st.pool.begin().await?;
    // Once pillar (team_id FK restrict), sonra takim.
    let team: Uuid = sqlx::query_scalar("delete from pillars where id = $1 returning team_id")
        .bind(id).fetch_optional(&mut *tx).await?.ok_or(AppError::NotFound)?;
    sqlx::query("delete from teams where id = $1").bind(team).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
