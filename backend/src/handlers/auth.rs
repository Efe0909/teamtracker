//! Oturum. CEREZ YALNIZ uid TASIR — kapsam GOMULMEZ (KNOW-97).
//! JWT`ye claim gomme tuzagina dusme: kapsam iptali ve is_active ile kullanici
//! kapatma ANINDA isliyor; claim gomulurse token suresi dolana kadar olmez.

use axum::response::Response;

pub async fn login_page() -> Response {
    todo!("auth::login_page")
}

pub async fn login_callback() -> Response {
    todo!("auth::login_callback")
}

pub async fn logout() -> Response {
    todo!("auth::logout")
}
