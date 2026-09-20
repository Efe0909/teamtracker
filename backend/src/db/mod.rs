//! Havuz, sorgu yardimcilari, agac. ORM YOK — ham SQL, sqlx derleme zamani
//! denetimi (KNOW-178). Filtreleme SQL`de; tum kayitlari cekip Rust`ta elemek
//! YASAK (KNOW-181). Parametreli sorgu sart, sutun adi beyaz liste (KNOW-104).

pub mod feed;
pub mod filters;
pub mod nodes;
pub mod pool;
pub mod scope;
pub mod search;
pub mod tree;

/// Gocler acilista kendiliginden kosar. Dosya adlari, ilk gercek
/// kurulumdan sonra DONAR: yeniden adlandirilan goc uygulanmamis
/// sayilir ve YENIDEN KOSAR (CLAUDE.md).
pub async fn migrate(pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    sqlx::migrate!("./migrations").run(pool).await.map_err(Into::into)
}
