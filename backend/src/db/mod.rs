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
    let m = sqlx::migrate!("./migrations");
    collapse_legacy(pool, &m).await?;
    m.run(pool).await.map_err(Into::into)
}

/// TEK SEFERLIK KOPRU: 001..025 gocu `025_baseline.sql`e sikistirildi. Eski gocleri
/// tek tek koşmus veritabaninda `_sqlx_migrations` satirlari tabana indirilir; yoksa
/// sqlx "001 eksik / 025 degismis" der ve uygulama acilmaz. Sema degismez (taban =
/// 001..025'in son hali), tek islem, milisaniye. Eski satirlar
/// `_sqlx_migrations_pre_squash`ta kalir: eski surume donus icin geri yazilir.
/// Tum ortamlar bu surumle bir kez acildiktan sonra bu fonksiyonu SIL.
async fn collapse_legacy(pool: &sqlx::PgPool, m: &sqlx::migrate::Migrator) -> Result<(), sqlx::Error> {
    const BASE: i64 = 25;
    let base = m.iter().find(|x| x.version == BASE)
        .ok_or_else(|| sqlx::Error::Protocol("taban gocu 025 yok".into()))?;
    let mut tx = pool.begin().await?;
    let table: Option<String> = sqlx::query_scalar("select to_regclass('_sqlx_migrations')::text")
        .fetch_one(&mut *tx).await?;
    if table.is_none() {
        return Ok(()); // bos veritabani: taban normal kosar
    }
    let (old, base_ok): (i64, i64) = sqlx::query_as(
        "select count(*) filter (where version < $1), \
                count(*) filter (where version = $1 and success) \
         from _sqlx_migrations")
        .bind(BASE).fetch_one(&mut *tx).await?;
    if old == 0 {
        return Ok(()); // zaten sikistirilmis (ya da taban ile kurulmus)
    }
    if base_ok == 0 {
        return Err(sqlx::Error::Protocol(
            "veritabani 025'ten eski: once sikistirma oncesi surumle 025'e kadar goc et".into()));
    }
    sqlx::query("create table if not exists _sqlx_migrations_pre_squash as table _sqlx_migrations")
        .execute(&mut *tx).await?;
    sqlx::query("delete from _sqlx_migrations where version <= $1").bind(BASE)
        .execute(&mut *tx).await?;
    sqlx::query(
        "insert into _sqlx_migrations (version, description, success, checksum, execution_time) \
         values ($1, $2, true, $3, 0)")
        .bind(BASE).bind(base.description.as_ref()).bind(base.checksum.as_ref())
        .execute(&mut *tx).await?;
    tx.commit().await?;
    tracing::info!("goc: 001..025 satiri tabana (025) sikistirildi");
    Ok(())
}
