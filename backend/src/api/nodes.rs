//! Veri yonetimi: yapinin (agacin) duzenlendigi uclar (spec/72, R2-F05).
//!
//! Yazma uclari agacin GUNCEL halini dondurur (Python her yazmadan sonra
//! agac parcasini yeniden ciziyordu): on yuz ikinci bir GET atmaz. Her yazma
//! sonrasi `rebuild_tree` — kismi guncelleme YOK (KNOW-179).
//!
//! YETKI iki parcali (`db::scope::NodeAccess`): `edit_nodes` yetenegi + o
//! dalda `user_node_scopes` izni. Kok islemleri yalniz admin. Kontrol UCUN
//! KENDISINDE; okuma yanitindaki `can_*` bayraklari yalniz dugme icin.
//!
//! Okuma herkese acik: yapi zaten `/api/meta`'da herkese gidiyor, ekran
//! yetkisiz kullaniciya salt okunur cizilir (Python `/outcome-tree`).

use std::collections::HashMap;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    api::common::{self, Body},
    auth::CurrentUser,
    db::{
        nodes::{self as deps, Deps},
        scope::{NodeAccess, NodeScope},
    },
    error::{AppError, Result},
    models::enums::NodeType,
    state::AppState,
};

const NAME_MAX: usize = 200;
const TEXT_MAX: usize = 4000;

// --- okuma -----------------------------------------------------------------

#[derive(Serialize)]
pub struct TreeView {
    /// Kok dugum eklemek / koke tasimak (yalniz admin).
    can_add_root: bool,
    /// YERLESIM KURALI TEK YERDE (KNOW-241): on yuz ROOT_ONLY'yi yeniden
    /// yazmaz, kok ve alt dugum formlari tur listesini buradan alir.
    root_types: Vec<NodeType>,
    child_types: Vec<NodeType>,
    /// Euler turu sirasinda; girinti `depth` ile.
    nodes: Vec<NodeView>,
}

#[derive(Serialize)]
struct NodeView {
    id: Uuid,
    parent_id: Option<Uuid>,
    name: String,
    node_type: NodeType,
    /// Agac indeksine GIRMEZ, yalniz bu ekranda okunur.
    description: Option<String>,
    is_active: bool,
    depth: u32,
    /// Kayit sayisi DEGIL dogrudan alt dugum sayisi: kapali bir dalda
    /// "altinda ne kadar var" isine yarar (Python e74ca50, kullanici istegi).
    child_count: i64,
    /// Bu dugumde `edit_nodes` + dal izni var mi.
    can_edit: bool,
    /// Projeksiyon satiri (takim karti) olan dugumun turu degismez (spec/72 §6.3).
    can_retype: bool,
    /// Bos (virgin) dugumu duzenleyebilen siler; bagimlisi olan icin ayrica
    /// `hard_delete_nodes` (spec/72 §6.2).
    can_hard_delete: bool,
    /// Kalici silme onayi NE GOTURECEGINI sayar — alt agacin toplami.
    delete_counts: DeleteCounts,
}

#[derive(Serialize, Default, Clone, Copy)]
struct DeleteCounts {
    children: i64,
    records: i64,
    permissions: i64,
}

pub async fn tree(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<TreeView>> {
    let access = NodeAccess::load(&st.pool, &me).await?;
    Ok(Json(view(&st, &access).await?))
}

async fn view(st: &AppState, access: &NodeAccess) -> Result<TreeView> {
    let deps = deps::deps_by_node(&st.pool).await?;
    let descriptions: HashMap<Uuid, String> =
        sqlx::query_as("select id, description from nodes where description is not null")
            .fetch_all(&st.pool).await?.into_iter().collect();

    let tree = common::tree(st);
    // Alt agac toplamlari TEK gecis: Euler sirasinin tersinde cocuk her zaman
    // ustunden once gelir, toplami ustune eklenir. Dugum basina alt agac
    // taramak O(n^2) olurdu.
    let mut totals: HashMap<Uuid, (i64, DeleteCounts)> = HashMap::new();
    for &id in tree.order().iter().rev() {
        let own = deps.get(&id).copied().unwrap_or_default();
        let e = totals.entry(id).or_default();
        e.0 += 1;
        e.1.records += own.records;
        e.1.permissions += own.permissions;
        let sum = *e;
        if let Some(p) = tree.get(id).and_then(|n| n.parent_id) {
            let pe = totals.entry(p).or_default();
            pe.0 += sum.0;
            pe.1.records += sum.1.records;
            pe.1.permissions += sum.1.permissions;
        }
    }

    let nodes = tree.order().iter().filter_map(|id| tree.get(*id)).map(|n| {
        let can_edit = access.on(&tree, n.id, NodeScope::Edit);
        let (size, mut counts) = totals.get(&n.id).copied().unwrap_or_default();
        counts.children = size - 1;
        NodeView {
            id: n.id,
            parent_id: n.parent_id,
            name: n.name.clone(),
            node_type: n.node_type,
            description: descriptions.get(&n.id).cloned(),
            is_active: n.is_active,
            depth: n.depth,
            child_count: deps.get(&n.id).map_or(0, |d: &Deps| d.children),
            can_edit,
            can_retype: !deps::has_projection(&deps, n.id),
            can_hard_delete: can_edit
                && (deps::is_virgin(&deps, n.id) || access.on(&tree, n.id, NodeScope::HardDelete)),
            delete_counts: counts,
        }
    }).collect();

    Ok(TreeView {
        can_add_root: access.root(),
        root_types: NodeType::ALL.to_vec(),
        child_types: NodeType::ALL.iter().copied().filter(|t| !t.is_root_only()).collect(),
        nodes,
    })
}

// --- ekleme ----------------------------------------------------------------

#[derive(Deserialize)]
pub struct NewNode {
    name: String,
    /// Enum: serbest metin tur serde'de duser (spec/72 §3).
    node_type: NodeType,
    /// null = kok.
    #[serde(default)]
    parent_id: Option<Uuid>,
    #[serde(default)]
    description: Option<String>,
}

fn name_of(raw: String) -> Result<String> {
    // Adsiz dugum agacta okunmaz olur.
    common::text(Some(raw), NAME_MAX, "invalid_name")?.ok_or(AppError::BadRequest("invalid_name"))
}

pub async fn create(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewNode>,
) -> Result<Json<TreeView>> {
    let name = name_of(b.name)?;
    let description = common::text(b.description, TEXT_MAX, "invalid_description")?;
    let access = NodeAccess::load(&st.pool, &me).await?;
    let _write = st.structure.lock().await;
    {
        let tree = common::tree(&st);
        match b.parent_id {
            None if !access.root() => return Err(AppError::Forbidden),
            None => {}
            Some(p) => {
                let parent = tree.get(p).ok_or(AppError::BadRequest("invalid_parent"))?;
                // Alt dugum eklemek USTTE yetki ister.
                if !access.on(&tree, p, NodeScope::Edit) {
                    return Err(AppError::Forbidden);
                }
                if !parent.is_active {
                    return Err(AppError::BadRequest("inactive_parent"));
                }
                if b.node_type.is_root_only() {
                    return Err(AppError::BadRequest("root_only"));
                }
            }
        }
    }

    let mut tx = st.pool.begin().await?;
    // Kardeslerin SONUNA: sira elle verilmiyor, ekleme sirasi korunuyor.
    sqlx::query(
        "insert into nodes (parent_id, name, node_type, description, created_by, sort_order)
         values ($1, $2, $3, $4, $5,
                 coalesce((select max(sort_order) from nodes
                            where parent_id is not distinct from $1), -1) + 1)")
        .bind(b.parent_id).bind(&name).bind(b.node_type).bind(&description).bind(me.id)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    st.rebuild_tree().await?;
    Ok(Json(view(&st, &access).await?))
}
