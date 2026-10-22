//! Gerçek zamanlı olayların hedef sorguları: yalnız SQL.

use uuid::Uuid;

pub(crate) async fn find_card_record(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select record_id from cards where id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn find_action_record(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select record_id from actions where id = $1")
        .bind(id).fetch_optional(ex).await
}
