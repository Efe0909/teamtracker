//! Mobil yuzey. KOKTE — yol oneki YOK, `/m` diye bir sey yok.
//! Host guard: `Surface::Mobile` ya da `Single`.
use axum::{routing::{get, post}, Router};
use crate::{handlers::mobile as h, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        // Ana ekrana eklenen uygulama: manifest + service worker.
        // iOS izni ancak ana ekrana eklendikten SONRA istenebilir (KNOW-148).
        .route("/manifest.json", get(h::manifest))
        .route("/sw.js", get(h::service_worker))
        // "Yapilacaklar" = katilimcisi oldugum kayitlar, yalniz sahibi
        // olduklarim degil. Kok yolu shared::home cozuyor, host'a gore dallanir.
        .route("/actions", get(h::actions_tab))
        .route("/notifications", get(h::notifications))
        .route("/search", get(h::search))
        .route("/new", get(h::new_form).post(h::create))
        // Sayfanin kendisi mobile ozel (sablon farkli). Alan degisimi DEGIL:
        // o routes/records.rs'te, iki yuzey de ayni uca girer.
        .route("/record/{record_id}", get(h::record_page))
}
