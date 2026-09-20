//! Tek hata tipi -> tek yanit yolu.
//!
//! Kullaniciya gorunen metin TURKCE, log INGILIZCE (CLAUDE.md "Kod dili").
//! 403 yalniz DEGISTIREN uclarda uretilir — gorulme genel, degistirme
//! kapsamli (KNOW-47).

use axum::{http::StatusCode, response::{IntoResponse, Response}};

#[derive(Debug)]
pub enum AppError {
    /// Oturum yok. Giris kapisi bunu yakalayip /login'e yonlendirir.
    Unauthorized,
    /// Yetki yok. Denetim izine TEK yerden yazilir (asagida) — uclarda tek tek
    /// yazilsaydi biri unutulurdu.
    Forbidden(String),
    NotFound(String),
    /// Kullanici girdisi gecersiz. Mesaj EKRANDA gorunur, ayrinti sizdirmaz.
    BadRequest(String),
    Db(sqlx::Error),
    Template(minijinja::Error),
}

pub type Result<T> = std::result::Result<T, AppError>;

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Unauthorized => write!(f, "giriş gerekli"),
            AppError::Forbidden(m) => write!(f, "{m}"),
            AppError::NotFound(m) => write!(f, "{m}"),
            AppError::BadRequest(m) => write!(f, "{m}"),
            AppError::Db(_) | AppError::Template(_) => write!(f, "beklenmeyen hata"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        // RowNotFound'u 404'e cevirmiyoruz: cagiran hangi satirin eksik
        // oldugunu bilir, "bir sey bulunamadi" demek ondan kotu.
        AppError::Db(e)
    }
}

impl From<minijinja::Error> for AppError {
    fn from(e: minijinja::Error) -> Self { AppError::Template(e) }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden(_) => StatusCode::FORBIDDEN,
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Db(_) | AppError::Template(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        // Ic hatanin AYRINTISI loga, kullaniciya DEGIL.
        match &self {
            AppError::Db(e) => tracing::error!("db error: {e}"),
            AppError::Template(e) => tracing::error!("template error: {e}"),
            AppError::Forbidden(m) => tracing::warn!("permission denied: {m}"),
            _ => {}
        }
        (status, self.to_string()).into_response()
    }
}
