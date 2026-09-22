//! Tek hata tipi -> tek yanit yolu.
//!
//! API METIN DONMEZ: `{"error": "<kod>"}`. Turkce ileti on yuzun isi
//! (spec/15-sinirlar.md "API kurallari" 3). Ic ayrinti loga, istemciye degil.

use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};

#[derive(Debug)]
pub enum AppError {
    Unauthorized,
    /// Yetki yok. 403 yalniz DEGISTIREN uclarda (KNOW-47).
    Forbidden,
    NotFound,
    /// Girdi gecersiz; kod makine icin (ornegin "invalid_user_id").
    BadRequest(&'static str),
    /// Istek gecerli ama durum izin vermiyor (ornegin "open_actions": acik
    /// eylemi olan kayit kapanmaz). Kod on yuzde Turkce iletiye cevrilir.
    Conflict(&'static str),
    Db(sqlx::Error),
}

pub type Result<T> = std::result::Result<T, AppError>;

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        // RowNotFound'u 404'e cevirmiyoruz: cagiran hangi satirin eksik
        // oldugunu bilir, "bir sey bulunamadi" demek ondan kotu.
        AppError::Db(e)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            AppError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            AppError::BadRequest(c) => (StatusCode::BAD_REQUEST, *c),
            AppError::Conflict(c) => (StatusCode::CONFLICT, *c),
            AppError::Db(e) => {
                tracing::error!("db error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal")
            }
        };
        (status, Json(serde_json::json!({ "error": code }))).into_response()
    }
}
