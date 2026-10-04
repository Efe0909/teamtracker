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

/// Alan GELDIYSE (null dahil) `Some`; gelmediyse `#[serde(default)]` None.
/// PATCH'te "yok = degismez" ile "null = sil" ayrimi icin.
pub fn present<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}

/// Bilgi yogunlugu tabani (spec/76): ad/baslik ve aciklama alt siniri, kirpilmis
/// Unicode karakter. Yalniz YENI yazimda sorulur; eski kisa veri duzenlenene dek kalir.
pub const NAME_MIN: usize = 5;
pub const DESC_MIN: usize = 30;

/// `None` (bos alan) gecer; zorunlulugu cagiran ayrica sorar.
pub fn min_chars(s: Option<&str>, min: usize, code: &'static str) -> Result<(), AppError> {
    match s {
        Some(s) if s.trim().chars().count() < min => Err(AppError::BadRequest(code)),
        _ => Ok(()),
    }
}

/// Serbest metin girdisi: bosluk kirpilir, bos ise None, sinir asilirsa 400.
pub fn text(raw: Option<String>, max: usize, code: &'static str) -> Result<Option<String>, AppError> {
    match raw.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        Some(s) if s.chars().count() > max => Err(AppError::BadRequest(code)),
        other => Ok(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alt_sinir_unicode_karakter_sayar() {
        // "Çiçek" 5 karakter, 8 bayt: bayt degil karakter sayilir.
        assert!(min_chars(Some("Çiçek"), NAME_MIN, "x").is_ok());
        assert!(min_chars(Some("  Çiçe  "), NAME_MIN, "x").is_err());
        assert!(min_chars(None, NAME_MIN, "x").is_ok());
        assert!(min_chars(Some(&"ı".repeat(29)), DESC_MIN, "x").is_err());
        assert!(min_chars(Some(&"ı".repeat(30)), DESC_MIN, "x").is_ok());
    }
}
