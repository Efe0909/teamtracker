//! Eylem seridi. Ayri bir "Action Manager" sekmesi ACILMAZ — eylemler kartin
//! ve tablonun icinde kalir (KNOW-119).
//! Havuz karti BURADA DEGIL: o bir karttir (KNOW-279).
use axum::{routing::{patch, post}, Router};
use crate::{handlers::actions as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/item/{item_id}/action", post(h::create))
        .route("/action/{action_id}", patch(h::update))
}
