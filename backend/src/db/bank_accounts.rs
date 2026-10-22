//! bank_accounts veri erisimi: yalniz SQL (ORM yok, KNOW-178). Is kurali domain/ icinde kalir.

use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(sqlx::FromRow)]
pub(crate) struct BankAccountRow {
    pub id: Uuid,
    pub label: String,
    pub holder_name: String,
    pub iban: Option<String>,
    pub iban_last4: String,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
}

pub(crate) async fn list_accounts(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<Vec<BankAccountRow>, sqlx::Error> {
    sqlx::query_as(
        "select id, label, holder_name, iban, iban_last4, is_default, created_at
           from bank_accounts where user_id = $1 and deleted_at is null
          order by is_default desc, created_at")
        .bind(user).fetch_all(ex).await
}

pub(crate) async fn lock_user(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("select 1 from users where id = $1 for update").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn count_accounts(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "select count(*) from bank_accounts where user_id = $1 and deleted_at is null")
        .bind(user).fetch_one(ex).await
}

pub(crate) async fn insert_account(ex: impl sqlx::PgExecutor<'_>, user: Uuid, label: &str, holder: &str, iban: &str, is_default: bool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into bank_accounts (user_id, label, holder_name, iban, iban_last4, is_default)
         values ($1, $2, $3, $4, right($4, 4), $5)")
        .bind(user).bind(label).bind(holder).bind(iban).bind(is_default)
        .execute(ex).await?;
    Ok(())
}

pub(crate) async fn find_owned_default(ex: impl sqlx::PgExecutor<'_>, user: Uuid, id: Uuid) -> Result<Option<bool>, sqlx::Error> {
    sqlx::query_scalar(
        "select is_default from bank_accounts where id = $1 and user_id = $2 and deleted_at is null for update")
        .bind(id).bind(user).fetch_optional(ex).await
}

pub(crate) async fn set_label(ex: impl sqlx::PgExecutor<'_>, id: Uuid, label: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update bank_accounts set label = $2 where id = $1").bind(id).bind(label).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_holder(ex: impl sqlx::PgExecutor<'_>, id: Uuid, holder: &str) -> Result<(), sqlx::Error> {
    sqlx::query("update bank_accounts set holder_name = $2 where id = $1").bind(id).bind(holder).execute(ex).await?;
    Ok(())
}

pub(crate) async fn clear_defaults(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update bank_accounts set is_default = false where user_id = $1 and is_default")
        .bind(user).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_default(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update bank_accounts set is_default = true where id = $1").bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn delete_account(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("update bank_accounts set iban = null, deleted_at = now(), is_default = false where id = $1")
        .bind(id).execute(ex).await?;
    Ok(())
}

pub(crate) async fn set_latest_default(ex: impl sqlx::PgExecutor<'_>, user: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update bank_accounts set is_default = true
              where id = (select id from bank_accounts where user_id = $1 and deleted_at is null
                           order by created_at desc limit 1)")
        .bind(user).execute(ex).await?;
    Ok(())
}
