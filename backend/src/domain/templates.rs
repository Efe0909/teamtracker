//! Maliye > mail sablonlari (spec/81 §9, §3.9): `.html`/`.md` govdesi saklanir; degiskenler
//! (`{{ad:tur}}`) saklanmaz, govdeden okunur ve cizim ISTEMCIDE yapilir. Uygulama mail
//! gondermez. Sablon yazmak maliye gorebilen herkese acik (spec/81 §11).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::finance::need_viewer;
use crate::{
    domain::common,
    error::{AppError, Result},
    state::AppState,
};

const BODY_MAX: usize = 262_144;

#[derive(Serialize, sqlx::FromRow)]
pub struct Template {
    id: Uuid,
    name: String,
    format: String,
    body: String,
    updated_at: DateTime<Utc>,
}

pub(crate) async fn list(st: &AppState, me: &crate::models::user::User) -> Result<Vec<Template>> {
    need_viewer(st, me).await?;
    Ok(sqlx::query_as("select id, name, format, body, updated_at from mail_templates order by name")
        .fetch_all(&st.pool).await?)
}

#[derive(Deserialize)]
pub struct TemplateIn {
    name: String,
    format: String,
    body: String,
}

fn check(b: &TemplateIn) -> Result<String> {
    let name = common::text(Some(b.name.clone()), 120, "invalid_name")?.ok_or(AppError::BadRequest("invalid_name"))?;
    if b.format != "html" && b.format != "md" {
        return Err(AppError::BadRequest("invalid_format"));
    }
    if b.body.trim().is_empty() || b.body.len() > BODY_MAX {
        return Err(AppError::BadRequest("invalid_body"));
    }
    Ok(name)
}

async fn one(st: &AppState, id: Uuid) -> Result<Template> {
    sqlx::query_as("select id, name, format, body, updated_at from mail_templates where id = $1")
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)
}

pub(crate) async fn create(st: &AppState, me: &crate::models::user::User, b: TemplateIn) -> Result<Template> {
    need_viewer(st, me).await?;
    let name = check(&b)?;
    let taken: bool = sqlx::query_scalar("select exists(select 1 from mail_templates where name = $1)")
        .bind(&name).fetch_one(&st.pool).await?;
    if taken {
        return Err(AppError::Conflict("template_exists"));
    }
    let id: Uuid = sqlx::query_scalar(
        "insert into mail_templates (name, format, body, created_by) values ($1, $2, $3, $4) returning id")
        .bind(&name).bind(&b.format).bind(&b.body).bind(me.id).fetch_one(&st.pool).await?;
    one(st, id).await
}

pub(crate) async fn replace(st: &AppState, me: &crate::models::user::User, id: Uuid, b: TemplateIn) -> Result<Template> {
    need_viewer(st, me).await?;
    let name = check(&b)?;
    let taken: bool = sqlx::query_scalar("select exists(select 1 from mail_templates where name = $1 and id <> $2)")
        .bind(&name).bind(id).fetch_one(&st.pool).await?;
    if taken {
        return Err(AppError::Conflict("template_exists"));
    }
    let n = sqlx::query("update mail_templates set name = $2, format = $3, body = $4, updated_at = now() where id = $1")
        .bind(id).bind(&name).bind(&b.format).bind(&b.body).execute(&st.pool).await?.rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    one(st, id).await
}

pub(crate) async fn delete(st: &AppState, me: &crate::models::user::User, id: Uuid) -> Result<serde_json::Value> {
    need_viewer(st, me).await?;
    let n = sqlx::query("delete from mail_templates where id = $1")
        .bind(id).execute(&st.pool).await?.rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(serde_json::json!({ "deleted": true }))
}
