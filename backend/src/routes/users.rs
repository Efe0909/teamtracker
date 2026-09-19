//! Yonetim paneli: kullanici, kapsam, rol.
//!
//! Rol duzenlemesi OKUMA aninda union'lanir, flatten yok (KNOW-239) — ayri bir
//! "yayinla" adimi gerekmez. Kilitlenme korumasi: son admin'in admin'ligi
//! alinamaz (spec/71-yonetim-paneli.md).
use axum::{routing::{delete, patch, post}, Router};
use crate::{handlers::users as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users", post(h::create))
        .route("/users/{user_id}/active", patch(h::set_active))
        .route("/users/{user_id}/admin", patch(h::set_admin))
        .route("/users/{user_id}/scopes", post(h::grant_scope))
        .route("/users/{user_id}/scopes/{scope_name}", delete(h::revoke_scope))
        .route("/users/{user_id}/roles", post(h::assign_role))
        .route("/users/{user_id}/roles/{role_id}", delete(h::unassign_role))
        .route("/roles", post(h::create_role))
        .route("/roles/{role_id}", patch(h::rename_role).delete(h::delete_role))
}
