//! Ek yazma. BLOB SUPURMESI GEREKLI: cascade satiri siler, diskteki
//! dosyayi silmez — v1`de sessiz sizintiydi (KNOW-278).

use axum::response::Response;

pub async fn serve() -> Response {
    todo!("attachments::serve")
}

pub async fn remove() -> Response {
    todo!("attachments::remove")
}

pub async fn serve_thumb() -> Response {
    todo!("attachments::serve_thumb")
}

pub async fn add_tag() -> Response {
    todo!("attachments::add_tag")
}

pub async fn remove_tag() -> Response {
    todo!("attachments::remove_tag")
}
