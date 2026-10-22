//! Ön yüz sözlüğü veri erişimi: yalnız SQL.

use chrono::{DateTime, Utc};
use uuid::Uuid;

pub(crate) async fn list_team_ids(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select team_id from team_members where user_id = $1")
        .bind(user).fetch_all(ex).await
}

pub(crate) async fn find_profile_status(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<(bool, bool), sqlx::Error> {
    sqlx::query_as(
        "select coalesce(btrim(phone), '') <> '',
                exists(select 1 from bank_accounts b where b.user_id = u.id and b.deleted_at is null)
           from users u where u.id = $1")
        .bind(user).fetch_one(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct UserRow {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub is_admin: bool,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub nickname: Option<String>,
    pub phone: Option<String>,
    pub avatar_id: Option<Uuid>,
    pub birth_day: Option<i16>,
    pub birth_month: Option<i16>,
    pub birth_year: Option<i16>,
}

pub(crate) async fn list_users(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<UserRow>, sqlx::Error> {
    sqlx::query_as(
        "select id, name, color, is_admin, last_seen_at, nickname, phone, avatar_id,
                birth_day, birth_month, birth_year
           from users where is_active order by name")
        .fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct RoleRow {
    pub user_id: Uuid,
    pub id: Uuid,
    pub name: String,
    pub color: String,
}

pub(crate) async fn list_roles(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<RoleRow>, sqlx::Error> {
    sqlx::query_as(
        "select ur.user_id, r.id, r.name, r.color
           from user_roles ur join roles r on r.id = ur.role_id
           join users u on u.id = ur.user_id
          where u.is_active order by r.name")
        .fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct TeamRow {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub chat_id: Uuid,
    pub node_ids: Vec<Uuid>,
    pub pillar_id: Option<Uuid>,
    pub banner_id: Option<Uuid>,
}

pub(crate) async fn list_teams(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<TeamRow>, sqlx::Error> {
    sqlx::query_as(
        "select t.id, t.name, t.description, t.color, t.chat_id,
                array(select n.node_id from team_nodes n where n.team_id = t.id
                       order by n.linked_at, n.node_id) as node_ids,
                (select p.id from pillars p where p.team_id = t.id) as pillar_id,
                t.banner_id
           from teams t order by t.name")
        .fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct PillarRow {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub team_id: Uuid,
    pub is_active: bool,
    pub sort_order: i32,
}

pub(crate) async fn list_pillars(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<PillarRow>, sqlx::Error> {
    sqlx::query_as(
        "select id, name, description, color, team_id, is_active, sort_order
           from pillars order by sort_order, name")
        .fetch_all(ex).await
}
