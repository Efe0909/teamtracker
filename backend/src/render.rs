//! Sayfa cizimi + HER sablonun gordugu ortak baglam.
//!
//! Python'da `shared/render.py` bunu yapiyordu: CSRF token'i ve sol ray
//! pinleri her sablona OTOMATIK enjekte ediliyordu. Tek yerde olmasinin
//! sebebi, unutulabilecek olmasi — bir sayfada csrf_token eksik kalirsa o
//! sayfadaki her yazma sessizce reddedilir.

use minijinja::{context, Value};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    error::Result,
    models::{module, user::User},
    state::AppState,
};

/// Rayda gorunecek moduller — kisinin pinleri.
///
/// Yonetim Paneli pinli olsa bile yetkisi olmayana CIZILMEZ: ray gorunen yuz,
/// kapi degil (KNOW-99) — ama olmayan bir kapiyi da gostermez.
pub async fn rail_pins(st: &AppState, user: &User) -> Result<Vec<module::ModuleView>> {
    let slugs: Vec<String> = sqlx::query_scalar(
        "select slug from user_pins where user_id = $1 order by pinned_at")
        .bind(user.id).fetch_all(&st.pool).await?;

    Ok(slugs.iter()
        .filter_map(|s| module::by_slug(s))
        .filter(|m| m.slug != "admin" || user.is_admin)
        .map(|m| module::ModuleView {
            slug: m.slug, icon: m.icon, name: m.name, ready: m.ready,
            desc: m.desc, plan: m.plan,
            href: format!("/{}", m.slug),
            pinned: true,
        })
        .collect())
}

#[derive(Serialize)]
pub struct UserChip {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub is_admin: bool,
    /// Varlik damgasi. `online()` sablon fonksiyonu buna bakiyor — ayri bir
    /// "kim cevrimici" sorgusu yok, kimlik cozulen her istek damgayi tazeliyor.
    pub last_seen_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Sahte kimlik modunda ray'deki kullanici degistirici icin.
pub async fn all_users(st: &AppState) -> Result<Vec<UserChip>> {
    Ok(sqlx::query_as::<_, (Uuid, String, Option<String>, bool, Option<chrono::DateTime<chrono::Utc>>)>(
        "select id, name, color, is_admin, last_seen_at from users
          where is_active order by name")
        .fetch_all(&st.pool).await?
        .into_iter()
        .map(|(id, name, color, is_admin, last_seen_at)| UserChip {
            id, name, color, is_admin, last_seen_at })
        .collect())
}

/// Her sayfanin gordugu ortak baglam. Sayfaya ozel degerler `extra` ile
/// birlestirilir.
pub async fn page(
    st: &AppState, user: &User, template: &str, extra: Value,
) -> Result<String> {
    let base = context! {
        user => user,
        rail_pins => rail_pins(st, user).await?,
        all_users => all_users(st).await?,
        // TODO(csrf): oturumda uretilecek. Bos birakmak YAZMA uclarini
        // acmaz — CSRF kapisi ayri bir katman.
        csrf_token => "",
    };
    let tpl = st.tpl.get_template(template)?;
    Ok(tpl.render(context! { ..extra, ..base })?)
}
