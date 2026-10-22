//! admin veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;
use crate::models::enums::NotifyLevel;

pub(crate) async fn list_scopes(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("select name from scopes order by name").fetch_all(ex).await
}

pub(crate) async fn list_roles(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<(Uuid, String, String)>, sqlx::Error> {
    sqlx::query_as("select id, name, color from roles order by name").fetch_all(ex).await
}

pub(crate) async fn list_role_scopes(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as("select role_id, scope from role_scopes order by scope").fetch_all(ex).await
}

pub(crate) async fn list_role_nodes(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<(Uuid, Uuid)>, sqlx::Error> {
    sqlx::query_as("select role_id, node_id from role_node_scopes order by node_id").fetch_all(ex).await
}

pub(crate) async fn list_user_roles(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<(Uuid, Uuid)>, sqlx::Error> {
    sqlx::query_as(
        "select ur.user_id, ur.role_id from user_roles ur
           join roles r on r.id = ur.role_id order by ur.user_id, r.name")
        .fetch_all(ex).await
}

pub(crate) async fn list_user_scopes(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as("select user_id, scope from user_scopes").fetch_all(ex).await
}

pub(crate) async fn list_user_nodes(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<(Uuid, Uuid)>, sqlx::Error> {
    sqlx::query_as("select user_id, node_id from user_node_scopes").fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct UserRow {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub color: Option<String>,
    pub is_admin: bool,
    pub is_active: bool,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub notify_level: NotifyLevel,
    pub quiet_start: Option<i16>,
    pub quiet_end: Option<i16>,
    pub push_devices: i64,
    pub chat_overrides: i64,
}

pub(crate) async fn list_users(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<UserRow>, sqlx::Error> {
    sqlx::query_as(
        "select u.id, u.email, u.name, u.color, u.is_admin, u.is_active, u.last_seen_at,
                u.notify_level, u.quiet_start, u.quiet_end,
                (select count(*) from push_subscriptions p where p.user_id = u.id) as push_devices,
                (select count(*) from chat_prefs c where c.user_id = u.id) as chat_overrides
           from users u order by u.name")
        .fetch_all(ex).await
}

pub(crate) async fn insert_user(ex: impl sqlx::PgExecutor<'_>, email: &str, name: &str, colors: Vec<&str>) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "insert into users (email, name, color)
         values ($1, $2, ($3::text[])[1 + ((select count(*) from users) % 6)::int])
         on conflict (lower(email)) do nothing")
        .bind(email).bind(name).bind(colors).execute(ex).await?.rows_affected())
}

pub(crate) async fn list_active_admins_for_update(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select id from users where is_admin and is_active for update").fetch_all(ex).await
}

pub(crate) async fn find_user_status(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(String, bool, bool)>, sqlx::Error> {
    sqlx::query_as("select email, is_admin, is_active from users where id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn set_admin(ex: impl sqlx::PgExecutor<'_>, id: Uuid, want: bool) -> Result<(), sqlx::Error> {
    sqlx::query("update users set is_admin = $2 where id = $1").bind(id).bind(want).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_active(ex: impl sqlx::PgExecutor<'_>, id: Uuid, want: bool) -> Result<(), sqlx::Error> {
    sqlx::query("update users set is_active = $2 where id = $1").bind(id).bind(want).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_user_scope(ex: impl sqlx::PgExecutor<'_>, id: Uuid, scope: &str, user: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
                "insert into user_scopes (user_id, scope, granted_by) values ($1, $2, $3)
                 on conflict do nothing")
        .bind(id).bind(scope).bind(user).execute(ex).await?.rows_affected())
}

pub(crate) async fn delete_user_scope(ex: impl sqlx::PgExecutor<'_>, id: Uuid, scope: &str) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("delete from user_scopes where user_id = $1 and scope = $2")
        .bind(id).bind(scope).execute(ex).await?.rows_affected())
}

pub(crate) async fn insert_user_role(ex: impl sqlx::PgExecutor<'_>, id: Uuid, role: Uuid, user: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
                "insert into user_roles (user_id, role_id, granted_by) values ($1, $2, $3)
                 on conflict do nothing")
        .bind(id).bind(role).bind(user).execute(ex).await?.rows_affected())
}

pub(crate) async fn delete_user_role(ex: impl sqlx::PgExecutor<'_>, id: Uuid, role: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("delete from user_roles where user_id = $1 and role_id = $2")
        .bind(id).bind(role).execute(ex).await?.rows_affected())
}

pub(crate) async fn insert_user_node(ex: impl sqlx::PgExecutor<'_>, id: Uuid, node: Uuid, user: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
                "insert into user_node_scopes (user_id, node_id, granted_by) values ($1, $2, $3)
                 on conflict do nothing")
        .bind(id).bind(node).bind(user).execute(ex).await?.rows_affected())
}

pub(crate) async fn check_avatar(ex: impl sqlx::PgExecutor<'_>, attachment: Uuid, user: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
                    "select exists(select 1 from attachments
                                    where id = $1 and uploader_id = $2 and deleted_at is null)")
        .bind(attachment).bind(user).fetch_one(ex).await
}

pub(crate) async fn set_avatar(ex: impl sqlx::PgExecutor<'_>, id: Uuid, photo: Option<Uuid>) -> Result<(), sqlx::Error> {
    sqlx::query("update users set avatar_id = $2 where id = $1")
        .bind(id).bind(photo).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_user_node(ex: impl sqlx::PgExecutor<'_>, id: Uuid, node: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("delete from user_node_scopes where user_id = $1 and node_id = $2")
        .bind(id).bind(node).execute(ex).await?.rows_affected())
}

pub(crate) async fn list_scopes_for_role(ex: impl sqlx::PgExecutor<'_>, role: Uuid) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("select scope from role_scopes where role_id = $1").bind(role).fetch_all(ex).await
}

pub(crate) async fn list_nodes_for_role(ex: impl sqlx::PgExecutor<'_>, role: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select node_id from role_node_scopes where role_id = $1").bind(role).fetch_all(ex).await
}

pub(crate) async fn count_scopes(ex: impl sqlx::PgExecutor<'_>, names: &[String]) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("select count(*) from scopes where name = any($1)").bind(names).fetch_one(ex).await
}

pub(crate) async fn find_role_name(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("select name from roles where id = $1").bind(id).fetch_optional(ex).await
}

pub(crate) async fn insert_role(ex: impl sqlx::PgExecutor<'_>, name: String, user: Uuid, color: Option<String>) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
            "insert into roles (name, created_by, color) values ($1, $2, $3)
             on conflict (name) do nothing returning id")
        .bind(name).bind(user).bind(color).fetch_optional(ex).await
}

pub(crate) async fn find_role_name_conflict(ex: impl sqlx::PgExecutor<'_>, name: &str, id: Uuid) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar("select 1 from roles where name = $1 and id <> $2")
        .bind(name).bind(id).fetch_optional(ex).await
}

pub(crate) async fn update_role(ex: impl sqlx::PgExecutor<'_>, id: Uuid, name: String, color: Option<String>) -> Result<(), sqlx::Error> {
    sqlx::query("update roles set name = $2, color = coalesce($3, color) where id = $1")
        .bind(id).bind(name).bind(color).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_role_color(ex: impl sqlx::PgExecutor<'_>, id: Uuid, color: String) -> Result<(), sqlx::Error> {
    sqlx::query("update roles set color = $2 where id = $1").bind(id).bind(color).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_role_scopes(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from role_scopes where role_id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_role_scopes(ex: impl sqlx::PgExecutor<'_>, id: Uuid, scopes: Vec<String>) -> Result<(), sqlx::Error> {
    sqlx::query("insert into role_scopes (role_id, scope) select $1, unnest($2::text[])
                     on conflict do nothing")
        .bind(id).bind(scopes).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_role_nodes(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from role_node_scopes where role_id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_role_nodes(ex: impl sqlx::PgExecutor<'_>, id: Uuid, nodes: Vec<Uuid>, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
            "insert into role_node_scopes (role_id, node_id, granted_by)
             select $1, unnest($2::uuid[]), $3 on conflict do nothing")
        .bind(id).bind(nodes).bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_role(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("delete from roles where id = $1 returning name").bind(id).fetch_optional(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct LoginRow {
    pub id: Uuid,
    pub last_login_at: Option<DateTime<Utc>>,
    pub last_seen_at: Option<DateTime<Utc>>,
}

pub(crate) async fn list_logins(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<LoginRow>, sqlx::Error> {
    sqlx::query_as("select id, last_login_at, last_seen_at from users order by name").fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct ActivityRow {
    pub user_id: Uuid,
    pub day: NaiveDate,
    pub requests: i32,
    pub minutes: i32,
    pub messages: i32,
    pub changes: i32,
}

pub(crate) async fn list_activity(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<ActivityRow>, sqlx::Error> {
    use sqlx::Row;
    let rows = sqlx::query(
        "select user_id, day, sum(requests)::int, sum(minutes)::int, sum(messages)::int, sum(changes)::int
           from (
             select user_id, day, requests, minutes, 0 as messages, 0 as changes
               from user_activity where day > current_date - 120
             union all
             select author_id, created_at::date, 0, 0, 1, 0
               from messages where author_id is not null and created_at::date > current_date - 120
             union all
             select actor_id, created_at::date, 0, 0, 0, 1
               from activity where actor_id is not null and created_at::date > current_date - 120
           ) t
          group by user_id, day order by day")
        .fetch_all(ex).await?;
    // Toplam sutunlarinin adi ayni; mevcut demet gibi sira ile okunur.
    rows.into_iter().map(|r| Ok(ActivityRow { user_id: r.try_get(0)?, day: r.try_get(1)?,
        requests: r.try_get(2)?, minutes: r.try_get(3)?, messages: r.try_get(4)?, changes: r.try_get(5)? })).collect()
}
