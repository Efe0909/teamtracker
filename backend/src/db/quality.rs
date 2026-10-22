//! quality veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, Utc};
use uuid::Uuid;

pub(crate) async fn find_config(ex: impl sqlx::PgExecutor<'_>) -> Result<Option<serde_json::Value>, sqlx::Error> {
    sqlx::query_scalar("select config from quality_config").fetch_optional(ex).await
}

pub(crate) async fn find_metadata(ex: impl sqlx::PgExecutor<'_>) -> Result<Option<(DateTime<Utc>, Option<Uuid>)>, sqlx::Error> {
    sqlx::query_as("select updated_at, updated_by from quality_config")
        .fetch_optional(ex).await
}

pub(crate) async fn upsert_config(ex: impl sqlx::PgExecutor<'_>, json: serde_json::Value, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into quality_config (id, config, updated_by) values (true, $1, $2)
         on conflict (id) do update set config = $1, updated_by = $2, updated_at = now()")
        .bind(json).bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_config(ex: impl sqlx::PgExecutor<'_>) -> Result<(), sqlx::Error> {
    sqlx::query("delete from quality_config").execute(ex).await?;
    Ok(())
}
