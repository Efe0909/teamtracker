//! Yonetim > Veri isleme ve LLM: okuma uclari (spec/79 §11.8-9).
//!
//! Kullanim (gunluk satirlar), cagri gecmisi, servis durumu, OpenRouter anahtar kullanimi
//! ve model listesi. Erisim `llm::require` (admin ya da `manage_llm`).
//!
//! Gunluk satirlar iki kaynaktan, ortusmeden: saklama sinirindan (`llm::boundary`) onceki
//! gunler `llm_usage_daily`'den (kisi yok), sonrakiler `llm_calls`'tan. Kisi ya da sonuc
//! suzgeci varken yalniz `llm_calls` (ozet kisi/sonuc tutmaz): en cok 180 gun geriye.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    db::llm_usage::{self as db, Filter},
    error::{AppError, Result},
    llm,
    openrouter,
    state::AppState,
};

// --- suzgec --------------------------------------------------------------------

#[derive(Deserialize)]
pub struct FilterIn {
    from: Option<String>,
    to: Option<String>,
    feature: Option<String>,
    model: Option<String>,
    user: Option<String>,
    /// ok | error | limit
    status: Option<String>,
    cursor: Option<String>,
}

fn date(raw: Option<&str>) -> Result<Option<NaiveDate>> {
    raw.filter(|s| !s.is_empty())
        .map(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| AppError::BadRequest("invalid_date")))
        .transpose()
}

impl Filter {
    /// Varsayilan: son 30 gun (bugun dahil).
    fn parse(q: &FilterIn, today: NaiveDate) -> Result<Self> {
        let to = date(q.to.as_deref())?.unwrap_or(today);
        let from = date(q.from.as_deref())?.unwrap_or(to - Duration::days(29));
        if from > to {
            return Err(AppError::BadRequest("invalid_date"));
        }
        let text = |v: &Option<String>| v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
        let user = match q.user.as_deref().filter(|s| !s.is_empty()) {
            Some(u) => Some(u.parse().map_err(|_| AppError::BadRequest("invalid_filter"))?),
            None => None,
        };
        let status = match q.status.as_deref().filter(|s| !s.is_empty()) {
            None => None,
            Some("ok") => Some("ok"),
            Some("error") => Some("error"),
            Some("limit") => Some("limit"),
            Some(_) => return Err(AppError::BadRequest("invalid_filter")),
        };
        Ok(Filter { from, to, feature: text(&q.feature), model: text(&q.model), user, status })
    }

    /// Ozet tablosu kullanilabilir mi (kisi/sonuc suzgeci yoksa).
    fn daily_ok(&self) -> bool {
        self.user.is_none() && self.status.is_none()
    }
}

// --- kullanim --------------------------------------------------------------------

#[derive(Serialize)]
pub struct DayRow {
    day: NaiveDate,
    feature: String,
    model: String,
    calls: i64,
    errors: i64,
    limited: i64,
    prompt_tokens: i64,
    completion_tokens: i64,
    cost_usd: f64,
    unpriced: i64,
    ms_total: i64,
}

impl DayRow {
    fn of(r: db::DayRow) -> Self {
        Self { day: r.day, feature: r.feature, model: r.model, calls: r.calls, errors: r.errors,
            limited: r.limited, prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens,
            cost_usd: r.cost_usd, unpriced: r.unpriced, ms_total: r.ms_total }
    }
}

#[derive(Serialize)]
pub struct UserRow {
    user_id: Option<Uuid>,
    calls: i64,
    errors: i64,
    cost_usd: f64,
}

#[derive(Serialize)]
pub struct UsageView {
    from: NaiveDate,
    to: NaiveDate,
    /// Bu gunden onceki satirlar ozetten (kisi kirilimi yok).
    boundary: NaiveDate,
    rows: Vec<DayRow>,
    by_user: Vec<UserRow>,
}

pub(crate) async fn usage(st: &AppState, me: &crate::models::user::User, q: FilterIn) -> Result<UsageView> {
    crate::domain::llm::require(st, me).await?;
    let f = Filter::parse(&q, llm::today(&st.pool).await?)?;
    let boundary = llm::boundary(&st.pool).await?;
    // Ozet kullanilacaksa llm_calls yalniz sinirdan itibaren (ayni gun iki kez sayilmasin).
    let calls_from = if f.daily_ok() { f.from.max(boundary) } else { f.from };
    let mut rows: Vec<DayRow> = if calls_from <= f.to {
        db::list_days(&st.pool, &f, calls_from).await?.into_iter().map(DayRow::of).collect()
    } else {
        Vec::new()
    };
    if f.daily_ok() && f.from < boundary {
        let old = db::list_daily_summaries(&st.pool, &f, boundary).await?;
        rows.extend(old.into_iter().map(DayRow::of));
    }
    rows.sort_by(|a, b| (a.day, &a.feature, &a.model).cmp(&(b.day, &b.feature, &b.model)));
    let by_user = db::list_users(&st.pool, &f).await?.into_iter().map(|r| UserRow {
        user_id: r.user_id, calls: r.calls, errors: r.errors, cost_usd: r.cost_usd,
    }).collect();
    Ok(UsageView { from: f.from, to: f.to, boundary, rows, by_user })
}

// --- cagrilar --------------------------------------------------------------------

#[derive(Serialize)]
pub struct CallRow {
    id: Uuid,
    created_at: DateTime<Utc>,
    feature: String,
    model: String,
    user_id: Option<Uuid>,
    event_id: Option<Uuid>,
    is_try: bool,
    prompt_version: Option<i32>,
    status: String,
    http_status: Option<i32>,
    error: Option<String>,
    ms: i32,
    prompt_tokens: Option<i32>,
    completion_tokens: Option<i32>,
    cost_usd: Option<f64>,
    or_gen_id: Option<String>,
    batch_id: Option<Uuid>,
    asked: Option<i32>,
    kept: Option<i32>,
    outcome: Option<String>,
    has_body: bool,
}

impl CallRow {
    fn of(r: db::CallRow) -> Self {
        Self { id: r.id, created_at: r.created_at, feature: r.feature, model: r.model,
            user_id: r.user_id, event_id: r.event_id, is_try: r.is_try, prompt_version: r.prompt_version,
            status: r.status, http_status: r.http_status, error: r.error, ms: r.ms,
            prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens, cost_usd: r.cost_usd,
            or_gen_id: r.or_gen_id, batch_id: r.batch_id, asked: r.asked, kept: r.kept,
            outcome: r.outcome, has_body: r.has_body }
    }
}

const PAGE: i64 = 50;

#[derive(Serialize)]
pub struct CallsView {
    rows: Vec<CallRow>,
    total: i64,
    /// Sonraki sayfanin imleci; yoksa son sayfa.
    next: Option<String>,
}

/// Imlec: `<rfc3339>_<uuid>` (yeniden eskiye sirada son satir).
fn cursor(raw: Option<&str>) -> Result<(Option<DateTime<Utc>>, Option<Uuid>)> {
    match raw.filter(|s| !s.is_empty()) {
        None => Ok((None, None)),
        Some(s) => {
            let (at, id) = s.rsplit_once('_').ok_or(AppError::BadRequest("invalid_filter"))?;
            let at = DateTime::parse_from_rfc3339(at).map_err(|_| AppError::BadRequest("invalid_filter"))?;
            let id = id.parse().map_err(|_| AppError::BadRequest("invalid_filter"))?;
            Ok((Some(at.with_timezone(&Utc)), Some(id)))
        }
    }
}

pub(crate) async fn calls(st: &AppState, me: &crate::models::user::User, q: FilterIn) -> Result<CallsView> {
    crate::domain::llm::require(st, me).await?;
    let f = Filter::parse(&q, llm::today(&st.pool).await?)?;
    let (at, id) = cursor(q.cursor.as_deref())?;
    let rows: Vec<CallRow> = db::list_calls(&st.pool, &f, at, id, PAGE).await?.into_iter().map(CallRow::of).collect();
    let total = db::count_calls(&st.pool, &f).await?;
    let next = (rows.len() as i64 == PAGE).then(|| rows.last().map(|r| format!("{}_{}", r.created_at.to_rfc3339(), r.id))).flatten();
    Ok(CallsView { rows, total, next })
}

#[derive(Serialize)]
pub struct CallDetail {
    #[serde(flatten)]
    call: CallRow,
    request: Option<Value>,
    response: Option<String>,
}

pub(crate) async fn call(st: &AppState, me: &crate::models::user::User, id: Uuid) -> Result<CallDetail> {
    crate::domain::llm::require(st, me).await?;
    let call = CallRow::of(db::find_call(&st.pool, id).await?.ok_or(AppError::NotFound)?);
    let body = db::find_body(&st.pool, id).await?;
    let (request, response) = match body { Some((r, s)) => (Some(r), s), None => (None, None) };
    Ok(CallDetail { call, request, response })
}

// --- durum -----------------------------------------------------------------------

#[derive(Serialize)]
pub struct ServiceState {
    feature: &'static str,
    label: &'static str,
    /// `suggest` | `decision`: manifest `external_off` anahtari.
    service: &'static str,
    on: bool,
    enabled: bool,
}

#[derive(Serialize)]
pub struct StatusView {
    key_configured: bool,
    /// Manifestte kapatilan servisler.
    external_off: Vec<String>,
    services: Vec<ServiceState>,
    calls: i64,
    bodies: i64,
    daily_rows: i64,
    oldest_call: Option<DateTime<Utc>>,
    size_bytes: i64,
    retention_days: i32,
    body_ttl_days: i32,
    boundary: NaiveDate,
}

pub(crate) async fn status(st: &AppState, me: &crate::models::user::User) -> Result<StatusView> {
    crate::domain::llm::require(st, me).await?;
    let mut services = Vec::new();
    for c in &llm::CONTRACTS {
        services.push(ServiceState {
            feature: c.feature, label: c.label, service: c.service.key(),
            on: llm::service_on(st, c), enabled: llm::settings(st, c).await.enabled,
        });
    }
    let db::StatusRow { calls, bodies, daily_rows, oldest_call, size_bytes } = db::find_status(&st.pool).await?;
    Ok(StatusView {
        key_configured: !st.cfg.decision_key.is_empty(),
        external_off: st.cfg.external_off.clone(),
        services, calls, bodies, daily_rows, oldest_call, size_bytes,
        retention_days: llm::RETENTION_DAYS, body_ttl_days: llm::BODY_TTL_DAYS,
        boundary: llm::boundary(&st.pool).await?,
    })
}

// --- OpenRouter ------------------------------------------------------------------

#[derive(Deserialize)]
pub struct RefreshIn {
    #[serde(default)]
    refresh: Option<String>,
}

#[derive(Serialize)]
pub struct KeyView {
    /// Anahtar yok ya da iki servis de kapali: OpenRouter'a gidilmedi.
    off: bool,
    error: bool,
    fetched_at: Option<DateTime<Utc>>,
    /// `GET /api/v1/key` `data`'sindan secilen alanlar (anahtarin kendisi yok).
    data: Option<Value>,
}

/// Anahtarin kullanim/limit bilgisi (5 dk onbellek). Anahtar ISTEMCIYE GITMEZ.
pub(crate) async fn key(st: &AppState, me: &crate::models::user::User, q: RefreshIn) -> Result<KeyView> {
    crate::domain::llm::require(st, me).await?;
    let any_on = llm::CONTRACTS.iter().any(|c| llm::service_on(st, c));
    if !any_on {
        return Ok(KeyView { off: true, error: false, fetched_at: None, data: None });
    }
    let got = st.llm_cache.key.get(std::time::Duration::from_secs(300), q.refresh.is_some(), || async {
        let v = openrouter::get(st, "/api/v1/key", true).await?;
        let d = v.get("data").cloned().unwrap_or(Value::Null);
        let pick = |k: &str| d.get(k).cloned().unwrap_or(Value::Null);
        Ok(serde_json::json!({
            "limit": pick("limit"), "limit_remaining": pick("limit_remaining"), "limit_reset": pick("limit_reset"),
            "usage": pick("usage"), "usage_daily": pick("usage_daily"), "usage_weekly": pick("usage_weekly"),
            "usage_monthly": pick("usage_monthly"), "is_free_tier": pick("is_free_tier"),
        }))
    }).await;
    Ok(match got {
        Ok((at, v)) => KeyView { off: false, error: false, fetched_at: Some(at), data: Some((*v).clone()) },
        Err(e) => {
            tracing::warn!("openrouter anahtar bilgisi: {e}");
            KeyView { off: false, error: true, fetched_at: None, data: None }
        }
    })
}

#[derive(Serialize)]
pub struct ModelInfo {
    id: String,
    name: String,
    context_length: Option<u64>,
    /// USD / 1M jeton; negatif ya da yoksa `None` ("onceden bilinmiyor").
    prompt_per_m: Option<f64>,
    completion_per_m: Option<f64>,
    structured_outputs: bool,
    response_format: bool,
    reasoning: bool,
}

#[derive(Serialize)]
pub struct ModelsView {
    error: bool,
    fetched_at: Option<DateTime<Utc>>,
    models: Vec<ModelInfo>,
}

/// Jeton basina USD metni -> 1M jeton basina. `-1` (yonlendirici, degisken fiyat) -> None.
fn per_million(v: Option<&Value>) -> Option<f64> {
    let p: f64 = match v? {
        Value::String(s) => s.parse().ok()?,
        Value::Number(n) => n.as_f64()?,
        _ => return None,
    };
    (p.is_finite() && p >= 0.0).then_some(p * 1_000_000.0)
}

fn model_info(m: &Value) -> Option<ModelInfo> {
    let params: Vec<&str> = m.get("supported_parameters").and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let id = m.get("id")?.as_str()?.to_string();
    Some(ModelInfo {
        name: m.get("name").and_then(Value::as_str).unwrap_or(&id).to_string(),
        context_length: m.get("context_length").and_then(Value::as_u64),
        prompt_per_m: per_million(m.pointer("/pricing/prompt")),
        completion_per_m: per_million(m.pointer("/pricing/completion")),
        structured_outputs: params.contains(&"structured_outputs"),
        response_format: params.contains(&"response_format"),
        reasoning: params.contains(&"reasoning"),
        id,
    })
}

/// OpenRouter model listesi (anahtarsiz, 1 saat onbellek). Alinamazsa sayfa cokmez.
pub(crate) async fn models(st: &AppState, me: &crate::models::user::User, q: RefreshIn) -> Result<ModelsView> {
    crate::domain::llm::require(st, me).await?;
    let got = st.llm_cache.models.get(std::time::Duration::from_secs(3600), q.refresh.is_some(), || async {
        let v = openrouter::get(st, "/api/v1/models", false).await?;
        let list: Vec<Value> = v.get("data").and_then(Value::as_array).cloned().ok_or("data yok")?;
        Ok(Value::Array(list))
    }).await;
    Ok(match got {
        Ok((at, v)) => {
            let mut models: Vec<ModelInfo> = v.as_array().map(|a| a.iter().filter_map(model_info).collect()).unwrap_or_default();
            models.sort_by(|a, b| a.id.cmp(&b.id));
            ModelsView { error: false, fetched_at: Some(at), models }
        }
        Err(e) => {
            tracing::warn!("openrouter model listesi: {e}");
            ModelsView { error: true, fetched_at: None, models: vec![] }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn q(from: Option<&str>, to: Option<&str>, status: Option<&str>) -> FilterIn {
        FilterIn { from: from.map(String::from), to: to.map(String::from), feature: None, model: None,
                   user: None, status: status.map(String::from), cursor: None }
    }

    #[test]
    fn suzgec_varsayilan_otuz_gun_ve_dogrulama() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 10).unwrap();
        let f = Filter::parse(&q(None, None, None), today).unwrap();
        assert_eq!((f.from, f.to), (NaiveDate::from_ymd_opt(2026, 9, 11).unwrap(), today));
        assert!(f.daily_ok());
        assert!(!Filter::parse(&q(None, None, Some("error")), today).unwrap().daily_ok(), "sonuc suzgeci ozeti kullanamaz");
        assert!(Filter::parse(&q(Some("2026-10-11"), Some("2026-10-10"), None), today).is_err());
        assert!(Filter::parse(&q(Some("10.10.2026"), None, None), today).is_err());
        assert!(Filter::parse(&q(None, None, Some("bogus")), today).is_err());
    }

    #[test]
    fn imlec_gidip_gelir() {
        let at = "2026-10-10T12:00:00.123456+00:00";
        let id = Uuid::new_v4();
        let (a, i) = cursor(Some(&format!("{at}_{id}"))).unwrap();
        assert_eq!((a.map(|t| t.to_rfc3339()), i), (Some(at.to_string()), Some(id)));
        assert_eq!(cursor(None).unwrap(), (None, None));
        assert!(cursor(Some("bozuk")).is_err());
    }

    #[test]
    fn model_bilgisi_fiyat_ve_uyumluluk() {
        let m = model_info(&json!({ "id": "deepseek/deepseek-v4.1-flash", "context_length": 1048576,
            "pricing": { "prompt": "0.0000003", "completion": "0.0000012" },
            "supported_parameters": ["max_tokens", "reasoning", "response_format", "structured_outputs"] })).unwrap();
        assert_eq!(m.name, "deepseek/deepseek-v4.1-flash", "ad yoksa kimlik");
        assert!((m.prompt_per_m.unwrap() - 0.3).abs() < 1e-9 && (m.completion_per_m.unwrap() - 1.2).abs() < 1e-9);
        assert!(m.structured_outputs && m.response_format && m.reasoning);
        let r = model_info(&json!({ "id": "typesafe/jev-router", "pricing": { "prompt": "-1", "completion": "-1" },
            "supported_parameters": [] })).unwrap();
        assert_eq!((r.prompt_per_m, r.structured_outputs), (None, false), "degisken fiyat bilinmiyor");
        assert!(model_info(&json!({ "name": "kimliksiz" })).is_none());
    }
}
