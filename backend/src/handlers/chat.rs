//! Mesaj yazma. Yanit gecerliligi DB`de: (chat_id, reply_to_id) bilesik
//! FK`si sohbet disina tasmayi engelliyor — uygulama kontrolu yok (KNOW-276).

use axum::{
    extract::{Path, State},
    response::{Html, IntoResponse, Response},
    Form,
};
use minijinja::context;
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    auth::CurrentUser,
    error::{AppError, Result},
    models::record::Record,
    render,
    state::AppState,
};

#[derive(Deserialize)]
pub struct MessageForm {
    body: String,
    /// Yanit hedefi. Bos gelirse yok sayilir — bos dizgi bir uuid degil ve
    /// bunu hata saymak kompozeri kirardi.
    #[serde(default)]
    reply_to: String,
}

/// Kayda mesaj. TEK satir yazar — Python surumu `events`'e yaziyordu, burada
/// `messages`.
///
/// Yanit gecerliligini VERITABANI tutuyor: `(chat_id, reply_to_id)` bilesik
/// FK'si sohbet disina tasmayi engelliyor, uygulama kontrolu yok (KNOW-276).
pub async fn post_message(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    Path(id): Path<Uuid>,
    Form(f): Form<MessageForm>,
) -> Result<Response> {
    let body = f.body.trim();
    if body.is_empty() {
        return Err(AppError::BadRequest("boş mesaj".into()));
    }
    let rec = Record::fetch(&st.pool, id).await?
        .ok_or_else(|| AppError::NotFound("kayıt yok".into()))?;

    let reply: Option<Uuid> = f.reply_to.trim().parse().ok();
    let msg_id: Uuid = sqlx::query_scalar(
        "insert into messages (chat_id, author_id, body, reply_to_id)
         values ($1, $2, $3, $4) returning id")
        .bind(rec.chat_id).bind(u.id).bind(body).bind(reply)
        .fetch_one(&st.pool).await?;

    // Yalniz YENI balonu don: htmx onu akisin sonuna ekliyor, tum akisi
    // yeniden cizmiyor.
    let people = render::all_users(&st).await?;
    let feed = crate::db::feed::of_chat(&st.pool, rec.chat_id, u.id, &people).await?;
    let m = feed.into_iter().find(|b| b.id == msg_id)
        .ok_or_else(|| AppError::NotFound("mesaj yok".into()))?;

    let tpl = st.tpl.get_template("shared/message.html")?;
    Ok(Html(tpl.render(context! { m => m, user => &u, can_edit => true })?).into_response())
}

pub async fn post_team_message() -> Response {
    todo!("chat::post_team_message")
}

