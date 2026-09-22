//! Giris / cikis. Python karsiligi `shared/identity.py`; akis ayni, iki fark:
//!
//! - Giris formu apex'te (`polonyum.com`), Google'dan donus de orada
//!   (`/api/auth/callback`). Oturum cerezi `Domain=<alan>` ile app. ve
//!   dashboard.'a da gecer; donuste kullanici secilen yuze yonlendirilir.
//! - PKCE (S256) eklendi — OAuth guvenlik BCP'si (RFC 9700) gizli istemci
//!   icin de oneriyor.
//!
//! Hata metni YOK: yonlendirme `/?error=<kod>` ile biter, Turkce ileti on
//! yuzde (spec/15-sinirlar.md). Kodlar `LoginError`'da, on yuzde ayni birlik.
//!
//! Kimlik kanitini imza dogrulamadan aliyoruz: token Google'in token ucundan
//! DOGRUDAN TLS ile geliyor ve kullanici bilgisini userinfo ucundan o token'la
//! okuyoruz. OIDC Core 3.1.3.7 bu durumda TLS dogrulamasini yeterli sayar.

use std::net::IpAddr;

use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
};
use axum_extra::extract::cookie::{Cookie, SameSite, SignedCookieJar};
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    auth::{self, random_token},
    error::{AppError, Result},
    models::user::User,
    state::AppState,
};

const GOOGLE_AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO: &str = "https://openidconnect.googleapis.com/v1/userinfo";

/// Google'a gidis ile donus arasini tasiyan cerez: `state.verifier.dest`.
/// Host'a ozel (Domain YOK) — donus ayni host'a geliyor.
const OAUTH_COOKIE: &str = "oauth";
const OAUTH_PATH: &str = "/api/auth";

/// Girisin sonunda gidilecek yuz. Serbest URL DEGIL, iki degerli birlik:
/// acik yonlendirme (open redirect) bu yuzden imkansiz.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Dest {
    App,
    Dashboard,
}

impl Dest {
    fn as_str(self) -> &'static str {
        match self {
            Dest::App => "app",
            Dest::Dashboard => "dashboard",
        }
    }
    fn parse(s: &str) -> Option<Dest> {
        match s {
            "app" => Some(Dest::App),
            "dashboard" => Some(Dest::Dashboard),
            _ => None,
        }
    }
}

/// On yuzdeki `LoginError` birligiyle AYNI kodlar.
#[derive(Clone, Copy)]
enum LoginError {
    Cancelled,
    Failed,
    RateLimited,
    Unverified,
    Uninvited,
    Inactive,
    AccountMismatch,
}

impl LoginError {
    fn as_str(self) -> &'static str {
        match self {
            LoginError::Cancelled => "cancelled",
            LoginError::Failed => "failed",
            LoginError::RateLimited => "rate_limited",
            LoginError::Unverified => "unverified",
            LoginError::Uninvited => "uninvited",
            LoginError::Inactive => "inactive",
            LoginError::AccountMismatch => "account_mismatch",
        }
    }
}

fn to_welcome(e: LoginError) -> Redirect {
    Redirect::to(&format!("/?error={}", e.as_str()))
}

// --- istek bilgisi ------------------------------------------------------

/// nginx'in yazdigi X-Real-IP (Cloudflare'in CF-Connecting-IP'sinden). Rust
/// yalniz 127.0.0.1 dinledigi icin baslik ancak nginx'ten gelebilir.
/// Gecersiz deger `None`: `inet` sutununa yazilamaz.
fn client_ip(h: &HeaderMap) -> Option<IpAddr> {
    h.get("x-real-ip")?.to_str().ok()?.trim().parse().ok()
}

fn rate_limited(st: &AppState, h: &HeaderMap) -> bool {
    let key = client_ip(h).map_or_else(|| "unknown".to_string(), |ip| ip.to_string());
    !st.login_limit.allow(&key)
}

/// Google'a verilecek donus adresi, istegin kendi Host'undan. Guvenli cunku
/// (1) nginx yalniz tanidigi server_name'leri kabul ediyor, (2) Google yalniz
/// konsolda KAYITLI adresleri kabul ediyor — uydurma Host girisi bitirir.
fn redirect_uri(st: &AppState, h: &HeaderMap) -> Option<String> {
    let host = h.get(header::HOST)?.to_str().ok()?;
    let valid = !host.is_empty()
        && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'));
    if !valid {
        return None;
    }
    let scheme = if st.cfg.in_production() { "https" } else { "http" };
    Some(format!("{scheme}://{host}{OAUTH_PATH}/callback"))
}

/// Girisin sonu: secilen yuzun kok adresi. Host tanimli degilse (tek alan
/// adi gelistirme) ayni host'un koku.
fn dest_url(st: &AppState, dest: Dest) -> String {
    let host = match dest {
        Dest::App => &st.cfg.host_app,
        Dest::Dashboard => &st.cfg.host_dashboard,
    };
    if host.is_empty() {
        "/".to_string()
    } else {
        let scheme = if st.cfg.in_production() { "https" } else { "http" };
        format!("{scheme}://{host}/")
    }
}

/// Kim girdi, kim reddedildi. Govde tutulmaz (spec/70 §8). Yazilamazsa
/// istek DUSMEZ, loga yazilir.
async fn log_event(
    st: &AppState, h: &HeaderMap, event_type: &str,
    actor: Option<Uuid>, email: Option<&str>, detail: Option<&str>,
) {
    let ip = client_ip(h).map(|ip| ip.to_string());
    let res = sqlx::query(
        "insert into security_events (event_type, actor_id, email, ip, detail) \
         values ($1, $2, $3, $4::inet, $5)")
        .bind(event_type).bind(actor).bind(email).bind(ip).bind(detail)
        .execute(&st.pool).await;
    if let Err(e) = res {
        tracing::error!("security_events insert failed: {e}");
    }
}

fn oauth_cookie(st: &AppState, value: String) -> Cookie<'static> {
    let mut c = Cookie::new(OAUTH_COOKIE, value);
    c.set_path(OAUTH_PATH);
    c.set_http_only(true);
    // Lax: Google'dan donus ust-duzey GET yonlendirmesi, Lax cerezi tasir.
    c.set_same_site(SameSite::Lax);
    c.set_secure(st.cfg.in_production());
    c
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

// --- uclar --------------------------------------------------------------

#[derive(Deserialize)]
pub struct StartQuery {
    next: Dest,
}

/// `GET /api/auth/google?next=app|dashboard` — Google'a gonderir.
pub async fn google_start(
    State(st): State<AppState>, jar: SignedCookieJar, h: HeaderMap, Query(q): Query<StartQuery>,
) -> Result<Response> {
    if st.cfg.fake_identity() {
        return Err(AppError::NotFound);
    }
    if rate_limited(&st, &h) {
        log_event(&st, &h, "login_denied", None, None, Some("rate limit")).await;
        return Ok(to_welcome(LoginError::RateLimited).into_response());
    }
    let redirect = redirect_uri(&st, &h).ok_or(AppError::BadRequest("invalid_host"))?;

    let state = random_token();
    // PKCE dogrulayicisi: 64 onaltilik karakter, RFC 7636'nin 43-128 araliginda.
    let verifier = random_token();
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));

    let url = reqwest::Url::parse_with_params(GOOGLE_AUTH, &[
        ("client_id", st.cfg.google_client_id.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("response_type", "code"),
        ("scope", "openid email profile"), // hassas kapsam YOK (KNOW-92)
        ("state", state.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        // Birden cok Google hesabi olan telefonda yanlis hesapla sessizce
        // girmesin.
        ("prompt", "select_account"),
    ]).map_err(|_| AppError::BadRequest("invalid_config"))?;

    let mut c = oauth_cookie(&st, format!("{state}.{verifier}.{}", q.next.as_str()));
    c.set_max_age(time::Duration::minutes(10));
    Ok((jar.add(c), Redirect::to(url.as_str())).into_response())
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct UserInfo {
    sub: String,
    email: Option<String>,
    #[serde(default)]
    email_verified: bool,
}

/// `GET /api/auth/callback` — Google'dan donus.
pub async fn google_callback(
    State(st): State<AppState>, jar: SignedCookieJar, h: HeaderMap, Query(q): Query<CallbackQuery>,
) -> Result<Response> {
    if st.cfg.fake_identity() {
        return Err(AppError::NotFound);
    }
    if rate_limited(&st, &h) {
        log_event(&st, &h, "login_denied", None, None, Some("rate limit")).await;
        return Ok(to_welcome(LoginError::RateLimited).into_response());
    }

    // Cerez tek kullanimlik: her sonucta silinir.
    let saved = jar.get(OAUTH_COOKIE).map(|c| c.value().to_string());
    let jar = jar.remove(oauth_cookie(&st, String::new()));
    let fail = |jar: SignedCookieJar, e: LoginError| Ok((jar, to_welcome(e)).into_response());

    if q.error.is_some() {
        // Kullanici Google ekraninda vazgecti.
        return fail(jar, LoginError::Cancelled);
    }
    let parts = saved.as_deref().and_then(|v| {
        let mut it = v.splitn(3, '.');
        Some((it.next()?, it.next()?, Dest::parse(it.next()?)?))
    });
    let (Some((state, verifier, dest)), Some(code), Some(sent_state)) = (parts, q.code.as_deref(), q.state.as_deref())
    else {
        log_event(&st, &h, "login_denied", None, None, Some("oauth: missing state")).await;
        return fail(jar, LoginError::Failed);
    };
    if state != sent_state {
        log_event(&st, &h, "login_denied", None, None, Some("oauth: state mismatch")).await;
        return fail(jar, LoginError::Failed);
    }
    let Some(redirect) = redirect_uri(&st, &h) else {
        return fail(jar, LoginError::Failed);
    };

    let info = match exchange(&st, code, verifier, &redirect).await {
        Ok(i) => i,
        Err(what) => {
            tracing::warn!("google login failed: {what}");
            log_event(&st, &h, "login_denied", None, None, Some(&format!("oauth: {what}"))).await;
            return fail(jar, LoginError::Failed);
        }
    };
    let email = match (&info.email, info.email_verified) {
        (Some(e), true) => e.clone(),
        _ => {
            log_event(&st, &h, "login_denied", None, info.email.as_deref(), Some("email not verified")).await;
            return fail(jar, LoginError::Unverified);
        }
    };

    let user_id = match can_enter(&st, &email, &info.sub).await? {
        Ok(id) => id,
        Err(e) => {
            log_event(&st, &h, "login_denied", None, Some(&email), Some(e.as_str())).await;
            return fail(jar, e);
        }
    };

    // Ilk giriste google_sub baglanir. Ayni sub farkli e-postayla gelirse
    // e-posta GUNCELLENIR: kimligin capasi sub (identity.py handle_login).
    sqlx::query("update users set google_sub = $1, email = $2, last_login_at = now() where id = $3")
        .bind(&info.sub).bind(&email).bind(user_id)
        .execute(&st.pool).await?;

    let jar = auth::open_session(jar, &st.cfg, user_id);
    log_event(&st, &h, "login", Some(user_id), Some(&email), None).await;
    Ok((jar, Redirect::to(&dest_url(&st, dest))).into_response())
}

/// Kod -> token -> kullanici bilgisi. Hata: log icin kisa aciklama.
async fn exchange(st: &AppState, code: &str, verifier: &str, redirect: &str) -> std::result::Result<UserInfo, String> {
    let token: TokenResponse = st.http.post(GOOGLE_TOKEN)
        .form(&[
            ("code", code),
            ("client_id", st.cfg.google_client_id.as_str()),
            ("client_secret", st.cfg.google_client_secret.as_str()),
            ("redirect_uri", redirect),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier),
        ])
        .send().await.map_err(|e| format!("token request: {e}"))?
        .error_for_status().map_err(|e| format!("token status: {e}"))?
        .json().await.map_err(|e| format!("token body: {e}"))?;

    st.http.get(GOOGLE_USERINFO)
        .bearer_auth(&token.access_token)
        .send().await.map_err(|e| format!("userinfo request: {e}"))?
        .error_for_status().map_err(|e| format!("userinfo status: {e}"))?
        .json().await.map_err(|e| format!("userinfo body: {e}"))
}

#[derive(sqlx::FromRow)]
struct Candidate {
    id: Uuid,
    google_sub: Option<String>,
    is_active: bool,
}

/// Davetli listesi: `users`'ta olmayan e-posta GIREMEZ, kullanici burada
/// olusturulmaz (KNOW-94, spec/70 §2.3). Dis `Result` veritabani hatasi,
/// ic `Result` karar.
async fn can_enter(st: &AppState, email: &str, sub: &str) -> Result<std::result::Result<Uuid, LoginError>> {
    let by_sub: Option<Candidate> =
        sqlx::query_as("select id, google_sub, is_active from users where google_sub = $1")
            .bind(sub).fetch_optional(&st.pool).await?;
    let found = match by_sub {
        Some(c) => Some(c),
        None => sqlx::query_as("select id, google_sub, is_active from users where lower(email) = lower($1)")
            .bind(email).fetch_optional(&st.pool).await?,
    };
    let Some(c) = found else { return Ok(Err(LoginError::Uninvited)) };
    if c.google_sub.as_deref().is_some_and(|s| s != sub) {
        // E-posta ayni, Google hesabi baska: adres devredilmis olabilir.
        return Ok(Err(LoginError::AccountMismatch));
    }
    if !c.is_active {
        return Ok(Err(LoginError::Inactive));
    }
    Ok(Ok(c.id))
}

/// `POST /api/auth/logout` — CSRF kapisindan gecer. POST: GET olsaydi
/// `<img src=...>` ile herkes attirilabilirdi.
pub async fn logout(State(st): State<AppState>, jar: SignedCookieJar, h: HeaderMap) -> Response {
    let uid = auth::read_session(&jar, &st.cfg).map(|s| s.user_id);
    let jar = auth::close_session(jar, &st.cfg);
    if let Some(id) = uid {
        log_event(&st, &h, "logout", Some(id), None, None).await;
    }
    (jar, StatusCode::NO_CONTENT).into_response()
}

#[derive(Deserialize)]
pub struct DevLoginQuery {
    user_id: Uuid,
}

/// `GET /api/auth/dev-login?user_id=` — YALNIZ sahte kimlikte (Config
/// yayinda sahte kimligi acilista reddediyor). GET, cunku on yuz hedef
/// host'a (app./dashboard.) GIDEREK oturum acmali: gelistirmede `localhost`
/// cerezi alt alan adlarina paylasilamiyor.
pub async fn dev_login(
    State(st): State<AppState>, jar: SignedCookieJar, Query(q): Query<DevLoginQuery>,
) -> Result<Response> {
    if !st.cfg.fake_identity() {
        return Err(AppError::NotFound);
    }
    let user = User::active(&st.pool, q.user_id).await?.ok_or(AppError::NotFound)?;
    Ok((auth::open_session(jar, &st.cfg, user.id), Redirect::to("/")).into_response())
}
