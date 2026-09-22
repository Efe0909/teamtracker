//! Uclarin paylastigi kucuk parcalar: govde cikarici, yol kimligi, agac
//! kilidi, yetenek sorgusu.

use axum::{
    extract::{FromRequest, Request},
    Json,
};
use serde::de::DeserializeOwned;
use uuid::Uuid;

use crate::{db, error::AppError, models::user::User, state::AppState};

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

/// Agac okumasi. Kilit ZEHIRLIYSE yine de oku: yazan taraf agaci komple
/// yeniden kuruyor, yarim bir durum yok (state.rs).
pub fn tree(st: &AppState) -> std::sync::RwLockReadGuard<'_, db::tree::TreeIndex> {
    st.tree.read().unwrap_or_else(|e| e.into_inner())
}

pub async fn has_scope(st: &AppState, user: &User, scope: &str) -> Result<bool, AppError> {
    Ok(db::scope::active(&st.pool, user).await?.iter().any(|s| s == scope))
}

/// Serbest metin girdisi: bosluk kirpilir, bos ise None, sinir asilirsa 400.
pub fn text(raw: Option<String>, max: usize, code: &'static str) -> Result<Option<String>, AppError> {
    match raw.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        Some(s) if s.chars().count() > max => Err(AppError::BadRequest(code)),
        other => Ok(other),
    }
}
