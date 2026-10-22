//! llm veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, Utc};
use serde_json::Value;
use uuid::Uuid;
use crate::llm::ProfileRow;

pub(crate) async fn find_config(ex: impl sqlx::PgExecutor<'_>) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar("select config from llm_config").fetch_optional(ex).await
}

pub(crate) async fn find_metadata(ex: impl sqlx::PgExecutor<'_>) -> Result<Option<(DateTime<Utc>, Option<Uuid>)>, sqlx::Error> {
    sqlx::query_as("select updated_at, updated_by from llm_config").fetch_optional(ex).await
}

pub(crate) async fn upsert_config(ex: impl sqlx::PgExecutor<'_>, json: Value, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into llm_config (id, config, updated_by) values (true, $1, $2)
         on conflict (id) do update set config = $1, updated_by = $2, updated_at = now()")
        .bind(json).bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_config(ex: impl sqlx::PgExecutor<'_>) -> Result<(), sqlx::Error> {
    sqlx::query("delete from llm_config").execute(ex).await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
pub(crate) struct LimitRow {
    pub id: Uuid,
    pub profile_id: Uuid,
    pub profile_name: String,
    pub window_minutes: i32,
    pub usd: f64,
    pub spent: f64,
    pub created_at: DateTime<Utc>,
}

pub(crate) async fn list_limits(ex: impl sqlx::PgExecutor<'_>, profile: Option<Uuid>) -> Result<Vec<LimitRow>, sqlx::Error> {
    sqlx::query_as(
        "select l.id, l.profile_id, p.name as profile_name, l.window_minutes, l.usd, l.created_at,
                (select coalesce(sum(c.cost_usd), 0) from llm_calls c
                  where c.profile_id = l.profile_id
                    and c.created_at > now() - make_interval(mins => l.window_minutes)) as spent
           from llm_limits l join llm_profiles p on p.id = l.profile_id
          where $1::uuid is null or l.profile_id = $1
          order by p.name, l.window_minutes")
        .bind(profile).fetch_all(ex).await
}

pub(crate) async fn upsert_limit(ex: impl sqlx::PgExecutor<'_>, profile: Uuid, window: i32, usd: f64, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into llm_limits (profile_id, window_minutes, usd, created_by) values ($1, $2, $3, $4)
         on conflict (profile_id, window_minutes) do update set usd = $3, created_by = $4, created_at = now()")
        .bind(profile).bind(window).bind(usd).bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_limit(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(Uuid, i32)>, sqlx::Error> {
    sqlx::query_as(
        "delete from llm_limits where id = $1 returning profile_id, window_minutes")
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn list_profile_tasks(ex: impl sqlx::PgExecutor<'_>, profile: Uuid) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("select feature from llm_tasks where profile_id = $1 order by feature")
        .bind(profile).fetch_all(ex).await
}

pub(crate) async fn list_profiles(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<ProfileRow>, sqlx::Error> {
    sqlx::query_as(
        "select id, name, endpoint, model, params, tested_at, created_at, updated_at, updated_by
           from llm_profiles order by endpoint, created_at, name")
        .fetch_all(ex).await
}

pub(crate) async fn check_profile_name(ex: impl sqlx::PgExecutor<'_>, name: &str, except: Option<Uuid>) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists (select 1 from llm_profiles where lower(name) = lower($1) and ($2::uuid is null or id <> $2))")
        .bind(name).bind(except).fetch_one(ex).await
}

pub(crate) async fn insert_profile(ex: impl sqlx::PgExecutor<'_>, name: &str, endpoint: &str, model: &str, params: Value, user: Uuid) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into llm_profiles (name, endpoint, model, params, updated_by) values ($1, $2, $3, $4, $5) returning id")
        .bind(name).bind(endpoint).bind(model).bind(params).bind(user).fetch_one(ex).await
}

pub(crate) async fn update_profile(ex: impl sqlx::PgExecutor<'_>, id: Uuid, name: &str, model: &str, params: Value, tested_at: Option<DateTime<Utc>>, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update llm_profiles set name = $2, model = $3, params = $4, tested_at = $5, updated_by = $6, updated_at = now()
          where id = $1")
        .bind(id).bind(name).bind(model).bind(params).bind(tested_at).bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn check_profile_usage(ex: impl sqlx::PgExecutor<'_>, profile: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists (select 1 from llm_tasks where profile_id = $1)")
        .bind(profile).fetch_one(ex).await
}

pub(crate) async fn delete_profile(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from llm_profiles where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn upsert_task(ex: impl sqlx::PgExecutor<'_>, feature: &str, profile: Uuid, batch: Option<i32>, enabled: bool, store_bodies: bool, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into llm_tasks (feature, profile_id, batch, enabled, store_bodies, updated_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (feature) do update set profile_id = $2, batch = $3, enabled = $4, store_bodies = $5,
           updated_by = $6, updated_at = now()")
        .bind(feature).bind(profile).bind(batch).bind(enabled).bind(store_bodies).bind(user)
        .execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_prompt_body(ex: impl sqlx::PgExecutor<'_>, feature: &str, version: i32) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("select body from llm_prompts where feature = $1 and version = $2")
        .bind(feature).bind(version).fetch_optional(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct PromptRow {
    pub version: i32,
    pub body: String,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

pub(crate) async fn list_prompts(ex: impl sqlx::PgExecutor<'_>, feature: &str) -> Result<Vec<PromptRow>, sqlx::Error> {
    sqlx::query_as(
        "select version, body, created_by, created_at from llm_prompts where feature = $1 order by version desc")
        .bind(feature).fetch_all(ex).await
}

pub(crate) async fn insert_prompt(ex: impl sqlx::PgExecutor<'_>, feature: &str, body: &str, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into llm_prompts (feature, version, body, created_by)
         select $1, coalesce(max(version), 0) + 1, $2, $3 from llm_prompts where feature = $1")
        .bind(feature).bind(body).bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_prompt_version(ex: impl sqlx::PgExecutor<'_>, feature: &str, version: i32, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update llm_tasks set prompt_version = nullif($2, 0), updated_by = $3, updated_at = now() where feature = $1")
        .bind(feature).bind(version).bind(user).execute(ex).await?;
    Ok(())
}
