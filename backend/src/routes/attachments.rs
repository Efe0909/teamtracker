//! Ek uclari. Blob'lar dosya sisteminde (KNOW-230); gosterim X-Accel ile.
use axum::{routing::{delete, get, post}, Router};
use crate::{handlers::attachments as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/media/{attachment_id}", get(h::serve).delete(h::remove))
        .route("/media/{attachment_id}/thumb", get(h::serve_thumb))
        .route("/media/{attachment_id}/tags", post(h::add_tag))
        .route("/media/{attachment_id}/tags/{tag_id}", delete(h::remove_tag))
}
