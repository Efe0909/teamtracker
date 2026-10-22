//! records veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use crate::{db::{filters::Filters, tree::TreeIndex}, models::{enums::{ActionStatus, Priority, RecordKind, RecordStatus}, user::User}};

pub(crate) async fn find_record(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<crate::models::record::Record>, sqlx::Error> {
    sqlx::query_as(
        "select id, unit_id, pillar_id, team_id, chat_id, kind, title, description,
                    status, priority, owner_id, created_by, due_date, created_at, updated_at,
                    closing_note
               from records where id = $1")
        .bind(id).fetch_optional(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct SummaryRow {
    pub id: Uuid,
    pub kind: RecordKind,
    pub title: String,
    pub status: RecordStatus,
    pub priority: Priority,
    pub unit_id: Uuid,
    pub pillar_id: Option<Uuid>,
    pub team_id: Option<Uuid>,
    pub owner_id: Option<Uuid>,
    pub due_date: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub open_actions: i64,
    pub action_overdue: bool,
    pub messages: i64,
    pub event_id: Option<Uuid>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct JoinRequestRow {
    pub user_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct ActionOutRow {
    pub id: Uuid,
    pub title: String,
    pub status: ActionStatus,
    pub owner_ids: Vec<Uuid>,
    pub due_date: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub closing_note: Option<String>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct ActionRow {
    pub id: Uuid,
    pub record_id: Uuid,
    pub title: String,
    pub status: ActionStatus,
    pub owner_ids: Vec<Uuid>,
    pub due_date: Option<NaiveDate>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct MyActionRow {
    pub id: Uuid,
    pub title: String,
    pub status: ActionStatus,
    pub due_date: Option<NaiveDate>,
    pub record_id: Uuid,
    pub record_title: String,
}

// Agac kilidi `.await` uzerinden tasinmasin: sorgu kurma ve calistirma ayri.
pub(crate) fn build_list(f: &Filters, me: &User, tree: &TreeIndex, pinned: bool, limit: i64) -> QueryBuilder<Postgres> {
    let mut qb = QueryBuilder::<Postgres>::new(
        "select r.id, r.kind, r.title, r.status, r.priority, r.unit_id, r.pillar_id,
                r.team_id, r.owner_id, r.due_date, r.created_at, r.updated_at,
                (select count(*) from actions a
                  where a.record_id = r.id and a.status in ('open','in_progress')) as open_actions,
                exists(select 1 from actions a
                  where a.record_id = r.id and a.status in ('open','in_progress')
                    and a.due_date < current_date) as action_overdue,
                (select count(*) from messages m where m.chat_id = r.chat_id) as messages,
                (select e.id from events e where e.record_id = r.id) as event_id
           from records r");
    f.push_where(&mut qb, me, tree);
    if pinned {
        qb.push(" and exists(select 1 from record_pins p where p.record_id = r.id and p.user_id = ")
            .push_bind(me.id).push(")");
    }
    qb.push(f.order_by()).push(" limit ").push_bind(limit);
    qb
}

pub(crate) async fn list_records(ex: impl sqlx::PgExecutor<'_>, mut qb: QueryBuilder<Postgres>) -> Result<Vec<SummaryRow>, sqlx::Error> {
    qb.build_query_as().fetch_all(ex).await
}

pub(crate) async fn get_access_mode(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("select access_mode from records where id = $1").bind(id).fetch_one(ex).await
}

pub(crate) async fn find_event(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select id from events where record_id = $1").bind(id).fetch_optional(ex).await
}

pub(crate) async fn find_join_status(ex: impl sqlx::PgExecutor<'_>, record: Uuid, user: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("select status from record_join_requests where record_id = $1 and user_id = $2")
        .bind(record).bind(user).fetch_optional(ex).await
}

pub(crate) async fn list_join_requests(ex: impl sqlx::PgExecutor<'_>, record: Uuid) -> Result<Vec<JoinRequestRow>, sqlx::Error> {
    sqlx::query_as(
        "select user_id, created_at from record_join_requests
              where record_id = $1 and status = 'pending' order by created_at")
        .bind(record).fetch_all(ex).await
}

pub(crate) async fn is_pinned(ex: impl sqlx::PgExecutor<'_>, user: Uuid, record: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from record_pins where user_id = $1 and record_id = $2)")
        .bind(user).bind(record).fetch_one(ex).await
}

pub(crate) async fn list_actions(ex: impl sqlx::PgExecutor<'_>, record: Uuid) -> Result<Vec<ActionOutRow>, sqlx::Error> {
    sqlx::query_as(
        "select a.id, a.title, a.status,
                array(select x.user_id from action_assignees x where x.action_id = a.id
                       order by x.added_at, x.user_id) as owner_ids,
                a.due_date, a.created_at, a.resolved_at, a.closing_note
           from actions a where a.record_id = $1
          order by (a.status in ('closed','cancelled')), a.created_at")
        .bind(record).fetch_all(ex).await
}

pub(crate) async fn list_participants(ex: impl sqlx::PgExecutor<'_>, record: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select user_id from record_participants where record_id = $1 order by added_at")
        .bind(record).fetch_all(ex).await
}

pub(crate) async fn find_card_order(ex: impl sqlx::PgExecutor<'_>, user: Uuid, record: Uuid) -> Result<Option<Vec<Uuid>>, sqlx::Error> {
    sqlx::query_scalar("select card_ids from card_order where user_id = $1 and record_id = $2")
        .bind(user).bind(record).fetch_optional(ex).await
}

pub(crate) async fn insert_action_participants(ex: impl sqlx::PgExecutor<'_>, record: Uuid, owners: &[Uuid], actor: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into record_participants (record_id, user_id, added_by)
         select $1, u, $3 from unnest($2::uuid[]) as u
         on conflict do nothing")
        .bind(record).bind(owners).bind(actor).execute(ex).await?;
    Ok(())
}

pub(crate) async fn count_active_users(ex: impl sqlx::PgExecutor<'_>, ids: &[Uuid]) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("select count(*) from users where id = any($1) and is_active").bind(ids).fetch_one(ex).await
}

pub(crate) async fn set_action_owners(c: &mut sqlx::PgConnection, action: Uuid, owners: &[Uuid], actor: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from action_assignees where action_id = $1 and user_id <> all($2)")
        .bind(action).bind(owners).execute(&mut *c).await?;
    sqlx::query(
        "insert into action_assignees (action_id, user_id, added_by)
         select $1, u, $3 from unnest($2::uuid[]) as u
         on conflict do nothing")
        .bind(action).bind(owners).bind(actor).execute(&mut *c).await?;
    Ok(())
}

pub(crate) async fn find_active_user(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar("select 1 from users where id = $1 and is_active").bind(id).fetch_optional(ex).await
}

pub(crate) async fn find_team(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar("select 1 from teams where id = $1").bind(id).fetch_optional(ex).await
}

pub(crate) async fn find_active_pillar(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar("select 1 from pillars where id = $1 and is_active").bind(id).fetch_optional(ex).await
}

pub(crate) async fn insert_activity(ex: impl sqlx::PgExecutor<'_>, chat: Uuid, actor: Uuid, verb: &str, subject: &str, target: Option<&str>, detail: Option<String>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into activity (chat_id, actor_id, verb, subject_label, target_label, detail)
         values ($1, $2, $3, $4, $5, $6)")
        .bind(chat).bind(actor).bind(verb).bind(subject).bind(target).bind(detail).execute(ex).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_record(
    ex: impl sqlx::PgExecutor<'_>, unit: Uuid, pillar: Option<Uuid>, team: Option<Uuid>, chat: Uuid,
    kind: RecordKind, title: &str, description: Option<String>, priority: Priority, owner: Option<Uuid>, actor: Uuid, access_mode: &str,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into records (unit_id, pillar_id, team_id, chat_id, kind, title, description,
                              priority, owner_id, created_by, access_mode)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id")
        .bind(unit).bind(pillar).bind(team).bind(chat).bind(kind).bind(title).bind(description)
        .bind(priority).bind(owner).bind(actor).bind(access_mode).fetch_one(ex).await
}

pub(crate) async fn count_open_actions(ex: impl sqlx::PgExecutor<'_>, record: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "select count(*) from actions where record_id = $1
                        and status in ('open','in_progress')")
        .bind(record).fetch_one(ex).await
}

pub(crate) async fn lock_field(ex: impl sqlx::PgExecutor<'_>, record: Uuid, field: &str) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar("select to_jsonb(r) -> $2::text from records r where r.id = $1 for update")
        .bind(record).bind(field).fetch_one(ex).await
}

type PgQuery<'q> = sqlx::query::Query<'q, Postgres, sqlx::postgres::PgArguments>;

// JSON dogrulamasi domain'de; burada yalniz sutun tipine gore bind edilir.
fn bind_field_value<'q>(q: PgQuery<'q>, field: &str, (text, id, date): (Option<String>, Option<Uuid>, Option<NaiveDate>)) -> PgQuery<'q> {
    match field {
        "owner_id" | "team_id" | "pillar_id" | "unit_id" => q.bind(id),
        "due_date" => q.bind(date),
        _ => q.bind(text),
    }
}

pub(crate) async fn update_field(ex: impl sqlx::PgExecutor<'_>, record: Uuid, field: &str, value: (Option<String>, Option<Uuid>, Option<NaiveDate>)) -> Result<(), sqlx::Error> {
    let sql = match field {
        "status" => "update records set status = $2 where id = $1",
        "priority" => "update records set priority = $2 where id = $1",
        "owner_id" => "update records set owner_id = $2 where id = $1",
        "team_id" => "update records set team_id = $2 where id = $1",
        "pillar_id" => "update records set pillar_id = $2 where id = $1",
        "unit_id" => "update records set unit_id = $2 where id = $1",
        "due_date" => "update records set due_date = $2 where id = $1",
        "access_mode" => "update records set access_mode = $2 where id = $1",
        "title" => "update records set title = $2 where id = $1",
        "description" => "update records set description = $2 where id = $1",
        _ => return Err(sqlx::Error::Protocol("unknown record field".into())),
    };
    bind_field_value(sqlx::query(sql).bind(record), field, value).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_closing_note(ex: impl sqlx::PgExecutor<'_>, record: Uuid, note: &Option<String>) -> Result<(), sqlx::Error> {
    sqlx::query("update records set closing_note = $2 where id = $1").bind(record).bind(note).execute(ex).await?;
    Ok(())
}

pub(crate) async fn update_event_field(ex: impl sqlx::PgExecutor<'_>, record: Uuid, field: &str, value: (Option<String>, Option<Uuid>, Option<NaiveDate>)) -> Result<(), sqlx::Error> {
    let sql = match field {
        "title" => "update events set title = $2, updated_at = now() where record_id = $1",
        "priority" => "update events set priority = $2, updated_at = now() where record_id = $1",
        "owner_id" => "update events set owner_id = $2, updated_at = now() where record_id = $1",
        _ => return Err(sqlx::Error::Protocol("unknown event field".into())),
    };
    bind_field_value(sqlx::query(sql).bind(record), field, value).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_action(ex: impl sqlx::PgExecutor<'_>, record: Uuid, title: &str, actor: Uuid, due_date: Option<NaiveDate>) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into actions (record_id, title, created_by, due_date)
         values ($1, $2, $3, $4) returning id")
        .bind(record).bind(title).bind(actor).bind(due_date).fetch_one(ex).await
}

pub(crate) async fn find_action(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<ActionRow>, sqlx::Error> {
    sqlx::query_as(
        "select a.id, a.record_id, a.title, a.status,
                array(select x.user_id from action_assignees x where x.action_id = a.id
                       order by x.added_at, x.user_id) as owner_ids,
                a.due_date
           from actions a where a.id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn set_action_status(ex: impl sqlx::PgExecutor<'_>, id: Uuid, status: ActionStatus, done: bool, actor: Uuid, note: &Option<String>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update actions set status = $2,
                        resolved_by = case when $3 then $4 end,
                        resolved_at = case when $3 then now() end,
                        closing_note = $5
                  where id = $1")
        .bind(id).bind(status).bind(done).bind(actor).bind(note).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_action_due_date(ex: impl sqlx::PgExecutor<'_>, id: Uuid, date: Option<NaiveDate>) -> Result<(), sqlx::Error> {
    sqlx::query("update actions set due_date = $2 where id = $1").bind(id).bind(date).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_action_title(ex: impl sqlx::PgExecutor<'_>, id: Uuid, title: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update actions set title = $2 where id = $1").bind(id).bind(title).execute(ex).await?;
    Ok(())
}

pub(crate) async fn touch_record(ex: impl sqlx::PgExecutor<'_>, record: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update records set updated_at = now() where id = $1").bind(record).execute(ex).await?;
    Ok(())
}

pub(crate) async fn list_my_actions(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Vec<MyActionRow>, sqlx::Error> {
    sqlx::query_as(
        "select a.id, a.title, a.status, a.due_date, a.record_id, r.title as record_title
           from actions a join records r on r.id = a.record_id
          where exists(select 1 from action_assignees x where x.action_id = a.id and x.user_id = $1)
            and a.status in ('open','in_progress')
          order by a.due_date nulls last, a.created_at")
        .bind(user).fetch_all(ex).await
}

pub(crate) async fn insert_participant(ex: impl sqlx::PgExecutor<'_>, record: Uuid, user: Uuid, actor: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "insert into record_participants (record_id, user_id, added_by) values ($1, $2, $3)
         on conflict do nothing")
        .bind(record).bind(user).bind(actor).execute(ex).await?.rows_affected())
}

pub(crate) async fn delete_participant(ex: impl sqlx::PgExecutor<'_>, record: Uuid, user: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("delete from record_participants where record_id = $1 and user_id = $2")
        .bind(record).bind(user).execute(ex).await?.rows_affected())
}

pub(crate) async fn insert_pin(ex: impl sqlx::PgExecutor<'_>, user: Uuid, record: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("insert into record_pins (user_id, record_id) values ($1, $2) on conflict do nothing")
        .bind(user).bind(record).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_pin(ex: impl sqlx::PgExecutor<'_>, user: Uuid, record: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from record_pins where user_id = $1 and record_id = $2").bind(user).bind(record).execute(ex).await?;
    Ok(())
}

pub(crate) async fn upsert_card_order(ex: impl sqlx::PgExecutor<'_>, user: Uuid, record: Uuid, ids: &[Uuid]) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into card_order (user_id, record_id, card_ids) values ($1, $2, $3)
         on conflict (user_id, record_id) do update set card_ids = excluded.card_ids")
        .bind(user).bind(record).bind(ids).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_self_participant(ex: impl sqlx::PgExecutor<'_>, record: Uuid, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into record_participants (record_id, user_id, added_by) values ($1, $2, $2)
             on conflict do nothing")
        .bind(record).bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn upsert_join_request(ex: impl sqlx::PgExecutor<'_>, record: Uuid, user: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "insert into record_join_requests (record_id, user_id) values ($1, $2)
             on conflict (record_id, user_id) do update
               set status = 'pending', created_at = now(), decided_by = null
             where record_join_requests.status = 'denied'")
        .bind(record).bind(user).execute(ex).await?.rows_affected())
}

pub(crate) async fn delete_join_request(ex: impl sqlx::PgExecutor<'_>, record: Uuid, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from record_join_requests where record_id = $1 and user_id = $2")
        .bind(record).bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_requester_name(ex: impl sqlx::PgExecutor<'_>, record: Uuid, user: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select u.name from record_join_requests r join users u on u.id = r.user_id
          where r.record_id = $1 and r.user_id = $2 and r.status = 'pending'")
        .bind(record).bind(user).fetch_optional(ex).await
}

pub(crate) async fn insert_approved_participant(ex: impl sqlx::PgExecutor<'_>, record: Uuid, user: Uuid, actor: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into record_participants (record_id, user_id, added_by) values ($1, $2, $3)
             on conflict do nothing")
        .bind(record).bind(user).bind(actor).execute(ex).await?;
    Ok(())
}

pub(crate) async fn deny_join_request(ex: impl sqlx::PgExecutor<'_>, record: Uuid, user: Uuid, actor: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update record_join_requests set status = 'denied', decided_by = $3
              where record_id = $1 and user_id = $2")
        .bind(record).bind(user).bind(actor).execute(ex).await?;
    Ok(())
}
