//! Yonetim > Veri isleme ve LLM > Kalite kapisi: karar modelinin sorulari ve esikleri (spec/76).
//!
//! YALNIZ admin (soru metni kayit/kapanis kararlarini degistirir). Soru adlari
//! sabit; yalniz metin ve esik. Her yazma bellekteki kopyayi da gunceller, yeniden
//! baslatma gerekmez. Degisiklik `security_events`'e yazilir (govde degil, yalniz olay).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::quality as db,
    decision::{self, QualityConfig},
    error::{AppError, Result},
    models::user::User,
    state::AppState,
};

#[derive(Serialize)]
pub struct QualityView {
    /// Su an gecerli olan.
    config: QualityConfig,
    /// Kodun varsayilani ("Varsayilana don" ve farki gostermek icin).
    defaults: QualityConfig,
    /// Duzenlenmis mi: false ise satir yok, varsayilan calisiyor.
    customized: bool,
    updated_at: Option<DateTime<Utc>>,
    updated_by: Option<Uuid>,
    /// Anahtar/manifest nedeniyle kalite kapisi calisiyor mu (`false` ise "Dene" bos doner).
    service_on: bool,
}

fn admin_only(me: &User) -> Result<()> {
    if me.is_admin { Ok(()) } else { Err(AppError::Forbidden) }
}

async fn view(st: &AppState) -> Result<QualityView> {
    let row = db::find_metadata(&st.pool).await?;
    let config = st.quality.read().unwrap_or_else(|e| e.into_inner()).clone();
    Ok(QualityView {
        config,
        defaults: QualityConfig::defaults(),
        customized: row.is_some(),
        updated_at: row.map(|r| r.0),
        updated_by: row.and_then(|r| r.1),
        service_on: st.cfg.external_on(crate::config::Service::Decision),
    })
}

pub(crate) async fn get(st: &AppState, me: &User) -> Result<QualityView> {
    admin_only(me)?;
    view(st).await
}

pub(crate) async fn put(st: &AppState, me: &User, ip: Option<std::net::IpAddr>, cfg: QualityConfig) -> Result<QualityView> {
    admin_only(me)?;
    cfg.validate().map_err(AppError::BadRequest)?;
    let json = serde_json::to_value(&cfg).map_err(|_| AppError::BadRequest("invalid_body"))?;
    db::upsert_config(&st.pool, json, me.id).await?;
    *st.quality.write().unwrap_or_else(|e| e.into_inner()) = cfg;
    crate::audit::log_event(st, ip, "quality_config_changed", Some(me.id), Some(&me.email), None).await;
    view(st).await
}

/// Varsayilana don: satir silinir, kodun metinleri gecerli olur.
pub(crate) async fn reset(st: &AppState, me: &User, ip: Option<std::net::IpAddr>) -> Result<QualityView> {
    admin_only(me)?;
    db::delete_config(&st.pool).await?;
    *st.quality.write().unwrap_or_else(|e| e.into_inner()) = QualityConfig::defaults();
    crate::audit::log_event(st, ip, "quality_config_reset", Some(me.id), Some(&me.email), None).await;
    view(st).await
}

#[derive(Deserialize)]
pub struct TryIn {
    kind: decision::Kind,
    /// Modelin okuyacagi metin, kapi ile ayni biçimde ("Başlık: ..\nAçıklama: .." ya da "Kayıt: ..\nKapanış notu: ..").
    state: String,
    /// Kaydedilmemis taslak; yoksa gecerli yapilandirma.
    #[serde(default)]
    config: Option<QualityConfig>,
}

/// Taslak sorularla tek deneme. Kaydetmez, kayit akisina yazmaz.
pub(crate) async fn try_it(st: &AppState, me: &User, b: TryIn) -> Result<decision::Quality> {
    admin_only(me)?;
    if b.state.trim().is_empty() || b.state.chars().count() > 4000 {
        return Err(AppError::BadRequest("invalid_body"));
    }
    let cfg = match b.config {
        Some(c) => { c.validate().map_err(AppError::BadRequest)?; c }
        None => st.quality.read().unwrap_or_else(|e| e.into_inner()).clone(),
    };
    Ok(decision::try_with(st, me.id, &cfg, b.kind, &b.state).await)
}
