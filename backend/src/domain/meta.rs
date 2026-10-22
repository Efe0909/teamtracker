//! `GET /api/meta` — on yuzun sozlugu: kisiler, takimlar, agac, yetenekler.
//!
//! Liste/kayit yanitlari yalniz KIMLIK tasir (`owner_id`, `team_id`,
//! `unit_id`); adi, rengi, yolu on yuz bu sozlukten cozer. Boylece her yanit
//! ayni isimleri tekrar tekrar tasimiyor ve ad degisikligi tek yerden yansiyor.

use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    domain::common,
    db,
    error::Result,
    models::enums::{NodeType, Shape},
    models::user::User,
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
    /// Manifest'ten (backend/manifest.json).
    version: String,
    contact_email: String,
    /// Yukleme amaci basina sinir ve dosya secicinin `accept`'i (spec/83 §2);
    /// on yuz "en fazla 10 MB" metnini buradan yazar.
    upload_limits: std::collections::BTreeMap<&'static str, UploadLimit>,
}

#[derive(Serialize)]
struct UploadLimit {
    max_bytes: usize,
    accept: String,
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
    /// Silinmemis hesap numarasi var mi: fatura formu yoksa profile yonlendirir (spec/82 P4).
    has_bank_account: bool,
}

#[derive(Serialize)]
struct RoleBadge {
    id: Uuid,
    name: String,
    color: String,
}

#[derive(Serialize)]
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
    roles: Vec<RoleBadge>,
}

#[derive(Serialize)]
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

#[derive(Serialize)]
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

pub(crate) async fn get(st: &AppState, me: &User) -> Result<Meta> {
    let scopes = db::scope::active(&st.pool, me).await?;
    let team_ids = db::meta::list_team_ids(&st.pool, me.id).await?;
    let (profile_complete, has_bank_account) = db::meta::find_profile_status(&st.pool, me.id).await?;
    let user_rows = db::meta::list_users(&st.pool).await?;
    let role_rows = db::meta::list_roles(&st.pool).await?;
    let mut roles = std::collections::HashMap::<Uuid, Vec<RoleBadge>>::new();
    for db::meta::RoleRow { user_id, id, name, color } in role_rows {
        roles.entry(user_id).or_default().push(RoleBadge { id, name, color });
    }
    let users = user_rows.into_iter().map(|u| {
        let role_badges = roles.remove(&u.id).unwrap_or_default();
        UserOut {
            id: u.id, name: u.name, color: u.color, is_admin: u.is_admin,
            last_seen_at: u.last_seen_at, nickname: u.nickname, phone: u.phone,
            avatar_id: u.avatar_id, birth_day: u.birth_day, birth_month: u.birth_month,
            birth_year: u.birth_year, roles: role_badges,
        }
    }).collect();
    let teams = db::meta::list_teams(&st.pool).await?.into_iter().map(|t| TeamOut {
        id: t.id, name: t.name, description: t.description, color: t.color,
        chat_id: t.chat_id, node_ids: t.node_ids, pillar_id: t.pillar_id, banner_id: t.banner_id,
    }).collect();
    let pillars = db::meta::list_pillars(&st.pool).await?.into_iter().map(|p| PillarOut {
        id: p.id, name: p.name, description: p.description, color: p.color,
        team_id: p.team_id, is_active: p.is_active, sort_order: p.sort_order,
    }).collect();

    let nodes = {
        let tree = common::tree(st);
        tree.order().iter().filter_map(|id| tree.get(*id)).map(|n| NodeOut {
            id: n.id, parent_id: n.parent_id, name: n.name.clone(),
            node_type: n.node_type, is_active: n.is_active, depth: n.depth,
            key: n.key.clone(), root_key: tree.root_key(n.id).map(String::from),
            shape: n.shape, attrs: n.attrs.clone(),
        }).collect()
    };
    let favorite_nodes = db::nodes::list_favorites(&st.pool, me.id).await?;

    // Yonetimden kapatilan LLM ozelligi de "kapali" gorunur: on yuz cizmesin (spec/79 §11).
    let mut external_off = st.cfg.external_off_keys();
    for s in crate::llm::disabled_services(&st.pool).await? {
        if !external_off.contains(&s) {
            external_off.push(s);
        }
    }

    Ok(Meta {
        me: MeInfo {
            id: me.id, is_admin: me.is_admin, scopes, team_ids, profile_complete, favorite_nodes, has_bank_account,
        },
        users, teams, pillars, nodes, external_off,
        version: st.cfg.version.clone(), contact_email: st.cfg.contact_email.clone(),
        upload_limits: crate::media::Purpose::ALL.into_iter()
            .map(|p| (p.key(), UploadLimit { max_bytes: p.max_bytes(), accept: p.accept() }))
            .collect(),
    })
}
