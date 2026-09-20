//! `routes/nodes.rs` karsiligi — istek govdesi, yetki, YAZMA yolu.

use axum_extra::extract::cookie::SignedCookieJar;
use axum::{extract::State, response::{Html, IntoResponse, Response}};
use minijinja::context;
use serde::Serialize;

use crate::{auth::CurrentUser, db, error::Result, models::enums::NodeType,
            render, state::AppState};

/// Duz liste: sablon girintiyi `depth` ile ciziyor, ic ice dongu yok.
///
/// YERLESIM KURALI TEK YERDE: her dugum alabilecegi tur listesini HAZIR
/// tasiyor (`types`). Sablon ROOT_ONLY'yi yeniden yazmaz — yazsaydi sunucuyla
/// celisirdi ve hicbir test gormezdi (KNOW-241'in tam olarak bu sekli).
#[derive(Serialize)]
struct TreeRow {
    id: uuid::Uuid,
    name: String,
    #[serde(rename = "type")]
    node_type: &'static str,
    type_label: &'static str,
    depth: u32,
    // Katlama ISTEMCIDE: hangi satirin kimin altinda oldugunu JS bu iki
    // alandan okur, ikinci bir agac kurmaz (KNOW-272).
    parent: Option<uuid::Uuid>,
    is_active: bool,
    has_children: bool,
    // Kayit sayisi DEGIL alt dugum sayisi: "bu dugumde kac kayit var" hicbir
    // karari beslemiyordu; kapali bir dalda "altinda ne var" besliyor.
    child_count: usize,
    description: Option<String>,
    types: Vec<(&'static str, &'static str)>,
    // Projeksiyon satiri olan dugumun turu DEGISMEZ.
    can_retype: bool,
    // Bos dugumu silmek ayricalik istemez; bagimlisi olan hard_delete ister.
    is_virgin: bool,
}

pub async fn page(
    State(st): State<AppState>,
    CurrentUser(u): CurrentUser,
    jar: SignedCookieJar,
) -> Result<Response> {
    let deps = db::nodes::deps_by_node(&st.pool).await?;
    let descriptions: Vec<(uuid::Uuid, Option<String>)> =
        sqlx::query_as("select id, description from nodes").fetch_all(&st.pool).await?;

    // Kokte her tur; kokun altinda ROOT_ONLY olanlar disinda her tur.
    let root_types: Vec<_> = NodeType::ALL.iter().map(|t| (name_of(*t), t.label())).collect();
    let child_types: Vec<_> = NodeType::ALL.iter().filter(|t| !t.is_root_only())
        .map(|t| (name_of(*t), t.label())).collect();

    let rows: Vec<TreeRow> = {
        let tree = st.tree.read().expect("agac kilidi");
        tree.order().iter().map(|&id| {
            let n = tree.get(id).expect("order icindeki dugum");
            let kids = tree.subtree(id).len() - 1;
            TreeRow {
                id, name: n.name.clone(),
                node_type: name_of(n.node_type), type_label: n.node_type.label(),
                depth: n.depth, parent: n.parent_id, is_active: n.is_active,
                has_children: kids > 0,
                child_count: tree.order().iter()
                    .filter(|&&c| tree.get(c).map(|c| c.parent_id) == Some(Some(id))).count(),
                description: descriptions.iter().find(|(d, _)| *d == id)
                    .and_then(|(_, t)| t.clone()),
                types: if n.parent_id.is_none() { root_types.clone() } else { child_types.clone() },
                can_retype: !db::nodes::has_projection(&deps, id),
                is_virgin: db::nodes::is_virgin(&deps, id),
            }
        }).collect()
    };

    let tok = crate::csrf::token(&jar);
    let html = render::page_with_token(&st, &u, "dashboard/data_tree.html", context! {
        nodes => rows,
        can_write => u.is_admin,
        root_types => root_types,
        child_types => child_types,
    }, &tok).await?;
    Ok((crate::csrf::attach(jar, &tok, st.cfg.in_production()),
        Html(html)).into_response())
}

fn name_of(t: NodeType) -> &'static str {
    match t {
        NodeType::Cell => "cell", NodeType::Machine => "machine",
        NodeType::Pillar => "pillar", NodeType::Team => "team",
        NodeType::Task => "task", NodeType::Step => "step",
        NodeType::Operational => "operational", NodeType::Generic => "generic",
    }
}

pub async fn create() -> Response {
    todo!("nodes::create")
}

pub async fn rename_or_move() -> Response {
    todo!("nodes::rename_or_move")
}

pub async fn remove() -> Response {
    todo!("nodes::remove")
}

pub async fn set_active() -> Response {
    todo!("nodes::set_active")
}
