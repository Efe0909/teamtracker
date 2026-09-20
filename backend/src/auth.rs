//! Oturum cerezi ve istekten kullaniciya cozum.
//!
//! Yetki DORT KATMAN (spec/21-sema-v2.md §11): yetenek (`scopes`+`roles`),
//! dal (`user_node_scopes`), iliski (sahip/acan/katilimci/takim uyesi),
//! super (`users.is_admin`). Sorgulari `db/scope.rs`'te; burasi kimlik.
//!
//! ## Cerez YALNIZ `uid` tasir
//!
//! Kapsam, rol, admin bayragi cereze GOMULMEZ. Sebep: iptal ANINDA islemeli.
//! `is_active` ile kapatilan kullanici bir sonraki istekte disari duser;
//! kapsami alinan kisi bir sonraki istekte kaybeder.
//!
//! JWT'ye claim gomme tuzagina dusme: hizli gorunur ama iptal token suresi
//! dolana kadar olmez. Her istekte DB'ye gitmek BILINCLI tercih (KNOW-97).

use axum::{
    extract::{FromRequestParts, OptionalFromRequestParts},
    http::request::Parts,
};
use axum_extra::extract::cookie::{Cookie, Key, SameSite, SignedCookieJar};
use uuid::Uuid;

use crate::{config::Config, error::AppError, models::user::User, state::AppState};

const SESSION_KEY: &str = "uid";

pub fn key_from(cfg: &Config) -> Key {
    // Yayinda Config >= 32 karakter dayatiyor; gelistirmede kisa anahtari
    // uzatarak kabul ediyoruz ki `cargo run` bos ortamla da calissin.
    let mut bytes = cfg.secret_key.clone().into_bytes();
    if bytes.len() < 64 {
        bytes.resize(64, b'.');
    }
    Key::from(&bytes)
}

pub fn open_session(jar: SignedCookieJar, cfg: &Config, user_id: Uuid) -> SignedCookieJar {
    let mut c = Cookie::new(SESSION_KEY, user_id.to_string());
    c.set_path("/");
    c.set_http_only(true);
    // Lax: siteler arasi POST/PATCH cerezi TASIMAZ — CSRF'in ilk katmani.
    c.set_same_site(SameSite::Lax);
    c.set_secure(cfg.in_production());
    if let Some(d) = &cfg.cookie_domain {
        c.set_domain(d.clone());   // bir giris, iki alt alan adi
    }
    c.set_max_age(time::Duration::seconds(crate::config::SESSION_MAX_AGE_SECS));
    jar.add(c)
}

pub fn close_session(jar: SignedCookieJar) -> SignedCookieJar {
    jar.remove(Cookie::from(SESSION_KEY))
}

/// Istekteki kullanici. Handler imzasina `user: CurrentUser` yazmak yeter.
pub struct CurrentUser(pub User);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;
    async fn from_request_parts(p: &mut Parts, st: &AppState) -> Result<Self, AppError> {
        resolve(p, st).await?.map(CurrentUser).ok_or(AppError::Unauthorized)
    }
}

/// `Option<CurrentUser>`: giris gerektirmeyen uclar icin. Oturum yoksa hata
/// degil `None`.
impl OptionalFromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;
    async fn from_request_parts(p: &mut Parts, st: &AppState) -> Result<Option<Self>, AppError> {
        Ok(resolve(p, st).await?.map(CurrentUser))
    }
}

async fn resolve(p: &mut Parts, st: &AppState) -> Result<Option<User>, AppError> {
    let jar = SignedCookieJar::from_headers(&p.headers, key_from(&st.cfg));

    if let Some(id) = jar.get(SESSION_KEY).and_then(|c| c.value().parse::<Uuid>().ok()) {
        // HER ISTEKTE DB: kapatilan kullanici bir sonraki istekte duser.
        if let Some(u) = User::active(&st.pool, id).await? {
            touch_presence(st, u.id).await;
            return Ok(Some(u));
        }
    }

    // Sahte kimlik: giris ekrani yok, ilk kullanici olarak acilir. Config
    // yayinda bu modu acilista REDDEDIYOR — burada ikinci bir kapi yok.
    if st.cfg.fake_identity() {
        if let Some(u) = User::first_active(&st.pool).await? {
            touch_presence(st, u.id).await;
            return Ok(Some(u));
        }
    }
    Ok(None)
}

/// Varlik damgasi TAM BURADA: kimlik cozulen her istek bir hayat belirtisi.
/// Ayri bir "ben buradayim" ucu yok — o hem fazladan istek hem de
/// kapatilabilir bir yol olurdu.
async fn touch_presence(st: &AppState, id: Uuid) {
    let _ = sqlx::query("update users set last_seen_at = now() where id = $1")
        .bind(id).execute(&st.pool).await;
}
