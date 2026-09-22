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
    api::common::{self, Body},
    auth::CurrentUser,
    db::{filters::Filters, scope},
    error::{AppError, Result},
    models::{
        enums::{ActionStatus, NodeType, Priority, RecordKind, RecordStatus},
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
                (select count(*) from messages m where m.chat_id = r.chat_id) as messages
           from records r");
    {
        let tree = common::tree(&st);
        f.push_where(&mut qb, &me, &tree);
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
    access: Access,
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

async fn load(pool: &PgPool, id: Uuid) -> Result<Record> {
    Record::fetch(pool, id).await?.ok_or(AppError::NotFound)
}

async fn detail_of(st: &AppState, me: &User, rec: Record) -> Result<Detail> {
    let actions = sqlx::query_as(
        "select id, title, status, owner_id, due_date, created_at, resolved_at
           from actions where record_id = $1
          order by (status in ('closed','cancelled')), created_at")
        .bind(rec.id).fetch_all(&st.pool).await?;
    let participants = sqlx::query_scalar(
        "select user_id from record_participants where record_id = $1 order by added_at")
        .bind(rec.id).fetch_all(&st.pool).await?;
    let can_edit = scope::can_edit_record(&st.pool, me, &rec, &st.tree).await?;
    let can_edit_deadline = can_edit && common::has_scope(st, me, "edit_deadline").await?;
    Ok(Detail { record: rec, actions, participants, access: Access { can_edit, can_edit_deadline } })
}

/// Okuma herkese acik (giris yapmis her aktif kullanici): yetki DEGISTIRMEYI
/// kapatir, gormeyi degil — Python surumuyle ayni.
pub async fn get(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Detail>> {
    let rec = load(&st.pool, common::id(&raw)?).await?;
    Ok(Json(detail_of(&st, &me, rec).await?))
}

async fn require_edit(st: &AppState, me: &User, rec: &Record) -> Result<()> {
    if scope::can_edit_record(&st.pool, me, rec, &st.tree).await? {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

// --- dogrulama yardimcilari -------------------------------------------------

async fn check_user(pool: &PgPool, id: Option<Uuid>) -> Result<()> {
    let Some(id) = id else { return Ok(()) };
    let ok: Option<i32> = sqlx::query_scalar("select 1 from users where id = $1 and is_active")
        .bind(id).fetch_optional(pool).await?;
    ok.map(|_| ()).ok_or(AppError::BadRequest("unknown_user"))
}

async fn check_team(pool: &PgPool, id: Option<Uuid>) -> Result<()> {
    let Some(id) = id else { return Ok(()) };
    let ok: Option<i32> = sqlx::query_scalar("select 1 from teams where id = $1")
        .bind(id).fetch_optional(pool).await?;
    ok.map(|_| ()).ok_or(AppError::BadRequest("unknown_team"))
}

/// Birim: aktif, `team`/`pillar` OLMAYAN dugum (spec/21 §10).
fn check_unit(st: &AppState, id: Uuid) -> Result<()> {
    let tree = common::tree(st);
    match tree.get(id) {
        Some(n) if n.is_active && n.node_type.is_unit() => Ok(()),
        _ => Err(AppError::BadRequest("invalid_unit")),
    }
}

/// Pillar ORTOGONAL: kaydin atasi olmak zorunda degil, ama `pillar` tipli
/// bir dugum OLMAK zorunda.
fn check_pillar(st: &AppState, id: Option<Uuid>) -> Result<()> {
    let Some(id) = id else { return Ok(()) };
    let tree = common::tree(st);
    match tree.get(id) {
        Some(n) if n.node_type == NodeType::Pillar => Ok(()),
        _ => Err(AppError::BadRequest("invalid_pillar")),
    }
}

async fn log(
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

fn change(from: impl Serialize, to: impl Serialize) -> Option<String> {
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
    check_pillar(&st, b.pillar_id)?;
    check_team(&st.pool, b.team_id).await?;
    check_user(&st.pool, b.owner_id).await?;

    let mut tx = st.pool.begin().await?;
    let chat_id: Uuid = sqlx::query_scalar("insert into chats default values returning id")
        .fetch_one(&mut *tx).await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into records (unit_id, pillar_id, team_id, chat_id, kind, title, description,
                              priority, owner_id, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id")
        .bind(b.unit_id).bind(b.pillar_id).bind(b.team_id).bind(chat_id).bind(b.kind)
        .bind(&title).bind(description).bind(b.priority.unwrap_or(Priority::Medium))
        .bind(b.owner_id).bind(me.id)
        .fetch_one(&mut *tx).await?;
    log(&mut tx, chat_id, me.id, "created", &title, None,
        change(serde_json::Value::Null, b.owner_id)).await?;
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
            check_pillar(&st, v)?;
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
