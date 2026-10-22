//! Takim ve pillar yazma kurallari (spec/22-takim-pillar.md).
//!
//! Okuma `home.rs` (`/api/teams`) ve `meta.rs` (`/api/meta`). Yetki: yazma
//! `manage_teams` ya da admin; pillar SILME yalniz admin. Cok satirli her
//! yazma tek islemde. Agaca dokunmuyoruz (yalniz `team_nodes` baglari), bu
//! yuzden `AppState.structure` kilidi gerekmiyor.
//!
//! Her pillar'in bir OZEL takimi var (`pillars.team_id`): ad/aciklama/renk
//! pillar'dan takima yazilir, takimin ADI `PATCH /api/teams/{id}`'den degismez.

use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    db::teams as db,
    domain::common,
    error::{AppError, Result},
    models::user::User,
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
    db::insert_activity(&mut **tx, chat, actor, verb, subject, target, detail).await?;
    Ok(())
}

/// Banner'i yaz; ek yoksa, silinmisse, gorsel degilse ya da kapak sinirini
/// asiyorsa 400 (`invalid_banner`; spec/83 §4.1).
async fn set_banner(tx: &mut Tx<'_>, team: Uuid, banner: Option<Uuid>) -> Result<()> {
    if let Some(a) = banner {
        let ok = db::check_banner(&mut **tx, a, crate::media::Purpose::Banner.max_bytes() as i64).await?;
        if !ok {
            return Err(AppError::BadRequest("invalid_banner"));
        }
    }
    db::set_banner(&mut **tx, team, banner).await?;
    Ok(())
}

/// Sohbet + takim satiri; `team_created` duvara yazilir. (id, chat_id) doner.
async fn insert_team(
    tx: &mut Tx<'_>, actor: Uuid, name: &str, description: Option<&str>, color: Option<&str>,
) -> Result<(Uuid, Uuid)> {
    let chat = db::insert_chat(&mut **tx).await?;
    let id = db::insert_team(&mut **tx, name, description, color, chat).await.map_err(name_taken)?;
    wall(tx, chat, actor, "team_created", name, None, None).await?;
    Ok((id, chat))
}

#[derive(Serialize)]
pub(crate) struct CreatedTeam {
    id: Uuid,
}

#[derive(Serialize)]
pub(crate) struct CreatedPillar {
    id: Uuid,
    team_id: Uuid,
}

// --- takimlar ----------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct NewTeam {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    color: Option<String>,
}

pub(crate) async fn create_team(st: &AppState, me: &User, b: NewTeam) -> Result<CreatedTeam> {
    crate::domain::home::manage_teams(st, me).await?;
    let bypass_quality = common::has_scope(st, me, "bypass_text_quality").await?;
    let name = name_of(b.name)?;
    check_name(&name)?;
    let description = common::text(b.description, TEXT_MAX, "invalid_description")?;
    check_description(description.as_deref(), bypass_quality)?;
    let color = common::text(b.color, COLOR_MAX, "invalid_color")?;
    let mut tx = st.pool.begin().await?;
    let (id, _) = insert_team(&mut tx, me.id, &name, description.as_deref(), color.as_deref()).await?;
    tx.commit().await?;
    Ok(CreatedTeam { id })
}

/// Verilmeyen alan DEGISMEZ, `null` siler.
#[derive(Deserialize)]
pub(crate) struct TeamPatch {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    description: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    color: Option<Option<String>>,
    /// Yuklenmis ek (`/api/attachments`); `null` banner'i kaldirir.
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    banner_id: Option<Option<Uuid>>,
}

pub(crate) async fn patch_team(st: &AppState, me: &User, id: Uuid, p: TeamPatch) -> Result<()> {
    crate::domain::home::manage_teams(st, me).await?;
    let bypass_quality = common::has_scope(st, me, "bypass_text_quality").await?;
    let name = p.name.map(name_of).transpose()?;
    let description = p.description
        .map(|d| common::text(d, TEXT_MAX, "invalid_description")).transpose()?;
    let color = p.color.map(|c| common::text(c, COLOR_MAX, "invalid_color")).transpose()?;

    let mut tx = st.pool.begin().await?;
    let db::TeamRow { name: old_name, description: old_description, color: old_color, chat_id: chat, is_pillar } =
        db::find_team_for_update(&mut *tx, id).await?.ok_or(AppError::NotFound)?;
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
    db::update_team(&mut *tx, id, &next_name, description.unwrap_or(old_description), color.unwrap_or(old_color))
        .await.map_err(name_taken)?;
    if let Some(banner) = p.banner_id {
        set_banner(&mut tx, id, banner).await?;
    }
    if next_name != old_name {
        wall(&mut tx, chat, me.id, "team_renamed", &next_name, None,
            Some(json!({ "from": old_name, "to": next_name }).to_string())).await?;
    }
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn delete_team(st: &AppState, me: &User, id: Uuid) -> Result<()> {
    crate::domain::home::manage_teams(st, me).await?;
    let is_pillar = db::find_pillar_status(&st.pool, id).await?;
    match is_pillar {
        None => return Err(AppError::NotFound),
        Some(true) => return Err(AppError::Conflict("team_is_pillar")),
        Some(false) => {}
    }
    // Sohbet tetikleyiciyle gider, records.team_id null olur (FK).
    // Arada pillar'a baglanamaz (pillar'i yalniz POST /api/pillars kurar);
    // yarisa kalirsa FK restrict 500 verir, kabul.
    db::delete_team(&st.pool, id).await?;
    Ok(())
}

/// IDEMPOTENT: baglanti zaten varsa yazma da gecmis de yok.
pub(crate) async fn link_node(st: &AppState, me: &User, team: Uuid, node: Uuid) -> Result<()> {
    crate::domain::home::manage_teams(st, me).await?;
    let mut tx = st.pool.begin().await?;
    let (team_name, chat) = db::find_team_chat(&mut *tx, team).await?.ok_or(AppError::NotFound)?;
    let node_name = db::find_active_node_name(&mut *tx, node).await?
            .ok_or(AppError::BadRequest("invalid_node"))?;
    // Takim yalniz birime baglanir (spec/74 §4.7).
    if !crate::refdata::under(&common::tree(st), node, crate::refdata::UNITS) {
        return Err(AppError::BadRequest("unit_outside_units"));
    }
    let inserted = db::insert_node_link(&mut *tx, team, node, me.id).await?;
    if inserted > 0 {
        wall(&mut tx, chat, me.id, "team_node_linked", &team_name, Some(&node_name), None).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Baglanti yoksa da 204 (gecmis yazilmaz).
pub(crate) async fn unlink_node(st: &AppState, me: &User, team: Uuid, node: Uuid) -> Result<()> {
    crate::domain::home::manage_teams(st, me).await?;
    let mut tx = st.pool.begin().await?;
    let (team_name, chat) = db::find_team_chat(&mut *tx, team).await?.ok_or(AppError::NotFound)?;
    let node_name = db::delete_node_link(&mut *tx, team, node).await?;
    if let Some(node_name) = node_name {
        wall(&mut tx, chat, me.id, "team_node_unlinked", &team_name, Some(&node_name), None).await?;
    }
    tx.commit().await?;
    Ok(())
}

// --- pillar'lar --------------------------------------------------------------

pub(crate) async fn create_pillar(st: &AppState, me: &User, b: NewTeam) -> Result<CreatedPillar> {
    crate::domain::home::manage_teams(st, me).await?;
    let bypass_quality = common::has_scope(st, me, "bypass_text_quality").await?;
    let name = name_of(b.name)?;
    check_name(&name)?;
    let description = common::text(b.description, TEXT_MAX, "invalid_description")?;
    check_description(description.as_deref(), bypass_quality)?;
    let color = common::text(b.color, COLOR_MAX, "invalid_color")?;
    let mut tx = st.pool.begin().await?;
    let (team_id, _) = insert_team(&mut tx, me.id, &name, description.as_deref(), color.as_deref()).await?;
    // Sona ekle: sira elle verilmiyor (agactaki kural).
    let id = db::insert_pillar(&mut *tx, &name, &description, &color, team_id, me.id).await.map_err(name_taken)?;
    tx.commit().await?;
    Ok(CreatedPillar { id, team_id })
}

#[derive(Deserialize)]
pub(crate) struct PillarPatch {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    description: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    color: Option<Option<String>>,
    #[serde(default)]
    is_active: Option<bool>,
    #[serde(default)]
    sort_order: Option<i32>,
    /// Ozel takimin banner'i; bkz. `TeamPatch::banner_id`.
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    banner_id: Option<Option<Uuid>>,
}

pub(crate) async fn patch_pillar(st: &AppState, me: &User, id: Uuid, p: PillarPatch) -> Result<()> {
    crate::domain::home::manage_teams(st, me).await?;
    let bypass_quality = common::has_scope(st, me, "bypass_text_quality").await?;
    let name = p.name.map(name_of).transpose()?;
    let description = p.description
        .map(|d| common::text(d, TEXT_MAX, "invalid_description")).transpose()?;
    let color = p.color.map(|c| common::text(c, COLOR_MAX, "invalid_color")).transpose()?;

    let mut tx = st.pool.begin().await?;
    let old = db::find_pillar_for_update(&mut *tx, id).await?.ok_or(AppError::NotFound)?;
    let next_name = name.unwrap_or_else(|| old.name.clone());
    let next_description = description.unwrap_or_else(|| old.description.clone());
    if next_name != old.name {
        check_name(&next_name)?;
    }
    if next_description != old.description {
        check_description(next_description.as_deref(), bypass_quality)?;
    }
    let next_color = color.unwrap_or(old.color);
    db::update_pillar(&mut *tx, id, &next_name, &next_description, &next_color,
        p.is_active.unwrap_or(old.is_active), p.sort_order.unwrap_or(old.sort_order)).await.map_err(name_taken)?;
    // Ad/aciklama/renk ozel takima da yazilir.
    db::update_team(&mut *tx, old.team_id, &next_name, next_description, next_color).await.map_err(name_taken)?;
    if let Some(banner) = p.banner_id {
        set_banner(&mut tx, old.team_id, banner).await?;
    }
    if next_name != old.name {
        wall(&mut tx, old.chat_id, me.id, "team_renamed", &next_name, None,
            Some(json!({ "from": old.name, "to": next_name }).to_string())).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Yalniz admin. Pillar + ozel takim + sohbet gider; `records.pillar_id` ve
/// `records.team_id` NULL olur (FK).
pub(crate) async fn delete_pillar(st: &AppState, me: &User, id: Uuid) -> Result<()> {
    if !me.is_admin {
        return Err(AppError::Forbidden);
    }
    let mut tx = st.pool.begin().await?;
    // Once pillar (team_id FK restrict), sonra takim.
    let team = db::delete_pillar(&mut *tx, id).await?.ok_or(AppError::NotFound)?;
    db::delete_team(&mut *tx, team).await?;
    tx.commit().await?;
    Ok(())
}
