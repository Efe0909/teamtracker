//! Dugum bagimliliklari — silme ve tur kilidi yuklemleri.
//!
//! IKI AYRI YUKLEM, birbirinin yerine gecmez (KNOW-246):
//!   is_virgin      -> hicbir bagimlilik yok; silmek hicbir gecmisi goturmez
//!   has_projection -> bu dugume PK'siyle bagli projeksiyon satiri var (teams)
//!
//! `is_virgin` genis, `has_projection` dar: bir cocuk, ustunun turu degisince
//! sahipsiz KALMAZ — sahipsiz kalan, o dugume bagli projeksiyon satiridir.

use std::collections::HashMap;

use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Default, Clone, Copy)]
pub struct Deps {
    pub children: i64,
    pub records: i64,
    pub teams: i64,
    pub permissions: i64,
}

impl Deps {
    pub fn any(&self) -> bool {
        self.children + self.records + self.teams + self.permissions > 0
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
         union all select node_id, 'teams'       from teams where node_id is not null
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

/// Tur kilidi: projeksiyon satiri olan dugumun turu DEGISMEZ.
pub fn has_projection(deps: &HashMap<Uuid, Deps>, id: Uuid) -> bool {
    deps.get(&id).map(|d| d.teams > 0).unwrap_or(false)
}
