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

    /// Resend: anahtar bos ise posta yalniz kuyrukta bekler.
    pub mail_api_key: String,
    pub mail_from: String,
    pub mail_api_url: String,

    /// OTF formundaki kulup adi ve dosya/konu adindaki kisa ad
    /// (KULUPADI_25EKIM_OTF.docx, kulubun duyurusu).
    pub club_name: String,
    pub club_code: String,

    /// Ilk yonetici listesinin DOSYA yolu (KNOW-320): satir basina bir
    /// e-posta. Icerik degil yol: liste agenix sirri, ortamda gorunmesin.
    pub bootstrap_admins_file: Option<String>,

    /// Karar modeli (spec/76): anahtar bos ise kalite kontrolu KAPALI.
    pub decision_key: String,
    pub decision_model: String,
    /// Malzeme onerisi modeli (spec/79 §9); ayni `OPENROUTER_API_KEY`.
    pub suggest_model: String,
    /// Manifest `external_off`: elle kapatilan dis servisler (KNOW-358).
    pub external_off: Vec<String>,

    /// Manifest: uygulama surumu ve gelistirici e-postasi (`/api/meta`).
    pub version: String,
    pub contact_email: String,

    pub env: Env,
}

/// Dis servisler. Kapali olan ya azalir (decision: yalniz uzunluk kurali)
/// ya da hic calismaz (resend: kuyrukta bekler, push: liste calisir, suggest: oneri cikmaz).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Service { Decision, Resend, Push, Suggest }

impl Service {
    pub const ALL: [Service; 4] = [Service::Decision, Service::Resend, Service::Push, Service::Suggest];
    pub fn key(self) -> &'static str {
        match self {
            Service::Decision => "decision", Service::Resend => "resend", Service::Push => "push",
            Service::Suggest => "suggest",
        }
    }
}

fn listed(off: &[String], s: Service) -> bool {
    off.iter().any(|o| o == "all" || o == s.key())
}

/// Gizli OLMAYAN ayarlar (`backend/manifest.json`). Sirlar agenix ortam
/// dosyasinda kalir; bunlar ise degisince sifrelemeyle ugrasilmasin diye
/// burada. Varsayilan gomulu kopya; `EKIPTAKIP_MANIFEST` bir dosya yolu
/// verirse (NixOS modulu `manifest` secenegi) ikili yeniden derlenmeden o okunur.
#[derive(serde::Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub version: String,
    /// Gelistirici iletisimi: web push `sub` varsayilani ve kisisel veri notundaki adres.
    pub contact_email: String,
    /// `all` ya da `decision` | `resend` | `push` | `suggest`; bilinmeyen ad acilisi durdurur.
    pub external_off: Vec<String>,
    pub decision_model: String,
    /// Varsayilanli: alan sonradan geldi, ~/nix'teki mevcut manifest bilmiyor; zorunlu olsa acilis duserdi.
    #[serde(default = "default_suggest_model")]
    pub suggest_model: String,
}

fn default_suggest_model() -> String {
    "deepseek/deepseek-v4.1-flash".into()
}

const EMBEDDED_MANIFEST: &str = include_str!("../manifest.json");

impl Manifest {
    pub fn load() -> Result<Self, String> {
        let raw = match var("EKIPTAKIP_MANIFEST").as_str() {
            "" => EMBEDDED_MANIFEST.to_string(),
            path => std::fs::read_to_string(path)
                .map_err(|e| format!("EKIPTAKIP_MANIFEST okunamadi ({path}): {e}"))?,
        };
        Self::parse(&raw)
    }

    fn parse(raw: &str) -> Result<Self, String> {
        let mut m: Manifest = serde_json::from_str(raw).map_err(|e| format!("manifest.json gecersiz: {e}"))?;
        m.external_off = m.external_off.iter().map(|s| s.trim().to_lowercase()).collect();
        if let Some(bad) = m.external_off.iter().find(|o| *o != "all" && !Service::ALL.iter().any(|s| s.key() == *o)) {
            return Err(format!("manifest.json external_off: bilinmeyen servis '{bad}'"));
        }
        Ok(m)
    }
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

        let manifest = Manifest::load()?;
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
            mail_api_key: var("RESEND_API_KEY"),
            mail_from: Some(var("MAIL_FROM")).filter(|s| !s.is_empty())
                .unwrap_or_else(|| "EkipTakip <ozumaker@polonyum.com>".into()),
            mail_api_url: Some(var("RESEND_API_URL")).filter(|s| !s.is_empty())
                .unwrap_or_else(|| "https://api.resend.com/emails".into()),
            vapid_sub: Some(var("VAPID_SUB")).filter(|s| !s.is_empty())
                .unwrap_or_else(|| format!("mailto:{}", manifest.contact_email)),
            bootstrap_admins_file: Some(var("EKIPTAKIP_BOOTSTRAP_ADMINS_FILE")).filter(|s| !s.is_empty()),
            club_name: Some(var("EKIPTAKIP_CLUB_NAME")).filter(|s| !s.is_empty())
                .unwrap_or_else(|| "ÖzÜ Maker Kulübü".into()),
            club_code: Some(var("EKIPTAKIP_CLUB_CODE")).filter(|s| !s.is_empty())
                .unwrap_or_else(|| "OZUMAKER".into()),
            decision_key: var("OPENROUTER_API_KEY"),
            decision_model: manifest.decision_model,
            suggest_model: manifest.suggest_model,
            external_off: manifest.external_off,
            version: manifest.version,
            contact_email: manifest.contact_email,
            env,
        })
    }

    /// TEK KAPI: servis listede degil VE anahtari/yapilandirmasi var.
    pub fn external_on(&self, s: Service) -> bool {
        let configured = match s {
            // Oneri ve karar ayni OpenRouter anahtarini kullanir; kill switch'leri ayri.
            Service::Decision | Service::Suggest => !self.decision_key.is_empty(),
            Service::Resend => !self.mail_api_key.is_empty(),
            Service::Push => !self.vapid_private.is_empty(),
        };
        configured && !listed(&self.external_off, s)
    }

    /// `/api/meta`: on yuz kapali servisi ACIKCA soyler (sessiz dusus yok).
    pub fn external_off_keys(&self) -> Vec<&'static str> {
        Service::ALL.into_iter().filter(|s| !self.external_on(*s)).map(Service::key).collect()
    }

    /// Davet postasindaki baglantilar: yapilandirilmis host'lar, yoksa yerel gelistirme.
    pub fn app_url(&self) -> String {
        self.url_of(&self.host_app, "app.localhost:5173")
    }
    pub fn dashboard_url(&self) -> String {
        self.url_of(&self.host_dashboard, "dashboard.localhost:5173")
    }
    fn url_of(&self, host: &str, dev: &str) -> String {
        if host.is_empty() { format!("http://{dev}") } else { format!("https://{host}") }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(off: &str) -> Result<Manifest, String> {
        Manifest::parse(&format!(
            r#"{{"version":"1.2.3","contact_email":"a@b.c","external_off":{off},"decision_model":"m"}}"#))
    }

    #[test]
    fn dis_servis_listesi() {
        let off = manifest(r#"[" Decision ","push"]"#).unwrap().external_off;
        assert_eq!(off, ["decision", "push"]);
        assert!(listed(&off, Service::Decision) && listed(&off, Service::Push));
        assert!(!listed(&off, Service::Resend));
        let all = manifest(r#"["ALL"]"#).unwrap().external_off;
        assert!(Service::ALL.iter().all(|s| listed(&all, *s)));
        assert!(manifest("[]").unwrap().external_off.is_empty());
        // Yazim hatasi sessizce "acik" birakmaz.
        assert!(manifest(r#"["desicion"]"#).is_err());
    }

    /// ~/nix'teki mevcut manifest `suggest_model`'i bilmiyor: yine de acilmali (varsayilan model),
    /// `suggest` ayri kapatilabilmeli.
    #[test]
    fn eski_manifest_oneri_modeli_olmadan_acilir() {
        let old = r#"{"version":"1","contact_email":"a@b.c","external_off":["suggest"],"decision_model":"m"}"#;
        let m = Manifest::parse(old).unwrap();
        assert_eq!(m.suggest_model, "deepseek/deepseek-v4.1-flash");
        assert!(listed(&m.external_off, Service::Suggest) && !listed(&m.external_off, Service::Decision));
    }

    /// Gomulu manifest gecerli ve surum tek yerde: Cargo.toml + package.json ayni.
    #[test]
    fn gomulu_manifest_ve_surum_tutarli() {
        let m = Manifest::parse(EMBEDDED_MANIFEST).unwrap();
        assert_eq!(m.version, env!("CARGO_PKG_VERSION"), "manifest.json ile Cargo.toml surumu ayristi");
        let pkg: serde_json::Value = serde_json::from_str(include_str!("../../frontend/package.json")).unwrap();
        assert_eq!(pkg["version"], m.version.as_str(), "manifest.json ile package.json surumu ayristi");
    }
}
