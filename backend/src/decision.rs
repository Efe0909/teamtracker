//! Bilgi yogunlugu: karar modeli (OpenRouter decisions) metni tartar (spec/76).
//!
//! Yalniz `noul` sorulari (span kisiti): her soru "evet" olasiligi doner.
//! Bir soru kendi esiginin (`min`) altindaysa metin ZAYIF: 422 `low_quality` +
//! soru adlari; istemci `quality_override` ile yine gonderebilir, kayitta izi
//! kalir. Servis kapali/erisilemez ise SESSIZCE gecer (uyari loga): uzunluk
//! kurali yine de API'de.
//!
//! Soru ADLARI sabit (kod bunlara baglanir); soru METINLERI ve esikler
//! `quality_config` tablosunda, Yonetim > Kalite kapisi'ndan degisir. Satir
//! yoksa asagidaki varsayilanlar gecerli.
//!
//! Model adi ve zaman asimi `llm_features` (`quality_gate`), cagri `llm::run`'dan
//! gecer: kayit, limit (asilinca kapi GECER, kullanici engellenmez) spec/79 §11.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    error::AppError,
    llm::{self, Effective, Fail, Parsed, Status, Who},
    state::AppState,
};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// Kayit / etkinlik: baslik + aciklama.
    Entry,
    /// Kapanis notu (kayit ya da eylem).
    Closing,
}

#[derive(Debug, PartialEq)]
pub enum Verdict {
    Pass,
    Low { reasons: Vec<&'static str> },
    Skipped,
}

/// Soru adlari: kod bunlara baglanir, yonetimden eklenip silinemez.
const ENTRY_NAMES: &[&str] = &["specific", "context"];
const CLOSING_NAMES: &[&str] = &["closing_justified"];

fn names(kind: Kind) -> &'static [&'static str] {
    match kind { Kind::Entry => ENTRY_NAMES, Kind::Closing => CLOSING_NAMES }
}

fn all_names() -> impl Iterator<Item = &'static str> {
    ENTRY_NAMES.iter().chain(CLOSING_NAMES).copied()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuestionCfg {
    /// Modele verilen soru/yonerge metni.
    pub instructions: String,
    /// "Evet" olcutu.
    pub yes: String,
    /// "Hayir" olcutu.
    pub no: String,
    /// Bu soruda evet olasiligi bunun altindaysa metin zayif.
    pub min: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QualityConfig {
    pub questions: BTreeMap<String, QuestionCfg>,
}

const INSTR_MAX: usize = 3000;
const CRIT_MAX: usize = 400;

impl QualityConfig {
    /// Sorular sabit; yalniz metin ve esik degisir. Hata kodu istemciye gider.
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.questions.len() != all_names().count()
            || !all_names().all(|n| self.questions.contains_key(n))
        {
            return Err("quality_questions_mismatch");
        }
        for q in self.questions.values() {
            let ok = |s: &str, max: usize| !s.trim().is_empty() && s.chars().count() <= max;
            if !ok(&q.instructions, INSTR_MAX) || !ok(&q.yes, CRIT_MAX) || !ok(&q.no, CRIT_MAX) {
                return Err("quality_text_invalid");
            }
            if !q.min.is_finite() || !(0.05..=0.95).contains(&q.min) {
                return Err("quality_min_invalid");
            }
        }
        Ok(())
    }

    pub fn defaults() -> Self {
        let q = |instructions: &str, yes: &str, no: &str| QuestionCfg {
            instructions: instructions.into(), yes: yes.into(), no: no.into(), min: 0.5,
        };
        // Ortak not: notlar hizli ve gayriresmi yazilir; yazim/aksan cezalandirilmaz.
        let questions = BTreeMap::from([
            ("specific".to_string(), q(
                "A member of a Turkish university maker/engineering club wrote this task record. The text is Turkish: informal wording, abbreviations and missing diacritics (for example 'gorusme' instead of 'görüşme') are normal, so do NOT judge spelling or grammar. Decide only whether the DESCRIPTION is specific. It is specific if it names at least one concrete thing: an action to do (or already done), the object it concerns, a person, team or counterpart involved, or a result to reach. It is NOT specific if it only repeats the title, consists of filler ('yapılacak', 'halledilecek', 'gerekli işlemler', 'bakılacak'), or could be pasted under any other record without change.",
                "Names a concrete action, object, counterpart or result beyond what the title already says.",
                "Repeats the title, is generic filler, or could belong to any record; a teammate would not know what exactly is meant.",
            )),
            ("context".to_string(), q(
                "A member of a Turkish university maker/engineering club wrote this task record (Turkish; informal wording and missing diacritics are normal, do NOT judge spelling or grammar). Could a teammate who was not present understand why this matters, for whom, or where/when, from the title and description together? ANY ONE of these is enough: a reason or goal, who it is for, a place, a date or deadline, or the situation that triggered it. A short text is fine if it carries one of these. Do not require formal writing or complete sentences.",
                "Gives at least one of: reason/goal, who it is for, place, date/deadline, or the situation that triggered it.",
                "None of those; a newcomer would have to ask what this is about.",
            )),
            ("closing_justified".to_string(), q(
                "A member of a Turkish university maker/engineering club is closing a task record and wrote this closing note. The note is Turkish: informal wording, abbreviations and missing diacritics are normal, so do NOT judge spelling or grammar. Decide whether the note says what was done, what the outcome was, or why the record is being closed without doing it (for example duplicate, cancelled, no longer needed). It passes if it names at least one concrete thing that happened — a meeting held with someone or about something, something sent, ordered, fixed, approved or decided — or gives the reason for closing. A vague phrase such as 'gerekli aksiyon alındı' counts only when something concrete accompanies it. It does NOT pass if it is only filler or a bare status ('tamamlandı', 'yapıldı', 'bitti', 'ok', 'gerekli işlem yapıldı') that would fit any record.",
                "Says what concretely happened, the result, or the reason for closing.",
                "Only filler or a bare status word; does not say what was done, the result, or why it is closed.",
            )),
        ]);
        QualityConfig { questions }
    }
}

/// Acilista: satir varsa o, yoksa ya da bozuksa varsayilan (bozuk satir uyarilir,
/// servisi dusurmez).
pub async fn load(pool: &PgPool) -> QualityConfig {
    let row: Result<Option<Value>, _> = sqlx::query_scalar("select config from quality_config")
        .fetch_optional(pool).await;
    match row {
        Ok(Some(v)) => match serde_json::from_value::<QualityConfig>(v) {
            Ok(c) if c.validate().is_ok() => c,
            _ => { tracing::warn!("quality_config bozuk: varsayilanlar kullaniliyor"); QualityConfig::defaults() }
        },
        Ok(None) => QualityConfig::defaults(),
        Err(e) => { tracing::warn!("quality_config okunamadi: {e}"); QualityConfig::defaults() }
    }
}

fn body(model: &str, kind: Kind, cfg: &QualityConfig, state: &str) -> Value {
    let qs: serde_json::Map<String, Value> = names(kind).iter().filter_map(|n| {
        let q = cfg.questions.get(*n)?;
        Some((n.to_string(), json!({
            "type": "noul", "instructions": q.instructions, "criteria": { "true": q.yes, "false": q.no },
        })))
    }).collect();
    json!({ "model": model, "state": state, "questions": qs })
}

/// Yanit -> karar. Eksik ya da bozuk cevap `None` (cagiran Skipped sayar).
fn verdict(kind: Kind, cfg: &QualityConfig, resp: &Value) -> Option<Verdict> {
    let mut reasons = Vec::new();
    for name in names(kind) {
        let p = resp.get("answers")?.get(*name)?.get("noul")?.as_f64()?;
        if p < cfg.questions.get(*name)?.min {
            reasons.push(*name);
        }
    }
    Some(if reasons.is_empty() { Verdict::Pass } else { Verdict::Low { reasons } })
}

/// Yanitta gorunen karar: `outcome` (pass | low | skipped), modelin kendi
/// `model`/`provider` alanlari ve soru basina `answers` (noul = evet olasiligi).
/// Saklanmaz; yalniz degerlendirmeyi tetikleyen PATCH yanitinda doner.
#[derive(Debug, Serialize, PartialEq)]
pub struct Quality {
    pub outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answers: Option<Value>,
    pub reasons: Vec<&'static str>,
}

impl Quality {
    fn skipped(model: Option<String>) -> Self {
        Quality { outcome: "skipped", model, provider: None, answers: None, reasons: vec![] }
    }

    fn of(v: &Verdict, resp: &Value) -> Self {
        let text = |k: &str| resp.get(k).and_then(Value::as_str).map(String::from);
        let (outcome, reasons) = match v {
            Verdict::Pass => ("pass", vec![]),
            Verdict::Low { reasons } => ("low", reasons.clone()),
            Verdict::Skipped => ("skipped", vec![]),
        };
        Quality { outcome, model: text("model"), provider: text("provider"),
                  answers: resp.get("answers").cloned(), reasons }
    }
}

fn current(st: &AppState) -> QualityConfig {
    // Zehirli kilit: yazan panik yasadi; deger yine de tutarli (tek atama).
    st.quality.read().unwrap_or_else(|e| e.into_inner()).clone()
}

fn gate_contract() -> &'static llm::Contract {
    // Sozlesme listesi sabit; bulunamamasi derleme sonrasi imkansiz, yine de panik yok.
    llm::contract(llm::GATE).unwrap_or(&llm::CONTRACTS[1])
}

pub async fn assess(st: &AppState, user: Uuid, kind: Kind, state: &str) -> (Verdict, Quality) {
    let c = gate_contract();
    let e = llm::settings(st, c).await;
    let who = Who { user_id: Some(user), event_id: None, is_try: false };
    let (v, q, _) = assess_with(st, &current(st), &e, who, kind, state).await;
    (v, q)
}

/// Yonetimde taslak yapilandirmayla deneme: ayni yol, kendi sorulari; zaman asimi en az 20 sn.
pub async fn try_with(st: &AppState, user: Uuid, cfg: &QualityConfig, kind: Kind, state: &str) -> Quality {
    let e = llm::settings(st, gate_contract()).await;
    let who = Who { user_id: Some(user), event_id: None, is_try: true };
    assess_with(st, cfg, &e, who, kind, state).await.1
}

/// Yonetim > LLM > Dene: taslak model/zaman asimi, gecerli sorular. Tam iz doner.
pub async fn try_model(st: &AppState, user: Uuid, e: &Effective, kind: Kind, state: &str) -> llm::Done<Value> {
    let cfg = current(st);
    let who = Who { user_id: Some(user), event_id: None, is_try: true };
    llm::run(st, gate_contract(), e, who, None, body(&e.model, kind, &cfg, state), |resp| {
        let v = verdict(kind, &cfg, resp).ok_or(Status::Schema)?;
        let q = Quality::of(&v, resp);
        Ok(Parsed { outcome: Some(q.outcome), ..Parsed::plain(serde_json::to_value(&q).unwrap_or_default()) })
    }).await
}

async fn assess_with(
    st: &AppState, cfg: &QualityConfig, e: &Effective, who: Who, kind: Kind, state: &str,
) -> (Verdict, Quality, Option<llm::Trace>) {
    let done = llm::run(st, gate_contract(), e, who, None, body(&e.model, kind, cfg, state), |resp| {
        let v = verdict(kind, cfg, resp).ok_or(Status::Schema)?;
        let q = Quality::of(&v, resp);
        Ok(Parsed { outcome: Some(q.outcome), ..Parsed::plain((v, q)) })
    }).await;
    match done.result {
        Ok((v, q)) => (v, q, done.trace),
        // Kapali/devre disi: model istenmedi, ad da soylenmez.
        Err(Fail::Off | Fail::Disabled) => (Verdict::Skipped, Quality::skipped(None), done.trace),
        // Model istenip cevap alinamadi ya da tavan doldu: sahte guven uretme, yalniz modeli soyle.
        Err(Fail::Limit | Fail::Failed) => (Verdict::Skipped, Quality::skipped(Some(e.model.clone())), done.trace),
    }
}

/// Uclarin kapisi. Zayif + override yok -> 422. Zayif + override -> `Some(reasons)`:
/// cagiran `quality_override` olgusunu kaydin akisina yazar. Gerisi `None`.
/// Karari yanita da koyacak cagiranlar `gate_with`'i kullanir.
pub async fn gate(
    st: &AppState, user: Uuid, kind: Kind, state: &str, override_: bool,
) -> Result<Option<Vec<&'static str>>, AppError> {
    gate_with(st, user, kind, state, override_).await.map(|(r, _)| r)
}

pub async fn gate_with(
    st: &AppState, user: Uuid, kind: Kind, state: &str, override_: bool,
) -> Result<(Option<Vec<&'static str>>, Quality), AppError> {
    match assess(st, user, kind, state).await {
        (Verdict::Low { reasons }, q) if override_ => Ok((Some(reasons), q)),
        (Verdict::Low { reasons }, _) => Err(AppError::LowQuality(reasons)),
        (Verdict::Pass | Verdict::Skipped, q) => Ok((None, q)),
    }
}

/// Modelin okudugu metin: baslik + aciklama.
pub fn entry_state(title: &str, description: Option<&str>) -> String {
    format!("Başlık: {title}\nAçıklama: {}", description.unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn varsayilanlar_gecerli() {
        assert_eq!(QualityConfig::defaults().validate(), Ok(()));
    }

    #[test]
    fn esik_ve_yanit_bicimi() {
        let c = QualityConfig::defaults();
        let r = json!({ "answers": { "specific": { "type": "noul", "noul": 0.06 },
                                     "context": { "type": "noul", "noul": 0.93 } } });
        assert_eq!(verdict(Kind::Entry, &c, &r), Some(Verdict::Low { reasons: vec!["specific"] }));
        let r = json!({ "answers": { "specific": { "noul": 0.5 }, "context": { "noul": 0.9 } } });
        assert_eq!(verdict(Kind::Entry, &c, &r), Some(Verdict::Pass));
        let r = json!({ "answers": { "closing_justified": { "noul": 0.19 } } });
        assert_eq!(verdict(Kind::Closing, &c, &r), Some(Verdict::Low { reasons: vec!["closing_justified"] }));
        // Eksik soru ya da hata govdesi: karar yok (Skipped).
        assert_eq!(verdict(Kind::Entry, &c, &json!({ "answers": { "specific": { "noul": 0.9 } } })), None);
        assert_eq!(verdict(Kind::Closing, &c, &json!({ "error": { "message": "x" } })), None);
    }

    #[test]
    fn esik_soru_basina() {
        let mut c = QualityConfig::defaults();
        c.questions.get_mut("context").unwrap().min = 0.2;
        let r = json!({ "answers": { "specific": { "noul": 0.9 }, "context": { "noul": 0.3 } } });
        assert_eq!(verdict(Kind::Entry, &c, &r), Some(Verdict::Pass));
        c.questions.get_mut("context").unwrap().min = 0.5;
        assert_eq!(verdict(Kind::Entry, &c, &r), Some(Verdict::Low { reasons: vec!["context"] }));
    }

    #[test]
    fn yapilandirma_dogrulamasi() {
        let ok = QualityConfig::defaults();
        let mut c = ok.clone();
        c.questions.remove("context");
        assert_eq!(c.validate(), Err("quality_questions_mismatch"));
        let mut c = ok.clone();
        c.questions.insert("extra".into(), c.questions["context"].clone());
        assert_eq!(c.validate(), Err("quality_questions_mismatch"));
        let mut c = ok.clone();
        c.questions.get_mut("specific").unwrap().instructions = "  ".into();
        assert_eq!(c.validate(), Err("quality_text_invalid"));
        let mut c = ok.clone();
        c.questions.get_mut("specific").unwrap().min = 1.5;
        assert_eq!(c.validate(), Err("quality_min_invalid"));
        // Bilinmeyen alan reddedilir (yazim hatasi sessizce yutulmasin).
        let j = json!({ "questions": {}, "x": 1 });
        assert!(serde_json::from_value::<QualityConfig>(j).is_err());
    }

    #[test]
    fn yanit_karari_model_ve_olasiliklari_tasir() {
        let c = QualityConfig::defaults();
        let r = json!({ "model": "typesafe/jev-1.13-20260917", "provider": "TypeSafe",
            "answers": { "specific": { "type": "noul", "noul": 0.04 }, "context": { "type": "noul", "noul": 0.9 } } });
        let v = verdict(Kind::Entry, &c, &r).expect("karar");
        let q = Quality::of(&v, &r);
        assert_eq!((q.outcome, q.reasons.as_slice()), ("low", ["specific"].as_slice()));
        let j = serde_json::to_value(&q).expect("json");
        assert_eq!(j["model"], "typesafe/jev-1.13-20260917");
        assert_eq!(j["provider"], "TypeSafe");
        assert_eq!(j["answers"]["specific"]["noul"], 0.04);
        // Atlanan karar uydurma guven tasimaz.
        let j = serde_json::to_value(Quality::skipped(None)).expect("json");
        assert_eq!(j, json!({ "outcome": "skipped", "reasons": [] }));
    }

    #[test]
    fn istek_govdesi_span_kisitlarina_uyar() {
        let c = QualityConfig::defaults();
        for kind in [Kind::Entry, Kind::Closing] {
            let b = body("m", kind, &c, "Başlık: x");
            assert!(b["state"].is_string());
            let qs = b["questions"].as_object().expect("sorular");
            assert_eq!(qs.len(), names(kind).len());
            for (_, q) in qs {
                assert_eq!(q["type"], "noul");
                assert!(q["instructions"].is_string() && q["criteria"]["true"].is_string() && q["criteria"]["false"].is_string());
            }
        }
    }
}
