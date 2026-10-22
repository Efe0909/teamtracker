//! Maliye > tekrarlayan giderler (spec/81 §3.8): aylik/yillik sabit odemeler
//! (abonelik, kira). Genel'deki "yaklasan odemeler" `next_on`'dan beslenir.
//! Gormek "maliye"; yazmak `manage_ledger`. Gider defterine KENDILIGINDEN yazilmaz:
//! odeme olunca kasadan satir elle girilir, sonra `next_on` ileri alinir.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::finance::{need, need_viewer};
use crate::{
    db::recurring as db,
    domain::common,
    error::{AppError, Result},
    finance::cents,
    state::AppState,
};

#[derive(Serialize)]
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

impl From<db::RecurringRow> for Recurring {
    fn from(r: db::RecurringRow) -> Self {
        Self { id: r.id, name: r.name, amount: r.amount, currency: r.currency, every: r.every,
            next_on: r.next_on, category_id: r.category_id, is_active: r.is_active }
    }
}

pub(crate) async fn list(st: &AppState, me: &crate::models::user::User) -> Result<Vec<Recurring>> {
    need_viewer(st, me).await?;
    Ok(db::list_recurring(&st.pool).await?.into_iter().map(Recurring::from).collect())
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
        let ok = db::has_category(&st.pool, c).await?;
        if !ok {
            return Err(AppError::BadRequest("invalid_category"));
        }
    }
    Ok((name, amount, currency))
}

pub(crate) async fn create(st: &AppState, me: &crate::models::user::User, b: RecurringIn) -> Result<Recurring> {
    need(st, me, "manage_ledger").await?;
    let (name, amount, currency) = check(st, &b).await?;
    let id = db::insert_recurring(&st.pool, &name, amount, &currency, &b.every, b.next_on, b.category_id).await?;
    one(st, id).await
}

async fn one(st: &AppState, id: Uuid) -> Result<Recurring> {
    db::find_recurring(&st.pool, id).await?.map(Recurring::from).ok_or(AppError::NotFound)
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
    need(st, me, "manage_ledger").await?;
    let cur = one(st, id).await?;
    // Eksik alanlar mevcut degerden: ayni dogrulama tek yerde.
    let merged = RecurringIn {
        name: b.name.unwrap_or(cur.name),
        amount: b.amount.unwrap_or(cur.amount),
        currency: Some(cur.currency),
        every: b.every.unwrap_or(cur.every),
        next_on: b.next_on.unwrap_or(cur.next_on),
        category_id: b.category_id.unwrap_or(cur.category_id),
    };
    let (name, amount, _) = check(st, &merged).await?;
    db::update_recurring(&st.pool, id, &name, amount, &merged.every, merged.next_on, merged.category_id,
        b.is_active.unwrap_or(cur.is_active)).await?;
    one(st, id).await
}

pub(crate) async fn delete(st: &AppState, me: &crate::models::user::User, id: Uuid) -> Result<serde_json::Value> {
    need(st, me, "manage_ledger").await?;
    let n = db::delete_recurring(&st.pool, id).await?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(serde_json::json!({ "deleted": true }))
}
