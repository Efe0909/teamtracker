//! Ekipler. `teams` takimin GERCEK kaydi; `node_type='team'` dugumu yalnizca
//! hiyerarsideki yerini isaretler (KNOW-129, KNOW-262) — yazma KAYNAGA gider.
use axum::{routing::{delete, get, post}, Router};
use crate::{handlers::teams as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/teams", get(h::list))
        .route("/teams/{team_id}", get(h::page))
        .route("/team/{team_id}", post(h::update))
        .route("/team/{team_id}/members", post(h::add_member))
        .route("/team/{team_id}/members/{user_id}", delete(h::remove_member))
}
