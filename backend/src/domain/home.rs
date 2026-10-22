//! Ana sayfa sayaclari, ray pinleri, takimlar ve bildirim akisi.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    domain::common,
    error::{AppError, Result},
    models::{enums::TeamRole, module, user::User},
    state::AppState,
};

// --- ana sayfa -------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
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
    let counts = sqlx::query_as(
        "select
           (select count(*) from actions a
             where exists(select 1 from action_assignees x where x.action_id = a.id and x.user_id = $1)
               and a.status in ('open','in_progress')) as my_open_actions,
           (select count(*) from records
             where status not in ('closed','cancelled')) as open_records,
           (select count(*) from records r
             where r.status not in ('closed','cancelled')
               and (r.due_date < current_date or exists(
                    select 1 from actions a where a.record_id = r.id
                       and a.status in ('open','in_progress') and a.due_date < current_date))
           ) as overdue_records,
           (select count(*) from records
             where owner_id is null and status not in ('closed','cancelled')) as unassigned")
        .bind(me.id).fetch_one(&st.pool).await?;
    let pins = sqlx::query_scalar("select slug from user_pins where user_id = $1 order by pinned_at")
        .bind(me.id).fetch_all(&st.pool).await?;
    Ok(Home { counts, pins })
}

/// Pin: modul katalogu kodda (`models/module.rs`); bilinmeyen slug 404.
pub(crate) async fn pin(st: &AppState, me: &User, slug: &str) -> Result<()> {
    module::by_slug(slug).ok_or(AppError::NotFound)?;
    sqlx::query("insert into user_pins (user_id, slug) values ($1, $2) on conflict do nothing")
        .bind(me.id).bind(slug).execute(&st.pool).await?;
    Ok(())
}

pub(crate) async fn unpin(st: &AppState, me: &User, slug: &str) -> Result<()> {
    sqlx::query("delete from user_pins where user_id = $1 and slug = $2")
        .bind(me.id).bind(slug).execute(&st.pool).await?;
    Ok(())
}

// --- takimlar --------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
struct MemberRow {
    team_id: Uuid,
    user_id: Uuid,
    role: TeamRole,
}

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
    let teams: Vec<(Uuid, i64)> = sqlx::query_as(
        "select t.id, (select count(*) from records r
                        where r.team_id = t.id and r.status not in ('closed','cancelled'))
           from teams t where $1::uuid is null or t.id = $1 order by t.name")
        .bind(only).fetch_all(&st.pool).await?;
    let members: Vec<MemberRow> = sqlx::query_as(
        "select m.team_id, m.user_id, m.role from team_members m join users u on u.id = m.user_id
          where u.is_active and ($1::uuid is null or m.team_id = $1)
          order by case m.role when 'lead' then 0 when 'mentor' then 1 else 2 end, u.name")
        .bind(only).fetch_all(&st.pool).await?;
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
    sqlx::query_scalar("select chat_id from teams where id = $1")
        .bind(team).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)
}

async fn wall(
    st: &AppState, chat: Uuid, actor: Uuid, verb: &str, person: &str, detail: Option<String>,
) -> Result<()> {
    sqlx::query(
        "insert into activity (chat_id, actor_id, verb, subject_label, detail)
         values ($1, $2, $3, $4, $5)")
        .bind(chat).bind(actor).bind(verb).bind(person).bind(detail)
        .execute(&st.pool).await?;
    Ok(())
}

/// Uye ekle ya da rolunu degistir — UPSERT: ikisi ayni hareket, ayri uc
/// olsaydi arayuz once "uye mi" diye sormak zorunda kalirdi.
pub(crate) async fn set_member(st: &AppState, me: &User, team: Uuid, b: MemberIn) -> Result<TeamView> {
    manage_teams(st, me).await?;
    let chat = team_chat(st, team).await?;
    let person: String = sqlx::query_scalar("select name from users where id = $1 and is_active")
        .bind(b.user_id).fetch_optional(&st.pool).await?
        .ok_or(AppError::BadRequest("unknown_user"))?;
    let before: Option<TeamRole> = sqlx::query_scalar(
        "select role from team_members where team_id = $1 and user_id = $2")
        .bind(team).bind(b.user_id).fetch_optional(&st.pool).await?;
    // Ayni rol: yazma da gecmis de yok.
    if before != Some(b.role) {
        sqlx::query(
            "insert into team_members (team_id, user_id, role) values ($1, $2, $3)
             on conflict (team_id, user_id) do update set role = excluded.role")
            .bind(team).bind(b.user_id).bind(b.role).execute(&st.pool).await?;
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
    let person: String = sqlx::query_scalar(
        "delete from team_members m using users u
          where m.team_id = $1 and m.user_id = $2 and u.id = m.user_id returning u.name")
        .bind(team).bind(user).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;
    wall(st, chat, me.id, "member_removed", &person, None).await?;
    one_team(st, team).await
}

async fn one_team(st: &AppState, id: Uuid) -> Result<TeamView> {
    team_views(st, Some(id)).await?.into_iter().next().ok_or(AppError::NotFound)
}
