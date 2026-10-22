//! Dugum bagimliliklari — silme yuklemi.
//!
//!   is_virgin -> hicbir bagimlilik yok; silmek hicbir gecmisi goturmez
//!
//! Takim baglari (`team_nodes`) sayilir ama bagimlilik DEGIL: baglanti silmeyi
//! engellemez, cascade ile gider (spec/22). Onay ekrani yalniz sayiyi gosterir.

use std::collections::HashMap;

use sqlx::PgPool;
use uuid::Uuid;

use crate::models::enums::{NodeType, Shape};
use serde_json::Value;

#[derive(Debug, Default, Clone, Copy)]
pub struct Deps {
    pub children: i64,
    pub records: i64,
    pub teams: i64,
    pub permissions: i64,
}

impl Deps {
    pub fn any(&self) -> bool {
        self.children + self.records + self.permissions > 0
    }
}

/// Dugum basina bagimlilik sayilari — TEK sorgu, uc tuketici.
///
/// `activity` BILEREK SAYILMIYOR: gunluk satirlari FK degil (chat_id zayif) ve
/// her dugum olusturmasi bir satir yaziyor — sayilsaydi hicbir dugum virgin
/// olamaz, ozellik hic calismazdi.
///
/// `users.scope_node_id` de yok: o sutun semadan dustu (yetki dort katman).
pub async fn deps_by_node(pool: &PgPool) -> Result<HashMap<Uuid, Deps>, sqlx::Error> {
    let rows: Vec<(Uuid, String)> = sqlx::query_as(
        "  select parent_id, 'children'    from nodes where parent_id is not null
         union all select unit_id, 'records'     from records
         union all select node_id, 'teams'       from team_nodes
         union all select node_id, 'permissions' from user_node_scopes")
        .fetch_all(pool)
        .await?;

    let mut out: HashMap<Uuid, Deps> = HashMap::new();
    for (nid, dep) in rows {
        let e = out.entry(nid).or_default();
        match dep.as_str() {
            "children" => e.children += 1,
            "records" => e.records += 1,
            "teams" => e.teams += 1,
            _ => e.permissions += 1,
        }
    }
    Ok(out)
}

pub fn is_virgin(deps: &HashMap<Uuid, Deps>, id: Uuid) -> bool {
    !deps.get(&id).map(|d| d.any()).unwrap_or(false)
}

pub(crate) async fn list_descriptions(ex: impl sqlx::PgExecutor<'_>) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as("select id, description from nodes where description is not null")
        .fetch_all(ex).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_node(
    ex: impl sqlx::PgExecutor<'_>, parent_id: Uuid, name: &str, node_type: NodeType,
    description: &Option<String>, actor: Uuid, shape: Shape, attrs: &Value,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into nodes (parent_id, name, node_type, description, created_by, shape, attrs, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7,
                 coalesce((select max(sort_order) from nodes where parent_id = $1), -1) + 1)
         returning id")
        .bind(parent_id).bind(name).bind(node_type).bind(description).bind(actor)
        .bind(shape).bind(attrs).fetch_one(ex).await
}

pub(crate) async fn insert_slot(
    ex: impl sqlx::PgExecutor<'_>, parent: Uuid, name: &str, attrs: Value, actor: Uuid, sort_order: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into nodes (parent_id, name, node_type, shape, attrs, created_by, sort_order)
                 values ($1, $2, 'operational', 'list', $3, $4, $5)")
        .bind(parent).bind(name).bind(attrs).bind(actor).bind(sort_order).execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_description(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<Option<Option<String>>, sqlx::Error> {
    sqlx::query_scalar("select description from nodes where id = $1").bind(id).fetch_optional(ex).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn update_node(
    ex: impl sqlx::PgExecutor<'_>, id: Uuid, name: &str, node_type: NodeType,
    description: &Option<String>, parent_id: Option<Uuid>, is_active: bool, shape: Shape, attrs: &Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update nodes set name = $2, node_type = $3, description = $4, parent_id = $5,
                          is_active = $6, shape = $7, attrs = $8
          where id = $1")
        .bind(id).bind(name).bind(node_type).bind(description).bind(parent_id)
        .bind(is_active).bind(shape).bind(attrs).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_activity(
    ex: impl sqlx::PgExecutor<'_>, actor: Uuid, verb: &str, subject: &str, target: Option<&str>, detail: Option<String>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into activity (chat_id, actor_id, verb, subject_label, target_label, detail)
         values (null, $1, $2, $3, $4, $5)")
        .bind(actor).bind(verb).bind(subject).bind(target).bind(detail).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_node(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from nodes where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn insert_favorite(ex: impl sqlx::PgExecutor<'_>, user: Uuid, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("insert into node_favorites (user_id, node_id) values ($1, $2) on conflict do nothing")
        .bind(user).bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_favorite(ex: impl sqlx::PgExecutor<'_>, user: Uuid, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("delete from node_favorites where user_id = $1 and node_id = $2")
        .bind(user).bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn list_favorites(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar("select node_id from node_favorites where user_id = $1 order by created_at")
        .bind(user).fetch_all(ex).await
}

pub(crate) async fn category_exists(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists(select 1 from nodes where id = $1 and node_type = 'category')")
        .bind(id).fetch_one(ex).await
}
