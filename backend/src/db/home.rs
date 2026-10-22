//! home veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use uuid::Uuid;
use crate::models::enums::TeamRole;

#[derive(sqlx::FromRow)]
pub(crate) struct CountsRow {
    pub my_open_actions: i64,
    pub open_records: i64,
    pub overdue_records: i64,
    pub unassigned: i64,
}

pub(crate) async fn find_counts(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<CountsRow, sqlx::Error> {
    sqlx::query_as(
        "select
           (select count(*) from actions a
             where exists(select 1 from action_assignees x where x.action_id = a.id and x.user_id = $1)
               and a.status in ('open','in_progress')) as my_open_actions,
           (select count(*) from records
             where status not in ('closed','cancelled')) as open_records,
           (select count(*) from records r
             where r.status not in ('closed','cancelled')
               and (r.due_date < current_date or exists(
                    select 1 from actions a where a.record_id = r.id
                       and a.status in ('open','in_progress') and a.due_date < current_date))
           ) as overdue_records,
           (select count(*) from records
             where owner_id is null and status not in ('closed','cancelled')) as unassigned")
        .bind(user).fetch_one(ex).await
}

pub(crate) async fn list_pins(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("select slug from user_pins where user_id = $1 order by pinned_at")
        .bind(user).fetch_all(ex).await
}

pub(crate) async fn insert_pin(ex: impl sqlx::PgExecutor<'_>, user: Uuid, slug: &str) -> Result<(), sqlx::Error> {
    sqlx::query("insert into user_pins (user_id, slug) values ($1, $2) on conflict do nothing")
        .bind(user).bind(slug).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_pin(ex: impl sqlx::PgExecutor<'_>, user: Uuid, slug: &str) -> Result<(), sqlx::Error> {
    sqlx::query("delete from user_pins where user_id = $1 and slug = $2")
        .bind(user).bind(slug).execute(ex).await?;
    Ok(())
}

pub(crate) async fn list_teams(ex: impl sqlx::PgExecutor<'_>, only: Option<Uuid>) -> Result<Vec<(Uuid, i64)>, sqlx::Error> {
    sqlx::query_as(
        "select t.id, (select count(*) from records r
                        where r.team_id = t.id and r.status not in ('closed','cancelled'))
           from teams t where $1::uuid is null or t.id = $1 order by t.name")
        .bind(only).fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct MemberRow {
    pub team_id: Uuid,
    pub user_id: Uuid,
    pub role: TeamRole,
}

pub(crate) async fn list_members(ex: impl sqlx::PgExecutor<'_>, only: Option<Uuid>) -> Result<Vec<MemberRow>, sqlx::Error> {
    sqlx::query_as(
        "select m.team_id, m.user_id, m.role from team_members m join users u on u.id = m.user_id
          where u.is_active and ($1::uuid is null or m.team_id = $1)
          order by case m.role when 'lead' then 0 when 'mentor' then 1 else 2 end, u.name")
        .bind(only).fetch_all(ex).await
}

pub(crate) async fn find_chat(ex: impl sqlx::PgExecutor<'_>, team: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select chat_id from teams where id = $1")
        .bind(team).fetch_optional(ex).await
}

pub(crate) async fn insert_activity(ex: impl sqlx::PgExecutor<'_>, chat: Uuid, actor: Uuid, verb: &str, person: &str, detail: Option<String>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into activity (chat_id, actor_id, verb, subject_label, detail)
         values ($1, $2, $3, $4, $5)")
        .bind(chat).bind(actor).bind(verb).bind(person).bind(detail)
        .execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_role(ex: impl sqlx::PgExecutor<'_>, team: Uuid, user: Uuid) -> Result<Option<TeamRole>, sqlx::Error> {
    sqlx::query_scalar(
        "select role from team_members where team_id = $1 and user_id = $2")
        .bind(team).bind(user).fetch_optional(ex).await
}

pub(crate) async fn upsert_member(ex: impl sqlx::PgExecutor<'_>, team: Uuid, user: Uuid, role: TeamRole) -> Result<(), sqlx::Error> {
    sqlx::query(
            "insert into team_members (team_id, user_id, role) values ($1, $2, $3)
             on conflict (team_id, user_id) do update set role = excluded.role")
        .bind(team).bind(user).bind(role).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_member(ex: impl sqlx::PgExecutor<'_>, team: Uuid, user: Uuid) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "delete from team_members m using users u
          where m.team_id = $1 and m.user_id = $2 and u.id = m.user_id returning u.name")
        .bind(team).bind(user).fetch_optional(ex).await
}
