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
