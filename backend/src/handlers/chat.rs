//! Mesaj yazma. Yanit gecerliligi DB`de: (chat_id, reply_to_id) bilesik
//! FK`si sohbet disina tasmayi engelliyor — uygulama kontrolu yok (KNOW-276).

use axum::response::Response;

pub async fn post_message() -> Response {
    todo!("chat::post_message")
}

pub async fn post_team_message() -> Response {
    todo!("chat::post_team_message")
}
