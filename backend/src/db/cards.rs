//! cards veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use serde_json::Value;
use uuid::Uuid;

pub(crate) async fn list_for_record(ex: impl sqlx::PgExecutor<'_>, record: Uuid) -> Result<Vec<(Uuid, String, Value)>, sqlx::Error> {
    sqlx::query_as(
        "select id, card_type, data from cards where record_id = $1 order by sort_order, created_at")
        .bind(record).fetch_all(ex).await
}

pub(crate) async fn list_attachments(ex: impl sqlx::PgExecutor<'_>, ids: &[Uuid]) -> Result<Vec<(Uuid, Uuid)>, sqlx::Error> {
    sqlx::query_as(
        "select card_id, attachment_id from card_attachments where card_id = any($1)
          order by sort_order")
        .bind(ids).fetch_all(ex).await
}

pub(crate) async fn insert_card(ex: impl sqlx::PgExecutor<'_>, record: Uuid, card_type: &str, data: &Value, actor: Uuid) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into cards (record_id, card_type, data, created_by, sort_order)
         values ($1, $2, $3, $4,
                 coalesce((select max(sort_order) from cards where record_id = $1), -1) + 1)
         returning id")
        .bind(record).bind(card_type).bind(data).bind(actor).fetch_one(ex).await
}

pub(crate) async fn count_option_photos(ex: impl sqlx::PgExecutor<'_>, ids: &[Uuid], user: Uuid, card: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "select count(distinct a.id) from attachments a
          where a.id = any($1) and a.deleted_at is null
            and (a.uploader_id = $2
                 or exists (select 1 from card_attachments x where x.card_id = $3 and x.attachment_id = a.id))")
        .bind(ids).bind(user).bind(card).fetch_one(ex).await
}

pub(crate) async fn insert_option_photos(ex: impl sqlx::PgExecutor<'_>, card: Uuid, ids: &[Uuid]) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into card_attachments (card_id, attachment_id, sort_order)
         select $1, a, coalesce((select max(sort_order) from card_attachments where card_id = $1), -1) + n
           from unnest($2::uuid[]) with ordinality as x(a, n)
         on conflict do nothing")
        .bind(card).bind(ids).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_card(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(Uuid, Uuid, String)>, sqlx::Error> {
    sqlx::query_as("select id, record_id, card_type from cards where id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn get_data(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("select data from cards where id = $1").bind(id).fetch_one(ex).await
}

pub(crate) async fn update_data(ex: impl sqlx::PgExecutor<'_>, id: Uuid, data: &Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update cards set data = jsonb_strip_nulls(
                 jsonb_build_object('signups', data->'signups', 'votes', data->'votes')) || $2
          where id = $1")
        .bind(id).bind(data).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_card(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from cards where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_signup(ex: impl sqlx::PgExecutor<'_>, id: Uuid, key: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update cards set data = data #- array['signups', $2] where id = $1")
        .bind(id).bind(key).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_signup(ex: impl sqlx::PgExecutor<'_>, id: Uuid, key: &str, entry: Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update cards set data = jsonb_set(
                   case when data ? 'signups' then data else data || '{\"signups\": {}}' end,
                   array['signups', $2], $3, true)
                  where id = $1")
        .bind(id).bind(key).bind(entry).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_vote(ex: impl sqlx::PgExecutor<'_>, id: Uuid, key: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update cards set data = data #- array['votes', $2] where id = $1")
        .bind(id).bind(key).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_vote(ex: impl sqlx::PgExecutor<'_>, id: Uuid, key: &str, entry: Value) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update cards set data = jsonb_set(
           case when data ? 'votes' then data else data || '{\"votes\": {}}' end,
           array['votes', $2], $3, true)
          where id = $1")
        .bind(id).bind(key).bind(entry).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_attachments(ex: impl sqlx::PgExecutor<'_>, id: Uuid, ids: &[Uuid]) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into card_attachments (card_id, attachment_id, sort_order)
         select $1, a, coalesce((select max(sort_order) from card_attachments where card_id = $1), -1) + n
           from unnest($2::uuid[]) with ordinality as x(a, n)")
        .bind(id).bind(ids).execute(ex).await?;
    Ok(())
}
