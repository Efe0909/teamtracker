//! event_context veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::NaiveDate;
use uuid::Uuid;
use crate::domain::events::Material;

#[derive(sqlx::FromRow)]
pub(crate) struct OutcomeRow {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct Head {
    pub(crate) title: String,
    pub(crate) kind: String,
    pub(crate) status: String,
    pub(crate) priority: String,
    pub(crate) date: Option<NaiveDate>,
    pub(crate) start_time: Option<String>,
    pub(crate) attendees: Option<i32>,
    pub(crate) description: Option<String>,
    pub(crate) has_place: bool,
    pub(crate) place_description: Option<String>,
    pub(crate) participant_count: i64,
    pub(crate) team_count: i64,
}

#[derive(sqlx::FromRow)]
pub(crate) struct OtfRow {
    pub(crate) end_time: Option<String>,
    pub(crate) age_group: Option<String>,
    pub(crate) purpose: Option<String>,
    pub(crate) outcomes: Option<String>,
    pub(crate) layout_notes: Option<String>,
    pub(crate) av_notes: Option<String>,
    pub(crate) tech_notes: Option<String>,
    pub(crate) host_notes: Option<String>,
    pub(crate) care_notes: Option<String>,
    pub(crate) other_notes: Option<String>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct CheckpointRow {
    pub(crate) label: String,
    pub(crate) date: Option<NaiveDate>,
    pub(crate) done: bool,
    /// Sablondan geldi (`offset_days` dolu); elle eklenenin tarihi mutlak.
    pub(crate) templated: bool,
}

pub(crate) async fn list_people(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("select name from users").fetch_all(ex).await
}

pub(crate) async fn list_organizations(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select name from teams union select name from material_providers where name is not null")
        .fetch_all(ex).await
}

pub(crate) async fn find_otf(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<OtfRow>, sqlx::Error> {
    sqlx::query_as(
        "select to_char(end_time, 'HH24:MI') as end_time, age_group, purpose, outcomes,
                layout_notes, av_notes, tech_notes, host_notes, care_notes, other_notes
           from event_otf where event_id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn list_otf_items(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<(String, Option<i32>)>, sqlx::Error> {
    sqlx::query_as(
        "select item, quantity from event_otf_items where event_id = $1 order by item")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn find_head(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<Head>, sqlx::Error> {
    sqlx::query_as(
        "select e.title, k.name as kind, e.status, e.priority, e.date,
                to_char(e.start_time, 'HH24:MI') as start_time, e.attendees, e.description,
                coalesce(l.name, nullif(trim(e.place), '')) is not null as has_place,
                l.description as place_description,
                (select count(*) from event_participants p where p.event_id = e.id) as participant_count,
                (select count(*) from event_teams t where t.event_id = e.id) as team_count
           from events e join nodes k on k.id = e.kind_id left join nodes l on l.id = e.location_id
          where e.id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn list_outcomes(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<OutcomeRow>, sqlx::Error> {
    sqlx::query_as(
        "select n.name, n.description from event_otf_outcomes o join nodes n on n.id = o.outcome_id
          where o.event_id = $1 order by n.name")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn list_checkpoints(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<CheckpointRow>, sqlx::Error> {
    sqlx::query_as(
        "select c.label, coalesce(c.due_date, e.date + c.offset_days::int) as date,
                c.done_at is not null as done, c.offset_days is not null as templated
           from event_checkpoints c join events e on e.id = c.event_id
          where c.event_id = $1 order by c.position")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn list_materials(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<Material>, sqlx::Error> {
    sqlx::query_as(concat!(
        "select ",
        "m.id, m.name, m.notes, m.type as kind, m.priority, m.state, m.qty, m.has_sponsor, m.owned,
         m.chosen_provider_id, m.sponsor_chosen, m.sponsor_qty, m.sponsor_date, m.in_sponsor_record,
         m.delivered, m.purchased, m.purchased_at, m.created_by, m.updated_at,
         m.budget::float8 as budget, m.overage_ln", " from materials m
           join event_materials em on em.material_id = m.id
          where em.event_id = $1 order by m.created_at, m.id"))
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn find_place(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select coalesce(l.name, nullif(trim(e.place), '')) from events e
           left join nodes l on l.id = e.location_id where e.id = $1")
        .bind(id).fetch_one(ex).await
}
