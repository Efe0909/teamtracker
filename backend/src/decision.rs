//! Bilgi yogunlugu: karar modeli (OpenRouter decisions) metni tartar (spec/76).
//!
//! Yalniz `noul` sorulari (span kisiti): her soru "evet" olasiligi doner.
//! Biri esigin altindaysa metin ZAYIF: 422 `low_quality` + soru adlari;
//! istemci `quality_override` ile yine gonderebilir, kayitta izi kalir.
//! Servis kapali/erisilemez ise SESSIZCE gecer (uyari loga): uzunluk kurali
//! yine de API'de.

use serde::Serialize;
use serde_json::{json, Value};

use crate::{config::Service, error::AppError, state::AppState};

const URL: &str = "https://openrouter.ai/api/alpha/decisions";
/// ponytail: tek esik, butun sorularda. Ornek metinlerde zayif 0.05-0.2,
/// iyi 0.9+ cikti (spec/76); ara bolge kalibrasyon isterse soru basina esik.
const P_MIN: f64 = 0.5;
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

#[derive(Clone, Copy)]
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

struct Question {
    name: &'static str,
    instructions: &'static str,
    yes: &'static str,
    no: &'static str,
}

const ENTRY: &[Question] = &[
    Question {
        name: "specific",
        instructions: "A club member wrote this task record (Turkish). Does the description name a concrete action or outcome (what exactly, which object, which result), rather than repeating the title or using filler words?",
        yes: "Names a concrete action/outcome beyond the title.",
        no: "Repeats the title, filler, or too vague to act on.",
    },
    Question {
        name: "context",
        instructions: "Could a teammate who was not present understand why this matters, for whom, or where/when, from this text alone?",
        yes: "Gives at least some why/for whom/where/when context.",
        no: "No context; a newcomer would have to ask what this is about.",
    },
];

const CLOSING: &[Question] = &[Question {
    name: "closing_justified",
    instructions: "A club member is closing a task record and wrote this closing note (Turkish). Does the note explain what was done, what the outcome was, or why the record is being closed?",
    yes: "States what was done / the result / the reason for closing.",
    no: "Filler or empty phrases; does not say what was done or why it is closed.",
}];

fn questions(kind: Kind) -> &'static [Question] {
    match kind { Kind::Entry => ENTRY, Kind::Closing => CLOSING }
}

fn body(model: &str, kind: Kind, state: &str) -> Value {
    let qs: serde_json::Map<String, Value> = questions(kind).iter().map(|q| (q.name.to_string(), json!({
        "type": "noul", "instructions": q.instructions, "criteria": { "true": q.yes, "false": q.no },
    }))).collect();
    json!({ "model": model, "state": state, "questions": qs })
}

/// Yanit -> karar. Eksik ya da bozuk cevap `None` (cagiran Skipped sayar).
fn verdict(kind: Kind, resp: &Value) -> Option<Verdict> {
    let mut reasons = Vec::new();
    for q in questions(kind) {
        let p = resp.get("answers")?.get(q.name)?.get("noul")?.as_f64()?;
        if p < P_MIN {
            reasons.push(q.name);
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

pub async fn assess(st: &AppState, kind: Kind, state: &str) -> (Verdict, Quality) {
    if !st.cfg.external_on(Service::Decision) {
        return (Verdict::Skipped, Quality::skipped(None));
    }
    // Model istenip cevap alinamadi: sahte guven uretme, yalniz istenen modeli soyle.
    let skipped = || (Verdict::Skipped, Quality::skipped(Some(st.cfg.decision_model.clone())));
    let sent = st.http.post(URL).bearer_auth(&st.cfg.decision_key).timeout(TIMEOUT)
        .json(&body(&st.cfg.decision_model, kind, state)).send().await;
    let resp: Value = match sent {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(v) => v,
            Err(e) => { tracing::warn!("karar modeli: bozuk yanit: {e}"); return skipped(); }
        },
        Ok(r) => { tracing::warn!("karar modeli: HTTP {}", r.status()); return skipped(); }
        Err(e) => { tracing::warn!("karar modeli: erisilemedi: {e}"); return skipped(); }
    };
    let answers = resp.get("answers").map(Value::to_string).unwrap_or_default();
    tracing::debug!("karar modeli: {answers}");
    match verdict(kind, &resp) {
        Some(v) => { let q = Quality::of(&v, &resp); (v, q) }
        None => { tracing::warn!("karar modeli: beklenmeyen yanit bicimi"); skipped() }
    }
}

/// Uclarin kapisi. Zayif + override yok -> 422. Zayif + override -> `Some(reasons)`:
/// cagiran `quality_override` olgusunu kaydin akisina yazar. Gerisi `None`.
/// Karari yanita da koyacak cagiranlar `gate_with`'i kullanir.
pub async fn gate(
    st: &AppState, kind: Kind, state: &str, override_: bool,
) -> Result<Option<Vec<&'static str>>, AppError> {
    gate_with(st, kind, state, override_).await.map(|(r, _)| r)
}

pub async fn gate_with(
    st: &AppState, kind: Kind, state: &str, override_: bool,
) -> Result<(Option<Vec<&'static str>>, Quality), AppError> {
    match assess(st, kind, state).await {
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
    fn esik_ve_yanit_bicimi() {
        let r = json!({ "answers": { "specific": { "type": "noul", "noul": 0.06 },
                                     "context": { "type": "noul", "noul": 0.93 } } });
        assert_eq!(verdict(Kind::Entry, &r), Some(Verdict::Low { reasons: vec!["specific"] }));
        let r = json!({ "answers": { "specific": { "noul": 0.5 }, "context": { "noul": 0.9 } } });
        assert_eq!(verdict(Kind::Entry, &r), Some(Verdict::Pass));
        let r = json!({ "answers": { "closing_justified": { "noul": 0.19 } } });
        assert_eq!(verdict(Kind::Closing, &r), Some(Verdict::Low { reasons: vec!["closing_justified"] }));
        // Eksik soru ya da hata govdesi: karar yok (Skipped).
        assert_eq!(verdict(Kind::Entry, &json!({ "answers": { "specific": { "noul": 0.9 } } })), None);
        assert_eq!(verdict(Kind::Closing, &json!({ "error": { "message": "x" } })), None);
    }

    #[test]
    fn yanit_karari_model_ve_olasiliklari_tasir() {
        let r = json!({ "model": "typesafe/jev-1.13-20260917", "provider": "TypeSafe",
            "answers": { "specific": { "type": "noul", "noul": 0.04 }, "context": { "type": "noul", "noul": 0.9 } } });
        let v = verdict(Kind::Entry, &r).expect("karar");
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
        let b = body("m", Kind::Entry, "Başlık: x");
        assert!(b["state"].is_string());
        for (_, q) in b["questions"].as_object().into_iter().flatten() {
            assert_eq!(q["type"], "noul");
            assert!(q["instructions"].is_string() && q["criteria"]["true"].is_string() && q["criteria"]["false"].is_string());
        }
    }
}
