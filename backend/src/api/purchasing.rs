//! Satin alim API handler'lari.

use axum::{extract::{Path, Query, State}, Json};
use serde_json::Value;
use crate::{api::common::{self, Body}, auth::CurrentUser, domain::purchasing as domain_purchasing, domain::purchasing::*, error::Result, state::AppState};

pub async fn materials(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<MatQuery>) -> Result<Json<MatList>> {
    Ok(Json(domain_purchasing::materials(&st, &me, q).await?))
}

pub async fn wall(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<WallQuery>) -> Result<Json<Wall>> {
    Ok(Json(domain_purchasing::wall(&st, &me, q).await?))
}

pub async fn create_material(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewMaterial>) -> Result<Json<MatRow>> {
    Ok(Json(domain_purchasing::create_material(&st, &me, b).await?))
}

pub async fn material(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<MatFull>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_purchasing::material(&st, &me, id).await?))
}

pub async fn patch_material(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<MaterialPatch>) -> Result<Json<MatRow>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_purchasing::patch_material(&st, &me, id, b).await?))
}

pub async fn vendors(State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<VendorQuery>) -> Result<Json<Vec<VendorRow>>> {
    Ok(Json(domain_purchasing::vendors(&st, &me, q).await?))
}

pub async fn create_vendor(State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<VendorIn>) -> Result<Json<Value>> {
    Ok(Json(domain_purchasing::create_vendor(&st, &me, b).await?))
}

pub async fn vendor(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Json<VendorDetail>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_purchasing::vendor(&st, &me, id).await?))
}

pub async fn patch_vendor(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>, Body(b): Body<VendorPatch>) -> Result<Json<VendorRow>> {
    let id = common::id(&raw)?;
    Ok(Json(domain_purchasing::patch_vendor(&st, &me, id, b).await?))
}
