//! Yonetim > Veri isleme ve LLM: ayar uclari (spec/79 §11).
//!
//! Temizleme kurallari (`llm_config`), ozellik ayari (`llm_features`: model, parametre,
//! acik/kapali, govde saklama), "Dene", istem surumleri (`llm_prompts`) ve dolar
//! limitleri (`llm_limits`). Okuma uclari (kullanim, cagrilar, OpenRouter) `llm_usage.rs`.
//!
//! Erisim: admin ya da `manage_llm` (sekmenin TAMAMI, temizleme dahil). Kontrol her ucun
//! ilk satirinda. Her degisiklik `security_events`'e yazilir (govde degil, yalniz olay).

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
    llm::{self, Contract, Effective, Endpoint, Params},
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

// --- ozellikler ------------------------------------------------------------------

#[derive(Serialize)]
pub struct FeatureView {
    feature: &'static str,
    label: &'static str,
    endpoint: Endpoint,
    has_prompt: bool,
    has_batch: bool,
    default_model: String,
    /// Satirdaki ham parametreler (bos = hepsi varsayilan).
    params: Params,
    /// Varsayilanlarla birlesmis hali.
    effective: Effective,
    customized: bool,
    tested_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
    updated_by: Option<Uuid>,
    /// Anahtar ve manifest `external_off`'a gore servis acik mi ("Dene" yalniz aciksa).
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

async fn features(st: &AppState) -> Result<Json<Vec<FeatureView>>> {
    let mut out = Vec::with_capacity(llm::CONTRACTS.len());
    for c in &llm::CONTRACTS {
        let row = llm::row(&st.pool, c.feature).await?;
        out.push(FeatureView {
            feature: c.feature, label: c.label, endpoint: c.endpoint,
            has_prompt: c.prompt.is_some(), has_batch: c.has_batch,
            default_model: llm::default_model(st, c),
            params: row.as_ref().map(llm::stored_params).unwrap_or_default(),
            effective: llm::effective(st, c, row.as_ref()),
            customized: row.is_some(),
            tested_at: row.as_ref().and_then(|r| r.tested_at),
            updated_at: row.as_ref().map(|r| r.updated_at),
            updated_by: row.as_ref().and_then(|r| r.updated_by),
            service_on: llm::service_on(st, c),
            sample_input: sample(c),
        });
    }
    Ok(Json(out))
}

fn contract_of(raw: &str) -> Result<&'static Contract> {
    llm::contract(raw).ok_or(AppError::NotFound)
}

pub async fn list_features(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<FeatureView>>> {
    require(&st, &me).await?;
    features(&st).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FeatureIn {
    model: String,
    #[serde(default)]
    params: Params,
    enabled: bool,
    store_bodies: bool,
}

/// Ozellik ayarini yazar. Model DEGISIYORSA ayni ozellik + model icin son 30 dk'da gecen
/// bir "Dene" sart (spec/79 §11.4); servis kapaliyken denenemez, uyariyla (`tested_at` NULL)
/// kabul edilir.
pub async fn put_feature(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap,
    Path(raw): Path<String>, Body(b): Body<FeatureIn>,
) -> Result<Json<Vec<FeatureView>>> {
    require(&st, &me).await?;
    let c = contract_of(&raw)?;
    let model = b.model.trim().to_string();
    if !llm::valid_model(&model) {
        return Err(AppError::BadRequest("llm_model_invalid"));
    }
    b.params.validate(c).map_err(AppError::BadRequest)?;
    let row = llm::row(&st.pool, c.feature).await?;
    let current = llm::effective(&st, c, row.as_ref());
    let tested_at = if model == current.model {
        row.as_ref().and_then(|r| r.tested_at)
    } else if llm::service_on(&st, c) {
        Some(llm::tested(&st.pool, c.feature, &model, None).await?
            .ok_or(AppError::BadRequest("llm_model_untested"))?)
    } else {
        None
    };
    let params = serde_json::to_value(&b.params).map_err(|_| AppError::BadRequest("invalid_body"))?;
    sqlx::query(
        "insert into llm_features (feature, model, params, enabled, store_bodies, tested_at, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (feature) do update set model = $2, params = $3, enabled = $4, store_bodies = $5,
           tested_at = $6, updated_by = $7, updated_at = now()")
        .bind(c.feature).bind(&model).bind(params).bind(b.enabled).bind(b.store_bodies).bind(tested_at).bind(me.id)
        .execute(&st.pool).await?;
    log(&st, &headers, &me, "llm_feature_changed", &format!("{} {model}", c.feature)).await;
    if b.store_bodies != current.store_bodies {
        let ev = if b.store_bodies { "llm_bodies_on" } else { "llm_bodies_off" };
        log(&st, &headers, &me, ev, c.feature).await;
    }
    features(&st).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TryIn {
    model: String,
    #[serde(default)]
    params: Params,
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

/// Taslak model/parametre/istemle tek gercek cagri. Kaydetmez; `is_try` satiri yazilir,
/// tam iz (istek, ham cevap/hata govdesi) yalniz bu cevapta doner.
pub async fn try_feature(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<TryIn>,
) -> Result<Json<Value>> {
    require(&st, &me).await?;
    let c = contract_of(&raw)?;
    let model = b.model.trim().to_string();
    if !llm::valid_model(&model) {
        return Err(AppError::BadRequest("llm_model_invalid"));
    }
    b.params.validate(c).map_err(AppError::BadRequest)?;
    let current = llm::settings(&st, c).await;
    let mut e = Effective { enabled: true, store_bodies: false, ..Effective::resolve(c, model, &b.params) };
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

/// Surumu etkinlestirir (0 = koddaki). Etkin model ile o surumun son 30 dk'da gecen bir
/// "Dene"si sart; servis kapaliyken uyariyla kabul.
pub async fn activate_prompt(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap,
    Path(raw): Path<String>, Body(b): Body<ActiveIn>,
) -> Result<Json<PromptsView>> {
    require(&st, &me).await?;
    let (c, code) = prompt_contract(&raw)?;
    if b.version < 0 || (b.version > 0 && prompt_body(&st.pool, c.feature, b.version).await.is_err()) {
        return Err(AppError::BadRequest("llm_prompt_invalid"));
    }
    let model = llm::settings(&st, c).await.model;
    if llm::service_on(&st, c) && llm::tested(&st.pool, c.feature, &model, Some(b.version)).await?.is_none() {
        return Err(AppError::BadRequest("llm_prompt_untested"));
    }
    sqlx::query(
        "insert into llm_features (feature, model, prompt_version, updated_by) values ($1, $2, nullif($3, 0), $4)
         on conflict (feature) do update set prompt_version = nullif($3, 0), updated_by = $4, updated_at = now()")
        .bind(c.feature).bind(&model).bind(b.version).bind(me.id).execute(&st.pool).await?;
    log(&st, &headers, &me, "llm_prompt_changed", &format!("{} v{}", c.feature, b.version)).await;
    prompts(&st, c, code).await
}

// --- limitler --------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct LimitRow {
    id: Uuid,
    model: String,
    window_minutes: i32,
    usd: f64,
    /// Su anki pencerede harcanan.
    spent: f64,
    created_at: DateTime<Utc>,
}

async fn limits(st: &AppState) -> Result<Json<Vec<LimitRow>>> {
    Ok(Json(sqlx::query_as(
        "select l.id, l.model, l.window_minutes, l.usd, l.created_at,
                (select coalesce(sum(c.cost_usd), 0) from llm_calls c
                  where c.model = l.model and c.created_at > now() - make_interval(mins => l.window_minutes)) as spent
           from llm_limits l order by l.model, l.window_minutes")
        .fetch_all(&st.pool).await?))
}

pub async fn list_limits(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<LimitRow>>> {
    require(&st, &me).await?;
    limits(&st).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LimitIn {
    model: String,
    window_minutes: i32,
    usd: f64,
}

/// En kisa 15 dk, en uzun 31 gun (`llm_calls` 180 gun tutulur, pencere hep icinde kalir).
fn valid_limit(b: &LimitIn) -> bool {
    llm::valid_model(b.model.trim()) && (15..=44_640).contains(&b.window_minutes)
        && b.usd.is_finite() && b.usd > 0.0 && b.usd < 100_000.0
}

/// Ayni model + pencere varsa tavan guncellenir.
pub async fn put_limit(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(b): Body<LimitIn>,
) -> Result<Json<Vec<LimitRow>>> {
    require(&st, &me).await?;
    if !valid_limit(&b) {
        return Err(AppError::BadRequest("llm_limit_invalid"));
    }
    let model = b.model.trim();
    sqlx::query(
        "insert into llm_limits (model, window_minutes, usd, created_by) values ($1, $2, $3, $4)
         on conflict (model, window_minutes) do update set usd = $3, created_by = $4, created_at = now()")
        .bind(model).bind(b.window_minutes).bind(b.usd).bind(me.id).execute(&st.pool).await?;
    log(&st, &headers, &me, "llm_limit_changed", &format!("{model} {}dk ${}", b.window_minutes, b.usd)).await;
    limits(&st).await
}

pub async fn delete_limit(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>,
) -> Result<Json<Vec<LimitRow>>> {
    require(&st, &me).await?;
    let id = common::id(&raw)?;
    let gone: Option<(String, i32)> = sqlx::query_as(
        "delete from llm_limits where id = $1 returning model, window_minutes")
        .bind(id).fetch_optional(&st.pool).await?;
    let (model, window) = gone.ok_or(AppError::NotFound)?;
    log(&st, &headers, &me, "llm_limit_changed", &format!("{model} {window}dk silindi")).await;
    limits(&st).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limit_siniri() {
        let l = |model: &str, w: i32, usd: f64| LimitIn { model: model.into(), window_minutes: w, usd };
        assert!(valid_limit(&l("deepseek/deepseek-v4.1-flash", 15, 0.5)));
        assert!(valid_limit(&l("a/b", 44_640, 99.0)), "1 ay (31 gun) ust sinir");
        for bad in [l("a/b", 14, 1.0), l("a/b", 44_641, 1.0), l("a/b", 60, 0.0), l("a/b", 60, f64::INFINITY),
                    l("a/b", 60, -1.0), l("bogus", 60, 1.0), l("a/b", 60, 1e6)] {
            assert!(!valid_limit(&bad));
        }
    }

    #[test]
    fn bilinmeyen_alan_reddedilir() {
        assert!(serde_json::from_value::<FeatureIn>(serde_json::json!(
            { "model": "a/b", "enabled": true, "store_bodies": false, "extra": 1 })).is_err());
        assert!(serde_json::from_value::<LimitIn>(serde_json::json!(
            { "model": "a/b", "window_minutes": 60, "usd": 1, "per_user": true })).is_err());
    }
}
