//! Maliye > tekrarlayan giderler (spec/81 §3.8): aylik/yillik sabit odemeler
//! (abonelik, kira). Genel'deki "yaklasan odemeler" `next_on`'dan beslenir.
//! Gormek "maliye"; yazmak `manage_ledger`. Gider defterine KENDILIGINDEN yazilmaz:
//! odeme olunca kasadan satir elle girilir, sonra `next_on` ileri alinir.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::finance::{need, need_viewer};
use crate::{
    api::common,
    error::{AppError, Result},
    finance::cents,
    state::AppState,
};

#[derive(Serialize, sqlx::FromRow)]
pub struct Recurring {
    id: Uuid,
    name: String,
    amount: f64,
    currency: String,
    every: String,
    next_on: NaiveDate,
    category_id: Option<Uuid>,
    is_active: bool,
}

macro_rules! recurring_select {
    () => {
        "select id, name, amount::float8 as amount, currency::text as currency, every, next_on, category_id, is_active
           from recurring_expenses "
    };
}

pub(crate) async fn list(st: &AppState, me: &crate::models::user::User) -> Result<Vec<Recurring>> {
    need_viewer(&st, &me).await?;
    Ok(sqlx::query_as(concat!(recurring_select!(), "order by is_active desc, next_on, name"))
        .fetch_all(&st.pool).await?)
}

#[derive(Deserialize)]
pub struct RecurringIn {
    name: String,
    amount: f64,
    #[serde(default)]
    currency: Option<String>,
    every: String,
    next_on: NaiveDate,
    #[serde(default)]
    category_id: Option<Uuid>,
}

async fn check(st: &AppState, b: &RecurringIn) -> Result<(String, i64, String)> {
    let name = common::text(Some(b.name.clone()), 200, "invalid_name")?.ok_or(AppError::BadRequest("invalid_name"))?;
    let amount = cents(b.amount).ok_or(AppError::BadRequest("invalid_amount"))?;
    if b.every != "month" && b.every != "year" {
        return Err(AppError::BadRequest("invalid_every"));
    }
    let currency = match b.currency.as_deref() {
        None => "TRY".to_string(),
        Some(c @ ("TRY" | "USD" | "EUR")) => c.to_string(),
        Some(_) => return Err(AppError::BadRequest("invalid_currency")),
    };
    if let Some(c) = b.category_id {
        let ok: bool = sqlx::query_scalar("select exists(select 1 from nodes where id = $1 and node_type = 'category')")
            .bind(c).fetch_one(&st.pool).await?;
        if !ok {
            return Err(AppError::BadRequest("invalid_category"));
        }
    }
    Ok((name, amount, currency))
}

pub(crate) async fn create(st: &AppState, me: &crate::models::user::User, b: RecurringIn) -> Result<Recurring> {
    need(&st, &me, "manage_ledger").await?;
    let (name, amount, currency) = check(&st, &b).await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into recurring_expenses (name, amount, currency, every, next_on, category_id)
         values ($1, $2::bigint::numeric / 100, $3, $4, $5, $6) returning id")
        .bind(&name).bind(amount).bind(&currency).bind(&b.every).bind(b.next_on).bind(b.category_id)
        .fetch_one(&st.pool).await?;
    one(st, id).await
}

async fn one(st: &AppState, id: Uuid) -> Result<Recurring> {
    sqlx::query_as(concat!(recurring_select!(), "where id = $1"))
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)
}

#[derive(Deserialize)]
pub struct RecurringPatch {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    amount: Option<f64>,
    #[serde(default)]
    every: Option<String>,
    #[serde(default)]
    next_on: Option<NaiveDate>,
    #[serde(default)]
    is_active: Option<bool>,
    #[serde(default, deserialize_with = "common::present")]
    category_id: Option<Option<Uuid>>,
}

pub(crate) async fn patch(st: &AppState, me: &crate::models::user::User, id: Uuid, b: RecurringPatch) -> Result<Recurring> {
    need(&st, &me, "manage_ledger").await?;
    let cur = one(&st, id).await?;
    // Eksik alanlar mevcut degerden: ayni dogrulama tek yerde.
    let merged = RecurringIn {
        name: b.name.unwrap_or(cur.name),
        amount: b.amount.unwrap_or(cur.amount),
        currency: Some(cur.currency),
        every: b.every.unwrap_or(cur.every),
        next_on: b.next_on.unwrap_or(cur.next_on),
        category_id: b.category_id.unwrap_or(cur.category_id),
    };
    let (name, amount, _) = check(&st, &merged).await?;
    sqlx::query(
        "update recurring_expenses set name = $2, amount = $3::bigint::numeric / 100, every = $4, next_on = $5,
                category_id = $6, is_active = $7 where id = $1")
        .bind(id).bind(&name).bind(amount).bind(&merged.every).bind(merged.next_on).bind(merged.category_id)
        .bind(b.is_active.unwrap_or(cur.is_active)).execute(&st.pool).await?;
    one(st, id).await
}

pub(crate) async fn delete(st: &AppState, me: &crate::models::user::User, id: Uuid) -> Result<serde_json::Value> {
    need(&st, &me, "manage_ledger").await?;
    let n = sqlx::query("delete from recurring_expenses where id = $1")
        .bind(id).execute(&st.pool).await?.rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(serde_json::json!({ "deleted": true }))
}
