//! Kayitlar ve eylemleri.
//!
//! Yanitlar KIMLIK tasir, ad degil (isimler `/api/meta`'dan). Yazma uclari
//! guncel kayit ayrintisini dondurur: on yuz onbellegi tek yanitla tazeler,
//! ikinci bir GET atmaz.
//!
//! Her alan degisimi `activity`'ye YAPILANDIRILMIS olgu yazar:
//! `verb=field_changed`, `target_label=<alan>`, `detail={"from":..,"to":..}`.
//! Cumleyi on yuz kurar (spec/15 kural 3).

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::{
    api::{cards::{self, CardView}, common::{self, Body}},
    auth::CurrentUser,
    db::{filters::Filters, scope},
    error::{AppError, Result},
    models::{
        enums::{ActionStatus, Priority, RecordKind, RecordStatus},
        record::Record,
        user::User,
    },
    state::AppState,
};

const TITLE_MAX: usize = 200;
const TEXT_MAX: usize = 4000;
/// Tablo tek sayfada. 20-25 kisilik ekipte bu sinir bir guvenlik rayi,
/// sayfalama degil.
const LIST_LIMIT: i64 = 500;

// --- liste -----------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct RecordSummary {
    id: Uuid,
    kind: RecordKind,
    title: String,
    status: RecordStatus,
    priority: Priority,
    unit_id: Uuid,
    pillar_id: Option<Uuid>,
    team_id: Option<Uuid>,
    owner_id: Option<Uuid>,
    due_date: Option<NaiveDate>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    open_actions: i64,
    /// Acik bir eyleminin son tarihi gecmis — kaydin kendi tarihi olmasa da
    /// "geciken" sayilir (filters.rs `overdue` ile ayni tanim).
    action_overdue: bool,
    messages: i64,
    /// Bu kayit bir etkinligin ikiziyse etkinlik (spec/73 §3a: ters yon sorgudan, saklanmaz).
    event_id: Option<Uuid>,
}

pub async fn list(
    State(st): State<AppState>,
    CurrentUser(me): CurrentUser,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<RecordSummary>>> {
    let f = Filters::parse(&params);
    // Sorgu kilit ALTINDA kurulur, kilit birakildiktan SONRA kosar: guard
    // `.await` uzerinden tasinamaz (state.rs).
    let mut qb = QueryBuilder::<Postgres>::new(
        "select r.id, r.kind, r.title, r.status, r.priority, r.unit_id, r.pillar_id,
                r.team_id, r.owner_id, r.due_date, r.created_at, r.updated_at,
                (select count(*) from actions a
                  where a.record_id = r.id and a.status in ('open','in_progress')) as open_actions,
                exists(select 1 from actions a
                  where a.record_id = r.id and a.status in ('open','in_progress')
                    and a.due_date < current_date) as action_overdue,
                (select count(*) from messages m where m.chat_id = r.chat_id) as messages,
                (select e.id from events e where e.record_id = r.id) as event_id
           from records r");
    {
        let tree = common::tree(&st);
        f.push_where(&mut qb, &me, &tree);
    }
    // Sabitlenenler widget'i: yalniz benim sabitlediklerim.
    if params.get("pinned").is_some_and(|v| v == "true") {
        qb.push(" and exists(select 1 from record_pins p where p.record_id = r.id and p.user_id = ")
            .push_bind(me.id).push(")");
    }
    qb.push(f.order_by()).push(" limit ").push_bind(LIST_LIMIT);
    Ok(Json(qb.build_query_as().fetch_all(&st.pool).await?))
}

// --- ayrinti ---------------------------------------------------------------

#[derive(Serialize)]
pub struct Detail {
    record: Record,
    actions: Vec<ActionOut>,
    participants: Vec<Uuid>,
    cards: Vec<CardView>,
    access: Access,
    /// Bu kisi kaydi sabitlemis mi.
    pinned: bool,
    membership: Membership,
    /// Bu kayit bir etkinligin ikiziyse etkinlik; anahtar (Etkinlik | Kayit) buradan.
    event_id: Option<Uuid>,
}

/// Erisim kipi ve bu kisinin kayitla iliskisi (spec: kayit erisim kipleri).
#[derive(Serialize)]
pub struct Membership {
    /// public | request | private
    mode: String,
    /// Uye = yazma yetkisi olan her yol (admin, sorumlu, acan, katilimci, takim, dal).
    is_member: bool,
    /// private kayitta uye olmayan: eylem/kart/katilimci/sohbet gizli.
    restricted: bool,
    /// Benim istegim: pending | denied | null.
    request: Option<String>,
    /// Istekleri karara baglayabilir mi (sorumlu, acan, admin).
    can_decide: bool,
    /// Bekleyen istekler; yalniz karar verenler icin dolu.
    requests: Vec<JoinRequest>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct JoinRequest {
    user_id: Uuid,
    created_at: chrono::DateTime<chrono::Utc>,
}

fn decider(me: &User, rec: &Record) -> bool {
    me.is_admin || rec.owner_id == Some(me.id) || rec.created_by == me.id
}

#[derive(Serialize)]
struct Access {
    can_edit: bool,
    /// Son tarih ayri yetenek ister (`edit_deadline`). Kayit ve eylem icin ayni.
    can_edit_deadline: bool,
}

#[derive(Serialize, sqlx::FromRow)]
struct ActionOut {
    id: Uuid,
    title: String,
    status: ActionStatus,
    owner_id: Option<Uuid>,
    due_date: Option<NaiveDate>,
    created_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
}

pub(crate) async fn load(pool: &PgPool, id: Uuid) -> Result<Record> {
    Record::fetch(pool, id).await?.ok_or(AppError::NotFound)
}

pub(crate) async fn detail_of(st: &AppState, me: &User, rec: Record) -> Result<Detail> {
    let can_edit = scope::can_edit_record(&st.pool, me, &rec, &st.tree).await?;
    let mode: String = sqlx::query_scalar("select access_mode from records where id = $1")
        .bind(rec.id).fetch_one(&st.pool).await?;
    let restricted = mode == "private" && !can_edit;
    let event_id: Option<Uuid> = sqlx::query_scalar("select id from events where record_id = $1")
        .bind(rec.id).fetch_optional(&st.pool).await?;
    let can_decide = decider(me, &rec);
    let request: Option<String> = sqlx::query_scalar(
        "select status from record_join_requests where record_id = $1 and user_id = $2")
        .bind(rec.id).bind(me.id).fetch_optional(&st.pool).await?;
    let requests: Vec<JoinRequest> = if can_decide {
        sqlx::query_as(
            "select user_id, created_at from record_join_requests
              where record_id = $1 and status = 'pending' order by created_at")
            .bind(rec.id).fetch_all(&st.pool).await?
    } else {
        Vec::new()
    };
    let membership = Membership { mode, is_member: can_edit, restricted, request, can_decide, requests };
    let pinned: bool = sqlx::query_scalar(
        "select exists(select 1 from record_pins where user_id = $1 and record_id = $2)")
        .bind(me.id).bind(rec.id).fetch_one(&st.pool).await?;
    // Gizli kayit, uye degil: yalniz kayit satiri (baslik, aciklama, durum...) acik.
    if restricted {
        return Ok(Detail {
            record: rec, actions: Vec::new(), participants: Vec::new(), cards: Vec::new(),
            access: Access { can_edit: false, can_edit_deadline: false }, pinned, membership, event_id,
        });
    }
    let actions = sqlx::query_as(
        "select id, title, status, owner_id, due_date, created_at, resolved_at
           from actions where record_id = $1
          order by (status in ('closed','cancelled')), created_at")
        .bind(rec.id).fetch_all(&st.pool).await?;
    let participants = sqlx::query_scalar(
        "select user_id from record_participants where record_id = $1 order by added_at")
        .bind(rec.id).fetch_all(&st.pool).await?;
    let can_edit_deadline = can_edit && common::has_scope(st, me, "edit_deadline").await?;
    let mut cards = cards::of_record(st, me, &rec).await?;
    // Kisiye ozel sira; listede olmayan kart (yeni) sona, kendi sirasiyla.
    let order: Option<Vec<Uuid>> = sqlx::query_scalar(
        "select card_ids from card_order where user_id = $1 and record_id = $2")
        .bind(me.id).bind(rec.id).fetch_optional(&st.pool).await?;
    if let Some(order) = order {
        cards.sort_by_key(|c| order.iter().position(|id| *id == c.id()).unwrap_or(usize::MAX));
    }
    Ok(Detail {
        record: rec, actions, participants, cards,
        access: Access { can_edit, can_edit_deadline }, pinned, membership, event_id,
    })
}

/// Okuma herkese acik (giris yapmis her aktif kullanici): yetki DEGISTIRMEYI
/// kapatir, gormeyi degil — Python surumuyle ayni.
pub async fn get(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let rec = load(&st.pool, common::id(&raw)?).await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

pub(crate) async fn require_edit(st: &AppState, me: &User, rec: &Record) -> Result<()> {
    if scope::can_edit_record(&st.pool, me, rec, &st.tree).await? {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

// --- dogrulama yardimcilari -------------------------------------------------

pub(crate) async fn check_user(pool: &PgPool, id: Option<Uuid>) -> Result<()> {
    let Some(id) = id else { return Ok(()) };
    let ok: Option<i32> = sqlx::query_scalar("select 1 from users where id = $1 and is_active")
        .bind(id).fetch_optional(pool).await?;
    ok.map(|_| ()).ok_or(AppError::BadRequest("unknown_user"))
}

pub(crate) async fn check_team(pool: &PgPool, id: Option<Uuid>) -> Result<()> {
    let Some(id) = id else { return Ok(()) };
    let ok: Option<i32> = sqlx::query_scalar("select 1 from teams where id = $1")
        .bind(id).fetch_optional(pool).await?;
    ok.map(|_| ()).ok_or(AppError::BadRequest("unknown_team"))
}

/// Birim: aktif dugum (agac yalniz yapi, spec/22).
pub(crate) fn check_unit(st: &AppState, id: Uuid) -> Result<()> {
    let tree = common::tree(st);
    match tree.get(id) {
        // Birim Birimler kokunun ALTINDA olmali (spec/74 §4.7): etkinlik
        // turu ya da yeri birim degil.
        Some(n) if n.is_active && crate::refdata::under(&tree, id, crate::refdata::UNITS) => Ok(()),
        Some(n) if n.is_active => Err(AppError::BadRequest("unit_outside_units")),
        _ => Err(AppError::BadRequest("invalid_unit")),
    }
}

/// Pillar ORTOGONAL: kaydin atasi olmak zorunda degil, ama var ve aktif
/// bir `pillars` satiri olmali.
async fn check_pillar(pool: &PgPool, id: Option<Uuid>) -> Result<()> {
    let Some(id) = id else { return Ok(()) };
    let ok: Option<i32> = sqlx::query_scalar("select 1 from pillars where id = $1 and is_active")
        .bind(id).fetch_optional(pool).await?;
    ok.map(|_| ()).ok_or(AppError::BadRequest("invalid_pillar"))
}

pub(crate) async fn log(
    tx: &mut sqlx::Transaction<'_, Postgres>, chat_id: Uuid, actor: Uuid,
    verb: &str, subject: &str, target: Option<&str>, detail: Option<String>,
) -> Result<()> {
    sqlx::query(
        "insert into activity (chat_id, actor_id, verb, subject_label, target_label, detail)
         values ($1, $2, $3, $4, $5, $6)")
        .bind(chat_id).bind(actor).bind(verb).bind(subject).bind(target).bind(detail)
        .execute(&mut **tx).await?;
    Ok(())
}

pub(crate) fn change(from: impl Serialize, to: impl Serialize) -> Option<String> {
    Some(serde_json::json!({ "from": from, "to": to }).to_string())
}

// --- yeni kayit ------------------------------------------------------------

#[derive(Deserialize)]
pub struct NewRecord {
    kind: RecordKind,
    title: String,
    #[serde(default)]
    description: Option<String>,
    unit_id: Uuid,
    #[serde(default)]
    team_id: Option<Uuid>,
    #[serde(default)]
    pillar_id: Option<Uuid>,
    /// null = sorumlusuz ac. On yuz varsayilani acan kisi.
    #[serde(default)]
    owner_id: Option<Uuid>,
    #[serde(default)]
    priority: Option<Priority>,
    /// Acilista bos kart bloklari (R4-F12); doldurmasi kayit sayfasinda.
    #[serde(default)]
    card_types: Vec<String>,
    /// public | request | private; bos = public.
    #[serde(default)]
    access_mode: Option<String>,
}

#[derive(Serialize)]
pub struct Created {
    id: Uuid,
}

/// Kayit acmak her aktif kullaniciya, HER birimde acik — kullanici karari
/// (2026-09-23): kulup islevsel bolumlere ayrilmis ama aralarinda kopru kurar,
/// herkes her takima is acabilir; takim uyeleri ustlenir ya da kapatir.
/// Python dal izni istiyordu (`service.new_item` 403) — BILEREK birakildi
/// (spec/90 G1). Duzenleme yetkisi ondan sonra iliski yollarindan gelir.
pub async fn create(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewRecord>,
) -> Result<Json<Created>> {
    let title = common::text(Some(b.title), TITLE_MAX, "invalid_title")?
        .ok_or(AppError::BadRequest("invalid_title"))?;
    let description = common::text(b.description, TEXT_MAX, "invalid_description")?;
    check_unit(&st, b.unit_id)?;
    check_pillar(&st.pool, b.pillar_id).await?;
    check_team(&st.pool, b.team_id).await?;
    check_user(&st.pool, b.owner_id).await?;
    let access_mode = b.access_mode.as_deref().unwrap_or("public");
    if !matches!(access_mode, "public" | "request" | "private") {
        return Err(AppError::BadRequest("invalid_access_mode"));
    }

    let mut tx = st.pool.begin().await?;
    let chat_id: Uuid = sqlx::query_scalar("insert into chats default values returning id")
        .fetch_one(&mut *tx).await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into records (unit_id, pillar_id, team_id, chat_id, kind, title, description,
                              priority, owner_id, created_by, access_mode)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id")
        .bind(b.unit_id).bind(b.pillar_id).bind(b.team_id).bind(chat_id).bind(b.kind)
        .bind(&title).bind(description).bind(b.priority.unwrap_or(Priority::Medium))
        .bind(b.owner_id).bind(me.id).bind(access_mode)
        .fetch_one(&mut *tx).await?;
    log(&mut tx, chat_id, me.id, "created", &title, None,
        change(serde_json::Value::Null, b.owner_id)).await?;
    for t in &b.card_types {
        cards::insert(&mut tx, id, me.id, t, None, &serde_json::Map::new()).await?;
    }
    tx.commit().await?;
    Ok(Json(Created { id }))
}

// --- alan degisimi ---------------------------------------------------------

/// Tek alan, tek istek. Deger tipi ALANA gore: gecersiz durum ya da bozuk
/// tarih serde'de duser, handler'a hic gelmez.
#[derive(Deserialize)]
#[serde(tag = "field", content = "value", rename_all = "snake_case")]
pub enum RecordPatch {
    Status(RecordStatus),
    Priority(Priority),
    OwnerId(Option<Uuid>),
    TeamId(Option<Uuid>),
    PillarId(Option<Uuid>),
    UnitId(Uuid),
    DueDate(Option<NaiveDate>),
    Title(String),
    Description(Option<String>),
    AccessMode(String),
}

pub async fn patch(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(p): Body<RecordPatch>,
) -> Result<Json<Detail>> {
    let rec = load(&st.pool, common::id(&raw)?).await?;
    require_edit(&st, &me, &rec).await?;

    // (alan, sql, eski, yeni) — SQL SABIT, kullanici girdisi yalniz bind.
    let (field, sql, from, to): (&str, &str, serde_json::Value, serde_json::Value) = match p {
        RecordPatch::Status(v) => {
            if matches!(v, RecordStatus::Closed) {
                let open: i64 = sqlx::query_scalar(
                    "select count(*) from actions where record_id = $1
                        and status in ('open','in_progress')")
                    .bind(rec.id).fetch_one(&st.pool).await?;
                if open > 0 {
                    // Kayit acik eylemi varken kapanmaz (spec/20-sema.md §3a).
                    return Err(AppError::Conflict("open_actions"));
                }
            }
            ("status", "update records set status = $2 where id = $1",
             rec.status.clone().into(), serde_json::to_value(v).unwrap_or_default())
        }
        RecordPatch::Priority(v) => ("priority", "update records set priority = $2 where id = $1",
            rec.priority.clone().into(), serde_json::to_value(v).unwrap_or_default()),
        RecordPatch::OwnerId(v) => {
            check_user(&st.pool, v).await?;
            ("owner_id", "update records set owner_id = $2 where id = $1",
             serde_json::to_value(rec.owner_id).unwrap_or_default(),
             serde_json::to_value(v).unwrap_or_default())
        }
        RecordPatch::TeamId(v) => {
            check_team(&st.pool, v).await?;
            ("team_id", "update records set team_id = $2 where id = $1",
             serde_json::to_value(rec.team_id).unwrap_or_default(),
             serde_json::to_value(v).unwrap_or_default())
        }
        RecordPatch::PillarId(v) => {
            check_pillar(&st.pool, v).await?;
            ("pillar_id", "update records set pillar_id = $2 where id = $1",
             serde_json::to_value(rec.pillar_id).unwrap_or_default(),
             serde_json::to_value(v).unwrap_or_default())
        }
        RecordPatch::UnitId(v) => {
            check_unit(&st, v)?;
            ("unit_id", "update records set unit_id = $2 where id = $1",
             serde_json::to_value(rec.unit_id).unwrap_or_default(),
             serde_json::to_value(v).unwrap_or_default())
        }
        RecordPatch::DueDate(v) => {
            if !common::has_scope(&st, &me, "edit_deadline").await? {
                return Err(AppError::Forbidden);
            }
            ("due_date", "update records set due_date = $2 where id = $1",
             serde_json::to_value(rec.due_date).unwrap_or_default(),
             serde_json::to_value(v).unwrap_or_default())
        }
        RecordPatch::AccessMode(v) => {
            // Kipi yalniz karar verenler (sorumlu, acan, admin) degistirir.
            if !decider(&me, &rec) {
                return Err(AppError::Forbidden);
            }
            if !matches!(v.as_str(), "public" | "request" | "private") {
                return Err(AppError::BadRequest("invalid_access_mode"));
            }
            let old: String = sqlx::query_scalar("select access_mode from records where id = $1")
                .bind(rec.id).fetch_one(&st.pool).await?;
            ("access_mode", "update records set access_mode = $2 where id = $1", old.into(), v.into())
        }
        RecordPatch::Title(v) => {
            let v = common::text(Some(v), TITLE_MAX, "invalid_title")?
                .ok_or(AppError::BadRequest("invalid_title"))?;
            ("title", "update records set title = $2 where id = $1", rec.title.clone().into(), v.into())
        }
        RecordPatch::Description(v) => {
            let v = common::text(v, TEXT_MAX, "invalid_description")?;
            ("description", "update records set description = $2 where id = $1",
             serde_json::to_value(&rec.description).unwrap_or_default(),
             serde_json::to_value(v).unwrap_or_default())
        }
    };

    if from != to {
        let mut tx = st.pool.begin().await?;
        bind_value(sqlx::query(sql).bind(rec.id), field, &to)?
            .execute(&mut *tx).await?;
        log(&mut tx, rec.chat_id, me.id, "field_changed", &rec.title, Some(field),
            change(&from, &to)).await?;
        // Ikizin basligi, onemi ve sorumlusu etkinlige de yazilir: iki yuz ayni
        // (spec/73 §3a). SQL sabit; deger yine sutun tipine baglanir.
        let synced = match field {
            "title" => Some("update events set title = $2, updated_at = now() where record_id = $1"),
            "priority" => Some("update events set priority = $2, updated_at = now() where record_id = $1"),
            "owner_id" => Some("update events set owner_id = $2, updated_at = now() where record_id = $1"),
            _ => None,
        };
        if let Some(sql) = synced {
            bind_value(sqlx::query(sql).bind(rec.id), field, &to)?.execute(&mut *tx).await?;
        }
        tx.commit().await?;
    }
    let rec = load(&st.pool, rec.id).await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

type PgQuery<'q> = sqlx::query::Query<'q, Postgres, sqlx::postgres::PgArguments>;

/// JSON degeri sutun tipine geri baglar. Enum/metin -> text, kimlik -> uuid,
/// tarih -> date; `null` her tipte NULL.
fn bind_value<'q>(q: PgQuery<'q>, field: &str, v: &serde_json::Value) -> Result<PgQuery<'q>> {
    let s = v.as_str().map(String::from);
    Ok(match field {
        "owner_id" | "team_id" | "pillar_id" | "unit_id" => {
            q.bind(s.map(|s| s.parse::<Uuid>()).transpose()
                .map_err(|_| AppError::BadRequest("invalid_body"))?)
        }
        "due_date" => {
            q.bind(s.map(|s| s.parse::<NaiveDate>()).transpose()
                .map_err(|_| AppError::BadRequest("invalid_body"))?)
        }
        _ => q.bind(s),
    })
}

// --- eylemler --------------------------------------------------------------

#[derive(Deserialize)]
pub struct NewAction {
    title: String,
    #[serde(default)]
    owner_id: Option<Uuid>,
    #[serde(default)]
    due_date: Option<NaiveDate>,
}

pub async fn add_action(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewAction>,
) -> Result<Json<Detail>> {
    let rec = load(&st.pool, common::id(&raw)?).await?;
    require_edit(&st, &me, &rec).await?;
    let title = common::text(Some(b.title), TITLE_MAX, "invalid_title")?
        .ok_or(AppError::BadRequest("invalid_title"))?;
    check_user(&st.pool, b.owner_id).await?;
    if b.due_date.is_some() && !common::has_scope(&st, &me, "edit_deadline").await? {
        return Err(AppError::Forbidden);
    }
    let mut tx = st.pool.begin().await?;
    sqlx::query(
        "insert into actions (record_id, title, owner_id, created_by, due_date)
         values ($1, $2, $3, $4, $5)")
        .bind(rec.id).bind(&title).bind(b.owner_id).bind(me.id).bind(b.due_date)
        .execute(&mut *tx).await?;
    log(&mut tx, rec.chat_id, me.id, "action_added", &title, None,
        change(serde_json::Value::Null, b.owner_id)).await?;
    touch(&mut tx, rec.id).await?;
    tx.commit().await?;
    let rec = load(&st.pool, rec.id).await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

#[derive(Deserialize)]
#[serde(tag = "field", content = "value", rename_all = "snake_case")]
pub enum ActionPatch {
    Status(ActionStatus),
    OwnerId(Option<Uuid>),
    DueDate(Option<NaiveDate>),
    Title(String),
}

#[derive(sqlx::FromRow)]
struct ActionRow {
    id: Uuid,
    record_id: Uuid,
    title: String,
    status: ActionStatus,
    owner_id: Option<Uuid>,
    due_date: Option<NaiveDate>,
}

pub async fn patch_action(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(p): Body<ActionPatch>,
) -> Result<Json<Detail>> {
    let a: ActionRow = sqlx::query_as(
        "select id, record_id, title, status, owner_id, due_date from actions where id = $1")
        .bind(common::id(&raw)?).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;
    let rec = load(&st.pool, a.record_id).await?;
    require_edit(&st, &me, &rec).await?;

    let mut tx = st.pool.begin().await?;
    let (field, from, to) = match p {
        ActionPatch::Status(v) => {
            let done = matches!(v, ActionStatus::Closed | ActionStatus::Cancelled);
            // Kapatan ve zamani izde durur; yeniden acmak ikisini de siler.
            sqlx::query(
                "update actions set status = $2,
                        resolved_by = case when $3 then $4 end,
                        resolved_at = case when $3 then now() end
                  where id = $1")
                .bind(a.id).bind(v).bind(done).bind(me.id).execute(&mut *tx).await?;
            ("status", serde_json::to_value(a.status), serde_json::to_value(v))
        }
        ActionPatch::OwnerId(v) => {
            check_user(&st.pool, v).await?;
            sqlx::query("update actions set owner_id = $2 where id = $1")
                .bind(a.id).bind(v).execute(&mut *tx).await?;
            ("owner_id", serde_json::to_value(a.owner_id), serde_json::to_value(v))
        }
        ActionPatch::DueDate(v) => {
            if !common::has_scope(&st, &me, "edit_deadline").await? {
                return Err(AppError::Forbidden);
            }
            sqlx::query("update actions set due_date = $2 where id = $1")
                .bind(a.id).bind(v).execute(&mut *tx).await?;
            ("due_date", serde_json::to_value(a.due_date), serde_json::to_value(v))
        }
        ActionPatch::Title(v) => {
            let v = common::text(Some(v), TITLE_MAX, "invalid_title")?
                .ok_or(AppError::BadRequest("invalid_title"))?;
            sqlx::query("update actions set title = $2 where id = $1")
                .bind(a.id).bind(&v).execute(&mut *tx).await?;
            ("title", Ok(a.title.clone().into()), Ok(v.into()))
        }
    };
    let (from, to) = (from.unwrap_or_default(), to.unwrap_or_default());
    if from != to {
        log(&mut tx, rec.chat_id, me.id, "action_changed", &a.title, Some(field),
            change(&from, &to)).await?;
        touch(&mut tx, rec.id).await?;
        tx.commit().await?;
    }
    let rec = load(&st.pool, rec.id).await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

/// Eylem ve mesaj kaydin "hareket" siralamasini tazeler (updated_at tetikleyici).
pub async fn touch(tx: &mut sqlx::Transaction<'_, Postgres>, record_id: Uuid) -> Result<()> {
    sqlx::query("update records set updated_at = now() where id = $1")
        .bind(record_id).execute(&mut **tx).await?;
    Ok(())
}

// --- benim eylemlerim ------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct MyAction {
    id: Uuid,
    title: String,
    status: ActionStatus,
    due_date: Option<NaiveDate>,
    record_id: Uuid,
    record_title: String,
}

pub async fn my_actions(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
) -> Result<Json<Vec<MyAction>>> {
    Ok(Json(sqlx::query_as(
        "select a.id, a.title, a.status, a.due_date, a.record_id, r.title as record_title
           from actions a join records r on r.id = a.record_id
          where a.owner_id = $1 and a.status in ('open','in_progress')
          order by a.due_date nulls last, a.created_at")
        .bind(me.id).fetch_all(&st.pool).await?))
}

// --- katilimcilar ----------------------------------------------------------

/// Kayda kisi ekle (IDEMPOTENT). Yazma yetkisi ister; pasif kullanici eklenmez.
pub async fn add_participant(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, user)): Path<(String, String)>,
) -> Result<Json<Detail>> {
    let rec = load(&st.pool, common::id(&raw)?).await?;
    require_edit(&st, &me, &rec).await?;
    let uid = common::id(&user)?;
    check_user(&st.pool, Some(uid)).await?;
    let mut tx = st.pool.begin().await?;
    let added = sqlx::query(
        "insert into record_participants (record_id, user_id, added_by) values ($1, $2, $3)
         on conflict do nothing")
        .bind(rec.id).bind(uid).bind(me.id).execute(&mut *tx).await?.rows_affected();
    if added > 0 {
        touch(&mut tx, rec.id).await?;
    }
    tx.commit().await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

/// Kayittan cikar (IDEMPOTENT). Sorumlu/acan kisi katilimci listesinden
/// cikarilsa da kayitla iliskisi kalir.
pub async fn remove_participant(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, user)): Path<(String, String)>,
) -> Result<Json<Detail>> {
    let rec = load(&st.pool, common::id(&raw)?).await?;
    require_edit(&st, &me, &rec).await?;
    let uid = common::id(&user)?;
    let mut tx = st.pool.begin().await?;
    let gone = sqlx::query("delete from record_participants where record_id = $1 and user_id = $2")
        .bind(rec.id).bind(uid).execute(&mut *tx).await?.rows_affected();
    if gone > 0 {
        touch(&mut tx, rec.id).await?;
    }
    tx.commit().await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

// --- kisiye ozel: sabitleme ve kart sirasi ---------------------------------

/// Sabitle / kaldir (IDEMPOTENT). Okuma herkese acik oldugu icin yetki aranmaz.
pub async fn pin(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let rec = load(&st.pool, common::id(&raw)?).await?;
    sqlx::query("insert into record_pins (user_id, record_id) values ($1, $2) on conflict do nothing")
        .bind(me.id).bind(rec.id).execute(&st.pool).await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

pub async fn unpin(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let rec = load(&st.pool, common::id(&raw)?).await?;
    sqlx::query("delete from record_pins where user_id = $1 and record_id = $2")
        .bind(me.id).bind(rec.id).execute(&st.pool).await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

#[derive(Deserialize)]
pub struct CardOrder {
    ids: Vec<Uuid>,
}

/// Bu kayittaki kart sirami. Yetki gerekmez: yalniz benim gorunumum.
pub async fn set_card_order(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<CardOrder>,
) -> Result<Json<Detail>> {
    let rec = load(&st.pool, common::id(&raw)?).await?;
    if b.ids.len() > 200 {
        return Err(AppError::BadRequest("invalid_body"));
    }
    sqlx::query(
        "insert into card_order (user_id, record_id, card_ids) values ($1, $2, $3)
         on conflict (user_id, record_id) do update set card_ids = excluded.card_ids")
        .bind(me.id).bind(rec.id).bind(&b.ids).execute(&st.pool).await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

// --- katilma (erisim kipleri) ----------------------------------------------

/// `public`: aninda katilir. `request`/`private`: istek acar, sorumlu onaylar.
/// Zaten uyeysen bir sey yapmaz (IDEMPOTENT).
pub async fn join(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let rec = load(&st.pool, common::id(&raw)?).await?;
    if scope::can_edit_record(&st.pool, &me, &rec, &st.tree).await? {
        return Ok(Json(detail_of(&st, &me, rec).await?));
    }
    let mode: String = sqlx::query_scalar("select access_mode from records where id = $1")
        .bind(rec.id).fetch_one(&st.pool).await?;
    let mut tx = st.pool.begin().await?;
    if mode == "public" {
        sqlx::query(
            "insert into record_participants (record_id, user_id, added_by) values ($1, $2, $2)
             on conflict do nothing")
            .bind(rec.id).bind(me.id).execute(&mut *tx).await?;
        log(&mut tx, rec.chat_id, me.id, "joined", &rec.title, None, None).await?;
        touch(&mut tx, rec.id).await?;
    } else {
        // Reddedilmis istek yeniden acilabilir; bekleyen zaten bekliyor.
        let changed = sqlx::query(
            "insert into record_join_requests (record_id, user_id) values ($1, $2)
             on conflict (record_id, user_id) do update
               set status = 'pending', created_at = now(), decided_by = null
             where record_join_requests.status = 'denied'")
            .bind(rec.id).bind(me.id).execute(&mut *tx).await?.rows_affected();
        if changed > 0 {
            log(&mut tx, rec.chat_id, me.id, "join_requested", &rec.title, None, None).await?;
        }
    }
    tx.commit().await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

/// Kendi bekleyen istegimi geri cek.
pub async fn cancel_join(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let rec = load(&st.pool, common::id(&raw)?).await?;
    sqlx::query("delete from record_join_requests where record_id = $1 and user_id = $2")
        .bind(rec.id).bind(me.id).execute(&st.pool).await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

#[derive(Deserialize)]
pub struct Decision {
    approve: bool,
}

/// Karar: sorumlu, kaydi acan ya da admin. Onay kisiyi katilimci yapar.
pub async fn decide_join(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
    Path((raw, user)): Path<(String, String)>, Body(b): Body<Decision>,
) -> Result<Json<Detail>> {
    let rec = load(&st.pool, common::id(&raw)?).await?;
    if !decider(&me, &rec) {
        return Err(AppError::Forbidden);
    }
    let uid = common::id(&user)?;
    let name: String = sqlx::query_scalar(
        "select u.name from record_join_requests r join users u on u.id = r.user_id
          where r.record_id = $1 and r.user_id = $2 and r.status = 'pending'")
        .bind(rec.id).bind(uid).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;
    let mut tx = st.pool.begin().await?;
    if b.approve {
        sqlx::query("delete from record_join_requests where record_id = $1 and user_id = $2")
            .bind(rec.id).bind(uid).execute(&mut *tx).await?;
        sqlx::query(
            "insert into record_participants (record_id, user_id, added_by) values ($1, $2, $3)
             on conflict do nothing")
            .bind(rec.id).bind(uid).bind(me.id).execute(&mut *tx).await?;
        log(&mut tx, rec.chat_id, me.id, "join_approved", &name, None, None).await?;
        touch(&mut tx, rec.id).await?;
    } else {
        sqlx::query(
            "update record_join_requests set status = 'denied', decided_by = $3
              where record_id = $1 and user_id = $2")
            .bind(rec.id).bind(uid).bind(me.id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

/// Gizli kayit mi ve ben uye degil miyim: sohbet/kart/oy gibi uc noktalar bunu sorar.
pub(crate) async fn is_restricted(st: &AppState, me: &User, rec: &Record) -> Result<bool> {
    let mode: String = sqlx::query_scalar("select access_mode from records where id = $1")
        .bind(rec.id).fetch_one(&st.pool).await?;
    Ok(mode == "private" && !scope::can_edit_record(&st.pool, me, rec, &st.tree).await?)
}
