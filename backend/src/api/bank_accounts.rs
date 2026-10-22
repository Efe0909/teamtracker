//! HTTP handlers for personal bank accounts.

use axum::{extract::{Path, State}, Json};
use crate::{
    api::common::Body,
    auth::CurrentUser,
    domain::bank_accounts::{self, AccountPatch, BankAccount, NewAccount},
    error::Result,
    state::AppState,
};

pub(crate) use crate::domain::bank_accounts::list_of;

pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<BankAccount>>> {
    Ok(Json(bank_accounts::list(&st, me.id).await?))
}

pub async fn create(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewAccount>,
) -> Result<Json<Vec<BankAccount>>> {
    Ok(Json(bank_accounts::create(&st, me.id, b).await?))
}

pub async fn patch(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(p): Body<AccountPatch>,
) -> Result<Json<Vec<BankAccount>>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(bank_accounts::patch(&st, me.id, id, p).await?))
}

pub async fn delete(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Vec<BankAccount>>> {
    let id = crate::api::common::id(&raw)?;
    Ok(Json(bank_accounts::delete(&st, me.id, id).await?))
}
