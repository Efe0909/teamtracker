//! CSRF kapisi — cift gonderim (double submit), imzali cerezle.
//!
//! Token IMZALI cerezde durur ve her sablona enjekte edilir; tarayici onu
//! `hx-headers` uzerinden `X-CSRF-Token` olarak geri yollar. Kapi ikisini
//! karsilastirir.
//!
//! Neden imzali cerez: sunucu tarafi oturum tablosu YOK (KNOW-97). Cerez
//! imzali oldugu icin saldirgan kendi token'ini yazip eslestiremez.
//!
//! GUVENLI METOTLAR MUAF (GET/HEAD/OPTIONS): okuma zaten yan etkisiz ve
//! token'i ilk kez ureten de bir GET.
//!
//! IKINCI KATMAN: oturum cerezi `SameSite=Lax`, yani siteler arasi bir POST
//! cerezi HIC tasimaz. Bu kapi o katmanin ustune biniyor, yerine gecmiyor.

use axum::{
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::{Cookie, SameSite, SignedCookieJar};

use crate::state::AppState;

pub const COOKIE: &str = "csrf";
pub const HEADER: &str = "x-csrf-token";

/// 256 bit rastgelelik.  crate'i EKLENMEDI: uuid v4 zaten isletim
/// sisteminin CSPRNG'sini kullaniyor ve bagimlilik listesinde duruyor.
fn new_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// Istegin token'i — yoksa uretir. Sablona giden deger bu.
pub fn token(jar: &SignedCookieJar) -> String {
    jar.get(COOKIE).map(|c| c.value().to_string()).unwrap_or_else(new_token)
}

pub fn attach(jar: SignedCookieJar, token: &str, secure: bool) -> SignedCookieJar {
    if jar.get(COOKIE).is_some() {
        return jar;
    }
    let mut c = Cookie::new(COOKIE, token.to_string());
    c.set_path("/");
    c.set_http_only(true);
    c.set_same_site(SameSite::Lax);
    c.set_secure(secure);
    jar.add(c)
}

/// Ara katman. ARA KATMAN SIRASI KRITIK (KNOW-23): oturum cerezi bu kapidan
/// ONCE acilmali, yoksa jar bos gelir ve her yazma reddedilir.
pub async fn gate(
    State(st): State<AppState>,
    jar: SignedCookieJar,
    req: Request,
    next: Next,
) -> Response {
    if matches!(req.method(), &Method::GET | &Method::HEAD | &Method::OPTIONS) {
        return next.run(req).await;
    }
    let sent = req.headers().get(HEADER).and_then(|v| v.to_str().ok()).unwrap_or("");
    let have = jar.get(COOKIE).map(|c| c.value().to_string()).unwrap_or_default();

    // Bos token'i "eslesti" saymamak icin acikca kontrol: ikisi de bos olsa
    // karsilastirma gecerdi ve kapi hic calismazdi.
    if have.is_empty() || sent.is_empty() || sent != have {
        tracing::warn!("csrf rejected: {} {}", req.method(), req.uri().path());
        let _ = &st;
        return (StatusCode::FORBIDDEN, "CSRF doğrulaması başarısız").into_response();
    }
    next.run(req).await
}
