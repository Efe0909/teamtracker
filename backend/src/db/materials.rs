//! materials veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use uuid::Uuid;

pub(crate) async fn list_existing_names(ex: impl sqlx::PgExecutor<'_>, event: Uuid) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select m.name from materials m join event_materials em on em.material_id = m.id where em.event_id = $1")
        .bind(event).fetch_all(ex).await
}

pub(crate) async fn list_rejected_names(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select name from material_suggestions where event_id = $1 and status = 'rejected'
          order by decided_at desc limit 50")
        .bind(id).fetch_all(ex).await
}

pub(crate) async fn insert_suggestions(
    ex: impl sqlx::PgExecutor<'_>, id: Uuid, batch_id: Uuid, names: &[&str], descs: &[&str],
) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "insert into material_suggestions (event_id, batch_id, name, description)
                 select $1, $2, n, d from unnest($3::text[], $4::text[]) with ordinality as t(n, d, i)
                 order by i returning id")
        .bind(id).bind(batch_id).bind(names).bind(descs).fetch_all(ex).await
}

pub(crate) async fn find_pending_suggestion(
    ex: impl sqlx::PgExecutor<'_>, event: Uuid, sid: Uuid,
) -> Result<Option<bool>, sqlx::Error> {
    sqlx::query_scalar(
        "select status = 'pending' from material_suggestions where id = $1 and event_id = $2 for update")
        .bind(sid).bind(event).fetch_optional(ex).await
}

pub(crate) async fn set_suggestion_decision(
    ex: impl sqlx::PgExecutor<'_>, sid: Uuid, status: &str, material: Option<Uuid>, by: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update material_suggestions set status = $2, material_id = $3, decided_by = $4, decided_at = now()
          where id = $1")
        .bind(sid).bind(status).bind(material).bind(by).execute(ex).await?;
    Ok(())
}
