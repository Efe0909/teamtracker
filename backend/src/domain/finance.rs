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

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgConnection;
use uuid::Uuid;

use crate::{
    db::finance as db,
    domain::{attachments::{self as att, AttachView}, common},
    audit,
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

pub(crate) async fn is_viewer(st: &AppState, me: &User) -> Result<bool> {
    if me.is_admin {
        return Ok(true);
    }
    let active = crate::db::scope::active(&st.pool, me).await?;
    Ok(VIEW_SCOPES.iter().any(|s| active.iter().any(|a| a == s)))
}

pub(crate) async fn need_viewer(st: &AppState, me: &User) -> Result<()> {
    if is_viewer(st, me).await? { Ok(()) } else { Err(AppError::Forbidden) }
}

pub(crate) async fn need(st: &AppState, me: &User, scope: &'static str) -> Result<()> {
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
pub(crate) fn today() -> NaiveDate {
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
        let ok = db::has_payee_account(&mut *tx, a, me.id).await?;
        if !ok {
            return Err(AppError::BadRequest("account_required"));
        }
    }
    let ids: Vec<Uuid> = v.items.iter().map(|(m, _)| *m).collect();
    let ok = db::count_approved_materials(&mut *tx, &ids).await?;
    if ok as usize != ids.len() {
        return Err(AppError::BadRequest("material_not_approved"));
    }
    if let Some(vd) = v.vendor {
        let live = db::has_live_vendor(&mut *tx, vd).await?;
        if !live {
            return Err(AppError::BadRequest("invalid_vendor"));
        }
    }
    att::claimable_for(&mut *tx, me.id, &mut v.attachments, Purpose::Invoice).await
}

async fn write_body(tx: &mut PgConnection, id: Uuid, v: &Valid) -> Result<()> {
    let (ids, amounts): (Vec<Uuid>, Vec<i64>) = v.items.iter().copied().unzip();
    db::insert_invoice_items(&mut *tx, id, &ids, &amounts).await?;
    db::insert_invoice_attachments(&mut *tx, id, &v.attachments).await?;
    Ok(())
}

async fn review(tx: &mut PgConnection, id: Uuid, action: &str, note: Option<&str>, by: Uuid) -> Result<()> {
    db::insert_review(&mut *tx, id, action, note, by).await?;
    Ok(())
}

pub(crate) async fn submit(st: &AppState, me: &User, b: InvoiceIn) -> Result<InvoiceView> {
    let mut v = shape(b, today())?;
    let mut tx = st.pool.begin().await?;
    check_refs(&mut tx, me, &mut v).await?;
    let (fx_rate, fx_on, fx_source) = match v.fx {
        Some((r, on, s)) => (Some(r), Some(on), Some(s)),
        None => (None, None, None),
    };
    let id = db::insert_invoice(&mut *tx, me.id, v.purchased_on, &v.currency, v.total, fx_rate, fx_on,
        fx_source, v.paid_by, v.payee, v.vendor, v.note.as_deref()).await?;
    write_body(&mut tx, id, &v).await?;
    review(&mut tx, id, "submit", None, me.id).await?;
    tx.commit().await?;
    view(st, me, id).await
}

/// Gonderen, `pending` ya da `changes_requested` faturasini butunuyle yeniden
/// yazar; durum `pending`'e doner (`resubmit`).
pub(crate) async fn edit(st: &AppState, me: &User, id: Uuid, b: InvoiceIn) -> Result<InvoiceView> {
    let mut v = shape(b, today())?;
    let mut tx = st.pool.begin().await?;
    let row = db::lock_invoice_owner(&mut *tx, id).await?;
    let (owner, status) = row.ok_or(AppError::NotFound)?;
    if owner != me.id {
        return Err(AppError::NotFound);
    }
    if status != "pending" && status != "changes_requested" {
        return Err(AppError::Conflict("invoice_locked"));
    }
    // Eski baglar once kalkar: ayni ek yeniden secilmisse bagsiz gorunsun.
    db::delete_invoice_items(&mut *tx, id).await?;
    db::delete_invoice_attachments(&mut *tx, id).await?;
    check_refs(&mut tx, me, &mut v).await?;
    let (fx_rate, fx_on, fx_source) = match v.fx {
        Some((r, on, s)) => (Some(r), Some(on), Some(s)),
        None => (None, None, None),
    };
    db::update_invoice(&mut *tx, id, v.purchased_on, &v.currency, v.total, fx_rate, fx_on,
        fx_source, v.paid_by, v.payee, v.vendor, v.note.as_deref()).await?;
    write_body(&mut tx, id, &v).await?;
    review(&mut tx, id, "resubmit", None, me.id).await?;
    tx.commit().await?;
    view(st, me, id).await
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

#[derive(Serialize)]
pub struct Payee {
    id: Uuid,
    label: String,
    holder_name: String,
    /// Tam IBAN yalniz gonderen ve maliye icin (spec/82 §4.3).
    iban: Option<String>,
    iban_last4: String,
}

#[derive(Serialize)]
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

#[derive(Serialize)]
pub struct ReviewView {
    action: String,
    note: Option<String>,
    by_user: Option<Uuid>,
    at: DateTime<Utc>,
}

impl From<db::PayeeRow> for Payee {
    fn from(r: db::PayeeRow) -> Self {
        Self { id: r.id, label: r.label, holder_name: r.holder_name, iban: r.iban, iban_last4: r.iban_last4 }
    }
}

impl From<db::ItemRow> for ItemView {
    fn from(r: db::ItemRow) -> Self {
        Self { material_id: r.material_id, name: r.name, amount: r.amount, funding: r.funding,
            event_id: r.event_id, event_title: r.event_title, event_date: r.event_date,
            category_id: r.category_id, budget: r.budget, purchased: r.purchased }
    }
}

impl From<db::ReviewRow> for ReviewView {
    fn from(r: db::ReviewRow) -> Self {
        Self { action: r.action, note: r.note, by_user: r.by_user, at: r.at }
    }
}

async fn view(st: &AppState, me: &User, id: Uuid) -> Result<InvoiceView> {
    let r = db::find_invoice(&st.pool, id).await?.ok_or(AppError::NotFound)?;
    let viewer = is_viewer(st, me).await?;
    if r.submitted_by != me.id && !viewer {
        return Err(AppError::NotFound);
    }
    let payee = match r.payee_account_id {
        Some(a) => {
            let p = Payee::from(db::find_payee(&st.pool, a).await?);
            if r.submitted_by != me.id && p.iban.is_some() {
                // Maliye tam IBAN'i yalniz burada gorur; kim baktigi yazilir.
                audit::log_event(st, None, "iban_viewed", Some(me.id), None, Some(&format!("invoice {id}"))).await;
            }
            Some(p)
        }
        None => None,
    };
    let items: Vec<ItemView> = db::list_invoice_items(&st.pool, id).await?.into_iter().map(ItemView::from).collect();
    let mut events: Vec<Value> = Vec::new();
    for it in &items {
        if let Some(eid) = it.event_id {
            if !events.iter().any(|e| e["id"] == json!(eid)) {
                events.push(json!({ "id": eid, "title": it.event_title, "date": it.event_date }));
            }
        }
    }
    let attach_ids = db::list_invoice_attachment_ids(&st.pool, id).await?;
    let mut map = att::views(&st.pool, me, &attach_ids, false).await?;
    let attachments = attach_ids.iter().filter_map(|a| map.remove(a)).collect();
    let reviews = db::list_reviews(&st.pool, id).await?.into_iter().map(ReviewView::from).collect();
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

pub(crate) async fn get(st: &AppState, me: &User, id: Uuid) -> Result<InvoiceView> {
    view(st, me, id).await
}

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    mine: Option<String>,
}

#[derive(Serialize)]
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

impl From<db::InvoiceListRow> for InvoiceRowOut {
    fn from(r: db::InvoiceListRow) -> Self {
        Self { id: r.id, submitted_by: r.submitted_by, purchased_on: r.purchased_on, currency: r.currency,
            total: r.total, total_try: r.total_try, paid_by: r.paid_by, status: r.status, claim_id: r.claim_id,
            created_at: r.created_at, item_count: r.item_count, first_item: r.first_item,
            event_titles: r.event_titles, attachment_count: r.attachment_count }
    }
}

/// Liste: maliye herkesinkini, digerleri yalniz kendisininkini (`mine`).
pub(crate) async fn list(st: &AppState, me: &User, q: ListQuery) -> Result<Vec<InvoiceRowOut>> {
    let mine = q.mine.as_deref() == Some("1") || !is_viewer(st, me).await?;
    Ok(db::list_invoices(&st.pool, q.status.as_deref(), mine, me.id).await?.into_iter().map(InvoiceRowOut::from).collect())
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

pub(crate) async fn decide(st: &AppState, me: &User, id: Uuid, b: DecisionIn) -> Result<InvoiceView> {
    let note = text(b.note, NOTE_MAX, "invalid_note")?;
    let mut tx = st.pool.begin().await?;
    let row = db::lock_invoice_decision(&mut *tx, id).await?;
    let db::InvoiceDecisionRow { submitted_by: owner, status, purchased_on, paid_by, claim_id: claim } = row.ok_or(AppError::NotFound)?;
    if b.action != "withdraw" {
        need(st, me, "review_purchases").await?;
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
            approve(&mut tx, me, id, purchased_on, &paid_by, b.claim_id).await?;
            "approved"
        }
        "cancel" => {
            if status != "approved" {
                return Err(AppError::Conflict("invoice_locked"));
            }
            cancel(&mut tx, me, id, claim).await?;
            "cancelled"
        }
        _ => return Err(AppError::BadRequest("invalid_action")),
    };
    db::set_invoice_status(&mut *tx, id, next).await?;
    review(&mut tx, id, &b.action, note.as_deref(), me.id).await?;
    tx.commit().await?;
    view(st, me, id).await
}

/// Onayin etkileri (spec/81 §6.2), tek islemde.
async fn approve(
    tx: &mut PgConnection, me: &User, id: Uuid, purchased_on: NaiveDate, paid_by: &str, claim: Option<Uuid>,
) -> Result<()> {
    // Kalem hala onayli mi (gonderimden beri geri alinmis olabilir).
    let bad = db::count_unapproved_items(&mut *tx, id).await?;
    if bad > 0 {
        return Err(AppError::Conflict("material_not_approved"));
    }
    // Once durum: dosya bagi (`claim_id`) yalniz onayli faturada olabilir (kisit).
    db::approve_invoice(&mut *tx, id).await?;
    // 1. Fonlama donar: kategorinin ledger'i, kategori yoksa SEB (spec/81 §3.3).
    db::set_item_funding(&mut *tx, id).await?;
    // 2. Kalemler satin alindi (zaten alinmissa dokunulmaz).
    db::set_materials_purchased(&mut *tx, id, me.id).await?;
    // 3. Kasadan odendiyse defterde gider.
    if paid_by == "club" {
        db::insert_purchase_entry(&mut *tx, id, purchased_on, me.id).await?;
    }
    // 4. SEB fonlu kalem varsa dosyaya: verilen taslak dosya ya da ayin dosyasi.
    let seb = db::has_seb_items(&mut *tx, id).await?;
    if seb {
        let target = match claim {
            Some(c) => {
                let draft = db::has_draft_claim(&mut *tx, c).await?;
                if !draft {
                    return Err(AppError::Conflict("claim_locked"));
                }
                Some(c)
            }
            None => monthly_claim(tx, me, purchased_on).await?,
        };
        db::set_invoice_claim(&mut *tx, id, target).await?;
    }
    Ok(())
}

/// Ayin dosyasi; yoksa taslak acilir. Dosya gonderilmisse None (fatura dosyasiz
/// kalir, Genel'de "dosyasiz SEB faturasi" olarak gorunur ve elle tasinir).
async fn monthly_claim(tx: &mut PgConnection, me: &User, day: NaiveDate) -> Result<Option<Uuid>> {
    db::insert_monthly_draft(&mut *tx, day, me.id).await?;
    Ok(db::find_monthly_draft(&mut *tx, day).await?)
}

/// Iptal (spec/81 §6.3): dosyadan cikar, kasa giderinin ters kaydi, baska onayli
/// faturasi olmayan kalemin satin alindi isareti kalkar.
async fn cancel(tx: &mut PgConnection, me: &User, id: Uuid, claim: Option<Uuid>) -> Result<()> {
    if let Some(c) = claim {
        let draft = db::read_claim_draft(&mut *tx, c).await?;
        if !draft {
            return Err(AppError::Conflict("claim_locked"));
        }
    }
    db::clear_invoice_claim(&mut *tx, id).await?;
    db::insert_purchase_reversals(&mut *tx, id, me.id, TZ).await?;
    db::clear_materials_purchased(&mut *tx, id).await?;
    Ok(())
}

/// Onayli faturayi baska bir taslak dosyaya tasir (ya da dosyadan cikarir).
#[derive(Deserialize)]
pub struct ClaimMove {
    claim_id: Option<Uuid>,
}

pub(crate) async fn move_claim(st: &AppState, me: &User, id: Uuid, b: ClaimMove) -> Result<InvoiceView> {
    need(st, me, "review_purchases").await?;
    let mut tx = st.pool.begin().await?;
    let row = db::lock_invoice_claim(&mut *tx, id).await?;
    let (status, old) = row.ok_or(AppError::NotFound)?;
    if status != "approved" {
        return Err(AppError::Conflict("invoice_locked"));
    }
    for c in [old, b.claim_id].into_iter().flatten() {
        let draft = db::find_claim_draft(&mut *tx, c).await?;
        if draft != Some(true) {
            return Err(AppError::Conflict("claim_locked"));
        }
    }
    db::move_invoice_claim(&mut *tx, id, b.claim_id).await?;
    tx.commit().await?;
    view(st, me, id).await
}

// --- fatura formu: secilebilir kalemler ----------------------------------------

#[derive(Serialize)]
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

impl From<db::PurchasableRow> for Purchasable {
    fn from(r: db::PurchasableRow) -> Self {
        Self { id: r.id, name: r.name, qty: r.qty, price: r.price, category_id: r.category_id,
            purchased: r.purchased, event_id: r.event_id, event_title: r.event_title, event_date: r.event_date }
    }
}

/// Fatura formunun kalem listesi: onayli ve elde olmayan kalemler, etkinlikle
/// (etkinlik listesi herkese acik, spec/73) ya da etkinliksiz. Son bir yil.
pub(crate) async fn purchasable(st: &AppState) -> Result<Vec<Purchasable>> {
    Ok(db::list_purchasable(&st.pool).await?.into_iter().map(Purchasable::from).collect())
}

// --- SEB iade dosyalari ---------------------------------------------------------

#[derive(Serialize)]
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

impl From<db::ClaimRow> for ClaimOut {
    fn from(r: db::ClaimRow) -> Self {
        Self { id: r.id, kind: r.kind, month: r.month, event_id: r.event_id, event_title: r.event_title,
            status: r.status, sent_at: r.sent_at, approved_at: r.approved_at, paid_at: r.paid_at,
            received_amount: r.received_amount, invoice_count: r.invoice_count, seb_total: r.seb_total, people: r.people }
    }
}

pub(crate) async fn claims(st: &AppState, me: &User) -> Result<Vec<ClaimOut>> {
    need_viewer(st, me).await?;
    Ok(db::list_claims(&st.pool).await?.into_iter().map(ClaimOut::from).collect())
}

/// Iade listesinin satiri: dosya acilmis olsun olmasin. `claim_id` bos = "Dosya acilmadi".
#[derive(Serialize)]
pub struct ClaimSlot {
    kind: String,
    month: Option<NaiveDate>,
    event_id: Option<Uuid>,
    event_title: Option<String>,
    event_date: Option<NaiveDate>,
    claim_id: Option<Uuid>,
    status: Option<String>,
    invoice_count: i64,
    seb_total: f64,
}

impl From<db::ClaimSlotRow> for ClaimSlot {
    fn from(r: db::ClaimSlotRow) -> Self {
        Self { kind: r.kind, month: r.month, event_id: r.event_id, event_title: r.event_title, event_date: r.event_date,
            claim_id: r.claim_id, status: r.status, invoice_count: r.invoice_count, seb_total: r.seb_total }
    }
}

/// SEB fonlu onayli faturasi olan her ay ve her etkinlik + acik dosyalar (spec/81 §3.6).
/// Acik dosyada sayilar dosyanin kendisinden, acilmamis satirda onayli faturalardan gelir;
/// etkinlik satiri yalniz dosyaya girebilecek (dosyasiz ya da taslak aylik dosyada) faturalari sayar.
pub(crate) async fn claim_slots(st: &AppState, me: &User) -> Result<Vec<ClaimSlot>> {
    need_viewer(st, me).await?;
    Ok(db::list_claim_slots(&st.pool).await?.into_iter().map(ClaimSlot::from).collect())
}

#[derive(Deserialize)]
pub struct ClaimIn {
    kind: String,
    #[serde(default)]
    month: Option<NaiveDate>,
    #[serde(default)]
    event_id: Option<Uuid>,
}

pub(crate) async fn create_claim(st: &AppState, me: &User, b: ClaimIn) -> Result<ClaimDetail> {
    need(st, me, "review_purchases").await?;
    let id: Option<Uuid> = match (b.kind.as_str(), b.month, b.event_id) {
        ("monthly", Some(m), None) => db::insert_monthly_claim(&st.pool, m, me.id).await?,
        ("event", None, Some(e)) => {
            let exists = db::has_event(&st.pool, e).await?;
            if !exists {
                return Err(AppError::BadRequest("invalid_event"));
            }
            db::insert_event_claim(&st.pool, e, me.id).await?
        }
        _ => return Err(AppError::BadRequest("invalid_claim")),
    };
    let id = id.ok_or(AppError::Conflict("claim_exists"))?;
    if let (Some(e), "event") = (b.event_id, b.kind.as_str()) {
        // Acilista, etkinligin SEB fonlu onayli faturalari dosyaya girer: dosyasiz olanlar ve
        // taslak aylik dosyadakiler (gonderilmis dosyadakilere dokunulmaz).
        db::move_event_invoices(&st.pool, id, e).await?;
    }
    claim_detail(st, id).await
}

#[derive(Serialize)]
pub struct ClaimDetail {
    claim: ClaimOut,
    invoices: Vec<InvoiceRowOut>,
    /// Kime ne kadar: kisi (uye odedi) ya da `null` = kulup kasasi.
    people: Vec<Value>,
}

async fn claim_detail(st: &AppState, id: Uuid) -> Result<ClaimDetail> {
    let claim = db::find_claim(&st.pool, id).await?.map(ClaimOut::from).ok_or(AppError::NotFound)?;
    let invoices = db::list_claim_invoices(&st.pool, id).await?.into_iter().map(InvoiceRowOut::from).collect();
    let rows = db::list_claim_people(&st.pool, id).await?;
    let people = rows.into_iter().map(|(u, amount, n)| json!({ "user_id": u, "amount": amount, "invoices": n })).collect();
    Ok(ClaimDetail { claim, invoices, people })
}

pub(crate) async fn claim(st: &AppState, me: &User, id: Uuid) -> Result<ClaimDetail> {
    need_viewer(st, me).await?;
    claim_detail(st, id).await
}

/// `GET /api/finance/claims/{id}/xlsx`: dosyadaki kalemlerin dokumu (SEB'e eklenecek).
pub(crate) async fn claim_xlsx(st: &AppState, me: &User, id: Uuid) -> Result<(Vec<u8>, String)> {
    need_viewer(st, me).await?;
    let claim = db::find_export_claim(&st.pool, id).await?.map(ClaimOut::from).ok_or(AppError::NotFound)?;
    let rows = db::list_claim_export_items(&st.pool, id).await?;
    let funding = |f: Option<String>| match f.as_deref() { Some("seb") => "SEB", Some("general") => "Kulüp kasası", _ => "" };
    let data: Vec<Vec<crate::xlsx::Cell>> = rows.into_iter().map(|db::ClaimExportRow {
        purchased_on: on, user_name: who, material_name: item, event_title: ev, funding: fund, amount,
    }| vec![
        on.format("%d.%m.%Y").to_string().into(), who.into(), item.into(), ev.unwrap_or_default().into(),
        funding(fund).into(), amount.into(),
    ]).collect();
    let bytes = crate::xlsx::table("Harcama bildirimi", &["Fatura günü", "Kişi", "Kalem", "Etkinlik", "Kaynak", "Tutar (₺)"], &data)
        .map_err(|e| {
            tracing::error!("iade xlsx: {e}");
            AppError::Conflict("xlsx_failed")
        })?;
    let name = match (claim.kind.as_str(), claim.month) {
        ("monthly", Some(m)) => format!("iade-{}.xlsx", m.format("%Y-%m")),
        _ => format!("iade-{id}.xlsx"),
    };
    Ok((bytes, name))
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
pub(crate) async fn patch_claim(st: &AppState, me: &User, id: Uuid, b: ClaimPatch) -> Result<ClaimDetail> {
    need(st, me, "review_purchases").await?;
    let mut tx = st.pool.begin().await?;
    let row = db::lock_claim_status(&mut *tx, id).await?;
    let db::ClaimStatusRow { status, kind, month, title } = row.ok_or(AppError::NotFound)?;
    let from = CLAIM_STEPS.iter().position(|s| *s == status).unwrap_or(0);
    let to = CLAIM_STEPS.iter().position(|s| *s == b.status).ok_or(AppError::BadRequest("invalid_status"))?;
    if status == "paid" || (to != from + 1 && to + 1 != from) {
        return Err(AppError::Conflict("claim_locked"));
    }
    if b.status == "sent" {
        let n = db::count_claim_invoices(&mut *tx, id).await?;
        if n == 0 {
            return Err(AppError::Conflict("claim_empty"));
        }
    }
    match b.status.as_str() {
        "paid" => {
            need(st, me, "manage_ledger").await?;
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
                Some(db::insert_refund_entry(&mut *tx, on, received, &format!("SEB iadesi · {label}"), me.id).await?)
            } else {
                None
            };
            db::set_claim_paid(&mut *tx, id, received, entry).await?;
        }
        s => {
            db::set_claim_status(&mut *tx, id, s).await?;
        }
    }
    tx.commit().await?;
    claim_detail(st, id).await
}

// --- kasa defteri ----------------------------------------------------------------

#[derive(Serialize)]
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

impl From<db::LedgerRow> for LedgerRow {
    fn from(r: db::LedgerRow) -> Self {
        Self { id: r.id, occurred_on: r.occurred_on, amount: r.amount, kind: r.kind, description: r.description,
            category_id: r.category_id, event_id: r.event_id, invoice_id: r.invoice_id, payee_user_id: r.payee_user_id,
            reverses_id: r.reverses_id, reversed: r.reversed, balance: r.balance, created_by: r.created_by, created_at: r.created_at }
    }
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

pub(crate) async fn ledger(st: &AppState, me: &User) -> Result<LedgerView> {
    need_viewer(st, me).await?;
    let entries = db::list_ledger_entries(&st.pool).await?.into_iter().map(LedgerRow::from).collect();
    let (balance, month_in, month_out) = db::read_ledger_totals(&st.pool, today()).await?;
    let check = db::find_ledger_check(&st.pool).await?;
    Ok(LedgerView {
        balance, month_in, month_out,
        last_check: check.map(|(on, bank, diff)| json!({ "checked_on": on, "bank_balance": bank, "diff": diff })),
        entries, can_write: common::has_scope(st, me, "manage_ledger").await?,
    })
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

pub(crate) async fn add_entry(st: &AppState, me: &User, b: EntryIn) -> Result<LedgerView> {
    need(st, me, "manage_ledger").await?;
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
        let ok = db::has_category(&st.pool, c).await?;
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
        let exists = db::has_opening_entry(&mut *tx).await?;
        if exists {
            return Err(AppError::Conflict("opening_exists"));
        }
    }
    att::claimable_for(&mut *tx, me.id, &mut attach, Purpose::Ledger).await?;
    let id = db::insert_ledger_entry(&mut *tx, b.occurred_on, amount, &b.kind, &desc, b.category_id, b.event_id, me.id).await?;
    db::insert_ledger_attachments(&mut *tx, id, &attach).await?;
    tx.commit().await?;
    ledger(st, me).await
}

#[derive(Deserialize)]
pub struct ReverseIn {
    #[serde(default)]
    note: Option<String>,
}

pub(crate) async fn reverse_entry(st: &AppState, me: &User, id: Uuid, b: ReverseIn) -> Result<LedgerView> {
    need(st, me, "manage_ledger").await?;
    let note = text(b.note, 200, "invalid_note")?;
    let mut tx = st.pool.begin().await?;
    let row = db::lock_entry_reversal(&mut *tx, id).await?;
    let (kind, desc, reversed) = row.ok_or(AppError::NotFound)?;
    if kind == "reversal" || reversed {
        return Err(AppError::Conflict("already_reversed"));
    }
    let text = match note {
        Some(n) => format!("Ters kayıt · {desc} · {n}"),
        None => format!("Ters kayıt · {desc}"),
    };
    db::insert_entry_reversal(&mut *tx, id, today(), &text, me.id).await?;
    tx.commit().await?;
    ledger(st, me).await
}

#[derive(Deserialize)]
pub struct CheckIn {
    checked_on: NaiveDate,
    bank_balance: f64,
}

pub(crate) async fn add_check(st: &AppState, me: &User, b: CheckIn) -> Result<LedgerView> {
    need(st, me, "manage_ledger").await?;
    let bal = if b.bank_balance.abs() < 0.005 { 0 } else {
        finance::signed_cents(b.bank_balance).ok_or(AppError::BadRequest("invalid_amount"))?
    };
    if b.checked_on > today() {
        return Err(AppError::BadRequest("invalid_date"));
    }
    db::insert_ledger_check(&st.pool, b.checked_on, bal, me.id).await?;
    ledger(st, me).await
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
pub(crate) async fn payout(st: &AppState, me: &User, b: PayoutIn) -> Result<LedgerView> {
    need(st, me, "manage_ledger").await?;
    let amount = cents(b.amount).ok_or(AppError::BadRequest("invalid_amount"))?;
    let name = db::find_user_name(&st.pool, b.user_id).await?;
    let name = name.ok_or(AppError::BadRequest("invalid_user_id"))?;
    let desc = text(b.description, DESC_MAX, "invalid_description")?.unwrap_or_else(|| format!("{name} için iade"));
    let on = b.occurred_on.unwrap_or_else(today);
    if on > today() {
        return Err(AppError::BadRequest("invalid_date"));
    }
    db::insert_member_payout(&st.pool, on, amount, &desc, b.user_id, me.id).await?;
    ledger(st, me).await
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

pub(crate) async fn summary(st: &AppState, me: &User) -> Result<Summary> {
    need_viewer(st, me).await?;
    let p = &st.pool;
    let cash_balance = db::read_cash_balance(p).await?;
    let last_check = db::find_summary_check(p).await?;
    let (seb_receivable, unclaimed) = db::read_seb_receivable(p).await?;
    let claims_waiting = db::count_waiting_claims(p).await?;
    // Uyeye borc: onayli, uye odemis faturalar - o kisiye yapilan odemeler.
    // Odenebilir kisim: genel fonlu kalemler + dosyasi odenmis SEB kalemleri.
    let debts = db::list_member_debts(p).await?;
    let member_debts = debts.into_iter().map(|db::MemberDebtRow { user_id: u, total, payable, paid }| json!({
        "user_id": u,
        "outstanding": total - paid,
        "payable": (payable - paid).max(0.0),
    })).collect();
    let (pending_invoices, oldest_pending) = db::read_pending_invoices(p).await?;
    let day = today();
    let horizon = day + chrono::Duration::days(UPCOMING_DAYS);
    let mut upcoming: Vec<Value> = Vec::new();
    let mats = db::list_due_materials(p, horizon).await?;
    for m in mats {
        upcoming.push(json!({ "kind": "material", "id": m.id, "label": m.name, "event": m.title, "due": m.due, "amount": m.price }));
    }
    let rec = db::list_due_recurring(p, horizon).await?;
    for db::DueRecurringRow { id, name, next_on: due, amount, currency } in rec {
        upcoming.push(json!({ "kind": "recurring", "id": id, "label": name, "due": due, "amount": amount, "currency": currency }));
    }
    Ok(Summary {
        cash_balance,
        last_check: last_check.map(|(on, bank, diff)| json!({ "checked_on": on, "bank_balance": bank, "diff": diff })),
        seb_receivable, claims_waiting, unclaimed, member_debts, pending_invoices, oldest_pending, upcoming,
    })
}

// --- kur (spec/81 §13) ---------------------------------------------------------------

#[derive(Deserialize)]
pub struct FxQuery {
    currency: String,
    on: NaiveDate,
}

/// TCMB doviz satis kuru; once onbellek (`fx_rates`), yoksa TCMB, hafta sonu/
/// tatilde geriye en fazla 7 gun. Kapaliysa ya da ulasilamazsa 503: form kuru elle ister.
pub(crate) async fn fx(st: &AppState, q: FxQuery) -> Result<Value> {
    let currency = finance::currency(&q.currency).filter(|c| c != "TRY").ok_or(AppError::BadRequest("invalid_currency"))?;
    if q.on > today() {
        return Err(AppError::BadRequest("invalid_date"));
    }
    for day in finance::lookback(q.on) {
        let cached = db::find_fx_rate(&st.pool, day, &currency).await?;
        if let Some(rate) = cached {
            return Ok(json!({ "currency": currency, "on": day, "rate": rate, "source": "tcmb" }));
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
            db::insert_fx_rate(&st.pool, day, &currency, m).await?;
        }
        return Ok(json!({ "currency": currency, "on": day, "rate": rate, "source": "tcmb" }));
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
