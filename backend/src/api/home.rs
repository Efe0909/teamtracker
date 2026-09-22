//! Ana sayfa sayaclari, ray pinleri, takimlar ve bildirim akisi.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    api::common,
    auth::CurrentUser,
    error::{AppError, Result},
    models::{enums::TeamRole, module},
    state::AppState,
};

// --- ana sayfa -------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct Counts {
    my_open_actions: i64,
    open_records: i64,
    overdue_records: i64,
    unassigned: i64,
}

#[derive(Serialize)]
pub struct Home {
    counts: Counts,
    /// Kisinin raya sabitledigi moduller. Bos = varsayilanlar (on yuz karari).
    pins: Vec<String>,
}

pub async fn home(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Home>> {
    // Tek sorgu: dort sayac. "Geciken" tanimi filters.rs `overdue` ile ayni.
    let counts = sqlx::query_as(
        "select
           (select count(*) from actions
             where owner_id = $1 and status in ('open','in_progress')) as my_open_actions,
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
    Ok(Json(Home { counts, pins }))
}

/// Pin: modul katalogu kodda (`models/module.rs`); bilinmeyen slug 404.
pub async fn pin(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(slug): Path<String>,
) -> Result<StatusCode> {
    module::by_slug(&slug).ok_or(AppError::NotFound)?;
    sqlx::query("insert into user_pins (user_id, slug) values ($1, $2) on conflict do nothing")
        .bind(me.id).bind(&slug).execute(&st.pool).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unpin(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(slug): Path<String>,
) -> Result<StatusCode> {
    sqlx::query("delete from user_pins where user_id = $1 and slug = $2")
        .bind(me.id).bind(&slug).execute(&st.pool).await?;
    Ok(StatusCode::NO_CONTENT)
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
pub struct TeamView {
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

pub async fn teams(State(st): State<AppState>, CurrentUser(_): CurrentUser) -> Result<Json<Vec<TeamView>>> {
    Ok(Json(team_views(&st, None).await?))
}

pub async fn team(
    State(st): State<AppState>, CurrentUser(_): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<TeamView>> {
    let id = common::id(&raw)?;
    team_views(&st, Some(id)).await?.into_iter().next().map(Json).ok_or(AppError::NotFound)
}

// --- bildirimler -----------------------------------------------------------

/// Beni ilgilendiren sohbetlerdeki son hareketler, benimkiler haric.
/// Okundu bilgisi YOK (spec/20 §6 Faz 3); liste son 60 satir.
#[derive(Serialize, sqlx::FromRow)]
pub struct Notice {
    kind: String,
    id: Uuid,
    created_at: DateTime<Utc>,
    actor_id: Option<Uuid>,
    verb: Option<String>,
    subject_label: Option<String>,
    target_label: Option<String>,
    body: Option<String>,
    record_id: Option<Uuid>,
    team_id: Option<Uuid>,
    title: String,
}

pub async fn notifications(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
) -> Result<Json<Vec<Notice>>> {
    Ok(Json(sqlx::query_as(
        "with mine as (
           select r.chat_id, r.id as record_id, null::uuid as team_id, r.title
             from records r
            where r.owner_id = $1 or r.created_by = $1
               or exists(select 1 from record_participants p
                          where p.record_id = r.id and p.user_id = $1)
               or exists(select 1 from actions a where a.record_id = r.id and a.owner_id = $1)
               or r.team_id in (select team_id from team_members where user_id = $1)
           union all
           select t.chat_id, null, t.id, t.name
             from teams t join team_members m on m.team_id = t.id and m.user_id = $1
         )
         select f.kind, f.id, f.created_at, f.actor_id, f.verb, f.subject_label,
                f.target_label, f.body, mine.record_id, mine.team_id, mine.title
           from chat_feed f join mine on mine.chat_id = f.chat_id
          where f.actor_id is distinct from $1
          order by f.created_at desc limit 60")
        .bind(me.id).fetch_all(&st.pool).await?))
}
