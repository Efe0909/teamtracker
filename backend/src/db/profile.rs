//! profile veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, Utc};
use uuid::Uuid;

pub(crate) async fn find_active_user(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<crate::models::user::User>, sqlx::Error> {
    sqlx::query_as(
        "select id, email, name, color, is_admin, is_active, notify_level \
         from users where id = $1 and is_active")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn set_name(ex: impl sqlx::PgExecutor<'_>, id: Uuid, name: &str) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("update users set name = $2 where id = $1")
        .bind(id).bind(name).execute(ex).await?.rows_affected())
}

#[derive(sqlx::FromRow)]
pub(crate) struct ProfileRow {
    pub nickname: Option<String>,
    pub phone: Option<String>,
    pub birth_day: Option<i16>,
    pub birth_month: Option<i16>,
    pub birth_year: Option<i16>,
    pub avatar_id: Option<Uuid>,
}

pub(crate) async fn find_for_update(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<ProfileRow, sqlx::Error> {
    sqlx::query_as(
        "select nickname, phone, birth_day, birth_month, birth_year, avatar_id
           from users where id = $1 for update")
        .bind(user).fetch_one(ex).await
}

pub(crate) async fn check_avatar(ex: impl sqlx::PgExecutor<'_>, avatar: Uuid, user: Uuid, max_bytes: i64) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
                "select exists(select 1 from attachments
                                where id = $1 and uploader_id = $2 and deleted_at is null
                                  and kind = 'image' and byte_size <= $3)")
        .bind(avatar).bind(user).bind(max_bytes).fetch_one(ex).await
}

pub(crate) async fn update_profile(ex: impl sqlx::PgExecutor<'_>, user: Uuid, profile: ProfileRow) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update users set nickname = $2, phone = $3, birth_day = $4, birth_month = $5,
                          birth_year = $6, avatar_id = $7 where id = $1")
        .bind(user).bind(profile.nickname).bind(profile.phone).bind(profile.birth_day)
        .bind(profile.birth_month).bind(profile.birth_year).bind(profile.avatar_id)
        .execute(ex).await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
pub(crate) struct ExportRow {
    pub email: String,
    pub name: String,
    pub nickname: Option<String>,
    pub phone: Option<String>,
    pub birth_day: Option<i16>,
    pub birth_month: Option<i16>,
    pub birth_year: Option<i16>,
    pub notify_level: String,
    pub created_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
}

pub(crate) async fn find_export(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<ExportRow, sqlx::Error> {
    sqlx::query_as(
        "select email, name, nickname, phone, birth_day, birth_month, birth_year, notify_level,
                created_at, last_login_at
           from users where id = $1")
        .bind(user).fetch_one(ex).await
}

pub(crate) async fn list_team_names(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select t.name from team_members m join teams t on t.id = m.team_id where m.user_id = $1 order by t.name")
        .bind(user).fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct RecordRow {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub(crate) async fn list_records(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Vec<RecordRow>, sqlx::Error> {
    sqlx::query_as(
        "select id, title, description, created_at from records where created_by = $1 order by created_at")
        .bind(user).fetch_all(ex).await
}

pub(crate) async fn list_messages(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Vec<(Uuid, String, DateTime<Utc>)>, sqlx::Error> {
    sqlx::query_as(
        "select chat_id, body, created_at from messages where author_id = $1 order by created_at")
        .bind(user).fetch_all(ex).await
}

pub(crate) async fn find_user_name(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("select name from users where id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn find_active_name(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("select name from users where id = $1 and is_active")
        .bind(user).fetch_optional(ex).await
}
