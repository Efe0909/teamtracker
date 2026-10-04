//! Yonetim > Kalite kapisi: karar modelinin sorulari ve esikleri (spec/76).
//!
//! YALNIZ admin (soru metni kayit/kapanis kararlarini degistirir). Soru adlari
//! sabit; yalniz metin ve esik. Her yazma bellekteki kopyayi da gunceller, yeniden
//! baslatma gerekmez. Degisiklik `security_events`'e yazilir (govde degil, yalniz olay).

use axum::{extract::State, http::HeaderMap, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    api::common::Body,
    audit,
    auth::CurrentUser,
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

async fn view(st: &AppState) -> Result<Json<QualityView>> {
    let row: Option<(DateTime<Utc>, Option<Uuid>)> =
        sqlx::query_as("select updated_at, updated_by from quality_config")
            .fetch_optional(&st.pool).await?;
    let config = st.quality.read().unwrap_or_else(|e| e.into_inner()).clone();
    Ok(Json(QualityView {
        config,
        defaults: QualityConfig::defaults(),
        customized: row.is_some(),
        updated_at: row.map(|r| r.0),
        updated_by: row.and_then(|r| r.1),
        service_on: st.cfg.external_on(crate::config::Service::Decision),
    }))
}

pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<QualityView>> {
    admin_only(&me)?;
    view(&st).await
}

pub async fn put(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(cfg): Body<QualityConfig>,
) -> Result<Json<QualityView>> {
    admin_only(&me)?;
    cfg.validate().map_err(AppError::BadRequest)?;
    let json = serde_json::to_value(&cfg).map_err(|_| AppError::BadRequest("invalid_body"))?;
    sqlx::query(
        "insert into quality_config (id, config, updated_by) values (true, $1, $2)
         on conflict (id) do update set config = $1, updated_by = $2, updated_at = now()")
        .bind(json).bind(me.id).execute(&st.pool).await?;
    *st.quality.write().unwrap_or_else(|e| e.into_inner()) = cfg;
    audit::log_event(&st, audit::client_ip(&headers), "quality_config_changed", Some(me.id), Some(&me.email), None).await;
    view(&st).await
}

/// Varsayilana don: satir silinir, kodun metinleri gecerli olur.
pub async fn reset(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap,
) -> Result<Json<QualityView>> {
    admin_only(&me)?;
    sqlx::query("delete from quality_config").execute(&st.pool).await?;
    *st.quality.write().unwrap_or_else(|e| e.into_inner()) = QualityConfig::defaults();
    audit::log_event(&st, audit::client_ip(&headers), "quality_config_reset", Some(me.id), Some(&me.email), None).await;
    view(&st).await
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
pub async fn try_it(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<TryIn>,
) -> Result<Json<decision::Quality>> {
    admin_only(&me)?;
    if b.state.trim().is_empty() || b.state.chars().count() > 4000 {
        return Err(AppError::BadRequest("invalid_body"));
    }
    let cfg = match b.config {
        Some(c) => { c.validate().map_err(AppError::BadRequest)?; c }
        None => st.quality.read().unwrap_or_else(|e| e.into_inner()).clone(),
    };
    Ok(Json(decision::try_with(&st, &cfg, b.kind, &b.state).await))
}
