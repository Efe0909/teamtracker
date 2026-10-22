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

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres};
use uuid::Uuid;

use crate::{
    db::events as db_events,
    purchases_xlsx,
    domain::{common, records},
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

#[derive(Serialize)]
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
    db_events::find_event(pool, id).await?.map(EventRow::from).ok_or(AppError::NotFound)
}

impl From<db_events::EventRow> for EventRow {
    fn from(r: db_events::EventRow) -> Self {
        Self {
            id: r.id, record_id: r.record_id, title: r.title, kind_id: r.kind_id, status: r.status, priority: r.priority,
            owner_id: r.owner_id, date: r.date, start_time: r.start_time, location_id: r.location_id, place: r.place,
            attendees: r.attendees, description: r.description, created_by: r.created_by, created_at: r.created_at,
            updated_at: r.updated_at, record_ids: r.record_ids,
        }
    }
}

/// Okuma herkese acik; tablo tek sayfada (ekip kucuk, suzme istemcide).
pub(crate) async fn list(st: &AppState, ) -> Result<Vec<EventRow>> {
    Ok(db_events::list_events(&st.pool).await?.into_iter().map(EventRow::from).collect())
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

#[derive(Serialize)]
struct CheckpointRequest {
    id: Uuid,
    checkpoint_id: Uuid,
    user_id: Uuid,
    /// "done" | "undone" | "delete"
    action: String,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct Participant {
    user_id: Uuid,
    role: Option<String>,
}

#[derive(Serialize)]
struct Checkpoint {
    id: Uuid,
    label: String,
    /// Sablondan gelen icin `events.date + offset_days`; etkinlik havuzdaysa null.
    date: Option<NaiveDate>,
    done: bool,
}

#[derive(Serialize)]
struct Widget {
    id: Uuid,
    #[serde(rename = "type")]
    kind: WidgetType,
    record_id: Option<Uuid>,
}

#[derive(Serialize)]
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
    overage_level: Option<u8>,
    providers: Vec<Provider>,
}

impl From<db_events::MaterialRow> for Material {
    fn from(r: db_events::MaterialRow) -> Self {
        Self {
            id: r.id, name: r.name, notes: r.notes, kind: r.kind, priority: r.priority, state: r.state,
            qty: r.qty, has_sponsor: r.has_sponsor, owned: r.owned, chosen_provider_id: r.chosen_provider_id,
            sponsor_chosen: r.sponsor_chosen, sponsor_qty: r.sponsor_qty, sponsor_date: r.sponsor_date,
            in_sponsor_record: r.in_sponsor_record, delivered: r.delivered, purchased: r.purchased,
            purchased_at: r.purchased_at, created_by: r.created_by, updated_at: r.updated_at, budget: r.budget,
            overage_ln: r.overage_ln, overage_level: None, providers: Vec::new(),
        }
    }
}

#[derive(Serialize)]
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
    overage_level: Option<u8>,
}

// LLM yuku (kisisel/kurumsal veriden arindirilmis).
mod context;
pub(crate) use context::{
    known_names, llm_context, llm_restore, material_brief, material_sample, material_suggestions, reject_suggestion,
    try_suggest, Context, MaterialBrief, Params, RestoreIn, RestoreOut, SuggestIn, SuggestOut,
};
use context::decide_suggestion;

async fn detail_of(st: &AppState, me: &User, event: EventRow) -> Result<Detail> {
    let twin = records::load(&st.pool, event.record_id).await?;
    let can_manage = common::has_scope(st, me, "manage_events").await?;
    let can_edit = can_manage || crate::db::scope::can_edit_record(&st.pool, me, &twin, &st.tree).await?;
    let can_approve = can_manage || event.owner_id == Some(me.id);
    let participants = db_events::list_participants(&st.pool, event.id).await?.into_iter()
        .map(|r| Participant { user_id: r.user_id, role: r.role }).collect();
    let team_ids = db_events::list_team_ids(&st.pool, event.id).await?;
    let checkpoints = db_events::list_checkpoints(&st.pool, event.id).await?.into_iter()
        .map(|r| Checkpoint { id: r.id, label: r.label, date: r.date, done: r.done }).collect();
    // Tamamlananlar uste (tamamlanma sirasiyla); geri alinan tarih yerine doner.
    let requests = db_events::list_requests(&st.pool, event.id, can_approve, me.id).await?.into_iter()
        .map(|r| CheckpointRequest { id: r.id, checkpoint_id: r.checkpoint_id, user_id: r.user_id, action: r.action, created_at: r.created_at }).collect();
    let widgets = db_events::list_widgets(&st.pool, event.id).await?.into_iter()
        .map(|r| Widget { id: r.id, kind: r.kind, record_id: r.record_id }).collect();
    let mut materials: Vec<Material> = db_events::list_event_materials(&st.pool, event.id).await?.into_iter().map(Material::from).collect();
    attach_providers(&st.pool, &mut materials).await?;
    fill_levels(&st.pool, &mut materials).await?;
    Ok(Detail { event, participants, team_ids, checkpoints, widgets, materials, can_edit, can_manage, can_approve, requests })
}

async fn reply(st: &AppState, me: &User, id: Uuid) -> Result<Detail> {
    let ev = load(&st.pool, id).await?;
    detail_of(st, me, ev).await
}

pub(crate) async fn get(
    st: &AppState, me: &User, id: Uuid,
) -> Result<Detail> {
    require_visible(st, me, id).await?;
    reply(st, me, id).await
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
pub(crate) async fn create(
    st: &AppState, me: &User, b: NewEvent,
) -> Result<Created> {
    let title = common::text(Some(b.title), TITLE_MAX, "invalid_title")?
        .ok_or(AppError::BadRequest("invalid_title"))?;
    let description = common::text(b.description, TEXT_MAX, "invalid_description")?;
    let bypass_quality = common::has_scope(st, me, "bypass_text_quality").await?;
    if bypass_quality && description.is_none() {
        return Err(AppError::BadRequest("description_required"));
    }
    if !bypass_quality {
        records::check_title(&title)?;
        records::check_description(description.as_deref())?;
    }
    records::check_unit(st, b.unit_id)?;
    check_kind(st, b.kind_id)?;
    let reasons = if bypass_quality { None } else {
        decision::gate(st, me.id, decision::Kind::Entry,
            &decision::entry_state(&title, description.as_deref()), b.quality_override).await?
    };
    // Sablon kilit altinda okunur, kilit await'ten once birakilir (state.rs).
    let (checkpoints, widgets) = refdata::template(&common::tree(st), b.kind_id);
    let priority = b.priority.unwrap_or(Priority::Medium);
    let status = if b.date.is_some() { EventStatus::Planning } else { EventStatus::Idea };

    let mut tx = st.pool.begin().await?;
    let chat_id = db_events::insert_chat(&mut *tx).await?;
    let record_id = db_events::insert_record(&mut *tx, b.unit_id, chat_id, RecordKind::Task, &title, priority, me.id).await?;
    records::log(&mut tx, chat_id, me.id, "created", &title, None,
        records::change(serde_json::Value::Null, me.id)).await?;
    records::log_override(&mut tx, chat_id, me.id, &title, "record", reasons).await?;
    let id = db_events::insert_event(&mut *tx, record_id, &title, b.kind_id, status, priority, me.id, b.date, description.as_deref()).await?;
    db_events::insert_participant(&mut *tx, id, me.id).await?;
    for (i, w) in widgets.iter().enumerate() {
        db_events::insert_template_widget(&mut *tx, id, *w, i as i16).await?;
    }
    for (i, (label, offset)) in checkpoints.iter().enumerate() {
        db_events::insert_template_checkpoint(&mut *tx, id, label, *offset, i as i16).await?;
    }
    tx.commit().await?;
    Ok(Created { id, record_id })
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
    pub(crate) patch: EventPatch,
    #[serde(default)]
    pub(crate) quality_override: bool,
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

pub(crate) async fn patch(
    st: &AppState, me: &User, id: Uuid,
    EventPatchBody { patch: p, quality_override }: EventPatchBody,
) -> Result<Detail> {
    let (ev, twin) = editable(st, me, id).await?;
    let bypass_quality = common::has_scope(st, me, "bypass_text_quality").await?;
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
        Some((field, state)) => decision::gate(st, me.id, decision::Kind::Entry, &state, quality_override)
            .await?.map(|r| (field, r)),
        None => None,
    };
    let mut tx = st.pool.begin().await?;
    if let Some((field, reasons)) = overridden {
        records::log_override(&mut tx, twin.chat_id, me.id, &twin.title, field, Some(reasons)).await?;
    }
    match p {
        EventPatch::Title(v) => {
            let v = common::text(Some(v), TITLE_MAX, "invalid_title")?
                .ok_or(AppError::BadRequest("invalid_title"))?;
            // Tek ad, iki yuz: ikizin basligi AYNI islemde (spec/73 §3a).
            db_events::set_title(&mut *tx, ev.id, &v).await?;
            db_events::set_record_title(&mut *tx, twin.id, &v).await?;
            if v != ev.title {
                records::log(&mut tx, twin.chat_id, me.id, "field_changed", &ev.title, Some("title"),
                    records::change(&ev.title, &v)).await?;
            }
        }
        EventPatch::Status(v) => {
            if matches!(v, EventStatus::Confirmed | EventStatus::Done) && ev.date.is_none() {
                return Err(AppError::Conflict("event_needs_date"));
            }
            db_events::set_status(&mut *tx, ev.id, v).await?;
            log_change(&mut tx, &twin, me, "status", json(ev.status), json(v)).await?;
        }
        EventPatch::Priority(v) => {
            db_events::set_priority(&mut *tx, ev.id, v).await?;
            // Onem ve sorumlu iki yuzde ayni: ozet satiri ve "top kimde" ikizden okunur.
            db_events::set_record_priority(&mut *tx, twin.id, v).await?;
            log_change(&mut tx, &twin, me, "priority", json(ev.priority), json(v)).await?;
        }
        EventPatch::OwnerId(v) => {
            records::check_user(&st.pool, v).await?;
            // Sorumlu onaylayicidir: her duzenleyen kendini atayamaz (spec/75 A2).
            if !(records::may_set_owner(st, me, &twin, v).await?
                || common::has_scope(st, me, "manage_events").await?)
            {
                return Err(AppError::Denied("owner_change_denied"));
            }
            db_events::set_owner(&mut *tx, ev.id, v).await?;
            db_events::set_record_owner(&mut *tx, twin.id, v).await?;
            log_change(&mut tx, &twin, me, "owner_id", json(ev.owner_id), json(v)).await?;
        }
        EventPatch::Date(v) => {
            if v.is_none() && fixed {
                return Err(AppError::Conflict("event_needs_date"));
            }
            // Tamamlanmis goreli checkpoint ESKI tarihine sabitlenir; yalniz
            // bekleyenler etkinlikle kayar (spec/73 §4).
            if let Some(old) = ev.date {
                db_events::fix_checkpoint_dates(&mut *tx, ev.id, old).await?;
            }
            // Tarihsiz etkinligin saati olmaz (sema check'i).
            db_events::set_date(&mut *tx, ev.id, v).await?;
            log_change(&mut tx, &twin, me, "date", json(ev.date), json(v)).await?;
        }
        EventPatch::StartTime(v) => {
            let t = v.as_deref().map(|s| NaiveTime::parse_from_str(s, "%H:%M"))
                .transpose().map_err(|_| AppError::BadRequest("invalid_time"))?;
            if t.is_some() && ev.date.is_none() {
                return Err(AppError::Conflict("event_needs_date"));
            }
            db_events::set_start_time(&mut *tx, ev.id, t).await?;
            log_change(&mut tx, &twin, me, "start_time", json(&ev.start_time),
                json(t.map(|t| t.format("%H:%M").to_string()))).await?;
        }
        // Yer tek: liste yeri YA DA metin; biri yazilinca obur temizlenir.
        // Gecmise ad yazilir (dugum adi sonradan degisse de satir okunur kalsin).
        EventPatch::LocationId(v) => {
            check_location(st, v)?;
            let (from, to) = {
                let tree = common::tree(st);
                let name = |id: Option<Uuid>| id.map(|i| tree.name(i).to_string());
                (name(ev.location_id).or(ev.place.clone()), name(v))
            };
            db_events::set_location(&mut *tx, ev.id, v).await?;
            log_change(&mut tx, &twin, me, "place", json(from), json(to)).await?;
        }
        EventPatch::Place(v) => {
            let v = common::text(v, TITLE_MAX, "invalid_place")?;
            let from = ev.location_id.map(|i| common::tree(st).name(i).to_string()).or(ev.place.clone());
            db_events::set_place(&mut *tx, ev.id, v.as_deref()).await?;
            log_change(&mut tx, &twin, me, "place", json(from), json(&v)).await?;
        }
        EventPatch::Attendees(v) => {
            if v.is_some_and(|n| !(0..=100_000).contains(&n)) {
                return Err(AppError::BadRequest("invalid_attendees"));
            }
            db_events::set_attendees(&mut *tx, ev.id, v).await?;
            log_change(&mut tx, &twin, me, "attendees", json(ev.attendees), json(v)).await?;
        }
        EventPatch::Description(v) => {
            let v = common::text(v, TEXT_MAX, "invalid_description")?;
            if bypass_quality && v.is_none() {
                return Err(AppError::BadRequest("description_required"));
            }
            db_events::set_description(&mut *tx, ev.id, v.as_deref()).await?;
            log_change(&mut tx, &twin, me, "description", json(&ev.description), json(&v)).await?;
        }
    }
    records::touch(&mut tx, twin.id).await?;
    tx.commit().await?;
    reply(st, me, ev.id).await
}

// --- kisiler ve takimlar -----------------------------------------------------

#[derive(Deserialize, Default)]
pub struct ParticipantBody {
    #[serde(default)]
    role: Option<String>,
}

/// Kisi ekle ya da rolunu degistir (IDEMPOTENT). Ikizin katilimcisi da olur:
/// sohbet bildirimleri ve duzenleme yetkisi oradan gelir.
pub(crate) async fn put_participant(
    st: &AppState, me: &User,
    id: Uuid, user: Uuid, b: ParticipantBody,
) -> Result<Detail> {
    let (ev, twin) = editable(st, me, id).await?;
    let uid = user;
    records::check_user(&st.pool, Some(uid)).await?;
    let role = common::text(b.role, ROLE_MAX, "invalid_role")?;
    let mut tx = st.pool.begin().await?;
    db_events::upsert_participant(&mut *tx, ev.id, uid, role).await?;
    db_events::insert_record_participant(&mut *tx, twin.id, uid, me.id).await?;
    records::touch(&mut tx, twin.id).await?;
    tx.commit().await?;
    reply(st, me, ev.id).await
}

pub(crate) async fn remove_participant(
    st: &AppState, me: &User,
    id: Uuid, user: Uuid,
) -> Result<Detail> {
    let (ev, twin) = editable(st, me, id).await?;
    let uid = user;
    let mut tx = st.pool.begin().await?;
    db_events::delete_participant(&mut *tx, ev.id, uid).await?;
    db_events::delete_record_participant(&mut *tx, twin.id, uid).await?;
    tx.commit().await?;
    reply(st, me, ev.id).await
}

pub(crate) async fn put_team(
    st: &AppState, me: &User,
    id: Uuid, team: Uuid,
) -> Result<Detail> {
    let (ev, _) = editable(st, me, id).await?;
    let tid = team;
    records::check_team(&st.pool, Some(tid)).await?;
    db_events::insert_team(&st.pool, ev.id, tid).await?;
    reply(st, me, ev.id).await
}

pub(crate) async fn remove_team(
    st: &AppState, me: &User,
    id: Uuid, team: Uuid,
) -> Result<Detail> {
    let (ev, _) = editable(st, me, id).await?;
    db_events::delete_team(&st.pool, ev.id, team).await?;
    reply(st, me, ev.id).await
}

// --- checkpoint'ler ----------------------------------------------------------

#[derive(Deserialize)]
pub struct NewCheckpoint {
    label: String,
    #[serde(default)]
    date: Option<NaiveDate>,
}

pub(crate) async fn add_checkpoint(
    st: &AppState, me: &User, id: Uuid,
    b: NewCheckpoint,
) -> Result<Detail> {
    let ev = load(&st.pool, id).await?;
    require_scope(st, me, "manage_events").await?;
    let label = common::text(Some(b.label), LABEL_MAX, "invalid_label")?
        .ok_or(AppError::BadRequest("invalid_label"))?;
    // Tarih verilmezse varsayilan son tarih: etkinlikten DEADLINE_DAYS once (goreli).
    db_events::insert_checkpoint(&st.pool, ev.id, label, b.date, -DEADLINE_DAYS).await?;
    reply(st, me, ev.id).await
}

async fn event_of(pool: &PgPool, id: Uuid) -> Result<Uuid> {
    db_events::find_checkpoint_event(pool, id).await?.ok_or(AppError::NotFound)
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
pub(crate) async fn patch_checkpoint(
    st: &AppState, me: &User, id: Uuid,
    b: CheckpointPatch,
) -> Result<Detail> {
    let event = event_of(&st.pool, id).await?;
    let (ev, _) = editable(st, me, event).await?;
    let mut tx = st.pool.begin().await?;
    if let Some(done) = b.done {
        require_approver(st, me, &ev).await?;
        db_events::set_checkpoint_done(&mut *tx, id, done).await?;
        // Dogrudan yapilan eylemin bekleyen istegi artik anlamsiz.
        db_events::delete_checkpoint_action_requests(&mut *tx, id, if done { "done" } else { "undone" }).await?;
    }
    if let Some(date) = b.date {
        require_scope(st, me, "manage_events").await?;
        db_events::set_checkpoint_date(&mut *tx, id, date, -DEADLINE_DAYS).await?;
    }
    tx.commit().await?;
    reply(st, me, event).await
}

pub(crate) async fn delete_checkpoint(
    st: &AppState, me: &User, id: Uuid,
) -> Result<Detail> {
    let event = event_of(&st.pool, id).await?;
    let ev = load(&st.pool, event).await?;
    require_approver(st, me, &ev).await?;
    db_events::delete_checkpoint(&st.pool, id).await?;
    reply(st, me, event).await
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
pub(crate) async fn request_checkpoint(
    st: &AppState, me: &User, id: Uuid,
    b: NewRequest,
) -> Result<Detail> {
    let event = event_of(&st.pool, id).await?;
    let (ev, twin) = editable(st, me, event).await?;
    let (label, done) = db_events::load_checkpoint_state(&st.pool, id).await?;
    // Zaten istenen duruma gelmis adim icin istek anlamsiz.
    if (matches!(b.action, RequestAction::Done) && done) || (matches!(b.action, RequestAction::Undone) && !done) {
        return Err(AppError::Conflict("checkpoint_state"));
    }
    let mut tx = st.pool.begin().await?;
    let added = db_events::insert_checkpoint_request(&mut *tx, id, me.id, b.action.as_str()).await?;
    if added > 0 {
        records::log(&mut tx, twin.chat_id, me.id, "checkpoint_requested", &label, Some(b.action.as_str()), None).await?;
        records::touch(&mut tx, twin.id).await?;
    }
    tx.commit().await?;
    reply(st, me, ev.id).await
}

#[derive(Deserialize)]
pub struct Resolve {
    approve: bool,
}

/// Onaylayici istegi yanitlar: onay eylemi yapar, ret yapmaz; ikisinde de istek
/// silinir ve ikizin sohbetine `checkpoint_approved` / `checkpoint_denied` yazilir.
pub(crate) async fn resolve_request(
    st: &AppState, me: &User, id: Uuid,
    b: Resolve,
) -> Result<Detail> {
    let r = db_events::find_request_resolution(&st.pool, id).await?.ok_or(AppError::NotFound)?;
    let (cid, action, event, label) = (r.checkpoint_id, r.action, r.event_id, r.label);
    let ev = load(&st.pool, event).await?;
    require_approver(st, me, &ev).await?;
    let twin = records::load(&st.pool, ev.record_id).await?;
    let mut tx = st.pool.begin().await?;
    if b.approve {
        match action.as_str() {
            "done" => db_events::approve_checkpoint_done(&mut *tx, cid).await?,
            "undone" => db_events::approve_checkpoint_undone(&mut *tx, cid).await?,
            // Adimla birlikte tum istekleri de (cascade) gider.
            _ => db_events::delete_checkpoint(&mut *tx, cid).await?,
        };
    }
    // Onayda ayni adim icin ayni eylemi isteyen digerleri de karsilanmis olur.
    db_events::delete_resolved_requests(&mut *tx, id, b.approve, cid, &action).await?;
    records::log(&mut tx, twin.chat_id, me.id,
        if b.approve { "checkpoint_approved" } else { "checkpoint_denied" }, &label, Some(&action), None).await?;
    records::touch(&mut tx, twin.id).await?;
    tx.commit().await?;
    reply(st, me, event).await
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
pub(crate) async fn add_widget(
    st: &AppState, me: &User, id: Uuid,
    b: NewWidget,
) -> Result<Detail> {
    match (b.kind, b.record_id) {
        (WidgetType::Record, Some(rid)) => {
            let (ev, _) = editable(st, me, id).await?;
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
            require_scope(st, me, "manage_event_widgets").await?;
        }
    }
    db_events::insert_widget(&st.pool, id, b.kind, b.record_id).await?;
    reply(st, me, id).await
}

/// Yuvayi kaldirir; veri (malzemeler, kayit) KALIR — widget geri eklenince
/// ayni liste gorunur.
pub(crate) async fn delete_widget(
    st: &AppState, me: &User, id: Uuid,
) -> Result<Detail> {
    let (event, kind) = db_events::find_widget_owner(&st.pool, id).await?.ok_or(AppError::NotFound)?;
    if kind == WidgetType::Record {
        editable(st, me, event).await?;
    } else {
        require_scope(st, me, "manage_event_widgets").await?;
    }
    db_events::delete_widget(&st.pool, id).await?;
    reply(st, me, event).await
}

// --- satin alimlar (spec/73 §5) ----------------------------------------------

#[derive(Deserialize)]
pub struct NewMaterial {
    name: String,
    /// Isteğe bağlı: kabul edilen öneri açıklamasıyla gelir (spec/79 §9 madde 10).
    #[serde(default)]
    notes: Option<String>,
    /// Kabul edilen oneri (`material_suggestions.id`): kalem `origin = 'ai'` dogar, oneri
    /// `accepted` olur ve kaleme baglanir. Yoksa kalem elle eklenmistir (`manual`).
    #[serde(default)]
    suggestion_id: Option<Uuid>,
}

pub(crate) async fn add_material(
    st: &AppState, me: &User, id: Uuid,
    b: NewMaterial,
) -> Result<Detail> {
    load(&st.pool, id).await?;
    require_scope(st, me, "manage_purchases").await?;
    let name = common::text(Some(b.name), TITLE_MAX, "invalid_name")?
        .ok_or(AppError::BadRequest("invalid_name"))?;
    let notes = common::text(b.notes, TEXT_MAX, "invalid_notes")?;
    // Kalem bagimsiz dogar, etkinlige `event_materials` ile baglanir.
    let mut tx = st.pool.begin().await?;
    let origin = if b.suggestion_id.is_some() { "ai" } else { "manual" };
    let material = db_events::insert_material(&mut *tx, name, notes, me.id, origin).await?;
    db_events::insert_event_material(&mut *tx, material, id).await?;
    if let Some(sid) = b.suggestion_id {
        decide_suggestion(&mut tx, id, sid, me.id, "accepted", Some(material)).await?;
    }
    tx.commit().await?;
    reply(st, me, id).await
}

/// Teklifleri kalemlere ekler (etkinlik ayrintisi ve maliye ortak).
async fn attach_providers<'e>(ex: impl sqlx::PgExecutor<'e>, materials: &mut [Material]) -> Result<()> {
    let ids: Vec<Uuid> = materials.iter().map(|m| m.id).collect();
    let providers = db_events::list_providers(ex, &ids).await?;
    for p in providers.into_iter().map(|p| Provider { id: p.id, material_id: p.material_id, contact: p.contact, name: p.name,
        price: p.price, arrival_date: p.arrival_date, overage_level: None }) {
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
    let bases = db_events::list_overage_bases(pool).await?;
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
    let mut rows: Vec<Material> = db_events::list_material_by_id(&mut *conn, material).await?.into_iter().map(Material::from).collect();
    attach_providers(&mut *conn, &mut rows).await?;
    let m = apply(rows.pop().ok_or(AppError::NotFound)?, MaterialPatch::default())?;
    db_events::set_overage(&mut *conn, material, m.overage_ln).await?;
    Ok(())
}

/// Maliye incelemesinden gecmis kalemin tedarigi donar: ad, adet, adimlar, sponsor,
/// secim ve tekliflere yazilmaz. Not, oncelik ve teslim isareti serbest.
async fn require_unpurchased(pool: &PgPool, material: Uuid) -> Result<()> {
    let purchased = db_events::load_purchased(pool, material).await?;
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

/// Kalem yazma uclarinin cevabi: etkinlik kalemi icin etkinlik ayrintisi (widget'in
/// bekledigi sekil); etkinliksiz kalem icin kalemin kendisi. Silinince `deleted`.
#[derive(Serialize)]
#[serde(untagged)]
pub enum MatReply {
    Event(Box<Detail>),
    Standalone(Box<Material>),
    Deleted { deleted: bool },
}

/// Kalemin etkinligi: `None` etkinliksiz (Maliye duvari) kalem; kalem yoksa 404.
async fn material_event(pool: &PgPool, id: Uuid) -> Result<Option<Uuid>> {
    let row = db_events::find_material_event(pool, id).await?;
    row.map(|r| r.0).ok_or(AppError::NotFound)
}

/// Tek kalem + teklifleri + kademeler (etkinlik ayrintisi ve Maliye ayni satiri okur).
pub(crate) async fn material_one(pool: &PgPool, id: Uuid) -> Result<Material> {
    let mut m: Vec<Material> = db_events::list_material_by_id(pool, id).await?.into_iter().map(Material::from).collect();
    attach_providers(pool, &mut m).await?;
    fill_levels(pool, &mut m).await?;
    m.pop().ok_or(AppError::NotFound)
}

async fn mat_reply(st: &AppState, me: &User, material: Uuid, event: Option<Uuid>) -> Result<MatReply> {
    Ok(match event {
        Some(e) => MatReply::Event(Box::new(reply(st, me, e).await?)),
        None => MatReply::Standalone(Box::new(material_one(&st.pool, material).await?)),
    })
}

pub(crate) async fn patch_material(
    st: &AppState, me: &User, id: Uuid,
    b: MaterialPatch,
) -> Result<MatReply> {
    let event = material_event(&st.pool, id).await?;
    require_scope(st, me, "manage_purchases").await?;
    // Butce ayri yetki: tedarik yazmak butce degistirmeye yetmez.
    if b.budget.is_some() { require_scope(st, me, "manage_budgets").await?; }
    let mut tx = st.pool.begin().await?;
    let mut cur = Material::from(db_events::lock_material(&mut *tx, id).await?);
    // Asim kart fiyatindan turer: teklifler de lazim.
    attach_providers(&mut *tx, std::slice::from_mut(&mut cur)).await?;
    let m = apply(cur, b)?;
    // Secilen teklif bu kalemin: bileske FK de zorlar, ama 500 yerine 400 donelim.
    if let Some(pid) = m.chosen_provider_id {
        let mine = db_events::provider_belongs_to_material(&mut *tx, pid, id).await?;
        if !mine { return Err(AppError::BadRequest("invalid_provider")); }
    }
    db_events::update_material(&mut *tx, id, &m.name, m.notes.as_deref(), m.kind, m.priority, m.state, m.qty,
        m.owned, m.has_sponsor, m.chosen_provider_id, m.sponsor_chosen, m.sponsor_qty, m.sponsor_date,
        m.in_sponsor_record, m.delivered, m.budget, m.overage_ln).await?;
    tx.commit().await?;
    mat_reply(st, me, id, event).await
}

pub(crate) async fn delete_material(
    st: &AppState, me: &User, id: Uuid,
) -> Result<MatReply> {
    let event = material_event(&st.pool, id).await?;
    require_scope(st, me, "manage_purchases").await?;
    require_unpurchased(&st.pool, id).await?;
    db_events::delete_material(&st.pool, id).await?;
    match event {
        Some(e) => Ok(MatReply::Event(Box::new(reply(st, me, e).await?))),
        None => Ok(MatReply::Deleted { deleted: true }),
    }
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

pub(crate) async fn add_provider(
    st: &AppState, me: &User, id: Uuid,
    b: NewProvider,
) -> Result<MatReply> {
    let event = material_event(&st.pool, id).await?;
    require_scope(st, me, "manage_purchases").await?;
    require_unpurchased(&st.pool, id).await?;
    let contact = common::text(Some(b.contact), CONTACT_MAX, "invalid_contact")?
        .ok_or(AppError::BadRequest("invalid_contact"))?;
    if b.price.is_some_and(|p| !p.is_finite() || !(0.0..=PRICE_MAX).contains(&p)) {
        return Err(AppError::BadRequest("invalid_price"));
    }
    let name = common::text(b.name, TITLE_MAX, "invalid_name")?;
    let mut tx = st.pool.begin().await?;
    // Tedarikci: etiket/ad bul-ya-da-ac ile baglanir (Maliye > Tedarikciler).
    let vendor = match super::purchasing::offer_label(name.as_deref(), &contact) {
        Some(l) => super::purchasing::ensure_vendor(&mut tx, l, Some(me.id)).await?,
        None => None,
    };
    // Para numeric'te: float yalniz tasima, kayitta kurusa yuvarlanir.
    db_events::insert_provider(&mut *tx, id, contact, name, b.price, b.arrival_date, vendor).await?;
    db_events::touch_material(&mut *tx, id).await?;
    refresh_overage(&mut tx, id).await?;
    tx.commit().await?;
    mat_reply(st, me, id, event).await
}

pub(crate) async fn delete_provider(
    st: &AppState, me: &User, id: Uuid,
) -> Result<MatReply> {
    let (material, event) = provider_owner(&st.pool, id).await?;
    require_scope(st, me, "manage_purchases").await?;
    require_unpurchased(&st.pool, material).await?;
    let mut tx = st.pool.begin().await?;
    db_events::delete_provider(&mut *tx, id).await?;
    db_events::touch_material(&mut *tx, material).await?;
    refresh_overage(&mut tx, material).await?;
    tx.commit().await?;
    mat_reply(st, me, material, event).await
}

/// Teklifin (kalemi, etkinligi); etkinlik `None` ise kalem etkinliksizdir (Maliye duvari).
async fn provider_owner(pool: &PgPool, id: Uuid) -> Result<(Uuid, Option<Uuid>)> {
    db_events::find_provider_owner(pool, id).await?.ok_or(AppError::NotFound)
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

pub(crate) async fn patch_provider(
    st: &AppState, me: &User, id: Uuid,
    b: ProviderPatch,
) -> Result<MatReply> {
    let (material, event) = provider_owner(&st.pool, id).await?;
    require_scope(st, me, "manage_purchases").await?;
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
    let relabel = contact.is_some() || name.is_some();
    let mut tx = st.pool.begin().await?;
    db_events::patch_provider(&mut *tx, id, contact, name, b.price, b.arrival_date).await?;
    if relabel {
        // Etiket degisti: tedarikci bagi yeniden kurulur.
        let (n, c) = db_events::load_provider_label(&mut *tx, id).await?;
        let vendor = match super::purchasing::offer_label(n.as_deref(), &c) {
            Some(l) => super::purchasing::ensure_vendor(&mut tx, l, Some(me.id)).await?,
            None => None,
        };
        db_events::set_provider_vendor(&mut *tx, id, vendor).await?;
    }
    db_events::touch_material(&mut *tx, material).await?;
    refresh_overage(&mut tx, material).await?;
    tx.commit().await?;
    mat_reply(st, me, material, event).await
}

#[derive(Deserialize)]
pub struct PurchasedPatch {
    purchased: bool,
}

/// Maliye incelemesi: kalemi "satin alindi" isaretler/kaldirir. Widget'tan YAPILAMAZ
/// (`PATCH /api/materials/{id}` bu alani bilmez); ayri scope ister. Yalniz onayli,
/// elde olmayan kalem satin alinmis sayilir. Etkinlik gerekmez: sahipsiz kalem de incelenir.
pub(crate) async fn set_purchased(
    st: &AppState, me: &User, id: Uuid,
    b: PurchasedPatch,
) -> Result<Material> {
    let (state, owned) = db_events::find_purchase_state(&st.pool, id).await?.ok_or(AppError::NotFound)?;
    require_scope(st, me, "review_purchases").await?;
    if b.purchased && (state != 3 || owned) { return Err(AppError::Conflict("not_approved")); }
    db_events::set_purchased(&st.pool, id, b.purchased, me.id).await?;
    material_one(&st.pool, id).await
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

pub(crate) struct PurchaseFile { pub(crate) bytes: Vec<u8>, pub(crate) file_name: String }

pub(crate) async fn purchases_xlsx(st: &AppState, me: &User, id: Uuid) -> Result<PurchaseFile> {
    require_visible(st, me, id).await?;
    let ev = load(&st.pool, id).await?;
    let date = ev.date.map(|d| d.format("%d.%m.%Y").to_string()).unwrap_or_else(|| "tarihsiz".into());
    let title = format!("Satın alımlar — {}", ev.title);
    let summary = format!("Etkinlik tarihi: {date} · Yalnız onaylı ve teslim edilen kalemler · dışa aktarım {}", Utc::now().format("%d.%m.%Y"));
    let detail = detail_of(st, me, ev).await?;
    let rows: Vec<purchases_xlsx::Row> = purchase_rows(&detail.materials).into_iter().map(xlsx_row).collect();
    let bytes = purchases_xlsx::render(&title, &summary, &rows).map_err(|e| {
        tracing::error!("satin alim xlsx: {e}");
        AppError::Conflict("xlsx_template")
    })?;
    Ok(PurchaseFile { bytes, file_name: format!("satin-alimlar-{id}.xlsx") })
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
