//! otf veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use uuid::Uuid;

#[derive(sqlx::FromRow)]
pub(crate) struct ItemRow {
    pub(crate) item: String,
    pub(crate) quantity: Option<i32>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct ContactRow {
    pub(crate) name: String,
    pub(crate) phone: Option<String>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct FieldsRow {
    pub(crate) purpose: Option<String>,
    pub(crate) end_time: Option<String>,
    pub(crate) advisor: Option<String>,
    pub(crate) age_group: Option<String>,
    pub(crate) outcomes: Option<String>,
    pub(crate) layout_notes: Option<String>,
    pub(crate) av_notes: Option<String>,
    pub(crate) tech_notes: Option<String>,
    pub(crate) host_notes: Option<String>,
    pub(crate) care_notes: Option<String>,
    pub(crate) other_notes: Option<String>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct ReviewRow {
    pub(crate) copied_from: Option<Uuid>,
    pub(crate) copied_title: Option<String>,
    pub(crate) needs_review: bool,
    pub(crate) edited: bool,
}

#[derive(sqlx::FromRow)]
pub(crate) struct SourceRow {
    pub(crate) event_id: Uuid,
    pub(crate) title: String,
    pub(crate) updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct EventInfo {
    pub(crate) title: String,
    pub(crate) date: Option<NaiveDate>,
    pub(crate) start_time: Option<String>,
    pub(crate) place: Option<String>,
    pub(crate) attendees: Option<i32>,
}

pub(crate) async fn find_review(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<ReviewRow>, sqlx::Error> {
    sqlx::query_as(
        "select o.copied_from, e.title as copied_title, o.needs_review, o.edited
           from event_otf o left join events e on e.id = o.copied_from
          where o.event_id = $1 and (o.copied_from is not null or o.needs_review)")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn find_source(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<SourceRow>, sqlx::Error> {
    sqlx::query_as(
        "select o.event_id, e.title, o.updated_at
           from event_otf o join events e on e.id = o.event_id
          where o.event_id <> $1 and not o.needs_review
          order by o.updated_at desc limit 1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn find_event_info(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<EventInfo>, sqlx::Error> {
    sqlx::query_as(
        // Yer: listeden secildiyse dugum adi, yoksa metin (spec/74 §5b).
        "select e.title, e.date, to_char(e.start_time, 'HH24:MI') as start_time,
                coalesce(n.name, e.place) as place, e.attendees
           from events e left join nodes n on n.id = e.location_id where e.id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn find_fields(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<FieldsRow>, sqlx::Error> {
    sqlx::query_as(
        "select purpose, to_char(end_time, 'HH24:MI') as end_time, advisor, age_group, outcomes,
                layout_notes, av_notes, tech_notes, host_notes, care_notes, other_notes
           from event_otf where event_id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn list_items(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<ItemRow>, sqlx::Error> {
    sqlx::query_as("select item, quantity from event_otf_items where event_id = $1")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn list_contacts(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select user_id from event_otf_contacts where event_id = $1 order by position")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn list_outcome_ids(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select outcome_id from event_otf_outcomes where event_id = $1")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn list_descriptions(ex: impl sqlx::PgExecutor<'_>, ids: &[Uuid]) -> Result<Vec<(Uuid, Option<String>)>, sqlx::Error> {
    sqlx::query_as("select id, description from nodes where id = any($1)")
        .bind(ids).fetch_all(ex).await
}

pub(crate) async fn copy_fields(ex: impl sqlx::PgExecutor<'_>, id: Uuid, src: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into event_otf (event_id, purpose, end_time, advisor, age_group, outcomes,
                                layout_notes, av_notes, tech_notes, host_notes, care_notes, other_notes,
                                copied_from, needs_review, edited)
         select $1, purpose, end_time, advisor, age_group, outcomes,
                layout_notes, av_notes, tech_notes, host_notes, care_notes, other_notes, $2, true, false
           from event_otf where event_id = $2
         on conflict (event_id) do update set
           purpose = excluded.purpose, end_time = excluded.end_time, advisor = excluded.advisor,
           age_group = excluded.age_group, outcomes = excluded.outcomes,
           layout_notes = excluded.layout_notes, av_notes = excluded.av_notes,
           tech_notes = excluded.tech_notes, host_notes = excluded.host_notes,
           care_notes = excluded.care_notes, other_notes = excluded.other_notes,
           copied_from = excluded.copied_from, needs_review = true, edited = false, updated_at = now()")
        .bind(id).bind(src).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_items(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from event_otf_items where event_id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn copy_items(ex: impl sqlx::PgExecutor<'_>, id: Uuid, src: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("insert into event_otf_items (event_id, item, quantity)
                 select $1, item, quantity from event_otf_items where event_id = $2")
        .bind(id).bind(src).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_contacts(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from event_otf_contacts where event_id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn copy_contacts(ex: impl sqlx::PgExecutor<'_>, id: Uuid, src: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("insert into event_otf_contacts (event_id, user_id, position)
                 select $1, user_id, position from event_otf_contacts where event_id = $2")
        .bind(id).bind(src).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_outcomes(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from event_otf_outcomes where event_id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn copy_outcomes(ex: impl sqlx::PgExecutor<'_>, id: Uuid, src: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("insert into event_otf_outcomes (event_id, outcome_id)
                 select $1, outcome_id from event_otf_outcomes where event_id = $2")
        .bind(id).bind(src).execute(ex).await?;
    Ok(())
}

#[expect(clippy::too_many_arguments)]
pub(crate) async fn upsert_fields(
    ex: impl sqlx::PgExecutor<'_>, id: Uuid, purpose: Option<String>, end_time: Option<NaiveTime>,
    advisor: Option<String>, age_group: Option<String>, outcomes: Option<String>, layout_notes: Option<String>,
    av_notes: Option<String>, tech_notes: Option<String>, host_notes: Option<String>, care_notes: Option<String>, other_notes: Option<String>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into event_otf (event_id, purpose, end_time, advisor, age_group, outcomes,
                                layout_notes, av_notes, tech_notes, host_notes, care_notes, other_notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (event_id) do update set
           purpose = excluded.purpose, end_time = excluded.end_time, advisor = excluded.advisor,
           age_group = excluded.age_group, outcomes = excluded.outcomes,
           layout_notes = excluded.layout_notes, av_notes = excluded.av_notes,
           tech_notes = excluded.tech_notes, host_notes = excluded.host_notes,
           care_notes = excluded.care_notes, other_notes = excluded.other_notes, updated_at = now()")
        .bind(id).bind(purpose).bind(end_time).bind(advisor).bind(age_group)
        .bind(outcomes).bind(layout_notes).bind(av_notes).bind(tech_notes).bind(host_notes).bind(care_notes).bind(other_notes)
        .execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_item(ex: impl sqlx::PgExecutor<'_>, id: Uuid, item: &str, quantity: Option<i32>) -> Result<(), sqlx::Error> {
    sqlx::query("insert into event_otf_items (event_id, item, quantity) values ($1, $2, $3)
                     on conflict do nothing")
        .bind(id).bind(item).bind(quantity).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_contact(ex: impl sqlx::PgExecutor<'_>, id: Uuid, contact: Uuid, position: i16) -> Result<(), sqlx::Error> {
    sqlx::query("insert into event_otf_contacts (event_id, user_id, position) values ($1, $2, $3)
                     on conflict do nothing")
        .bind(id).bind(contact).bind(position).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_outcome(ex: impl sqlx::PgExecutor<'_>, id: Uuid, outcome: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("insert into event_otf_outcomes (event_id, outcome_id) values ($1, $2)
                     on conflict do nothing")
        .bind(id).bind(outcome).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_review(ex: impl sqlx::PgExecutor<'_>, id: Uuid, edited: bool, reviewed: bool) -> Result<(), sqlx::Error> {
    sqlx::query("update event_otf set edited = $2, needs_review = not $3 where event_id = $1")
        .bind(id).bind(edited).bind(reviewed).execute(ex).await?;
    Ok(())
}

pub(crate) async fn list_contact_details(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<ContactRow>, sqlx::Error> {
    sqlx::query_as(
        "select u.name, u.phone from event_otf_contacts c join users u on u.id = c.user_id
          where c.event_id = $1 order by c.position")
        .bind(id).fetch_all(ex).await
}
