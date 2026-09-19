//! Kart yazma. Bozuk blob = serde hatasi -> CardBody::Broken, SAKLANMAZ,
//! her cizimde hesaplanir (KNOW-280). Yetki ASLA blob okumaz.
//! Katilim blob`da; jsonb_set ile TEK ifade — SELECT-degistir-UPDATE yaris
//! yaratir (KNOW-281).

use axum::response::Response;

pub async fn create() -> Response {
    todo!("cards::create")
}

pub async fn update() -> Response {
    todo!("cards::update")
}

pub async fn remove() -> Response {
    todo!("cards::remove")
}

pub async fn signup() -> Response {
    todo!("cards::signup")
}

pub async fn add_media() -> Response {
    todo!("cards::add_media")
}
