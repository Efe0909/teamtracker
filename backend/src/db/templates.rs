//! templates veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(sqlx::FromRow)]
pub(crate) struct TemplateRow {
    pub id: Uuid,
    pub name: String,
    pub format: String,
    pub body: String,
    pub updated_at: DateTime<Utc>,
}

pub(crate) async fn list_templates(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<TemplateRow>, sqlx::Error> {
    sqlx::query_as("select id, name, format, body, updated_at from mail_templates order by name")
        .fetch_all(ex).await
}

pub(crate) async fn find_template(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<TemplateRow>, sqlx::Error> {
    sqlx::query_as("select id, name, format, body, updated_at from mail_templates where id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn has_name(ex: impl sqlx::PgExecutor<'_>, name: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from mail_templates where name = $1)")
        .bind(name).fetch_one(ex).await
}

pub(crate) async fn insert_template(ex: impl sqlx::PgExecutor<'_>, name: &str, format: &str, body: &str, created_by: Uuid) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into mail_templates (name, format, body, created_by) values ($1, $2, $3, $4) returning id")
        .bind(name).bind(format).bind(body).bind(created_by).fetch_one(ex).await
}

pub(crate) async fn has_other_name(ex: impl sqlx::PgExecutor<'_>, name: &str, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from mail_templates where name = $1 and id <> $2)")
        .bind(name).bind(id).fetch_one(ex).await
}

pub(crate) async fn update_template(ex: impl sqlx::PgExecutor<'_>, id: Uuid, name: &str, format: &str, body: &str) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("update mail_templates set name = $2, format = $3, body = $4, updated_at = now() where id = $1")
        .bind(id).bind(name).bind(format).bind(body).execute(ex).await?.rows_affected())
}

pub(crate) async fn delete_template(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("delete from mail_templates where id = $1")
        .bind(id).execute(ex).await?.rows_affected())
}
