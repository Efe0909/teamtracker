//! Uretken yapay zeka cagrilarinin TEK yolu (spec/79 §11).
//!
//! Ozellik (feature) KODDA bir sozlesmedir: adi, uc turu (`chat` / `decisions`), cevap
//! semasi ve sunucu suzgeci. Model adi, parametreler, istem, acik/kapali ve govde saklama
//! VERIDIR (`llm_features`, `llm_prompts`); satir yoksa kodun ve manifestin varsayilani.
//! Kod model adi bilmez: her model "takilip cikarilir", uyumlulugu yonetimdeki "Dene" kanitlar.
//!
//! Her cagri `run`'dan gecer: servis kapisi -> limit -> istek -> `llm_calls` satiri
//! (basarisiz ve ucret dogmus olanlar dahil) -> (aciksa) govde. Servis kapaliyken satir
//! yazilmaz (cagri yok, ucret yok).

use std::{
    future::Future,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{config::Service, openrouter, state::AppState};

pub const SUGGEST: &str = "material_suggestions";
pub const GATE: &str = "quality_gate";

/// Gun sinirlari Turkiye saatiyle (grafikteki "bugun" kullanicinin bugunu).
pub const TZ: &str = "Europe/Istanbul";
/// `llm_calls` satiri bu kadar gun tutulur; gunluk ozet (`llm_usage_daily`) kalici.
pub const RETENTION_DAYS: i32 = 180;
/// `llm_call_bodies` bu kadar gun tutulur.
pub const BODY_TTL_DAYS: i32 = 7;
/// Model ya da istem degisikligi bu kadar dakika icindeki basarili bir "Dene" ister.
pub const TESTED_WITHIN_MIN: i32 = 30;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Endpoint {
    /// `/api/v1/chat/completions` + `json_schema` (her sohbet modeli).
    Chat,
    /// `/api/alpha/decisions` + `noul` (karar modeli, spec/76).
    Decisions,
}

pub struct Contract {
    pub feature: &'static str,
    /// Ekranda gorunen ad.
    pub label: &'static str,
    pub endpoint: Endpoint,
    /// Kill switch (manifest `external_off`) ve anahtar kapisi.
    pub service: Service,
    /// Koddaki istem; `None` ise ozelligin duzenlenir istemi yok (kapinin "istemi" kalite sorulari).
    pub prompt: Option<&'static str>,
    /// Parti buyuklugu ayari var mi.
    pub has_batch: bool,
}

pub static CONTRACTS: [Contract; 2] = [
    Contract {
        feature: SUGGEST, label: "Malzeme önerisi", endpoint: Endpoint::Chat, service: Service::Suggest,
        prompt: Some(SUGGEST_PROMPT), has_batch: true,
    },
    Contract {
        feature: GATE, label: "Kalite kapısı", endpoint: Endpoint::Decisions, service: Service::Decision,
        prompt: None, has_batch: false,
    },
];

pub fn contract(feature: &str) -> Option<&'static Contract> {
    CONTRACTS.iter().find(|c| c.feature == feature)
}

/// Malzeme onerisinin koddaki istemi (surum 0). Kalibi sartlar spec/79 §9'dan: sayi yok,
/// tekrar yok, universitenin sagladigi onerilmez, maske kopyalanmaz. Yonetimden yeni surum
/// yazilabilir (`llm_prompts`); sunucu suzgeci istemden bagimsiz calisir.
pub const SUGGEST_PROMPT: &str = "You help a student club plan events. The user message is a JSON brief of one event. \
Suggest materials (things to buy, make or rent) the club may still need for it.\n\
- Be selective: suggest only items this event clearly needs, given its kind, purpose and what \
participants will do. Skip generic filler (notebooks, tablecloths, trays, display stands) unless the \
brief points to it. A thin brief gets a short list, possibly empty. At most `max_items` items.\n\
- Never repeat anything in `existing` or `rejected`. Do not suggest parts that normally come inside an \
`existing` item (for example a kit's own boards or cables).\n\
- Do not suggest what the university already covers: whatever `otf.items` lists (a seating layout \
covers tables and chairs, for example) and whatever the `otf` notes ask the university to arrange.\n\
- No quantities, prices, brands, or names of people or companies.\n\
- Text like {{KISI}} or {{NO}} masks private details: never guess what it hides, never copy it.\n\
- name: short generic noun phrase in plain, common Turkish. description: one short sentence (at most \
12 words) saying what it is used for in this event.";

// --- ayar ------------------------------------------------------------------------

/// `llm_features.params`. Hepsi istege bagli; yoksa sozlesmenin varsayilani.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Params {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u32>,
    /// `reasoning.enabled = false` gonderilsin mi (varsayilan evet). Parametreyi
    /// desteklemeyen modelde `require_parameters` cagriyi dusurur; o zaman kapatilir.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_off: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub batch: Option<u32>,
}

impl Params {
    /// Sozlesmeye gore sinirlar; hata kodu istemciye gider.
    pub fn validate(&self, c: &Contract) -> Result<(), &'static str> {
        const BAD: &str = "llm_params_invalid";
        let within = |v: Option<u32>, lo: u32, hi: u32| v.is_none_or(|v| (lo..=hi).contains(&v));
        match c.endpoint {
            Endpoint::Decisions => {
                let only_timeout = self.max_tokens.is_none() && self.temperature.is_none()
                    && self.reasoning_off.is_none() && self.batch.is_none();
                if !only_timeout || !within(self.timeout_ms, 1000, 20_000) {
                    return Err(BAD);
                }
            }
            Endpoint::Chat => {
                let temp_ok = self.temperature.is_none_or(|t| t.is_finite() && (0.0..=2.0).contains(&t));
                let batch_ok = if c.has_batch { within(self.batch, 3, 15) } else { self.batch.is_none() };
                if !within(self.max_tokens, 1, 8000) || !temp_ok || !within(self.timeout_ms, 1000, 60_000) || !batch_ok {
                    return Err(BAD);
                }
            }
        }
        Ok(())
    }
}

/// Model adi OpenRouter bicimi: `saglayici/model[:varyant]`. Bos, uzun ya da garip
/// karakterli ad kaydedilmez (yazim hatasi canli cagriyi bozmasin).
pub fn valid_model(m: &str) -> bool {
    !m.is_empty() && m.len() <= 200
        && m.chars().all(|c| c.is_ascii_alphanumeric() || "/._:-".contains(c))
        && m.contains('/')
}

/// Gecerli (etkin) ayar: satir + varsayilanlar.
#[derive(Clone, Debug, Serialize)]
pub struct Effective {
    pub model: String,
    pub max_tokens: u32,
    pub temperature: Option<f64>,
    pub timeout_ms: u32,
    pub reasoning_off: bool,
    pub batch: u32,
    pub enabled: bool,
    pub store_bodies: bool,
    /// 0 = koddaki istem.
    pub prompt_version: i32,
    /// `None` = koddaki istem.
    #[serde(skip)]
    pub prompt: Option<String>,
}

impl Effective {
    pub fn resolve(c: &Contract, model: String, p: &Params) -> Self {
        let (timeout, max_tokens) = match c.endpoint {
            Endpoint::Chat => (30_000, 1500),
            Endpoint::Decisions => (3000, 0),
        };
        Effective {
            model,
            max_tokens: p.max_tokens.unwrap_or(max_tokens),
            temperature: p.temperature,
            timeout_ms: p.timeout_ms.unwrap_or(timeout),
            reasoning_off: p.reasoning_off.unwrap_or(true),
            batch: p.batch.unwrap_or(9),
            enabled: true,
            store_bodies: false,
            prompt_version: 0,
            prompt: None,
        }
    }

    pub fn system(&self, c: &Contract) -> Option<String> {
        self.prompt.clone().or_else(|| c.prompt.map(String::from))
    }

    pub fn timeout(&self) -> Duration {
        Duration::from_millis(u64::from(self.timeout_ms))
    }
}

pub fn default_model(st: &AppState, c: &Contract) -> String {
    match c.endpoint {
        Endpoint::Chat => st.cfg.suggest_model.clone(),
        Endpoint::Decisions => st.cfg.decision_model.clone(),
    }
}

#[derive(sqlx::FromRow)]
pub struct FeatureRow {
    pub model: String,
    pub params: Value,
    pub enabled: bool,
    pub store_bodies: bool,
    pub prompt_version: Option<i32>,
    pub prompt: Option<String>,
    pub tested_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    pub updated_by: Option<Uuid>,
}

pub async fn row(pool: &PgPool, feature: &str) -> Result<Option<FeatureRow>, sqlx::Error> {
    sqlx::query_as(
        "select f.model, f.params, f.enabled, f.store_bodies, f.prompt_version, p.body as prompt,
                f.tested_at, f.updated_at, f.updated_by
           from llm_features f
           left join llm_prompts p on p.feature = f.feature and p.version = f.prompt_version
          where f.feature = $1")
        .bind(feature).fetch_optional(pool).await
}

/// Satirdaki parametreler okunamazsa (sema degisti) varsayilan: cagri dusmesin.
pub fn stored_params(r: &FeatureRow) -> Params {
    serde_json::from_value(r.params.clone()).unwrap_or_else(|_| {
        tracing::warn!("llm_features.params okunamadi: varsayilanlar kullaniliyor");
        Params::default()
    })
}

pub fn effective(st: &AppState, c: &Contract, r: Option<&FeatureRow>) -> Effective {
    match r {
        None => Effective::resolve(c, default_model(st, c), &Params::default()),
        Some(r) => Effective {
            enabled: r.enabled,
            store_bodies: r.store_bodies,
            prompt_version: r.prompt_version.unwrap_or(0),
            prompt: r.prompt.clone(),
            ..Effective::resolve(c, r.model.clone(), &stored_params(r))
        },
    }
}

/// Cagri aninda gecerli ayar. DB okunamazsa varsayilan (cagiran yine dener; kayit da
/// zaten yazilamayacak, loga duser).
pub async fn settings(st: &AppState, c: &Contract) -> Effective {
    match row(&st.pool, c.feature).await {
        Ok(r) => effective(st, c, r.as_ref()),
        Err(e) => {
            tracing::error!("llm_features okunamadi: {e}");
            effective(st, c, None)
        }
    }
}

pub fn service_on(st: &AppState, c: &Contract) -> bool {
    st.cfg.external_on(c.service)
}

/// DB'de kapatilmis ozelliklerin servis anahtarlari (`/api/meta` `external_off`'a eklenir:
/// on yuz kapali ozelligi cizmesin).
pub async fn disabled_services(pool: &PgPool) -> Result<Vec<&'static str>, sqlx::Error> {
    let off: Vec<String> = sqlx::query_scalar("select feature from llm_features where not enabled")
        .fetch_all(pool).await?;
    Ok(off.iter().filter_map(|f| contract(f)).map(|c| c.service.key()).collect())
}

/// Modelin herhangi bir penceresinde harcama tavana ulasti mi (spec/79 §11.3). Kayan
/// pencere, toplam DB'den: cok surecte de dogru. Maliyeti NULL cagri 0 sayilir.
pub async fn over_limit(pool: &PgPool, model: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists (
           select 1 from llm_limits l
            where l.model = $1
              and l.usd <= (select coalesce(sum(c.cost_usd), 0) from llm_calls c
                             where c.model = $1 and c.created_at > now() - make_interval(mins => l.window_minutes)))")
        .bind(model).fetch_one(pool).await
}

/// Son `TESTED_WITHIN_MIN` dakikadaki basarili "Dene"nin zamani. `prompt_version` verilirse
/// o istemle yapilmis olmali.
pub async fn tested(
    pool: &PgPool, feature: &str, model: &str, prompt_version: Option<i32>,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(
        "select max(created_at) from llm_calls
          where is_try and status = 'ok' and feature = $1 and model = $2
            and ($3::int is null or coalesce(prompt_version, 0) = $3)
            and created_at > now() - make_interval(mins => $4)")
        .bind(feature).bind(model).bind(prompt_version).bind(TESTED_WITHIN_MIN)
        .fetch_one(pool).await
}

// --- cagri -------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Ok,
    /// Harcama tavani: cagri YAPILMADI.
    Limit,
    /// Saglayici 2xx disi dondu (ucret dogmus olabilir).
    Http,
    Timeout,
    Network,
    /// Cevap JSON degil ya da icerik bos/kesik.
    Parse,
    /// Cevap JSON ama sozlesmenin semasina uymuyor.
    Schema,
}

impl Status {
    pub fn key(self) -> &'static str {
        match self {
            Status::Ok => "ok", Status::Limit => "limit", Status::Http => "http", Status::Timeout => "timeout",
            Status::Network => "network", Status::Parse => "parse", Status::Schema => "schema",
        }
    }
}

/// Kim, hangi baglamda.
#[derive(Clone, Copy)]
pub struct Who {
    pub user_id: Option<Uuid>,
    pub event_id: Option<Uuid>,
    pub is_try: bool,
}

/// Bir cagrinin izi: `llm_calls` satiri ve "Dene" cevabi.
#[derive(Debug, Serialize)]
pub struct Trace {
    pub call_id: Option<Uuid>,
    pub status: Status,
    pub http_status: Option<u16>,
    pub error: Option<String>,
    pub ms: u64,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
    pub or_gen_id: Option<String>,
    pub asked: Option<i32>,
    pub kept: Option<i32>,
    pub outcome: Option<&'static str>,
    /// Gonderilen istek (anahtar yok). Yalniz "Dene" cevabinda ve govde saklamada.
    #[serde(skip)]
    pub request: Value,
    /// Ham cevap ya da hata govdesi (en cok `RAW_MAX`). Ayni kosulla.
    #[serde(skip)]
    pub raw: String,
}

/// Sozlesmenin cevap cozucusunun sonucu.
pub struct Parsed<T> {
    pub value: T,
    pub asked: Option<i32>,
    pub kept: Option<i32>,
    pub outcome: Option<&'static str>,
}

impl<T> Parsed<T> {
    pub fn plain(value: T) -> Self {
        Parsed { value, asked: None, kept: None, outcome: None }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Fail {
    /// Anahtar yok ya da manifest `external_off`: cagri yok, satir yok.
    Off,
    /// Yonetimden kapatilmis: cagri yok, satir yok.
    Disabled,
    /// Harcama tavani doldu: cagri yok, `limit` satiri var.
    Limit,
    /// Cagri yapildi, sonuc alinamadi; satir var.
    Failed,
}

pub struct Done<T> {
    pub result: Result<T, Fail>,
    pub trace: Option<Trace>,
}

/// Tek cagri yolu. `parse` saglayici cevabini (JSON) sozlesmeye gore cozer; hata turu
/// `Parse` ya da `Schema`. "Dene" (`who.is_try`) kapali ozellikte de calisir, limite
/// takilmaz ama harcamaya sayilir, govdesi saklanmaz (cevapta doner).
pub async fn run<T>(
    st: &AppState, c: &Contract, e: &Effective, who: Who, batch_id: Option<Uuid>, body: Value,
    parse: impl FnOnce(&Value) -> Result<Parsed<T>, Status>,
) -> Done<T> {
    let none = |f| Done { result: Err(f), trace: None };
    if !service_on(st, c) {
        return none(Fail::Off);
    }
    if !e.enabled && !who.is_try {
        return none(Fail::Disabled);
    }
    let prompt_version = (c.endpoint == Endpoint::Chat).then_some(e.prompt_version);
    if !who.is_try {
        match over_limit(&st.pool, &e.model).await {
            Ok(false) => {}
            Ok(true) => {
                let mut t = trace(Status::Limit, None, 0, body);
                t.error = Some("harcama tavanı doldu".into());
                record(st, c, e, who, prompt_version, batch_id, &mut t).await;
                return Done { result: Err(Fail::Limit), trace: Some(t) };
            }
            Err(err) => {
                // Tavan okunamiyorsa harcamaya izin verme.
                tracing::error!("llm limiti okunamadi: {err}");
                return none(Fail::Failed);
            }
        }
    }
    let path = match c.endpoint { Endpoint::Chat => openrouter::CHAT, Endpoint::Decisions => openrouter::DECISIONS };
    let timeout = if who.is_try { e.timeout().max(Duration::from_secs(20)) } else { e.timeout() };
    let sent = openrouter::post(st, path, &body, timeout).await;
    let mut t = trace(Status::Ok, sent.http_status, sent.ms, body);
    t.raw = openrouter::clip(&sent.raw, openrouter::RAW_MAX);
    let json: Option<Value> = serde_json::from_str(&sent.raw).ok();
    if let Some(j) = &json {
        // Maliyet cevap semaya uymasa da dogar: kullanim her durumda okunur.
        let u = openrouter::usage(j);
        (t.or_gen_id, t.prompt_tokens, t.completion_tokens, t.cost_usd) = (u.id, u.prompt_tokens, u.completion_tokens, u.cost);
    }
    let result = match (sent.fail, json) {
        (Some(f), _) => {
            t.status = f;
            t.error = openrouter::error_text(&sent.raw);
            Err(Fail::Failed)
        }
        (None, None) => {
            t.status = Status::Parse;
            t.error = Some("yanıt JSON değil".into());
            Err(Fail::Failed)
        }
        (None, Some(j)) => match parse(&j) {
            Ok(p) => {
                (t.asked, t.kept, t.outcome) = (p.asked, p.kept, p.outcome);
                Ok(p.value)
            }
            Err(s) => {
                t.status = s;
                // 200 icinde `error` nesnesi (saglayici ortada dustu) varsa onu yaz.
                t.error = openrouter::error_text(&sent.raw).filter(|_| j.get("error").is_some())
                    .or_else(|| Some(if s == Status::Schema { "yanıt sözleşmenin şemasına uymuyor" } else { "yanıt boş ya da kesik" }.into()));
                Err(Fail::Failed)
            }
        },
    };
    // Icerik loglanmaz: yalniz durum, sure, kullanim.
    tracing::info!(feature = c.feature, model = %e.model, status = t.status.key(), http = ?t.http_status,
        ms = t.ms, tokens_in = ?t.prompt_tokens, tokens_out = ?t.completion_tokens, cost_usd = ?t.cost_usd,
        is_try = who.is_try, "llm cagrisi");
    record(st, c, e, who, prompt_version, batch_id, &mut t).await;
    Done { result, trace: Some(t) }
}

fn trace(status: Status, http_status: Option<u16>, ms: u64, request: Value) -> Trace {
    Trace {
        call_id: None, status, http_status, error: None, ms, prompt_tokens: None, completion_tokens: None,
        cost_usd: None, or_gen_id: None, asked: None, kept: None, outcome: None, request, raw: String::new(),
    }
}

/// `llm_calls` satiri (+ aciksa govde). Yazilamazsa istek DUSMEZ, loga yazilir.
async fn record(
    st: &AppState, c: &Contract, e: &Effective, who: Who, prompt_version: Option<i32>,
    batch_id: Option<Uuid>, t: &mut Trace,
) {
    let to_i32 = |v: Option<u64>| v.and_then(|v| i32::try_from(v).ok());
    let id: Result<Uuid, _> = sqlx::query_scalar(
        "insert into llm_calls (feature, model, user_id, event_id, is_try, prompt_version, status,
                                http_status, error, ms, prompt_tokens, completion_tokens, cost_usd,
                                or_gen_id, batch_id, asked, kept, outcome)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         returning id")
        .bind(c.feature).bind(&e.model).bind(who.user_id).bind(who.event_id).bind(who.is_try)
        .bind(prompt_version).bind(t.status.key()).bind(t.http_status.map(i32::from)).bind(&t.error)
        .bind(i32::try_from(t.ms).unwrap_or(i32::MAX)).bind(to_i32(t.prompt_tokens)).bind(to_i32(t.completion_tokens))
        .bind(t.cost_usd).bind(&t.or_gen_id).bind(batch_id).bind(t.asked).bind(t.kept).bind(t.outcome)
        .fetch_one(&st.pool).await;
    let id = match id {
        Ok(id) => id,
        Err(err) => {
            tracing::error!("llm_calls yazilamadi: {err}");
            return;
        }
    };
    t.call_id = Some(id);
    if e.store_bodies && !who.is_try && t.status != Status::Limit {
        let raw = (!t.raw.is_empty()).then_some(&t.raw);
        if let Err(err) = sqlx::query("insert into llm_call_bodies (call_id, request, response) values ($1, $2, $3)")
            .bind(id).bind(&t.request).bind(raw).execute(&st.pool).await
        {
            tracing::error!("llm_call_bodies yazilamadi: {err}");
        }
    }
}

/// "Dene" cevabi: iz + cozulmus cikti + tam istek/cevap (saklanmaz).
#[derive(Serialize)]
pub struct TryOut {
    pub ok: bool,
    pub model: String,
    pub trace: Option<Trace>,
    pub output: Option<Value>,
    pub request: Option<Value>,
    pub raw: Option<String>,
}

impl TryOut {
    pub fn of(model: &str, done: Done<Value>) -> Result<Self, crate::error::AppError> {
        if matches!(done.result, Err(Fail::Off)) {
            return Err(crate::error::AppError::Unavailable("llm_service_off"));
        }
        let (request, raw) = match &done.trace {
            Some(t) => (Some(t.request.clone()), Some(t.raw.clone()).filter(|r| !r.is_empty())),
            None => (None, None),
        };
        Ok(TryOut {
            ok: done.result.is_ok(), model: model.to_string(), output: done.result.ok(),
            trace: done.trace, request, raw,
        })
    }
}

// --- saklama ---------------------------------------------------------------------

/// Gece supurmesi (main.rs): saklanan her kapali gunu `llm_usage_daily`'ye yeniden yazar
/// (tekrar kosmasi guvenli), sonra suresi dolan satirlari ve govdeleri siler. Silme gun
/// sinirinda: bir gun ya tamamen `llm_calls`'ta ya tamamen ozette.
pub async fn sweep(pool: &PgPool) -> Result<(u64, u64), sqlx::Error> {
    sqlx::query(
        "insert into llm_usage_daily (day, feature, model, calls, errors, prompt_tokens, completion_tokens,
                                      cost_usd, unpriced, ms_total)
         select (created_at at time zone $1)::date, feature, model,
                count(*), count(*) filter (where status <> 'ok'),
                coalesce(sum(prompt_tokens), 0), coalesce(sum(completion_tokens), 0),
                coalesce(sum(cost_usd), 0), count(*) filter (where cost_usd is null), coalesce(sum(ms), 0)
           from llm_calls
          where status <> 'limit' and (created_at at time zone $1)::date < (now() at time zone $1)::date
          group by 1, 2, 3
         on conflict (day, feature, model) do update set
           calls = excluded.calls, errors = excluded.errors, prompt_tokens = excluded.prompt_tokens,
           completion_tokens = excluded.completion_tokens, cost_usd = excluded.cost_usd,
           unpriced = excluded.unpriced, ms_total = excluded.ms_total")
        .bind(TZ).execute(pool).await?;
    let calls = sqlx::query("delete from llm_calls where (created_at at time zone $1)::date < $2")
        .bind(TZ).bind(boundary(pool).await?).execute(pool).await?.rows_affected();
    let bodies = sqlx::query("delete from llm_call_bodies where created_at < now() - make_interval(days => $1)")
        .bind(BODY_TTL_DAYS).execute(pool).await?.rows_affected();
    Ok((calls, bodies))
}

/// Saklama siniri: bu gunden onceki gunler yalniz `llm_usage_daily`'de.
pub async fn boundary(pool: &PgPool) -> Result<chrono::NaiveDate, sqlx::Error> {
    sqlx::query_scalar("select (now() at time zone $1)::date - $2::int")
        .bind(TZ).bind(RETENTION_DAYS).fetch_one(pool).await
}

pub async fn today(pool: &PgPool) -> Result<chrono::NaiveDate, sqlx::Error> {
    sqlx::query_scalar("select (now() at time zone $1)::date").bind(TZ).fetch_one(pool).await
}

// --- yonetim okumalari icin onbellek -------------------------------------------------

/// OpenRouter model listesi (1 saat) ve anahtar kullanimi (5 dk). Her sayfa acilisinda
/// OpenRouter'a gidilmesin. Kilit await boyunca tutulmaz.
#[derive(Default)]
pub struct Cache {
    pub models: Slot,
    pub key: Slot,
}

/// Ne zaman alindi (yas icin `Instant`, ekran icin `DateTime`) ve deger.
type Held = (Instant, DateTime<Utc>, Arc<Value>);

#[derive(Default)]
pub struct Slot(Mutex<Option<Held>>);

impl Slot {
    pub async fn get<F: Future<Output = Result<Value, String>>>(
        &self, ttl: Duration, refresh: bool, fetch: impl FnOnce() -> F,
    ) -> Result<(DateTime<Utc>, Arc<Value>), String> {
        if !refresh {
            let held = self.0.lock().unwrap_or_else(|e| e.into_inner()).clone();
            if let Some((_, when, v)) = held.filter(|(at, _, _)| at.elapsed() < ttl) {
                return Ok((when, v));
            }
        }
        let v = Arc::new(fetch().await?);
        let now = Utc::now();
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), now, v.clone()));
        Ok((now, v))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chat() -> &'static Contract {
        contract(SUGGEST).unwrap_or(&CONTRACTS[0])
    }
    fn gate() -> &'static Contract {
        contract(GATE).unwrap_or(&CONTRACTS[1])
    }

    #[test]
    fn sozlesmeler_tekil_ve_bulunur() {
        assert_eq!(contract(SUGGEST).map(|c| c.endpoint), Some(Endpoint::Chat));
        assert_eq!(contract(GATE).map(|c| c.endpoint), Some(Endpoint::Decisions));
        assert!(contract("bogus").is_none());
        assert!(gate().prompt.is_none(), "kapinin istemi kalite sorulari, burada degil");
    }

    #[test]
    fn parametre_sinirlari_sozlesmeye_gore() {
        let ok = Params { max_tokens: Some(2000), temperature: Some(0.3), timeout_ms: Some(20_000), reasoning_off: Some(false), batch: Some(12) };
        assert_eq!(ok.validate(chat()), Ok(()));
        assert_eq!(Params::default().validate(chat()), Ok(()));
        for bad in [
            Params { max_tokens: Some(0), ..Params::default() },
            Params { max_tokens: Some(9000), ..Params::default() },
            Params { temperature: Some(f64::NAN), ..Params::default() },
            Params { temperature: Some(2.5), ..Params::default() },
            Params { timeout_ms: Some(500), ..Params::default() },
            Params { batch: Some(2), ..Params::default() },
            Params { batch: Some(16), ..Params::default() },
        ] {
            assert_eq!(bad.validate(chat()), Err("llm_params_invalid"), "{bad:?}");
        }
        // Karar ucu yalniz zaman asimi alir.
        assert_eq!(Params { timeout_ms: Some(5000), ..Params::default() }.validate(gate()), Ok(()));
        assert_eq!(Params { max_tokens: Some(100), ..Params::default() }.validate(gate()), Err("llm_params_invalid"));
        assert_eq!(Params { timeout_ms: Some(30_000), ..Params::default() }.validate(gate()), Err("llm_params_invalid"));
        // Bilinmeyen alan sessizce yutulmaz.
        assert!(serde_json::from_value::<Params>(serde_json::json!({ "max_token": 5 })).is_err());
    }

    #[test]
    fn varsayilanlar_sozlesmeden() {
        let e = Effective::resolve(chat(), "m/x".into(), &Params::default());
        assert_eq!((e.max_tokens, e.timeout_ms, e.reasoning_off, e.batch, e.temperature), (1500, 30_000, true, 9, None));
        assert_eq!(e.system(chat()).as_deref(), Some(SUGGEST_PROMPT), "satir yok: koddaki istem");
        let g = Effective::resolve(gate(), "typesafe/jev".into(), &Params::default());
        assert_eq!(g.timeout_ms, 3000, "kapi kaydi bekletmesin");
        assert_eq!(g.system(gate()), None);
    }

    #[test]
    fn model_adi_bicimi() {
        for ok in ["deepseek/deepseek-v4.1-flash", "typesafe/jev-router", "openai/gpt-x:free", "a/b_c.d"] {
            assert!(valid_model(ok), "{ok}");
        }
        for bad in ["", "deepseek", "deep seek/x", "a/b?c", "a/b\n", &format!("a/{}", "x".repeat(200))] {
            assert!(!valid_model(bad), "{bad:?}");
        }
    }
}
