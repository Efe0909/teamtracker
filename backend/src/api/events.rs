//! Etkinlik planlama (spec/73).
//!
//! Her etkinligin bir IKIZ kaydi var (`events.record_id`): sohbet, arsiv,
//! eylemler orada. Ikiz yalniz `create`'te dogar; var olan kayit ikiz
//! yapilamaz, sonradan degistirilemez (gocteki tetikleyici).
//!
//! Yetki: etkinligi, ikiz kaydini duzenleyebilen (kayit yetki yollari aynen:
//! sorumlu, acan, katilimci, takim, dal) YA DA `manage_events` sahibi duzenler.
//! Checkpoint yapisi (ekle, sil, tarih) yalniz `manage_events`; isaretlemek
//! duzenleyen herkese. Sablon widget'i (kayit disi) `manage_event_widgets`,
//! satin alim `manage_purchases` ister. Okuma herkese acik (kayitlarla ayni).
//!
//! Yazma uclari guncel etkinlik ayrintisini dondurur (kayitlarla ayni sozlesme).

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres};
use uuid::Uuid;

use crate::{
    api::{common::{self, Body}, records},
    auth::CurrentUser,
    error::{AppError, Result},
    models::{
        enums::{EventKind, EventStatus, MaterialType, Priority, RecordKind, WidgetType},
        record::Record,
        user::User,
    },
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
        "e.id, e.record_id, e.title, e.kind, e.status, e.priority, e.owner_id, e.date,
         to_char(e.start_time, 'HH24:MI') as start_time, e.place, e.attendees, e.description,
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
    kind: EventKind,
    status: EventStatus,
    priority: Priority,
    owner_id: Option<Uuid>,
    date: Option<NaiveDate>,
    /// "HH:MM"
    start_time: Option<String>,
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
    /// `manage_events`: checkpoint ekle/sil/tarih.
    can_manage: bool,
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

#[derive(Serialize, sqlx::FromRow)]
struct Material {
    id: Uuid,
    name: String,
    notes: Option<String>,
    #[serde(rename = "type")]
    kind: MaterialType,
    priority: Priority,
    state: i16,
    has_sponsor: bool,
    owned: bool,
    updated_at: DateTime<Utc>,
    #[sqlx(skip)]
    providers: Vec<Provider>,
}

#[derive(Serialize, sqlx::FromRow)]
struct Provider {
    id: Uuid,
    #[serde(skip)]
    material_id: Uuid,
    contact: String,
    /// numeric(12,2) -> float8 yalniz OKURKEN; toplama sunucuda numeric'te kalir.
    price: Option<f64>,
    arrival_date: Option<NaiveDate>,
}

async fn detail_of(st: &AppState, me: &User, event: EventRow) -> Result<Detail> {
    let twin = records::load(&st.pool, event.record_id).await?;
    let can_manage = common::has_scope(st, me, "manage_events").await?;
    let can_edit = can_manage || crate::db::scope::can_edit_record(&st.pool, me, &twin, &st.tree).await?;
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
          order by coalesce(c.due_date, e.date + c.offset_days::int) nulls last, c.position")
        .bind(event.id).fetch_all(&st.pool).await?;
    let widgets = sqlx::query_as(
        "select id, widget_type as kind, record_id from event_widgets where event_id = $1 order by position")
        .bind(event.id).fetch_all(&st.pool).await?;
    let mut materials: Vec<Material> = sqlx::query_as(
        "select id, name, notes, type as kind, priority, state, has_sponsor, owned, updated_at
           from materials where event_id = $1 order by created_at")
        .bind(event.id).fetch_all(&st.pool).await?;
    let ids: Vec<Uuid> = materials.iter().map(|m| m.id).collect();
    let providers: Vec<Provider> = sqlx::query_as(
        "select id, material_id, contact, price::float8 as price, arrival_date
           from material_providers where material_id = any($1) order by price nulls last, id")
        .bind(&ids).fetch_all(&st.pool).await?;
    for p in providers {
        if let Some(m) = materials.iter_mut().find(|m| m.id == p.material_id) {
            m.providers.push(p);
        }
    }
    Ok(Detail { event, participants, team_ids, checkpoints, widgets, materials, can_edit, can_manage })
}

async fn reply(st: &AppState, me: &User, id: Uuid) -> Result<Json<Detail>> {
    let ev = load(&st.pool, id).await?;
    Ok(Json(detail_of(st, me, ev).await?))
}

pub async fn get(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    reply(&st, &me, common::id(&raw)?).await
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

/// Yeni etkinlige kopyalanan widget'lar ve checkpoint'ler (gun farki, 0 =
/// etkinlik gunu). Kopya OLUSTURMA aninda: sablon degisirse eski etkinlik
/// degismez. On yuzdeki `EVENT_TEMPLATE` yalniz onizleme; kaynak burasi.
type Template = (&'static [WidgetType], &'static [(&'static str, i16)]);

/// Varsayilan kural (Efe, 2026-10-02): butun hazirlik etkinlikten en gec bu
/// kadar gun once biter. Sablonda bundan gec checkpoint yok; elle eklenen
/// tarihsiz checkpoint da buraya duser. Farkli tarih `manage_events` ister.
const DEADLINE_DAYS: i16 = 7;

fn template(kind: EventKind) -> Template {
    match kind {
        // Kampuste yapilan turler OTF ister (universite talep formu, api/otf.rs).
        EventKind::Meeting => (&[WidgetType::Otf], &[
            ("Gündem toplandı", -10), ("OTF gönderildi", -7), ("Davet gönderildi", -7),
        ]),
        EventKind::Training => (&[WidgetType::Otf, WidgetType::Supplies], &[
            ("Eğitmen kesinleşti", -21), ("Mekan ayarlandı", -14), ("OTF gönderildi", -7), ("Malzeme hazır", -7),
        ]),
        EventKind::Social => (&[WidgetType::Otf], &[
            ("Bütçe onayı", -21), ("Mekan ayarlandı", -14), ("OTF gönderildi", -7), ("Duyuru", -7),
        ]),
        EventKind::Visit => (&[], &[("Ziyaret onayı", -21), ("Ulaşım ayarlandı", -7)]),
        EventKind::Conference => (&[WidgetType::Supplies], &[
            ("Başvuru", -45), ("Stand kesinleşti", -30), ("Tanıtım", -10), ("Malzeme hazır", -7),
        ]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_checkpoints_end_a_week_before() {
        for k in [EventKind::Meeting, EventKind::Training, EventKind::Social, EventKind::Visit, EventKind::Conference] {
            assert!(template(k).1.iter().all(|(_, d)| *d <= -DEADLINE_DAYS), "{k:?}");
        }
    }
}

// --- yeni etkinlik ---------------------------------------------------------

#[derive(Deserialize)]
pub struct NewEvent {
    title: String,
    kind: EventKind,
    /// Ikiz kaydin birimi.
    unit_id: Uuid,
    #[serde(default)]
    date: Option<NaiveDate>,
    #[serde(default)]
    priority: Option<Priority>,
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
    records::check_unit(&st, b.unit_id)?;
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
    let id: Uuid = sqlx::query_scalar(
        "insert into events (record_id, title, kind, status, priority, owner_id, date, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $6) returning id")
        .bind(record_id).bind(&title).bind(b.kind).bind(status).bind(priority).bind(me.id).bind(b.date)
        .fetch_one(&mut *tx).await?;
    sqlx::query("insert into event_participants (event_id, user_id) values ($1, $2)")
        .bind(id).bind(me.id).execute(&mut *tx).await?;
    let (widgets, checkpoints) = template(b.kind);
    for (i, w) in widgets.iter().enumerate() {
        sqlx::query("insert into event_widgets (event_id, widget_type, position) values ($1, $2, $3)")
            .bind(id).bind(*w).bind(i as i16).execute(&mut *tx).await?;
    }
    for (i, (label, offset)) in checkpoints.iter().enumerate() {
        sqlx::query(
            "insert into event_checkpoints (event_id, label, offset_days, position) values ($1, $2, $3, $4)")
            .bind(id).bind(*label).bind(*offset).bind(i as i16).execute(&mut *tx).await?;
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
    Place(Option<String>),
    Attendees(Option<i32>),
    Description(Option<String>),
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
    Body(p): Body<EventPatch>,
) -> Result<Json<Detail>> {
    let (ev, twin) = editable(&st, &me, common::id(&raw)?).await?;
    let fixed = matches!(ev.status, EventStatus::Confirmed | EventStatus::Done);
    let mut tx = st.pool.begin().await?;
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
        EventPatch::Place(v) => {
            let v = common::text(v, TITLE_MAX, "invalid_place")?;
            set("update events set place = $2, updated_at = now() where id = $1")
                .bind(&v).execute(&mut *tx).await?;
            log_change(&mut tx, &twin, &me, "place", json(&ev.place), json(&v)).await?;
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

/// Elle isaretlenir; tarih gecti diye kendiliginden dolmaz. Isaretlemek
/// duzenleyen herkese, tarihi degistirmek `manage_events`'e.
pub async fn patch_checkpoint(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<CheckpointPatch>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let event = event_of(&st.pool, "select event_id from event_checkpoints where id = $1", id).await?;
    editable(&st, &me, event).await?;
    let mut tx = st.pool.begin().await?;
    if let Some(done) = b.done {
        sqlx::query(
            "update event_checkpoints set done_at = case when $2 then coalesce(done_at, now()) end where id = $1")
            .bind(id).bind(done).execute(&mut *tx).await?;
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
    require_scope(&st, &me, "manage_events").await?;
    sqlx::query("delete from event_checkpoints where id = $1").bind(id).execute(&st.pool).await?;
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
    sqlx::query("insert into materials (event_id, name) values ($1, $2)")
        .bind(id).bind(name).execute(&st.pool).await?;
    reply(&st, &me, id).await
}

/// Kismi: gelen alan degisir. `notes: null` notu siler, `notes` yoksa dokunmaz.
#[derive(Deserialize)]
pub struct MaterialPatch {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, deserialize_with = "common::present")]
    notes: Option<Option<String>>,
    #[serde(default, rename = "type")]
    kind: Option<MaterialType>,
    #[serde(default)]
    priority: Option<Priority>,
    /// Tamamlanan adim sayisi. Sponsor adimi kalkinca 4 -> 3'e iner.
    #[serde(default)]
    state: Option<i16>,
    #[serde(default)]
    has_sponsor: Option<bool>,
    #[serde(default)]
    owned: Option<bool>,
}

async fn material_event(pool: &PgPool, id: Uuid) -> Result<Uuid> {
    event_of(pool, "select event_id from materials where id = $1", id).await
}

pub async fn patch_material(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<MaterialPatch>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let event = material_event(&st.pool, id).await?;
    require_scope(&st, &me, "manage_purchases").await?;
    let name = match b.name {
        Some(n) => Some(common::text(Some(n), TITLE_MAX, "invalid_name")?
            .ok_or(AppError::BadRequest("invalid_name"))?),
        None => None,
    };
    let notes = b.notes.map(|n| common::text(n, TEXT_MAX, "invalid_notes")).transpose()?;
    if b.state.is_some_and(|s| !(0..=4).contains(&s)) {
        return Err(AppError::BadRequest("invalid_state"));
    }
    sqlx::query(
        "update materials set
            name = coalesce($2, name),
            notes = case when $3 then $4 else notes end,
            type = coalesce($5, type),
            priority = coalesce($6, priority),
            has_sponsor = coalesce($7, has_sponsor),
            state = least(coalesce($8, state), case when coalesce($7, has_sponsor) then 4 else 3 end),
            owned = coalesce($9, owned),
            updated_at = now()
          where id = $1")
        .bind(id).bind(name).bind(notes.is_some()).bind(notes.flatten()).bind(b.kind).bind(b.priority)
        .bind(b.has_sponsor).bind(b.state).bind(b.owned)
        .execute(&st.pool).await?;
    reply(&st, &me, event).await
}

pub async fn delete_material(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let event = material_event(&st.pool, id).await?;
    require_scope(&st, &me, "manage_purchases").await?;
    sqlx::query("delete from materials where id = $1").bind(id).execute(&st.pool).await?;
    reply(&st, &me, event).await
}

#[derive(Deserialize)]
pub struct NewProvider {
    contact: String,
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
    let contact = common::text(Some(b.contact), CONTACT_MAX, "invalid_contact")?
        .ok_or(AppError::BadRequest("invalid_contact"))?;
    if b.price.is_some_and(|p| !p.is_finite() || !(0.0..=PRICE_MAX).contains(&p)) {
        return Err(AppError::BadRequest("invalid_price"));
    }
    let mut tx = st.pool.begin().await?;
    // Para numeric'te: float yalniz tasima, kayitta kurusa yuvarlanir.
    sqlx::query(
        "insert into material_providers (material_id, contact, price, arrival_date)
         values ($1, $2, round($3::numeric, 2), $4)")
        .bind(id).bind(contact).bind(b.price).bind(b.arrival_date).execute(&mut *tx).await?;
    sqlx::query("update materials set updated_at = now() where id = $1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    reply(&st, &me, event).await
}

pub async fn delete_provider(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let id = common::id(&raw)?;
    let (material, event): (Uuid, Uuid) = sqlx::query_as(
        "select m.id, m.event_id from material_providers p join materials m on m.id = p.material_id
          where p.id = $1")
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;
    require_scope(&st, &me, "manage_purchases").await?;
    let mut tx = st.pool.begin().await?;
    sqlx::query("delete from material_providers where id = $1").bind(id).execute(&mut *tx).await?;
    sqlx::query("update materials set updated_at = now() where id = $1").bind(material).execute(&mut *tx).await?;
    tx.commit().await?;
    reply(&st, &me, event).await
}
