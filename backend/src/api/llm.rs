//! Yonetim > Veri isleme ve LLM: ayar uclari (spec/79 §11).
//!
//! Temizleme kurallari (`llm_config`); PROFILLER (`llm_profiles`: model + parametre, profil
//! basina dolar limitleri `llm_limits`); GOREVLER (`llm_tasks`: hangi profil, parti,
//! acik/kapali, govde saklama; istem surumleri `llm_prompts`); "Dene". Okuma uclari
//! (kullanim, cagrilar, OpenRouter) `llm_usage.rs`.
//!
//! Erisim: admin ya da `manage_llm` (sekmenin TAMAMI, temizleme dahil; kalite sorulari
//! `quality.rs`'te yalniz admin). Kontrol her ucun ilk satirinda. Her degisiklik
//! `security_events`'e yazilir (govde degil, yalniz olay).

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    api::{common::{self, Body}, events},
    audit,
    auth::CurrentUser,
    decision,
    error::{AppError, Result},
    llm::{self, Contract, Effective, Endpoint, Params, ProfileRow},
    models::user::User,
    redact::LlmConfig,
    state::AppState,
};

pub const SCOPE: &str = "manage_llm";

/// Sekmenin kapisi: admin ya da `manage_llm`.
pub(crate) async fn require(st: &AppState, me: &User) -> Result<()> {
    if me.is_admin || common::has_scope(st, me, SCOPE).await? { Ok(()) } else { Err(AppError::Forbidden) }
}

async fn log(st: &AppState, headers: &HeaderMap, me: &User, event: &str, detail: &str) {
    audit::log_event(st, audit::client_ip(headers), event, Some(me.id), Some(&me.email), Some(detail)).await;
}

// --- temizleme kurallari ------------------------------------------------------------

#[derive(Serialize)]
pub struct LlmView {
    /// Su an gecerli olan.
    config: LlmConfig,
    /// Kodun varsayilani ("Varsayilana don" ve farki gostermek icin).
    defaults: LlmConfig,
    /// Duzenlenmis mi: false ise satir yok, varsayilan calisiyor.
    customized: bool,
    updated_at: Option<DateTime<Utc>>,
    updated_by: Option<Uuid>,
}

/// Gecerli yapilandirma. Satirdaki JSON okunamazsa (sema degisti) varsayilan.
pub(crate) async fn load(pool: &PgPool) -> Result<LlmConfig> {
    let row: Option<serde_json::Value> = sqlx::query_scalar("select config from llm_config")
        .fetch_optional(pool).await?;
    Ok(row.and_then(|v| serde_json::from_value(v).ok()).unwrap_or_else(LlmConfig::defaults))
}

async fn view(st: &AppState) -> Result<Json<LlmView>> {
    let row: Option<(DateTime<Utc>, Option<Uuid>)> =
        sqlx::query_as("select updated_at, updated_by from llm_config").fetch_optional(&st.pool).await?;
    Ok(Json(LlmView {
        config: load(&st.pool).await?,
        defaults: LlmConfig::defaults(),
        customized: row.is_some(),
        updated_at: row.map(|r| r.0),
        updated_by: row.and_then(|r| r.1),
    }))
}

pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<LlmView>> {
    require(&st, &me).await?;
    view(&st).await
}

pub async fn put(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(cfg): Body<LlmConfig>,
) -> Result<Json<LlmView>> {
    require(&st, &me).await?;
    let json = serde_json::to_value(&cfg).map_err(|_| AppError::BadRequest("invalid_body"))?;
    sqlx::query(
        "insert into llm_config (id, config, updated_by) values (true, $1, $2)
         on conflict (id) do update set config = $1, updated_by = $2, updated_at = now()")
        .bind(json).bind(me.id).execute(&st.pool).await?;
    audit::log_event(&st, audit::client_ip(&headers), "llm_config_changed", Some(me.id), Some(&me.email), None).await;
    view(&st).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RedactIn {
    text: String,
    /// Kaydedilmemis taslak; yoksa gecerli kurallar.
    #[serde(default)]
    config: Option<LlmConfig>,
}

/// Temizleyici "Dene"si: metin modele GITMEZ, yalniz `redact` uygulanip doner.
pub async fn redact_try(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<RedactIn>,
) -> Result<Json<Value>> {
    require(&st, &me).await?;
    if b.text.trim().is_empty() || b.text.chars().count() > 4000 {
        return Err(AppError::BadRequest("invalid_body"));
    }
    let cfg = match b.config { Some(c) => c, None => load(&st.pool).await? };
    let known = events::known_names(&st).await?;
    Ok(Json(serde_json::json!({ "text": crate::redact::redact(&b.text, &cfg.rules, &known) })))
}

/// Varsayilana don: satir silinir.
pub async fn reset(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap,
) -> Result<Json<LlmView>> {
    require(&st, &me).await?;
    sqlx::query("delete from llm_config").execute(&st.pool).await?;
    audit::log_event(&st, audit::client_ip(&headers), "llm_config_reset", Some(me.id), Some(&me.email), None).await;
    view(&st).await
}

// --- limitler --------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct LimitRow {
    id: Uuid,
    profile_id: Uuid,
    profile_name: String,
    window_minutes: i32,
    usd: f64,
    /// Su anki pencerede bu profille harcanan.
    spent: f64,
    created_at: DateTime<Utc>,
}

async fn limits_of(pool: &PgPool, profile: Option<Uuid>) -> Result<Vec<LimitRow>> {
    Ok(sqlx::query_as(
        "select l.id, l.profile_id, p.name as profile_name, l.window_minutes, l.usd, l.created_at,
                (select coalesce(sum(c.cost_usd), 0) from llm_calls c
                  where c.profile_id = l.profile_id
                    and c.created_at > now() - make_interval(mins => l.window_minutes)) as spent
           from llm_limits l join llm_profiles p on p.id = l.profile_id
          where $1::uuid is null or l.profile_id = $1
          order by p.name, l.window_minutes")
        .bind(profile).fetch_all(pool).await?)
}

/// Butun limitler (Genel'deki "en dolu limitler" karti).
pub async fn list_limits(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<LimitRow>>> {
    require(&st, &me).await?;
    Ok(Json(limits_of(&st.pool, None).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LimitIn {
    window_minutes: i32,
    usd: f64,
}

/// En kisa 15 dk, en uzun 31 gun (`llm_calls` 180 gun tutulur, pencere hep icinde kalir).
fn valid_limit(b: &LimitIn) -> bool {
    (15..=44_640).contains(&b.window_minutes) && b.usd.is_finite() && b.usd > 0.0 && b.usd < 100_000.0
}

/// Profile limit ekler; ayni pencere varsa tavan guncellenir.
pub async fn put_limit(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap,
    Path(raw): Path<String>, Body(b): Body<LimitIn>,
) -> Result<Json<ProfileView>> {
    require(&st, &me).await?;
    let p = profile_or_404(&st.pool, &raw).await?;
    if !valid_limit(&b) {
        return Err(AppError::BadRequest("llm_limit_invalid"));
    }
    sqlx::query(
        "insert into llm_limits (profile_id, window_minutes, usd, created_by) values ($1, $2, $3, $4)
         on conflict (profile_id, window_minutes) do update set usd = $3, created_by = $4, created_at = now()")
        .bind(p.id).bind(b.window_minutes).bind(b.usd).bind(me.id).execute(&st.pool).await?;
    log(&st, &headers, &me, "llm_limit_changed", &format!("{} {}dk ${}", p.name, b.window_minutes, b.usd)).await;
    Ok(Json(profile_view(&st, p).await?))
}

pub async fn delete_limit(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>,
) -> Result<Json<ProfileView>> {
    require(&st, &me).await?;
    let id = common::id(&raw)?;
    let gone: Option<(Uuid, i32)> = sqlx::query_as(
        "delete from llm_limits where id = $1 returning profile_id, window_minutes")
        .bind(id).fetch_optional(&st.pool).await?;
    let (profile_id, window) = gone.ok_or(AppError::NotFound)?;
    let p = llm::profile(&st.pool, profile_id).await?.ok_or(AppError::NotFound)?;
    log(&st, &headers, &me, "llm_limit_changed", &format!("{} {window}dk silindi", p.name)).await;
    Ok(Json(profile_view(&st, p).await?))
}

// --- profiller -------------------------------------------------------------------

#[derive(Serialize)]
pub struct ProfileView {
    id: Uuid,
    name: String,
    endpoint: Endpoint,
    model: String,
    /// Satirdaki ham parametreler (bos = hepsi varsayilan).
    params: Params,
    /// Varsayilanlarla birlesmis hali.
    effective: Effective,
    tested_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    updated_by: Option<Uuid>,
    /// Bu profile bagli gorevler (sozlesme anahtarlari).
    used_by: Vec<String>,
    limits: Vec<LimitRow>,
    /// Bu turdeki bir gorevin servisi acik mi ("Dene" yalniz aciksa).
    service_on: bool,
}

fn endpoint_on(st: &AppState, e: Endpoint) -> bool {
    llm::CONTRACTS.iter().any(|c| c.endpoint == e && llm::service_on(st, c))
}

async fn profile_view(st: &AppState, p: ProfileRow) -> Result<ProfileView> {
    let used_by = sqlx::query_scalar("select feature from llm_tasks where profile_id = $1 order by feature")
        .bind(p.id).fetch_all(&st.pool).await?;
    let limits = limits_of(&st.pool, Some(p.id)).await?;
    let endpoint = p.endpoint();
    Ok(ProfileView {
        effective: p.effective(), params: p.params(), service_on: endpoint_on(st, endpoint), endpoint,
        id: p.id, name: p.name, model: p.model, tested_at: p.tested_at, created_at: p.created_at,
        updated_at: p.updated_at, updated_by: p.updated_by, used_by, limits,
    })
}

async fn profile_or_404(pool: &PgPool, raw: &str) -> Result<ProfileRow> {
    llm::profile(pool, common::id(raw)?).await?.ok_or(AppError::NotFound)
}

async fn all_profiles(st: &AppState) -> Result<Vec<ProfileView>> {
    let rows: Vec<ProfileRow> = sqlx::query_as(
        "select id, name, endpoint, model, params, tested_at, created_at, updated_at, updated_by
           from llm_profiles order by endpoint, created_at, name")
        .fetch_all(&st.pool).await?;
    let mut out = Vec::with_capacity(rows.len());
    for p in rows {
        out.push(profile_view(st, p).await?);
    }
    Ok(out)
}

pub async fn list_profiles(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<ProfileView>>> {
    require(&st, &me).await?;
    Ok(Json(all_profiles(&st).await?))
}

pub async fn get_profile(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<ProfileView>> {
    require(&st, &me).await?;
    let p = profile_or_404(&st.pool, &raw).await?;
    Ok(Json(profile_view(&st, p).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewProfileIn {
    name: String,
    endpoint: Endpoint,
    model: String,
    #[serde(default)]
    params: Params,
}

async fn name_taken(pool: &PgPool, name: &str, except: Option<Uuid>) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "select exists (select 1 from llm_profiles where lower(name) = lower($1) and ($2::uuid is null or id <> $2))")
        .bind(name).bind(except).fetch_one(pool).await?)
}

fn check_fields(name: &str, model: &str, endpoint: Endpoint, params: &Params) -> Result<()> {
    if !llm::valid_profile_name(name) {
        return Err(AppError::BadRequest("llm_profile_name_invalid"));
    }
    if !llm::valid_model(model) {
        return Err(AppError::BadRequest("llm_model_invalid"));
    }
    params.validate(endpoint).map_err(AppError::BadRequest)
}

/// Yeni profil. Henuz hicbir gorev kullanmadigi icin "Dene" istemez; bir gorevi bu
/// profile baglamak ister (`put_task`).
pub async fn create_profile(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(b): Body<NewProfileIn>,
) -> Result<Json<ProfileView>> {
    require(&st, &me).await?;
    let (name, model) = (b.name.trim(), b.model.trim());
    check_fields(name, model, b.endpoint, &b.params)?;
    if name_taken(&st.pool, name, None).await? {
        return Err(AppError::Conflict("llm_profile_name_taken"));
    }
    let params = serde_json::to_value(&b.params).map_err(|_| AppError::BadRequest("invalid_body"))?;
    let id: Uuid = sqlx::query_scalar(
        "insert into llm_profiles (name, endpoint, model, params, updated_by) values ($1, $2, $3, $4, $5) returning id")
        .bind(name).bind(b.endpoint.key()).bind(model).bind(params).bind(me.id).fetch_one(&st.pool).await?;
    log(&st, &headers, &me, "llm_profile_changed", &format!("{name} oluşturuldu: {model}")).await;
    let p = llm::profile(&st.pool, id).await?.ok_or(AppError::NotFound)?;
    Ok(Json(profile_view(&st, p).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileIn {
    name: String,
    model: String,
    #[serde(default)]
    params: Params,
}

/// Profili yazar. Model DEGISIYORSA bu profille o model icin son 30 dk'da gecen bir
/// "Dene" sart (spec/79 §11.4); servis kapaliyken denenemez, uyariyla (`tested_at` NULL)
/// kabul edilir. Uc turu degismez (bagli gorevlerin sozlesmesi bozulmasin).
pub async fn put_profile(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap,
    Path(raw): Path<String>, Body(b): Body<ProfileIn>,
) -> Result<Json<ProfileView>> {
    require(&st, &me).await?;
    let p = profile_or_404(&st.pool, &raw).await?;
    let (name, model) = (b.name.trim(), b.model.trim());
    let endpoint = p.endpoint();
    check_fields(name, model, endpoint, &b.params)?;
    if name_taken(&st.pool, name, Some(p.id)).await? {
        return Err(AppError::Conflict("llm_profile_name_taken"));
    }
    let tested_at = if model == p.model {
        p.tested_at
    } else if endpoint_on(&st, endpoint) {
        Some(llm::tested(&st.pool, None, p.id, model, None).await?
            .ok_or(AppError::BadRequest("llm_model_untested"))?)
    } else {
        None
    };
    let params = serde_json::to_value(&b.params).map_err(|_| AppError::BadRequest("invalid_body"))?;
    sqlx::query(
        "update llm_profiles set name = $2, model = $3, params = $4, tested_at = $5, updated_by = $6, updated_at = now()
          where id = $1")
        .bind(p.id).bind(name).bind(model).bind(params).bind(tested_at).bind(me.id).execute(&st.pool).await?;
    log(&st, &headers, &me, "llm_profile_changed", &format!("{name}: {model}")).await;
    let p = llm::profile(&st.pool, p.id).await?.ok_or(AppError::NotFound)?;
    Ok(Json(profile_view(&st, p).await?))
}

/// Kullanilan profil silinemez (once gorevleri baska profile bagla).
pub async fn delete_profile(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>,
) -> Result<Json<Vec<ProfileView>>> {
    require(&st, &me).await?;
    let p = profile_or_404(&st.pool, &raw).await?;
    let used: bool = sqlx::query_scalar("select exists (select 1 from llm_tasks where profile_id = $1)")
        .bind(p.id).fetch_one(&st.pool).await?;
    if used {
        return Err(AppError::Conflict("llm_profile_in_use"));
    }
    sqlx::query("delete from llm_profiles where id = $1").bind(p.id).execute(&st.pool).await?;
    log(&st, &headers, &me, "llm_profile_changed", &format!("{} silindi", p.name)).await;
    Ok(Json(all_profiles(&st).await?))
}

// --- gorevler --------------------------------------------------------------------

#[derive(Serialize)]
pub struct ProfileBrief {
    id: Uuid,
    name: String,
    model: String,
}

#[derive(Serialize)]
pub struct TaskView {
    feature: &'static str,
    label: &'static str,
    endpoint: Endpoint,
    has_prompt: bool,
    has_batch: bool,
    /// `None` yalniz satir/profil okunamadiysa (acilis tohumu calismadi).
    profile: Option<ProfileBrief>,
    /// Satirdaki parti (NULL = varsayilan).
    batch: Option<i32>,
    effective: Effective,
    updated_at: Option<DateTime<Utc>>,
    updated_by: Option<Uuid>,
    service_on: bool,
    /// "Dene" kutusunun ornek girdisi.
    sample_input: Value,
}

fn sample(c: &Contract) -> Value {
    match c.endpoint {
        Endpoint::Chat => events::material_sample(),
        Endpoint::Decisions => serde_json::json!({
            "kind": "entry",
            "state": "Başlık: Sponsor sunumu\nAçıklama: Cuma günkü görüşme için sponsorun logosunu ve bütçe tablosunu sunuma ekle."
        }),
    }
}

fn contract_of(raw: &str) -> Result<&'static Contract> {
    llm::contract(raw).ok_or(AppError::NotFound)
}

async fn task_view(st: &AppState, c: &'static Contract) -> Result<TaskView> {
    let t = llm::task(&st.pool, c.feature).await?;
    let p = match &t { Some(t) => llm::profile(&st.pool, t.profile_id).await?, None => None };
    let effective = match (&p, &t) {
        (Some(p), Some(t)) => llm::combine(p, t),
        _ => llm::settings(st, c).await,
    };
    Ok(TaskView {
        feature: c.feature, label: c.label, endpoint: c.endpoint,
        has_prompt: c.prompt.is_some(), has_batch: c.has_batch,
        profile: p.map(|p| ProfileBrief { id: p.id, name: p.name, model: p.model }),
        batch: t.as_ref().and_then(|t| t.batch),
        effective,
        updated_at: t.as_ref().map(|t| t.updated_at),
        updated_by: t.as_ref().and_then(|t| t.updated_by),
        service_on: llm::service_on(st, c),
        sample_input: sample(c),
    })
}

pub async fn list_tasks(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<TaskView>>> {
    require(&st, &me).await?;
    let mut out = Vec::with_capacity(llm::CONTRACTS.len());
    for c in &llm::CONTRACTS {
        out.push(task_view(&st, c).await?);
    }
    Ok(Json(out))
}

pub async fn get_task(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<TaskView>> {
    require(&st, &me).await?;
    Ok(Json(task_view(&st, contract_of(&raw)?).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskIn {
    profile_id: Uuid,
    #[serde(default)]
    batch: Option<i32>,
    enabled: bool,
    store_bodies: bool,
}

/// Gorevi yazar. Profil DEGISIYORSA (yani modeli degisiyorsa) bu gorevle o profil + model
/// icin son 30 dk'da gecen bir "Dene" sart; servis kapaliyken uyariyla kabul.
pub async fn put_task(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap,
    Path(raw): Path<String>, Body(b): Body<TaskIn>,
) -> Result<Json<TaskView>> {
    require(&st, &me).await?;
    let c = contract_of(&raw)?;
    let p = llm::profile(&st.pool, b.profile_id).await?.ok_or(AppError::BadRequest("llm_profile_mismatch"))?;
    if p.endpoint() != c.endpoint {
        return Err(AppError::BadRequest("llm_profile_mismatch"));
    }
    if !llm::valid_batch(c, b.batch) {
        return Err(AppError::BadRequest("llm_params_invalid"));
    }
    let current = llm::task(&st.pool, c.feature).await?;
    let switching = current.as_ref().is_none_or(|t| t.profile_id != p.id);
    if switching && llm::service_on(&st, c)
        && llm::tested(&st.pool, Some(c.feature), p.id, &p.model, None).await?.is_none()
    {
        return Err(AppError::BadRequest("llm_profile_untested"));
    }
    sqlx::query(
        "insert into llm_tasks (feature, profile_id, batch, enabled, store_bodies, updated_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (feature) do update set profile_id = $2, batch = $3, enabled = $4, store_bodies = $5,
           updated_by = $6, updated_at = now()")
        .bind(c.feature).bind(p.id).bind(b.batch).bind(b.enabled).bind(b.store_bodies).bind(me.id)
        .execute(&st.pool).await?;
    log(&st, &headers, &me, "llm_task_changed", &format!("{} → {}", c.feature, p.name)).await;
    if b.store_bodies != current.as_ref().is_some_and(|t| t.store_bodies) {
        let ev = if b.store_bodies { "llm_bodies_on" } else { "llm_bodies_off" };
        log(&st, &headers, &me, ev, c.feature).await;
    }
    Ok(Json(task_view(&st, c).await?))
}

// --- Dene ------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TryIn {
    feature: String,
    profile_id: Uuid,
    /// Kaydedilmemis taslak; yoksa profilin modeli.
    #[serde(default)]
    model: Option<String>,
    /// Kaydedilmemis taslak; yoksa profilin parametreleri.
    #[serde(default)]
    params: Option<Params>,
    /// Kaydedilmemis taslak; yoksa gorevin partisi.
    #[serde(default)]
    batch: Option<i32>,
    /// Denenecek istem surumu (0 = koddaki); yoksa etkin olan.
    #[serde(default)]
    prompt_version: Option<i32>,
    input: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GateInput {
    kind: decision::Kind,
    state: String,
}

/// Bir gorevi bir profille (taslak model/parametre/parti/istem olabilir) tek gercek cagri.
/// Kaydetmez; `is_try` satiri yazilir (profil + model + istem: kayit kurallari buna bakar),
/// tam iz (istek, ham cevap/hata govdesi) yalniz bu cevapta doner.
pub async fn try_it(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<TryIn>,
) -> Result<Json<Value>> {
    require(&st, &me).await?;
    let c = contract_of(&b.feature)?;
    let p = llm::profile(&st.pool, b.profile_id).await?.ok_or(AppError::NotFound)?;
    if p.endpoint() != c.endpoint {
        return Err(AppError::BadRequest("llm_profile_mismatch"));
    }
    let model = b.model.as_deref().map(str::trim).unwrap_or(&p.model).to_string();
    if !llm::valid_model(&model) {
        return Err(AppError::BadRequest("llm_model_invalid"));
    }
    let params = b.params.unwrap_or_else(|| p.params());
    params.validate(c.endpoint).map_err(AppError::BadRequest)?;
    if !llm::valid_batch(c, b.batch) {
        return Err(AppError::BadRequest("llm_params_invalid"));
    }
    let current = llm::settings(&st, c).await;
    let mut e = Effective {
        profile_id: Some(p.id), profile_name: p.name.clone(), enabled: true, store_bodies: false,
        batch: b.batch.and_then(|v| u32::try_from(v).ok()).unwrap_or(current.batch),
        ..Effective::resolve(c.endpoint, model, &params)
    };
    (e.prompt_version, e.prompt) = match (c.prompt, b.prompt_version) {
        (None, _) => (0, None),
        (Some(_), None) => (current.prompt_version, current.prompt),
        (Some(_), Some(0)) => (0, None),
        (Some(_), Some(v)) => (v, Some(prompt_body(&st.pool, c.feature, v).await?)),
    };
    match c.endpoint {
        Endpoint::Chat => events::try_suggest(&st, &me, &e, b.input).await.map(Json),
        Endpoint::Decisions => {
            let g: GateInput = serde_json::from_value(b.input).map_err(|_| AppError::BadRequest("invalid_body"))?;
            if g.state.trim().is_empty() || g.state.chars().count() > 4000 {
                return Err(AppError::BadRequest("invalid_body"));
            }
            let done = decision::try_model(&st, me.id, &e, g.kind, &g.state).await;
            serde_json::to_value(llm::TryOut::of(&e.model, done)?).map(Json).map_err(|_| AppError::BadRequest("invalid_body"))
        }
    }
}

// --- istemler --------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
struct PromptRow {
    version: i32,
    body: String,
    created_by: Option<Uuid>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct PromptsView {
    feature: &'static str,
    /// Etkin surum; 0 = koddaki.
    active: i32,
    code_default: &'static str,
    /// Yeniden eskiye.
    versions: Vec<PromptRow>,
}

const PROMPT_MAX: usize = 8000;

async fn prompt_body(pool: &PgPool, feature: &str, version: i32) -> Result<String> {
    sqlx::query_scalar("select body from llm_prompts where feature = $1 and version = $2")
        .bind(feature).bind(version).fetch_optional(pool).await?
        .ok_or(AppError::BadRequest("llm_prompt_invalid"))
}

fn prompt_contract(raw: &str) -> Result<(&'static Contract, &'static str)> {
    let c = contract_of(raw)?;
    Ok((c, c.prompt.ok_or(AppError::NotFound)?))
}

async fn prompts(st: &AppState, c: &'static Contract, code_default: &'static str) -> Result<Json<PromptsView>> {
    let versions = sqlx::query_as(
        "select version, body, created_by, created_at from llm_prompts where feature = $1 order by version desc")
        .bind(c.feature).fetch_all(&st.pool).await?;
    let active = llm::settings(st, c).await.prompt_version;
    Ok(Json(PromptsView { feature: c.feature, active, code_default, versions }))
}

pub async fn get_prompts(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<PromptsView>> {
    require(&st, &me).await?;
    let (c, code) = prompt_contract(&raw)?;
    prompts(&st, c, code).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PromptIn {
    body: String,
}

/// Yeni surum (etkin DEGIL): once "Dene", sonra etkinlestir.
pub async fn add_prompt(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<PromptIn>,
) -> Result<Json<PromptsView>> {
    require(&st, &me).await?;
    let (c, code) = prompt_contract(&raw)?;
    let body = b.body.trim();
    if body.is_empty() || body.chars().count() > PROMPT_MAX {
        return Err(AppError::BadRequest("llm_prompt_invalid"));
    }
    sqlx::query(
        "insert into llm_prompts (feature, version, body, created_by)
         select $1, coalesce(max(version), 0) + 1, $2, $3 from llm_prompts where feature = $1")
        .bind(c.feature).bind(body).bind(me.id).execute(&st.pool).await?;
    prompts(&st, c, code).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActiveIn {
    version: i32,
}

/// Surumu etkinlestirir (0 = koddaki). Gorevin profili + modeli ile o surumun son 30 dk'da
/// gecen bir "Dene"si sart; servis kapaliyken uyariyla kabul.
pub async fn activate_prompt(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap,
    Path(raw): Path<String>, Body(b): Body<ActiveIn>,
) -> Result<Json<PromptsView>> {
    require(&st, &me).await?;
    let (c, code) = prompt_contract(&raw)?;
    if b.version < 0 || (b.version > 0 && prompt_body(&st.pool, c.feature, b.version).await.is_err()) {
        return Err(AppError::BadRequest("llm_prompt_invalid"));
    }
    let e = llm::settings(&st, c).await;
    let profile_id = e.profile_id.ok_or(AppError::NotFound)?;
    if llm::service_on(&st, c)
        && llm::tested(&st.pool, Some(c.feature), profile_id, &e.model, Some(b.version)).await?.is_none()
    {
        return Err(AppError::BadRequest("llm_prompt_untested"));
    }
    sqlx::query("update llm_tasks set prompt_version = nullif($2, 0), updated_by = $3, updated_at = now() where feature = $1")
        .bind(c.feature).bind(b.version).bind(me.id).execute(&st.pool).await?;
    log(&st, &headers, &me, "llm_prompt_changed", &format!("{} v{}", c.feature, b.version)).await;
    prompts(&st, c, code).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limit_siniri() {
        let l = |w: i32, usd: f64| LimitIn { window_minutes: w, usd };
        assert!(valid_limit(&l(15, 0.5)));
        assert!(valid_limit(&l(44_640, 99.0)), "1 ay (31 gun) ust sinir");
        for bad in [l(14, 1.0), l(44_641, 1.0), l(60, 0.0), l(60, f64::INFINITY), l(60, -1.0), l(60, 1e6)] {
            assert!(!valid_limit(&bad));
        }
    }

    #[test]
    fn alanlar_dogrulanir() {
        assert!(check_fields("Genel amaçlı", "a/b", Endpoint::Chat, &Params::default()).is_ok());
        assert!(check_fields(" ", "a/b", Endpoint::Chat, &Params::default()).is_err());
        assert!(check_fields("X", "bozuk", Endpoint::Chat, &Params::default()).is_err());
        let chat_only = Params { max_tokens: Some(100), ..Params::default() };
        assert!(check_fields("X", "a/b", Endpoint::Decisions, &chat_only).is_err(), "karar profili jeton almaz");
    }

    #[test]
    fn bilinmeyen_alan_reddedilir() {
        assert!(serde_json::from_value::<TaskIn>(serde_json::json!(
            { "profile_id": Uuid::nil(), "enabled": true, "store_bodies": false, "model": "a/b" })).is_err());
        assert!(serde_json::from_value::<LimitIn>(serde_json::json!(
            { "window_minutes": 60, "usd": 1, "per_user": true })).is_err());
        assert!(serde_json::from_value::<NewProfileIn>(serde_json::json!(
            { "name": "G", "endpoint": "image", "model": "a/b" })).is_err(), "kodda olmayan uc turu");
    }
}
