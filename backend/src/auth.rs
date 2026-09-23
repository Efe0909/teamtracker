//! Oturum cerezi ve istekten kullaniciya cozum — "islemi yapan kim" sorusunun
//! TEK cevaplandigi yer (spec/15-sinirlar.md "Kimlik dikisi").
//!
//! Yetki DORT KATMAN (spec/21-sema-v2.md §11): yetenek (`scopes`+`roles`),
//! dal (`user_node_scopes`), iliski (sahip/acan/katilimci/takim uyesi),
//! super (`users.is_admin`). Sorgulari `db/scope.rs`'te; burasi kimlik.
//!
//! ## Cerez: `uid.csrf`, imzali
//!
//! Kapsam, rol, admin bayragi cereze GOMULMEZ. Sebep: iptal ANINDA islemeli.
//! `is_active` ile kapatilan kullanici bir sonraki istekte disari duser.
//! JWT'ye claim gomme tuzagina dusme: iptal token suresi dolana kadar olmez.
//! Her istekte DB'ye gitmek BILINCLI tercih (KNOW-97).
//!
//! CSRF token'i AYNI cerezde: `Domain=<alan>` ile uc hostta da (apex, app.,
//! dashboard.) gecerli ve HER GIRISTE yeniden uretilir. Giris oncesinden
//! kalan bir token giris sonrasina tasinamaz (oturum sabitleme, KNOW-158).

use std::{collections::HashMap, sync::Mutex, time::{Duration, Instant}};

use axum::{
    extract::{FromRequestParts, OptionalFromRequestParts},
    http::request::Parts,
};
use axum_extra::extract::cookie::{Cookie, Key, SameSite, SignedCookieJar};
use uuid::Uuid;

use crate::{config::Config, error::AppError, models::user::User, state::AppState};

pub fn key_from(cfg: &Config) -> Key {
    // Yayinda Config >= 32 karakter dayatiyor; gelistirmede kisa anahtari
    // uzatarak kabul ediyoruz ki `cargo run` bos ortamla da calissin.
    let mut bytes = cfg.secret_key.clone().into_bytes();
    if bytes.len() < 64 {
        bytes.resize(64, b'.');
    }
    Key::from(&bytes)
}

/// 256 bit. `uuid` v4 isletim sisteminin CSPRNG'sini kullaniyor; ayri bir
/// rastgelelik crate'i eklenmedi.
pub fn random_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

pub struct Session {
    pub user_id: Uuid,
    pub csrf: String,
}

pub fn read_session(jar: &SignedCookieJar, cfg: &Config) -> Option<Session> {
    let c = jar.get(cfg.cookie_name())?;
    let (uid, csrf) = c.value().split_once('.')?;
    Some(Session { user_id: uid.parse().ok()?, csrf: csrf.to_string() })
}

fn session_cookie(cfg: &Config, value: String) -> Cookie<'static> {
    let mut c = Cookie::new(cfg.cookie_name(), value);
    c.set_path("/");
    c.set_http_only(true);
    // Lax: siteler arasi POST cerezi TASIMAZ — CSRF'in ilk katmani. Strict
    // olamaz: Google'dan donus bir siteler arasi yonlendirme.
    c.set_same_site(SameSite::Lax);
    c.set_secure(cfg.in_production());
    if let Some(d) = &cfg.cookie_domain {
        c.set_domain(d.clone()); // bir giris, uc host (KNOW-31)
    }
    c
}

pub fn open_session(jar: SignedCookieJar, cfg: &Config, user_id: Uuid) -> SignedCookieJar {
    let mut c = session_cookie(cfg, format!("{user_id}.{}", random_token()));
    c.set_max_age(time::Duration::seconds(crate::config::SESSION_MAX_AGE_SECS));
    jar.add(c)
}

/// Silme cerezi AYNI Domain ve Path ile gitmeli — yoksa tarayici baska bir
/// cerez sanar ve oturum yerinde kalir.
pub fn close_session(jar: SignedCookieJar, cfg: &Config) -> SignedCookieJar {
    jar.remove(session_cookie(cfg, String::new()))
}

/// Istekteki kullanici. Handler imzasina `user: CurrentUser` yazmak yeter;
/// `Option<CurrentUser>` giris gerektirmeyen uclar icin.
pub struct CurrentUser(pub User);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;
    async fn from_request_parts(p: &mut Parts, st: &AppState) -> Result<Self, AppError> {
        resolve(p, st).await?.map(CurrentUser).ok_or(AppError::Unauthorized)
    }
}

impl OptionalFromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;
    async fn from_request_parts(p: &mut Parts, st: &AppState) -> Result<Option<Self>, AppError> {
        Ok(resolve(p, st).await?.map(CurrentUser))
    }
}

async fn resolve(p: &Parts, st: &AppState) -> Result<Option<User>, AppError> {
    let jar = SignedCookieJar::from_headers(&p.headers, st.key.clone());
    let Some(s) = read_session(&jar, &st.cfg) else { return Ok(None) };
    // HER ISTEKTE DB: kapatilan kullanici bir sonraki istekte duser.
    let user = User::active(&st.pool, s.user_id).await?;
    if let Some(u) = &user {
        touch_presence(st, u.id).await;
    }
    Ok(user)
}

/// Varlik damgasi: kimlik cozulen her istek bir hayat belirtisi — ama her
/// istekte YAZILMAZ. SPA tek sayfa acilisinda birkac paralel istek atiyor;
/// her biri ayni satira UPDATE demekti. Kullanici basina dakikada bir yeter:
/// cevrimici esigi (on yuz `ONLINE_MS`, 2 dk) bu araligin ustunde kaldikca
/// gecikme goruntuyu bozmaz (Python `_mark_presence`, G3).
///
/// Hata yutulur — damga yazilamadi diye istek dusmemeli.
async fn touch_presence(st: &AppState, id: Uuid) {
    if !presence_due(&st.presence, id, Instant::now()) {
        return;
    }
    if let Err(e) = sqlx::query("update users set last_seen_at = now() where id = $1")
        .bind(id).execute(&st.pool).await
    {
        tracing::warn!("presence update failed: {e}");
    }
}

const PRESENCE_INTERVAL: Duration = Duration::from_secs(60);

/// Yazma sirasi geldiyse ani kaydeder ve `true` doner. Kilit await'ten ONCE
/// birakilir (std Mutex, guard await'e tasinamaz).
fn presence_due(marks: &Mutex<HashMap<Uuid, Instant>>, id: Uuid, now: Instant) -> bool {
    // Zehirli kilit yalniz bir damga kaybettirir; kurtarmak guvenli.
    let mut m = marks.lock().unwrap_or_else(|e| e.into_inner());
    if m.get(&id).is_some_and(|prev| now.duration_since(*prev) < PRESENCE_INTERVAL) {
        return false;
    }
    m.insert(id, now);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presence_written_at_most_once_per_interval_per_user() {
        let marks = Mutex::default();
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let t0 = Instant::now();
        assert!(presence_due(&marks, a, t0));
        assert!(!presence_due(&marks, a, t0 + Duration::from_secs(59)));
        assert!(presence_due(&marks, b, t0), "kullanici basina");
        assert!(presence_due(&marks, a, t0 + PRESENCE_INTERVAL), "aralik dolunca yeniden");
    }
}
