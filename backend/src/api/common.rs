//! Uclarin paylastigi kucuk parcalar: govde cikarici, yol kimligi, agac
//! kilidi, yetenek sorgusu.

use axum::{
    extract::{FromRequest, Request},
    Json,
};
use serde::de::DeserializeOwned;
use uuid::Uuid;

use crate::error::AppError;

/// JSON govde. axum'un `Json` reddi DUZ METIN doner; API her hatayi
/// `{"error": kod}` olarak vermeli (spec/15 kural 3) — bu sarmalayici reddi
/// koda cevirir.
pub struct Body<T>(pub T);

impl<T, S> FromRequest<S> for Body<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(req: Request, st: &S) -> Result<Self, AppError> {
        Json::<T>::from_request(req, st).await
            .map(|Json(v)| Body(v))
            .map_err(|e| {
                tracing::debug!("body rejected: {e}");
                AppError::BadRequest("invalid_body")
            })
    }
}

/// Yol parametresi metin gelir. Bozuk kimlik "bulunamadi"dir, 400 degil:
/// istemci icin ikisi ayni sonuc, sozlesme daha sade.
pub fn id(raw: &str) -> Result<Uuid, AppError> {
    raw.parse().map_err(|_| AppError::NotFound)
}
