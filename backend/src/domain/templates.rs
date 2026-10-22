//! Maliye > mail sablonlari (spec/81 §9, §3.9): `.html`/`.md` govdesi saklanir; degiskenler
//! (`{{ad:tur}}`) saklanmaz, govdeden okunur ve cizim ISTEMCIDE yapilir. Uygulama mail
//! gondermez. Sablon yazmak maliye gorebilen herkese acik (spec/81 §11).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::finance::need_viewer;
use crate::{
    db::templates as db,
    domain::common,
    error::{AppError, Result},
    state::AppState,
};

const BODY_MAX: usize = 262_144;

#[derive(Serialize)]
pub struct Template {
    id: Uuid,
    name: String,
    format: String,
    body: String,
    updated_at: DateTime<Utc>,
}

impl From<db::TemplateRow> for Template {
    fn from(r: db::TemplateRow) -> Self {
        Self { id: r.id, name: r.name, format: r.format, body: r.body, updated_at: r.updated_at }
    }
}

pub(crate) async fn list(st: &AppState, me: &crate::models::user::User) -> Result<Vec<Template>> {
    need_viewer(st, me).await?;
    Ok(db::list_templates(&st.pool).await?.into_iter().map(Template::from).collect())
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
    db::find_template(&st.pool, id).await?.map(Template::from).ok_or(AppError::NotFound)
}

pub(crate) async fn create(st: &AppState, me: &crate::models::user::User, b: TemplateIn) -> Result<Template> {
    need_viewer(st, me).await?;
    let name = check(&b)?;
    let taken = db::has_name(&st.pool, &name).await?;
    if taken {
        return Err(AppError::Conflict("template_exists"));
    }
    let id = db::insert_template(&st.pool, &name, &b.format, &b.body, me.id).await?;
    one(st, id).await
}

pub(crate) async fn replace(st: &AppState, me: &crate::models::user::User, id: Uuid, b: TemplateIn) -> Result<Template> {
    need_viewer(st, me).await?;
    let name = check(&b)?;
    let taken = db::has_other_name(&st.pool, &name, id).await?;
    if taken {
        return Err(AppError::Conflict("template_exists"));
    }
    let n = db::update_template(&st.pool, id, &name, &b.format, &b.body).await?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    one(st, id).await
}

pub(crate) async fn delete(st: &AppState, me: &crate::models::user::User, id: Uuid) -> Result<serde_json::Value> {
    need_viewer(st, me).await?;
    let n = db::delete_template(&st.pool, id).await?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(serde_json::json!({ "deleted": true }))
}
