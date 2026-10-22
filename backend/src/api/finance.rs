use axum::{extract::{Path, Query, State}, http::header, response::{IntoResponse, Response}, Json};
use crate::{
    api::common::{self, Body},
    auth::CurrentUser,
    domain::finance,
    error::Result,
    state::AppState,
};

pub(crate) use crate::domain::finance::{
    ClaimIn, ClaimMove, ClaimPatch, ClaimSlot, ClaimOut, DecisionIn, EntryIn, FxQuery,
    InvoiceIn, InvoiceRowOut, InvoiceView, LedgerView, ListQuery, PayoutIn, Purchasable,
    ReverseIn, Summary,
};

pub async fn submit(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<InvoiceIn>) -> Result<Json<InvoiceView>> {
    finance::submit(&st, &me, b).await.map(Json)
}

pub async fn edit(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<InvoiceIn>) -> Result<Json<InvoiceView>> {
    finance::edit(&st, &me, common::id(&raw)?, b).await.map(Json)
}

pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<InvoiceView>> {
    finance::get(&st, &me, common::id(&raw)?).await.map(Json)
}

pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<ListQuery>) -> Result<Json<Vec<InvoiceRowOut>>> {
    finance::list(&st, &me, q).await.map(Json)
}

pub async fn decide(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<DecisionIn>) -> Result<Json<InvoiceView>> {
    finance::decide(&st, &me, common::id(&raw)?, b).await.map(Json)
}

pub async fn move_claim(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<ClaimMove>) -> Result<Json<InvoiceView>> {
    finance::move_claim(&st, &me, common::id(&raw)?, b).await.map(Json)
}

pub async fn purchasable(State(st): State<AppState>, CurrentUser(_me): CurrentUser) -> Result<Json<Vec<Purchasable>>> {
    finance::purchasable(&st).await.map(Json)
}

pub async fn claims(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<ClaimOut>>> {
    finance::claims(&st, &me).await.map(Json)
}

pub async fn claim_slots(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<ClaimSlot>>> {
    finance::claim_slots(&st, &me).await.map(Json)
}

pub async fn create_claim(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<ClaimIn>) -> Result<Json<finance::ClaimDetail>> {
    finance::create_claim(&st, &me, b).await.map(Json)
}

pub async fn claim(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<finance::ClaimDetail>> {
    finance::claim(&st, &me, common::id(&raw)?).await.map(Json)
}

pub async fn claim_xlsx(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Response> {
    let (bytes, name) = finance::claim_xlsx(&st, &me, common::id(&raw)?).await?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            (header::CACHE_CONTROL, "no-store"),
            (header::CONTENT_DISPOSITION, &format!("attachment; filename=\"{name}\"")),
        ],
        bytes,
    ).into_response())
}

pub async fn patch_claim(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<ClaimPatch>) -> Result<Json<finance::ClaimDetail>> {
    finance::patch_claim(&st, &me, common::id(&raw)?, b).await.map(Json)
}

pub async fn ledger(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<LedgerView>> {
    finance::ledger(&st, &me).await.map(Json)
}

pub async fn add_entry(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<EntryIn>) -> Result<Json<LedgerView>> {
    finance::add_entry(&st, &me, b).await.map(Json)
}

pub async fn reverse_entry(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<ReverseIn>) -> Result<Json<LedgerView>> {
    finance::reverse_entry(&st, &me, common::id(&raw)?, b).await.map(Json)
}

pub async fn add_check(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<finance::CheckIn>) -> Result<Json<LedgerView>> {
    finance::add_check(&st, &me, b).await.map(Json)
}

pub async fn payout(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<PayoutIn>) -> Result<Json<LedgerView>> {
    finance::payout(&st, &me, b).await.map(Json)
}

pub async fn summary(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Summary>> {
    finance::summary(&st, &me).await.map(Json)
}

pub async fn fx(State(st): State<AppState>, CurrentUser(_me): CurrentUser, Query(q): Query<FxQuery>) -> Result<Json<serde_json::Value>> {
    finance::fx(&st, q).await.map(Json)
}
