//! `GET /api/meta` — on yuzun sozlugu: kisiler, takimlar, agac, yetenekler.
//!
//! Liste/kayit yanitlari yalniz KIMLIK tasir (`owner_id`, `team_id`,
//! `unit_id`); adi, rengi, yolu on yuz bu sozlukten cozer. Boylece her yanit
//! ayni isimleri tekrar tekrar tasimiyor ve ad degisikligi tek yerden yansiyor.

use axum::{extract::State, Json};
use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    api::common,
    auth::CurrentUser,
    db,
    error::Result,
    models::enums::NodeType,
    state::AppState,
};

#[derive(Serialize)]
pub struct Meta {
    me: MeInfo,
    users: Vec<UserOut>,
    teams: Vec<TeamOut>,
    /// Ekrandaki agac sirasiyla (Euler turu); `depth` girinti icin.
    nodes: Vec<NodeOut>,
}

#[derive(Serialize)]
struct MeInfo {
    id: Uuid,
    is_admin: bool,
    /// Etkin yetenekler (dogrudan + rollerden). Admin hepsine sahip.
    scopes: Vec<String>,
    team_ids: Vec<Uuid>,
    /// Kayit acabilecegi birimler: izinli dallarin altindaki aktif birimler
    /// (admin hepsi). Kural `db::scope::can_create_in` ile ayni; yeni kayit
    /// formu yalniz bunlari gosterir.
    creatable_unit_ids: Vec<Uuid>,
}

#[derive(Serialize, sqlx::FromRow)]
struct UserOut {
    id: Uuid,
    name: String,
    color: Option<String>,
    is_admin: bool,
    last_seen_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, sqlx::FromRow)]
struct TeamOut {
    id: Uuid,
    name: String,
    description: Option<String>,
    color: Option<String>,
    node_id: Option<Uuid>,
    chat_id: Uuid,
}

#[derive(Serialize)]
struct NodeOut {
    id: Uuid,
    parent_id: Option<Uuid>,
    name: String,
    node_type: NodeType,
    is_active: bool,
    depth: u32,
}

pub async fn meta(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Meta>> {
    let scopes = db::scope::active(&st.pool, &me).await?;
    let team_ids = sqlx::query_scalar("select team_id from team_members where user_id = $1")
        .bind(me.id).fetch_all(&st.pool).await?;
    let users = sqlx::query_as(
        "select id, name, color, is_admin, last_seen_at from users where is_active order by name")
        .fetch_all(&st.pool).await?;
    let teams = sqlx::query_as(
        "select id, name, description, color, node_id, chat_id from teams order by name")
        .fetch_all(&st.pool).await?;

    let permitted = db::scope::permitted_nodes(&st.pool, &me).await?;

    let (nodes, creatable_unit_ids) = {
        let tree = common::tree(&st);
        let nodes = tree.order().iter().filter_map(|id| tree.get(*id)).map(|n| NodeOut {
            id: n.id, parent_id: n.parent_id, name: n.name.clone(),
            node_type: n.node_type, is_active: n.is_active, depth: n.depth,
        }).collect();
        let creatable = tree.units(true).into_iter()
            .filter(|u| me.is_admin || permitted.iter().any(|p| tree.is_descendant(*u, *p)))
            .collect();
        (nodes, creatable)
    };

    Ok(Json(Meta {
        me: MeInfo { id: me.id, is_admin: me.is_admin, scopes, team_ids, creatable_unit_ids },
        users, teams, nodes,
    }))
}
