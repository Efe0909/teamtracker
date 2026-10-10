//! OpenRouter sohbet tamamlama (`/api/v1/chat/completions`) istemcisi, yapilandirilmis cikti icin.
//!
//! Karar modeli (`decision.rs`) baska bir ucu (`/alpha/decisions`) kullanir; bu, serbest
//! JSON ureten isler icindir (malzeme onerisi, spec/79 §9). Kapi `Service::Suggest`
//! (anahtar + manifest `external_off`); anahtar karar modeliyle ortak.
//!
//! Istem ve cevap govdesi LOGLANMAZ: ozet temizlenmis olsa da serbest metin tasiyabilir.
//! Yalniz durum kodu ve hata turu yazilir.

use std::time::Duration;

use serde_json::{json, Value};

use crate::{config::Service, state::AppState};

const URL: &str = "https://openrouter.ai/api/v1/chat/completions";
/// 9 kisa oneri icin bol; yavas saglayicida istek takilmasin.
const TIMEOUT: Duration = Duration::from_secs(30);
const MAX_TOKENS: u32 = 1500;

#[derive(Debug, PartialEq, Eq)]
pub enum CallError {
    /// Servis kapali (anahtar yok ya da `external_off`).
    Off,
    /// Ag, HTTP ya da yanit hatasi; ayrinti loga yazildi.
    Failed,
}

/// Istek govdesi. Dusunme kapali (kisa, yapilandirilmis cikti icin akil yurutme jetonu
/// bosa gider) ve `require_parameters`: `response_format`'i desteklemeyen saglayiciya
/// yonlendirilmesin, yoksa sema sessizce yok sayilir.
pub fn body(model: &str, system: Option<&str>, user: &str, schema_name: &str, schema: &Value) -> Value {
    let mut messages = Vec::with_capacity(2);
    if let Some(s) = system {
        messages.push(json!({ "role": "system", "content": s }));
    }
    messages.push(json!({ "role": "user", "content": user }));
    json!({
        "model": model,
        "messages": messages,
        "response_format": {
            "type": "json_schema",
            "json_schema": { "name": schema_name, "strict": true, "schema": schema }
        },
        "reasoning": { "enabled": false },
        "max_tokens": MAX_TOKENS,
        "provider": { "require_parameters": true }
    })
}

/// `choices[0].message.content` JSON metnini cozer; bos, kesik ya da JSON olmayan cevap `None`.
pub fn reply(resp: &Value) -> Option<Value> {
    let text = resp.pointer("/choices/0/message/content")?.as_str()?;
    serde_json::from_str(text.trim()).ok()
}

/// Cevaptaki kullanim: OpenRouter her non-stream cevapta `usage` icinde jeton sayilarini ve
/// `cost` (USD) verir; `id` OpenRouter panosundaki uretim kimligidir (mutabakat icin).
#[derive(Debug, Default, PartialEq)]
pub struct Usage {
    pub id: Option<String>,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub cost: Option<f64>,
}

pub fn usage(resp: &Value) -> Usage {
    Usage {
        id: resp.get("id").and_then(Value::as_str).map(str::to_string),
        prompt_tokens: resp.pointer("/usage/prompt_tokens").and_then(Value::as_u64),
        completion_tokens: resp.pointer("/usage/completion_tokens").and_then(Value::as_u64),
        cost: resp.pointer("/usage/cost").and_then(Value::as_f64),
    }
}

pub async fn structured(
    st: &AppState, model: &str, system: Option<&str>, user: &str, schema_name: &str, schema: &Value,
) -> Result<Value, CallError> {
    if !st.cfg.external_on(Service::Suggest) {
        return Err(CallError::Off);
    }
    let sent = st.http.post(URL).bearer_auth(&st.cfg.decision_key).timeout(TIMEOUT)
        .json(&body(model, system, user, schema_name, schema)).send().await;
    let resp = match sent {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            tracing::warn!("oneri modeli: HTTP {}", r.status());
            return Err(CallError::Failed);
        }
        Err(e) => {
            tracing::warn!("oneri modeli: erisilemedi: {e}");
            return Err(CallError::Failed);
        }
    };
    let parsed: Value = resp.json().await.map_err(|e| {
        tracing::warn!("oneri modeli: bozuk yanit: {e}");
        CallError::Failed
    })?;
    // Maliyet cevap semaya uymasa da dogar: kullanimi cevaptan ONCE yaz.
    let u = usage(&parsed);
    tracing::info!(gen_id = ?u.id, tokens_in = ?u.prompt_tokens, tokens_out = ?u.completion_tokens,
        cost_usd = ?u.cost, "oneri modeli: kullanim");
    reply(&parsed).ok_or_else(|| {
        tracing::warn!("oneri modeli: yanit semaya uymuyor ya da bos");
        CallError::Failed
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn govde_yapilandirilmis_cikti_ve_dusunme_kapali() {
        let schema = json!({ "type": "object" });
        let b = body("deepseek/deepseek-v4.1-flash", None, "{\"a\":1}", "material_suggestions", &schema);
        assert_eq!(b["model"], "deepseek/deepseek-v4.1-flash");
        assert_eq!(b["messages"], json!([{ "role": "user", "content": "{\"a\":1}" }]), "istem yok: tek mesaj");
        assert_eq!(b["response_format"]["type"], "json_schema");
        assert_eq!(b["response_format"]["json_schema"]["strict"], true);
        assert_eq!(b["response_format"]["json_schema"]["schema"], schema);
        assert_eq!(b["reasoning"], json!({ "enabled": false }));
        assert_eq!(b["provider"]["require_parameters"], true);
    }

    #[test]
    fn istem_verilirse_ilk_mesaj_olur() {
        let b = body("m", Some("talimat"), "u", "n", &json!({}));
        assert_eq!(b["messages"][0], json!({ "role": "system", "content": "talimat" }));
        assert_eq!(b["messages"][1]["role"], "user");
    }

    #[test]
    fn kullanim_ve_maliyet_okunur_yoksa_none() {
        let r = json!({ "id": "gen-abc123", "choices": [],
            "usage": { "prompt_tokens": 12, "completion_tokens": 24, "total_tokens": 36, "cost": 0.001 } });
        assert_eq!(usage(&r), Usage {
            id: Some("gen-abc123".into()), prompt_tokens: Some(12), completion_tokens: Some(24), cost: Some(0.001),
        });
        // Maliyet alani yoksa sessizce 0 sayma: None kalir (log'da gorunur).
        assert_eq!(usage(&json!({ "usage": { "prompt_tokens": 5 } })).cost, None);
        assert_eq!(usage(&json!({})), Usage::default());
    }

    #[test]
    fn yanit_json_metni_cozulur_bozuk_olan_none() {
        let ok = json!({ "choices": [{ "message": { "role": "assistant", "content": " {\"items\":[]} " } }] });
        assert_eq!(reply(&ok), Some(json!({ "items": [] })));
        for bad in [
            json!({ "choices": [{ "message": { "content": "uzun bir giris {\"items\":[]}" } }] }),
            json!({ "choices": [{ "message": { "content": null } }] }),
            json!({ "choices": [] }),
            json!({ "error": { "code": 502, "message": "x" } }),
        ] {
            assert_eq!(reply(&bad), None);
        }
    }
}
