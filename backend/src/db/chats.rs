//! chats veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(sqlx::FromRow)]
pub(crate) struct FeedRow {
    pub kind: String,
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub actor_id: Option<Uuid>,
    pub verb: Option<String>,
    pub subject_label: Option<String>,
    pub target_label: Option<String>,
    pub body: Option<String>,
    pub reply_to_id: Option<Uuid>,
    pub edited_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct InboxRow {
    pub chat_id: Uuid,
    pub title: String,
    pub kind: String,
    pub record_id: Option<Uuid>,
    pub team_id: Option<Uuid>,
    pub can_post: bool,
    pub last_message: Option<String>,
    pub last_actor_id: Option<Uuid>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub(crate) async fn list_inbox(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Vec<InboxRow>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH my_chats AS (
          SELECT t.chat_id, t.name as title, 'team' as kind,
                 null::uuid as record_id, t.id as team_id
          FROM teams t
          WHERE EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.id AND m.user_id = $1)
          UNION ALL
          SELECT r.chat_id, r.title, 'record' as kind, r.id as record_id, r.team_id
          FROM records r
          WHERE r.owner_id = $1 OR r.created_by = $1
             OR EXISTS (SELECT 1 FROM record_participants p WHERE p.record_id = r.id AND p.user_id = $1)
             OR EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = r.team_id AND m.user_id = $1)
        )
        SELECT c.chat_id, c.title, c.kind, c.record_id, c.team_id, true as can_post,
               m.body as last_message, m.author_id as last_actor_id, m.created_at as updated_at
        FROM my_chats c
        LEFT JOIN LATERAL (
          SELECT body, author_id, created_at FROM messages WHERE chat_id = c.chat_id
          ORDER BY created_at DESC, id DESC LIMIT 1
        ) m ON true
        ORDER BY m.created_at DESC NULLS LAST, c.chat_id"#
    ).bind(user).fetch_all(ex).await
}

pub(crate) async fn find_chat(ex: impl sqlx::PgExecutor<'_>, chat: Uuid) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar("select 1 from chats where id = $1").bind(chat).fetch_optional(ex).await
}

pub(crate) async fn find_record(ex: impl sqlx::PgExecutor<'_>, chat: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select id from records where chat_id = $1").bind(chat).fetch_optional(ex).await
}

pub(crate) async fn list_feed(ex: impl sqlx::PgExecutor<'_>, chat: Uuid) -> Result<Vec<FeedRow>, sqlx::Error> {
    sqlx::query_as(
        "select kind, id, created_at, actor_id, verb, subject_label, target_label, body,
                reply_to_id, edited_at
           from chat_feed where chat_id = $1 order by created_at, id")
        .bind(chat).fetch_all(ex).await
}

pub(crate) async fn list_quotes(ex: impl sqlx::PgExecutor<'_>, ids: &[Uuid]) -> Result<Vec<(Uuid, Option<Uuid>, String)>, sqlx::Error> {
    sqlx::query_as("select id, author_id, body from messages where id = any($1)")
        .bind(ids).fetch_all(ex).await
}

pub(crate) async fn list_attachments(ex: impl sqlx::PgExecutor<'_>, chat: Uuid) -> Result<Vec<(Uuid, Uuid)>, sqlx::Error> {
    sqlx::query_as(
        "select ma.message_id, ma.attachment_id from message_attachments ma
           join messages m on m.id = ma.message_id where m.chat_id = $1")
        .bind(chat).fetch_all(ex).await
}

pub(crate) async fn find_team(ex: impl sqlx::PgExecutor<'_>, chat: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select id from teams where chat_id = $1").bind(chat).fetch_optional(ex).await
}

pub(crate) async fn find_member(ex: impl sqlx::PgExecutor<'_>, chat: Uuid, user: Uuid) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar(
        "select 1 from teams t join team_members m on m.team_id = t.id
                  where t.chat_id = $1 and m.user_id = $2")
        .bind(chat).bind(user).fetch_optional(ex).await
}

pub(crate) async fn find_reply(ex: impl sqlx::PgExecutor<'_>, id: Uuid, chat: Uuid) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar("select 1 from messages where id = $1 and chat_id = $2")
        .bind(id).bind(chat).fetch_optional(ex).await
}

pub(crate) async fn insert_message(ex: impl sqlx::PgExecutor<'_>, chat: Uuid, author: Uuid, body: &str, reply: Option<Uuid>) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into messages (chat_id, author_id, body, reply_to_id)
         values ($1, $2, $3, $4) returning id")
        .bind(chat).bind(author).bind(body).bind(reply).fetch_one(ex).await
}

pub(crate) async fn insert_attachments(ex: impl sqlx::PgExecutor<'_>, message: Uuid, ids: &[Uuid]) -> Result<(), sqlx::Error> {
    sqlx::query("insert into message_attachments (message_id, attachment_id)
                     select $1, unnest($2::uuid[])")
        .bind(message).bind(ids).execute(ex).await?;
    Ok(())
}

pub(crate) async fn list_active_users(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as("select id, name from users where is_active").fetch_all(ex).await
}

pub(crate) async fn insert_participants(ex: impl sqlx::PgExecutor<'_>, record: Uuid, ids: Vec<Uuid>, by: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into record_participants (record_id, user_id, added_by)
             select $1, unnest($2::uuid[]), $3 on conflict do nothing")
        .bind(record).bind(ids).bind(by).execute(ex).await?;
    Ok(())
}
