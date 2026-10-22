//! teams veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use uuid::Uuid;

pub(crate) async fn check_banner(ex: impl sqlx::PgExecutor<'_>, attachment: Uuid, max_bytes: i64) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
            "select exists(select 1 from attachments where id = $1 and deleted_at is null
                                                        and kind = 'image' and byte_size <= $2)")
        .bind(attachment).bind(max_bytes).fetch_one(ex).await
}

pub(crate) async fn set_banner(ex: impl sqlx::PgExecutor<'_>, team: Uuid, banner: Option<Uuid>) -> Result<(), sqlx::Error> {
    sqlx::query("update teams set banner_id = $2 where id = $1")
        .bind(team).bind(banner).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_team(ex: impl sqlx::PgExecutor<'_>, name: &str, description: Option<&str>, color: Option<&str>, chat: Uuid) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into teams (name, description, color, chat_id) values ($1, $2, $3, $4)
         returning id")
        .bind(name).bind(description).bind(color).bind(chat).fetch_one(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct TeamRow {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub chat_id: Uuid,
    #[sqlx(rename = "exists")]
    pub is_pillar: bool,
}

pub(crate) async fn find_team_for_update(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<TeamRow>, sqlx::Error> {
    sqlx::query_as(
        "select t.name, t.description, t.color, t.chat_id,
                exists(select 1 from pillars p where p.team_id = t.id)
           from teams t where t.id = $1 for update")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn update_team(ex: impl sqlx::PgExecutor<'_>, id: Uuid, name: &str, description: Option<String>, color: Option<String>) -> Result<(), sqlx::Error> {
    sqlx::query("update teams set name = $2, description = $3, color = $4 where id = $1")
        .bind(id).bind(name).bind(description).bind(color).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_pillar_status(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<bool>, sqlx::Error> {
    sqlx::query_scalar(
        "select exists(select 1 from pillars p where p.team_id = t.id) from teams t where t.id = $1")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn delete_team(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from teams where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_team_chat(ex: impl sqlx::PgExecutor<'_>, team: Uuid) -> Result<Option<(String, Uuid)>, sqlx::Error> {
    sqlx::query_as("select name, chat_id from teams where id = $1")
        .bind(team).fetch_optional(ex).await
}

pub(crate) async fn find_active_node_name(ex: impl sqlx::PgExecutor<'_>, node: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("select name from nodes where id = $1 and is_active")
        .bind(node).fetch_optional(ex).await
}

pub(crate) async fn insert_node_link(ex: impl sqlx::PgExecutor<'_>, team: Uuid, node: Uuid, user: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "insert into team_nodes (team_id, node_id, linked_by) values ($1, $2, $3)
         on conflict do nothing")
        .bind(team).bind(node).bind(user).execute(ex).await?.rows_affected())
}

pub(crate) async fn delete_node_link(ex: impl sqlx::PgExecutor<'_>, team: Uuid, node: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "delete from team_nodes t using nodes n
          where t.team_id = $1 and t.node_id = $2 and n.id = t.node_id returning n.name")
        .bind(team).bind(node).fetch_optional(ex).await
}

pub(crate) async fn insert_pillar(ex: impl sqlx::PgExecutor<'_>, name: &str, description: &Option<String>, color: &Option<String>, team: Uuid, user: Uuid) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into pillars (name, description, color, team_id, created_by, sort_order)
         values ($1, $2, $3, $4, $5, (select coalesce(max(sort_order), -1) + 1 from pillars))
         returning id")
        .bind(name).bind(description).bind(color).bind(team).bind(user).fetch_one(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct PillarRow {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub team_id: Uuid,
    pub is_active: bool,
    pub sort_order: i32,
    pub chat_id: Uuid,
}

pub(crate) async fn find_pillar_for_update(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<PillarRow>, sqlx::Error> {
    sqlx::query_as(
        "select p.name, p.description, p.color, p.team_id, p.is_active, p.sort_order, t.chat_id
           from pillars p join teams t on t.id = p.team_id where p.id = $1 for update of p")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn update_pillar(ex: impl sqlx::PgExecutor<'_>, id: Uuid, name: &str, description: &Option<String>, color: &Option<String>, active: bool, sort_order: i32) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update pillars set name = $2, description = $3, color = $4, is_active = $5,
                            sort_order = $6 where id = $1")
        .bind(id).bind(name).bind(description).bind(color).bind(active).bind(sort_order)
        .execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_pillar(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("delete from pillars where id = $1 returning team_id")
        .bind(id).fetch_optional(ex).await
}
