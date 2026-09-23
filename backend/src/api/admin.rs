//! Yonetim paneli (R3-F01..F05, spec/71-yonetim-paneli.md): kisi, yetenek,
//! rol, dal izni.
//!
//! Kapi iki kademe (Python `_require_manage_users` / `_require_admin`):
//! panel ve kisi islemleri `manage_users` ya da admin; `is_admin` ve rol
//! TANIMI yalniz admin — `manage_users` sahibi "her seyi yapan" bir rol
//! yaratip kendine veremesin (spec/71 §5 madde 3).
//!
//! Her yazma guncel paneli dondurur (nodes.rs ile ayni desen). Kilitlenme
//! korumasi burada: panel sunucuya girmeyi gereksiz kilmak icin var, kendi
//! kendini kilitleyemez (spec/71 §5).

use std::collections::{BTreeMap, HashMap};

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    api::common::{self, Body},
    audit,
    auth::CurrentUser,
    error::{AppError, Result},
    models::user::{User, COLORS},
    state::AppState,
};

const NAME_MAX: usize = 200;

// --- okuma -----------------------------------------------------------------

#[derive(Serialize)]
pub struct AdminView {
    /// Rol tanimi ve `is_admin` dugmeleri yalniz admine.
    is_admin: bool,
    scopes: Vec<String>,
    roles: Vec<RoleOut>,
    people: Vec<Person>,
}

#[derive(Serialize)]
struct RoleOut {
    id: Uuid,
    name: String,
    scopes: Vec<String>,
}

#[derive(Serialize)]
struct Person {
    id: Uuid,
    email: String,
    name: String,
    color: Option<String>,
    is_admin: bool,
    is_active: bool,
    last_seen_at: Option<DateTime<Utc>>,
    /// Etkin yetenekler ve KAYNAGI (R3-F05): dogrudan mi, hangi rollerden.
    /// Rolden geleni burada silinmez, rolun kendisinden gider.
    scopes: Vec<ScopeRow>,
    role_ids: Vec<Uuid>,
    /// Dal izinleri (`user_node_scopes`). Python'da arayuzu yoktu: panelden
    /// verilen `edit_nodes` dalsiz ise yaramiyordu (yetenek + dal birlikte).
    node_ids: Vec<Uuid>,
}

#[derive(Serialize)]
struct ScopeRow {
    name: String,
    direct: bool,
    via_roles: Vec<Uuid>,
}

#[derive(sqlx::FromRow)]
struct UserRow {
    id: Uuid,
    email: String,
    name: String,
    color: Option<String>,
    is_admin: bool,
    is_active: bool,
    last_seen_at: Option<DateTime<Utc>>,
}

fn group<T>(rows: Vec<(Uuid, T)>) -> HashMap<Uuid, Vec<T>> {
    let mut m: HashMap<Uuid, Vec<T>> = HashMap::new();
    for (k, v) in rows {
        m.entry(k).or_default().push(v);
    }
    m
}

async fn view(p: &PgPool, me: &User) -> Result<Json<AdminView>> {
    let scopes = sqlx::query_scalar("select name from scopes order by name").fetch_all(p).await?;
    let roles: Vec<(Uuid, String)> =
        sqlx::query_as("select id, name from roles order by name").fetch_all(p).await?;
    let role_scopes = group(sqlx::query_as::<_, (Uuid, String)>(
        "select role_id, scope from role_scopes order by scope").fetch_all(p).await?);
    let user_roles = group(sqlx::query_as::<_, (Uuid, Uuid)>(
        "select user_id, role_id from user_roles").fetch_all(p).await?);
    let direct = group(sqlx::query_as::<_, (Uuid, String)>(
        "select user_id, scope from user_scopes").fetch_all(p).await?);
    let nodes = group(sqlx::query_as::<_, (Uuid, Uuid)>(
        "select user_id, node_id from user_node_scopes").fetch_all(p).await?);
    let users: Vec<UserRow> = sqlx::query_as(
        "select id, email, name, color, is_admin, is_active, last_seen_at from users order by name")
        .fetch_all(p).await?;

    let people = users.into_iter().map(|u| {
        let mut rows: BTreeMap<String, ScopeRow> = BTreeMap::new();
        let row = |name: &String| ScopeRow { name: name.clone(), direct: false, via_roles: vec![] };
        for s in direct.get(&u.id).into_iter().flatten() {
            rows.entry(s.clone()).or_insert_with(|| row(s)).direct = true;
        }
        let role_ids = user_roles.get(&u.id).cloned().unwrap_or_default();
        for r in &role_ids {
            for s in role_scopes.get(r).into_iter().flatten() {
                rows.entry(s.clone()).or_insert_with(|| row(s)).via_roles.push(*r);
            }
        }
        Person {
            scopes: rows.into_values().collect(),
            role_ids,
            node_ids: nodes.get(&u.id).cloned().unwrap_or_default(),
            id: u.id, email: u.email, name: u.name, color: u.color,
            is_admin: u.is_admin, is_active: u.is_active, last_seen_at: u.last_seen_at,
        }
    }).collect();

    let roles = roles.into_iter().map(|(id, name)| RoleOut {
        scopes: role_scopes.get(&id).cloned().unwrap_or_default(), id, name,
    }).collect();
    Ok(Json(AdminView { is_admin: me.is_admin, scopes, roles, people }))
}

async fn can_manage(st: &AppState, me: &User) -> Result<()> {
    if me.is_admin || common::has_scope(st, me, "manage_users").await? {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

fn admin_only(me: &User) -> Result<()> {
    if me.is_admin { Ok(()) } else { Err(AppError::Forbidden) }
}

pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<AdminView>> {
    can_manage(&st, &me).await?;
    view(&st.pool, &me).await
}

// --- kisi ------------------------------------------------------------------

#[derive(Deserialize)]
pub struct NewUser {
    email: String,
    name: String,
}

/// Davet: satir acilir, kisi Google'la ilk girdiginde `google_sub` baglanir
/// (giris `users`'ta olmayan e-postayi reddeder, spec/70 §2.3).
pub async fn add_user(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<NewUser>,
) -> Result<Json<AdminView>> {
    can_manage(&st, &me).await?;
    let email = b.email.trim().to_lowercase();
    // Kaba denetim: asil dogrulama Google girisi. Burada yazim hatasi yakalanir.
    if email.len() > 254 || !email.contains('@') || email.contains(char::is_whitespace) {
        return Err(AppError::BadRequest("invalid_email"));
    }
    let name = common::text(Some(b.name), NAME_MAX, "invalid_name")?
        .ok_or(AppError::BadRequest("invalid_name"))?;
    let added = sqlx::query(
        "insert into users (email, name, color)
         values ($1, $2, ($3::text[])[1 + ((select count(*) from users) % 6)::int])
         on conflict (lower(email)) do nothing")
        .bind(&email).bind(&name).bind(COLORS.to_vec())
        .execute(&st.pool).await?.rows_affected();
    if added == 0 {
        return Err(AppError::Conflict("user_exists"));
    }
    view(&st.pool, &me).await
}

/// Kisi uzerinde TEK islem (kayit PATCH'iyle ayni `{op, value}` deseni).
#[derive(Deserialize)]
#[serde(tag = "op", content = "value", rename_all = "snake_case")]
pub enum UserOp {
    Active(bool),
    Admin(bool),
    GrantScope(String),
    RevokeScope(String),
    GrantRole(Uuid),
    RevokeRole(Uuid),
    GrantNode(Uuid),
    RevokeNode(Uuid),
}

pub async fn patch_user(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap,
    Path(raw): Path<String>, Body(op): Body<UserOp>,
) -> Result<Json<AdminView>> {
    can_manage(&st, &me).await?;
    let id = common::id(&raw)?;
    let mut tx = st.pool.begin().await?;
    // Aktif adminler KILITLI okunur: iki admin ayni anda birbirini dusururse
    // ikisi de "bir admin daha var" gorup sistemi adminsiz birakabilirdi.
    // Ikinci islem birincinin commit'ini bekler ve guncel sayiyi gorur.
    let admins: Vec<Uuid> = match op {
        UserOp::Active(_) | UserOp::Admin(_) => {
            sqlx::query_scalar("select id from users where is_admin and is_active for update")
                .fetch_all(&mut *tx).await?
        }
        _ => vec![],
    };
    let (email, is_admin, is_active): (String, bool, bool) =
        sqlx::query_as("select email, is_admin, is_active from users where id = $1")
            .bind(id).fetch_optional(&mut *tx).await?.ok_or(AppError::NotFound)?;
    let last_admin = admins.contains(&id) && admins.len() <= 1;

    // (olay, ayrinti) — yalniz gercekten degisen yazilir.
    let event: Option<(&str, Option<String>)> = match op {
        UserOp::Admin(want) => {
            admin_only(&me)?;
            if want == is_admin {
                None
            } else {
                if !want && id == me.id {
                    return Err(AppError::Conflict("self_admin"));
                }
                if !want && last_admin {
                    return Err(AppError::Conflict("last_admin"));
                }
                sqlx::query("update users set is_admin = $2 where id = $1")
                    .bind(id).bind(want).execute(&mut *tx).await?;
                Some((if want { "admin_granted" } else { "admin_revoked" }, None))
            }
        }
        UserOp::Active(want) => {
            // manage_users bir admini kapatamaz: yoksa adminleri sonuncusuna
            // kadar tek tek disari atabilirdi (Python buna izin veriyordu).
            if is_admin && !me.is_admin {
                return Err(AppError::Forbidden);
            }
            if want == is_active {
                None
            } else {
                if !want && last_admin {
                    return Err(AppError::Conflict("last_admin"));
                }
                sqlx::query("update users set is_active = $2 where id = $1")
                    .bind(id).bind(want).execute(&mut *tx).await?;
                Some(("deactivation", Some(if want { "acildi" } else { "kapatildi" }.into())))
            }
        }
        UserOp::GrantScope(s) => {
            valid_scopes(&st.pool, std::slice::from_ref(&s)).await?;
            let n = sqlx::query(
                "insert into user_scopes (user_id, scope, granted_by) values ($1, $2, $3)
                 on conflict do nothing")
                .bind(id).bind(&s).bind(me.id).execute(&mut *tx).await?.rows_affected();
            (n > 0).then_some(("scope_granted", Some(s)))
        }
        UserOp::RevokeScope(s) => {
            let n = sqlx::query("delete from user_scopes where user_id = $1 and scope = $2")
                .bind(id).bind(&s).execute(&mut *tx).await?.rows_affected();
            (n > 0).then_some(("scope_revoked", Some(s)))
        }
        UserOp::GrantRole(r) => {
            let name = role_name(&st.pool, r).await?;
            let n = sqlx::query(
                "insert into user_roles (user_id, role_id, granted_by) values ($1, $2, $3)
                 on conflict do nothing")
                .bind(id).bind(r).bind(me.id).execute(&mut *tx).await?.rows_affected();
            (n > 0).then_some(("role_granted", Some(name)))
        }
        UserOp::RevokeRole(r) => {
            let name = role_name(&st.pool, r).await?;
            let n = sqlx::query("delete from user_roles where user_id = $1 and role_id = $2")
                .bind(id).bind(r).execute(&mut *tx).await?.rows_affected();
            (n > 0).then_some(("role_revoked", Some(name)))
        }
        UserOp::GrantNode(node) => {
            let name = node_name(&st, node)?;
            let n = sqlx::query(
                "insert into user_node_scopes (user_id, node_id, granted_by) values ($1, $2, $3)
                 on conflict do nothing")
                .bind(id).bind(node).bind(me.id).execute(&mut *tx).await?.rows_affected();
            (n > 0).then_some(("scope_granted", Some(format!("dal: {name}"))))
        }
        UserOp::RevokeNode(node) => {
            let name = node_name(&st, node)?;
            let n = sqlx::query("delete from user_node_scopes where user_id = $1 and node_id = $2")
                .bind(id).bind(node).execute(&mut *tx).await?.rows_affected();
            (n > 0).then_some(("scope_revoked", Some(format!("dal: {name}"))))
        }
    };
    tx.commit().await?;
    if let Some((kind, detail)) = event {
        audit::log_event(&st, audit::client_ip(&headers), kind, Some(me.id), Some(&email),
            detail.as_deref()).await;
    }
    view(&st.pool, &me).await
}

/// Yazim hatasi sessizce yetki vermesin: FK de korur ama 500 yerine kod.
async fn valid_scopes(p: &PgPool, names: &[String]) -> Result<()> {
    let mut want: Vec<&String> = names.iter().collect();
    want.sort();
    want.dedup();
    let found: i64 = sqlx::query_scalar("select count(*) from scopes where name = any($1)")
        .bind(names).fetch_one(p).await?;
    if found as usize == want.len() { Ok(()) } else { Err(AppError::BadRequest("invalid_scope")) }
}

async fn role_name(p: &PgPool, id: Uuid) -> Result<String> {
    sqlx::query_scalar("select name from roles where id = $1")
        .bind(id).fetch_optional(p).await?.ok_or(AppError::BadRequest("unknown_role"))
}

fn node_name(st: &AppState, id: Uuid) -> Result<String> {
    let tree = common::tree(st);
    tree.get(id).map(|n| n.name.clone()).ok_or(AppError::BadRequest("invalid_parent"))
}

// --- roller (yalniz admin) --------------------------------------------------

#[derive(Deserialize)]
pub struct RoleIn {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    scopes: Option<Vec<String>>,
}

/// Rol SIG: kapsam demeti, okuma aninda birlesir (`db::scope::active`) —
/// duzenleme mevcut sahiplerine aninda yansir.
async fn write_role(
    st: &AppState, tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, id: Option<Uuid>, me: &User,
    b: RoleIn,
) -> Result<Uuid> {
    let name = b.name.map(|n| common::text(Some(n), NAME_MAX, "invalid_name")).transpose()?.flatten();
    if let Some(s) = &b.scopes {
        valid_scopes(&st.pool, s).await?;
    }
    let id = match (id, name) {
        (None, None) => return Err(AppError::BadRequest("invalid_name")),
        (None, Some(n)) => sqlx::query_scalar(
            "insert into roles (name, created_by) values ($1, $2) on conflict (name) do nothing
             returning id")
            .bind(n).bind(me.id).fetch_optional(&mut **tx).await?
            .ok_or(AppError::Conflict("role_exists"))?,
        (Some(id), Some(n)) => {
            let taken: Option<i32> = sqlx::query_scalar("select 1 from roles where name = $1 and id <> $2")
                .bind(&n).bind(id).fetch_optional(&mut **tx).await?;
            if taken.is_some() {
                return Err(AppError::Conflict("role_exists"));
            }
            sqlx::query("update roles set name = $2 where id = $1").bind(id).bind(n)
                .execute(&mut **tx).await?;
            id
        }
        (Some(id), None) => id,
    };
    if let Some(s) = b.scopes {
        sqlx::query("delete from role_scopes where role_id = $1").bind(id).execute(&mut **tx).await?;
        sqlx::query("insert into role_scopes (role_id, scope) select $1, unnest($2::text[])
                     on conflict do nothing")
            .bind(id).bind(s).execute(&mut **tx).await?;
    }
    Ok(id)
}

pub async fn create_role(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Body(b): Body<RoleIn>,
) -> Result<Json<AdminView>> {
    admin_only(&me)?;
    let name = b.name.clone().unwrap_or_default();
    let mut tx = st.pool.begin().await?;
    write_role(&st, &mut tx, None, &me, b).await?;
    tx.commit().await?;
    audit::log_event(&st, audit::client_ip(&headers), "role_created", Some(me.id), Some(&me.email),
        Some(name.trim())).await;
    view(&st.pool, &me).await
}

pub async fn patch_role(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<RoleIn>,
) -> Result<Json<AdminView>> {
    admin_only(&me)?;
    let id = common::id(&raw)?;
    role_name(&st.pool, id).await.map_err(|_| AppError::NotFound)?;
    let mut tx = st.pool.begin().await?;
    write_role(&st, &mut tx, Some(id), &me, b).await?;
    tx.commit().await?;
    view(&st.pool, &me).await
}

/// Rol silinince yalniz ONDAN gelen gider; ayni kapsam dogrudan da verildiyse
/// `user_scopes` satiri kalir — iki kaynak bagimsiz.
pub async fn delete_role(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, Path(raw): Path<String>,
) -> Result<Json<AdminView>> {
    admin_only(&me)?;
    let id = common::id(&raw)?;
    let name: String = sqlx::query_scalar("delete from roles where id = $1 returning name")
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;
    audit::log_event(&st, audit::client_ip(&headers), "role_deleted", Some(me.id), Some(&me.email),
        Some(&name)).await;
    view(&st.pool, &me).await
}
