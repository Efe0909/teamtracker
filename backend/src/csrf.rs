//! CSRF kapisi.
//!
//! Token oturum cerezinin ICINDE (auth.rs) ve `GET /api/me` govdesiyle on
//! yuze verilir; on yuz degistiren her istekte `X-CSRF-Token` basligiyla geri
//! yollar. Kapi basligi cerezdekiyle karsilastirir. Cerez imzali oldugu icin
//! saldirgan kendi token'ini yazip eslestiremez.
//!
//! GUVENLI METOTLAR MUAF (GET/HEAD/OPTIONS): okuma yan etkisiz olmali.
//! Oturumsuz degistiren istek YOK — oturum yoksa kapi reddeder.
//!
//! IKINCI KATMAN: oturum cerezi `SameSite=Lax`, siteler arasi POST cerezi
//! hic tasimaz. Bu kapi o katmanin ustune biniyor, yerine gecmiyor.

use axum::{
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::cookie::SignedCookieJar;

use crate::{auth, state::AppState};

pub const HEADER: &str = "x-csrf-token";

/// Yanit uzantisi: bu 403 CSRF kapisindan. Denetim katmani (`audit.rs`) yetki
/// reddinden ayirmak icin okur — govdeyi ayristirmadan.
#[derive(Clone, Copy)]
pub struct Rejected;

pub async fn gate(State(st): State<AppState>, jar: SignedCookieJar, req: Request, next: Next) -> Response {
    if matches!(req.method(), &Method::GET | &Method::HEAD | &Method::OPTIONS) {
        return next.run(req).await;
    }
    let sent = req.headers().get(HEADER).and_then(|v| v.to_str().ok()).unwrap_or("");
    let ok = auth::read_session(&jar, &st.cfg)
        .is_some_and(|s| !s.csrf.is_empty() && s.csrf == sent);
    if !ok {
        tracing::warn!("csrf rejected: {} {}", req.method(), req.uri().path());
        let mut res = (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "csrf" }))).into_response();
        res.extensions_mut().insert(Rejected);
        return res;
    }
    next.run(req).await
}
