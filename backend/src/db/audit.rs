//! Denetim izi veri erişimi: yalnız SQL.

use uuid::Uuid;

pub(crate) async fn insert_event(
    ex: impl sqlx::PgExecutor<'_>, event_type: &str, actor: Option<Uuid>,
    email: Option<&str>, ip: Option<String>, detail: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into security_events (event_type, actor_id, email, ip, detail) \
         values ($1, $2, $3, $4::inet, $5)")
        .bind(event_type).bind(actor).bind(email).bind(ip).bind(detail)
        .execute(ex).await?;
    Ok(())
}
