//! Sohbet. Mesaj + sistem bildirimi TEK kronolojik akis: `chat_feed` view'i
//! (spec/21-sema-v2.md §8), sablon `kind` uzerinden dallanir.
//! Yanit ALINTILI, anmadan ayri: anma "kime haber", yanit "hangi mesaja" (KNOW-273).
use axum::{routing::post, Router};
use crate::{handlers::chat as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        // v1'de iki yol vardi (/item/... ve /record/...), ayni handler'a
        // giriyorlardi. Tek ada indi (spec/21-sema-v2.md §14).
        .route("/record/{record_id}/message", post(h::post_message))
        .route("/team/{team_id}/message", post(h::post_team_message))
}
