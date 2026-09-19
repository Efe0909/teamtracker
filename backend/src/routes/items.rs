//! Kayit uclari. Kayit sayfasi MODAL DEGIL, tam sayfa — URL paylasilabilir,
//! mobil geri tusu calisir (KNOW-112).
use axum::{routing::{get, patch, post}, Router};
use crate::{handlers::items as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/item", post(h::create))
        .route("/item/{item_id}", get(h::fetch))
        // Alan degisimi DIALOG ile, dropdown ile degil — yanlislikla atamayi
        // bitirmek icin bilissel maliyet BILEREK eklendi (KNOW-266).
        .route("/item/{item_id}/field", patch(h::change_field))
}
