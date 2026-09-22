//! Denetim izi: `security_events` (spec/70-guvenlik.md §8).
//!
//! Giris/cikis olaylari `api/auth.rs`'ten yazilir; 403'ler BURADAN, tek
//! katmandan. Python'da da tek exception handler'di (bda6531): uclarda tek
//! tek yazilsaydi biri unutulurdu. Yeni bir uc `AppError::Forbidden`
//! dondurdugu anda denetime girer, kimsenin hatirlamasi gerekmez.

use std::net::IpAddr;

use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};
use axum_extra::extract::cookie::SignedCookieJar;
use uuid::Uuid;

use crate::{auth, csrf, state::AppState};

/// nginx'in yazdigi X-Real-IP (Cloudflare'in CF-Connecting-IP'sinden). Rust
/// yalniz 127.0.0.1 dinledigi icin baslik ancak nginx'ten gelebilir.
/// Gecersiz deger `None`: `inet` sutununa yazilamaz.
pub fn client_ip(h: &HeaderMap) -> Option<IpAddr> {
    h.get("x-real-ip")?.to_str().ok()?.trim().parse().ok()
}

/// Kim girdi, kim reddedildi, kim 403 yedi. Govde tutulmaz (spec/70 §8).
/// Yazilamazsa istek DUSMEZ, loga yazilir.
pub async fn log_event(
    st: &AppState, ip: Option<IpAddr>, event_type: &str,
    actor: Option<Uuid>, email: Option<&str>, detail: Option<&str>,
) {
    let ip = ip.map(|ip| ip.to_string());
    let res = sqlx::query(
        "insert into security_events (event_type, actor_id, email, ip, detail) \
         values ($1, $2, $3, $4::inet, $5)")
        .bind(event_type).bind(actor).bind(email).bind(ip).bind(detail)
        .execute(&st.pool).await;
    if let Err(e) = res {
        tracing::error!("security_events insert failed: {e}");
    }
}

/// Ara katman: donen HER 403 `permission_denied` olarak yazilir. CSRF
/// kapisinin DISINDA durur ki onun reddini de gorsun.
///
/// YALNIZ OTURUMLU red yazilir (Python `csrf._reject` kurali): kimliksiz
/// istek tabloyu sinirsiz sisirebilirdi, her satir bir veritabani yazimi.
/// Uc 403'leri zaten hep oturumlu — `CurrentUser` oturumsuzu 401'le once
/// cevirir; oturumsuz 403 yalniz CSRF kapisindan cikar.
///
/// Aktor cerezdeki kimlik, DB'den dogrulanmaz: reddi yiyen oturumun kendisi.
/// Silinmis kullanicinin cerezi FK'ye takilir, loga duser, 403 yine doner.
pub async fn forbidden(State(st): State<AppState>, jar: SignedCookieJar, req: Request, next: Next) -> Response {
    let actor = auth::read_session(&jar, &st.cfg).map(|s| s.user_id);
    let ip = client_ip(req.headers());
    let (method, uri) = (req.method().clone(), req.uri().clone());
    let res = next.run(req).await;
    if let (StatusCode::FORBIDDEN, Some(uid)) = (res.status(), actor) {
        // Sorgu dizgisi yazilmaz: yol yeter, filtre degerleri denetim izi degil.
        let detail = if res.extensions().get::<csrf::Rejected>().is_some() {
            format!("csrf: {}", uri.path())
        } else {
            format!("{method} {}", uri.path())
        };
        log_event(&st, ip, "permission_denied", Some(uid), None, Some(&detail)).await;
    }
    res
}
