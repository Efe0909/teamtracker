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
    models::enums::{NodeType, Shape},
    state::AppState,
};

#[derive(Serialize)]
pub struct Meta {
    me: MeInfo,
    users: Vec<UserOut>,
    teams: Vec<TeamOut>,
    /// `sort_order`, sonra ad; pasifler de gelir (`is_active` ile).
    pillars: Vec<PillarOut>,
    /// Ekrandaki agac sirasiyla (Euler turu); `depth` girinti icin.
    nodes: Vec<NodeOut>,
    /// Kapali dis servisler (decision | resend | push): on yuz ilgili yerde
    /// acik uyari gosterir (spec/76, KNOW-358).
    external_off: Vec<&'static str>,
}

#[derive(Serialize)]
struct MeInfo {
    id: Uuid,
    is_admin: bool,
    /// Etkin yetenekler (dogrudan + rollerden). Admin hepsine sahip.
    scopes: Vec<String>,
    team_ids: Vec<Uuid>,
    /// Telefon zorunlu: bos ise on yuz profil penceresini acar.
    profile_complete: bool,
    /// Secicilerdeki favori dugumler (spec/74 §6), eklenme sirasinda.
    favorite_nodes: Vec<Uuid>,
}

#[derive(Serialize, sqlx::FromRow)]
struct UserOut {
    id: Uuid,
    name: String,
    color: Option<String>,
    is_admin: bool,
    last_seen_at: Option<DateTime<Utc>>,
    nickname: Option<String>,
    phone: Option<String>,
    avatar_id: Option<Uuid>,
    birth_day: Option<i16>,
    birth_month: Option<i16>,
    birth_year: Option<i16>,
}

#[derive(Serialize, sqlx::FromRow)]
struct TeamOut {
    id: Uuid,
    name: String,
    description: Option<String>,
    color: Option<String>,
    chat_id: Uuid,
    /// `team_nodes`: takimin bagli oldugu agac dugumleri.
    node_ids: Vec<Uuid>,
    /// Bu takim bir pillar'in OZEL takimiysa o pillar.
    pillar_id: Option<Uuid>,
    banner_id: Option<Uuid>,
}

#[derive(Serialize, sqlx::FromRow)]
struct PillarOut {
    id: Uuid,
    name: String,
    description: Option<String>,
    color: Option<String>,
    team_id: Uuid,
    is_active: bool,
    sort_order: i32,
}

#[derive(Serialize)]
struct NodeOut {
    id: Uuid,
    parent_id: Option<Uuid>,
    name: String,
    node_type: NodeType,
    is_active: bool,
    depth: u32,
    /// Yalniz kokte (spec/74).
    key: Option<String>,
    /// Kokunun key'i: seciciler kok basina suzer (units, event_types, event_locations).
    root_key: Option<String>,
    shape: Shape,
    attrs: serde_json::Value,
}

pub async fn meta(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Meta>> {
    let scopes = db::scope::active(&st.pool, &me).await?;
    let team_ids = sqlx::query_scalar("select team_id from team_members where user_id = $1")
        .bind(me.id).fetch_all(&st.pool).await?;
    let profile_complete: bool = sqlx::query_scalar(
        "select coalesce(btrim(phone), '') <> '' from users where id = $1")
        .bind(me.id).fetch_one(&st.pool).await?;
    let users = sqlx::query_as(
        "select id, name, color, is_admin, last_seen_at, nickname, phone, avatar_id,
                birth_day, birth_month, birth_year
           from users where is_active order by name")
        .fetch_all(&st.pool).await?;
    let teams = sqlx::query_as(
        "select t.id, t.name, t.description, t.color, t.chat_id,
                array(select n.node_id from team_nodes n where n.team_id = t.id
                       order by n.linked_at, n.node_id) as node_ids,
                (select p.id from pillars p where p.team_id = t.id) as pillar_id,
                t.banner_id
           from teams t order by t.name")
        .fetch_all(&st.pool).await?;
    let pillars = sqlx::query_as(
        "select id, name, description, color, team_id, is_active, sort_order
           from pillars order by sort_order, name")
        .fetch_all(&st.pool).await?;

    let nodes = {
        let tree = common::tree(&st);
        tree.order().iter().filter_map(|id| tree.get(*id)).map(|n| NodeOut {
            id: n.id, parent_id: n.parent_id, name: n.name.clone(),
            node_type: n.node_type, is_active: n.is_active, depth: n.depth,
            key: n.key.clone(), root_key: tree.root_key(n.id).map(String::from),
            shape: n.shape, attrs: n.attrs.clone(),
        }).collect()
    };
    let favorite_nodes = sqlx::query_scalar(
        "select node_id from node_favorites where user_id = $1 order by created_at")
        .bind(me.id).fetch_all(&st.pool).await?;

    Ok(Json(Meta {
        me: MeInfo { id: me.id, is_admin: me.is_admin, scopes, team_ids, profile_complete, favorite_nodes },
        users, teams, pillars, nodes, external_off: st.cfg.external_off_keys(),
    }))
}
