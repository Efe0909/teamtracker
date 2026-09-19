//! Masaustune ozel yuzeyler. Host guard: `Surface::Dashboard` ya da `Single`.
//!
//! `/{slug}` modul yer tutucusu EN SONDA duruyor ama axum'da sira onemli degil:
//! statik segment dinamik olana tercih edilir, `/search` bunu yutmaz.
use axum::{routing::{get, post}, Router};
use crate::{handlers::dashboard as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tasks", get(h::table))
        .route("/tasks/{record_id}", get(h::record_page))
        .route("/admin", get(h::admin_page))
        // Ray sabitleri KISIYE ait bir tercih (goc 012).
        .route("/pins/{slug}", post(h::toggle_pin))
        // Modul yer tutucusu — MODULES listesinde olmayan slug 404.
        .route("/{slug}", get(h::module_page))
}
