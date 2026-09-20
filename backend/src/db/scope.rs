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
    sqlx::query_scalar("select node_id from user_node_scopes where user_id = $1")
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
    let tree = tree.read().expect("agac kilidi");
    Ok(nodes.into_iter().any(|n| tree.is_descendant(rec.unit_id, n)))
}

/// Yeni kayit acma: hedef dugum izinli bir dalin altinda olmali.
pub async fn can_create_in(
    pool: &PgPool, user: &User, unit_id: Uuid, tree: &std::sync::RwLock<TreeIndex>,
) -> Result<bool, sqlx::Error> {
    if user.is_admin {
        return Ok(true);
    }
    let nodes = permitted_nodes(pool, user).await?;
    let tree = tree.read().expect("agac kilidi");
    Ok(nodes.into_iter().any(|n| tree.is_descendant(unit_id, n)))
}
