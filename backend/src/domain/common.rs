//! Shared domain helpers used by API operations.

use crate::{db, error::AppError, models::user::User, state::AppState};

/// Tree reads recover a poisoned lock; writers rebuild the full index.
pub(crate) fn tree(st: &AppState) -> std::sync::RwLockReadGuard<'_, db::tree::TreeIndex> {
    st.tree.read().unwrap_or_else(|e| e.into_inner())
}

pub(crate) async fn has_scope(st: &AppState, user: &User, scope: &str) -> Result<bool, AppError> {
    Ok(db::scope::active(&st.pool, user).await?.iter().any(|s| s == scope))
}

pub(crate) fn present<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}

pub(crate) const NAME_MIN: usize = 5;
pub(crate) const DESC_MIN: usize = 30;

pub(crate) fn min_chars(s: Option<&str>, min: usize, code: &'static str) -> Result<(), AppError> {
    match s {
        Some(s) if s.trim().chars().count() < min => Err(AppError::BadRequest(code)),
        _ => Ok(()),
    }
}

pub(crate) fn text(raw: Option<String>, max: usize, code: &'static str) -> Result<Option<String>, AppError> {
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
