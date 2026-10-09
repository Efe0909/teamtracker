//! Yonetim > Veri isleme ve LLM: modele giden etkinlik verisinin temizleme kurallari.
//!
//! YALNIZ admin. Tek satir (`llm_config`); satir yoksa kodun varsayilani gecerli.
//! Her istek satiri okur (tek kucuk satir), bellek kopyasi yok. Degisiklik
//! `security_events`'e yazilir (govde degil, yalniz olay).

use axum::{extract::State, http::HeaderMap, Json};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    api::common::Body,
    audit,
    auth::CurrentUser,
    error::{AppError, Result},
    models::user::User,
    redact::LlmConfig,
    state::AppState,
};

#[derive(Serialize)]
pub struct LlmView {
    /// Su an gecerli olan.
    config: LlmConfig,
    /// Kodun varsayilani ("Varsayilana don" ve farki gostermek icin).
    defaults: LlmConfig,
    /// Duzenlenmis mi: false ise satir yok, varsayilan calisiyor.
    customized: bool,
    updated_at: Option<DateTime<Utc>>,
    updated_by: Option<Uuid>,
}

fn admin_only(me: &User) -> Result<()> {
    if me.is_admin { Ok(()) } else { Err(AppError::Forbidden) }
}

/// Gecerli yapilandirma. Satirdaki JSON okunamazsa (sema degisti) varsayilan.
pub(crate) async fn load(pool: &PgPool) -> Result<LlmConfig> {
    let row: Option<serde_json::Value> = sqlx::query_scalar("select config from llm_config")
        .fetch_optional(pool).await?;
    Ok(row.and_then(|v| serde_json::from_value(v).ok()).unwrap_or_else(LlmConfig::defaults))
}

async fn view(st: &AppState) -> Result<Json<LlmView>> {
    let row: Option<(DateTime<Utc>, Option<Uuid>)> =
        sqlx::query_as("select updated_at, updated_by from llm_config").fetch_optional(&st.pool).await?;
    Ok(Json(LlmView {
        config: load(&st.pool).await?,
        defaults: LlmConfig::defaults(),
        customized: row.is_some(),
        updated_at: row.map(|r| r.0),
        updated_by: row.and_then(|r| r.1),
    }))
}

pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<LlmView>> {
    admin_only(&me)?;
    view(&st).await
}

pub async fn put(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(cfg): Body<LlmConfig>,
) -> Result<Json<LlmView>> {
    admin_only(&me)?;
    let json = serde_json::to_value(&cfg).map_err(|_| AppError::BadRequest("invalid_body"))?;
    sqlx::query(
        "insert into llm_config (id, config, updated_by) values (true, $1, $2)
         on conflict (id) do update set config = $1, updated_by = $2, updated_at = now()")
        .bind(json).bind(me.id).execute(&st.pool).await?;
    audit::log_event(&st, audit::client_ip(&headers), "llm_config_changed", Some(me.id), Some(&me.email), None).await;
    view(&st).await
}

/// Varsayilana don: satir silinir.
pub async fn reset(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap,
) -> Result<Json<LlmView>> {
    admin_only(&me)?;
    sqlx::query("delete from llm_config").execute(&st.pool).await?;
    audit::log_event(&st, audit::client_ip(&headers), "llm_config_reset", Some(me.id), Some(&me.email), None).await;
    view(&st).await
}
