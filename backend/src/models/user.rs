//! `users` satiri.

use serde::Serialize;
use uuid::Uuid;

use crate::models::enums::NotifyLevel;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub color: Option<String>,
    pub is_admin: bool,
    /// Kullanici SILINMEZ, kapatilir: `created_by` alanlari `on delete
    /// restrict` ve gecmis onlara bagli. Kapatma her istekte okunur, yani
    /// ANINDA etki eder.
    pub is_active: bool,
    pub notify_level: NotifyLevel,
}

/// Yeni kisinin avatar rengi, sirayla (Python `references/python/shared/users.py` COLORS).
pub const COLORS: [&str; 6] = ["#5b8cff", "#e5484d", "#d99a2b", "#22a06b", "#7c5bff", "#b4501a"];

impl User {
    /// Aktif kullanici, yoksa None. Pasif kullanici YOK sayilir — cagiran
    /// taraf "kapatilmis" ile "hic yok"u ayirt etmek zorunda kalmasin.
    pub async fn active(pool: &sqlx::PgPool, id: Uuid) -> Result<Option<User>, sqlx::Error> {
        crate::db::profile::find_active_user(pool, id).await
    }
}

/// Kisi rozeti — akis ve eylem satirlarinin paylastigi tip.
#[derive(Debug, Clone, Serialize)]
pub struct UserChip {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub is_admin: bool,
    /// Varlik damgasi: kimlik cozulen her istek tazeliyor (auth.rs).
    pub last_seen_at: Option<chrono::DateTime<chrono::Utc>>,
}
