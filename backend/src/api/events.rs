//! Etkinlik planlama (spec/73).
//!
//! Her etkinligin bir IKIZ kaydi var (`events.record_id`): sohbet, arsiv,
//! eylemler orada. Ikiz yalniz `create`'te dogar; var olan kayit ikiz
//! yapilamaz, sonradan degistirilemez (gocteki tetikleyici).
//!
//! Yetki: etkinligi, ikiz kaydini duzenleyebilen (kayit yetki yollari aynen:
//! sorumlu, acan, katilimci, takim, dal) YA DA `manage_events` sahibi duzenler.
//! Checkpoint yapisi (ekle, tarih) yalniz `manage_events`. Isaretlemek ve
//! kaldirmak ONAYLAYICIYA (etkinlik sorumlusu ya da `manage_events`); diger
//! duzenleyen onay ISTER (`event_checkpoint_requests`). Sablon widget'i (kayit disi) `manage_event_widgets`,
//! satin alim `manage_purchases` ister. Okuma herkese acik (kayitlarla ayni).
//!
//! Yazma uclari guncel etkinlik ayrintisini dondurur (kayitlarla ayni sozlesme).

use axum::{
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres};
use uuid::Uuid;

use crate::{
    purchases_xlsx,
    api::{common::{self, Body}, records},
    auth::CurrentUser,
    decision,
    error::{AppError, Result},
    models::{
        enums::{EventStatus, MaterialType, NodeType, Priority, RecordKind, WidgetType},
        record::Record,
        user::User,
    },
    refdata,
    state::AppState,
};

const TITLE_MAX: usize = 200;
const TEXT_MAX: usize = 4000;
const LABEL_MAX: usize = 120;
const ROLE_MAX: usize = 60;
const CONTACT_MAX: usize = 300;
/// numeric(12,2) siniri.
const PRICE_MAX: f64 = 9_999_999_999.99;

// --- satir ------------------------------------------------------------------

/// Liste ve ayrinti AYNI satiri dondurur. `record_ids` = kayit widget'larinin
/// kayitlari (ikiz HARIC: ikiz widget olamaz).
macro_rules! event_cols {
    () => {
        "e.id, e.record_id, e.title, e.kind_id, e.status, e.priority, e.owner_id, e.date,
         to_char(e.start_time, 'HH24:MI') as start_time, e.location_id, e.place, e.attendees, e.description,
         e.created_by, e.created_at, e.updated_at,
         coalesce((select array_agg(w.record_id order by w.position) from event_widgets w
                    where w.event_id = e.id and w.record_id is not null), '{}') as record_ids"
    };
}

#[derive(Serialize, sqlx::FromRow)]
pub struct EventRow {
    id: Uuid,
    record_id: Uuid,
    title: String,
    /// Etkinlik Turleri'ndeki `option` dugumu (adi `/api/meta` nodes'tan).
    kind_id: Uuid,
    status: EventStatus,
    priority: Priority,
    owner_id: Option<Uuid>,
    date: Option<NaiveDate>,
    /// "HH:MM"
    start_time: Option<String>,
    /// Etkinlik Yerleri'ndeki `location`; yoksa `place` metni (kampus disi / tek seferlik).
    location_id: Option<Uuid>,
    place: Option<String>,
    attendees: Option<i32>,
    description: Option<String>,
    created_by: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    record_ids: Vec<Uuid>,
}

async fn load(pool: &PgPool, id: Uuid) -> Result<EventRow> {
    sqlx::query_as(concat!("select ", event_cols!(), " from events e where e.id = $1"))
        .bind(id).fetch_optional(pool).await?.ok_or(AppError::NotFound)
}

/// Okuma herkese acik; tablo tek sayfada (ekip kucuk, suzme istemcide).
pub async fn list(State(st): State<AppState>, CurrentUser(_me): CurrentUser) -> Result<Json<Vec<EventRow>>> {
    Ok(Json(sqlx::query_as(concat!(
        "select ", event_cols!(), " from events e order by e.date nulls last, e.created_at limit 1000"))
        .fetch_all(&st.pool).await?))
}

// --- ayrinti ---------------------------------------------------------------

#[derive(Serialize)]
pub struct Detail {
    #[serde(flatten)]
    event: EventRow,
    participants: Vec<Participant>,
    team_ids: Vec<Uuid>,
    checkpoints: Vec<Checkpoint>,
    widgets: Vec<Widget>,
    materials: Vec<Material>,
    /// Duzenleyebilir mi (etkinlik alanlari, kisiler, takimlar, checkpoint
    /// isaretleme, kayit widget'lari): ikiz kaydi duzenleyebilen ya da `manage_events`.
    can_edit: bool,
    /// `manage_events`: checkpoint ekle/tarih.
    can_manage: bool,
    /// Onaylayici: etkinlik sorumlusu ya da `manage_events`. Adimi dogrudan
    /// isaretler/kaldirir, baskalarinin isteklerini yanitlar.
    can_approve: bool,
    /// Bekleyen onay istekleri: onaylayiciya hepsi, digerine yalniz kendisininki.
    requests: Vec<CheckpointRequest>,
}

#[derive(Serialize, sqlx::FromRow)]
struct CheckpointRequest {
    id: Uuid,
    checkpoint_id: Uuid,
    user_id: Uuid,
    /// "done" | "undone" | "delete"
    action: String,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
struct Participant {
    user_id: Uuid,
    role: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct Checkpoint {
    id: Uuid,
    label: String,
    /// Sablondan gelen icin `events.date + offset_days`; etkinlik havuzdaysa null.
    date: Option<NaiveDate>,
    done: bool,
}

#[derive(Serialize, sqlx::FromRow)]
struct Widget {
    id: Uuid,
    #[serde(rename = "type")]
    kind: WidgetType,
    record_id: Option<Uuid>,
}

/// `materials` sutunlari, `m` takma adiyla (etkinlik ayrintisi ve maliye ayni satiri okur).
macro_rules! material_cols {
    () => {
        "m.id, m.name, m.notes, m.type as kind, m.priority, m.state, m.qty, m.has_sponsor, m.owned,
         m.chosen_provider_id, m.sponsor_chosen, m.sponsor_qty, m.sponsor_date, m.in_sponsor_record,
         m.delivered, m.purchased, m.purchased_at, m.created_by, m.updated_at,
         m.budget::float8 as budget, m.overage_ln"
    };
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Material {
    id: Uuid,
    name: String,
    notes: Option<String>,
    #[serde(rename = "type")]
    kind: MaterialType,
    priority: Priority,
    /// Tamamlanan adim sayisi (0..=3). Sponsor adim degil, ayri istek (`has_sponsor`).
    state: i16,
    qty: i32,
    /// "Sponsordan istendi". Sponsorun sureci arayuzde yok; son secim yetkilide.
    has_sponsor: bool,
    owned: bool,
    /// Secilen teklif; bos ve `sponsor_chosen` ise sponsor secildi, ikisi de bos ise secim yok.
    chosen_provider_id: Option<Uuid>,
    sponsor_chosen: bool,
    sponsor_qty: Option<i32>,
    sponsor_date: Option<NaiveDate>,
    /// Sponsorluk kaydinin aciklamasina islendi mi ("Guncelle" sayaci).
    in_sponsor_record: bool,
    /// Teslim alindi; yalniz onayli kalem. Sutun degil, detaydaki isaret.
    delivered: bool,
    /// Yalniz maliye incelemesi (`review_purchases`); widget onayi satin alindi demek DEGIL.
    purchased: bool,
    purchased_at: Option<DateTime<Utc>>,
    created_by: Option<Uuid>,
    updated_at: DateTime<Utc>,
    /// Kalem butcesi (TL). Bos: butce girilmemis.
    budget: Option<f64>,
    /// ln(kart fiyati / butce). Bos: fiyat ya da butce yok, sponsor secili, ya da fiyat 0.
    overage_ln: Option<f64>,
    /// Kademe (0 $, 1 $$, 2 $$$), `overage_ln` ve kalemin zamanindaki taban ile turetilir.
    #[sqlx(skip)]
    overage_level: Option<u8>,
    #[sqlx(skip)]
    providers: Vec<Provider>,
}

#[derive(Serialize, sqlx::FromRow)]
struct Provider {
    id: Uuid,
    #[serde(skip)]
    material_id: Uuid,
    /// Baglanti ya da telefon.
    contact: String,
    /// Telefon ise kisi/firma adi; baglantida bos.
    name: Option<String>,
    /// numeric(12,2) -> float8 yalniz OKURKEN; toplama sunucuda numeric'te kalir.
    price: Option<f64>,
    arrival_date: Option<NaiveDate>,
    /// Bu teklifin kademesi (kalemin butcesine gore). Sutun degil.
    #[sqlx(skip)]
    overage_level: Option<u8>,
}

// LLM yuku (kisisel/kurumsal veriden arindirilmis); `material_cols!` yukarida tanimli.
mod context;
pub(crate) use context::{llm_context, llm_restore};

async fn detail_of(st: &AppState, me: &User, event: EventRow) -> Result<Detail> {
    let twin = records::load(&st.pool, event.record_id).await?;
    let can_manage = common::has_scope(st, me, "manage_events").await?;
    let can_edit = can_manage || crate::db::scope::can_edit_record(&st.pool, me, &twin, &st.tree).await?;
    let can_approve = can_manage || event.owner_id == Some(me.id);
    let participants = sqlx::query_as(
        "select user_id, role from event_participants where event_id = $1 order by added_at")
        .bind(event.id).fetch_all(&st.pool).await?;
    let team_ids = sqlx::query_scalar(
        "select et.team_id from event_teams et join teams t on t.id = et.team_id
          where et.event_id = $1 order by t.name")
        .bind(event.id).fetch_all(&st.pool).await?;
    let checkpoints = sqlx::query_as(
        "select c.id, c.label, coalesce(c.due_date, e.date + c.offset_days::int) as date,
                c.done_at is not null as done
           from event_checkpoints c join events e on e.id = c.event_id
          where c.event_id = $1
          order by (c.done_at is null), c.done_at,
                   coalesce(c.due_date, e.date + c.offset_days::int) nulls last, c.position")
        .bind(event.id).fetch_all(&st.pool).await?;
    // Tamamlananlar uste (tamamlanma sirasiyla); geri alinan tarih yerine doner.
    let requests = sqlx::query_as(
        "select r.id, r.checkpoint_id, r.user_id, r.action, r.created_at
           from event_checkpoint_requests r join event_checkpoints c on c.id = r.checkpoint_id
          where c.event_id = $1 and ($2 or r.user_id = $3) order by r.created_at")
        .bind(event.id).bind(can_approve).bind(me.id).fetch_all(&st.pool).await?;
    let widgets = sqlx::query_as(
        "select id, widget_type as kind, record_id from event_widgets where event_id = $1 order by position")
        .bind(event.id).fetch_all(&st.pool).await?;
    let mut materials: Vec<Material> = sqlx::query_as(concat!(
        "select ", material_cols!(), " from materials m
           join event_materials em on em.material_id = m.id
          where em.event_id = $1 order by m.created_at, m.id"))
        .bind(event.id).fetch_all(&st.pool).await?;
    attach_providers(&st.pool, &mut materials).await?;
    fill_levels(&st.pool, &mut materials).await?;
    Ok(Detail { event, participants, team_ids, checkpoints, widgets, materials, can_edit, can_manage, can_approve, requests })
}

async fn reply(st: &AppState, me: &User, id: Uuid) -> Result<Json<Detail>> {
    let ev = load(&st.pool, id).await?;
    Ok(Json(detail_of(st, me, ev).await?))
}

pub async fn get(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    require_visible(&st, &me, id).await?;
    reply(&st, &me, id).await
}

/// Ikiz gizliyse ve ben uye degilsem etkinlik de kapali: ikizin sohbeti gibi
/// 403 (spec/75 A4). Ayrinti, OTF ve .docx bunu sorar.
pub(crate) async fn require_visible(st: &AppState, me: &User, id: Uuid) -> Result<()> {
    let ev = load(&st.pool, id).await?;
    let twin = records::load(&st.pool, ev.record_id).await?;
    if records::is_restricted(st, me, &twin).await? {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

/// Etkinlik + ikizi; ikizi duzenleyemeyen ve `manage_events`'i olmayan 403.
pub(crate) async fn editable(st: &AppState, me: &User, id: Uuid) -> Result<(EventRow, Record)> {
    let ev = load(&st.pool, id).await?;
    let twin = records::load(&st.pool, ev.record_id).await?;
    if !common::has_scope(st, me, "manage_events").await? {
        records::require_edit(st, me, &twin).await?;
    }
    Ok((ev, twin))
}

async fn require_scope(st: &AppState, me: &User, scope: &str) -> Result<()> {
    if common::has_scope(st, me, scope).await? { Ok(()) } else { Err(AppError::Forbidden) }
}

// --- tur sablonu -----------------------------------------------------------

// Sablon artik VERI (spec/74 §5): Etkinlik Turleri kokunde her `option`'in
// `steps` slotundaki checkpoint'ler (attrs.offset_days) ve `widgets`
// slotundaki widget'lar. Kopya OLUSTURMA aninda (refdata::template): tur
// sonradan duzenlenirse eski etkinlik degismez.

/// Varsayilan son tarih: etkinlikten bu kadar gun once (refdata::DEADLINE_DAYS).
/// Elle eklenen tarihsiz checkpoint buraya duser; farkli tarih `manage_events` ister.
const DEADLINE_DAYS: i16 = refdata::DEADLINE_DAYS as i16;

/// Etkinlik turu: Etkinlik Turleri kokunun altindaki aktif bir `option`.
fn check_kind(st: &AppState, id: Uuid) -> Result<()> {
    let tree = common::tree(st);
    match tree.get(id) {
        Some(n) if n.is_active && n.node_type == NodeType::Choice
            && refdata::under(&tree, id, refdata::EVENT_TYPES) => Ok(()),
        _ => Err(AppError::BadRequest("invalid_kind")),
    }
}

/// Etkinlik yeri: Etkinlik Yerleri kokunun altindaki aktif bir `location`.
fn check_location(st: &AppState, id: Option<Uuid>) -> Result<()> {
    let Some(id) = id else { return Ok(()) };
    let tree = common::tree(st);
    match tree.get(id) {
        Some(n) if n.is_active && n.node_type == NodeType::Location
            && refdata::under(&tree, id, refdata::EVENT_LOCATIONS) => Ok(()),
        _ => Err(AppError::BadRequest("invalid_location")),
    }
}

// --- yeni etkinlik ---------------------------------------------------------

#[derive(Deserialize)]
pub struct NewEvent {
    title: String,
    /// Etkinlik Turleri'ndeki `option` dugumu.
    kind_id: Uuid,
    /// Ikiz kaydin birimi.
    unit_id: Uuid,
    #[serde(default)]
    date: Option<NaiveDate>,
    #[serde(default)]
    priority: Option<Priority>,
    /// Zorunlu, >= 30 (spec/76).
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    quality_override: bool,
}

#[derive(Serialize)]
pub struct Created {
    id: Uuid,
    record_id: Uuid,
}

/// Etkinlik ve ikiz kaydi TEK islemde. Uc `record_id` ALMAZ: var olan kayit
/// ikiz yapilamaz (spec/73 §3a). Acmak, kayit acmak gibi herkese acik.
pub async fn create(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewEvent>,
) -> Result<Json<Created>> {
    let title = common::text(Some(b.title), TITLE_MAX, "invalid_title")?
        .ok_or(AppError::BadRequest("invalid_title"))?;
    let description = common::text(b.description, TEXT_MAX, "invalid_description")?;
    let bypass_quality = common::has_scope(&st, &me, "bypass_text_quality").await?;
    if bypass_quality && description.is_none() {
        return Err(AppError::BadRequest("description_required"));
    }
    if !bypass_quality {
        records::check_title(&title)?;
        records::check_description(description.as_deref())?;
    }
    records::check_unit(&st, b.unit_id)?;
    check_kind(&st, b.kind_id)?;
    let reasons = if bypass_quality { None } else {
        decision::gate(&st, decision::Kind::Entry,
            &decision::entry_state(&title, description.as_deref()), b.quality_override).await?
    };
    // Sablon kilit altinda okunur, kilit await'ten once birakilir (state.rs).
    let (checkpoints, widgets) = refdata::template(&common::tree(&st), b.kind_id);
    let priority = b.priority.unwrap_or(Priority::Medium);
    let status = if b.date.is_some() { EventStatus::Planning } else { EventStatus::Idea };

    let mut tx = st.pool.begin().await?;
    let chat_id: Uuid = sqlx::query_scalar("insert into chats default values returning id")
        .fetch_one(&mut *tx).await?;
    let record_id: Uuid = sqlx::query_scalar(
        "insert into records (unit_id, chat_id, kind, title, priority, owner_id, created_by)
         values ($1, $2, $3, $4, $5, $6, $6) returning id")
        .bind(b.unit_id).bind(chat_id).bind(RecordKind::Task).bind(&title).bind(priority).bind(me.id)
        .fetch_one(&mut *tx).await?;
    records::log(&mut tx, chat_id, me.id, "created", &title, None,
        records::change(serde_json::Value::Null, me.id)).await?;
    records::log_override(&mut tx, chat_id, me.id, &title, "record", reasons).await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into events (record_id, title, kind_id, status, priority, owner_id, date, created_by, description)
         values ($1, $2, $3, $4, $5, $6, $7, $6, $8) returning id")
        .bind(record_id).bind(&title).bind(b.kind_id).bind(status).bind(priority).bind(me.id).bind(b.date)
        .bind(&description).fetch_one(&mut *tx).await?;
    sqlx::query("insert into event_participants (event_id, user_id) values ($1, $2)")
        .bind(id).bind(me.id).execute(&mut *tx).await?;
    for (i, w) in widgets.iter().enumerate() {
        sqlx::query("insert into event_widgets (event_id, widget_type, position) values ($1, $2, $3)
                     on conflict do nothing")
            .bind(id).bind(*w).bind(i as i16).execute(&mut *tx).await?;
    }
    for (i, (label, offset)) in checkpoints.iter().enumerate() {
        sqlx::query(
            "insert into event_checkpoints (event_id, label, offset_days, position) values ($1, $2, $3, $4)")
            .bind(id).bind(label).bind(*offset).bind(i as i16).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(Created { id, record_id }))
}

// --- alan degisimi ---------------------------------------------------------

/// Tek alan, tek istek (kayitlarla ayni bicim).
#[derive(Deserialize)]
#[serde(tag = "field", content = "value", rename_all = "snake_case")]
pub enum EventPatch {
    Title(String),
    Status(EventStatus),
    Priority(Priority),
    OwnerId(Option<Uuid>),
    Date(Option<NaiveDate>),
    /// "HH:MM"
    StartTime(Option<String>),
    /// Listeden yer; secilince metin yer temizlenir.
    LocationId(Option<Uuid>),
    /// Serbest metin yer (Diger…); yazilinca liste yeri temizlenir.
    Place(Option<String>),
    Attendees(Option<i32>),
    Description(Option<String>),
}

/// `quality_override`: baslik/aciklamada model zayif bulsa da yaz (spec/76).
#[derive(Deserialize)]
pub struct EventPatchBody {
    #[serde(flatten)]
    patch: EventPatch,
    #[serde(default)]
    quality_override: bool,
}

fn json(v: impl Serialize) -> serde_json::Value {
    serde_json::to_value(v).unwrap_or_default()
}

/// Ikizin sohbetine (arsiv) yapilandirilmis olgu: `event_changed`, alan, eski/yeni.
async fn log_change(
    tx: &mut sqlx::Transaction<'_, Postgres>, twin: &Record, me: &User,
    field: &str, from: serde_json::Value, to: serde_json::Value,
) -> Result<()> {
    if from != to {
        records::log(tx, twin.chat_id, me.id, "event_changed", &twin.title, Some(field),
            records::change(&from, &to)).await?;
    }
    Ok(())
}

pub async fn patch(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(EventPatchBody { patch: p, quality_override }): Body<EventPatchBody>,
) -> Result<Json<Detail>> {
    let (ev, twin) = editable(&st, &me, common::id(&raw)?).await?;
    let bypass_quality = common::has_scope(&st, &me, "bypass_text_quality").await?;
    let fixed = matches!(ev.status, EventStatus::Confirmed | EventStatus::Done);
    // Bilgi yogunlugu (spec/76): yalniz DEGISEN baslik/aciklama; model islemden once.
    let trimmed = |s: &str| Some(s.trim().to_string()).filter(|s| !s.is_empty());
    let entry = match &p {
        EventPatch::Title(v) if v.trim() != ev.title && !bypass_quality => {
            records::check_title(v.trim())?;
            Some(("title", decision::entry_state(v.trim(), ev.description.as_deref())))
        }
        EventPatch::Description(v) if v.as_deref().and_then(trimmed) != ev.description && !bypass_quality => {
            let d = v.as_deref().and_then(trimmed);
            records::check_description(d.as_deref())?;
            Some(("description", decision::entry_state(&ev.title, d.as_deref())))
        }
        _ => None,
    };
    let overridden = match entry {
        Some((field, state)) => decision::gate(&st, decision::Kind::Entry, &state, quality_override)
            .await?.map(|r| (field, r)),
        None => None,
    };
    let mut tx = st.pool.begin().await?;
    if let Some((field, reasons)) = overridden {
        records::log_override(&mut tx, twin.chat_id, me.id, &twin.title, field, Some(reasons)).await?;
    }
    let set = |sql: &'static str| sqlx::query(sql).bind(ev.id);
    match p {
        EventPatch::Title(v) => {
            let v = common::text(Some(v), TITLE_MAX, "invalid_title")?
                .ok_or(AppError::BadRequest("invalid_title"))?;
            // Tek ad, iki yuz: ikizin basligi AYNI islemde (spec/73 §3a).
            set("update events set title = $2, updated_at = now() where id = $1")
                .bind(&v).execute(&mut *tx).await?;
            sqlx::query("update records set title = $2 where id = $1")
                .bind(twin.id).bind(&v).execute(&mut *tx).await?;
            if v != ev.title {
                records::log(&mut tx, twin.chat_id, me.id, "field_changed", &ev.title, Some("title"),
                    records::change(&ev.title, &v)).await?;
            }
        }
        EventPatch::Status(v) => {
            if matches!(v, EventStatus::Confirmed | EventStatus::Done) && ev.date.is_none() {
                return Err(AppError::Conflict("event_needs_date"));
            }
            set("update events set status = $2, updated_at = now() where id = $1")
                .bind(v).execute(&mut *tx).await?;
            log_change(&mut tx, &twin, &me, "status", json(ev.status), json(v)).await?;
        }
        EventPatch::Priority(v) => {
            set("update events set priority = $2, updated_at = now() where id = $1")
                .bind(v).execute(&mut *tx).await?;
            // Onem ve sorumlu iki yuzde ayni: ozet satiri ve "top kimde" ikizden okunur.
            sqlx::query("update records set priority = $2 where id = $1")
                .bind(twin.id).bind(v).execute(&mut *tx).await?;
            log_change(&mut tx, &twin, &me, "priority", json(ev.priority), json(v)).await?;
        }
        EventPatch::OwnerId(v) => {
            records::check_user(&st.pool, v).await?;
            // Sorumlu onaylayicidir: her duzenleyen kendini atayamaz (spec/75 A2).
            if !(records::may_set_owner(&st, &me, &twin, v).await?
                || common::has_scope(&st, &me, "manage_events").await?)
            {
                return Err(AppError::Denied("owner_change_denied"));
            }
            set("update events set owner_id = $2, updated_at = now() where id = $1")
                .bind(v).execute(&mut *tx).await?;
            sqlx::query("update records set owner_id = $2 where id = $1")
                .bind(twin.id).bind(v).execute(&mut *tx).await?;
            log_change(&mut tx, &twin, &me, "owner_id", json(ev.owner_id), json(v)).await?;
        }
        EventPatch::Date(v) => {
            if v.is_none() && fixed {
                return Err(AppError::Conflict("event_needs_date"));
            }
            // Tamamlanmis goreli checkpoint ESKI tarihine sabitlenir; yalniz
            // bekleyenler etkinlikle kayar (spec/73 §4).
            if let Some(old) = ev.date {
                sqlx::query(
                    "update event_checkpoints set due_date = $2 + offset_days::int, offset_days = null
                      where event_id = $1 and done_at is not null and offset_days is not null")
                    .bind(ev.id).bind(old).execute(&mut *tx).await?;
            }
            // Tarihsiz etkinligin saati olmaz (sema check'i).
            set("update events set date = $2,
                    start_time = case when $2::date is null then null else start_time end,
                    updated_at = now() where id = $1")
                .bind(v).execute(&mut *tx).await?;
            log_change(&mut tx, &twin, &me, "date", json(ev.date), json(v)).await?;
        }
        EventPatch::StartTime(v) => {
            let t = v.as_deref().map(|s| NaiveTime::parse_from_str(s, "%H:%M"))
                .transpose().map_err(|_| AppError::BadRequest("invalid_time"))?;
            if t.is_some() && ev.date.is_none() {
                return Err(AppError::Conflict("event_needs_date"));
            }
            set("update events set start_time = $2, updated_at = now() where id = $1")
                .bind(t).execute(&mut *tx).await?;
            log_change(&mut tx, &twin, &me, "start_time", json(&ev.start_time),
                json(t.map(|t| t.format("%H:%M").to_string()))).await?;
        }
        // Yer tek: liste yeri YA DA metin; biri yazilinca obur temizlenir.
        // Gecmise ad yazilir (dugum adi sonradan degisse de satir okunur kalsin).
        EventPatch::LocationId(v) => {
            check_location(&st, v)?;
            let (from, to) = {
                let tree = common::tree(&st);
                let name = |id: Option<Uuid>| id.map(|i| tree.name(i).to_string());
                (name(ev.location_id).or(ev.place.clone()), name(v))
            };
            set("update events set location_id = $2,
                    place = case when $2::uuid is null then place end, updated_at = now() where id = $1")
                .bind(v).execute(&mut *tx).await?;
            log_change(&mut tx, &twin, &me, "place", json(from), json(to)).await?;
        }
        EventPatch::Place(v) => {
            let v = common::text(v, TITLE_MAX, "invalid_place")?;
            let from = ev.location_id.map(|i| common::tree(&st).name(i).to_string()).or(ev.place.clone());
            set("update events set place = $2,
                    location_id = case when $2::text is null then location_id end, updated_at = now() where id = $1")
                .bind(&v).execute(&mut *tx).await?;
            log_change(&mut tx, &twin, &me, "place", json(from), json(&v)).await?;
        }
        EventPatch::Attendees(v) => {
            if v.is_some_and(|n| !(0..=100_000).contains(&n)) {
                return Err(AppError::BadRequest("invalid_attendees"));
            }
            set("update events set attendees = $2, updated_at = now() where id = $1")
                .bind(v).execute(&mut *tx).await?;
            log_change(&mut tx, &twin, &me, "attendees", json(ev.attendees), json(v)).await?;
        }
        EventPatch::Description(v) => {
            let v = common::text(v, TEXT_MAX, "invalid_description")?;
            if bypass_quality && v.is_none() {
                return Err(AppError::BadRequest("description_required"));
            }
            set("update events set description = $2, updated_at = now() where id = $1")
                .bind(&v).execute(&mut *tx).await?;
            log_change(&mut tx, &twin, &me, "description", json(&ev.description), json(&v)).await?;
        }
    }
    records::touch(&mut tx, twin.id).await?;
    tx.commit().await?;
    reply(&st, &me, ev.id).await
}

// --- kisiler ve takimlar -----------------------------------------------------

#[derive(Deserialize, Default)]
pub struct ParticipantBody {
    #[serde(default)]
    role: Option<String>,
}

/// Kisi ekle ya da rolunu degistir (IDEMPOTENT). Ikizin katilimcisi da olur:
/// sohbet bildirimleri ve duzenleme yetkisi oradan gelir.
pub async fn put_participant(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, user)): Path<(String, String)>, Body(b): Body<ParticipantBody>,
) -> Result<Json<Detail>> {
    let (ev, twin) = editable(&st, &me, common::id(&raw)?).await?;
    let uid = common::id(&user)?;
    records::check_user(&st.pool, Some(uid)).await?;
    let role = common::text(b.role, ROLE_MAX, "invalid_role")?;
    let mut tx = st.pool.begin().await?;
    sqlx::query(
        "insert into event_participants (event_id, user_id, role) values ($1, $2, $3)
         on conflict (event_id, user_id) do update set role = excluded.role")
        .bind(ev.id).bind(uid).bind(role).execute(&mut *tx).await?;
    sqlx::query(
        "insert into record_participants (record_id, user_id, added_by) values ($1, $2, $3)
         on conflict do nothing")
        .bind(twin.id).bind(uid).bind(me.id).execute(&mut *tx).await?;
    records::touch(&mut tx, twin.id).await?;
    tx.commit().await?;
    reply(&st, &me, ev.id).await
}

pub async fn remove_participant(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, user)): Path<(String, String)>,
) -> Result<Json<Detail>> {
    let (ev, twin) = editable(&st, &me, common::id(&raw)?).await?;
    let uid = common::id(&user)?;
    let mut tx = st.pool.begin().await?;
    sqlx::query("delete from event_participants where event_id = $1 and user_id = $2")
        .bind(ev.id).bind(uid).execute(&mut *tx).await?;
    sqlx::query("delete from record_participants where record_id = $1 and user_id = $2")
        .bind(twin.id).bind(uid).execute(&mut *tx).await?;
    tx.commit().await?;
    reply(&st, &me, ev.id).await
}

pub async fn put_team(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, team)): Path<(String, String)>,
) -> Result<Json<Detail>> {
    let (ev, _) = editable(&st, &me, common::id(&raw)?).await?;
    let tid = common::id(&team)?;
    records::check_team(&st.pool, Some(tid)).await?;
    sqlx::query("insert into event_teams (event_id, team_id) values ($1, $2) on conflict do nothing")
        .bind(ev.id).bind(tid).execute(&st.pool).await?;
    reply(&st, &me, ev.id).await
}

pub async fn remove_team(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, team)): Path<(String, String)>,
) -> Result<Json<Detail>> {
    let (ev, _) = editable(&st, &me, common::id(&raw)?).await?;
    sqlx::query("delete from event_teams where event_id = $1 and team_id = $2")
        .bind(ev.id).bind(common::id(&team)?).execute(&st.pool).await?;
    reply(&st, &me, ev.id).await
}

// --- checkpoint'ler ----------------------------------------------------------

#[derive(Deserialize)]
pub struct NewCheckpoint {
    label: String,
    #[serde(default)]
    date: Option<NaiveDate>,
}

pub async fn add_checkpoint(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewCheckpoint>,
) -> Result<Json<Detail>> {
    let ev = load(&st.pool, common::id(&raw)?).await?;
    require_scope(&st, &me, "manage_events").await?;
    let label = common::text(Some(b.label), LABEL_MAX, "invalid_label")?
        .ok_or(AppError::BadRequest("invalid_label"))?;
    // Tarih verilmezse varsayilan son tarih: etkinlikten DEADLINE_DAYS once (goreli).
    sqlx::query(
        "insert into event_checkpoints (event_id, label, due_date, offset_days, position)
         values ($1, $2, $3, case when $3::date is null then $4 end,
                 (select coalesce(max(position) + 1, 0) from event_checkpoints where event_id = $1))")
        .bind(ev.id).bind(label).bind(b.date).bind(-DEADLINE_DAYS).execute(&st.pool).await?;
    reply(&st, &me, ev.id).await
}

async fn event_of(pool: &PgPool, sql: &'static str, id: Uuid) -> Result<Uuid> {
    sqlx::query_scalar(sql).bind(id).fetch_optional(pool).await?.ok_or(AppError::NotFound)
}

#[derive(Deserialize)]
pub struct CheckpointPatch {
    #[serde(default)]
    done: Option<bool>,
    /// Gelirse (`manage_events`): mutlak son tarih; `null` varsayilana doner
    /// (etkinlikten DEADLINE_DAYS once, goreli).
    #[serde(default, deserialize_with = "common::present")]
    date: Option<Option<NaiveDate>>,
}

/// Onaylayici: etkinlik sorumlusu ya da `manage_events` (spec/73 §6).
async fn is_approver(st: &AppState, me: &User, ev: &EventRow) -> Result<bool> {
    Ok(ev.owner_id == Some(me.id) || common::has_scope(st, me, "manage_events").await?)
}

async fn require_approver(st: &AppState, me: &User, ev: &EventRow) -> Result<()> {
    if is_approver(st, me, ev).await? { Ok(()) } else { Err(AppError::Forbidden) }
}

/// Elle isaretlenir; tarih gecti diye kendiliginden dolmaz. Isaretlemek
/// onaylayiciya (digerleri `request_checkpoint` ile ister), tarihi
/// degistirmek `manage_events`'e.
pub async fn patch_checkpoint(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<CheckpointPatch>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let event = event_of(&st.pool, "select event_id from event_checkpoints where id = $1", id).await?;
    let (ev, _) = editable(&st, &me, event).await?;
    let mut tx = st.pool.begin().await?;
    if let Some(done) = b.done {
        require_approver(&st, &me, &ev).await?;
        sqlx::query(
            "update event_checkpoints set done_at = case when $2 then coalesce(done_at, now()) end where id = $1")
            .bind(id).bind(done).execute(&mut *tx).await?;
        // Dogrudan yapilan eylemin bekleyen istegi artik anlamsiz.
        sqlx::query("delete from event_checkpoint_requests where checkpoint_id = $1 and action = $2")
            .bind(id).bind(if done { "done" } else { "undone" }).execute(&mut *tx).await?;
    }
    if let Some(date) = b.date {
        require_scope(&st, &me, "manage_events").await?;
        sqlx::query(
            "update event_checkpoints set due_date = $2, offset_days = case when $2::date is null then $3 end
              where id = $1")
            .bind(id).bind(date).bind(-DEADLINE_DAYS).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    reply(&st, &me, event).await
}

pub async fn delete_checkpoint(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let event = event_of(&st.pool, "select event_id from event_checkpoints where id = $1", id).await?;
    let ev = load(&st.pool, event).await?;
    require_approver(&st, &me, &ev).await?;
    sqlx::query("delete from event_checkpoints where id = $1").bind(id).execute(&st.pool).await?;
    reply(&st, &me, event).await
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum RequestAction {
    Done,
    Undone,
    Delete,
}

impl RequestAction {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Done => "done",
            Self::Undone => "undone",
            Self::Delete => "delete",
        }
    }
}

#[derive(Deserialize)]
pub struct NewRequest {
    action: RequestAction,
}

/// Onaylayici olmayan duzenleyen adimi dogrudan degistiremez: ister. Ayni
/// istek ikinci kez yazilmaz ve ikizin sohbetine ikinci satir dusmez.
pub async fn request_checkpoint(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewRequest>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let event = event_of(&st.pool, "select event_id from event_checkpoints where id = $1", id).await?;
    let (ev, twin) = editable(&st, &me, event).await?;
    let (label, done): (String, bool) = sqlx::query_as(
        "select label, done_at is not null from event_checkpoints where id = $1")
        .bind(id).fetch_one(&st.pool).await?;
    // Zaten istenen duruma gelmis adim icin istek anlamsiz.
    if (matches!(b.action, RequestAction::Done) && done) || (matches!(b.action, RequestAction::Undone) && !done) {
        return Err(AppError::Conflict("checkpoint_state"));
    }
    let mut tx = st.pool.begin().await?;
    let added = sqlx::query(
        "insert into event_checkpoint_requests (checkpoint_id, user_id, action) values ($1, $2, $3)
         on conflict do nothing")
        .bind(id).bind(me.id).bind(b.action.as_str()).execute(&mut *tx).await?.rows_affected();
    if added > 0 {
        records::log(&mut tx, twin.chat_id, me.id, "checkpoint_requested", &label, Some(b.action.as_str()), None).await?;
        records::touch(&mut tx, twin.id).await?;
    }
    tx.commit().await?;
    reply(&st, &me, ev.id).await
}

#[derive(Deserialize)]
pub struct Resolve {
    approve: bool,
}

/// Onaylayici istegi yanitlar: onay eylemi yapar, ret yapmaz; ikisinde de istek
/// silinir ve ikizin sohbetine `checkpoint_approved` / `checkpoint_denied` yazilir.
pub async fn resolve_request(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<Resolve>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let (cid, action, event, label): (Uuid, String, Uuid, String) = sqlx::query_as(
        "select r.checkpoint_id, r.action, c.event_id, c.label
           from event_checkpoint_requests r join event_checkpoints c on c.id = r.checkpoint_id
          where r.id = $1")
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;
    let ev = load(&st.pool, event).await?;
    require_approver(&st, &me, &ev).await?;
    let twin = records::load(&st.pool, ev.record_id).await?;
    let mut tx = st.pool.begin().await?;
    if b.approve {
        match action.as_str() {
            "done" => sqlx::query(
                "update event_checkpoints set done_at = coalesce(done_at, now()) where id = $1")
                .bind(cid).execute(&mut *tx).await?,
            "undone" => sqlx::query("update event_checkpoints set done_at = null where id = $1")
                .bind(cid).execute(&mut *tx).await?,
            // Adimla birlikte tum istekleri de (cascade) gider.
            _ => sqlx::query("delete from event_checkpoints where id = $1").bind(cid).execute(&mut *tx).await?,
        };
    }
    // Onayda ayni adim icin ayni eylemi isteyen digerleri de karsilanmis olur.
    sqlx::query(
        "delete from event_checkpoint_requests where id = $1 or ($2 and checkpoint_id = $3 and action = $4)")
        .bind(id).bind(b.approve).bind(cid).bind(&action).execute(&mut *tx).await?;
    records::log(&mut tx, twin.chat_id, me.id,
        if b.approve { "checkpoint_approved" } else { "checkpoint_denied" }, &label, Some(&action), None).await?;
    records::touch(&mut tx, twin.id).await?;
    tx.commit().await?;
    reply(&st, &me, event).await
}

// --- widget'lar ----------------------------------------------------------------

#[derive(Deserialize)]
pub struct NewWidget {
    #[serde(rename = "type")]
    kind: WidgetType,
    #[serde(default)]
    record_id: Option<Uuid>,
}

/// Kayit widget'i: etkinligi duzenleyebilen herkes, kayit secilmis olarak
/// (bos kayit widget'i sunucuya yazilmaz). Sablon widget'i: `manage_event_widgets`.
/// Ikisi de IDEMPOTENT: ayni kayit / ayni tur ikinci kez eklenmez.
pub async fn add_widget(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewWidget>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    match (b.kind, b.record_id) {
        (WidgetType::Record, Some(rid)) => {
            let (ev, _) = editable(&st, &me, id).await?;
            if rid == ev.record_id {
                return Err(AppError::Conflict("own_record"));
            }
            if records::load(&st.pool, rid).await.is_err() {
                return Err(AppError::BadRequest("unknown_record"));
            }
        }
        (WidgetType::Record, None) => return Err(AppError::BadRequest("invalid_record")),
        (_, Some(_)) => return Err(AppError::BadRequest("invalid_body")),
        (_, None) => {
            load(&st.pool, id).await?;
            require_scope(&st, &me, "manage_event_widgets").await?;
        }
    }
    sqlx::query(
        "insert into event_widgets (event_id, widget_type, record_id, position)
         values ($1, $2, $3, (select coalesce(max(position) + 1, 0) from event_widgets where event_id = $1))
         on conflict do nothing")
        .bind(id).bind(b.kind).bind(b.record_id).execute(&st.pool).await?;
    reply(&st, &me, id).await
}

/// Yuvayi kaldirir; veri (malzemeler, kayit) KALIR — widget geri eklenince
/// ayni liste gorunur.
pub async fn delete_widget(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let (event, kind): (Uuid, WidgetType) = sqlx::query_as(
        "select event_id, widget_type from event_widgets where id = $1")
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;
    if kind == WidgetType::Record {
        editable(&st, &me, event).await?;
    } else {
        require_scope(&st, &me, "manage_event_widgets").await?;
    }
    sqlx::query("delete from event_widgets where id = $1").bind(id).execute(&st.pool).await?;
    reply(&st, &me, event).await
}

// --- satin alimlar (spec/73 §5) ----------------------------------------------

#[derive(Deserialize)]
pub struct NewMaterial {
    name: String,
}

pub async fn add_material(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewMaterial>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    load(&st.pool, id).await?;
    require_scope(&st, &me, "manage_purchases").await?;
    let name = common::text(Some(b.name), TITLE_MAX, "invalid_name")?
        .ok_or(AppError::BadRequest("invalid_name"))?;
    // Kalem bagimsiz dogar, etkinlige `event_materials` ile baglanir.
    let mut tx = st.pool.begin().await?;
    let material: Uuid = sqlx::query_scalar("insert into materials (name, created_by) values ($1, $2) returning id")
        .bind(name).bind(me.id).fetch_one(&mut *tx).await?;
    sqlx::query("insert into event_materials (material_id, event_id) values ($1, $2)")
        .bind(material).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    reply(&st, &me, id).await
}

/// Teklifleri kalemlere ekler (etkinlik ayrintisi ve maliye ortak).
async fn attach_providers<'e>(ex: impl sqlx::PgExecutor<'e>, materials: &mut [Material]) -> Result<()> {
    let ids: Vec<Uuid> = materials.iter().map(|m| m.id).collect();
    let providers: Vec<Provider> = sqlx::query_as(
        "select id, material_id, contact, name, price::float8 as price, arrival_date
           from material_providers where material_id = any($1) order by price nulls last, id")
        .bind(&ids).fetch_all(ex).await?;
    for p in providers {
        if let Some(m) = materials.iter_mut().find(|m| m.id == p.material_id) {
            m.providers.push(p);
        }
    }
    Ok(())
}

/// Kademe: 0 = butce icinde ($), 1 = hafif asim ($$), 2 = belirgin asim ($$$). Esik `yellow_max_ln`.
fn overage_level(ln: Option<f64>, yellow_max_ln: f64) -> Option<u8> {
    ln.map(|x| if x <= 0.0 { 0 } else if x <= yellow_max_ln { 1 } else { 2 })
}

/// Kalemin zamanindaki taban: `effective_from <= zaman` olan en son satir; hepsi sonradan ise ilki.
fn base_at(bases: &[(DateTime<Utc>, f64)], at: DateTime<Utc>) -> Option<f64> {
    bases.iter().rev().find(|(from, _)| *from <= at).or(bases.first()).map(|(_, y)| *y)
}

/// Kademeleri (tarihli taban ile) doldurur. Kademe sutun degil; her okumada turetilir.
async fn fill_levels(pool: &PgPool, materials: &mut [Material]) -> Result<()> {
    let bases: Vec<(DateTime<Utc>, f64)> = sqlx::query_as(
        "select effective_from, yellow_max_ln from overage_base order by effective_from")
        .fetch_all(pool).await?;
    for m in materials.iter_mut() {
        let Some(y) = base_at(&bases, m.updated_at) else { continue };
        m.overage_level = overage_level(m.overage_ln, y);
        for p in m.providers.iter_mut() {
            p.overage_level = overage_level(overage_ln(p.price, m.budget), y);
        }
    }
    Ok(())
}

/// Kart fiyati (`eventModel.priceOf` ile ayni kural): sponsor secildiyse yok, secili teklif,
/// yoksa en dusuk teklif. Sponsor fiyati 0 sayilir ama asim hesabina girmez.
fn card_price(m: &Material) -> Option<f64> {
    if m.sponsor_chosen { return None; }
    match m.chosen_provider_id {
        Some(id) => m.providers.iter().find(|p| p.id == id).and_then(|p| p.price),
        None => m.providers.iter().filter_map(|p| p.price).reduce(f64::min),
    }
}

/// ln(fiyat / butce). Fiyat ya da butce yoksa, ya da fiyat 0 ise bos.
fn overage_ln(price: Option<f64>, budget: Option<f64>) -> Option<f64> {
    match (price, budget) {
        (Some(p), Some(b)) if p > 0.0 && b > 0.0 => Some((p / b).ln()),
        _ => None,
    }
}

/// Teklif ya da butce degisince asimi yeniden turetir: tek kural yeri `apply`'dir (bos yama).
async fn refresh_overage(conn: &mut sqlx::PgConnection, material: Uuid) -> Result<()> {
    let mut rows: Vec<Material> = sqlx::query_as(concat!("select ", material_cols!(), " from materials m where m.id = $1"))
        .bind(material).fetch_all(&mut *conn).await?;
    attach_providers(&mut *conn, &mut rows).await?;
    let m = apply(rows.pop().ok_or(AppError::NotFound)?, MaterialPatch::default())?;
    sqlx::query("update materials set overage_ln = $2 where id = $1")
        .bind(material).bind(m.overage_ln).execute(&mut *conn).await?;
    Ok(())
}

/// Maliye incelemesinden gecmis kalemin tedarigi donar: ad, adet, adimlar, sponsor,
/// secim ve tekliflere yazilmaz. Not, oncelik ve teslim isareti serbest.
async fn require_unpurchased(pool: &PgPool, material: Uuid) -> Result<()> {
    let purchased: bool = sqlx::query_scalar("select purchased from materials where id = $1")
        .bind(material).fetch_one(pool).await?;
    if purchased { Err(AppError::Conflict("purchased_locked")) } else { Ok(()) }
}

/// Kismi: gelen alan degisir. `notes: null` notu siler, `notes` yoksa dokunmaz.
#[derive(Deserialize, Default)]
pub struct MaterialPatch {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, deserialize_with = "common::present")]
    notes: Option<Option<String>>,
    #[serde(default, rename = "type")]
    kind: Option<MaterialType>,
    #[serde(default)]
    priority: Option<Priority>,
    /// Tamamlanan adim sayisi (0..=3). 3'ten dusen kalemin teslim isareti kalkar.
    #[serde(default)]
    state: Option<i16>,
    #[serde(default)]
    qty: Option<i32>,
    /// Sponsordan iste / vazgec. Kapaninca sponsor alanlari ve secimi temizlenir.
    #[serde(default)]
    has_sponsor: Option<bool>,
    #[serde(default, deserialize_with = "common::present")]
    sponsor_qty: Option<Option<i32>>,
    #[serde(default, deserialize_with = "common::present")]
    sponsor_date: Option<Option<NaiveDate>>,
    /// Secim: teklif id'si, `"sponsor"` ya da `null` (secimi kaldir).
    #[serde(default, deserialize_with = "common::present")]
    chosen: Option<Option<String>>,
    /// Elde olan kalem surece girmez; sponsor ve teslim isareti de kalkar.
    #[serde(default)]
    owned: Option<bool>,
    /// Teslim alindi: yalniz onayli (state 3) ve elde olmayan kalem.
    #[serde(default)]
    delivered: Option<bool>,
    /// Kalem butcesi (TL); `null` siler. Tedarik kararinin parcasi: satin alinmis kalemde kilitli.
    #[serde(default, deserialize_with = "common::present")]
    budget: Option<Option<f64>>,
}

const QTY_MAX: i32 = 1_000_000;

/// Kalemin yeni hali: mevcut satir + PATCH -> tutarli satir. Saf (DB'ye gitmez);
/// kurallar burada, `018_purchases_v2.sql` kisitlari ikinci kapi. Asim her zaman burada turetilir.
fn apply(mut m: Material, b: MaterialPatch) -> Result<Material> {
    if m.purchased && (b.name.is_some() || b.kind.is_some() || b.qty.is_some() || b.state.is_some()
        || b.owned.is_some() || b.has_sponsor.is_some() || b.sponsor_qty.is_some()
        || b.sponsor_date.is_some() || b.chosen.is_some() || b.budget.is_some())
    {
        return Err(AppError::Conflict("purchased_locked"));
    }
    if let Some(v) = b.budget {
        if v.is_some_and(|v| !(v > 0.0 && v <= PRICE_MAX)) {
            return Err(AppError::BadRequest("invalid_budget"));
        }
        m.budget = v;
    }
    if let Some(n) = b.name {
        m.name = common::text(Some(n), TITLE_MAX, "invalid_name")?.ok_or(AppError::BadRequest("invalid_name"))?;
    }
    if let Some(n) = b.notes {
        m.notes = common::text(n, TEXT_MAX, "invalid_notes")?;
    }
    if let Some(k) = b.kind { m.kind = k; }
    if let Some(p) = b.priority { m.priority = p; }
    if let Some(q) = b.qty {
        if !(1..=QTY_MAX).contains(&q) { return Err(AppError::BadRequest("invalid_qty")); }
        m.qty = q;
    }
    if let Some(s) = b.state {
        if !(0..=3).contains(&s) { return Err(AppError::BadRequest("invalid_state")); }
        m.state = s;
    }
    if let Some(o) = b.owned { m.owned = o; }
    if m.owned {
        m.has_sponsor = false;
        m.delivered = false;
    }
    match b.has_sponsor {
        Some(true) if m.owned => return Err(AppError::BadRequest("owned_no_sponsor")),
        Some(v) => m.has_sponsor = v,
        None => {}
    }
    if !m.has_sponsor {
        m.sponsor_chosen = false;
        m.sponsor_qty = None;
        m.sponsor_date = None;
        m.in_sponsor_record = false;
    }
    if let Some(q) = b.sponsor_qty {
        if q.is_some_and(|q| !(1..=QTY_MAX).contains(&q)) { return Err(AppError::BadRequest("invalid_qty")); }
        if q.is_some() && !m.has_sponsor { return Err(AppError::BadRequest("no_sponsor")); }
        m.sponsor_qty = q;
    }
    if let Some(d) = b.sponsor_date {
        if d.is_some() && !m.has_sponsor { return Err(AppError::BadRequest("no_sponsor")); }
        m.sponsor_date = d;
    }
    match b.chosen {
        None => {}
        Some(None) => {
            m.chosen_provider_id = None;
            m.sponsor_chosen = false;
        }
        Some(Some(s)) if s == "sponsor" => {
            if !m.has_sponsor { return Err(AppError::BadRequest("no_sponsor")); }
            m.chosen_provider_id = None;
            m.sponsor_chosen = true;
        }
        Some(Some(s)) => {
            m.chosen_provider_id = Some(s.parse().map_err(|_| AppError::BadRequest("invalid_provider"))?);
            m.sponsor_chosen = false;
        }
    }
    if m.state < 3 { m.delivered = false; }
    if let Some(d) = b.delivered {
        if d && (m.state != 3 || m.owned) { return Err(AppError::BadRequest("not_approved")); }
        m.delivered = d;
    }
    m.overage_ln = overage_ln(card_price(&m), m.budget);
    Ok(m)
}

/// Kalemin etkinligi; etkinligi olmayan (sahipsiz) kalem bu uclardan duzenlenmez.
async fn material_event(pool: &PgPool, id: Uuid) -> Result<Uuid> {
    event_of(pool, "select event_id from event_materials where material_id = $1", id).await
}

pub async fn patch_material(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<MaterialPatch>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let event = material_event(&st.pool, id).await?;
    require_scope(&st, &me, "manage_purchases").await?;
    // Butce ayri yetki: tedarik yazmak butce degistirmeye yetmez.
    if b.budget.is_some() { require_scope(&st, &me, "manage_budgets").await?; }
    let mut tx = st.pool.begin().await?;
    let mut cur: Material = sqlx::query_as(concat!("select ", material_cols!(), " from materials m where m.id = $1 for update"))
        .bind(id).fetch_one(&mut *tx).await?;
    // Asim kart fiyatindan turer: teklifler de lazim.
    attach_providers(&mut *tx, std::slice::from_mut(&mut cur)).await?;
    let m = apply(cur, b)?;
    // Secilen teklif bu kalemin: bileske FK de zorlar, ama 500 yerine 400 donelim.
    if let Some(pid) = m.chosen_provider_id {
        let mine: bool = sqlx::query_scalar("select exists(select 1 from material_providers where id = $1 and material_id = $2)")
            .bind(pid).bind(id).fetch_one(&mut *tx).await?;
        if !mine { return Err(AppError::BadRequest("invalid_provider")); }
    }
    sqlx::query(
        "update materials set name = $2, notes = $3, type = $4, priority = $5, state = $6, qty = $7,
                owned = $8, has_sponsor = $9, chosen_provider_id = $10, sponsor_chosen = $11,
                sponsor_qty = $12, sponsor_date = $13, in_sponsor_record = $14, delivered = $15,
                budget = round($16::numeric, 2), overage_ln = $17, updated_at = now()
          where id = $1")
        .bind(id).bind(&m.name).bind(&m.notes).bind(m.kind).bind(m.priority).bind(m.state).bind(m.qty)
        .bind(m.owned).bind(m.has_sponsor).bind(m.chosen_provider_id).bind(m.sponsor_chosen)
        .bind(m.sponsor_qty).bind(m.sponsor_date).bind(m.in_sponsor_record).bind(m.delivered)
        .bind(m.budget).bind(m.overage_ln)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    reply(&st, &me, event).await
}

pub async fn delete_material(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let event = material_event(&st.pool, id).await?;
    require_scope(&st, &me, "manage_purchases").await?;
    require_unpurchased(&st.pool, id).await?;
    sqlx::query("delete from materials where id = $1").bind(id).execute(&st.pool).await?;
    reply(&st, &me, event).await
}

#[derive(Deserialize)]
pub struct NewProvider {
    contact: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    price: Option<f64>,
    #[serde(default)]
    arrival_date: Option<NaiveDate>,
}

pub async fn add_provider(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewProvider>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let event = material_event(&st.pool, id).await?;
    require_scope(&st, &me, "manage_purchases").await?;
    require_unpurchased(&st.pool, id).await?;
    let contact = common::text(Some(b.contact), CONTACT_MAX, "invalid_contact")?
        .ok_or(AppError::BadRequest("invalid_contact"))?;
    if b.price.is_some_and(|p| !p.is_finite() || !(0.0..=PRICE_MAX).contains(&p)) {
        return Err(AppError::BadRequest("invalid_price"));
    }
    let name = common::text(b.name, TITLE_MAX, "invalid_name")?;
    let mut tx = st.pool.begin().await?;
    // Para numeric'te: float yalniz tasima, kayitta kurusa yuvarlanir.
    sqlx::query(
        "insert into material_providers (material_id, contact, name, price, arrival_date)
         values ($1, $2, $3, round($4::numeric, 2), $5)")
        .bind(id).bind(contact).bind(name).bind(b.price).bind(b.arrival_date).execute(&mut *tx).await?;
    sqlx::query("update materials set updated_at = now() where id = $1").bind(id).execute(&mut *tx).await?;
    refresh_overage(&mut tx, id).await?;
    tx.commit().await?;
    reply(&st, &me, event).await
}

pub async fn delete_provider(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let (material, event) = provider_owner(&st.pool, id).await?;
    require_scope(&st, &me, "manage_purchases").await?;
    require_unpurchased(&st.pool, material).await?;
    let mut tx = st.pool.begin().await?;
    sqlx::query("delete from material_providers where id = $1").bind(id).execute(&mut *tx).await?;
    sqlx::query("update materials set updated_at = now() where id = $1").bind(material).execute(&mut *tx).await?;
    refresh_overage(&mut tx, material).await?;
    tx.commit().await?;
    reply(&st, &me, event).await
}

/// Teklifin (kalemi, etkinligi); etkinligi olmayan kalemin teklifi bu uclardan degismez.
async fn provider_owner(pool: &PgPool, id: Uuid) -> Result<(Uuid, Uuid)> {
    sqlx::query_as(
        "select p.material_id, em.event_id from material_providers p
           join event_materials em on em.material_id = p.material_id where p.id = $1")
        .bind(id).fetch_optional(pool).await?.ok_or(AppError::NotFound)
}

/// Kismi: gelen alan degisir; `price`/`arrival_date` icin `null` siler.
#[derive(Deserialize)]
pub struct ProviderPatch {
    #[serde(default)]
    contact: Option<String>,
    #[serde(default, deserialize_with = "common::present")]
    name: Option<Option<String>>,
    #[serde(default, deserialize_with = "common::present")]
    price: Option<Option<f64>>,
    #[serde(default, deserialize_with = "common::present")]
    arrival_date: Option<Option<NaiveDate>>,
}

pub async fn patch_provider(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<ProviderPatch>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let (material, event) = provider_owner(&st.pool, id).await?;
    require_scope(&st, &me, "manage_purchases").await?;
    require_unpurchased(&st.pool, material).await?;
    let contact = match b.contact {
        Some(c) => Some(common::text(Some(c), CONTACT_MAX, "invalid_contact")?
            .ok_or(AppError::BadRequest("invalid_contact"))?),
        None => None,
    };
    if b.price.flatten().is_some_and(|p| !p.is_finite() || !(0.0..=PRICE_MAX).contains(&p)) {
        return Err(AppError::BadRequest("invalid_price"));
    }
    let name = match b.name {
        Some(n) => Some(common::text(n, TITLE_MAX, "invalid_name")?),
        None => None,
    };
    let mut tx = st.pool.begin().await?;
    sqlx::query(
        "update material_providers set
            contact = coalesce($2, contact),
            name = case when $3 then $4::text else name end,
            price = case when $5 then round($6::numeric, 2) else price end,
            arrival_date = case when $7 then $8 else arrival_date end
          where id = $1")
        .bind(id).bind(contact)
        .bind(name.is_some()).bind(name.flatten())
        .bind(b.price.is_some()).bind(b.price.flatten())
        .bind(b.arrival_date.is_some()).bind(b.arrival_date.flatten())
        .execute(&mut *tx).await?;
    sqlx::query("update materials set updated_at = now() where id = $1").bind(material).execute(&mut *tx).await?;
    refresh_overage(&mut tx, material).await?;
    tx.commit().await?;
    reply(&st, &me, event).await
}

#[derive(Deserialize)]
pub struct PurchasedPatch {
    purchased: bool,
}

/// Maliye incelemesi: kalemi "satin alindi" isaretler/kaldirir. Widget'tan YAPILAMAZ
/// (`PATCH /api/materials/{id}` bu alani bilmez); ayri scope ister. Yalniz onayli,
/// elde olmayan kalem satin alinmis sayilir. Etkinlik gerekmez: sahipsiz kalem de incelenir.
pub async fn set_purchased(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<PurchasedPatch>,
) -> Result<Json<Material>> {
    let id = common::id(&raw)?;
    let (state, owned): (i16, bool) = sqlx::query_as("select state, owned from materials where id = $1")
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;
    require_scope(&st, &me, "review_purchases").await?;
    if b.purchased && (state != 3 || owned) { return Err(AppError::Conflict("not_approved")); }
    sqlx::query(
        "update materials set purchased = $2,
                purchased_at = case when $2 then now() end,
                purchased_by = case when $2 then $3::uuid end,
                updated_at = now()
          where id = $1")
        .bind(id).bind(b.purchased).bind(me.id).execute(&st.pool).await?;
    let mut m: Vec<Material> = sqlx::query_as(concat!("select ", material_cols!(), " from materials m where m.id = $1"))
        .bind(id).fetch_all(&st.pool).await?;
    attach_providers(&st.pool, &mut m).await?;
    fill_levels(&st.pool, &mut m).await?;
    Ok(Json(m.pop().ok_or(AppError::NotFound)?))
}

// --- satin alim Excel'i (assets/satin-alimlar.xlsx) -------------------------------

/// Dokumdeki kalemler: onayli (state 3) ve elde olmayan. Teslim edilenler de onaylidir, burada.
fn purchase_rows(materials: &[Material]) -> Vec<&Material> {
    materials.iter().filter(|m| m.state == 3 && !m.owned).collect()
}

/// Kalemin tedarikcisi: secili teklif, yoksa en dusuk fiyatli (kart kuraliyla ayni).
fn supplier_of(m: &Material) -> Option<&Provider> {
    m.chosen_provider_id.and_then(|id| m.providers.iter().find(|p| p.id == id))
        .or_else(|| m.providers.iter().filter_map(|p| p.price.map(|v| (v, p)))
            .min_by(|a, b| a.0.total_cmp(&b.0)).map(|(_, p)| p))
}

/// Excel satiri: sablonun sutunlari (A Malzeme … I Not). Tedarikci ve toplam, "Mail özet"in
/// okudugu alanlar; sponsor secildiyse tedarikci "Sponsor", toplam 0.
fn xlsx_row(m: &Material) -> purchases_xlsx::Row {
    let supplier = if m.sponsor_chosen {
        "Sponsor".to_string()
    } else {
        supplier_of(m).map(|p| p.name.clone().unwrap_or_else(|| p.contact.clone())).unwrap_or_default()
    };
    purchases_xlsx::Row {
        name: m.name.clone(),
        kind: match m.kind {
            MaterialType::Consumable => "Sarf",
            MaterialType::Equipment => "Alet / ekipman",
            MaterialType::Service => "Hizmet",
        }.into(),
        qty: m.qty,
        supplier,
        total: if m.sponsor_chosen { Some(0.0) } else { card_price(m) },
        budget: m.budget,
        arrival: eta_of(m).map(excel_serial),
        notes: m.notes.clone().unwrap_or_default(),
    }
}

/// Excel seri numarasi: 1899-12-30'dan itibaren gun sayisi (1900 sicrama hatasi sonrasi icin dogru).
fn excel_serial(d: NaiveDate) -> i64 {
    NaiveDate::from_ymd_opt(1899, 12, 30).map_or(0, |epoch| (d - epoch).num_days())
}

/// Kart varisi (`eventModel.etaOf` ile ayni kural): sponsor secildiyse sponsor tarihi, secili
/// teklifin tarihi, secim yoksa en erken teklif tarihi.
fn eta_of(m: &Material) -> Option<NaiveDate> {
    if m.sponsor_chosen { return m.sponsor_date; }
    match m.chosen_provider_id.and_then(|id| m.providers.iter().find(|p| p.id == id)) {
        Some(p) => p.arrival_date,
        None => m.providers.iter().filter_map(|p| p.arrival_date).min(),
    }
}

/// `GET /api/events/{id}/purchases.xlsx`: satin alim dokumu. Okuma etkinlik gibi gorunur olmaya bagli.
pub async fn purchases_xlsx(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Response> {
    let id = common::id(&raw)?;
    require_visible(&st, &me, id).await?;
    let ev = load(&st.pool, id).await?;
    let date = ev.date.map(|d| d.format("%d.%m.%Y").to_string()).unwrap_or_else(|| "tarihsiz".into());
    let title = format!("Satın alımlar — {}", ev.title);
    let summary = format!("Etkinlik tarihi: {date} · Yalnız onaylı ve teslim edilen kalemler · dışa aktarım {}",
        Utc::now().format("%d.%m.%Y"));
    let detail = detail_of(&st, &me, ev).await?;
    let rows: Vec<purchases_xlsx::Row> = purchase_rows(&detail.materials).into_iter().map(xlsx_row).collect();
    let bytes = purchases_xlsx::render(&title, &summary, &rows).map_err(|e| {
        tracing::error!("satin alim xlsx: {e}");
        AppError::Conflict("xlsx_template")
    })?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string()),
            (header::CACHE_CONTROL, "no-store".into()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"satin-alimlar-{id}.xlsx\"")),
        ],
        bytes,
    ).into_response())
}

#[cfg(test)]
mod material_tests {
    use super::*;

    fn mat() -> Material {
        Material {
            id: Uuid::nil(), name: "Lehim".into(), notes: None, kind: MaterialType::Consumable,
            priority: Priority::Medium, state: 3, qty: 1, has_sponsor: true, owned: false,
            chosen_provider_id: None, sponsor_chosen: true, sponsor_qty: Some(2),
            sponsor_date: None, in_sponsor_record: true, delivered: false, purchased: false,
            purchased_at: None, created_by: None, updated_at: Utc::now(), budget: None,
            overage_ln: None, overage_level: None, providers: vec![],
        }
    }
    fn offer(price: f64) -> Provider {
        Provider { id: Uuid::new_v4(), material_id: Uuid::nil(), contact: "x".into(), name: None,
            price: Some(price), arrival_date: None, overage_level: None }
    }
    fn patch(json: &str) -> MaterialPatch { serde_json::from_str(json).unwrap() }
    fn code(r: Result<Material>) -> &'static str {
        match r { Err(AppError::BadRequest(c)) | Err(AppError::Conflict(c)) => c, Err(_) => "other", Ok(_) => "ok" }
    }

    #[test]
    fn sponsor_kapaninca_sponsor_alanlari_temizlenir() {
        let m = apply(mat(), patch(r#"{"has_sponsor": false}"#)).unwrap();
        assert!(!m.sponsor_chosen && m.sponsor_qty.is_none() && !m.in_sponsor_record);
    }

    #[test]
    fn sponsor_secimi_sponsor_ister_ve_teklifi_dusurur() {
        let mut m = mat();
        m.has_sponsor = false;
        assert_eq!(code(apply(m, patch(r#"{"chosen": "sponsor"}"#))), "no_sponsor");
        let id = Uuid::new_v4();
        let m = apply(mat(), patch(&format!(r#"{{"chosen": "{id}"}}"#))).unwrap();
        assert_eq!((m.chosen_provider_id, m.sponsor_chosen), (Some(id), false));
        assert_eq!(code(apply(mat(), patch(r#"{"chosen": "x"}"#))), "invalid_provider");
    }

    #[test]
    fn elde_olan_kalem_sponsor_ve_teslim_tasimaz() {
        let m = apply(mat(), patch(r#"{"owned": true}"#)).unwrap();
        assert!(!m.has_sponsor && !m.delivered);
        assert_eq!(code(apply(m, patch(r#"{"has_sponsor": true}"#))), "owned_no_sponsor");
    }

    #[test]
    fn teslim_yalniz_onayli_kalemde_ve_geri_adimda_kalkar() {
        let m = apply(mat(), patch(r#"{"delivered": true}"#)).unwrap();
        assert!(m.delivered);
        let m = apply(m, patch(r#"{"state": 2}"#)).unwrap();
        assert!(!m.delivered);
        assert_eq!(code(apply(m, patch(r#"{"delivered": true}"#))), "not_approved");
        assert_eq!(code(apply(mat(), patch(r#"{"state": 4}"#))), "invalid_state");
    }

    #[test]
    fn satin_alinmis_kalemde_yalniz_not_oncelik_teslim_degisir() {
        let bought = || Material { purchased: true, ..mat() };
        assert_eq!(code(apply(bought(), patch(r#"{"qty": 3}"#))), "purchased_locked");
        assert_eq!(code(apply(bought(), patch(r#"{"state": 1}"#))), "purchased_locked");
        assert!(apply(bought(), patch(r#"{"delivered": true, "priority": "high", "notes": "x"}"#)).is_ok());
        assert_eq!(code(apply(bought(), patch(r#"{"budget": 500}"#))), "purchased_locked");
    }

    #[test]
    fn asim_ln_kart_fiyatindan_ve_butceden_turer() {
        let mut m = mat();
        m.sponsor_chosen = false;
        m.budget = Some(100.0);
        m.providers = vec![offer(150.0), offer(120.0)];
        // Secim yok: en dusuk teklif (120) / butce (100).
        let m = apply(m, MaterialPatch::default()).unwrap();
        assert!((m.overage_ln.unwrap() - (1.2f64).ln()).abs() < 1e-12);
        // Sponsor secilince asim yok (fiyat 0).
        let m = apply(m, patch(r#"{"has_sponsor": true, "chosen": "sponsor"}"#)).unwrap();
        assert_eq!(m.overage_ln, None);
        // Butce kalkinca da yok.
        let mut m = apply(m, patch(r#"{"chosen": null}"#)).unwrap();
        m.sponsor_chosen = false;
        let m = apply(m, patch(r#"{"budget": null}"#)).unwrap();
        assert_eq!((m.budget, m.overage_ln), (None, None));
    }

    #[test]
    fn excel_seri_no_dogru() {
        assert_eq!(NaiveDate::from_ymd_opt(2026, 10, 14).map(excel_serial), Some(46_309));
    }

    #[test]
    fn xlsx_yalniz_onayli_ve_elde_olmayan_kalemler() {
        let v = vec![
            Material { state: 3, ..mat() },
            Material { state: 2, ..mat() },
            Material { state: 3, owned: true, ..mat() },
        ];
        assert_eq!(purchase_rows(&v).len(), 1);
    }

    #[test]
    fn butce_pozitif_olmali() {
        assert_eq!(code(apply(mat(), patch(r#"{"budget": 0}"#))), "invalid_budget");
        assert_eq!(code(apply(mat(), patch(r#"{"budget": -5}"#))), "invalid_budget");
    }

    #[test]
    fn kademe_tabandan_turer() {
        let y = 0.5 * 2f64.ln();
        assert_eq!(overage_level(None, y), None);
        assert_eq!(overage_level(Some(-0.1), y), Some(0)); // butce altinda
        assert_eq!(overage_level(Some(0.0), y), Some(0)); // tam butce: asim yok
        assert_eq!(overage_level(Some(0.3), y), Some(1)); // %35 asim
        assert_eq!(overage_level(Some(0.4), y), Some(2)); // %49 asim
    }

    #[test]
    fn taban_kayit_zamanina_gore_secilir() {
        let t = |d: i64| DateTime::<Utc>::from_timestamp(d, 0).unwrap();
        let bases = vec![(t(100), 0.3), (t(200), 0.5)];
        assert_eq!(base_at(&bases, t(50)), Some(0.3)); // ilk taban oncesi: ilki
        assert_eq!(base_at(&bases, t(150)), Some(0.3));
        assert_eq!(base_at(&bases, t(250)), Some(0.5));
        assert_eq!(base_at(&[], t(0)), None);
    }
}
