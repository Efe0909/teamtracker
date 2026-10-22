//! Kimlik uçlarının veritabanı okumaları ve yazmaları.

use uuid::Uuid;

use crate::{db::auth as db, error::Result, state::AppState};

pub(crate) async fn find_candidate(st: &AppState, email: &str, sub: &str) -> Result<Option<db::Candidate>> {
    let by_sub = db::find_by_google_sub(&st.pool, sub).await?;
    Ok(match by_sub {
        Some(c) => Some(c),
        None => db::find_by_email(&st.pool, email).await?,
    })
}

pub(crate) async fn record_login(st: &AppState, sub: &str, email: &str, user: Uuid) -> Result<()> {
    Ok(db::record_login(&st.pool, sub, email, user).await?)
}
