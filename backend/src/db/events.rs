//! events veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use uuid::Uuid;
use crate::models::enums::{EventStatus, MaterialType, Priority, RecordKind, WidgetType};

/// Liste ve ayrinti AYNI satiri dondurur. `record_ids` = kayit widget'larinin
/// kayitlari (ikiz HARIC: ikiz widget olamaz).
macro_rules! event_cols {
    () => {
        "e.id, e.record_id, e.title, e.kind_id, e.status, e.priority, e.owner_id, e.date,
         to_char(e.start_time, 'HH24:MI') as start_time, e.location_id, e.place, e.attendees, e.description,
         e.created_by, e.created_at, e.updated_at,
         coalesce((select array_agg(w.record_id order by w.position) from event_widgets w
                    where w.event_id = e.id and w.record_id is not null), '{}') as record_ids"
    };
}

#[derive(sqlx::FromRow)]
pub(crate) struct EventRow {
    pub(crate) id: Uuid,
    pub(crate) record_id: Uuid,
    pub(crate) title: String,
    pub(crate) kind_id: Uuid,
    pub(crate) status: EventStatus,
    pub(crate) priority: Priority,
    pub(crate) owner_id: Option<Uuid>,
    pub(crate) date: Option<NaiveDate>,
    pub(crate) start_time: Option<String>,
    pub(crate) location_id: Option<Uuid>,
    pub(crate) place: Option<String>,
    pub(crate) attendees: Option<i32>,
    pub(crate) description: Option<String>,
    pub(crate) created_by: Option<Uuid>,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
    pub(crate) record_ids: Vec<Uuid>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct CheckpointRequest {
    pub(crate) id: Uuid,
    pub(crate) checkpoint_id: Uuid,
    pub(crate) user_id: Uuid,
    pub(crate) action: String,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct Participant {
    pub(crate) user_id: Uuid,
    pub(crate) role: Option<String>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct Checkpoint {
    pub(crate) id: Uuid,
    pub(crate) label: String,
    pub(crate) date: Option<NaiveDate>,
    pub(crate) done: bool,
}

#[derive(sqlx::FromRow)]
pub(crate) struct Widget {
    pub(crate) id: Uuid,
    pub(crate) kind: WidgetType,
    pub(crate) record_id: Option<Uuid>,
}

/// `materials` sutunlari, `m` takma adiyla (etkinlik ayrintisi ve maliye ayni satiri okur).
macro_rules! material_cols {
    () => {
        "m.id, m.name, m.notes, m.type as kind, m.priority, m.state, m.qty, m.has_sponsor, m.owned,
         m.chosen_provider_id, m.sponsor_chosen, m.sponsor_qty, m.sponsor_date, m.in_sponsor_record,
         m.delivered, m.purchased, m.purchased_at, m.created_by, m.updated_at,
         m.budget::float8 as budget, m.overage_ln"
    };
}

#[derive(sqlx::FromRow)]
pub(crate) struct MaterialRow {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) notes: Option<String>,
    pub(crate) kind: MaterialType,
    pub(crate) priority: Priority,
    pub(crate) state: i16,
    pub(crate) qty: i32,
    pub(crate) has_sponsor: bool,
    pub(crate) owned: bool,
    pub(crate) chosen_provider_id: Option<Uuid>,
    pub(crate) sponsor_chosen: bool,
    pub(crate) sponsor_qty: Option<i32>,
    pub(crate) sponsor_date: Option<NaiveDate>,
    pub(crate) in_sponsor_record: bool,
    pub(crate) delivered: bool,
    pub(crate) purchased: bool,
    pub(crate) purchased_at: Option<DateTime<Utc>>,
    pub(crate) created_by: Option<Uuid>,
    pub(crate) updated_at: DateTime<Utc>,
    pub(crate) budget: Option<f64>,
    pub(crate) overage_ln: Option<f64>,
}

pub(crate) async fn find_event(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<EventRow>, sqlx::Error> {
    sqlx::query_as(concat!("select ", event_cols!(), " from events e where e.id = $1"))
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn list_events(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<EventRow>, sqlx::Error> {
    sqlx::query_as(concat!(
        "select ", event_cols!(), " from events e order by e.date nulls last, e.created_at limit 1000"))
        .fetch_all(ex).await
}

pub(crate) async fn list_participants(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<Participant>, sqlx::Error> {
    sqlx::query_as(
        "select user_id, role from event_participants where event_id = $1 order by added_at")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn list_team_ids(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "select et.team_id from event_teams et join teams t on t.id = et.team_id
          where et.event_id = $1 order by t.name")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn list_checkpoints(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<Checkpoint>, sqlx::Error> {
    sqlx::query_as(
        "select c.id, c.label, coalesce(c.due_date, e.date + c.offset_days::int) as date,
                c.done_at is not null as done
           from event_checkpoints c join events e on e.id = c.event_id
          where c.event_id = $1
          order by (c.done_at is null), c.done_at,
                   coalesce(c.due_date, e.date + c.offset_days::int) nulls last, c.position")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn list_requests(ex: impl sqlx::PgExecutor<'_>, id: Uuid, can_approve: bool, user: Uuid) -> Result<Vec<CheckpointRequest>, sqlx::Error> {
    sqlx::query_as(
        "select r.id, r.checkpoint_id, r.user_id, r.action, r.created_at
           from event_checkpoint_requests r join event_checkpoints c on c.id = r.checkpoint_id
          where c.event_id = $1 and ($2 or r.user_id = $3) order by r.created_at")
        .bind(id).bind(can_approve).bind(user).fetch_all(ex).await
}

pub(crate) async fn list_widgets(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<Widget>, sqlx::Error> {
    sqlx::query_as(
        "select id, widget_type as kind, record_id from event_widgets where event_id = $1 order by position")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn list_event_materials(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<MaterialRow>, sqlx::Error> {
    sqlx::query_as(concat!(
        "select ", material_cols!(), " from materials m
           join event_materials em on em.material_id = m.id
          where em.event_id = $1 order by m.created_at, m.id"))
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn insert_chat(ex: impl sqlx::PgExecutor<'_>) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar("insert into chats default values returning id").fetch_one(ex).await
}

pub(crate) async fn insert_record(
    ex: impl sqlx::PgExecutor<'_>, unit: Uuid, chat: Uuid, kind: RecordKind, title: &str, priority: Priority, by: Uuid,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into records (unit_id, chat_id, kind, title, priority, owner_id, created_by)
         values ($1, $2, $3, $4, $5, $6, $6) returning id")
        .bind(unit).bind(chat).bind(kind).bind(title).bind(priority).bind(by).fetch_one(ex).await
}

#[expect(clippy::too_many_arguments)]
pub(crate) async fn insert_event(
    ex: impl sqlx::PgExecutor<'_>, record: Uuid, title: &str, kind: Uuid, status: EventStatus, priority: Priority,
    by: Uuid, date: Option<NaiveDate>, description: Option<&str>,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into events (record_id, title, kind_id, status, priority, owner_id, date, created_by, description)
         values ($1, $2, $3, $4, $5, $6, $7, $6, $8) returning id")
        .bind(record).bind(title).bind(kind).bind(status).bind(priority).bind(by).bind(date).bind(description).fetch_one(ex).await
}

pub(crate) async fn insert_participant(ex: impl sqlx::PgExecutor<'_>, id: Uuid, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("insert into event_participants (event_id, user_id) values ($1, $2)")
        .bind(id).bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_template_widget(ex: impl sqlx::PgExecutor<'_>, id: Uuid, kind: WidgetType, position: i16) -> Result<(), sqlx::Error> {
    sqlx::query("insert into event_widgets (event_id, widget_type, position) values ($1, $2, $3)
                     on conflict do nothing")
        .bind(id).bind(kind).bind(position).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_template_checkpoint(ex: impl sqlx::PgExecutor<'_>, id: Uuid, label: &str, offset: i16, position: i16) -> Result<(), sqlx::Error> {
    sqlx::query(
            "insert into event_checkpoints (event_id, label, offset_days, position) values ($1, $2, $3, $4)")
        .bind(id).bind(label).bind(offset).bind(position).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_title(ex: impl sqlx::PgExecutor<'_>, id: Uuid, title: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update events set title = $2, updated_at = now() where id = $1").bind(id).bind(title).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_record_title(ex: impl sqlx::PgExecutor<'_>, id: Uuid, title: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update records set title = $2 where id = $1").bind(id).bind(title).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_status(ex: impl sqlx::PgExecutor<'_>, id: Uuid, status: EventStatus) -> Result<(), sqlx::Error> {
    sqlx::query("update events set status = $2, updated_at = now() where id = $1").bind(id).bind(status).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_priority(ex: impl sqlx::PgExecutor<'_>, id: Uuid, priority: Priority) -> Result<(), sqlx::Error> {
    sqlx::query("update events set priority = $2, updated_at = now() where id = $1").bind(id).bind(priority).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_record_priority(ex: impl sqlx::PgExecutor<'_>, id: Uuid, priority: Priority) -> Result<(), sqlx::Error> {
    sqlx::query("update records set priority = $2 where id = $1").bind(id).bind(priority).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_owner(ex: impl sqlx::PgExecutor<'_>, id: Uuid, owner: Option<Uuid>) -> Result<(), sqlx::Error> {
    sqlx::query("update events set owner_id = $2, updated_at = now() where id = $1").bind(id).bind(owner).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_record_owner(ex: impl sqlx::PgExecutor<'_>, id: Uuid, owner: Option<Uuid>) -> Result<(), sqlx::Error> {
    sqlx::query("update records set owner_id = $2 where id = $1").bind(id).bind(owner).execute(ex).await?;
    Ok(())
}

pub(crate) async fn fix_checkpoint_dates(ex: impl sqlx::PgExecutor<'_>, id: Uuid, old: NaiveDate) -> Result<(), sqlx::Error> {
    sqlx::query(
                    "update event_checkpoints set due_date = $2 + offset_days::int, offset_days = null
                      where event_id = $1 and done_at is not null and offset_days is not null")
        .bind(id).bind(old).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_date(ex: impl sqlx::PgExecutor<'_>, id: Uuid, date: Option<NaiveDate>) -> Result<(), sqlx::Error> {
    sqlx::query("update events set date = $2,
                    start_time = case when $2::date is null then null else start_time end,
                    updated_at = now() where id = $1")
        .bind(id).bind(date).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_start_time(ex: impl sqlx::PgExecutor<'_>, id: Uuid, time: Option<NaiveTime>) -> Result<(), sqlx::Error> {
    sqlx::query("update events set start_time = $2, updated_at = now() where id = $1").bind(id).bind(time).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_location(ex: impl sqlx::PgExecutor<'_>, id: Uuid, location: Option<Uuid>) -> Result<(), sqlx::Error> {
    sqlx::query("update events set location_id = $2,
                    place = case when $2::uuid is null then place end, updated_at = now() where id = $1")
        .bind(id).bind(location).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_place(ex: impl sqlx::PgExecutor<'_>, id: Uuid, place: Option<&str>) -> Result<(), sqlx::Error> {
    sqlx::query("update events set place = $2,
                    location_id = case when $2::text is null then location_id end, updated_at = now() where id = $1")
        .bind(id).bind(place).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_attendees(ex: impl sqlx::PgExecutor<'_>, id: Uuid, attendees: Option<i32>) -> Result<(), sqlx::Error> {
    sqlx::query("update events set attendees = $2, updated_at = now() where id = $1").bind(id).bind(attendees).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_description(ex: impl sqlx::PgExecutor<'_>, id: Uuid, description: Option<&str>) -> Result<(), sqlx::Error> {
    sqlx::query("update events set description = $2, updated_at = now() where id = $1").bind(id).bind(description).execute(ex).await?;
    Ok(())
}

pub(crate) async fn upsert_participant(ex: impl sqlx::PgExecutor<'_>, id: Uuid, user: Uuid, role: Option<String>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into event_participants (event_id, user_id, role) values ($1, $2, $3)
         on conflict (event_id, user_id) do update set role = excluded.role")
        .bind(id).bind(user).bind(role).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_record_participant(ex: impl sqlx::PgExecutor<'_>, id: Uuid, user: Uuid, by: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into record_participants (record_id, user_id, added_by) values ($1, $2, $3)
         on conflict do nothing")
        .bind(id).bind(user).bind(by).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_participant(ex: impl sqlx::PgExecutor<'_>, id: Uuid, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from event_participants where event_id = $1 and user_id = $2")
        .bind(id).bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_record_participant(ex: impl sqlx::PgExecutor<'_>, id: Uuid, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from record_participants where record_id = $1 and user_id = $2")
        .bind(id).bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_team(ex: impl sqlx::PgExecutor<'_>, id: Uuid, team: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("insert into event_teams (event_id, team_id) values ($1, $2) on conflict do nothing")
        .bind(id).bind(team).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_team(ex: impl sqlx::PgExecutor<'_>, id: Uuid, team: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from event_teams where event_id = $1 and team_id = $2")
        .bind(id).bind(team).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_checkpoint(ex: impl sqlx::PgExecutor<'_>, id: Uuid, label: String, date: Option<NaiveDate>, offset: i16) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into event_checkpoints (event_id, label, due_date, offset_days, position)
         values ($1, $2, $3, case when $3::date is null then $4 end,
                 (select coalesce(max(position) + 1, 0) from event_checkpoints where event_id = $1))")
        .bind(id).bind(label).bind(date).bind(offset).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_checkpoint_event(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select event_id from event_checkpoints where id = $1").bind(id).fetch_optional(ex).await
}

pub(crate) async fn set_checkpoint_done(ex: impl sqlx::PgExecutor<'_>, id: Uuid, done: bool) -> Result<(), sqlx::Error> {
    sqlx::query(
            "update event_checkpoints set done_at = case when $2 then coalesce(done_at, now()) end where id = $1")
        .bind(id).bind(done).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_checkpoint_action_requests(ex: impl sqlx::PgExecutor<'_>, id: Uuid, action: &str) -> Result<(), sqlx::Error> {
    sqlx::query("delete from event_checkpoint_requests where checkpoint_id = $1 and action = $2")
        .bind(id).bind(action).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_checkpoint_date(ex: impl sqlx::PgExecutor<'_>, id: Uuid, date: Option<NaiveDate>, offset: i16) -> Result<(), sqlx::Error> {
    sqlx::query(
            "update event_checkpoints set due_date = $2, offset_days = case when $2::date is null then $3 end
              where id = $1")
        .bind(id).bind(date).bind(offset).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_checkpoint(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from event_checkpoints where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn load_checkpoint_state(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(String, bool), sqlx::Error> {
    sqlx::query_as(
        "select label, done_at is not null from event_checkpoints where id = $1")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn insert_checkpoint_request(ex: impl sqlx::PgExecutor<'_>, id: Uuid, user: Uuid, action: &str) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "insert into event_checkpoint_requests (checkpoint_id, user_id, action) values ($1, $2, $3)
         on conflict do nothing")
        .bind(id).bind(user).bind(action).execute(ex).await?.rows_affected())
}

#[derive(sqlx::FromRow)]
pub(crate) struct RequestResolution {
    pub(crate) checkpoint_id: Uuid,
    pub(crate) action: String,
    pub(crate) event_id: Uuid,
    pub(crate) label: String,
}

pub(crate) async fn find_request_resolution(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<RequestResolution>, sqlx::Error> {
    sqlx::query_as(
        "select r.checkpoint_id, r.action, c.event_id, c.label
           from event_checkpoint_requests r join event_checkpoints c on c.id = r.checkpoint_id
          where r.id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn approve_checkpoint_done(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
                "update event_checkpoints set done_at = coalesce(done_at, now()) where id = $1")
        .bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn approve_checkpoint_undone(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update event_checkpoints set done_at = null where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_resolved_requests(ex: impl sqlx::PgExecutor<'_>, id: Uuid, approve: bool, cid: Uuid, action: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "delete from event_checkpoint_requests where id = $1 or ($2 and checkpoint_id = $3 and action = $4)")
        .bind(id).bind(approve).bind(cid).bind(action).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_widget(ex: impl sqlx::PgExecutor<'_>, id: Uuid, kind: WidgetType, record: Option<Uuid>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into event_widgets (event_id, widget_type, record_id, position)
         values ($1, $2, $3, (select coalesce(max(position) + 1, 0) from event_widgets where event_id = $1))
         on conflict do nothing")
        .bind(id).bind(kind).bind(record).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_widget_owner(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(Uuid, WidgetType)>, sqlx::Error> {
    sqlx::query_as(
        "select event_id, widget_type from event_widgets where id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn delete_widget(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from event_widgets where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_material(ex: impl sqlx::PgExecutor<'_>, name: String, notes: Option<String>, by: Uuid, origin: &str) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into materials (name, notes, created_by, origin) values ($1, $2, $3, $4) returning id")
        .bind(name).bind(notes).bind(by).bind(origin).fetch_one(ex).await
}

pub(crate) async fn insert_event_material(ex: impl sqlx::PgExecutor<'_>, material: Uuid, event: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("insert into event_materials (material_id, event_id) values ($1, $2)")
        .bind(material).bind(event).execute(ex).await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
pub(crate) struct ProviderRow {
    pub(crate) id: Uuid,
    pub(crate) material_id: Uuid,
    pub(crate) contact: String,
    pub(crate) name: Option<String>,
    pub(crate) price: Option<f64>,
    pub(crate) arrival_date: Option<NaiveDate>,
}

pub(crate) async fn list_providers(ex: impl sqlx::PgExecutor<'_>, ids: &[Uuid]) -> Result<Vec<ProviderRow>, sqlx::Error> {
    sqlx::query_as(
        "select id, material_id, contact, name, price::float8 as price, arrival_date
           from material_providers where material_id = any($1) order by price nulls last, id")
        .bind(ids).fetch_all(ex).await
}

pub(crate) async fn list_overage_bases(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<(DateTime<Utc>, f64)>, sqlx::Error> {
    sqlx::query_as(
        "select effective_from, yellow_max_ln from overage_base order by effective_from")
        .fetch_all(ex).await
}

pub(crate) async fn list_material_by_id(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<MaterialRow>, sqlx::Error> {
    sqlx::query_as(concat!("select ", material_cols!(), " from materials m where m.id = $1"))
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn set_overage(ex: impl sqlx::PgExecutor<'_>, material: Uuid, ln: Option<f64>) -> Result<(), sqlx::Error> {
    sqlx::query("update materials set overage_ln = $2 where id = $1")
        .bind(material).bind(ln).execute(ex).await?;
    Ok(())
}

pub(crate) async fn load_purchased(ex: impl sqlx::PgExecutor<'_>, material: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select purchased from materials where id = $1").bind(material).fetch_one(ex).await
}

pub(crate) async fn find_material_event(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(Option<Uuid>,)>, sqlx::Error> {
    sqlx::query_as(
        "select (select event_id from event_materials where material_id = m.id) from materials m where m.id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn lock_material(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<MaterialRow, sqlx::Error> {
    sqlx::query_as(concat!("select ", material_cols!(), " from materials m where m.id = $1 for update"))
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn provider_belongs_to_material(ex: impl sqlx::PgExecutor<'_>, pid: Uuid, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from material_providers where id = $1 and material_id = $2)")
        .bind(pid).bind(id).fetch_one(ex).await
}

#[expect(clippy::too_many_arguments)]
pub(crate) async fn update_material(
    ex: impl sqlx::PgExecutor<'_>, id: Uuid, name: &str, notes: Option<&str>, kind: MaterialType, priority: Priority,
    state: i16, qty: i32, owned: bool, has_sponsor: bool, chosen_provider: Option<Uuid>, sponsor_chosen: bool,
    sponsor_qty: Option<i32>, sponsor_date: Option<NaiveDate>, in_sponsor_record: bool, delivered: bool,
    budget: Option<f64>, overage_ln: Option<f64>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update materials set name = $2, notes = $3, type = $4, priority = $5, state = $6, qty = $7,
                owned = $8, has_sponsor = $9, chosen_provider_id = $10, sponsor_chosen = $11,
                sponsor_qty = $12, sponsor_date = $13, in_sponsor_record = $14, delivered = $15,
                budget = round($16::numeric, 2), overage_ln = $17, updated_at = now()
          where id = $1")
        .bind(id).bind(name).bind(notes).bind(kind).bind(priority).bind(state).bind(qty)
        .bind(owned).bind(has_sponsor).bind(chosen_provider).bind(sponsor_chosen)
        .bind(sponsor_qty).bind(sponsor_date).bind(in_sponsor_record).bind(delivered)
        .bind(budget).bind(overage_ln).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_material(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from materials where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_provider(
    ex: impl sqlx::PgExecutor<'_>, id: Uuid, contact: String, name: Option<String>, price: Option<f64>, date: Option<NaiveDate>, vendor: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into material_providers (material_id, contact, name, price, arrival_date, vendor_id)
         values ($1, $2, $3, round($4::numeric, 2), $5, $6)")
        .bind(id).bind(contact).bind(name).bind(price).bind(date).bind(vendor).execute(ex).await?;
    Ok(())
}

pub(crate) async fn touch_material(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update materials set updated_at = now() where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_provider(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from material_providers where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_provider_owner(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(Uuid, Option<Uuid>)>, sqlx::Error> {
    sqlx::query_as(
        "select p.material_id, (select em.event_id from event_materials em where em.material_id = p.material_id)
           from material_providers p where p.id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn patch_provider(
    ex: impl sqlx::PgExecutor<'_>, id: Uuid, contact: Option<String>, name: Option<Option<String>>,
    price: Option<Option<f64>>, arrival_date: Option<Option<NaiveDate>>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update material_providers set
            contact = coalesce($2, contact),
            name = case when $3 then $4::text else name end,
            price = case when $5 then round($6::numeric, 2) else price end,
            arrival_date = case when $7 then $8 else arrival_date end
          where id = $1")
        .bind(id).bind(contact)
        .bind(name.is_some()).bind(name.flatten())
        .bind(price.is_some()).bind(price.flatten())
        .bind(arrival_date.is_some()).bind(arrival_date.flatten())
        .execute(ex).await?;
    Ok(())
}

pub(crate) async fn load_provider_label(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(Option<String>, String), sqlx::Error> {
    sqlx::query_as("select name, contact from material_providers where id = $1").bind(id).fetch_one(ex).await
}

pub(crate) async fn set_provider_vendor(ex: impl sqlx::PgExecutor<'_>, id: Uuid, vendor: Option<Uuid>) -> Result<(), sqlx::Error> {
    sqlx::query("update material_providers set vendor_id = $2 where id = $1").bind(id).bind(vendor).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_purchase_state(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(i16, bool)>, sqlx::Error> {
    sqlx::query_as("select state, owned from materials where id = $1").bind(id).fetch_optional(ex).await
}

pub(crate) async fn set_purchased(ex: impl sqlx::PgExecutor<'_>, id: Uuid, purchased: bool, by: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update materials set purchased = $2,
                purchased_at = case when $2 then now() end,
                purchased_by = case when $2 then $3::uuid end,
                updated_at = now()
          where id = $1")
        .bind(id).bind(purchased).bind(by).execute(ex).await?;
    Ok(())
}
