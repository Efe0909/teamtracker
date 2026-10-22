//! Posta kuyruğu veri erişimi: yalnız SQL.

use uuid::Uuid;

pub(crate) async fn insert_mail(ex: impl sqlx::PgExecutor<'_>, kind: &str, m: &crate::mail::Mail) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into mail_outbox (kind, to_email, subject, body_html, body_text)
         values ($1, $2, $3, $4, $5)")
        .bind(kind).bind(&m.to).bind(&m.subject).bind(&m.html).bind(&m.text)
        .execute(ex).await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
pub(crate) struct Pending {
    pub id: Uuid,
    pub to_email: String,
    pub subject: String,
    pub body_html: String,
    pub body_text: String,
    pub attempts: i32,
}

pub(crate) async fn list_pending(ex: impl sqlx::PgExecutor<'_>, max_attempts: i32) -> Result<Vec<Pending>, sqlx::Error> {
    sqlx::query_as(
        "select id, to_email, subject, body_html, body_text, attempts from mail_outbox
          where sent_at is null and attempts < $1 and next_try_at <= now()
          order by created_at limit 10 for update skip locked")
        .bind(max_attempts).fetch_all(ex).await
}

pub(crate) async fn mark_sent(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update mail_outbox set sent_at = now(), error = null, attempts = attempts + 1 where id = $1")
        .bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_retry(ex: impl sqlx::PgExecutor<'_>, id: Uuid, attempts: i32, note: &str, delay_minutes: i32) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update mail_outbox set attempts = $2, error = $3,
                            next_try_at = now() + make_interval(mins => $4) where id = $1")
        .bind(id).bind(attempts).bind(note).bind(delay_minutes).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_rejected(ex: impl sqlx::PgExecutor<'_>, id: Uuid, attempts: i32, note: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update mail_outbox set attempts = $2, error = $3 where id = $1")
        .bind(id).bind(attempts).bind(note).execute(ex).await?;
    Ok(())
}
