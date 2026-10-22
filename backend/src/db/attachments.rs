//! attachments veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, Utc};
use uuid::Uuid;
use crate::db::media;

#[derive(sqlx::FromRow)]
pub(crate) struct Row {
    pub id: Uuid,
    pub mime: String,
    pub kind: String,
    pub byte_size: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub original_name: Option<String>,
    pub uploader_id: Option<Uuid>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct Blob {
    pub uploader_id: Option<Uuid>,
    pub mime: String,
    pub kind: String,
    pub original_name: Option<String>,
    pub storage_key: String,
    pub thumb_key: Option<String>,
    pub mount_path: String,
    pub media_prefix: String,
}

pub(crate) async fn list_attachments(ex: impl sqlx::PgExecutor<'_>, ids: &[Uuid]) -> Result<Vec<Row>, sqlx::Error> {
    sqlx::query_as(
        "select id, mime, kind, byte_size, width, height, original_name, uploader_id, deleted_at
           from attachments where id = any($1)")
        .bind(ids).fetch_all(ex).await
}

pub(crate) async fn list_attachment_tags(ex: impl sqlx::PgExecutor<'_>, ids: &[Uuid]) -> Result<Vec<(Uuid, Uuid, String)>, sqlx::Error> {
    sqlx::query_as(
        "select at.attachment_id, t.id, t.name from attachment_tags at
           join tags t on t.id = at.tag_id where at.attachment_id = any($1) order by t.name")
        .bind(ids).fetch_all(ex).await
}

pub(crate) async fn find_member(ex: impl sqlx::PgExecutor<'_>, team: Uuid, user: Uuid) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar("select 1 from team_members where team_id = $1 and user_id = $2")
        .bind(team).bind(user).fetch_optional(ex).await
}

pub(crate) async fn find_place(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(Option<Uuid>, Option<Uuid>)>, sqlx::Error> {
    sqlx::query_as(
        "select coalesce(rm.id, c.record_id), t.id
           from attachments a
           left join message_attachments ma on ma.attachment_id = a.id
           left join messages m on m.id = ma.message_id
           left join records rm on rm.chat_id = m.chat_id
           left join teams t on t.chat_id = m.chat_id
           left join card_attachments ca on ca.attachment_id = a.id
           left join cards c on c.id = ca.card_id
          where a.id = $1 limit 1")
        .bind(id).fetch_optional(ex).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_attachment(
    ex: impl sqlx::PgExecutor<'_>, volume: Uuid, uploader: Uuid, mime: &str, kind: &str,
    purpose: &str, size: i64, checksum: String, width: Option<i32>, height: Option<i32>,
    name: Option<String>, key: &str, thumb_key: &Option<String>,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into attachments (volume_id, uploader_id, mime, kind, purpose, byte_size, checksum,
                                  width, height, original_name, storage_key, thumb_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id")
        .bind(volume).bind(uploader).bind(mime).bind(kind).bind(purpose).bind(size).bind(checksum)
        .bind(width).bind(height).bind(name).bind(key).bind(thumb_key).fetch_one(ex).await
}

pub(crate) async fn find_blob(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<Blob>, sqlx::Error> {
    sqlx::query_as(
        "select a.uploader_id, a.mime, a.kind, a.original_name, a.storage_key, a.thumb_key,
                v.mount_path, v.media_prefix
           from attachments a join storage_volumes v on v.id = a.volume_id
          where a.id = $1 and a.deleted_at is null")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn is_face(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists(select 1 from users where avatar_id = $1)
                     or exists(select 1 from teams where banner_id = $1)")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn is_locked(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists(select 1 from invoice_attachments where attachment_id = $1)
             or exists(select 1 from ledger_attachments where attachment_id = $1)")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn mark_deleted(ex: impl sqlx::PgExecutor<'_>, id: Uuid, actor: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update attachments set deleted_at = now(), deleted_by = $2 where id = $1")
        .bind(id).bind(actor).execute(ex).await?;
    Ok(())
}

pub(crate) async fn list_tags(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as("select id, name from tags order by name").fetch_all(ex).await
}

pub(crate) async fn find_tag(ex: impl sqlx::PgExecutor<'_>, slug: &str) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select id from tags where slug = $1").bind(slug).fetch_optional(ex).await
}

pub(crate) async fn upsert_tag(ex: impl sqlx::PgExecutor<'_>, name: &str, slug: &str, actor: Uuid) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into tags (name, slug, created_by) values ($1, $2, $3)
                 on conflict (slug) do update set slug = excluded.slug returning id")
        .bind(name).bind(slug).bind(actor).fetch_one(ex).await
}

pub(crate) async fn insert_tag_link(ex: impl sqlx::PgExecutor<'_>, id: Uuid, tag: Uuid, actor: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into attachment_tags (attachment_id, tag_id, added_by) values ($1, $2, $3)
         on conflict do nothing")
        .bind(id).bind(tag).bind(actor).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_tag_link(ex: impl sqlx::PgExecutor<'_>, id: Uuid, tag: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from attachment_tags where attachment_id = $1 and tag_id = $2")
        .bind(id).bind(tag).execute(ex).await?;
    Ok(())
}

pub(crate) async fn count_claimable(ex: impl sqlx::PgExecutor<'_>, ids: &[Uuid], user: Uuid, purpose: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(concat!(
        "select count(*) from attachments a
          where a.id = any($1) and a.uploader_id = $2 and a.deleted_at is null
            and a.purpose = $3 and ", media::unowned!()))
        .bind(ids).bind(user).bind(purpose).fetch_one(ex).await
}
