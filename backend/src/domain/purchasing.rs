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
#[derive(Serialize, sqlx::FromRow)]
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
    #[sqlx(skip)]
    group_key: String,
}

/// Ortak FROM: secili ve en ucuz teklif yanal birlesimle (tek sorgu, N+1 yok).
macro_rules! mat_select {
    () => {
        "select m.id, m.name, m.qty, m.type as kind, m.priority, m.state, m.owned, m.purchased, m.delivered,
                m.sponsor_chosen,
                (case when m.sponsor_chosen then 0 else coalesce(cp.price, mp.price) end)::float8 as price,
                m.budget::float8 as budget,
                case when m.sponsor_chosen then m.sponsor_date else coalesce(cp.arrival_date, mp.arrival_date) end as eta,
                case when m.sponsor_chosen then 'Sponsor' else coalesce(cp.who, mp.who) end as supplier,
                (select count(*) from material_providers p where p.material_id = m.id) as offer_count,
                e.id as event_id, e.title as event_title, e.date as event_date, m.category_id, m.needed_by,
                exists(select 1 from invoice_items ii join invoices i on i.id = ii.invoice_id
                        where ii.material_id = m.id and i.status = 'approved') as invoiced,
                m.created_by, m.created_at, m.purchased_at
           from materials m
           left join event_materials em on em.material_id = m.id
           left join events e on e.id = em.event_id
           left join lateral (
             select p.price, p.arrival_date, coalesce(v.name, p.name, p.contact) as who
               from material_providers p left join vendors v on v.id = p.vendor_id
              where p.id = m.chosen_provider_id) cp on true
           left join lateral (
             select p.price, p.arrival_date, coalesce(v.name, p.name, p.contact) as who
               from material_providers p left join vendors v on v.id = p.vendor_id
              where p.material_id = m.id and p.price is not null order by p.price limit 1) mp on true "
    };
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

/// Kuyruklar (spec/81 §7.1). Kosul tek yerde, liste ve sayim ayni ifadeyi kullanir.
macro_rules! queue_where {
    () => {
        "(($1 = 'review' and m.state = 3 and not m.owned and not m.purchased)
          or ($1 = 'ship' and m.purchased and not m.delivered)
          or ($1 = 'invoice' and m.purchased and not exists(select 1 from invoice_items ii join invoices i on i.id = ii.invoice_id
                                                             where ii.material_id = m.id and i.status = 'approved'))
          or ($1 = 'open' and m.state < 3 and not m.owned)
          or $1 = 'all')"
    };
}

macro_rules! filter_where {
    () => {
        "($2::uuid is null or e.id = $2) and (not $3 or em.material_id is null)
         and ($4::text is null or m.type = $4) and ($5::uuid is null or m.category_id = $5)
         and ($6::text is null or m.name ilike '%' || $6 || '%'
              or exists(select 1 from material_providers p left join vendors v on v.id = p.vendor_id
                         where p.material_id = m.id and coalesce(v.name, p.name, p.contact) ilike '%' || $6 || '%'))
         and ($7::date is null or coalesce(e.date, m.needed_by) >= $7)
         and ($8::date is null or coalesce(e.date, m.needed_by) <= $8)"
    };
}

const QUEUES: [&str; 5] = ["review", "ship", "invoice", "open", "all"];

pub(crate) async fn materials(st: &AppState, me: &User, q: MatQuery) -> Result<MatList> {
    need_viewer(st, me).await?;
    let queue = q.queue.as_deref().filter(|x| QUEUES.contains(x)).unwrap_or("review").to_string();
    let none = q.event.as_deref() == Some("none");
    let event: Option<Uuid> = q.event.as_deref().filter(|e| *e != "none").and_then(|e| e.parse().ok());
    let search = q.q.map(|s| s.trim().replace(['%', '_'], "")).filter(|s| !s.is_empty());
    let mut rows: Vec<MatRow> = sqlx::query_as(concat!(mat_select!(), "where ", queue_where!(), " and ", filter_where!(),
        " order by coalesce(e.date, m.needed_by) nulls last, e.title, m.name limit 500"))
        .bind(&queue).bind(event).bind(none).bind(&q.kind).bind(q.category).bind(&search).bind(q.from).bind(q.to)
        .fetch_all(&st.pool).await?;
    for r in &mut rows {
        r.group_key = normalize::key(Kind::Plain, &r.name);
    }
    let mut counts = HashMap::new();
    for k in QUEUES {
        let n: i64 = sqlx::query_scalar(concat!(
            "select count(*) from materials m left join event_materials em on em.material_id = m.id
               left join events e on e.id = em.event_id where ", queue_where!(), " and ", filter_where!()))
            .bind(k).bind(event).bind(none).bind(&q.kind).bind(q.category).bind(&search).bind(q.from).bind(q.to)
            .fetch_one(&st.pool).await?;
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
    let attrs: Option<Value> = sqlx::query_scalar("select attrs from nodes where key = 'finance'")
        .fetch_optional(&st.pool).await?;
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
    let rows: Vec<MatRow> = sqlx::query_as(concat!(mat_select!(),
        "left join nodes cat on cat.id = m.category_id
          where em.material_id is null and not m.owned
            and ($1::text is null or m.type = $1) and ($2::uuid is null or m.category_id = $2)
            and ($3::text is null or cat.attrs->>'ledger' = $3)
            and ($4::text is null or m.name ilike '%' || $4 || '%')
          order by m.created_at desc limit 5000"))
        .bind(&q.kind).bind(q.category).bind(&ledger).bind(&search)
        .fetch_all(&st.pool).await?;
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
    let cat: bool = sqlx::query_scalar("select exists(select 1 from nodes where id = $1 and node_type = 'category' and is_active)")
        .bind(b.category_id).fetch_one(&st.pool).await?;
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
    let id: Uuid = sqlx::query_scalar(
        "insert into materials (name, type, qty, notes, category_id, needed_by, created_by)
         values ($1, $2, $3, $4, $5, $6, $7) returning id")
        .bind(&name).bind(kind).bind(qty).bind(&notes).bind(b.category_id).bind(b.needed_by).bind(me.id)
        .fetch_one(&mut *tx).await?;
    if let Some(o) = b.offer {
        let price = match o.price {
            Some(p) => Some(cents(p).ok_or(AppError::BadRequest("invalid_price"))?),
            None => None,
        };
        let vendor_name: Option<String> = match o.vendor_id {
            Some(v) => Some(sqlx::query_scalar("select name from vendors where id = $1 and merged_into is null")
                .bind(v).fetch_optional(&mut *tx).await?.ok_or(AppError::BadRequest("invalid_vendor"))?),
            None => None,
        };
        let label = common::text(o.name, NAME_MAX, "invalid_name")?.or(vendor_name);
        if let Some(label) = label {
            // Kayitli tedarikci verilmediyse yazilan ad bul-ya-da-ac ile baglanir.
            let vendor = match o.vendor_id {
                Some(v) => Some(v),
                None => ensure_vendor(&mut tx, &label, Some(me.id)).await?,
            };
            let pid: Uuid = sqlx::query_scalar(
                "insert into material_providers (material_id, contact, name, price, vendor_id)
                 values ($1, $2, $2, $3::bigint::numeric / 100, $4) returning id")
                .bind(id).bind(&label).bind(price).bind(vendor).fetch_one(&mut *tx).await?;
            sqlx::query("update materials set chosen_provider_id = $2, state = 2 where id = $1")
                .bind(id).bind(pid).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    one(st, id).await
}

async fn one(st: &AppState, id: Uuid) -> Result<MatRow> {
    sqlx::query_as(concat!(mat_select!(), "where m.id = $1"))
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)
}

#[derive(Serialize, sqlx::FromRow)]
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
    let invoices: Vec<MatInvoice> = sqlx::query_as(
        "select i.id, i.purchased_on, i.status, ii.amount::float8 as amount
           from invoice_items ii join invoices i on i.id = ii.invoice_id
          where ii.material_id = $1 order by i.purchased_on desc, i.created_at desc")
        .bind(id).fetch_all(&st.pool).await?;
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
    let row: Option<(bool, bool)> = sqlx::query_as(
        "select m.purchased, exists(select 1 from event_materials em where em.material_id = m.id)
           from materials m where m.id = $1 for update")
        .bind(id).fetch_optional(&mut *tx).await?;
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
        sqlx::query(
            "update materials set state = $2, delivered = case when $2 < 3 then false else delivered end,
                    updated_at = now() where id = $1")
            .bind(id).bind(s).execute(&mut *tx).await?;
    }
    if let Some(n) = b.needed_by {
        sqlx::query("update materials set needed_by = $2, updated_at = now() where id = $1")
            .bind(id).bind(n).execute(&mut *tx).await?;
    }
    if let Some(c) = b.category_id {
        let ok: bool = sqlx::query_scalar("select exists(select 1 from nodes where id = $1 and node_type = 'category')")
            .bind(c).fetch_one(&mut *tx).await?;
        if !ok {
            return Err(AppError::BadRequest("invalid_category"));
        }
        sqlx::query("update materials set category_id = $2, updated_at = now() where id = $1")
            .bind(id).bind(c).execute(&mut *tx).await?;
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
    let id = sqlx::query_scalar(
        "insert into vendors (name, name_key, created_by) values ($1, $2, $3)
         on conflict (name_key) where merged_into is null do update set name_key = excluded.name_key
         returning id")
        .bind(label).bind(&key).bind(by).fetch_one(conn).await?;
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
    let rows: Vec<(Uuid, Option<String>, String)> = sqlx::query_as(
        "select id, name, contact from material_providers where vendor_id is null").fetch_all(pool).await?;
    let mut linked = 0;
    let mut conn = pool.acquire().await?;
    for (id, name, contact) in rows {
        let Some(label) = offer_label(name.as_deref(), &contact) else { continue };
        if let Some(v) = ensure_vendor(&mut conn, label, None).await? {
            sqlx::query("update material_providers set vendor_id = $2 where id = $1")
                .bind(id).bind(v).execute(&mut *conn).await?;
            linked += 1;
        }
    }
    Ok(linked)
}

// --- Tedarikciler -----------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
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

macro_rules! vendor_select {
    () => {
        "select v.id, v.name, v.contact, v.phone, v.email, v.url, v.issues_invoice, v.note,
                (select count(*) from material_providers p where p.vendor_id = v.id) as offer_count,
                (select count(distinct em.event_id) from material_providers p
                   join event_materials em on em.material_id = p.material_id where p.vendor_id = v.id) as event_count,
                coalesce((select sum(i.total_try) from invoices i where i.vendor_id = v.id and i.status = 'approved'), 0)::float8
                  as invoice_total,
                array(select a.name from vendors a where a.merged_into = v.id order by a.name) as aliases,
                v.created_at
           from vendors v "
    };
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
    Ok(sqlx::query_as(concat!(vendor_select!(),
        "where v.merged_into is null
           and ($1::text is null or v.name_key like '%' || $1 || '%'
                or exists(select 1 from vendors a where a.merged_into = v.id and a.name_key like '%' || $1 || '%'))
         order by v.name"))
        .bind(key).fetch_all(&st.pool).await?)
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
    let existing: Option<Uuid> = sqlx::query_scalar("select id from vendors where name_key = $1 and merged_into is null")
        .bind(&key).fetch_optional(&st.pool).await?;
    let (id, existing) = match existing {
        Some(id) => (id, true),
        None => {
            let mut conn = st.pool.acquire().await?;
            let id = ensure_vendor(&mut conn, &name, Some(me.id)).await?.ok_or(AppError::BadRequest("invalid_name"))?;
            sqlx::query("update vendors set contact = $2, phone = $3, email = $4, url = $5, issues_invoice = $6, note = $7 where id = $1")
                .bind(id)
                .bind(common::text(b.contact, 200, "invalid_contact")?)
                .bind(common::text(b.phone, 30, "invalid_phone")?)
                .bind(common::text(b.email, 200, "invalid_email")?)
                .bind(common::text(b.url, 500, "invalid_link")?)
                .bind(b.issues_invoice)
                .bind(common::text(b.note, NOTE_MAX, "invalid_note")?)
                .execute(&mut *conn).await?;
            (id, false)
        }
    };
    Ok(json!({ "vendor": vendor_one(st, id).await?, "existing": existing }))
}

async fn vendor_one(st: &AppState, id: Uuid) -> Result<VendorRow> {
    sqlx::query_as(concat!(vendor_select!(), "where v.id = $1"))
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)
}

#[derive(Serialize, sqlx::FromRow)]
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
    let merged_into: Option<Option<Uuid>> = sqlx::query_scalar("select merged_into from vendors where id = $1")
        .bind(id).fetch_optional(&st.pool).await?;
    let merged_into = merged_into.ok_or(AppError::NotFound)?;
    let offers: Vec<VendorOffer> = sqlx::query_as(
        "select m.id as material_id, m.name as material, e.title as event_title, p.price::float8 as price,
                m.chosen_provider_id = p.id as chosen, m.purchased, m.updated_at as at
           from material_providers p join materials m on m.id = p.material_id
           left join event_materials em on em.material_id = m.id left join events e on e.id = em.event_id
          where p.vendor_id = $1 order by m.updated_at desc limit 200")
        .bind(id).fetch_all(&st.pool).await?;
    let inv: Vec<(Uuid, NaiveDate, f64, String)> = sqlx::query_as(
        "select id, purchased_on, total_try::float8, status from invoices where vendor_id = $1 order by purchased_on desc limit 100")
        .bind(id).fetch_all(&st.pool).await?;
    Ok(VendorDetail {
        vendor: vendor_one(st, id).await?, merged_into, offers,
        invoices: inv.into_iter().map(|(id, on, t, s)| json!({ "id": id, "purchased_on": on, "total_try": t, "status": s })).collect(),
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
    let live: Option<bool> = sqlx::query_scalar("select merged_into is null from vendors where id = $1 for update")
        .bind(id).fetch_optional(&mut *tx).await?;
    if !live.ok_or(AppError::NotFound)? {
        return Err(AppError::Conflict("vendor_merged"));
    }
    if let Some(n) = b.name {
        let name = common::text(Some(n), NAME_MAX, "invalid_name")?.ok_or(AppError::BadRequest("invalid_name"))?;
        let key = normalize::key(Kind::Vendor, &name);
        let clash: bool = sqlx::query_scalar(
            "select exists(select 1 from vendors where name_key = $1 and merged_into is null and id <> $2)")
            .bind(&key).bind(id).fetch_one(&mut *tx).await?;
        if clash {
            return Err(AppError::Conflict("vendor_exists"));
        }
        sqlx::query("update vendors set name = $2, name_key = $3 where id = $1")
            .bind(id).bind(name).bind(key).execute(&mut *tx).await?;
    }
    let field = |v: Option<Option<String>>, max: usize, code: &'static str| -> Result<Option<Option<String>>> {
        v.map(|x| common::text(x, max, code)).transpose()
    };
    let contact = field(b.contact, 200, "invalid_contact")?;
    let phone = field(b.phone, 30, "invalid_phone")?;
    let email = field(b.email, 200, "invalid_email")?;
    let url = field(b.url, 500, "invalid_link")?;
    let note = field(b.note, NOTE_MAX, "invalid_note")?;
    sqlx::query(
        "update vendors set
            contact = case when $2 then $3 else contact end,
            phone = case when $4 then $5 else phone end,
            email = case when $6 then $7 else email end,
            url = case when $8 then $9 else url end,
            issues_invoice = case when $10 then $11 else issues_invoice end,
            note = case when $12 then $13 else note end
          where id = $1")
        .bind(id)
        .bind(contact.is_some()).bind(contact.flatten())
        .bind(phone.is_some()).bind(phone.flatten())
        .bind(email.is_some()).bind(email.flatten())
        .bind(url.is_some()).bind(url.flatten())
        .bind(b.issues_invoice.is_some()).bind(b.issues_invoice.flatten())
        .bind(note.is_some()).bind(note.flatten())
        .execute(&mut *tx).await?;
    tx.commit().await?;
    vendor_one(st, id).await
}
