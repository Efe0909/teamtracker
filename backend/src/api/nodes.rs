//! Veri yonetimi: referans veri agaci (spec/74; once spec/72, R2-F05).
//!
//! Kokler YALNIZ gocle dogar (`key` tasir) ve burada yalniz adi/aciklamasi
//! degisir. `operational` dugumler kodun slotlaridir (ad/aciklama disinda
//! kilitli). Hangi turun nereye girdigini, shape'i, attrs'i ve yetkiyi kok
//! semasi soyler (src/refdata.rs); shape ayrica DB tetikleyicisiyle de korunur.
//!
//! Yazma uclari agacin GUNCEL halini dondurur: on yuz ikinci bir GET atmaz.
//! Her yazma sonrasi `rebuild_tree` — kismi guncelleme YOK (KNOW-179).
//!
//! YETKI kok semasina gore (`NodeAccess::node`): Birimler `edit_nodes` + dal
//! izni, Etkinlik Turleri `manage_event_types`, Etkinlik Yerleri
//! `manage_event_locations`. Okuma herkese acik.

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    api::common::{self, Body},
    auth::CurrentUser,
    db::{
        nodes::{self as deps, Deps},
        scope::{NodeAccess, NodeScope},
        tree::TreeIndex,
    },
    error::{AppError, Result},
    models::enums::{NodeType, Shape},
    refdata::{self, ChildRule},
    state::AppState,
};

const NAME_MAX: usize = 200;
const TEXT_MAX: usize = 4000;

// --- okuma -----------------------------------------------------------------

#[derive(Serialize)]
pub struct TreeView {
    /// Euler turu sirasinda; girinti `depth` ile.
    nodes: Vec<NodeView>,
}

#[derive(Serialize)]
struct NodeView {
    id: Uuid,
    parent_id: Option<Uuid>,
    name: String,
    node_type: NodeType,
    /// Yalniz kokte dolu.
    key: Option<String>,
    /// Kokunun key'i (seciciler bununla suzer).
    root_key: Option<String>,
    shape: Shape,
    attrs: Value,
    /// Agac indeksine GIRMEZ, yalniz bu ekranda okunur.
    description: Option<String>,
    is_active: bool,
    depth: u32,
    /// Dogrudan alt dugum sayisi.
    child_count: i64,
    /// root = kok (yalniz ad/aciklama), operational = kod slotu (yalniz
    /// ad/aciklama), null = serbest.
    locked: Option<&'static str>,
    /// Bu dugumu duzenleyebilir mi (kok semasinin yetkisi).
    can_edit: bool,
    /// Altina eklenebilecek turler; bos = eklenemez. `child_fixed` ise tur ve
    /// shape sunucudan (formda tur secimi yok).
    child_types: Vec<NodeType>,
    child_fixed: bool,
    /// Bos (virgin) dugumu duzenleyebilen siler; bagimlisi olan icin ayrica
    /// sert silme yetkisi (Birimler'de `hard_delete_nodes`).
    can_hard_delete: bool,
    /// Kalici silme onayi NE GOTURECEGINI sayar — alt agacin toplami.
    delete_counts: DeleteCounts,
    /// Reddetmeyen isaretler: missing_slot, late_checkpoint, unknown_widget...
    warnings: Vec<&'static str>,
}

#[derive(Serialize, Default, Clone, Copy)]
struct DeleteCounts {
    children: i64,
    records: i64,
    permissions: i64,
    /// Kopacak `team_nodes` baglari (silmeyi ENGELLEMEZ, cascade).
    teams: i64,
}

pub async fn tree(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<TreeView>> {
    let access = NodeAccess::load(&st.pool, &me).await?;
    Ok(Json(view(&st, &access).await?))
}

fn locked(n: &crate::db::tree::Node) -> Option<&'static str> {
    if n.key.is_some() {
        Some("root")
    } else if n.node_type == NodeType::Operational {
        Some("operational")
    } else {
        None
    }
}

async fn view(st: &AppState, access: &NodeAccess) -> Result<TreeView> {
    let deps = deps::deps_by_node(&st.pool).await?;
    let descriptions: HashMap<Uuid, String> =
        sqlx::query_as("select id, description from nodes where description is not null")
            .fetch_all(&st.pool).await?.into_iter().collect();

    let tree = common::tree(st);
    // Alt agac toplamlari TEK gecis: Euler sirasinin tersinde cocuk her zaman
    // ustunden once gelir, toplami ustune eklenir.
    let mut totals: HashMap<Uuid, (i64, DeleteCounts)> = HashMap::new();
    for &id in tree.order().iter().rev() {
        let own = deps.get(&id).copied().unwrap_or_default();
        let e = totals.entry(id).or_default();
        e.0 += 1;
        e.1.records += own.records;
        e.1.permissions += own.permissions;
        e.1.teams += own.teams;
        let sum = *e;
        if let Some(p) = tree.get(id).and_then(|n| n.parent_id) {
            let pe = totals.entry(p).or_default();
            pe.0 += sum.0;
            pe.1.records += sum.1.records;
            pe.1.permissions += sum.1.permissions;
            pe.1.teams += sum.1.teams;
        }
    }

    let nodes = tree.order().iter().filter_map(|id| tree.get(*id)).map(|n| {
        let can_edit = access.node(&tree, n.id, NodeScope::Edit);
        let (size, mut counts) = totals.get(&n.id).copied().unwrap_or_default();
        counts.children = size - 1;
        let rule = if n.is_active { refdata::child_rule(&tree, n) } else { ChildRule::Closed };
        let (child_types, child_fixed) = match rule {
            ChildRule::Free(types) => (types.to_vec(), false),
            ChildRule::Fixed(t, _) => (vec![t], true),
            ChildRule::Closed => (Vec::new(), false),
        };
        let lock = locked(n);
        NodeView {
            id: n.id,
            parent_id: n.parent_id,
            name: n.name.clone(),
            node_type: n.node_type,
            key: n.key.clone(),
            root_key: tree.root_key(n.id).map(String::from),
            shape: n.shape,
            attrs: n.attrs.clone(),
            description: descriptions.get(&n.id).cloned(),
            is_active: n.is_active,
            depth: n.depth,
            child_count: deps.get(&n.id).map_or(0, |d: &Deps| d.children),
            locked: lock,
            can_edit,
            child_types: if can_edit { child_types } else { Vec::new() },
            child_fixed,
            can_hard_delete: can_edit && lock.is_none()
                && (deps::is_virgin(&deps, n.id) || access.node(&tree, n.id, NodeScope::HardDelete)),
            delete_counts: counts,
            warnings: refdata::warnings(&tree, n),
        }
    }).collect();

    Ok(TreeView { nodes })
}

// --- ekleme ----------------------------------------------------------------

#[derive(Deserialize)]
pub struct NewNode {
    name: String,
    /// Serbest kokte (Birimler) zorunlu; sabit kurallarda verilmezse sunucu
    /// atar, verilirse kuralla ayni olmali.
    #[serde(default)]
    node_type: Option<String>,
    /// Kok yaratilmaz (yalniz goc): zorunlu.
    parent_id: Option<Uuid>,
    #[serde(default)]
    description: Option<String>,
    /// Serbest kokte istege bagli (varsayilan tree); sabit kurallarda sunucudan.
    #[serde(default)]
    shape: Option<Shape>,
    #[serde(default)]
    attrs: Option<Value>,
}

fn name_of(raw: String) -> Result<String> {
    common::text(Some(raw), NAME_MAX, "invalid_name")?.ok_or(AppError::BadRequest("invalid_name"))
}

fn parse_type(raw: String) -> Result<NodeType> {
    serde_json::from_value(Value::String(raw)).map_err(|_| AppError::BadRequest("invalid_type"))
}

/// `list` ebeveynin cocuklari ayni turde olmali (tetikleyicinin ayni kurali,
/// burada anlasilir kodla).
fn list_fits(tree: &TreeIndex, parent: Uuid, t: NodeType, except: Option<Uuid>) -> bool {
    tree.get(parent).is_none_or(|p| p.shape != Shape::List)
        || tree.children(parent).iter().filter(|c| Some(**c) != except)
            .filter_map(|c| tree.get(*c)).all(|c| c.node_type == t)
}

/// Shape degisimi mevcut cocuklara uymali.
fn shape_fits(tree: &TreeIndex, id: Uuid, shape: Shape) -> bool {
    let kids: Vec<NodeType> = tree.children(id).iter().filter_map(|c| tree.get(*c)).map(|c| c.node_type).collect();
    match shape {
        Shape::Leaf => kids.is_empty(),
        Shape::List => kids.windows(2).all(|w| w[0] == w[1]),
        Shape::Tree => true,
    }
}

fn attrs_for(t: NodeType, raw: Option<Value>) -> Result<Value> {
    refdata::validate_attrs(t, &raw.unwrap_or_else(|| json!({}))).map_err(AppError::BadRequest)
}

pub async fn create(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewNode>,
) -> Result<Json<TreeView>> {
    let name = name_of(b.name)?;
    let description = common::text(b.description, TEXT_MAX, "invalid_description")?;
    let wanted = b.node_type.map(parse_type).transpose()?;
    let parent_id = b.parent_id.ok_or(AppError::Conflict("root_locked"))?;
    let access = NodeAccess::load(&st.pool, &me).await?;
    let _write = st.structure.lock().await;
    let (node_type, shape, parent_name) = {
        let tree = common::tree(&st);
        let parent = tree.get(parent_id).ok_or(AppError::BadRequest("invalid_parent"))?;
        // Alt dugum eklemek USTTE yetki ister.
        if !access.node(&tree, parent_id, NodeScope::Edit) {
            return Err(AppError::Forbidden);
        }
        if !parent.is_active {
            return Err(AppError::BadRequest("inactive_parent"));
        }
        let (node_type, shape) = match refdata::child_rule(&tree, parent) {
            ChildRule::Closed => return Err(AppError::BadRequest("type_not_allowed")),
            ChildRule::Free(types) => {
                let t = wanted.ok_or(AppError::BadRequest("invalid_type"))?;
                if !types.contains(&t) {
                    return Err(AppError::BadRequest("type_not_allowed"));
                }
                (t, b.shape.unwrap_or(Shape::Tree))
            }
            ChildRule::Fixed(t, shape) => {
                if wanted.is_some_and(|w| w != t) {
                    return Err(AppError::BadRequest("type_not_allowed"));
                }
                (t, shape)
            }
        };
        if !list_fits(&tree, parent_id, node_type, None) {
            return Err(AppError::BadRequest("shape_violation"));
        }
        (node_type, shape, parent.name.clone())
    };
    let attrs = attrs_for(node_type, b.attrs)?;

    let mut tx = st.pool.begin().await?;
    // Kardeslerin SONUNA: sira elle verilmiyor, ekleme sirasi korunuyor.
    let id: Uuid = sqlx::query_scalar(
        "insert into nodes (parent_id, name, node_type, description, created_by, shape, attrs, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7,
                 coalesce((select max(sort_order) from nodes where parent_id = $1), -1) + 1)
         returning id")
        .bind(parent_id).bind(&name).bind(node_type).bind(&description).bind(me.id)
        .bind(shape).bind(&attrs)
        .fetch_one(&mut *tx).await.map_err(shape_error)?;
    // Yeni etkinlik turu: slotlari ayni islemde (spec/74 §5).
    if node_type == NodeType::Choice {
        for (i, (slot_name, slot)) in refdata::OPTION_SLOTS.iter().enumerate() {
            sqlx::query(
                "insert into nodes (parent_id, name, node_type, shape, attrs, created_by, sort_order)
                 values ($1, $2, 'operational', 'list', $3, $4, $5)")
                .bind(id).bind(*slot_name).bind(json!({ "slot": slot })).bind(me.id).bind(i as i32)
                .execute(&mut *tx).await?;
        }
    }
    log(&mut tx, me.id, "node_created", &name, Some(&parent_name), json!({ "node_type": node_type })).await?;
    tx.commit().await?;
    st.rebuild_tree().await?;
    Ok(Json(view(&st, &access).await?))
}

/// Tetikleyicinin `shape_violation` istisnasi anlasilir koda.
fn shape_error(e: sqlx::Error) -> AppError {
    match &e {
        sqlx::Error::Database(d) if d.message().starts_with("shape_violation") => AppError::Conflict("shape_violation"),
        _ => e.into(),
    }
}

// --- duzenleme -------------------------------------------------------------

/// Verilmeyen alan DEGISMEZ. `description` icin "yok" ile "null" AYRI.
#[derive(Deserialize)]
pub struct NodePatch {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    node_type: Option<String>,
    #[serde(default, deserialize_with = "common::present")]
    description: Option<Option<String>>,
    /// Yalniz baska bir dugumun altina (kok yaratilmaz).
    #[serde(default)]
    parent_id: Option<Uuid>,
    #[serde(default)]
    is_active: Option<bool>,
    #[serde(default)]
    shape: Option<Shape>,
    #[serde(default)]
    attrs: Option<Value>,
}

struct Next {
    name: String,
    node_type: NodeType,
    description: Option<String>,
    parent_id: Option<Uuid>,
    is_active: bool,
    shape: Shape,
    attrs: Value,
}

pub async fn patch(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(p): Body<NodePatch>,
) -> Result<Json<TreeView>> {
    let id = common::id(&raw)?;
    let new_type = p.node_type.map(parse_type).transpose()?;
    let name = p.name.map(name_of).transpose()?;
    let description = p.description
        .map(|d| common::text(d, TEXT_MAX, "invalid_description")).transpose()?;
    let access = NodeAccess::load(&st.pool, &me).await?;
    let _write = st.structure.lock().await;
    let current_description: Option<String> =
        sqlx::query_scalar("select description from nodes where id = $1")
            .bind(id).fetch_optional(&st.pool).await?.flatten();

    let (next, changes) = {
        let tree = common::tree(&st);
        let node = tree.get(id).ok_or(AppError::NotFound)?;
        if !access.node(&tree, id, NodeScope::Edit) {
            return Err(AppError::Forbidden);
        }
        let next = Next {
            name: name.unwrap_or_else(|| node.name.clone()),
            node_type: new_type.unwrap_or(node.node_type),
            description: description.unwrap_or_else(|| current_description.clone()),
            parent_id: p.parent_id.or(node.parent_id),
            is_active: p.is_active.unwrap_or(node.is_active),
            shape: p.shape.unwrap_or(node.shape),
            attrs: match p.attrs {
                Some(a) => attrs_for(new_type.unwrap_or(node.node_type), Some(a))?,
                None => node.attrs.clone(),
            },
        };
        let structural = next.node_type != node.node_type || next.parent_id != node.parent_id
            || next.is_active != node.is_active || next.shape != node.shape || next.attrs != node.attrs;
        // Kok ve slot: yalniz ad/aciklama (spec/74 §4.1-4.2).
        if let (Some(lock), true) = (locked(node), structural) {
            return Err(AppError::Conflict(if lock == "root" { "root_locked" } else { "operational_locked" }));
        }
        if next.parent_id != node.parent_id {
            let target = next.parent_id.ok_or(AppError::Conflict("root_locked"))?;
            let t = tree.get(target).ok_or(AppError::BadRequest("invalid_parent"))?;
            // Hedef dalda da yetki; kokler arasi tasima yok.
            if !access.node(&tree, target, NodeScope::Edit) {
                return Err(AppError::Forbidden);
            }
            if t.root != node.root {
                return Err(AppError::BadRequest("type_not_allowed"));
            }
            if !t.is_active {
                return Err(AppError::BadRequest("inactive_parent"));
            }
            // DONGU KORUMASI: hedef tasinanin alt agacinda olamaz.
            if tree.is_descendant(target, id) {
                return Err(AppError::BadRequest("move_cycle"));
            }
        }
        // Tur ve yer kok semasina uymali (yeni ebeveynin kurali).
        if next.node_type != node.node_type || next.parent_id != node.parent_id {
            let parent = next.parent_id.and_then(|pid| tree.get(pid)).ok_or(AppError::Conflict("root_locked"))?;
            if !refdata::child_rule(&tree, parent).allows(next.node_type) {
                return Err(AppError::BadRequest("type_not_allowed"));
            }
            if let Some(pid) = next.parent_id {
                if !list_fits(&tree, pid, next.node_type, Some(id)) {
                    return Err(AppError::Conflict("shape_violation"));
                }
            }
        }
        // Shape yalniz serbest kokte (Birimler) secilir; sabit kurallarda sunucunun.
        if next.shape != node.shape {
            let free = node.parent_id.and_then(|pid| tree.get(pid))
                .is_some_and(|pa| matches!(refdata::child_rule(&tree, pa), ChildRule::Free(_)));
            if !free {
                return Err(AppError::BadRequest("type_not_allowed"));
            }
            if !shape_fits(&tree, id, next.shape) {
                return Err(AppError::Conflict("shape_violation"));
            }
        }
        // Gecmis icin (alan, once, sonra). Ust dugum ADIYLA yazilir.
        let label = |p: Option<Uuid>| p.map(|p| tree.name(p).to_string());
        let mut changes: Vec<(&str, Value, Value)> = Vec::new();
        if next.name != node.name {
            changes.push(("name", json!(node.name), json!(next.name)));
        }
        if next.node_type != node.node_type {
            changes.push(("node_type", json!(node.node_type), json!(next.node_type)));
        }
        if next.description != current_description {
            changes.push(("description", json!(current_description), json!(next.description)));
        }
        if next.parent_id != node.parent_id {
            changes.push(("parent", json!(label(node.parent_id)), json!(label(next.parent_id))));
        }
        if next.is_active != node.is_active {
            changes.push(("is_active", json!(node.is_active), json!(next.is_active)));
        }
        if next.shape != node.shape {
            changes.push(("shape", json!(node.shape), json!(next.shape)));
        }
        if next.attrs != node.attrs {
            changes.push(("attrs", node.attrs.clone(), next.attrs.clone()));
        }
        (next, changes)
    };
    if changes.is_empty() {
        return Ok(Json(view(&st, &access).await?));
    }

    let mut tx = st.pool.begin().await?;
    sqlx::query(
        "update nodes set name = $2, node_type = $3, description = $4, parent_id = $5,
                          is_active = $6, shape = $7, attrs = $8
          where id = $1")
        .bind(id).bind(&next.name).bind(next.node_type).bind(&next.description)
        .bind(next.parent_id).bind(next.is_active).bind(next.shape).bind(&next.attrs)
        .execute(&mut *tx).await.map_err(shape_error)?;
    for (field, from, to) in changes {
        log(&mut tx, me.id, "node_changed", &next.name, Some(field),
            json!({ "from": from, "to": to })).await?;
    }
    tx.commit().await?;
    st.rebuild_tree().await?;
    Ok(Json(view(&st, &access).await?))
}

// --- gecmis (R2-F07) ------------------------------------------------------
//
// Agac gecmisi `activity`'ye, AYRI TABLO YOK. `chat_id` NULL: denetim kaydi.
// Fiiller: node_created, node_changed (hedef=alan, detay={from,to}), node_deleted.

async fn log(
    tx: &mut Tx<'_>, actor: Uuid, verb: &str, subject: &str, target: Option<&str>, detail: Value,
) -> Result<()> {
    let detail = (!detail.is_null()).then(|| detail.to_string());
    sqlx::query(
        "insert into activity (chat_id, actor_id, verb, subject_label, target_label, detail)
         values (null, $1, $2, $3, $4, $5)")
        .bind(actor).bind(verb).bind(subject).bind(target).bind(detail)
        .execute(&mut **tx).await?;
    Ok(())
}

type Tx<'a> = sqlx::Transaction<'a, sqlx::Postgres>;

// --- kalici silme ----------------------------------------------------------

/// KALICI silme — gundelik is pasiflestirme. Kok ve slot silinmez. Birimler'de
/// iki kademe (spec/72 §6.2); scope'lu koklerde ayni scope. Etkinligin
/// kullandigi tur/yer FK ile korunur (`node_in_use`).
pub async fn delete(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<TreeView>> {
    let id = common::id(&raw)?;
    let access = NodeAccess::load(&st.pool, &me).await?;
    let _write = st.structure.lock().await;
    let deps = deps::deps_by_node(&st.pool).await?;
    let (name, descendants) = {
        let tree = common::tree(&st);
        let node = tree.get(id).ok_or(AppError::NotFound)?;
        if let Some(lock) = locked(node) {
            return Err(AppError::Conflict(if lock == "root" { "root_locked" } else { "operational_locked" }));
        }
        if !access.node(&tree, id, NodeScope::Edit)
            || !(deps::is_virgin(&deps, id) || access.node(&tree, id, NodeScope::HardDelete))
        {
            return Err(AppError::Forbidden);
        }
        (node.name.clone(), tree.subtree(id).len().saturating_sub(1))
    };
    let mut tx = st.pool.begin().await?;
    sqlx::query("delete from nodes where id = $1").bind(id).execute(&mut *tx).await
        .map_err(|e| match &e {
            sqlx::Error::Database(d) if d.is_foreign_key_violation() => AppError::Conflict("node_in_use"),
            _ => e.into(),
        })?;
    log(&mut tx, me.id, "node_deleted", &name, None, json!({ "descendants": descendants })).await?;
    tx.commit().await?;
    st.rebuild_tree().await?;
    Ok(Json(view(&st, &access).await?))
}

// --- favoriler (seciciler, spec/74 §6) ---------------------------------------

/// Kisi basina favori dugum (IDEMPOTENT). Yalniz okunabilir dugum yeter:
/// herkes kendi secicisini duzenler.
pub async fn favorite(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Vec<Uuid>>> {
    let id = common::id(&raw)?;
    if common::tree(&st).get(id).is_none() {
        return Err(AppError::NotFound);
    }
    sqlx::query("insert into node_favorites (user_id, node_id) values ($1, $2) on conflict do nothing")
        .bind(me.id).bind(id).execute(&st.pool).await?;
    favorites_of(&st, me.id).await
}

pub async fn unfavorite(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Vec<Uuid>>> {
    sqlx::query("delete from node_favorites where user_id = $1 and node_id = $2")
        .bind(me.id).bind(common::id(&raw)?).execute(&st.pool).await?;
    favorites_of(&st, me.id).await
}

async fn favorites_of(st: &AppState, user: Uuid) -> Result<Json<Vec<Uuid>>> {
    Ok(Json(sqlx::query_scalar("select node_id from node_favorites where user_id = $1 order by created_at")
        .bind(user).fetch_all(&st.pool).await?))
}
