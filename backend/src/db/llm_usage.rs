//! llm_usage veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use uuid::Uuid;
use crate::llm;

pub(crate) struct Filter {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub feature: Option<String>,
    pub model: Option<String>,
    pub user: Option<Uuid>,
    pub status: Option<&'static str>,
}

/// `llm_calls` uzerindeki ortak kosul; $1 TZ, $2..$7 from, to, feature, model, user, status.
/// Makro: sorgu `concat!` ile DERLEMEDE birlesir (sqlx yalniz `&'static str` kabul eder).
macro_rules! calls_where { () => { "
    (c.created_at at time zone $1)::date between $2 and $3
    and ($4::text is null or c.feature = $4)
    and ($5::text is null or c.model = $5)
    and ($6::uuid is null or c.user_id = $6)
    and ($7::text is null
         or ($7 = 'ok' and c.status = 'ok')
         or ($7 = 'limit' and c.status = 'limit')
         or ($7 = 'error' and c.status not in ('ok', 'limit')))" } }

#[derive(sqlx::FromRow)]
pub(crate) struct DayRow {
    pub day: NaiveDate,
    pub feature: String,
    pub model: String,
    pub calls: i64,
    pub errors: i64,
    pub limited: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub cost_usd: f64,
    pub unpriced: i64,
    pub ms_total: i64,
}

#[derive(sqlx::FromRow)]
pub(crate) struct UserRow {
    pub user_id: Option<Uuid>,
    pub calls: i64,
    pub errors: i64,
    pub cost_usd: f64,
}

pub(crate) async fn list_days(ex: impl sqlx::PgExecutor<'_>, f: &Filter, calls_from: NaiveDate) -> Result<Vec<DayRow>, sqlx::Error> {
    sqlx::query_as(concat!(
            "select (c.created_at at time zone $1)::date as day, c.feature, c.model,
                    count(*) filter (where c.status <> 'limit') as calls,
                    count(*) filter (where c.status not in ('ok', 'limit')) as errors,
                    count(*) filter (where c.status = 'limit') as limited,
                    coalesce(sum(c.prompt_tokens), 0)::bigint as prompt_tokens,
                    coalesce(sum(c.completion_tokens), 0)::bigint as completion_tokens,
                    coalesce(sum(c.cost_usd), 0)::float8 as cost_usd,
                    count(*) filter (where c.cost_usd is null and c.status <> 'limit') as unpriced,
                    coalesce(sum(c.ms) filter (where c.status <> 'limit'), 0)::bigint as ms_total
               from llm_calls c where ", calls_where!(), "
              group by 1, 2, 3"))
        .bind(llm::TZ).bind(calls_from).bind(f.to).bind(&f.feature).bind(&f.model).bind(f.user).bind(f.status)
        .fetch_all(ex).await
}

pub(crate) async fn list_daily_summaries(ex: impl sqlx::PgExecutor<'_>, f: &Filter, boundary: NaiveDate) -> Result<Vec<DayRow>, sqlx::Error> {
    sqlx::query_as(
            "select day, feature, model, calls::bigint, errors::bigint, 0::bigint as limited,
                    prompt_tokens, completion_tokens, cost_usd, unpriced::bigint, ms_total
               from llm_usage_daily
              where day between $1 and $2 and day < $3
                and ($4::text is null or feature = $4) and ($5::text is null or model = $5)")
        .bind(f.from).bind(f.to).bind(boundary).bind(&f.feature).bind(&f.model)
        .fetch_all(ex).await
}

pub(crate) async fn list_users(ex: impl sqlx::PgExecutor<'_>, f: &Filter) -> Result<Vec<UserRow>, sqlx::Error> {
    sqlx::query_as(concat!(
        "select c.user_id, count(*) filter (where c.status <> 'limit') as calls,
                count(*) filter (where c.status not in ('ok', 'limit')) as errors,
                coalesce(sum(c.cost_usd), 0)::float8 as cost_usd
           from llm_calls c where ", calls_where!(), "
          group by c.user_id order by cost_usd desc, calls desc"))
        .bind(llm::TZ).bind(f.from).bind(f.to).bind(&f.feature).bind(&f.model).bind(f.user).bind(f.status)
        .fetch_all(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct CallRow {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub feature: String,
    pub model: String,
    pub user_id: Option<Uuid>,
    pub event_id: Option<Uuid>,
    pub is_try: bool,
    pub prompt_version: Option<i32>,
    pub status: String,
    pub http_status: Option<i32>,
    pub error: Option<String>,
    pub ms: i32,
    pub prompt_tokens: Option<i32>,
    pub completion_tokens: Option<i32>,
    pub cost_usd: Option<f64>,
    pub or_gen_id: Option<String>,
    pub batch_id: Option<Uuid>,
    pub asked: Option<i32>,
    pub kept: Option<i32>,
    pub outcome: Option<String>,
    pub has_body: bool,
}

macro_rules! call_cols { () => { "c.id, c.created_at, c.feature, c.model, c.user_id, c.event_id, c.is_try,
    c.prompt_version, c.status, c.http_status, c.error, c.ms, c.prompt_tokens, c.completion_tokens, c.cost_usd,
    c.or_gen_id, c.batch_id, c.asked, c.kept, c.outcome,
    exists (select 1 from llm_call_bodies b where b.call_id = c.id) as has_body" } }

pub(crate) async fn list_calls(ex: impl sqlx::PgExecutor<'_>, f: &Filter, at: Option<DateTime<Utc>>, id: Option<Uuid>, page: i64) -> Result<Vec<CallRow>, sqlx::Error> {
    sqlx::query_as(concat!(
        "select ", call_cols!(), " from llm_calls c
          where ", calls_where!(), " and ($8::timestamptz is null or (c.created_at, c.id) < ($8, $9))
          order by c.created_at desc, c.id desc limit $10"))
        .bind(llm::TZ).bind(f.from).bind(f.to).bind(&f.feature).bind(&f.model).bind(f.user).bind(f.status)
        .bind(at).bind(id).bind(page).fetch_all(ex).await
}

pub(crate) async fn count_calls(ex: impl sqlx::PgExecutor<'_>, f: &Filter) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(concat!("select count(*) from llm_calls c where ", calls_where!()))
        .bind(llm::TZ).bind(f.from).bind(f.to).bind(&f.feature).bind(&f.model).bind(f.user).bind(f.status)
        .fetch_one(ex).await
}

pub(crate) async fn find_call(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<CallRow>, sqlx::Error> {
    sqlx::query_as(concat!("select ", call_cols!(), " from llm_calls c where c.id = $1"))
        .bind(id).fetch_optional(ex).await
}

pub(crate) async fn find_body(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<(Value, Option<String>)>, sqlx::Error> {
    sqlx::query_as("select request, response from llm_call_bodies where call_id = $1")
        .bind(id).fetch_optional(ex).await
}

#[derive(sqlx::FromRow)]
pub(crate) struct StatusRow {
    pub calls: i64,
    pub bodies: i64,
    pub daily_rows: i64,
    pub oldest_call: Option<DateTime<Utc>>,
    pub size_bytes: i64,
}

pub(crate) async fn find_status(ex: impl sqlx::PgExecutor<'_>) -> Result<StatusRow, sqlx::Error> {
    use sqlx::Row;
    let row = sqlx::query(
        "select (select count(*) from llm_calls), (select count(*) from llm_call_bodies),
                (select count(*) from llm_usage_daily), (select min(created_at) from llm_calls),
                (pg_total_relation_size('llm_calls') + pg_total_relation_size('llm_call_bodies')
                 + pg_total_relation_size('llm_usage_daily'))::bigint")
        .fetch_one(ex).await?;
    // Sorgunun adsiz sutunlari mevcut sirayla okunur.
    Ok(StatusRow { calls: row.try_get(0)?, bodies: row.try_get(1)?, daily_rows: row.try_get(2)?, oldest_call: row.try_get(3)?, size_bytes: row.try_get(4)? })
}
