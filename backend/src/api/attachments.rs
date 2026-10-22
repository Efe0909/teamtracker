//! HTTP handlers for attachment upload, download, deletion, and tags.

use axum::{
    body::Bytes,
    extract::{rejection::BytesRejection, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};

use crate::{
    api::common::Body,
    auth::CurrentUser,
    domain::attachments::{self, ServedAttachment, TagIn, TagOut, UploadQuery},
    error::{AppError, Result},
    state::AppState,
};

#[allow(unused_imports)]
pub(crate) use crate::domain::attachments::{can_tag, claimable, claimable_for, views, AttachView};

pub async fn upload(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<UploadQuery>,
    body: std::result::Result<Bytes, BytesRejection>,
) -> Result<Json<AttachView>> {
    let bytes = body.map_err(|_| AppError::BadRequest("file_too_big"))?;
    Ok(Json(attachments::upload(&st, &me, q, bytes.to_vec()).await?))
}

async fn file_response(result: ServedAttachment) -> Response {
    let mut response = (
        [
            (header::CONTENT_TYPE, result.content_type),
            (header::CACHE_CONTROL, "private, max-age=31536000, immutable".to_string()),
            (header::CONTENT_DISPOSITION, result.disposition),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        result.bytes,
    ).into_response();
    if result.sandbox {
        response.headers_mut().insert(header::CONTENT_SECURITY_POLICY, header::HeaderValue::from_static("sandbox"));
    }
    response
}

pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Response> {
    let id = crate::api::common::id(&raw)?;
    Ok(file_response(attachments::serve(&st, &me, id, false).await?).await)
}

pub async fn thumb(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Response> {
    let id = crate::api::common::id(&raw)?;
    Ok(file_response(attachments::serve(&st, &me, id, true).await?).await)
}

pub async fn delete(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<StatusCode> {
    let id = crate::api::common::id(&raw)?;
    attachments::delete(&st, &me, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn tags(State(st): State<AppState>, CurrentUser(_): CurrentUser) -> Result<Json<Vec<TagOut>>> {
    Ok(Json(attachments::tags(&st).await?))
}

pub async fn add_tag(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<TagIn>,
) -> Result<Json<AttachView>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(attachments::add_tag(&st, &me, id, b).await?))
}

pub async fn remove_tag(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, tag)): Path<(String, String)>,
) -> Result<Json<AttachView>> {
    let id = crate::api::common::id(&raw)?;
    let tag = crate::api::common::id(&tag)?;
    Ok(Json(attachments::remove_tag(&st, &me, id, tag).await?))
}
