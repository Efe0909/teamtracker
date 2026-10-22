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

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres};
use uuid::Uuid;

use crate::{
    domain::{cards::{self, CardView}, common},
    db::{filters::Filters, records as db, scope},
    decision,
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

#[derive(Serialize)]
pub(crate) struct RecordSummary {
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

pub(crate) async fn list(st: &AppState, me: &User, params: HashMap<String, String>) -> Result<Vec<RecordSummary>> {
    let f = Filters::parse(&params);
    // Sorgu kilit ALTINDA kurulur, kilit birakildiktan SONRA kosar: guard
    // `.await` uzerinden tasinamaz (state.rs).
    let qb = {
        let tree = common::tree(st);
        // Sabitlenenler widget'i: yalniz benim sabitlediklerim.
        db::build_list(&f, me, &tree, params.get("pinned").is_some_and(|v| v == "true"), LIST_LIMIT)
    };
    Ok(db::list_records(&st.pool, qb).await?.into_iter().map(|r| RecordSummary {
        id: r.id, kind: r.kind, title: r.title, status: r.status, priority: r.priority,
        unit_id: r.unit_id, pillar_id: r.pillar_id, team_id: r.team_id, owner_id: r.owner_id,
        due_date: r.due_date, created_at: r.created_at, updated_at: r.updated_at,
        open_actions: r.open_actions, action_overdue: r.action_overdue, messages: r.messages, event_id: r.event_id,
    }).collect())
}

// --- ayrinti ---------------------------------------------------------------

#[derive(Serialize)]
pub(crate) struct Detail {
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
pub(crate) struct Membership {
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

#[derive(Serialize)]
pub(crate) struct JoinRequest {
    user_id: Uuid,
    created_at: chrono::DateTime<chrono::Utc>,
}

fn decider(me: &User, rec: &Record) -> bool {
    me.is_admin || rec.owner_id == Some(me.id) || rec.created_by == me.id
}

#[derive(Serialize)]
pub(crate) struct Access {
    can_edit: bool,
    /// Son tarih ayri yetenek ister (`edit_deadline`). Kayit ve eylem icin ayni.
    can_edit_deadline: bool,
}

#[derive(Serialize)]
pub(crate) struct ActionOut {
    id: Uuid,
    title: String,
    status: ActionStatus,
    /// Atananlar (birden fazla olabilir); bos = havuzda.
    owner_ids: Vec<Uuid>,
    due_date: Option<NaiveDate>,
    created_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
    closing_note: Option<String>,
}

pub(crate) async fn load(pool: &PgPool, id: Uuid) -> Result<Record> {
    Record::fetch(pool, id).await?.ok_or(AppError::NotFound)
}

pub(crate) async fn detail_of(st: &AppState, me: &User, rec: Record) -> Result<Detail> {
    let can_edit = scope::can_edit_record(&st.pool, me, &rec, &st.tree).await?;
    let mode = db::get_access_mode(&st.pool, rec.id).await?;
    let restricted = mode == "private" && !can_edit;
    let event_id = db::find_event(&st.pool, rec.id).await?;
    let can_decide = decider(me, &rec);
    let request = db::find_join_status(&st.pool, rec.id, me.id).await?;
    let requests: Vec<JoinRequest> = if can_decide {
        db::list_join_requests(&st.pool, rec.id).await?.into_iter().map(|r| JoinRequest {
            user_id: r.user_id, created_at: r.created_at,
        }).collect()
    } else {
        Vec::new()
    };
    let membership = Membership { mode, is_member: can_edit, restricted, request, can_decide, requests };
    let pinned = db::is_pinned(&st.pool, me.id, rec.id).await?;
    // Gizli kayit, uye degil: yalniz kayit satiri (baslik, aciklama, durum...) acik.
    if restricted {
        return Ok(Detail {
            record: rec, actions: Vec::new(), participants: Vec::new(), cards: Vec::new(),
            access: Access { can_edit: false, can_edit_deadline: false }, pinned, membership, event_id,
        });
    }
    let actions = db::list_actions(&st.pool, rec.id).await?.into_iter().map(|r| ActionOut {
        id: r.id, title: r.title, status: r.status, owner_ids: r.owner_ids, due_date: r.due_date,
        created_at: r.created_at, resolved_at: r.resolved_at, closing_note: r.closing_note,
    }).collect();
    let participants = db::list_participants(&st.pool, rec.id).await?;
    let can_edit_deadline = can_edit && common::has_scope(st, me, "edit_deadline").await?;
    let mut cards = cards::of_record(st, me, &rec).await?;
    // Kisiye ozel sira; listede olmayan kart (yeni) sona, kendi sirasiyla.
    let order = db::find_card_order(&st.pool, me.id, rec.id).await?;
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
pub(crate) async fn get(st: &AppState, me: &User, id: Uuid) -> Result<Detail> {
    let rec = load(&st.pool, id).await?;
    detail_of(st, me, rec).await
}

/// Sorumluyu kim degistirir (spec/75 A2). Cagiran `can_edit`'i zaten sordu.
/// Sorumlu decider ve etkinlik onaylayicisi oldugu icin her duzenleyene acik
/// degil: mevcut sorumlu, admin ya da kaydin biriminde dal editoru
/// (`edit_nodes` + dal, `NodeAccess`). Istisna: sorumlusuz kaydi duzenleyen
/// herkes KENDINE alabilir (spec/70 §3 kural 3). Etkinlikte `manage_events`
/// ayrica gecer (events.rs).
pub(crate) async fn may_set_owner(st: &AppState, me: &User, rec: &Record, to: Option<Uuid>) -> Result<bool> {
    if to == rec.owner_id || me.is_admin || rec.owner_id == Some(me.id) {
        return Ok(true);
    }
    if rec.owner_id.is_none() && to == Some(me.id) {
        return Ok(true);
    }
    let access = scope::NodeAccess::load(&st.pool, me).await?;
    Ok(access.on(&common::tree(st), rec.unit_id, scope::NodeScope::Edit))
}

/// Eylemin atananlari kayda katilimci olur (spec/75 K1): eylemi kapatabilsin,
/// gizli kayitta bildirimle sohbeti okuyup ucta 403 almasin (A3). IDEMPOTENT.
async fn add_action_owners(
    tx: &mut sqlx::Transaction<'_, Postgres>, record_id: Uuid, owners: &[Uuid], by: Uuid,
) -> Result<()> {
    db::insert_action_participants(&mut **tx, record_id, owners, by).await?;
    Ok(())
}

/// Atananlar kumesi: tekrarsiz, hepsi aktif kullanici (yoksa `unknown_user`). Sira korunur.
async fn check_owners(pool: &PgPool, ids: Vec<Uuid>) -> Result<Vec<Uuid>> {
    let mut out: Vec<Uuid> = Vec::with_capacity(ids.len());
    for id in ids {
        if !out.contains(&id) {
            out.push(id);
        }
    }
    if out.len() > 20 {
        return Err(AppError::BadRequest("too_many_owners"));
    }
    let n = db::count_active_users(pool, &out).await?;
    if n as usize != out.len() {
        return Err(AppError::BadRequest("unknown_user"));
    }
    Ok(out)
}

/// Eylemin atananlarini degistirir (sira: gelen sira); eskileri siler.
async fn set_action_owners(
    tx: &mut sqlx::Transaction<'_, Postgres>, action: Uuid, owners: &[Uuid], by: Uuid,
) -> Result<()> {
    db::set_action_owners(tx, action, owners, by).await?;
    Ok(())
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
    let ok = db::find_active_user(pool, id).await?;
    ok.map(|_| ()).ok_or(AppError::BadRequest("unknown_user"))
}

pub(crate) async fn check_team(pool: &PgPool, id: Option<Uuid>) -> Result<()> {
    let Some(id) = id else { return Ok(()) };
    let ok = db::find_team(pool, id).await?;
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
    let ok = db::find_active_pillar(pool, id).await?;
    ok.map(|_| ()).ok_or(AppError::BadRequest("invalid_pillar"))
}

pub(crate) async fn log(
    tx: &mut sqlx::Transaction<'_, Postgres>, chat_id: Uuid, actor: Uuid,
    verb: &str, subject: &str, target: Option<&str>, detail: Option<String>,
) -> Result<()> {
    db::insert_activity(&mut **tx, chat_id, actor, verb, subject, target, detail).await?;
    Ok(())
}

pub(crate) fn change(from: impl Serialize, to: impl Serialize) -> Option<String> {
    Some(serde_json::json!({ "from": from, "to": to }).to_string())
}

// --- bilgi yogunlugu (spec/76) ---------------------------------------------

/// Baslik >= 5 karakter (zorunlu alan, `text` once kirpar).
pub(crate) fn check_title(title: &str) -> Result<()> {
    common::min_chars(Some(title), common::NAME_MIN, "title_too_short")
}

/// Aciklama >= 30. Bos da kisa sayilir: yeni yazimda aciklama zorunlu.
pub(crate) fn check_description(d: Option<&str>) -> Result<()> {
    common::min_chars(Some(d.unwrap_or("")), common::DESC_MIN, "description_too_short")
}

/// Model zayif buldu, kisi yine gonderdi: kaydin akisinda iz (yoneticiler gorur).
pub(crate) async fn log_override(
    tx: &mut sqlx::Transaction<'_, Postgres>, chat_id: Uuid, actor: Uuid, subject: &str,
    field: &str, reasons: Option<Vec<&'static str>>,
) -> Result<()> {
    match reasons {
        Some(r) => log(tx, chat_id, actor, "quality_override", subject, Some(field),
            Some(serde_json::json!({ "reasons": r }).to_string())).await,
        None => Ok(()),
    }
}

/// `closed`'a gecis: not zorunlu, >= 30, model tartar. Donen: (not, override nedenleri, karar).
async fn closing(
    st: &AppState, actor: Uuid, note: Option<String>, context: &str, override_: bool, bypass_quality: bool,
) -> Result<(String, Option<Vec<&'static str>>, Option<decision::Quality>)> {
    let note = common::text(note, TEXT_MAX, "invalid_closing_note")?
        .ok_or(AppError::BadRequest("closing_note_required"))?;
    let quality = if bypass_quality {
        None
    } else {
        common::min_chars(Some(&note), common::DESC_MIN, "closing_note_too_short")?;
        let state = format!("{context}\nKapanış notu: {note}");
        let (reasons, quality) = decision::gate_with(st, actor, decision::Kind::Closing, &state, override_).await?;
        return Ok((note, reasons, Some(quality)));
    };
    Ok((note, None, quality))
}

// --- yeni kayit ------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct NewRecord {
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
    /// Model zayif bulsa da gonder (spec/76); kayitta izi kalir.
    #[serde(default)]
    quality_override: bool,
}

#[derive(Serialize)]
pub(crate) struct Created {
    id: Uuid,
}

/// Kayit acmak her aktif kullaniciya, HER birimde acik — kullanici karari
/// (2026-09-23): kulup islevsel bolumlere ayrilmis ama aralarinda kopru kurar,
/// herkes her takima is acabilir; takim uyeleri ustlenir ya da kapatir.
/// Python dal izni istiyordu (`service.new_item` 403) — BILEREK birakildi
/// (spec/90 G1). Duzenleme yetkisi ondan sonra iliski yollarindan gelir.
pub(crate) async fn create(st: &AppState, me: &User, b: NewRecord) -> Result<Created> {
    let title = common::text(Some(b.title), TITLE_MAX, "invalid_title")?
        .ok_or(AppError::BadRequest("invalid_title"))?;
    let description = common::text(b.description, TEXT_MAX, "invalid_description")?;
    let bypass_quality = common::has_scope(st, me, "bypass_text_quality").await?;
    if bypass_quality && description.is_none() {
        return Err(AppError::BadRequest("description_required"));
    }
    if !bypass_quality {
        check_title(&title)?;
        check_description(description.as_deref())?;
    }
    check_unit(st, b.unit_id)?;
    check_pillar(&st.pool, b.pillar_id).await?;
    check_team(&st.pool, b.team_id).await?;
    check_user(&st.pool, b.owner_id).await?;
    let access_mode = b.access_mode.as_deref().unwrap_or("public");
    if !matches!(access_mode, "public" | "request" | "private") {
        return Err(AppError::BadRequest("invalid_access_mode"));
    }
    // Ag cagrisi islemden ONCE: model beklenirken baglanti tutulmaz.
    let reasons = if bypass_quality {
        None
    } else {
        decision::gate(st, me.id, decision::Kind::Entry,
            &decision::entry_state(&title, description.as_deref()), b.quality_override).await?
    };

    let mut tx = st.pool.begin().await?;
    let chat_id = crate::db::chats::insert_chat(&mut *tx).await?;
    let id = db::insert_record(&mut *tx, b.unit_id, b.pillar_id, b.team_id, chat_id, b.kind,
        &title, description, b.priority.unwrap_or(Priority::Medium), b.owner_id, me.id, access_mode).await?;
    log(&mut tx, chat_id, me.id, "created", &title, None,
        change(serde_json::Value::Null, b.owner_id)).await?;
    log_override(&mut tx, chat_id, me.id, &title, "record", reasons).await?;
    for t in &b.card_types {
        cards::insert(&mut tx, id, me.id, t, None, &serde_json::Map::new()).await?;
    }
    tx.commit().await?;
    Ok(Created { id })
}

// --- alan degisimi ---------------------------------------------------------

/// Tek alan, tek istek. Deger tipi ALANA gore: gecersiz durum ya da bozuk
/// tarih serde'de duser, handler'a hic gelmez.
#[derive(Deserialize)]
#[serde(tag = "field", content = "value", rename_all = "snake_case")]
pub(crate) enum RecordPatch {
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

/// `{"field","value"}` + kapanis notu ve kalite onayi (spec/76). Not yalniz
/// `closed`'a geciste okunur; `quality_override` baslik/aciklama/notta.
#[derive(Deserialize)]
pub(crate) struct RecordPatchBody {
    #[serde(flatten)]
    patch: RecordPatch,
    #[serde(default)]
    closing_note: Option<String>,
    #[serde(default)]
    quality_override: bool,
    /// Istemcinin GORDUGU deger (alan basina; bkz. `patch`). Yoksa kontrol yok
    /// (eski istemci); `null` gecerli bir degerdir ("sorumlusuz gormustu").
    #[serde(default, deserialize_with = "present")]
    base: Option<serde_json::Value>,
}

/// `Option<Value>` icin "alan var" ayrimi: serde varsayilaninda `null` ile
/// eksik alan ikisi de `None` olur; burada `null` -> `Some(Value::Null)`.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Option<serde_json::Value>, D::Error> {
    serde_json::Value::deserialize(d).map(Some)
}

pub(crate) async fn patch(st: &AppState, me: &User, id: Uuid, body: RecordPatchBody) -> Result<Patched> {
    let rec = load(&st.pool, id).await?;
    require_edit(st, me, &rec).await?;
    let RecordPatchBody { patch: p, closing_note, quality_override, base } = body;
    let bypass_quality = common::has_scope(st, me, "bypass_text_quality").await?;
    // Kapanis notu (closed'a geciste dolu) ve model onayi atlandiysa nedenleri.
    let mut note: Option<String> = None;
    let mut reasons: Option<Vec<&'static str>> = None;
    // Modelin bu istekteki karari: yalniz degerlendirme tetiklendiyse yanita girer.
    let mut quality: Option<decision::Quality> = None;

    // (alan, yeni) — SQL db katmaninda SABIT. ESKI deger
    // burada okunmaz: islemde satir kilitlenip taze okunur (asagida).
    let (field, to): (&str, serde_json::Value) = match p {
        RecordPatch::Status(v) => {
            if matches!(v, RecordStatus::Closed) {
                let open = db::count_open_actions(&st.pool, rec.id).await?;
                if open > 0 {
                    // Kayit acik eylemi varken kapanmaz (spec/20-sema.md §3a).
                    return Err(AppError::Conflict("open_actions"));
                }
                if rec.status != "closed" {
                    let (n, r, q) = closing(st, me.id, closing_note, &format!("Kayıt: {}", rec.title),
                        quality_override, bypass_quality).await?;
                    (note, reasons, quality) = (Some(n), r, q);
                }
            }
            ("status", serde_json::to_value(v).unwrap_or_default())
        }
        RecordPatch::Priority(v) => ("priority",
            serde_json::to_value(v).unwrap_or_default()),
        RecordPatch::OwnerId(v) => {
            check_user(&st.pool, v).await?;
            if !may_set_owner(st, me, &rec, v).await? {
                return Err(AppError::Denied("owner_change_denied"));
            }
            ("owner_id",
             serde_json::to_value(v).unwrap_or_default())
        }
        RecordPatch::TeamId(v) => {
            check_team(&st.pool, v).await?;
            ("team_id",
             serde_json::to_value(v).unwrap_or_default())
        }
        RecordPatch::PillarId(v) => {
            check_pillar(&st.pool, v).await?;
            ("pillar_id",
             serde_json::to_value(v).unwrap_or_default())
        }
        RecordPatch::UnitId(v) => {
            check_unit(st, v)?;
            ("unit_id",
             serde_json::to_value(v).unwrap_or_default())
        }
        RecordPatch::DueDate(v) => {
            if !common::has_scope(st, me, "edit_deadline").await? {
                return Err(AppError::Forbidden);
            }
            ("due_date",
             serde_json::to_value(v).unwrap_or_default())
        }
        RecordPatch::AccessMode(v) => {
            // Kipi yalniz karar verenler (sorumlu, acan, admin) degistirir.
            if !decider(me, &rec) {
                return Err(AppError::Forbidden);
            }
            if !matches!(v.as_str(), "public" | "request" | "private") {
                return Err(AppError::BadRequest("invalid_access_mode"));
            }
            ("access_mode", v.into())
        }
        RecordPatch::Title(v) => {
            let v = common::text(Some(v), TITLE_MAX, "invalid_title")?
                .ok_or(AppError::BadRequest("invalid_title"))?;
            // Yalniz DEGISEN alan sinanir: eski kisa veri duzenlenene dek kalir.
            if v != rec.title && !bypass_quality {
                check_title(&v)?;
                let (r, q) = decision::gate_with(st, me.id, decision::Kind::Entry,
                    &decision::entry_state(&v, rec.description.as_deref()), quality_override).await?;
                (reasons, quality) = (r, Some(q));
            }
            ("title", v.into())
        }
        RecordPatch::Description(v) => {
            let v = common::text(v, TEXT_MAX, "invalid_description")?;
            if bypass_quality && v.is_none() {
                return Err(AppError::BadRequest("description_required"));
            }
            if v != rec.description && !bypass_quality {
                check_description(v.as_deref())?;
                let (r, q) = decision::gate_with(st, me.id, decision::Kind::Entry,
                    &decision::entry_state(&rec.title, v.as_deref()), quality_override).await?;
                (reasons, quality) = (r, Some(q));
            }
            ("description",
             serde_json::to_value(v).unwrap_or_default())
        }
    };

    // Satiri KILITLE, alanin GUNCEL degerini islemin icinde oku: yukaridaki
    // `rec` istek basinda okundu, arada baska biri yazmis olabilir. Gunluge
    // yazilan "eski" deger de buradan gelir (eskiden bayat `rec`ten geliyordu).
    let mut tx = st.pool.begin().await?;
    let from = db::lock_field(&mut *tx, rec.id, field).await?.unwrap_or_default();
    if from != to {
        // Son yazan kazanir ANCAK sessizce degil: istemci baska bir deger
        // gormusken alan degismisse 409. Ayni alana yazan ikinci kisi
        // hedef degeri zaten bulduysa (yukaridaki `from != to`) hata degil, no-op.
        if base.as_ref().is_some_and(|b| *b != from) {
            return Err(AppError::Conflict("stale_field"));
        }
        db::update_field(&mut *tx, rec.id, field, field_value(field, &to)?).await?;
        log(&mut tx, rec.chat_id, me.id, "field_changed", &rec.title, Some(field),
            change(&from, &to)).await?;
        // Kapanis notu satirda; closed'dan cikan her gecis onu siler (yeniden acma).
        if field == "status" {
            db::set_closing_note(&mut *tx, rec.id, &note).await?;
        }
        if let Some(n) = &note {
            log(&mut tx, rec.chat_id, me.id, "closing_note", &rec.title, Some("record"), Some(n.clone())).await?;
        }
        log_override(&mut tx, rec.chat_id, me.id, &rec.title,
            if note.is_some() { "closing_note" } else { field }, reasons).await?;
        // Ikizin basligi, onemi ve sorumlusu etkinlige de yazilir: iki yuz ayni
        // (spec/73 §3a). SQL sabit; deger yine sutun tipine baglanir.
        if matches!(field, "title" | "priority" | "owner_id") {
            db::update_event_field(&mut *tx, rec.id, field, field_value(field, &to)?).await?;
        }
        tx.commit().await?;
    }
    let rec = load(&st.pool, rec.id).await?;
    Ok(Patched { detail: detail_of(st, me, rec).await?, quality })
}

/// PATCH yaniti: tazelenmis `Detail` + (varsa) kalite karari. GET'te `quality` yok.
#[derive(Serialize)]
pub(crate) struct Patched {
    #[serde(flatten)]
    detail: Detail,
    #[serde(skip_serializing_if = "Option::is_none")]
    quality: Option<decision::Quality>,
}

/// JSON degeri sutun tipine geri cevirir. Enum/metin -> text, kimlik -> uuid,
/// tarih -> date; `null` her tipte NULL.
fn field_value(field: &str, v: &serde_json::Value) -> Result<(Option<String>, Option<Uuid>, Option<NaiveDate>)> {
    let s = v.as_str().map(String::from);
    Ok(match field {
        "owner_id" | "team_id" | "pillar_id" | "unit_id" => {
            (None, s.map(|s| s.parse::<Uuid>()).transpose()
                .map_err(|_| AppError::BadRequest("invalid_body"))?, None)
        }
        "due_date" => {
            (None, None, s.map(|s| s.parse::<NaiveDate>()).transpose()
                .map_err(|_| AppError::BadRequest("invalid_body"))?)
        }
        _ => (s, None, None),
    })
}

// --- eylemler --------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct NewAction {
    title: String,
    /// Birden fazla kisi atanabilir; bos = havuzda.
    #[serde(default)]
    owner_ids: Vec<Uuid>,
    #[serde(default)]
    due_date: Option<NaiveDate>,
}

pub(crate) async fn add_action(st: &AppState, me: &User, record_id: Uuid, b: NewAction) -> Result<Detail> {
    let rec = load(&st.pool, record_id).await?;
    require_edit(st, me, &rec).await?;
    let title = common::text(Some(b.title), TITLE_MAX, "invalid_title")?
        .ok_or(AppError::BadRequest("invalid_title"))?;
    let owners = check_owners(&st.pool, b.owner_ids).await?;
    if b.due_date.is_some() && !common::has_scope(st, me, "edit_deadline").await? {
        return Err(AppError::Forbidden);
    }
    let mut tx = st.pool.begin().await?;
    let action = db::insert_action(&mut *tx, rec.id, &title, me.id, b.due_date).await?;
    set_action_owners(&mut tx, action, &owners, me.id).await?;
    add_action_owners(&mut tx, rec.id, &owners, me.id).await?;
    log(&mut tx, rec.chat_id, me.id, "action_added", &title, None,
        change(serde_json::Value::Null, &owners)).await?;
    touch(&mut tx, rec.id).await?;
    tx.commit().await?;
    let rec = load(&st.pool, rec.id).await?;
    detail_of(st, me, rec).await
}

#[derive(Deserialize)]
#[serde(tag = "field", content = "value", rename_all = "snake_case")]
pub(crate) enum ActionPatch {
    Status(ActionStatus),
    OwnerIds(Vec<Uuid>),
    DueDate(Option<NaiveDate>),
    Title(String),
}

/// Kayittaki gibi: kapanis notu yalniz `closed`'a geciste (spec/76).
#[derive(Deserialize)]
pub(crate) struct ActionPatchBody {
    #[serde(flatten)]
    patch: ActionPatch,
    #[serde(default)]
    closing_note: Option<String>,
    #[serde(default)]
    quality_override: bool,
}

pub(crate) async fn patch_action(st: &AppState, me: &User, action_id: Uuid, body: ActionPatchBody) -> Result<Detail> {
    let a = db::find_action(&st.pool, action_id).await?.ok_or(AppError::NotFound)?;
    let rec = load(&st.pool, a.record_id).await?;
    require_edit(st, me, &rec).await?;
    let ActionPatchBody { patch: p, closing_note, quality_override } = body;
    let bypass_quality = common::has_scope(st, me, "bypass_text_quality").await?;

    // Model cagrisi islemden once (agda beklerken baglanti tutulmaz).
    let (note, reasons) = match p {
        ActionPatch::Status(ActionStatus::Closed) if !matches!(a.status, ActionStatus::Closed) => {
            let (n, r, _) = closing(st, me.id, closing_note,
                &format!("Eylem: {}\nKayıt: {}", a.title, rec.title), quality_override, bypass_quality).await?;
            (Some(n), r)
        }
        _ => (None, None),
    };

    let mut tx = st.pool.begin().await?;
    let (field, from, to) = match p {
        ActionPatch::Status(v) => {
            let done = matches!(v, ActionStatus::Closed | ActionStatus::Cancelled);
            // Kapatan ve zamani izde durur; yeniden acmak ikisini de siler.
            // Kapanis notu yalniz closed'a geciste dolar, baska her durum siler.
            db::set_action_status(&mut *tx, a.id, v, done, me.id, &note).await?;
            if let Some(n) = &note {
                log(&mut tx, rec.chat_id, me.id, "closing_note", &a.title, Some("action"), Some(n.clone())).await?;
            }
            log_override(&mut tx, rec.chat_id, me.id, &a.title, "closing_note", reasons).await?;
            ("status", serde_json::to_value(a.status), serde_json::to_value(v))
        }
        ActionPatch::OwnerIds(v) => {
            let v = check_owners(&st.pool, v).await?;
            set_action_owners(&mut tx, a.id, &v, me.id).await?;
            add_action_owners(&mut tx, rec.id, &v, me.id).await?;
            // Sira anlamsiz: ayni kume degisiklik sayilmaz (kayit akisina yazilmaz).
            let (mut from, mut to) = (a.owner_ids.clone(), v);
            from.sort();
            to.sort();
            ("owner_ids", serde_json::to_value(from), serde_json::to_value(to))
        }
        ActionPatch::DueDate(v) => {
            if !common::has_scope(st, me, "edit_deadline").await? {
                return Err(AppError::Forbidden);
            }
            db::set_action_due_date(&mut *tx, a.id, v).await?;
            ("due_date", serde_json::to_value(a.due_date), serde_json::to_value(v))
        }
        ActionPatch::Title(v) => {
            let v = common::text(Some(v), TITLE_MAX, "invalid_title")?
                .ok_or(AppError::BadRequest("invalid_title"))?;
            db::set_action_title(&mut *tx, a.id, &v).await?;
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
    detail_of(st, me, rec).await
}

/// Eylem ve mesaj kaydin "hareket" siralamasini tazeler (updated_at tetikleyici).
pub(crate) async fn touch(tx: &mut sqlx::Transaction<'_, Postgres>, record_id: Uuid) -> Result<()> {
    db::touch_record(&mut **tx, record_id).await?;
    Ok(())
}

// --- benim eylemlerim ------------------------------------------------------

#[derive(Serialize)]
pub(crate) struct MyAction {
    id: Uuid,
    title: String,
    status: ActionStatus,
    due_date: Option<NaiveDate>,
    record_id: Uuid,
    record_title: String,
}

pub(crate) async fn my_actions(st: &AppState, me: &User) -> Result<Vec<MyAction>> {
    Ok(db::list_my_actions(&st.pool, me.id).await?.into_iter().map(|r| MyAction {
        id: r.id, title: r.title, status: r.status, due_date: r.due_date,
        record_id: r.record_id, record_title: r.record_title,
    }).collect())
}

// --- katilimcilar ----------------------------------------------------------

/// Kayda kisi ekle (IDEMPOTENT). Yazma yetkisi ister; pasif kullanici eklenmez.
pub(crate) async fn add_participant(st: &AppState, me: &User, id: Uuid, uid: Uuid) -> Result<Detail> {
    let rec = load(&st.pool, id).await?;
    require_edit(st, me, &rec).await?;
    check_user(&st.pool, Some(uid)).await?;
    let mut tx = st.pool.begin().await?;
    let added = db::insert_participant(&mut *tx, rec.id, uid, me.id).await?;
    if added > 0 {
        touch(&mut tx, rec.id).await?;
    }
    tx.commit().await?;
    detail_of(st, me, rec).await
}

/// Kayittan cikar (IDEMPOTENT). Sorumlu/acan kisi katilimci listesinden
/// cikarilsa da kayitla iliskisi kalir.
pub(crate) async fn remove_participant(st: &AppState, me: &User, id: Uuid, uid: Uuid) -> Result<Detail> {
    let rec = load(&st.pool, id).await?;
    require_edit(st, me, &rec).await?;
    let mut tx = st.pool.begin().await?;
    let gone = db::delete_participant(&mut *tx, rec.id, uid).await?;
    if gone > 0 {
        touch(&mut tx, rec.id).await?;
    }
    tx.commit().await?;
    detail_of(st, me, rec).await
}

// --- kisiye ozel: sabitleme ve kart sirasi ---------------------------------

/// Sabitle / kaldir (IDEMPOTENT). Okuma herkese acik oldugu icin yetki aranmaz.
pub(crate) async fn pin(st: &AppState, me: &User, id: Uuid) -> Result<Detail> {
    let rec = load(&st.pool, id).await?;
    db::insert_pin(&st.pool, me.id, rec.id).await?;
    detail_of(st, me, rec).await
}

pub(crate) async fn unpin(st: &AppState, me: &User, id: Uuid) -> Result<Detail> {
    let rec = load(&st.pool, id).await?;
    db::delete_pin(&st.pool, me.id, rec.id).await?;
    detail_of(st, me, rec).await
}

#[derive(Deserialize)]
pub(crate) struct CardOrder {
    ids: Vec<Uuid>,
}

/// Bu kayittaki kart sirami. Yetki gerekmez: yalniz benim gorunumum.
pub(crate) async fn set_card_order(st: &AppState, me: &User, id: Uuid, b: CardOrder) -> Result<Detail> {
    let rec = load(&st.pool, id).await?;
    if b.ids.len() > 200 {
        return Err(AppError::BadRequest("invalid_body"));
    }
    db::upsert_card_order(&st.pool, me.id, rec.id, &b.ids).await?;
    detail_of(st, me, rec).await
}

// --- katilma (erisim kipleri) ----------------------------------------------

/// `public`: aninda katilir. `request`/`private`: istek acar, sorumlu onaylar.
/// Zaten uyeysen bir sey yapmaz (IDEMPOTENT).
pub(crate) async fn join(st: &AppState, me: &User, id: Uuid) -> Result<Detail> {
    let rec = load(&st.pool, id).await?;
    if scope::can_edit_record(&st.pool, me, &rec, &st.tree).await? {
        return detail_of(st, me, rec).await;
    }
    let mode = db::get_access_mode(&st.pool, rec.id).await?;
    let mut tx = st.pool.begin().await?;
    if mode == "public" {
        db::insert_self_participant(&mut *tx, rec.id, me.id).await?;
        log(&mut tx, rec.chat_id, me.id, "joined", &rec.title, None, None).await?;
        touch(&mut tx, rec.id).await?;
    } else {
        // Reddedilmis istek yeniden acilabilir; bekleyen zaten bekliyor.
        let changed = db::upsert_join_request(&mut *tx, rec.id, me.id).await?;
        if changed > 0 {
            log(&mut tx, rec.chat_id, me.id, "join_requested", &rec.title, None, None).await?;
        }
    }
    tx.commit().await?;
    detail_of(st, me, rec).await
}

/// Kendi bekleyen istegimi geri cek.
pub(crate) async fn cancel_join(st: &AppState, me: &User, id: Uuid) -> Result<Detail> {
    let rec = load(&st.pool, id).await?;
    db::delete_join_request(&st.pool, rec.id, me.id).await?;
    detail_of(st, me, rec).await
}

#[derive(Deserialize)]
pub(crate) struct Decision {
    approve: bool,
}

/// Karar: sorumlu, kaydi acan ya da admin. Onay kisiyi katilimci yapar.
pub(crate) async fn decide_join(st: &AppState, me: &User, id: Uuid, uid: Uuid, b: Decision) -> Result<Detail> {
    let rec = load(&st.pool, id).await?;
    if !decider(me, &rec) {
        return Err(AppError::Forbidden);
    }
    let name = db::find_requester_name(&st.pool, rec.id, uid).await?.ok_or(AppError::NotFound)?;
    let mut tx = st.pool.begin().await?;
    if b.approve {
        db::delete_join_request(&mut *tx, rec.id, uid).await?;
        db::insert_approved_participant(&mut *tx, rec.id, uid, me.id).await?;
        log(&mut tx, rec.chat_id, me.id, "join_approved", &name, None, None).await?;
        touch(&mut tx, rec.id).await?;
    } else {
        db::deny_join_request(&mut *tx, rec.id, uid, me.id).await?;
    }
    tx.commit().await?;
    detail_of(st, me, rec).await
}

/// Gizli kayit mi ve ben uye degil miyim: sohbet/kart/oy gibi uc noktalar bunu sorar.
pub(crate) async fn is_restricted(st: &AppState, me: &User, rec: &Record) -> Result<bool> {
    let mode = db::get_access_mode(&st.pool, rec.id).await?;
    Ok(mode == "private" && !scope::can_edit_record(&st.pool, me, rec, &st.tree).await?)
}

/// Kart katilimi ve oy (spec/75 K5): `public` kayitta herkes kendi adina;
/// `request` ve `private`'ta yalniz uye (onayli katilimci ya da duzenleyen).
/// `is_restricted`'tan ayri: `request` kayitta okuma acik kalir.
pub(crate) async fn may_respond(st: &AppState, me: &User, rec: &Record) -> Result<bool> {
    let mode = db::get_access_mode(&st.pool, rec.id).await?;
    Ok(mode == "public" || scope::can_edit_record(&st.pool, me, rec, &st.tree).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_govdesi_not_ve_onay_tasir() {
        let b = serde_json::from_str::<RecordPatchBody>(
            r#"{"field":"status","value":"closed","closing_note":"n","quality_override":true}"#).ok();
        assert!(b.is_some_and(|b| matches!(b.patch, RecordPatch::Status(RecordStatus::Closed))
            && b.closing_note.as_deref() == Some("n") && b.quality_override));
        let b = serde_json::from_str::<ActionPatchBody>(r#"{"field":"title","value":"x"}"#).ok();
        assert!(b.is_some_and(|b| matches!(b.patch, ActionPatch::Title(_)) && !b.quality_override));
        assert!(serde_json::from_str::<RecordPatchBody>(r#"{"field":"unknown","value":"x"}"#).is_err());
    }
}
