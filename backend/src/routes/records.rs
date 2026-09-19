//! Kayit uclari. Ekipte bu satira "kayit" deniyor — tablo `records`
//! (spec/21-sema-v2.md §14). Kayit sayfasi MODAL DEGIL, tam sayfa: URL
//! paylasilabilir, mobil geri tusu calisir (KNOW-112).
//!
//! Sayfanin KENDISI yuzeye ozel (masaustu `/tasks/{id}`, mobil `/record/{id}`)
//! cunku sablonlari farkli; ALAN DEGISIMI ortak — iki yuzey de buraya girer.
use axum::{routing::{patch, post}, Router};
use crate::{handlers::records as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/record", post(h::create))
        // Alan degisimi DIALOG ile, dropdown ile degil — yanlislikla atamayi
        // bitirmek icin bilissel maliyet BILEREK eklendi (KNOW-266).
        //
        // v1'de bu uc IKI KEZ tanimliydi: /item/{id}/field (masaustu) ve
        // /record/{id}/field (mobil). Ayni is, iki ad — tek uca indi.
        .route("/record/{record_id}/field", patch(h::change_field))
}
