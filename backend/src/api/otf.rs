//! OTF route handlers.

use axum::{
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use crate::{
    api::common::{self, Body},
    auth::CurrentUser,
    domain::otf,
    error::Result,
    state::AppState,
};

pub async fn get(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<otf::View>> {
    let id = common::id(&raw)?;
    Ok(Json(otf::get(&st, &me, id).await?))
}

pub async fn autofill(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<otf::View>> {
    let id = common::id(&raw)?;
    Ok(Json(otf::autofill(&st, &me, id).await?))
}

pub async fn put(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<otf::Input>,
) -> Result<Json<otf::View>> {
    let id = common::id(&raw)?;
    Ok(Json(otf::put(&st, &me, id, b).await?))
}

pub async fn docx(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Response> {
    let id = common::id(&raw)?;
    let file = otf::docx(&st, &me, id).await?;
    let ascii: String = file.file_name.chars().map(|c| match c {
        'Ç' => 'C', 'Ğ' => 'G', 'İ' => 'I', 'Ö' => 'O', 'Ş' => 'S', 'Ü' => 'U',
        'ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u',
        c if c.is_ascii_alphanumeric() || "._-".contains(c) => c,
        _ => '_',
    }).collect();
    let encoded: String = file.file_name.bytes().map(|b| if b.is_ascii_alphanumeric() || b"._-".contains(&b) {
        (b as char).to_string()
    } else {
        format!("%{b:02X}")
    }).collect();
    Ok((
        [
            (header::CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.wordprocessingml.document".to_string()),
            (header::CACHE_CONTROL, "no-store".into()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")),
        ],
        file.bytes,
    ).into_response())
}
