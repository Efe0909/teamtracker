//! OpenRouter'in alt duzeyi: istek govdesi, gonderme, cevaptan kullanim ve hata izi.
//!
//! Cagri KARARLARI (limit, kayit, govde saklama) burada degil, `llm.rs`'te: her uretken
//! cagri oradan gecer. Burasi yalniz HTTP'yi bilir.
//!
//! Istem ve cevap govdesi LOGLANMAZ: ozet temizlenmis olsa da serbest metin tasiyabilir.
//! Anahtar (`OPENROUTER_API_KEY`) yalniz `Authorization` basligina gider; hata izine,
//! cevaba, loga girmez.

use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::{llm::{Effective, Status}, state::AppState};

/// Sohbet tamamlama (`chat` sozlesmesi).
pub const CHAT: &str = "/api/v1/chat/completions";
/// Karar modeli (`decisions` sozlesmesi, spec/76).
pub const DECISIONS: &str = "/api/alpha/decisions";
/// Hata izi ve saklanan cevap siniri.
const ERROR_MAX: usize = 500;
pub const RAW_MAX: usize = 16 * 1024;

/// Sohbet istegi. Dusunme kapali (`reasoning_off`: kisa yapilandirilmis cikti icin akil
/// yurutme jetonu bosa gider) ve `require_parameters`: `response_format`'i desteklemeyen
/// saglayiciya yonlendirilmesin, yoksa sema sessizce yok sayilir.
pub fn chat_body(e: &Effective, system: Option<&str>, user: &str, schema_name: &str, schema: &Value) -> Value {
    let mut messages = Vec::with_capacity(2);
    if let Some(s) = system {
        messages.push(json!({ "role": "system", "content": s }));
    }
    messages.push(json!({ "role": "user", "content": user }));
    let mut b = json!({
        "model": e.model,
        "messages": messages,
        "response_format": {
            "type": "json_schema",
            "json_schema": { "name": schema_name, "strict": true, "schema": schema }
        },
        "max_tokens": e.max_tokens,
        "provider": { "require_parameters": true }
    });
    if e.reasoning_off {
        b["reasoning"] = json!({ "enabled": false });
    }
    if let Some(t) = e.temperature {
        b["temperature"] = json!(t);
    }
    b
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
        cost: resp.pointer("/usage/cost").and_then(Value::as_f64).filter(|c| c.is_finite() && *c >= 0.0),
    }
}

/// Kisa hata izi: saglayicinin `error.code`/`error.message`'i ve saglayici adi. Govde
/// JSON degilse ilk satiri. En cok `ERROR_MAX` karakter.
pub fn error_text(raw: &str) -> Option<String> {
    let v: Option<Value> = serde_json::from_str(raw).ok();
    let text = match v.as_ref().and_then(|v| v.get("error")) {
        Some(e) => {
            let code = e.get("code").map(|c| c.to_string().trim_matches('"').to_string());
            let msg = e.get("message").and_then(Value::as_str).unwrap_or("");
            let provider = e.pointer("/metadata/provider_name").and_then(Value::as_str);
            let mut s = match code { Some(c) => format!("{c}: {msg}"), None => msg.to_string() };
            if let Some(p) = provider {
                s.push_str(&format!(" ({p})"));
            }
            s
        }
        None => raw.lines().next().unwrap_or("").to_string(),
    };
    let text = text.trim();
    (!text.is_empty()).then(|| clip(text, ERROR_MAX))
}

/// Karakter sinirinda keser (UTF-8 ortasindan degil).
pub fn clip(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => s[..i].to_string(),
        None => s.to_string(),
    }
}

/// Gonderilen istegin sonucu: basarili ise ham govde, degilse hata turu.
pub struct Sent {
    pub fail: Option<Status>,
    pub http_status: Option<u16>,
    pub raw: String,
    pub ms: u64,
}

pub async fn post(st: &AppState, path: &str, body: &Value, timeout: Duration) -> Sent {
    let started = Instant::now();
    let sent = st.http.post(format!("{}{path}", st.cfg.openrouter_url))
        .bearer_auth(&st.cfg.decision_key).timeout(timeout).json(body).send().await;
    let (fail, http_status, raw) = match sent {
        Err(e) => {
            let fail = if e.is_timeout() { Status::Timeout } else { Status::Network };
            // reqwest hatasi URL tasir, anahtar tasimaz (baslikta).
            (Some(fail), None, e.to_string())
        }
        Ok(r) => {
            let code = r.status();
            match r.text().await {
                Ok(t) if code.is_success() => (None, Some(code.as_u16()), t),
                Ok(t) => (Some(Status::Http), Some(code.as_u16()), t),
                Err(e) => (Some(if e.is_timeout() { Status::Timeout } else { Status::Network }), Some(code.as_u16()), e.to_string()),
            }
        }
    };
    Sent { fail, http_status, raw, ms: started.elapsed().as_millis() as u64 }
}

/// Yonetim sayfasinin okumalari (model listesi, anahtar kullanimi). `auth` yoksa anahtar
/// gonderilmez (model listesi herkese acik).
pub async fn get(st: &AppState, path: &str, auth: bool) -> Result<Value, String> {
    let mut req = st.http.get(format!("{}{path}", st.cfg.openrouter_url)).timeout(Duration::from_secs(10));
    if auth {
        req = req.bearer_auth(&st.cfg.decision_key);
    }
    let r = req.send().await.map_err(|e| format!("erisilemedi: {e}"))?;
    let code = r.status();
    if !code.is_success() {
        return Err(format!("HTTP {code}"));
    }
    r.json().await.map_err(|e| format!("bozuk yanit: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eff(model: &str) -> Effective {
        Effective {
            model: model.into(), max_tokens: 1500, temperature: None, timeout_ms: 30_000,
            reasoning_off: true, batch: 9, enabled: true, store_bodies: false, prompt_version: 0, prompt: None,
        }
    }

    #[test]
    fn govde_yapilandirilmis_cikti_ve_dusunme_kapali() {
        let schema = json!({ "type": "object" });
        let b = chat_body(&eff("deepseek/deepseek-v4.1-flash"), None, "{\"a\":1}", "material_suggestions", &schema);
        assert_eq!(b["model"], "deepseek/deepseek-v4.1-flash");
        assert_eq!(b["messages"], json!([{ "role": "user", "content": "{\"a\":1}" }]), "istem yok: tek mesaj");
        assert_eq!(b["response_format"]["type"], "json_schema");
        assert_eq!(b["response_format"]["json_schema"]["strict"], true);
        assert_eq!(b["response_format"]["json_schema"]["schema"], schema);
        assert_eq!(b["reasoning"], json!({ "enabled": false }));
        assert_eq!(b["provider"]["require_parameters"], true);
        assert_eq!(b["max_tokens"], 1500);
        assert!(b.get("temperature").is_none(), "verilmeyen sicaklik gonderilmez");
    }

    #[test]
    fn dusunme_parametresi_istege_bagli_sicaklik_verilirse_gider() {
        let mut e = eff("m");
        e.reasoning_off = false;
        e.temperature = Some(0.2);
        let b = chat_body(&e, Some("talimat"), "u", "n", &json!({}));
        assert!(b.get("reasoning").is_none(), "desteklemeyen modelde `require_parameters` dusurmesin");
        assert_eq!(b["temperature"], 0.2);
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
        // Maliyet alani yoksa sessizce 0 sayma: None kalir ("maliyet bilinmiyor").
        assert_eq!(usage(&json!({ "usage": { "prompt_tokens": 5 } })).cost, None);
        assert_eq!(usage(&json!({ "usage": { "cost": -1 } })).cost, None, "negatif maliyet bilinmiyor sayilir");
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

    #[test]
    fn hata_izi_kisa_ve_saglayicili() {
        let raw = r#"{"error":{"code":400,"message":"No endpoints found that support response_format","metadata":{"provider_name":"Groq"}}}"#;
        assert_eq!(error_text(raw).as_deref(), Some("400: No endpoints found that support response_format (Groq)"));
        assert_eq!(error_text("Bad Gateway\n<html>").as_deref(), Some("Bad Gateway"));
        assert_eq!(error_text("  "), None);
        let long = format!(r#"{{"error":{{"message":"{}"}}}}"#, "ş".repeat(900));
        assert_eq!(error_text(&long).map(|s| s.chars().count()), Some(ERROR_MAX));
    }
}
