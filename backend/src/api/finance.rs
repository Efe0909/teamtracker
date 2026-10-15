//! Maliye uclari (spec/81): fatura gonder/onayla, SEB iade dosyalari, kasa
//! defteri, ozet, kur.
//!
//! Yetki (spec/81 §4): fatura GONDERMEK ve kendi faturasini gormek herkese;
//! sayfanin geri kalani "maliye"ye (admin ya da review_purchases,
//! manage_budgets, manage_ledger, manage_purchases'tan biri). Yazma ayrica:
//! onay/dosya `review_purchases`, defter ve odeme `manage_ledger`.
//!
//! Para kurusta dogrulanir (`finance::cents`), DB'ye `$::bigint::numeric / 100`
//! ile yazilir, `::float8` ile okunur. Toplam esitligi DB'de de ertelenmis
//! tetikleyiciyle korunur (goc 028).

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgConnection;
use uuid::Uuid;

use crate::{
    api::{attachments::{self as att, AttachView}, common::{self, Body}},
    audit,
    auth::CurrentUser,
    config::Service,
    error::{AppError, Result},
    finance::{self, cents, micros},
    llm::TZ,
    media::Purpose,
    models::user::User,
    state::AppState,
};

const NOTE_MAX: usize = 2000;
const DESC_MAX: usize = 300;
const ITEMS_MAX: usize = 50;
const ATTACH_MAX: usize = 10;
const UPCOMING_DAYS: i64 = 30;

// --- yetki ------------------------------------------------------------------

const VIEW_SCOPES: [&str; 4] = ["review_purchases", "manage_budgets", "manage_ledger", "manage_purchases"];

pub(super) async fn is_viewer(st: &AppState, me: &User) -> Result<bool> {
    if me.is_admin {
        return Ok(true);
    }
    let active = crate::db::scope::active(&st.pool, me).await?;
    Ok(VIEW_SCOPES.iter().any(|s| active.iter().any(|a| a == s)))
}

pub(super) async fn need_viewer(st: &AppState, me: &User) -> Result<()> {
    if is_viewer(st, me).await? { Ok(()) } else { Err(AppError::Forbidden) }
}

pub(super) async fn need(st: &AppState, me: &User, scope: &'static str) -> Result<()> {
    if common::has_scope(st, me, scope).await? { Ok(()) } else { Err(AppError::Denied(scope_denied(scope))) }
}

fn scope_denied(scope: &str) -> &'static str {
    match scope {
        "review_purchases" => "review_purchases_required",
        "manage_ledger" => "manage_ledger_required",
        "manage_purchases" => "manage_purchases_required",
        _ => "forbidden",
    }
}

/// Istanbul gunu: sunucu UTC; gece yarisindan sonraki 3 saat "dun" gorunmesin.
/// Turkiye 2016'dan beri sabit UTC+3 (yaz saati yok).
pub(super) fn today() -> NaiveDate {
    (Utc::now() + chrono::Duration::hours(3)).date_naive()
}

fn text(v: Option<String>, max: usize, code: &'static str) -> Result<Option<String>> {
    common::text(v, max, code)
}

// --- fatura: gonder ----------------------------------------------------------

#[derive(Deserialize)]
pub struct ItemIn {
    material_id: Uuid,
    amount: f64,
}

#[derive(Deserialize)]
pub struct InvoiceIn {
    purchased_on: NaiveDate,
    #[serde(default)]
    currency: Option<String>,
    total: f64,
    #[serde(default)]
    fx_rate: Option<f64>,
    #[serde(default)]
    fx_on: Option<NaiveDate>,
    #[serde(default)]
    fx_source: Option<String>,
    paid_by: String,
    #[serde(default)]
    payee_account_id: Option<Uuid>,
    #[serde(default)]
    vendor_id: Option<Uuid>,
    #[serde(default)]
    note: Option<String>,
    items: Vec<ItemIn>,
    attachment_ids: Vec<Uuid>,
}

/// Dogrulanmis fatura: para kurusta, kur milyonda birde.
struct Valid {
    purchased_on: NaiveDate,
    currency: String,
    total: i64,
    fx: Option<(i64, NaiveDate, &'static str)>,
    paid_by: &'static str,
    payee: Option<Uuid>,
    vendor: Option<Uuid>,
    note: Option<String>,
    items: Vec<(Uuid, i64)>,
    attachments: Vec<Uuid>,
}

/// Biçim kurallari (DB'siz); test edilebilir.
fn shape(b: InvoiceIn, today: NaiveDate) -> Result<Valid> {
    if b.purchased_on > today || b.purchased_on < today - chrono::Duration::days(366) {
        return Err(AppError::BadRequest("invalid_date"));
    }
    let currency = match b.currency.as_deref() {
        None => "TRY".to_string(),
        Some(c) => finance::currency(c).ok_or(AppError::BadRequest("invalid_currency"))?,
    };
    let total = cents(b.total).ok_or(AppError::BadRequest("invalid_amount"))?;
    let fx = if currency == "TRY" {
        if b.fx_rate.is_some() {
            return Err(AppError::BadRequest("invalid_fx"));
        }
        None
    } else {
        let rate = b.fx_rate.and_then(micros).ok_or(AppError::BadRequest("fx_rate_required"))?;
        let on = b.fx_on.unwrap_or(b.purchased_on);
        if on > b.purchased_on || on < b.purchased_on - chrono::Duration::days(7) {
            return Err(AppError::BadRequest("invalid_fx"));
        }
        let source = match b.fx_source.as_deref() {
            Some("tcmb") => "tcmb",
            Some("manual") | None => "manual",
            Some(_) => return Err(AppError::BadRequest("invalid_fx")),
        };
        Some((rate, on, source))
    };
    let paid_by = match b.paid_by.as_str() {
        "member" => "member",
        "club" => "club",
        _ => return Err(AppError::BadRequest("invalid_paid_by")),
    };
    let payee = match (paid_by, b.payee_account_id) {
        ("member", Some(a)) => Some(a),
        ("member", None) => return Err(AppError::BadRequest("account_required")),
        _ => None,
    };
    if b.items.is_empty() || b.items.len() > ITEMS_MAX {
        return Err(AppError::BadRequest("invoice_items_required"));
    }
    let mut items: Vec<(Uuid, i64)> = Vec::with_capacity(b.items.len());
    for it in b.items {
        if items.iter().any(|(m, _)| *m == it.material_id) {
            return Err(AppError::BadRequest("duplicate_item"));
        }
        items.push((it.material_id, cents(it.amount).ok_or(AppError::BadRequest("invalid_amount"))?));
    }
    if items.iter().map(|(_, a)| a).sum::<i64>() != total {
        return Err(AppError::BadRequest("invoice_split_mismatch"));
    }
    let mut attachments = b.attachment_ids;
    attachments.sort();
    attachments.dedup();
    if attachments.is_empty() || attachments.len() > ATTACH_MAX {
        return Err(AppError::BadRequest("attachment_required"));
    }
    Ok(Valid {
        purchased_on: b.purchased_on, currency, total, fx, paid_by, payee, vendor: b.vendor_id,
        note: text(b.note, NOTE_MAX, "invalid_note")?, items, attachments,
    })
}

/// DB'ye bakan kurallar: hesap kisinin, kalemler onayli, tedarikci canli, ekler bagsiz.
async fn check_refs(tx: &mut PgConnection, me: &User, v: &mut Valid) -> Result<()> {
    if let Some(a) = v.payee {
        let ok: bool = sqlx::query_scalar(
            "select exists(select 1 from bank_accounts where id = $1 and user_id = $2 and deleted_at is null)")
            .bind(a).bind(me.id).fetch_one(&mut *tx).await?;
        if !ok {
            return Err(AppError::BadRequest("account_required"));
        }
    }
    let ids: Vec<Uuid> = v.items.iter().map(|(m, _)| *m).collect();
    let ok: i64 = sqlx::query_scalar(
        "select count(*) from materials where id = any($1) and state = 3 and not owned")
        .bind(&ids).fetch_one(&mut *tx).await?;
    if ok as usize != ids.len() {
        return Err(AppError::BadRequest("material_not_approved"));
    }
    if let Some(vd) = v.vendor {
        let live: bool = sqlx::query_scalar("select exists(select 1 from vendors where id = $1 and merged_into is null)")
            .bind(vd).fetch_one(&mut *tx).await?;
        if !live {
            return Err(AppError::BadRequest("invalid_vendor"));
        }
    }
    att::claimable_for(&mut *tx, me.id, &mut v.attachments, Purpose::Invoice).await
}

async fn write_body(tx: &mut PgConnection, id: Uuid, v: &Valid) -> Result<()> {
    let (ids, amounts): (Vec<Uuid>, Vec<i64>) = v.items.iter().copied().unzip();
    sqlx::query(
        "insert into invoice_items (invoice_id, material_id, amount)
         select $1, m, a::numeric / 100 from unnest($2::uuid[], $3::bigint[]) as t(m, a)")
        .bind(id).bind(&ids).bind(&amounts).execute(&mut *tx).await?;
    sqlx::query("insert into invoice_attachments (invoice_id, attachment_id) select $1, unnest($2::uuid[])")
        .bind(id).bind(&v.attachments).execute(&mut *tx).await?;
    Ok(())
}

async fn review(tx: &mut PgConnection, id: Uuid, action: &str, note: Option<&str>, by: Uuid) -> Result<()> {
    sqlx::query("insert into invoice_reviews (invoice_id, action, note, by_user) values ($1, $2, $3, $4)")
        .bind(id).bind(action).bind(note).bind(by).execute(&mut *tx).await?;
    Ok(())
}

pub async fn submit(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<InvoiceIn>,
) -> Result<Json<InvoiceView>> {
    let mut v = shape(b, today())?;
    let mut tx = st.pool.begin().await?;
    check_refs(&mut tx, &me, &mut v).await?;
    let (fx_rate, fx_on, fx_source) = match v.fx {
        Some((r, on, s)) => (Some(r), Some(on), Some(s)),
        None => (None, None, None),
    };
    let id: Uuid = sqlx::query_scalar(
        "insert into invoices (submitted_by, purchased_on, currency, total, fx_rate, fx_on, fx_source,
                               paid_by, payee_account_id, vendor_id, note)
         values ($1, $2, $3, $4::bigint::numeric / 100, $5::bigint::numeric / 1000000, $6, $7, $8, $9, $10, $11)
         returning id")
        .bind(me.id).bind(v.purchased_on).bind(&v.currency).bind(v.total).bind(fx_rate).bind(fx_on)
        .bind(fx_source).bind(v.paid_by).bind(v.payee).bind(v.vendor).bind(&v.note)
        .fetch_one(&mut *tx).await?;
    write_body(&mut tx, id, &v).await?;
    review(&mut tx, id, "submit", None, me.id).await?;
    tx.commit().await?;
    Ok(Json(view(&st, &me, id).await?))
}

/// Gonderen, `pending` ya da `changes_requested` faturasini butunuyle yeniden
/// yazar; durum `pending`'e doner (`resubmit`).
pub async fn edit(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<InvoiceIn>,
) -> Result<Json<InvoiceView>> {
    let id = common::id(&raw)?;
    let mut v = shape(b, today())?;
    let mut tx = st.pool.begin().await?;
    let row: Option<(Uuid, String)> = sqlx::query_as("select submitted_by, status from invoices where id = $1 for update")
        .bind(id).fetch_optional(&mut *tx).await?;
    let (owner, status) = row.ok_or(AppError::NotFound)?;
    if owner != me.id {
        return Err(AppError::NotFound);
    }
    if status != "pending" && status != "changes_requested" {
        return Err(AppError::Conflict("invoice_locked"));
    }
    // Eski baglar once kalkar: ayni ek yeniden secilmisse bagsiz gorunsun.
    sqlx::query("delete from invoice_items where invoice_id = $1").bind(id).execute(&mut *tx).await?;
    sqlx::query("delete from invoice_attachments where invoice_id = $1").bind(id).execute(&mut *tx).await?;
    check_refs(&mut tx, &me, &mut v).await?;
    let (fx_rate, fx_on, fx_source) = match v.fx {
        Some((r, on, s)) => (Some(r), Some(on), Some(s)),
        None => (None, None, None),
    };
    sqlx::query(
        "update invoices set purchased_on = $2, currency = $3, total = $4::bigint::numeric / 100,
                fx_rate = $5::bigint::numeric / 1000000, fx_on = $6, fx_source = $7, paid_by = $8,
                payee_account_id = $9, vendor_id = $10, note = $11, status = 'pending', updated_at = now()
          where id = $1")
        .bind(id).bind(v.purchased_on).bind(&v.currency).bind(v.total).bind(fx_rate).bind(fx_on)
        .bind(fx_source).bind(v.paid_by).bind(v.payee).bind(v.vendor).bind(&v.note)
        .execute(&mut *tx).await?;
    write_body(&mut tx, id, &v).await?;
    review(&mut tx, id, "resubmit", None, me.id).await?;
    tx.commit().await?;
    Ok(Json(view(&st, &me, id).await?))
}

// --- fatura: gorunum ---------------------------------------------------------

#[derive(Serialize)]
pub struct InvoiceView {
    id: Uuid,
    submitted_by: Uuid,
    purchased_on: NaiveDate,
    currency: String,
    total: f64,
    fx_rate: Option<f64>,
    fx_on: Option<NaiveDate>,
    fx_source: Option<String>,
    total_try: f64,
    paid_by: String,
    payee: Option<Payee>,
    vendor: Option<Value>,
    note: Option<String>,
    status: String,
    claim_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    items: Vec<ItemView>,
    /// Kalemlerden TURETILEN etkinlikler (D-3): saklanmaz.
    events: Vec<Value>,
    attachments: Vec<AttachView>,
    reviews: Vec<ReviewView>,
    can_review: bool,
    can_edit: bool,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Payee {
    id: Uuid,
    label: String,
    holder_name: String,
    /// Tam IBAN yalniz gonderen ve maliye icin (spec/82 §4.3).
    iban: Option<String>,
    iban_last4: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ItemView {
    material_id: Uuid,
    name: String,
    amount: f64,
    funding: Option<String>,
    event_id: Option<Uuid>,
    event_title: Option<String>,
    event_date: Option<NaiveDate>,
    category_id: Option<Uuid>,
    budget: Option<f64>,
    purchased: bool,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ReviewView {
    action: String,
    note: Option<String>,
    by_user: Option<Uuid>,
    at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct InvoiceRow {
    id: Uuid,
    submitted_by: Uuid,
    purchased_on: NaiveDate,
    currency: String,
    total: f64,
    fx_rate: Option<f64>,
    fx_on: Option<NaiveDate>,
    fx_source: Option<String>,
    total_try: f64,
    paid_by: String,
    payee_account_id: Option<Uuid>,
    vendor_id: Option<Uuid>,
    vendor_name: Option<String>,
    note: Option<String>,
    status: String,
    claim_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

async fn view(st: &AppState, me: &User, id: Uuid) -> Result<InvoiceView> {
    let r: InvoiceRow = sqlx::query_as(
        "select i.id, i.submitted_by, i.purchased_on, i.currency::text as currency, i.total::float8 as total,
                i.fx_rate::float8 as fx_rate, i.fx_on, i.fx_source, i.total_try::float8 as total_try, i.paid_by,
                i.payee_account_id, i.vendor_id, v.name as vendor_name, i.note, i.status, i.claim_id,
                i.created_at, i.updated_at
           from invoices i left join vendors v on v.id = i.vendor_id
          where i.id = $1")
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;
    let viewer = is_viewer(st, me).await?;
    if r.submitted_by != me.id && !viewer {
        return Err(AppError::NotFound);
    }
    let payee = match r.payee_account_id {
        Some(a) => {
            let p: Payee = sqlx::query_as(
                "select id, label, holder_name, iban, iban_last4 from bank_accounts where id = $1")
                .bind(a).fetch_one(&st.pool).await?;
            if r.submitted_by != me.id && p.iban.is_some() {
                // Maliye tam IBAN'i yalniz burada gorur; kim baktigi yazilir.
                audit::log_event(st, None, "iban_viewed", Some(me.id), None, Some(&format!("invoice {id}"))).await;
            }
            Some(p)
        }
        None => None,
    };
    let items: Vec<ItemView> = sqlx::query_as(
        "select ii.material_id, m.name, ii.amount::float8 as amount, ii.funding,
                e.id as event_id, e.title as event_title, e.date as event_date,
                m.category_id, m.budget::float8 as budget, m.purchased
           from invoice_items ii
           join materials m on m.id = ii.material_id
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id
          where ii.invoice_id = $1 order by e.date nulls last, m.name")
        .bind(id).fetch_all(&st.pool).await?;
    let mut events: Vec<Value> = Vec::new();
    for it in &items {
        if let Some(eid) = it.event_id {
            if !events.iter().any(|e| e["id"] == json!(eid)) {
                events.push(json!({ "id": eid, "title": it.event_title, "date": it.event_date }));
            }
        }
    }
    let attach_ids: Vec<Uuid> = sqlx::query_scalar(
        "select attachment_id from invoice_attachments where invoice_id = $1").bind(id).fetch_all(&st.pool).await?;
    let mut map = att::views(&st.pool, me, &attach_ids, false).await?;
    let attachments = attach_ids.iter().filter_map(|a| map.remove(a)).collect();
    let reviews: Vec<ReviewView> = sqlx::query_as(
        "select action, note, by_user, at from invoice_reviews where invoice_id = $1 order by at")
        .bind(id).fetch_all(&st.pool).await?;
    let can_review = common::has_scope(st, me, "review_purchases").await?;
    Ok(InvoiceView {
        id: r.id, submitted_by: r.submitted_by, purchased_on: r.purchased_on, currency: r.currency,
        total: r.total, fx_rate: r.fx_rate, fx_on: r.fx_on, fx_source: r.fx_source, total_try: r.total_try,
        paid_by: r.paid_by, payee,
        vendor: r.vendor_id.map(|v| json!({ "id": v, "name": r.vendor_name })),
        note: r.note, can_edit: r.submitted_by == me.id && matches!(r.status.as_str(), "pending" | "changes_requested"),
        status: r.status, claim_id: r.claim_id, created_at: r.created_at, updated_at: r.updated_at,
        items, events, attachments, reviews, can_review,
    })
}

pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<InvoiceView>> {
    Ok(Json(view(&st, &me, common::id(&raw)?).await?))
}

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    mine: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct InvoiceRowOut {
    id: Uuid,
    submitted_by: Uuid,
    purchased_on: NaiveDate,
    currency: String,
    total: f64,
    total_try: f64,
    paid_by: String,
    status: String,
    claim_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    item_count: i64,
    first_item: Option<String>,
    event_titles: Vec<String>,
    attachment_count: i64,
}

/// Liste: maliye herkesinkini, digerleri yalniz kendisininkini (`mine`).
pub async fn list(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<ListQuery>,
) -> Result<Json<Vec<InvoiceRowOut>>> {
    let mine = q.mine.as_deref() == Some("1") || !is_viewer(&st, &me).await?;
    Ok(Json(sqlx::query_as(
        "select i.id, i.submitted_by, i.purchased_on, i.currency::text as currency, i.total::float8 as total,
                i.total_try::float8 as total_try, i.paid_by, i.status, i.claim_id, i.created_at,
                (select count(*) from invoice_items x where x.invoice_id = i.id) as item_count,
                (select m.name from invoice_items x join materials m on m.id = x.material_id
                  where x.invoice_id = i.id order by m.name limit 1) as first_item,
                array(select distinct e.title from invoice_items x
                        join event_materials em on em.material_id = x.material_id
                        join events e on e.id = em.event_id where x.invoice_id = i.id) as event_titles,
                (select count(*) from invoice_attachments x where x.invoice_id = i.id) as attachment_count
           from invoices i
          where ($1::text is null or i.status = $1) and (not $2 or i.submitted_by = $3)
          order by (i.status = 'pending') desc, i.created_at desc limit 300")
        .bind(q.status).bind(mine).bind(me.id).fetch_all(&st.pool).await?))
}

// --- fatura: karar -----------------------------------------------------------

#[derive(Deserialize)]
pub struct DecisionIn {
    action: String,
    #[serde(default)]
    note: Option<String>,
    /// Onayda: aylik dosya yerine bu (taslak) dosya.
    #[serde(default)]
    claim_id: Option<Uuid>,
}

pub async fn decide(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<DecisionIn>,
) -> Result<Json<InvoiceView>> {
    let id = common::id(&raw)?;
    let note = text(b.note, NOTE_MAX, "invalid_note")?;
    let mut tx = st.pool.begin().await?;
    let row: Option<(Uuid, String, NaiveDate, String, Option<Uuid>)> = sqlx::query_as(
        "select submitted_by, status, purchased_on, paid_by, claim_id from invoices where id = $1 for update")
        .bind(id).fetch_optional(&mut *tx).await?;
    let (owner, status, purchased_on, paid_by, claim) = row.ok_or(AppError::NotFound)?;
    if b.action != "withdraw" {
        need(&st, &me, "review_purchases").await?;
    }
    if matches!(b.action.as_str(), "changes" | "reject" | "cancel") && note.is_none() {
        return Err(AppError::BadRequest("note_required"));
    }
    let next = match b.action.as_str() {
        "withdraw" => {
            if owner != me.id {
                return Err(AppError::NotFound);
            }
            if !matches!(status.as_str(), "pending" | "changes_requested") {
                return Err(AppError::Conflict("invoice_locked"));
            }
            "withdrawn"
        }
        "changes" | "reject" => {
            let ok = if b.action == "changes" { status == "pending" } else { matches!(status.as_str(), "pending" | "changes_requested") };
            if !ok {
                return Err(AppError::Conflict("invoice_locked"));
            }
            if b.action == "changes" { "changes_requested" } else { "rejected" }
        }
        "approve" => {
            if status != "pending" {
                return Err(AppError::Conflict("invoice_locked"));
            }
            approve(&mut tx, &me, id, purchased_on, &paid_by, b.claim_id).await?;
            "approved"
        }
        "cancel" => {
            if status != "approved" {
                return Err(AppError::Conflict("invoice_locked"));
            }
            cancel(&mut tx, &me, id, claim).await?;
            "cancelled"
        }
        _ => return Err(AppError::BadRequest("invalid_action")),
    };
    sqlx::query("update invoices set status = $2, updated_at = now() where id = $1")
        .bind(id).bind(next).execute(&mut *tx).await?;
    review(&mut tx, id, &b.action, note.as_deref(), me.id).await?;
    tx.commit().await?;
    Ok(Json(view(&st, &me, id).await?))
}

/// Onayin etkileri (spec/81 §6.2), tek islemde.
async fn approve(
    tx: &mut PgConnection, me: &User, id: Uuid, purchased_on: NaiveDate, paid_by: &str, claim: Option<Uuid>,
) -> Result<()> {
    // Kalem hala onayli mi (gonderimden beri geri alinmis olabilir).
    let bad: i64 = sqlx::query_scalar(
        "select count(*) from invoice_items ii join materials m on m.id = ii.material_id
          where ii.invoice_id = $1 and not (m.state = 3 and not m.owned)")
        .bind(id).fetch_one(&mut *tx).await?;
    if bad > 0 {
        return Err(AppError::Conflict("material_not_approved"));
    }
    // Once durum: dosya bagi (`claim_id`) yalniz onayli faturada olabilir (kisit).
    sqlx::query("update invoices set status = 'approved' where id = $1").bind(id).execute(&mut *tx).await?;
    // 1. Fonlama donar: kategorinin ledger'i, kategori yoksa SEB (spec/81 §3.3).
    sqlx::query(
        "update invoice_items ii set funding = coalesce(
           (select n.attrs->>'ledger' from materials m join nodes n on n.id = m.category_id
             where m.id = ii.material_id), 'seb')
          where ii.invoice_id = $1")
        .bind(id).execute(&mut *tx).await?;
    // 2. Kalemler satin alindi (zaten alinmissa dokunulmaz).
    sqlx::query(
        "update materials set purchased = true, purchased_at = now(), purchased_by = $2, updated_at = now()
          where id in (select material_id from invoice_items where invoice_id = $1) and not purchased")
        .bind(id).bind(me.id).execute(&mut *tx).await?;
    // 3. Kasadan odendiyse defterde gider.
    if paid_by == "club" {
        sqlx::query(
            "insert into ledger_entries (occurred_on, amount, kind, description, invoice_id, created_by)
             select $2, -i.total_try, 'purchase',
                    left('Satın alım · ' || coalesce((select string_agg(m.name, ', ' order by m.name)
                         from invoice_items x join materials m on m.id = x.material_id where x.invoice_id = i.id), ''), 300),
                    i.id, $3
               from invoices i where i.id = $1")
            .bind(id).bind(purchased_on).bind(me.id).execute(&mut *tx).await?;
    }
    // 4. SEB fonlu kalem varsa dosyaya: verilen taslak dosya ya da ayin dosyasi.
    let seb: bool = sqlx::query_scalar(
        "select exists(select 1 from invoice_items where invoice_id = $1 and funding = 'seb')")
        .bind(id).fetch_one(&mut *tx).await?;
    if seb {
        let target = match claim {
            Some(c) => {
                let draft: bool = sqlx::query_scalar(
                    "select exists(select 1 from reimbursement_claims where id = $1 and status = 'draft')")
                    .bind(c).fetch_one(&mut *tx).await?;
                if !draft {
                    return Err(AppError::Conflict("claim_locked"));
                }
                Some(c)
            }
            None => monthly_claim(tx, me, purchased_on).await?,
        };
        sqlx::query("update invoices set claim_id = $2 where id = $1").bind(id).bind(target).execute(&mut *tx).await?;
    }
    Ok(())
}

/// Ayin dosyasi; yoksa taslak acilir. Dosya gonderilmisse None (fatura dosyasiz
/// kalir, Genel'de "dosyasiz SEB faturasi" olarak gorunur ve elle tasinir).
async fn monthly_claim(tx: &mut PgConnection, me: &User, day: NaiveDate) -> Result<Option<Uuid>> {
    sqlx::query(
        "insert into reimbursement_claims (kind, month, created_by)
         values ('monthly', date_trunc('month', $1::date)::date, $2)
         on conflict (month) where kind = 'monthly' do nothing")
        .bind(day).bind(me.id).execute(&mut *tx).await?;
    Ok(sqlx::query_scalar(
        "select id from reimbursement_claims where kind = 'monthly' and month = date_trunc('month', $1::date)::date
            and status = 'draft'")
        .bind(day).fetch_optional(&mut *tx).await?)
}

/// Iptal (spec/81 §6.3): dosyadan cikar, kasa giderinin ters kaydi, baska onayli
/// faturasi olmayan kalemin satin alindi isareti kalkar.
async fn cancel(tx: &mut PgConnection, me: &User, id: Uuid, claim: Option<Uuid>) -> Result<()> {
    if let Some(c) = claim {
        let draft: bool = sqlx::query_scalar(
            "select status = 'draft' from reimbursement_claims where id = $1").bind(c).fetch_one(&mut *tx).await?;
        if !draft {
            return Err(AppError::Conflict("claim_locked"));
        }
    }
    sqlx::query("update invoices set claim_id = null where id = $1").bind(id).execute(&mut *tx).await?;
    sqlx::query(
        "insert into ledger_entries (occurred_on, amount, kind, description, reverses_id, created_by)
         select (now() at time zone $3)::date, -e.amount, 'reversal', left('Ters kayıt · ' || e.description, 300), e.id, $2
           from ledger_entries e
          where e.invoice_id = $1 and e.kind = 'purchase'
            and not exists (select 1 from ledger_entries r where r.reverses_id = e.id)")
        .bind(id).bind(me.id).bind(TZ).execute(&mut *tx).await?;
    sqlx::query(
        "update materials m set purchased = false, purchased_at = null, purchased_by = null, updated_at = now()
          where m.id in (select material_id from invoice_items where invoice_id = $1)
            and not exists (select 1 from invoice_items x join invoices i on i.id = x.invoice_id
                             where x.material_id = m.id and i.status = 'approved' and i.id <> $1)")
        .bind(id).execute(&mut *tx).await?;
    Ok(())
}

/// Onayli faturayi baska bir taslak dosyaya tasir (ya da dosyadan cikarir).
#[derive(Deserialize)]
pub struct ClaimMove {
    claim_id: Option<Uuid>,
}

pub async fn move_claim(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<ClaimMove>,
) -> Result<Json<InvoiceView>> {
    need(&st, &me, "review_purchases").await?;
    let id = common::id(&raw)?;
    let mut tx = st.pool.begin().await?;
    let row: Option<(String, Option<Uuid>)> = sqlx::query_as("select status, claim_id from invoices where id = $1 for update")
        .bind(id).fetch_optional(&mut *tx).await?;
    let (status, old) = row.ok_or(AppError::NotFound)?;
    if status != "approved" {
        return Err(AppError::Conflict("invoice_locked"));
    }
    for c in [old, b.claim_id].into_iter().flatten() {
        let draft: Option<bool> = sqlx::query_scalar("select status = 'draft' from reimbursement_claims where id = $1")
            .bind(c).fetch_optional(&mut *tx).await?;
        if draft != Some(true) {
            return Err(AppError::Conflict("claim_locked"));
        }
    }
    sqlx::query("update invoices set claim_id = $2, updated_at = now() where id = $1")
        .bind(id).bind(b.claim_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(view(&st, &me, id).await?))
}

// --- fatura formu: secilebilir kalemler ----------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct Purchasable {
    id: Uuid,
    name: String,
    qty: i32,
    price: Option<f64>,
    category_id: Option<Uuid>,
    purchased: bool,
    event_id: Option<Uuid>,
    event_title: Option<String>,
    event_date: Option<NaiveDate>,
}

/// Fatura formunun kalem listesi: onayli ve elde olmayan kalemler, etkinlikle
/// (etkinlik listesi herkese acik, spec/73) ya da etkinliksiz. Son bir yil.
pub async fn purchasable(State(st): State<AppState>, CurrentUser(_me): CurrentUser) -> Result<Json<Vec<Purchasable>>> {
    Ok(Json(sqlx::query_as(
        "select m.id, m.name, m.qty,
                (case when m.sponsor_chosen then 0
                      else coalesce((select p.price from material_providers p where p.id = m.chosen_provider_id),
                                    (select min(p.price) from material_providers p where p.material_id = m.id)) end)::float8 as price,
                m.category_id, m.purchased, e.id as event_id, e.title as event_title, e.date as event_date
           from materials m
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id
          where m.state = 3 and not m.owned
            and (e.id is null or e.date is null or e.date >= current_date - 365)
            and (e.id is not null or m.created_at >= now() - interval '1 year')
          order by e.date desc nulls first, e.title, m.name")
        .fetch_all(&st.pool).await?))
}

// --- SEB iade dosyalari ---------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct ClaimOut {
    id: Uuid,
    kind: String,
    month: Option<NaiveDate>,
    event_id: Option<Uuid>,
    event_title: Option<String>,
    status: String,
    sent_at: Option<DateTime<Utc>>,
    approved_at: Option<DateTime<Utc>>,
    paid_at: Option<DateTime<Utc>>,
    received_amount: Option<f64>,
    invoice_count: i64,
    /// Dosyadaki faturalarin SEB fonlu kalemlerinin TRY toplami.
    seb_total: f64,
    people: i64,
}

/// Dosya satiri; `concat!` ile statik sorguya eklenir (liste ve ayrinti ayni).
macro_rules! claim_select {
    () => {
        "select c.id, c.kind, c.month, c.event_id, e.title as event_title, c.status, c.sent_at, c.approved_at,
                c.paid_at, c.received_amount::float8 as received_amount,
                (select count(*) from invoices i where i.claim_id = c.id) as invoice_count,
                coalesce((select sum(round(ii.amount * coalesce(i.fx_rate, 1), 2)) from invoices i
                           join invoice_items ii on ii.invoice_id = i.id
                          where i.claim_id = c.id and ii.funding = 'seb'), 0)::float8 as seb_total,
                (select count(distinct i.submitted_by) from invoices i where i.claim_id = c.id and i.paid_by = 'member') as people
           from reimbursement_claims c left join events e on e.id = c.event_id "
    };
}

pub async fn claims(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<ClaimOut>>> {
    need_viewer(&st, &me).await?;
    Ok(Json(sqlx::query_as(concat!(claim_select!(),
        "order by (c.status = 'paid'), coalesce(c.month, c.created_at::date) desc"))
        .fetch_all(&st.pool).await?))
}

#[derive(Deserialize)]
pub struct ClaimIn {
    kind: String,
    #[serde(default)]
    month: Option<NaiveDate>,
    #[serde(default)]
    event_id: Option<Uuid>,
}

pub async fn create_claim(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<ClaimIn>,
) -> Result<Json<ClaimDetail>> {
    need(&st, &me, "review_purchases").await?;
    let id: Option<Uuid> = match (b.kind.as_str(), b.month, b.event_id) {
        ("monthly", Some(m), None) => sqlx::query_scalar(
            "insert into reimbursement_claims (kind, month, created_by) values ('monthly', date_trunc('month', $1::date)::date, $2)
             on conflict (month) where kind = 'monthly' do nothing returning id")
            .bind(m).bind(me.id).fetch_optional(&st.pool).await?,
        ("event", None, Some(e)) => {
            let exists: bool = sqlx::query_scalar("select exists(select 1 from events where id = $1)")
                .bind(e).fetch_one(&st.pool).await?;
            if !exists {
                return Err(AppError::BadRequest("invalid_event"));
            }
            sqlx::query_scalar(
                "insert into reimbursement_claims (kind, event_id, created_by) values ('event', $1, $2)
                 on conflict (event_id) where kind = 'event' do nothing returning id")
                .bind(e).bind(me.id).fetch_optional(&st.pool).await?
        }
        _ => return Err(AppError::BadRequest("invalid_claim")),
    };
    let id = id.ok_or(AppError::Conflict("claim_exists"))?;
    Ok(Json(claim_detail(&st, id).await?))
}

#[derive(Serialize)]
pub struct ClaimDetail {
    claim: ClaimOut,
    invoices: Vec<InvoiceRowOut>,
    /// Kime ne kadar: kisi (uye odedi) ya da `null` = kulup kasasi.
    people: Vec<Value>,
}

async fn claim_detail(st: &AppState, id: Uuid) -> Result<ClaimDetail> {
    let claim: ClaimOut = sqlx::query_as(concat!(claim_select!(), "where c.id = $1"))
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;
    let invoices: Vec<InvoiceRowOut> = sqlx::query_as(
        "select i.id, i.submitted_by, i.purchased_on, i.currency::text as currency, i.total::float8 as total,
                i.total_try::float8 as total_try, i.paid_by, i.status, i.claim_id, i.created_at,
                (select count(*) from invoice_items x where x.invoice_id = i.id) as item_count,
                (select m.name from invoice_items x join materials m on m.id = x.material_id
                  where x.invoice_id = i.id order by m.name limit 1) as first_item,
                array(select distinct e.title from invoice_items x
                        join event_materials em on em.material_id = x.material_id
                        join events e on e.id = em.event_id where x.invoice_id = i.id) as event_titles,
                (select count(*) from invoice_attachments x where x.invoice_id = i.id) as attachment_count
           from invoices i where i.claim_id = $1 order by i.purchased_on")
        .bind(id).fetch_all(&st.pool).await?;
    let rows: Vec<(Option<Uuid>, f64, i64)> = sqlx::query_as(
        "select case when i.paid_by = 'member' then i.submitted_by end as who,
                sum(round(ii.amount * coalesce(i.fx_rate, 1), 2))::float8, count(distinct i.id)
           from invoices i join invoice_items ii on ii.invoice_id = i.id
          where i.claim_id = $1 and ii.funding = 'seb'
          group by 1 order by 1 nulls last")
        .bind(id).fetch_all(&st.pool).await?;
    let people = rows.into_iter().map(|(u, amount, n)| json!({ "user_id": u, "amount": amount, "invoices": n })).collect();
    Ok(ClaimDetail { claim, invoices, people })
}

pub async fn claim(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<ClaimDetail>> {
    need_viewer(&st, &me).await?;
    Ok(Json(claim_detail(&st, common::id(&raw)?).await?))
}

#[derive(Deserialize)]
pub struct ClaimPatch {
    status: String,
    #[serde(default)]
    received_amount: Option<f64>,
    #[serde(default)]
    occurred_on: Option<NaiveDate>,
}

const CLAIM_STEPS: [&str; 4] = ["draft", "sent", "office_approved", "paid"];

/// Durum bir adim ileri ya da (odenmemisse) bir adim geri. `paid` kasaya gelir
/// satiri acar ve `manage_ledger` ister.
pub async fn patch_claim(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<ClaimPatch>,
) -> Result<Json<ClaimDetail>> {
    need(&st, &me, "review_purchases").await?;
    let id = common::id(&raw)?;
    let mut tx = st.pool.begin().await?;
    let row: Option<(String, String, Option<NaiveDate>, Option<String>)> = sqlx::query_as(
        "select c.status, c.kind, c.month, e.title from reimbursement_claims c
           left join events e on e.id = c.event_id where c.id = $1 for update of c")
        .bind(id).fetch_optional(&mut *tx).await?;
    let (status, kind, month, title) = row.ok_or(AppError::NotFound)?;
    let from = CLAIM_STEPS.iter().position(|s| *s == status).unwrap_or(0);
    let to = CLAIM_STEPS.iter().position(|s| *s == b.status).ok_or(AppError::BadRequest("invalid_status"))?;
    if status == "paid" || (to != from + 1 && to + 1 != from) {
        return Err(AppError::Conflict("claim_locked"));
    }
    if b.status == "sent" {
        let n: i64 = sqlx::query_scalar("select count(*) from invoices where claim_id = $1").bind(id).fetch_one(&mut *tx).await?;
        if n == 0 {
            return Err(AppError::Conflict("claim_empty"));
        }
    }
    match b.status.as_str() {
        "paid" => {
            need(&st, &me, "manage_ledger").await?;
            // SEB hic yatirmadiysa 0 gecerli (defter satiri acilmaz).
            let received = match b.received_amount {
                Some(v) if v.abs() < 0.005 => 0,
                Some(v) => cents(v).ok_or(AppError::BadRequest("invalid_amount"))?,
                None => return Err(AppError::BadRequest("invalid_amount")),
            };
            let on = b.occurred_on.unwrap_or_else(today);
            let label = if kind == "monthly" {
                month.map(|m| m.format("%m/%Y").to_string()).unwrap_or_default()
            } else {
                title.unwrap_or_default()
            };
            let entry: Option<Uuid> = if received > 0 {
                Some(sqlx::query_scalar(
                    "insert into ledger_entries (occurred_on, amount, kind, description, created_by)
                     values ($1, $2::bigint::numeric / 100, 'seb_refund', left($3, 300), $4) returning id")
                    .bind(on).bind(received).bind(format!("SEB iadesi · {label}")).bind(me.id)
                    .fetch_one(&mut *tx).await?)
            } else {
                None
            };
            sqlx::query(
                "update reimbursement_claims set status = 'paid', paid_at = now(),
                        received_amount = $2::bigint::numeric / 100, ledger_entry_id = $3 where id = $1")
                .bind(id).bind(received).bind(entry).execute(&mut *tx).await?;
        }
        s => {
            sqlx::query(
                "update reimbursement_claims set status = $2,
                        sent_at = case when $2 = 'sent' then now() when $2 = 'draft' then null else sent_at end,
                        approved_at = case when $2 = 'office_approved' then now() when $2 in ('draft','sent') then null else approved_at end
                  where id = $1")
                .bind(id).bind(s).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(Json(claim_detail(&st, id).await?))
}

// --- kasa defteri ----------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct LedgerRow {
    id: Uuid,
    occurred_on: NaiveDate,
    amount: f64,
    kind: String,
    description: String,
    category_id: Option<Uuid>,
    event_id: Option<Uuid>,
    invoice_id: Option<Uuid>,
    payee_user_id: Option<Uuid>,
    reverses_id: Option<Uuid>,
    reversed: bool,
    balance: f64,
    created_by: Option<Uuid>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct LedgerView {
    balance: f64,
    month_in: f64,
    month_out: f64,
    last_check: Option<Value>,
    entries: Vec<LedgerRow>,
    can_write: bool,
}

pub async fn ledger(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<LedgerView>> {
    need_viewer(&st, &me).await?;
    let entries: Vec<LedgerRow> = sqlx::query_as(
        "select * from (
           select e.id, e.occurred_on, e.amount::float8 as amount, e.kind, e.description, e.category_id, e.event_id,
                  e.invoice_id, e.payee_user_id, e.reverses_id,
                  exists(select 1 from ledger_entries r where r.reverses_id = e.id) as reversed,
                  (sum(e.amount) over (order by e.occurred_on, e.created_at, e.id rows unbounded preceding))::float8 as balance,
                  e.created_by, e.created_at
             from ledger_entries e) t
          order by occurred_on desc, created_at desc, id desc limit 500")
        .fetch_all(&st.pool).await?;
    let (balance, month_in, month_out): (f64, f64, f64) = sqlx::query_as(
        "select coalesce(sum(amount), 0)::float8,
                coalesce(sum(amount) filter (where amount > 0 and date_trunc('month', occurred_on) = date_trunc('month', $1::date)), 0)::float8,
                coalesce(sum(amount) filter (where amount < 0 and date_trunc('month', occurred_on) = date_trunc('month', $1::date)), 0)::float8
           from ledger_entries")
        .bind(today()).fetch_one(&st.pool).await?;
    let check: Option<(NaiveDate, f64, f64)> = sqlx::query_as(
        "select c.checked_on, c.bank_balance::float8,
                (coalesce((select sum(amount) from ledger_entries where occurred_on <= c.checked_on), 0) - c.bank_balance)::float8
           from ledger_checks c order by c.checked_on desc, c.created_at desc limit 1")
        .fetch_optional(&st.pool).await?;
    Ok(Json(LedgerView {
        balance, month_in, month_out,
        last_check: check.map(|(on, bank, diff)| json!({ "checked_on": on, "bank_balance": bank, "diff": diff })),
        entries, can_write: common::has_scope(&st, &me, "manage_ledger").await?,
    }))
}

#[derive(Deserialize)]
pub struct EntryIn {
    occurred_on: NaiveDate,
    /// Gelir/gider icin POZITIF tutar (yon `kind`'dan); acilista isaretli.
    amount: f64,
    kind: String,
    description: String,
    #[serde(default)]
    category_id: Option<Uuid>,
    #[serde(default)]
    event_id: Option<Uuid>,
    #[serde(default)]
    attachment_ids: Vec<Uuid>,
}

pub async fn add_entry(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<EntryIn>,
) -> Result<Json<LedgerView>> {
    need(&st, &me, "manage_ledger").await?;
    let amount = match b.kind.as_str() {
        "income" => cents(b.amount),
        "expense" => cents(b.amount).map(|c| -c),
        "opening" => finance::signed_cents(b.amount),
        _ => return Err(AppError::BadRequest("invalid_kind")),
    }.ok_or(AppError::BadRequest("invalid_amount"))?;
    if b.occurred_on > today() {
        return Err(AppError::BadRequest("invalid_date"));
    }
    let desc = text(Some(b.description), DESC_MAX, "invalid_description")?.ok_or(AppError::BadRequest("invalid_description"))?;
    if let Some(c) = b.category_id {
        let ok: bool = sqlx::query_scalar("select exists(select 1 from nodes where id = $1 and node_type = 'category')")
            .bind(c).fetch_one(&st.pool).await?;
        if !ok {
            return Err(AppError::BadRequest("invalid_category"));
        }
    }
    let mut attach = b.attachment_ids;
    if attach.len() > ATTACH_MAX {
        return Err(AppError::BadRequest("invalid_attachment"));
    }
    let mut tx = st.pool.begin().await?;
    if b.kind == "opening" {
        let exists: bool = sqlx::query_scalar("select exists(select 1 from ledger_entries where kind = 'opening')")
            .fetch_one(&mut *tx).await?;
        if exists {
            return Err(AppError::Conflict("opening_exists"));
        }
    }
    att::claimable_for(&mut *tx, me.id, &mut attach, Purpose::Ledger).await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into ledger_entries (occurred_on, amount, kind, description, category_id, event_id, created_by)
         values ($1, $2::bigint::numeric / 100, $3, $4, $5, $6, $7) returning id")
        .bind(b.occurred_on).bind(amount).bind(&b.kind).bind(desc).bind(b.category_id).bind(b.event_id).bind(me.id)
        .fetch_one(&mut *tx).await?;
    sqlx::query("insert into ledger_attachments (entry_id, attachment_id) select $1, unnest($2::uuid[])")
        .bind(id).bind(&attach).execute(&mut *tx).await?;
    tx.commit().await?;
    ledger(State(st), CurrentUser(me)).await
}

#[derive(Deserialize)]
pub struct ReverseIn {
    #[serde(default)]
    note: Option<String>,
}

pub async fn reverse_entry(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<ReverseIn>,
) -> Result<Json<LedgerView>> {
    need(&st, &me, "manage_ledger").await?;
    let id = common::id(&raw)?;
    let note = text(b.note, 200, "invalid_note")?;
    let mut tx = st.pool.begin().await?;
    let row: Option<(String, String, bool)> = sqlx::query_as(
        "select kind, description, exists(select 1 from ledger_entries r where r.reverses_id = e.id)
           from ledger_entries e where e.id = $1 for update")
        .bind(id).fetch_optional(&mut *tx).await?;
    let (kind, desc, reversed) = row.ok_or(AppError::NotFound)?;
    if kind == "reversal" || reversed {
        return Err(AppError::Conflict("already_reversed"));
    }
    let text = match note {
        Some(n) => format!("Ters kayıt · {desc} · {n}"),
        None => format!("Ters kayıt · {desc}"),
    };
    sqlx::query(
        "insert into ledger_entries (occurred_on, amount, kind, description, reverses_id, created_by)
         select $2, -amount, 'reversal', left($3, 300), id, $4 from ledger_entries where id = $1")
        .bind(id).bind(today()).bind(text).bind(me.id).execute(&mut *tx).await?;
    tx.commit().await?;
    ledger(State(st), CurrentUser(me)).await
}

#[derive(Deserialize)]
pub struct CheckIn {
    checked_on: NaiveDate,
    bank_balance: f64,
}

pub async fn add_check(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<CheckIn>,
) -> Result<Json<LedgerView>> {
    need(&st, &me, "manage_ledger").await?;
    let bal = if b.bank_balance.abs() < 0.005 { 0 } else {
        finance::signed_cents(b.bank_balance).ok_or(AppError::BadRequest("invalid_amount"))?
    };
    if b.checked_on > today() {
        return Err(AppError::BadRequest("invalid_date"));
    }
    sqlx::query("insert into ledger_checks (checked_on, bank_balance, created_by) values ($1, $2::bigint::numeric / 100, $3)")
        .bind(b.checked_on).bind(bal).bind(me.id).execute(&st.pool).await?;
    ledger(State(st), CurrentUser(me)).await
}

#[derive(Deserialize)]
pub struct PayoutIn {
    user_id: Uuid,
    amount: f64,
    #[serde(default)]
    occurred_on: Option<NaiveDate>,
    #[serde(default)]
    description: Option<String>,
}

/// Uyeye iade (spec/81 §6.4): kasadan cikis, borcu duser.
pub async fn payout(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<PayoutIn>,
) -> Result<Json<LedgerView>> {
    need(&st, &me, "manage_ledger").await?;
    let amount = cents(b.amount).ok_or(AppError::BadRequest("invalid_amount"))?;
    let name: Option<String> = sqlx::query_scalar("select name from users where id = $1")
        .bind(b.user_id).fetch_optional(&st.pool).await?;
    let name = name.ok_or(AppError::BadRequest("invalid_user_id"))?;
    let desc = text(b.description, DESC_MAX, "invalid_description")?.unwrap_or_else(|| format!("{name} için iade"));
    let on = b.occurred_on.unwrap_or_else(today);
    if on > today() {
        return Err(AppError::BadRequest("invalid_date"));
    }
    sqlx::query(
        "insert into ledger_entries (occurred_on, amount, kind, description, payee_user_id, created_by)
         values ($1, -($2::bigint::numeric / 100), 'member_payout', $3, $4, $5)")
        .bind(on).bind(amount).bind(desc).bind(b.user_id).bind(me.id).execute(&st.pool).await?;
    ledger(State(st), CurrentUser(me)).await
}

// --- ozet (Genel) -----------------------------------------------------------------

#[derive(Serialize)]
pub struct Summary {
    cash_balance: f64,
    last_check: Option<Value>,
    seb_receivable: f64,
    claims_waiting: i64,
    /// SEB fonlu ama dosyasiz onayli faturalar (ay dosyasi gonderilmisti).
    unclaimed: i64,
    member_debts: Vec<Value>,
    pending_invoices: i64,
    oldest_pending: Option<DateTime<Utc>>,
    upcoming: Vec<Value>,
}

pub async fn summary(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Summary>> {
    need_viewer(&st, &me).await?;
    let p = &st.pool;
    let cash_balance: f64 = sqlx::query_scalar("select coalesce(sum(amount), 0)::float8 from ledger_entries").fetch_one(p).await?;
    let last_check: Option<(NaiveDate, f64, f64)> = sqlx::query_as(
        "select c.checked_on, c.bank_balance::float8,
                (coalesce((select sum(amount) from ledger_entries where occurred_on <= c.checked_on), 0) - c.bank_balance)::float8
           from ledger_checks c order by c.checked_on desc, c.created_at desc limit 1")
        .fetch_optional(p).await?;
    let (seb_receivable, unclaimed): (f64, i64) = sqlx::query_as(
        "select coalesce(sum(round(ii.amount * coalesce(i.fx_rate, 1), 2)), 0)::float8,
                count(distinct i.id) filter (where i.claim_id is null)
           from invoices i join invoice_items ii on ii.invoice_id = i.id
           left join reimbursement_claims c on c.id = i.claim_id
          where i.status = 'approved' and ii.funding = 'seb' and (c.id is null or c.status <> 'paid')")
        .fetch_one(p).await?;
    let claims_waiting: i64 = sqlx::query_scalar(
        "select count(*) from reimbursement_claims where status in ('sent','office_approved')").fetch_one(p).await?;
    // Uyeye borc: onayli, uye odemis faturalar - o kisiye yapilan odemeler.
    // Odenebilir kisim: genel fonlu kalemler + dosyasi odenmis SEB kalemleri.
    let debts: Vec<(Uuid, f64, f64, f64)> = sqlx::query_as(
        "with owed as (
           select i.submitted_by as u,
                  sum(round(ii.amount * coalesce(i.fx_rate, 1), 2)) as total,
                  sum(round(ii.amount * coalesce(i.fx_rate, 1), 2))
                    filter (where ii.funding = 'general' or c.status = 'paid') as payable
             from invoices i join invoice_items ii on ii.invoice_id = i.id
             left join reimbursement_claims c on c.id = i.claim_id
            where i.status = 'approved' and i.paid_by = 'member'
            group by 1),
         paid as (
           select payee_user_id as u, -sum(amount) as paid from ledger_entries
            where kind = 'member_payout' group by 1)
         select o.u, o.total::float8, coalesce(o.payable, 0)::float8, coalesce(p.paid, 0)::float8
           from owed o left join paid p on p.u = o.u
          where o.total > coalesce(p.paid, 0)
          order by o.total - coalesce(p.paid, 0) desc")
        .fetch_all(p).await?;
    let member_debts = debts.into_iter().map(|(u, total, payable, paid)| json!({
        "user_id": u,
        "outstanding": total - paid,
        "payable": (payable - paid).max(0.0),
    })).collect();
    let (pending_invoices, oldest_pending): (i64, Option<DateTime<Utc>>) = sqlx::query_as(
        "select count(*), min(created_at) from invoices where status = 'pending'").fetch_one(p).await?;
    let day = today();
    let horizon = day + chrono::Duration::days(UPCOMING_DAYS);
    let mut upcoming: Vec<Value> = Vec::new();
    #[derive(sqlx::FromRow)]
    struct Due {
        id: Uuid,
        name: String,
        due: Option<NaiveDate>,
        price: Option<f64>,
        title: Option<String>,
    }
    let mats: Vec<Due> = sqlx::query_as(
        "select m.id, m.name, coalesce(m.needed_by, e.date) as due,
                (case when m.sponsor_chosen then 0
                      else coalesce((select pr.price from material_providers pr where pr.id = m.chosen_provider_id),
                                    (select min(pr.price) from material_providers pr where pr.material_id = m.id)) end)::float8 as price,
                e.title
           from materials m
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id
          where m.state = 3 and not m.owned and not m.purchased
            and coalesce(m.needed_by, e.date) is not null and coalesce(m.needed_by, e.date) <= $1
          order by 3 limit 50")
        .bind(horizon).fetch_all(p).await?;
    for m in mats {
        upcoming.push(json!({ "kind": "material", "id": m.id, "label": m.name, "event": m.title, "due": m.due, "amount": m.price }));
    }
    let rec: Vec<(Uuid, String, NaiveDate, f64, String)> = sqlx::query_as(
        "select id, name, next_on, amount::float8, currency::text from recurring_expenses
          where is_active and next_on <= $1 order by next_on")
        .bind(horizon).fetch_all(p).await?;
    for (id, name, due, amount, currency) in rec {
        upcoming.push(json!({ "kind": "recurring", "id": id, "label": name, "due": due, "amount": amount, "currency": currency }));
    }
    Ok(Json(Summary {
        cash_balance,
        last_check: last_check.map(|(on, bank, diff)| json!({ "checked_on": on, "bank_balance": bank, "diff": diff })),
        seb_receivable, claims_waiting, unclaimed, member_debts, pending_invoices, oldest_pending, upcoming,
    }))
}

// --- kur (spec/81 §13) ---------------------------------------------------------------

#[derive(Deserialize)]
pub struct FxQuery {
    currency: String,
    on: NaiveDate,
}

/// TCMB doviz satis kuru; once onbellek (`fx_rates`), yoksa TCMB, hafta sonu/
/// tatilde geriye en fazla 7 gun. Kapaliysa ya da ulasilamazsa 503: form kuru elle ister.
pub async fn fx(
    State(st): State<AppState>, CurrentUser(_me): CurrentUser, Query(q): Query<FxQuery>,
) -> Result<Json<Value>> {
    let currency = finance::currency(&q.currency).filter(|c| c != "TRY").ok_or(AppError::BadRequest("invalid_currency"))?;
    if q.on > today() {
        return Err(AppError::BadRequest("invalid_date"));
    }
    for day in finance::lookback(q.on) {
        let cached: Option<f64> = sqlx::query_scalar("select rate::float8 from fx_rates where day = $1 and currency = $2")
            .bind(day).bind(&currency).fetch_optional(&st.pool).await?;
        if let Some(rate) = cached {
            return Ok(Json(json!({ "currency": currency, "on": day, "rate": rate, "source": "tcmb" })));
        }
        if !st.cfg.external_on(Service::Fx) {
            return Err(AppError::Unavailable("fx_service_off"));
        }
        let res = st.http.get(finance::tcmb_url(day)).timeout(std::time::Duration::from_secs(8)).send().await
            .map_err(|_| AppError::Unavailable("fx_service_off"))?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            continue; // hafta sonu / tatil: dosya yok
        }
        let body = res.error_for_status().map_err(|_| AppError::Unavailable("fx_service_off"))?
            .text().await.map_err(|_| AppError::Unavailable("fx_service_off"))?;
        let Some(rate) = finance::parse_tcmb(&body, &currency) else {
            return Err(AppError::BadRequest("fx_unknown_currency"));
        };
        let m = micros(rate).unwrap_or(0);
        if m > 0 {
            sqlx::query("insert into fx_rates (day, currency, rate) values ($1, $2, $3::bigint::numeric / 1000000)
                         on conflict do nothing")
                .bind(day).bind(&currency).bind(m).execute(&st.pool).await?;
        }
        return Ok(Json(json!({ "currency": currency, "on": day, "rate": rate, "source": "tcmb" })));
    }
    Err(AppError::Unavailable("fx_service_off"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> InvoiceIn {
        InvoiceIn {
            purchased_on: NaiveDate::from_ymd_opt(2026, 10, 10).unwrap_or_default(),
            currency: None, total: 640.0, fx_rate: None, fx_on: None, fx_source: None,
            paid_by: "member".into(), payee_account_id: Some(Uuid::nil()), vendor_id: None, note: None,
            items: vec![ItemIn { material_id: Uuid::from_u128(1), amount: 400.0 }, ItemIn { material_id: Uuid::from_u128(2), amount: 240.0 }],
            attachment_ids: vec![Uuid::from_u128(9)],
        }
    }
    fn day() -> NaiveDate { NaiveDate::from_ymd_opt(2026, 10, 14).unwrap_or_default() }
    fn code(r: Result<Valid>) -> &'static str {
        match r { Ok(_) => "ok", Err(AppError::BadRequest(c)) => c, Err(_) => "other" }
    }

    #[test]
    fn bolunmus_fatura() {
        assert_eq!(code(shape(base(), day())), "ok");
        let mut b = base();
        b.items[1].amount = 239.99;
        assert_eq!(code(shape(b, day())), "invoice_split_mismatch");
        let mut b = base();
        b.items[1].material_id = Uuid::from_u128(1);
        assert_eq!(code(shape(b, day())), "duplicate_item");
        let mut b = base();
        b.items.clear();
        assert_eq!(code(shape(b, day())), "invoice_items_required");
        let mut b = base();
        b.attachment_ids.clear();
        assert_eq!(code(shape(b, day())), "attachment_required");
        // 0.1 + 0.2 kurusta tam.
        let mut b = base();
        b.total = 0.3;
        b.items = vec![ItemIn { material_id: Uuid::from_u128(1), amount: 0.1 }, ItemIn { material_id: Uuid::from_u128(2), amount: 0.2 }];
        assert_eq!(code(shape(b, day())), "ok");
    }

    #[test]
    fn odeme_ve_kur() {
        let mut b = base();
        b.payee_account_id = None;
        assert_eq!(code(shape(b, day())), "account_required");
        let mut b = base();
        b.paid_by = "club".into();
        assert!(shape(b, day()).is_ok_and(|v| v.payee.is_none()), "kasadan odenince hesap yok sayilir");
        let mut b = base();
        b.currency = Some("usd".into());
        assert_eq!(code(shape(b, day())), "fx_rate_required");
        let mut b = base();
        b.currency = Some("USD".into());
        b.fx_rate = Some(41.82);
        b.fx_source = Some("tcmb".into());
        assert!(shape(b, day()).is_ok_and(|v| v.fx == Some((41_820_000, v.purchased_on, "tcmb"))));
        let mut b = base();
        b.fx_rate = Some(41.82);
        assert_eq!(code(shape(b, day())), "invalid_fx", "TL faturada kur olmaz");
        let mut b = base();
        b.purchased_on = NaiveDate::from_ymd_opt(2026, 10, 15).unwrap_or_default();
        assert_eq!(code(shape(b, day())), "invalid_date", "gelecek tarih");
    }
}
