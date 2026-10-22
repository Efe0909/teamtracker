//! recurring veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::NaiveDate;
use uuid::Uuid;

#[derive(sqlx::FromRow)]
pub(crate) struct RecurringRow {
    pub id: Uuid,
    pub name: String,
    pub amount: f64,
    pub currency: String,
    pub every: String,
    pub next_on: NaiveDate,
    pub category_id: Option<Uuid>,
    pub is_active: bool,
}

macro_rules! recurring_select {
    () => {
        "select id, name, amount::float8 as amount, currency::text as currency, every, next_on, category_id, is_active
           from recurring_expenses "
    };
}

pub(crate) async fn list_recurring(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<RecurringRow>, sqlx::Error> {
    sqlx::query_as(concat!(recurring_select!(), "order by is_active desc, next_on, name"))
        .fetch_all(ex).await
}

pub(crate) async fn has_category(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from nodes where id = $1 and node_type = 'category')")
        .bind(id).fetch_one(ex).await
}

pub(crate) async fn insert_recurring(ex: impl sqlx::PgExecutor<'_>, name: &str, amount: i64, currency: &str, every: &str, next_on: NaiveDate, category_id: Option<Uuid>) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into recurring_expenses (name, amount, currency, every, next_on, category_id)
         values ($1, $2::bigint::numeric / 100, $3, $4, $5, $6) returning id")
        .bind(name).bind(amount).bind(currency).bind(every).bind(next_on).bind(category_id)
        .fetch_one(ex).await
}

pub(crate) async fn find_recurring(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<RecurringRow>, sqlx::Error> {
    sqlx::query_as(concat!(recurring_select!(), "where id = $1"))
        .bind(id).fetch_optional(ex).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn update_recurring(ex: impl sqlx::PgExecutor<'_>, id: Uuid, name: &str, amount: i64, every: &str, next_on: NaiveDate, category_id: Option<Uuid>, is_active: bool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update recurring_expenses set name = $2, amount = $3::bigint::numeric / 100, every = $4, next_on = $5,
                category_id = $6, is_active = $7 where id = $1")
        .bind(id).bind(name).bind(amount).bind(every).bind(next_on).bind(category_id)
        .bind(is_active).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_recurring(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("delete from recurring_expenses where id = $1")
        .bind(id).execute(ex).await?.rows_affected())
}
