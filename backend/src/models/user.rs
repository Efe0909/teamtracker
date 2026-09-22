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

// Sutun listesi iki sorguda da ELLE yaziliyor: sqlx 0.9 `format!` ile
// kurulmus sorgu dizgisini reddediyor ("dynamic SQL strings should be audited
// for possible injections"). Dogru uyari — tekrar, enjeksiyon yuzeyinden ucuz.

impl User {
    /// Aktif kullanici, yoksa None. Pasif kullanici YOK sayilir — cagiran
    /// taraf "kapatilmis" ile "hic yok"u ayirt etmek zorunda kalmasin.
    pub async fn active(pool: &sqlx::PgPool, id: Uuid) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as(
            "select id, email, name, color, is_admin, is_active, notify_level \
             from users where id = $1 and is_active")
            .bind(id)
            .fetch_optional(pool)
            .await
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
