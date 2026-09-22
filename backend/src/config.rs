//! Ortam degiskenleri — TEK yerde okunur.
//!
//! Sirlar depoda deger olarak durmaz, yalniz isim (KNOW-188). Eksik ya da
//! zayif sir YAYINDA acilisi durdurur; gelistirmede uyarip devam eder.

use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    /// Varsayilan 127.0.0.1: disariya yalniz nginx bakar (KNOW-288). Hiz
    /// siniri X-Real-IP'ye guveniyor — port disariya acilirsa baslik sahtelenir.
    pub bind: std::net::IpAddr,
    pub port: u16,
    pub secret_key: String,

    /// Host'un ILK ETIKETI ile karsilastirilir (KNOW-79). Bos ise
    /// tek-alan-adi modu: her iki yuzey de acik.
    pub host_app: String,
    pub host_dashboard: String,
    pub cookie_domain: Option<String>,

    pub auth_mode: AuthMode,
    pub google_client_id: String,
    pub google_client_secret: String,

    pub media_root: String,
    /// Bos degilse nginx X-Accel-Redirect ile servis eder; blob Rust'tan gecmez.
    pub media_accel: String,

    pub vapid_private: String,
    pub vapid_public: String,
    pub vapid_sub: String,

    pub env: Env,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AuthMode { Google, Fake }

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Env { Production, Development }

/// Oturum cerezinin 30 gunluk omru: telefondaki uygulama surekli sormasin.
pub const SESSION_MAX_AGE_SECS: i64 = 30 * 24 * 3600;

fn var(key: &str) -> String { env::var(key).unwrap_or_default() }

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let host_app = var("EKIPTAKIP_HOST_APP").to_lowercase();
        let host_dashboard = var("EKIPTAKIP_HOST_DASHBOARD").to_lowercase();

        // Yayin tespiti Python'daki kuralin aynisi: acik ENV ya da bir host
        // tanimlanmis olmasi. Host tanimlamak "bu makine disari bakiyor"
        // demektir; gelistirmede ikisi de bostur.
        let env = if var("EKIPTAKIP_ENV").to_lowercase() == "yayin"
            || !host_app.is_empty() || !host_dashboard.is_empty()
        { Env::Production } else { Env::Development };

        let auth_mode = match var("EKIPTAKIP_AUTH").to_lowercase().as_str() {
            "sahte" => AuthMode::Fake,
            _ => AuthMode::Google,
        };

        // SAHTE KIMLIK YAYINDA ACILMAZ. Python'da bu bir `and not
        // in_production()` kosuluydu; burada acilisi durduruyor — sessizce
        // kimliksiz calisan bir yayin surecinden iyidir.
        if auth_mode == AuthMode::Fake && env == Env::Production {
            return Err("EKIPTAKIP_AUTH=sahte yayinda kullanilamaz".into());
        }

        let secret_key = var("EKIPTAKIP_SECRET_KEY");
        if env == Env::Production && secret_key.len() < 32 {
            return Err("EKIPTAKIP_SECRET_KEY yayinda zorunlu (>= 32 karakter)".into());
        }

        if auth_mode == AuthMode::Google && env == Env::Production
            && (var("GOOGLE_CLIENT_ID").is_empty() || var("GOOGLE_CLIENT_SECRET").is_empty())
        {
            return Err("GOOGLE_CLIENT_ID ve GOOGLE_CLIENT_SECRET yayinda zorunlu".into());
        }

        let bind = match var("EKIPTAKIP_BIND").as_str() {
            "" => std::net::IpAddr::from([127, 0, 0, 1]),
            v => v.parse().map_err(|_| format!("EKIPTAKIP_BIND gecersiz: {v}"))?,
        };

        let database_url = env::var("DATABASE_URL")
            .map_err(|_| "DATABASE_URL tanimli degil".to_string())?;

        Ok(Config {
            database_url,
            bind,
            port: var("PORT").parse().unwrap_or(8000),
            secret_key,
            host_app, host_dashboard,
            cookie_domain: Some(var("EKIPTAKIP_COOKIE_DOMAIN")).filter(|s| !s.is_empty()),
            auth_mode,
            google_client_id: var("GOOGLE_CLIENT_ID"),
            google_client_secret: var("GOOGLE_CLIENT_SECRET"),
            media_root: Some(var("EKIPTAKIP_MEDIA_ROOT")).filter(|s| !s.is_empty())
                .unwrap_or_else(|| "var/media".into()),
            media_accel: var("EKIPTAKIP_MEDIA_ACCEL"),
            vapid_private: var("VAPID_PRIVATE"),
            vapid_public: var("VAPID_PUBLIC"),
            vapid_sub: Some(var("VAPID_SUB")).filter(|s| !s.is_empty())
                .unwrap_or_else(|| "mailto:yonetici@polonyum.com".into()),
            env,
        })
    }

    pub fn in_production(&self) -> bool { self.env == Env::Production }
    pub fn fake_identity(&self) -> bool { self.auth_mode == AuthMode::Fake }

    /// Yayinda `__Secure-` oneki. `__Host-` DEGIL: o onek Domain ozniteligini
    /// yasaklar, bizse tek girisin iki alt alan adinda gecerli olmasini
    /// istiyoruz (KNOW-31).
    pub fn cookie_name(&self) -> &'static str {
        if self.in_production() { "__Secure-ekiptakip" } else { "ekiptakip" }
    }
}
