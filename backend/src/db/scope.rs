//! Yetki sorgulari — dort katmanin uc tanesi (spec/21-sema-v2.md §11).
//!
//!   yetenek -> scopes + roles        ne yapabilirsin
//!   dal     -> user_node_scopes      nerede
//!   iliski  -> sahip/acan/katilimci/takim uyesi
//!   super   -> users.is_admin
//!
//! Yetenek ile iliski BILEREK ayri: "kapsamin var, o dalda duzenlersin" ile
//! "bu kayit senin, duzenlersin" farkli sorular (KNOW-64).

use sqlx::PgPool;
use uuid::Uuid;

use crate::{db::tree::TreeIndex, models::{record::Record, user::User}};

/// Dogrudan verilenler ILE rollerden gelenlerin BIRLESIMI — okuma aninda.
///
/// FLATTEN YOK (KNOW-239): rol duzenlemesi burada hesaplandigi icin mevcut
/// sahiplerine ANINDA yansir, ayri bir "yayinla" adimi gerekmez.
pub async fn active(pool: &PgPool, user: &User) -> Result<Vec<String>, sqlx::Error> {
    if user.is_admin {
        // Admin HEPSINE sahip — yetkilendirmenin tepesi TEK yerde kalsin,
        // her kontrol ayrica "ya da admin mi" diye sormasin.
        return sqlx::query_scalar("select name from scopes").fetch_all(pool).await;
    }
    sqlx::query_scalar(
        "select scope from user_scopes where user_id = $1
         union
         select rs.scope from user_roles ur
           join role_scopes rs on rs.role_id = ur.role_id
          where ur.user_id = $1")
        .bind(user.id).fetch_all(pool).await
}

/// Izin verilmis dallar. Alt agac MIRASI burada degil cagirida —
/// `TreeIndex.is_descendant` ile O(1).
pub async fn permitted_nodes(pool: &PgPool, user: &User) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "select node_id from user_node_scopes where user_id = $1
         union
         select rns.node_id from user_roles ur
           join role_node_scopes rns on rns.role_id = ur.role_id
          where ur.user_id = $1")
        .bind(user.id).fetch_all(pool).await
}

/// Kart yetkisinin bes yolundan DORDU — veritabanina bakanlar (KNOW-64).
///
/// Besincisi (dal izni) agaca bakiyor ve AYRI: `std::sync::RwLock` guard'i
/// `.await` uzerinden tasinamaz (derlenmez, bilincli tercih). O yuzden
/// once butun async isler biter, agac kontrolu sonra senkron yapilir —
/// `can_edit_record` bunlari sirayla cagiriyor.
async fn by_relation(
    pool: &PgPool, user: &User, rec: &Record,
) -> Result<bool, sqlx::Error> {
    // 1. admin
    if user.is_admin {
        return Ok(true);
    }
    // 2. sahip ya da acan
    if rec.owner_id == Some(user.id) || rec.created_by == user.id {
        return Ok(true);
    }
    // 3. karta dahil edilmis ("mail forward" modeli)
    let is_part: Option<i32> = sqlx::query_scalar(
        "select 1 from record_participants where record_id = $1 and user_id = $2")
        .bind(rec.id).bind(user.id).fetch_optional(pool).await?;
    if is_part.is_some() {
        return Ok(true);
    }
    // 4. kaydin takiminin uyesi — dugum kapsam disinda olsa da (spec/20 §2a)
    if let Some(team) = rec.team_id {
        let member: Option<i32> = sqlx::query_scalar(
            "select 1 from team_members where team_id = $1 and user_id = $2")
            .bind(team).bind(user.id).fetch_optional(pool).await?;
        if member.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Bes yolun tamami. Cagiran agac kilidini TUTMAMALI.
pub async fn can_edit_record(
    pool: &PgPool, user: &User, rec: &Record, tree: &std::sync::RwLock<TreeIndex>,
) -> Result<bool, sqlx::Error> {
    if by_relation(pool, user, rec).await? {
        return Ok(true);
    }
    // 5. dal izni: kaydin birimi izinli bir dalin ALTINDA mi (O(1), Euler).
    let nodes = permitted_nodes(pool, user).await?;
    let tree = tree.read().unwrap_or_else(|e| e.into_inner());
    Ok(nodes.into_iter().any(|n| tree.is_descendant(rec.unit_id, n)))
}

/// Yapi yetkisi (veri yonetimi): yetenek + dal, IKISI BIRLIKTE (Python
/// `scope.authorized_on_node`). `edit_nodes` ve `hard_delete_nodes` ikisi de
/// dal bagimli: yetenek tek basina yetmez, dugum izinli bir dalin ALTINDA
/// olmali. Admin ikisini de atlar.
///
/// Iki sorgu bir kez kosar, sonra her dugum icin senkron O(1) — agac ekrani
/// bunu her satir icin soruyor.
pub struct NodeAccess {
    admin: bool,
    edit: bool,
    hard_delete: bool,
    permitted: Vec<Uuid>,
    /// Etkin yetenekler (scope'lu kokler icin, `node`).
    scopes: Vec<String>,
}

#[derive(Clone, Copy)]
pub enum NodeScope {
    Edit,
    HardDelete,
}

impl NodeAccess {
    pub async fn load(pool: &PgPool, user: &User) -> Result<Self, sqlx::Error> {
        let scopes = active(pool, user).await?;
        let has = |s: &str| scopes.iter().any(|x| x == s);
        Ok(NodeAccess {
            admin: user.is_admin,
            edit: has("edit_nodes"),
            hard_delete: has("hard_delete_nodes"),
            permitted: permitted_nodes(pool, user).await?,
            scopes,
        })
    }

    /// Kok semasina gore (spec/74): Birimler `edit_nodes` + dal izni (`on`),
    /// diger kokler dal izni olmadan tek scope (refdata::editor). Sert silme
    /// scope'lu koklerde ayni scope'tur; bagli kayit FK ile korunur.
    pub fn node(&self, tree: &TreeIndex, node: Uuid, scope: NodeScope) -> bool {
        match crate::refdata::editor(tree.root_key(node)) {
            crate::refdata::Editor::Branch => self.on(tree, node, scope),
            crate::refdata::Editor::Scope(s) => self.admin || self.scopes.iter().any(|x| x == s),
            crate::refdata::Editor::Admin => self.admin,
        }
    }

    pub fn on(&self, tree: &TreeIndex, node: Uuid, scope: NodeScope) -> bool {
        if self.admin {
            return true;
        }
        let has = match scope {
            NodeScope::Edit => self.edit,
            NodeScope::HardDelete => self.hard_delete,
        };
        has && self.permitted.iter().any(|p| tree.is_descendant(node, *p))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db::tree::NodeRow, models::enums::NodeType};

    fn u(id: u8) -> Uuid { Uuid::from_u128(id as u128) }

    /// kok(1) ├ a(2) ├ a1(4)
    ///        └ b(3)
    fn tree() -> TreeIndex {
        let n = |id: u8, parent: Option<u8>| NodeRow {
            id: u(id), parent_id: parent.map(u), name: id.to_string(),
            node_type: NodeType::Generic, sort_order: 0, is_active: true,
            key: None, shape: crate::models::enums::Shape::Tree, attrs: serde_json::json!({}),
        };
        TreeIndex::build(vec![n(1, None), n(2, Some(1)), n(3, Some(1)), n(4, Some(2))])
    }

    fn access(edit: bool, hard_delete: bool, permitted: &[u8]) -> NodeAccess {
        NodeAccess { admin: false, edit, hard_delete, permitted: permitted.iter().map(|i| u(*i)).collect(), scopes: vec![] }
    }

    #[test]
    fn yetenek_ve_dal_birlikte_gerekir() {
        let t = tree();
        let a = access(true, false, &[2]);
        assert!(a.on(&t, u(2), NodeScope::Edit), "izinli dugumun kendisi");
        assert!(a.on(&t, u(4), NodeScope::Edit), "alt agaca miras");
        assert!(!a.on(&t, u(1), NodeScope::Edit), "ustune cikamaz");
        assert!(!a.on(&t, u(3), NodeScope::Edit), "komsu dala karisamaz");
        assert!(!access(false, false, &[2]).on(&t, u(2), NodeScope::Edit), "yeteneksiz izin yetmez");
        assert!(!access(true, false, &[]).on(&t, u(2), NodeScope::Edit), "izinsiz yetenek yetmez");
        assert!(!a.on(&t, u(4), NodeScope::HardDelete), "kalici silme ayri yetenek");
        assert!(access(true, true, &[2]).on(&t, u(4), NodeScope::HardDelete));
    }

    #[test]
    fn admin_hepsini_atlar() {
        let a = NodeAccess { admin: true, edit: false, hard_delete: false, permitted: vec![], scopes: vec![] };
        assert!(a.on(&tree(), u(3), NodeScope::HardDelete));
        assert!(a.node(&tree(), u(3), NodeScope::Edit));
    }
}
