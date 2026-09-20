//! Kart bloklari. Kart = onceden tanimli HTML sablonu + onu dolduran JSON blob.
use axum::{routing::{patch, post}, Router};
use crate::{handlers::cards as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/record/{record_id}/card", post(h::create))
        .route("/card/{card_id}", patch(h::update).delete(h::remove))
        // Katilim YAZMA YETKISI ISTEMEZ — bilerek: kaydi duzenleyemeyen biri de
        // kendi adina "geliyorum" diyebilmeli. Yazilan tek sey KENDI satiri.
        .route("/card/{card_id}/signup", post(h::signup))
        .route("/card/{card_id}/media", post(h::add_media))
}
