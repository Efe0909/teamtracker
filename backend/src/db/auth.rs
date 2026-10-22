//! Kimlik veri erişimi: yalnız SQL.

use uuid::Uuid;

#[derive(sqlx::FromRow)]
pub(crate) struct Candidate {
    pub id: Uuid,
    pub google_sub: Option<String>,
    pub is_active: bool,
}

pub(crate) async fn find_by_google_sub(ex: impl sqlx::PgExecutor<'_>, sub: &str) -> Result<Option<Candidate>, sqlx::Error> {
    sqlx::query_as("select id, google_sub, is_active from users where google_sub = $1")
        .bind(sub).fetch_optional(ex).await
}

pub(crate) async fn find_by_email(ex: impl sqlx::PgExecutor<'_>, email: &str) -> Result<Option<Candidate>, sqlx::Error> {
    sqlx::query_as("select id, google_sub, is_active from users where lower(email) = lower($1)")
        .bind(email).fetch_optional(ex).await
}

pub(crate) async fn record_login(ex: impl sqlx::PgExecutor<'_>, sub: &str, email: &str, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update users set google_sub = $1, email = $2, last_login_at = now() where id = $3")
        .bind(sub).bind(email).bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn upsert_activity(ex: impl sqlx::PgExecutor<'_>, id: Uuid, requests: i32) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into user_activity (user_id, day, requests, minutes) values ($1, current_date, $2, 1)
         on conflict (user_id, day) do update
           set requests = user_activity.requests + excluded.requests, minutes = user_activity.minutes + 1")
        .bind(id).bind(requests).execute(ex).await?;
    Ok(())
}

pub(crate) async fn touch_presence(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update users set last_seen_at = now() where id = $1")
        .bind(id).execute(ex).await?;
    Ok(())
}
