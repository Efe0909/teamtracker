//! Veri agaci.
//!
//! `edit_nodes` kapsami SAYFANIN kapisi; duzenlenebilir alt agac
//! `user_node_scopes` (spec/21-sema-v2.md §11). Kok islemleri YALNIZ admin:
//! dugum izni bir DALI kapsar, kok hicbir dala girmez.
//!
//! Katlama ve arama ISTEMCIDE (KNOW-272) — satirlar zaten DOM'da, sunucuya
//! gidis yok.
use axum::{routing::{delete, get, patch, post}, Router};
use crate::{handlers::nodes as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/outcome-tree", get(h::page))
        .route("/node", post(h::create))
        .route("/node/{node_id}", patch(h::rename_or_move).delete(h::remove))
        // Pasiflestirme SILME DEGIL: kayitlar, gecmis, dal izinleri yerinde
        // kalir; pasif dugum yalniz ILERIYE donuk kaybolur.
        .route("/node/{node_id}/active", post(h::set_active))
}
