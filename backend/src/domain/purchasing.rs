//! Maliye > satin alimlar (spec/81 §7): butun kalemler (Malzemeler), etkinlikten
//! bagimsiz kalemlerin 3 sutunlu duvari ve tedarikciler.
//!
//! Gormek "maliye" (finance::need_viewer); yazmak `manage_purchases`. Etkinlige
//! bagli kalemin tedariki etkinlik widget'inda kalir (api/events.rs); burada
//! yalniz etkinliksiz kalem acilir ve duvarda sutun degistirir.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::domain::finance::{need, need_viewer, today};
use crate::{
    db::purchasing as db_purchasing,
    domain::common,
    error::{AppError, Result},
    finance::cents,
    models::user::User,
    normalize::{self, Kind},
    state::AppState,
};

const NAME_MAX: usize = 200;
const NOTE_MAX: usize = 2000;
const WALL_PAGE_MAX: i64 = 500;

/// Kalem satiri: kart fiyati (secili teklif / sponsor / en dusuk), tedarikci,
/// gelis, etkinlik, kategori, onayli faturasi var mi.
#[derive(Serialize)]
pub struct MatRow {
    id: Uuid,
    name: String,
    qty: i32,
    kind: String,
    priority: String,
    state: i16,
    owned: bool,
    purchased: bool,
    delivered: bool,
    sponsor_chosen: bool,
    price: Option<f64>,
    budget: Option<f64>,
    eta: Option<NaiveDate>,
    supplier: Option<String>,
    offer_count: i64,
    event_id: Option<Uuid>,
    event_title: Option<String>,
    event_date: Option<NaiveDate>,
    category_id: Option<Uuid>,
    needed_by: Option<NaiveDate>,
    invoiced: bool,
    created_by: Option<Uuid>,
    created_at: DateTime<Utc>,
    purchased_at: Option<DateTime<Utc>>,
    /// Ayni adli kalemleri tek satirda toplamak icin normalize anahtari (Kind::Plain).
    group_key: String,
}

impl From<db_purchasing::MatRow> for MatRow {
    fn from(r: db_purchasing::MatRow) -> Self {
        Self {
            id: r.id, name: r.name, qty: r.qty, kind: r.kind, priority: r.priority, state: r.state,
            owned: r.owned, purchased: r.purchased, delivered: r.delivered, sponsor_chosen: r.sponsor_chosen,
            price: r.price, budget: r.budget, eta: r.eta, supplier: r.supplier, offer_count: r.offer_count,
            event_id: r.event_id, event_title: r.event_title, event_date: r.event_date, category_id: r.category_id,
            needed_by: r.needed_by, invoiced: r.invoiced, created_by: r.created_by, created_at: r.created_at,
            purchased_at: r.purchased_at, group_key: String::new(),
        }
    }
}

// --- Malzemeler (kuyruklar) ---------------------------------------------------------

#[derive(Deserialize)]
pub struct MatQuery {
    #[serde(default)]
    queue: Option<String>,
    /// Etkinlik kimligi ya da `none` (etkinliksiz).
    #[serde(default)]
    event: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    category: Option<Uuid>,
    #[serde(default)]
    q: Option<String>,
    /// Gunluk aralik: etkinlik gunu, yoksa gerektigi gun (iki ucu da dahil).
    #[serde(default)]
    from: Option<NaiveDate>,
    #[serde(default)]
    to: Option<NaiveDate>,
}

#[derive(Serialize)]
pub struct MatList {
    rows: Vec<MatRow>,
    counts: HashMap<&'static str, i64>,
}

const QUEUES: [&str; 5] = ["review", "ship", "invoice", "open", "all"];

pub(crate) async fn materials(st: &AppState, me: &User, q: MatQuery) -> Result<MatList> {
    need_viewer(st, me).await?;
    let queue = q.queue.as_deref().filter(|x| QUEUES.contains(x)).unwrap_or("review").to_string();
    let none = q.event.as_deref() == Some("none");
    let event: Option<Uuid> = q.event.as_deref().filter(|e| *e != "none").and_then(|e| e.parse().ok());
    let search = q.q.map(|s| s.trim().replace(['%', '_'], "")).filter(|s| !s.is_empty());
    let mut rows: Vec<MatRow> = db_purchasing::list_materials(&st.pool, &queue, event, none, q.kind.as_deref(),
        q.category, search.as_deref(), q.from, q.to).await?.into_iter().map(MatRow::from).collect();
    for r in &mut rows {
        r.group_key = normalize::key(Kind::Plain, &r.name);
    }
    let mut counts = HashMap::new();
    for k in QUEUES {
        let n = db_purchasing::count_materials(&st.pool, k, event, none, q.kind.as_deref(),
            q.category, search.as_deref(), q.from, q.to).await?;
        counts.insert(k, n);
    }
    Ok(MatList { rows, counts })
}

// --- Satin alim duvari (etkinliksiz, 3 sutun) ---------------------------------------

#[derive(Deserialize)]
pub struct WallQuery {
    #[serde(default)]
    ahead: Option<i64>,
    #[serde(default)]
    back: Option<i64>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    category: Option<Uuid>,
    #[serde(default)]
    ledger: Option<String>,
    #[serde(default)]
    q: Option<String>,
    #[serde(default)]
    limit_prep: Option<i64>,
    #[serde(default)]
    limit_tobuy: Option<i64>,
    #[serde(default)]
    limit_bought: Option<i64>,
}

#[derive(Serialize)]
pub struct WallColumn {
    items: Vec<MatRow>,
    /// Araliktaki toplam (sayfalamadan once).
    total: i64,
    /// Aralik disinda kalan.
    hidden: i64,
    sum: f64,
}

#[derive(Serialize)]
pub struct Wall {
    prep: WallColumn,
    tobuy: WallColumn,
    bought: WallColumn,
    ahead: i64,
    back: i64,
    /// Kategori basina (aralik icindeki) kalem sayisi: cipler.
    categories: HashMap<Uuid, i64>,
}

/// Kokteki varsayilan araliklar (spec/81 §7.2); yoksa 30 gun.
async fn wall_defaults(st: &AppState) -> Result<(i64, i64)> {
    let attrs = db_purchasing::find_wall_attrs(&st.pool).await?;
    let get = |k: &str| attrs.as_ref().and_then(|a| a.get(k)).and_then(Value::as_i64).unwrap_or(30);
    Ok((get("wall_ahead_days"), get("wall_back_days")))
}

pub(crate) async fn wall(st: &AppState, me: &User, q: WallQuery) -> Result<Wall> {
    need_viewer(st, me).await?;
    let (da, db) = wall_defaults(st).await?;
    // 0 = tumu.
    let ahead = q.ahead.unwrap_or(da).clamp(0, 3650);
    let back = q.back.unwrap_or(db).clamp(0, 3650);
    let search = q.q.map(|s| s.trim().replace(['%', '_'], "")).filter(|s| !s.is_empty());
    let ledger = q.ledger.filter(|l| l == "seb" || l == "general");
    let rows: Vec<MatRow> = db_purchasing::list_wall_materials(&st.pool, q.kind.as_deref(), q.category,
        ledger.as_deref(), search.as_deref()).await?.into_iter().map(MatRow::from).collect();
    let day = today();
    let now = Utc::now();
    let (mut prep, mut tobuy, mut bought) = (Vec::new(), Vec::new(), Vec::new());
    let (mut tobuy_hidden, mut bought_hidden) = (0, 0);
    let mut categories: HashMap<Uuid, i64> = HashMap::new();
    for r in rows {
        let shown = if r.purchased {
            let fresh = back == 0 || r.purchased_at.is_some_and(|t| (now - t).num_days() <= back);
            if fresh { true } else { bought_hidden += 1; false }
        } else if r.state == 3 {
            // Geciken ve tarihsiz her zaman gorunur.
            let near = ahead == 0 || r.needed_by.is_none_or(|d| (d - day).num_days() <= ahead);
            if near { true } else { tobuy_hidden += 1; false }
        } else {
            true
        };
        if !shown {
            continue;
        }
        if let Some(c) = r.category_id {
            *categories.entry(c).or_default() += 1;
        }
        if r.purchased { bought.push(r) } else if r.state == 3 { tobuy.push(r) } else { prep.push(r) }
    }
    // Alinacak: yakin tarih once; alindi: en yeni once.
    tobuy.sort_by_key(|r| r.needed_by.unwrap_or(NaiveDate::MAX));
    bought.sort_by_key(|r| std::cmp::Reverse(r.purchased_at));
    let col = |items: Vec<MatRow>, hidden: i64, limit: Option<i64>| {
        let total = items.len() as i64;
        let sum = items.iter().filter_map(|r| r.price).sum();
        let limit = limit.unwrap_or(50).clamp(1, WALL_PAGE_MAX) as usize;
        WallColumn { items: items.into_iter().take(limit).collect(), total, hidden, sum }
    };
    Ok(Wall {
        prep: col(prep, 0, q.limit_prep),
        tobuy: col(tobuy, tobuy_hidden, q.limit_tobuy),
        bought: col(bought, bought_hidden, q.limit_bought),
        ahead, back, categories,
    })
}

#[derive(Deserialize)]
pub struct OfferIn {
    #[serde(default)]
    vendor_id: Option<Uuid>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    price: Option<f64>,
}

#[derive(Deserialize)]
pub struct NewMaterial {
    name: String,
    /// Zorunlu; eksikse `category_required` (serde hatasi degil).
    #[serde(default)]
    category_id: Option<Uuid>,
    #[serde(default)]
    needed_by: Option<NaiveDate>,
    #[serde(default)]
    qty: Option<i32>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    offer: Option<OfferIn>,
}

/// Etkinliksiz kalem (duvar): kategori ZORUNLU (spec/81 §3.3). Istege bagli ilk
/// teklif (tedarikci + fiyat) secili olarak eklenir.
pub(crate) async fn create_material(st: &AppState, me: &User, b: NewMaterial) -> Result<MatRow> {
    need(st, me, "manage_purchases").await?;
    let name = common::text(Some(b.name), NAME_MAX, "invalid_name")?.ok_or(AppError::BadRequest("invalid_name"))?;
    let notes = common::text(b.notes, NOTE_MAX, "invalid_note")?;
    let cat = db_purchasing::active_category_exists(&st.pool, b.category_id).await?;
    if !cat {
        return Err(AppError::BadRequest("category_required"));
    }
    let qty = b.qty.unwrap_or(1);
    if !(1..=100_000).contains(&qty) {
        return Err(AppError::BadRequest("invalid_qty"));
    }
    let kind = match b.kind.as_deref() {
        None => "consumable",
        Some(k @ ("consumable" | "equipment" | "service")) => k,
        Some(_) => return Err(AppError::BadRequest("invalid_type")),
    };
    let mut tx = st.pool.begin().await?;
    let id = db_purchasing::insert_material(&mut *tx, &name, kind, qty, notes.as_deref(), b.category_id, b.needed_by, me.id).await?;
    if let Some(o) = b.offer {
        let price = match o.price {
            Some(p) => Some(cents(p).ok_or(AppError::BadRequest("invalid_price"))?),
            None => None,
        };
        let vendor_name: Option<String> = match o.vendor_id {
            Some(v) => Some(db_purchasing::find_vendor_name(&mut *tx, v).await?.ok_or(AppError::BadRequest("invalid_vendor"))?),
            None => None,
        };
        let label = common::text(o.name, NAME_MAX, "invalid_name")?.or(vendor_name);
        if let Some(label) = label {
            // Kayitli tedarikci verilmediyse yazilan ad bul-ya-da-ac ile baglanir.
            let vendor = match o.vendor_id {
                Some(v) => Some(v),
                None => ensure_vendor(&mut tx, &label, Some(me.id)).await?,
            };
            let pid = db_purchasing::insert_provider(&mut *tx, id, &label, price, vendor).await?;
            db_purchasing::set_chosen_provider(&mut *tx, id, pid).await?;
        }
    }
    tx.commit().await?;
    one(st, id).await
}

async fn one(st: &AppState, id: Uuid) -> Result<MatRow> {
    db_purchasing::find_material(&st.pool, id).await?.map(MatRow::from).ok_or(AppError::NotFound)
}

#[derive(Serialize)]
struct MatInvoice {
    id: Uuid,
    purchased_on: NaiveDate,
    status: String,
    amount: f64,
}

#[derive(Serialize)]
pub struct MatFull {
    /// Etkinlik widget'inin kalem sekli (teklifler, kademeler dahil).
    material: crate::domain::events::Material,
    event_id: Option<Uuid>,
    event_title: Option<String>,
    event_date: Option<NaiveDate>,
    category_id: Option<Uuid>,
    needed_by: Option<NaiveDate>,
    invoices: Vec<MatInvoice>,
}

/// Tek kalem ayrintisi: etkinlikli ya da etkinliksiz. Duzenleme uclari ayni
/// `/api/materials/..` yollaridir (kalem etkinliksizse cevap kalemin kendisi).
pub(crate) async fn material(st: &AppState, me: &User, id: Uuid) -> Result<MatFull> {
    need_viewer(st, me).await?;
    let row = one(st, id).await?;
    let material = crate::domain::events::material_one(&st.pool, id).await?;
    let invoices = db_purchasing::list_material_invoices(&st.pool, id).await?.into_iter().map(|r| MatInvoice {
        id: r.id, purchased_on: r.purchased_on, status: r.status, amount: r.amount,
    }).collect();
    Ok(MatFull {
        material,
        event_id: row.event_id, event_title: row.event_title, event_date: row.event_date,
        category_id: row.category_id, needed_by: row.needed_by, invoices,
    })
}

#[derive(Deserialize)]
pub struct MaterialPatch {
    #[serde(default)]
    state: Option<i16>,
    #[serde(default, deserialize_with = "common::present")]
    needed_by: Option<Option<NaiveDate>>,
    #[serde(default)]
    category_id: Option<Uuid>,
}

/// Duvarda sutun degistirme ve tarih/kategori: yalniz ETKINLIKSIZ kalem (etkinlik
/// kalemi widget'ta yonetilir). Satin alinmis kalem geri adima alinmaz.
pub(crate) async fn patch_material(st: &AppState, me: &User, id: Uuid, b: MaterialPatch) -> Result<MatRow> {
    need(st, me, "manage_purchases").await?;
    let mut tx = st.pool.begin().await?;
    let row = db_purchasing::lock_material(&mut *tx, id).await?;
    let (purchased, has_event) = row.ok_or(AppError::NotFound)?;
    if has_event {
        return Err(AppError::Conflict("event_material"));
    }
    if let Some(s) = b.state {
        if !(0..=3).contains(&s) {
            return Err(AppError::BadRequest("invalid_state"));
        }
        if purchased && s < 3 {
            return Err(AppError::Conflict("purchased_locked"));
        }
        db_purchasing::set_material_state(&mut *tx, id, s).await?;
    }
    if let Some(n) = b.needed_by {
        db_purchasing::set_needed_by(&mut *tx, id, n).await?;
    }
    if let Some(c) = b.category_id {
        let ok = crate::db::nodes::category_exists(&mut *tx, c).await?;
        if !ok {
            return Err(AppError::BadRequest("invalid_category"));
        }
        db_purchasing::set_category(&mut *tx, id, c).await?;
    }
    tx.commit().await?;
    one(st, id).await
}

// --- Tedarikci bul-ya-da-ac ----------------------------------------------------------

/// Gorunen adla CANLI tedarikciyi bulur, yoksa acar (spec/84 M2). Anahtar bos
/// (yalniz gurultu) ise `None`: o metin tedarikci sayilmaz.
pub(crate) async fn ensure_vendor(conn: &mut sqlx::PgConnection, label: &str, by: Option<Uuid>) -> Result<Option<Uuid>> {
    let label = label.trim();
    let key = normalize::key(Kind::Vendor, label);
    if key.is_empty() || label.chars().count() > NAME_MAX {
        return Ok(None);
    }
    let id = db_purchasing::upsert_vendor(conn, label, &key, by).await?;
    Ok(Some(id))
}

/// Tekliften tedarikci adi: etiket (`name`) once; yoksa `contact`, yalniz ad gibi
/// gorunuyorsa (harf var, '@' yok, cogu rakam degil). Telefon/e-posta tedarikci olmaz.
pub(crate) fn offer_label<'a>(name: Option<&'a str>, contact: &'a str) -> Option<&'a str> {
    if let Some(n) = name.map(str::trim).filter(|n| !n.is_empty()) {
        return Some(n);
    }
    let c = contact.trim();
    let letters = c.chars().filter(|ch| ch.is_alphabetic()).count();
    let digits = c.chars().filter(char::is_ascii_digit).count();
    (letters > 0 && !c.contains('@') && digits <= letters).then_some(c)
}

/// Acilista, bagi olmayan tekliflere tedarikci acar/baglar. Tekrar kosmasi guvenli.
pub(crate) async fn backfill_vendors(pool: &sqlx::PgPool) -> Result<u64> {
    let rows = db_purchasing::list_unlinked_providers(pool).await?;
    let mut linked = 0;
    let mut conn = pool.acquire().await?;
    for (id, name, contact) in rows {
        let Some(label) = offer_label(name.as_deref(), &contact) else { continue };
        if let Some(v) = ensure_vendor(&mut conn, label, None).await? {
            db_purchasing::set_provider_vendor(&mut *conn, id, Some(v)).await?;
            linked += 1;
        }
    }
    Ok(linked)
}

// --- Tedarikciler -----------------------------------------------------------------

#[derive(Serialize)]
pub struct VendorRow {
    id: Uuid,
    name: String,
    contact: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    url: Option<String>,
    issues_invoice: Option<bool>,
    note: Option<String>,
    offer_count: i64,
    /// Tekliflerinin ait oldugu farkli etkinlik sayisi.
    event_count: i64,
    invoice_total: f64,
    aliases: Vec<String>,
    created_at: DateTime<Utc>,
}

impl From<db_purchasing::VendorRow> for VendorRow {
    fn from(r: db_purchasing::VendorRow) -> Self {
        Self {
            id: r.id, name: r.name, contact: r.contact, phone: r.phone, email: r.email, url: r.url,
            issues_invoice: r.issues_invoice, note: r.note, offer_count: r.offer_count, event_count: r.event_count,
            invoice_total: r.invoice_total, aliases: r.aliases, created_at: r.created_at,
        }
    }
}

#[derive(Deserialize)]
pub struct VendorQuery {
    #[serde(default)]
    q: Option<String>,
}

/// Canli tedarikciler; arama takma adlari da bulur (spec/84 M1).
pub(crate) async fn vendors(st: &AppState, me: &User, q: VendorQuery) -> Result<Vec<VendorRow>> {
    need_viewer(st, me).await?;
    let key = q.q.as_deref().map(|s| normalize::key(Kind::Plain, s)).filter(|k| !k.is_empty());
    Ok(db_purchasing::list_vendors(&st.pool, key).await?.into_iter().map(VendorRow::from).collect())
}

#[derive(Deserialize)]
pub struct VendorIn {
    name: String,
    #[serde(default)]
    contact: Option<String>,
    #[serde(default)]
    phone: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    issues_invoice: Option<bool>,
    #[serde(default)]
    note: Option<String>,
}

/// Ayni anahtar = ayni tedarikci (spec/84 M2): yeni satir acilmaz, var olan doner.
pub(crate) async fn create_vendor(st: &AppState, me: &User, b: VendorIn) -> Result<Value> {
    need(st, me, "manage_purchases").await?;
    let name = common::text(Some(b.name), NAME_MAX, "invalid_name")?.ok_or(AppError::BadRequest("invalid_name"))?;
    let key = normalize::key(Kind::Vendor, &name);
    if key.is_empty() {
        return Err(AppError::BadRequest("invalid_name"));
    }
    let existing = db_purchasing::find_vendor_id(&st.pool, &key).await?;
    let (id, existing) = match existing {
        Some(id) => (id, true),
        None => {
            let mut conn = st.pool.acquire().await?;
            let id = ensure_vendor(&mut conn, &name, Some(me.id)).await?.ok_or(AppError::BadRequest("invalid_name"))?;
            db_purchasing::set_vendor_details(&mut *conn, id,
                common::text(b.contact, 200, "invalid_contact")?,
                common::text(b.phone, 30, "invalid_phone")?,
                common::text(b.email, 200, "invalid_email")?,
                common::text(b.url, 500, "invalid_link")?, b.issues_invoice,
                common::text(b.note, NOTE_MAX, "invalid_note")?).await?;
            (id, false)
        }
    };
    Ok(json!({ "vendor": vendor_one(st, id).await?, "existing": existing }))
}

async fn vendor_one(st: &AppState, id: Uuid) -> Result<VendorRow> {
    db_purchasing::find_vendor(&st.pool, id).await?.map(VendorRow::from).ok_or(AppError::NotFound)
}

#[derive(Serialize)]
pub struct VendorOffer {
    material_id: Uuid,
    material: String,
    event_title: Option<String>,
    price: Option<f64>,
    chosen: bool,
    purchased: bool,
    at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct VendorDetail {
    vendor: VendorRow,
    /// Birlesmis (takma ad) ise kanonigi: ekran oraya yonlenir.
    merged_into: Option<Uuid>,
    offers: Vec<VendorOffer>,
    invoices: Vec<Value>,
}

pub(crate) async fn vendor(st: &AppState, me: &User, id: Uuid) -> Result<VendorDetail> {
    need_viewer(st, me).await?;
    let merged_into = db_purchasing::find_merged_into(&st.pool, id).await?;
    let merged_into = merged_into.ok_or(AppError::NotFound)?;
    let offers = db_purchasing::list_vendor_offers(&st.pool, id).await?.into_iter().map(|r| VendorOffer {
        material_id: r.material_id, material: r.material, event_title: r.event_title, price: r.price,
        chosen: r.chosen, purchased: r.purchased, at: r.at,
    }).collect();
    let inv = db_purchasing::list_vendor_invoices(&st.pool, id).await?;
    Ok(VendorDetail {
        vendor: vendor_one(st, id).await?, merged_into, offers,
        invoices: inv.into_iter().map(|r| json!({ "id": r.id, "purchased_on": r.purchased_on, "total_try": r.total, "status": r.status })).collect(),
    })
}

#[derive(Deserialize)]
pub struct VendorPatch {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, deserialize_with = "common::present")]
    contact: Option<Option<String>>,
    #[serde(default, deserialize_with = "common::present")]
    phone: Option<Option<String>>,
    #[serde(default, deserialize_with = "common::present")]
    email: Option<Option<String>>,
    #[serde(default, deserialize_with = "common::present")]
    url: Option<Option<String>>,
    #[serde(default, deserialize_with = "common::present")]
    issues_invoice: Option<Option<bool>>,
    #[serde(default, deserialize_with = "common::present")]
    note: Option<Option<String>>,
}

pub(crate) async fn patch_vendor(st: &AppState, me: &User, id: Uuid, b: VendorPatch) -> Result<VendorRow> {
    need(st, me, "manage_purchases").await?;
    let mut tx = st.pool.begin().await?;
    let live = db_purchasing::lock_live_vendor(&mut *tx, id).await?;
    if !live.ok_or(AppError::NotFound)? {
        return Err(AppError::Conflict("vendor_merged"));
    }
    if let Some(n) = b.name {
        let name = common::text(Some(n), NAME_MAX, "invalid_name")?.ok_or(AppError::BadRequest("invalid_name"))?;
        let key = normalize::key(Kind::Vendor, &name);
        let clash = db_purchasing::vendor_key_exists(&mut *tx, &key, id).await?;
        if clash {
            return Err(AppError::Conflict("vendor_exists"));
        }
        db_purchasing::set_vendor_name(&mut *tx, id, name, key).await?;
    }
    let field = |v: Option<Option<String>>, max: usize, code: &'static str| -> Result<Option<Option<String>>> {
        v.map(|x| common::text(x, max, code)).transpose()
    };
    let contact = field(b.contact, 200, "invalid_contact")?;
    let phone = field(b.phone, 30, "invalid_phone")?;
    let email = field(b.email, 200, "invalid_email")?;
    let url = field(b.url, 500, "invalid_link")?;
    let note = field(b.note, NOTE_MAX, "invalid_note")?;
    db_purchasing::patch_vendor_details(&mut *tx, id, contact, phone, email, url, b.issues_invoice, note).await?;
    tx.commit().await?;
    vendor_one(st, id).await
}
