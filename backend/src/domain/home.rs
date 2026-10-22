//! Ana sayfa sayaclari, ray pinleri, takimlar ve bildirim akisi.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::home as db,
    domain::common,
    error::{AppError, Result},
    models::{enums::TeamRole, module, user::User},
    state::AppState,
};

// --- ana sayfa -------------------------------------------------------------

#[derive(Serialize)]
pub(crate) struct Counts {
    my_open_actions: i64,
    open_records: i64,
    overdue_records: i64,
    unassigned: i64,
}

#[derive(Serialize)]
pub(crate) struct Home {
    counts: Counts,
    /// Kisinin raya sabitledigi moduller. Bos = varsayilanlar (on yuz karari).
    pins: Vec<String>,
}

pub(crate) async fn home(st: &AppState, me: &User) -> Result<Home> {
    // Tek sorgu: dort sayac. "Geciken" tanimi filters.rs `overdue` ile ayni.
    let row = db::find_counts(&st.pool, me.id).await?;
    let counts = Counts { my_open_actions: row.my_open_actions, open_records: row.open_records,
        overdue_records: row.overdue_records, unassigned: row.unassigned };
    let pins = db::list_pins(&st.pool, me.id).await?;
    Ok(Home { counts, pins })
}

/// Pin: modul katalogu kodda (`models/module.rs`); bilinmeyen slug 404.
pub(crate) async fn pin(st: &AppState, me: &User, slug: &str) -> Result<()> {
    module::by_slug(slug).ok_or(AppError::NotFound)?;
    db::insert_pin(&st.pool, me.id, slug).await?;
    Ok(())
}

pub(crate) async fn unpin(st: &AppState, me: &User, slug: &str) -> Result<()> {
    db::delete_pin(&st.pool, me.id, slug).await?;
    Ok(())
}

// --- takimlar --------------------------------------------------------------

#[derive(Serialize)]
struct Member {
    user_id: Uuid,
    role: TeamRole,
}

#[derive(Serialize)]
pub(crate) struct TeamView {
    id: Uuid,
    members: Vec<Member>,
    open_records: i64,
}

async fn team_views(st: &AppState, only: Option<Uuid>) -> Result<Vec<TeamView>> {
    let teams = db::list_teams(&st.pool, only).await?;
    let members = db::list_members(&st.pool, only).await?;
    Ok(teams.into_iter().map(|(id, open_records)| TeamView {
        id,
        members: members.iter().filter(|m| m.team_id == id)
            .map(|m| Member { user_id: m.user_id, role: m.role }).collect(),
        open_records,
    }).collect())
}

pub(crate) async fn teams(st: &AppState) -> Result<Vec<TeamView>> {
    team_views(st, None).await
}

pub(crate) async fn team(st: &AppState, id: Uuid) -> Result<TeamView> {
    one_team(st, id).await
}

// --- uyelik (R4-F09) ---------------------------------------------------------
//
// Python e74ca50: "uyelik bugune kadar yalniz tohumdan geliyordu". Kapi
// `manage_teams` ya da admin. Her degisim takim duvarina OLGU birakir —
// "beni kim ekledi/cikardi" sorusunun cevabi akista dursun. Cumleyi on yuz
// kurar (`lib/activity.ts`).

#[derive(Deserialize)]
pub(crate) struct MemberIn {
    user_id: Uuid,
    role: TeamRole,
}

pub(crate) async fn manage_teams(st: &AppState, me: &User) -> Result<()> {
    if me.is_admin || common::has_scope(st, me, "manage_teams").await? {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

async fn team_chat(st: &AppState, team: Uuid) -> Result<Uuid> {
    db::find_chat(&st.pool, team).await?.ok_or(AppError::NotFound)
}

async fn wall(
    st: &AppState, chat: Uuid, actor: Uuid, verb: &str, person: &str, detail: Option<String>,
) -> Result<()> {
    db::insert_activity(&st.pool, chat, actor, verb, person, detail).await?;
    Ok(())
}

/// Uye ekle ya da rolunu degistir — UPSERT: ikisi ayni hareket, ayri uc
/// olsaydi arayuz once "uye mi" diye sormak zorunda kalirdi.
pub(crate) async fn set_member(st: &AppState, me: &User, team: Uuid, b: MemberIn) -> Result<TeamView> {
    manage_teams(st, me).await?;
    let chat = team_chat(st, team).await?;
    let person = db::find_active_name(&st.pool, b.user_id).await?
        .ok_or(AppError::BadRequest("unknown_user"))?;
    let before = db::find_role(&st.pool, team, b.user_id).await?;
    // Ayni rol: yazma da gecmis de yok.
    if before != Some(b.role) {
        db::upsert_member(&st.pool, team, b.user_id, b.role).await?;
        let verb = if before.is_none() { "member_added" } else { "member_role" };
        let detail = serde_json::json!({ "from": before, "to": b.role }).to_string();
        wall(st, chat, me.id, verb, &person, Some(detail)).await?;
    }
    one_team(st, team).await
}

/// Cikar. Kayitlari ve eylemleri DURUR: uyelik bir yetki bagi, gecmisin
/// sahipligi degil.
pub(crate) async fn drop_member(st: &AppState, me: &User, team: Uuid, user: Uuid) -> Result<TeamView> {
    manage_teams(st, me).await?;
    let chat = team_chat(st, team).await?;
    let person = db::delete_member(&st.pool, team, user).await?.ok_or(AppError::NotFound)?;
    wall(st, chat, me.id, "member_removed", &person, None).await?;
    one_team(st, team).await
}

async fn one_team(st: &AppState, id: Uuid) -> Result<TeamView> {
    team_views(st, Some(id)).await?.into_iter().next().ok_or(AppError::NotFound)
}
