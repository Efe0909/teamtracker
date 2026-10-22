use axum::{extract::{Path, Query, State}, http::header, response::{IntoResponse, Response}, Json};

use crate::{
    api::common::{self, Body},
    auth::CurrentUser,
    domain::budget,
    error::Result,
    state::AppState,
};

pub(crate) use crate::domain::budget::{AnalysisQuery, BudgetQuery, BudgetView, LineIn, Period, PeriodIn};

fn xlsx_response(bytes: Vec<u8>, name: &str) -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string()),
            (header::CACHE_CONTROL, "no-store".into()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{name}\"")),
        ],
        bytes,
    ).into_response()
}

pub async fn periods(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Vec<Period>>> {
    budget::periods(&st, &me).await.map(Json)
}

pub async fn create_period(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<PeriodIn>) -> Result<Json<Period>> {
    budget::create_period(&st, &me, b).await.map(Json)
}

pub async fn patch_period(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<PeriodIn>) -> Result<Json<Period>> {
    budget::patch_period(&st, &me, common::id(&raw)?, b).await.map(Json)
}

pub async fn delete_period(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<serde_json::Value>> {
    budget::delete_period(&st, &me, common::id(&raw)?).await.map(Json)
}

pub async fn budget(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<BudgetQuery>) -> Result<Json<BudgetView>> {
    budget::budget(&st, &me, q).await.map(Json)
}

pub async fn put_line(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<LineIn>) -> Result<Json<BudgetView>> {
    budget::put_line(&st, &me, b).await.map(Json)
}

pub async fn analysis(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<AnalysisQuery>) -> Result<Json<budget::Analysis>> {
    budget::analysis(&st, &me, q).await.map(Json)
}

pub async fn analysis_xlsx(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<AnalysisQuery>) -> Result<Response> {
    let (bytes, name) = budget::analysis_xlsx(&st, &me, q).await?;
    Ok(xlsx_response(bytes, &name))
}

pub async fn budget_xlsx(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<BudgetQuery>) -> Result<Response> {
    let (bytes, name) = budget::budget_xlsx(&st, &me, q).await?;
    Ok(xlsx_response(bytes, &name))
}
