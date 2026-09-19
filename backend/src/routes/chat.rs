//! Sohbet. Mesaj + sistem bildirimi TEK kronolojik akis: `chat_feed` view'i
//! (spec/21-sema-v2.md §8), sablon `kind` uzerinden dallanir.
//! Yanit ALINTILI, anmadan ayri: anma "kime haber", yanit "hangi mesaja" (KNOW-273).
use axum::{routing::post, Router};
use crate::{handlers::chat as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        // Masaustu ve mobil AYNI handler'a girer, yol adlari farkli (tarihsel).
        .route("/item/{item_id}/message", post(h::post_message))
        .route("/record/{item_id}/message", post(h::post_message))
        .route("/team/{team_id}/message", post(h::post_team_message))
}
