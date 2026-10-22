//! notify veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, Utc};
use uuid::Uuid;
use crate::models::enums::NotifyLevel;

#[derive(sqlx::FromRow)]
pub(crate) struct NoticeRow {
    pub kind: String,
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub chat_id: Uuid,
    pub actor_id: Option<Uuid>,
    pub verb: Option<String>,
    pub subject_label: Option<String>,
    pub target_label: Option<String>,
    pub body: Option<String>,
    pub record_id: Option<Uuid>,
    pub team_id: Option<Uuid>,
    pub title: String,
}

#[derive(sqlx::FromRow)]
pub(crate) struct SubscriptionRow {
    pub id: Uuid,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
}

pub(crate) async fn get_preferences(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<(NotifyLevel, Option<i16>, Option<i16>), sqlx::Error> {
    sqlx::query_as("select notify_level, quiet_start, quiet_end from users where id = $1")
        .bind(user).fetch_one(ex).await
}

pub(crate) async fn list_chat_preferences(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Vec<(Uuid, NotifyLevel)>, sqlx::Error> {
    sqlx::query_as("select chat_id, mode from chat_prefs where user_id = $1")
        .bind(user).fetch_all(ex).await
}

pub(crate) async fn get_seen_at(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<DateTime<Utc>, sqlx::Error> {
    sqlx::query_scalar("select notifications_seen_at from users where id = $1").bind(user).fetch_one(ex).await
}

pub(crate) async fn list_notices(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Vec<NoticeRow>, sqlx::Error> {
    sqlx::query_as(
        "with mine as (
           select r.chat_id, r.id as record_id, null::uuid as team_id, r.title
             from records r
            where r.owner_id = $1 or r.created_by = $1
               or exists(select 1 from record_participants p
                          where p.record_id = r.id and p.user_id = $1)
               or exists(select 1 from actions a join action_assignees x on x.action_id = a.id
                          where a.record_id = r.id and x.user_id = $1)
               or r.team_id in (select team_id from team_members where user_id = $1)
           union all
           select t.chat_id, null, t.id, t.name
             from teams t join team_members m on m.team_id = t.id and m.user_id = $1
         )
         select f.kind, f.id, f.created_at, f.chat_id, f.actor_id, f.verb, f.subject_label,
                f.target_label, f.body, mine.record_id, mine.team_id, mine.title
           from chat_feed f join mine on mine.chat_id = f.chat_id
          where f.actor_id is distinct from $1
          order by f.created_at desc limit 240")
        .bind(user).fetch_all(ex).await
}

pub(crate) async fn mark_seen(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update users set notifications_seen_at = now() where id = $1").bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn update_preferences(ex: impl sqlx::PgExecutor<'_>, user: Uuid, level: NotifyLevel, start: Option<i16>, end: Option<i16>) -> Result<(), sqlx::Error> {
    sqlx::query("update users set notify_level = $2, quiet_start = $3, quiet_end = $4 where id = $1")
        .bind(user).bind(level).bind(start).bind(end).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_chat(ex: impl sqlx::PgExecutor<'_>, chat: Uuid) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar("select 1 from chats where id = $1").bind(chat).fetch_optional(ex).await
}

pub(crate) async fn upsert_chat_preference(ex: impl sqlx::PgExecutor<'_>, user: Uuid, chat: Uuid, mode: NotifyLevel) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into chat_prefs (user_id, chat_id, mode) values ($1, $2, $3)
                 on conflict (user_id, chat_id) do update set mode = excluded.mode")
        .bind(user).bind(chat).bind(mode).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_chat_preference(ex: impl sqlx::PgExecutor<'_>, user: Uuid, chat: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from chat_prefs where user_id = $1 and chat_id = $2").bind(user).bind(chat).execute(ex).await?;
    Ok(())
}

pub(crate) async fn upsert_subscription(ex: impl sqlx::PgExecutor<'_>, user: Uuid, endpoint: &str, p256dh: &str, auth: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)
         on conflict (endpoint) do update
           set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth")
        .bind(user).bind(endpoint).bind(p256dh).bind(auth).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_user_subscription(ex: impl sqlx::PgExecutor<'_>, user: Uuid, endpoint: &str) -> Result<(), sqlx::Error> {
    sqlx::query("delete from push_subscriptions where user_id = $1 and endpoint = $2")
        .bind(user).bind(endpoint).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_record_audience(ex: impl sqlx::PgExecutor<'_>, chat: Uuid) -> Result<Option<(Uuid, String, Vec<Uuid>)>, sqlx::Error> {
    sqlx::query_as(
        "select r.id, r.title, array(
                  select r.owner_id where r.owner_id is not null
                  union select r.created_by
                  union select user_id from record_participants where record_id = r.id
                  union select x.user_id from actions a join action_assignees x on x.action_id = a.id
                         where a.record_id = r.id
                  union select user_id from team_members where team_id = r.team_id)
           from records r where r.chat_id = $1")
        .bind(chat).fetch_optional(ex).await
}

pub(crate) async fn find_team_audience(ex: impl sqlx::PgExecutor<'_>, chat: Uuid) -> Result<Option<(Uuid, String, Vec<Uuid>)>, sqlx::Error> {
    sqlx::query_as(
        "select t.id, t.name, array(select user_id from team_members where team_id = t.id)
                   from teams t where t.chat_id = $1")
        .bind(chat).fetch_optional(ex).await
}

pub(crate) async fn get_user_name(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("select name from users where id = $1").bind(user).fetch_one(ex).await
}

pub(crate) async fn find_active_user_name(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("select name from users where id = $1 and is_active").bind(user).fetch_optional(ex).await
}

pub(crate) async fn list_subscriptions(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Vec<SubscriptionRow>, sqlx::Error> {
    sqlx::query_as("select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1")
        .bind(user).fetch_all(ex).await
}

pub(crate) async fn mark_subscription_ok(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update push_subscriptions set last_ok_at = now(), fail_count = 0 where id = $1")
        .bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_subscription(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from push_subscriptions where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn increment_subscription_failures(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update push_subscriptions set fail_count = fail_count + 1 where id = $1")
        .bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_failed_subscription(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from push_subscriptions where id = $1 and fail_count >= 5").bind(id).execute(ex).await?;
    Ok(())
}
