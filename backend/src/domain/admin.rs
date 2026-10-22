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

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    domain::common,
    audit,
    db::{admin as db, scope},
    error::{AppError, Result},
    models::{enums::NotifyLevel, user::{User, COLORS}},
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
    color: String,
    scopes: Vec<String>,
    node_ids: Vec<Uuid>,
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
    /// Bildirim ayari ozeti (yalniz gorunurluk; kisi kendi ayarini kendi degistirir).
    notify_level: NotifyLevel,
    quiet_start: Option<i16>,
    quiet_end: Option<i16>,
    /// Anlik bildirim icin kayitli cihaz sayisi.
    push_devices: i64,
    /// Bu kisiye ozel sessize alinmis / ozel secimli sohbet sayisi.
    chat_overrides: i64,
}

#[derive(Serialize)]
struct ScopeRow {
    name: String,
    direct: bool,
    via_roles: Vec<Uuid>,
}

fn group<T>(rows: Vec<(Uuid, T)>) -> HashMap<Uuid, Vec<T>> {
    let mut m: HashMap<Uuid, Vec<T>> = HashMap::new();
    for (k, v) in rows {
        m.entry(k).or_default().push(v);
    }
    m
}

async fn view(p: &PgPool, me: &User) -> Result<AdminView> {
    let scopes = db::list_scopes(p).await?;
    let roles = db::list_roles(p).await?;
    let role_scopes = group(db::list_role_scopes(p).await?);
    let role_nodes = group(db::list_role_nodes(p).await?);
    let user_roles = group(db::list_user_roles(p).await?);
    let direct = group(db::list_user_scopes(p).await?);
    let nodes = group(db::list_user_nodes(p).await?);
    let users = db::list_users(p).await?;

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
            notify_level: u.notify_level, quiet_start: u.quiet_start, quiet_end: u.quiet_end,
            push_devices: u.push_devices, chat_overrides: u.chat_overrides,
        }
    }).collect();

    let roles = roles.into_iter().map(|(id, name, color)| RoleOut {
        scopes: role_scopes.get(&id).cloned().unwrap_or_default(),
        node_ids: role_nodes.get(&id).cloned().unwrap_or_default(),
        id, name, color,
    }).collect();
    Ok(AdminView { is_admin: me.is_admin, scopes, roles, people })
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

pub(crate) async fn get(st: &AppState, me: &User) -> Result<AdminView> {
    can_manage(st, me).await?;
    view(&st.pool, me).await
}

// --- kisi ------------------------------------------------------------------

#[derive(Deserialize)]
pub struct NewUser {
    email: String,
    name: String,
}

/// Davet: satir acilir, kisi Google'la ilk girdiginde `google_sub` baglanir
/// (giris `users`'ta olmayan e-postayi reddeder, spec/70 §2.3).
pub(crate) async fn add_user(st: &AppState, me: &User, b: NewUser) -> Result<AdminView> {
    can_manage(st, me).await?;
    let email = b.email.trim().to_lowercase();
    // Kaba denetim: asil dogrulama Google girisi. Burada yazim hatasi yakalanir.
    if email.len() > 254 || !email.contains('@') || email.contains(char::is_whitespace) {
        return Err(AppError::BadRequest("invalid_email"));
    }
    let name = common::text(Some(b.name), NAME_MAX, "invalid_name")?
        .ok_or(AppError::BadRequest("invalid_name"))?;
    let added = db::insert_user(&st.pool, &email, &name, COLORS.to_vec()).await?;
    if added == 0 {
        return Err(AppError::Conflict("user_exists"));
    }
    // Otomatik davet postasi (kuyruga; gonderici henuz yok).
    let mail = crate::mail::invite(&name, &email, &st.cfg.app_url(), &st.cfg.dashboard_url());
    crate::mail::enqueue(&st.pool, "invite", &mail).await?;
    view(&st.pool, me).await
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
    /// Baskasi adina profil fotografi (yonetici yukler); null kaldirir.
    Avatar(Option<Uuid>),
}

pub(crate) async fn patch_user(st: &AppState, me: &User, id: Uuid, op: UserOp, ip: Option<std::net::IpAddr>) -> Result<AdminView> {
    can_manage(st, me).await?;
    within_grant(st, me, id, &op).await?;
    let mut tx = st.pool.begin().await?;
    // Aktif adminler KILITLI okunur: iki admin ayni anda birbirini dusururse
    // ikisi de "bir admin daha var" gorup sistemi adminsiz birakabilirdi.
    // Ikinci islem birincinin commit'ini bekler ve guncel sayiyi gorur.
    let admins: Vec<Uuid> = match op {
        UserOp::Active(_) | UserOp::Admin(_) => {
            db::list_active_admins_for_update(&mut *tx).await?
        }
        _ => vec![],
    };
    let (email, is_admin, is_active) = db::find_user_status(&mut *tx, id).await?.ok_or(AppError::NotFound)?;
    let last_admin = admins.contains(&id) && admins.len() <= 1;

    // (olay, ayrinti) — yalniz gercekten degisen yazilir.
    let event: Option<(&str, Option<String>)> = match op {
        UserOp::Admin(want) => {
            admin_only(me)?;
            if want == is_admin {
                None
            } else {
                if !want && id == me.id {
                    return Err(AppError::Conflict("self_admin"));
                }
                if !want && last_admin {
                    return Err(AppError::Conflict("last_admin"));
                }
                db::set_admin(&mut *tx, id, want).await?;
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
                db::set_active(&mut *tx, id, want).await?;
                Some(("deactivation", Some(if want { "acildi" } else { "kapatildi" }.into())))
            }
        }
        UserOp::GrantScope(s) => {
            valid_scopes(&st.pool, std::slice::from_ref(&s)).await?;
            let n = db::insert_user_scope(&mut *tx, id, &s, me.id).await?;
            (n > 0).then_some(("scope_granted", Some(s)))
        }
        UserOp::RevokeScope(s) => {
            let n = db::delete_user_scope(&mut *tx, id, &s).await?;
            (n > 0).then_some(("scope_revoked", Some(s)))
        }
        UserOp::GrantRole(r) => {
            let name = role_name(&st.pool, r).await?;
            let n = db::insert_user_role(&mut *tx, id, r, me.id).await?;
            (n > 0).then_some(("role_granted", Some(name)))
        }
        UserOp::RevokeRole(r) => {
            let name = role_name(&st.pool, r).await?;
            let n = db::delete_user_role(&mut *tx, id, r).await?;
            (n > 0).then_some(("role_revoked", Some(name)))
        }
        UserOp::GrantNode(node) => {
            let name = node_name(st, node)?;
            let n = db::insert_user_node(&mut *tx, id, node, me.id).await?;
            (n > 0).then_some(("scope_granted", Some(format!("dal: {name}"))))
        }
        UserOp::Avatar(photo) => {
            // Ek benim yukledigim, silinmemis olmali. Guvenlik olayi degil: kayit yok.
            if let Some(a) = photo {
                let ok = db::check_avatar(&mut *tx, a, me.id).await?;
                if !ok {
                    return Err(AppError::BadRequest("invalid_avatar"));
                }
            }
            db::set_avatar(&mut *tx, id, photo).await?;
            None
        }
        UserOp::RevokeNode(node) => {
            let name = node_name(st, node)?;
            let n = db::delete_user_node(&mut *tx, id, node).await?;
            (n > 0).then_some(("scope_revoked", Some(format!("dal: {name}"))))
        }
    };
    tx.commit().await?;
    if let Some((kind, detail)) = event {
        audit::log_event(st, ip, kind, Some(me.id), Some(&email),
            detail.as_deref()).await;
    }
    view(&st.pool, me).await
}

/// Admin olmayan `manage_users` sahibinin siniri (spec/75 A1). Admin sinirsiz.
/// - Kendi satirina HIC dokunmaz (grant, revoke, kapatma, avatar).
/// - Yalniz KENDINDE olani verir: scope etkin scope'larinda, rolun butun
///   scope'lari etkin scope'larinda, dal kendi dallarindan birinin altinda.
/// - `manage_users`'i ne dogrudan ne rol icinde verir.
///
/// Geri almak da ayni sinirda: veremeyecegini alamaz. Red 403 + kod; denetim
/// izi `audit::forbidden` ara katmanindan (`permission_denied`).
async fn within_grant(st: &AppState, me: &User, target: Uuid, op: &UserOp) -> Result<()> {
    if me.is_admin {
        return Ok(());
    }
    if target == me.id {
        return Err(AppError::Denied("self_permissions"));
    }
    let (wanted, wanted_nodes): (Vec<String>, Vec<Uuid>) = match op {
        UserOp::GrantScope(s) | UserOp::RevokeScope(s) => (vec![s.clone()], vec![]),
        UserOp::GrantRole(r) | UserOp::RevokeRole(r) => {
            let scopes = db::list_scopes_for_role(&st.pool, *r).await?;
            let nodes = db::list_nodes_for_role(&st.pool, *r).await?;
            (scopes, nodes)
        }
        UserOp::GrantNode(n) | UserOp::RevokeNode(n) => {
            let held = scope::permitted_nodes(&st.pool, me).await?;
            let tree = common::tree(st);
            return if held.iter().any(|p| tree.is_descendant(*n, *p)) {
                Ok(())
            } else {
                Err(AppError::Denied("grant_not_held"))
            };
        }
        UserOp::Active(_) | UserOp::Admin(_) | UserOp::Avatar(_) => return Ok(()),
    };
    if wanted.iter().any(|s| s == "manage_users") {
        return Err(AppError::Denied("grant_manage_users"));
    }
    let mine = scope::active(&st.pool, me).await?;
    if wanted.iter().any(|s| !mine.contains(s)) {
        return Err(AppError::Denied("grant_not_held"));
    }
    if !wanted_nodes.is_empty() {
        let held = scope::permitted_nodes(&st.pool, me).await?;
        let tree = common::tree(st);
        if wanted_nodes.iter().any(|n| !held.iter().any(|p| tree.is_descendant(*n, *p))) {
            return Err(AppError::Denied("grant_not_held"));
        }
    }
    Ok(())
}

/// Yazim hatasi sessizce yetki vermesin: FK de korur ama 500 yerine kod.
async fn valid_scopes(p: &PgPool, names: &[String]) -> Result<()> {
    let mut want: Vec<&String> = names.iter().collect();
    want.sort();
    want.dedup();
    let found = db::count_scopes(p, names).await?;
    if found as usize == want.len() { Ok(()) } else { Err(AppError::BadRequest("invalid_scope")) }
}

async fn role_name(p: &PgPool, id: Uuid) -> Result<String> {
    db::find_role_name(p, id).await?.ok_or(AppError::BadRequest("unknown_role"))
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
    color: Option<String>,
    #[serde(default)]
    scopes: Option<Vec<String>>,
    #[serde(default)]
    node_ids: Option<Vec<Uuid>>,
}

/// Rol yetkileri atama aninda kopyalanmaz; atanan kisilerde canli hesaplanir.
fn valid_role_color(color: &str) -> Result<()> {
    if color.len() == 7 && color.starts_with('#')
        && color[1..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        Ok(())
    } else {
        Err(AppError::BadRequest("invalid_color"))
    }
}

fn valid_role_nodes(st: &AppState, nodes: &[Uuid]) -> Result<()> {
    let tree = common::tree(st);
    if nodes.iter().all(|id| tree.get(*id).is_some_and(|n| {
        n.is_active && crate::refdata::under(&tree, *id, crate::refdata::UNITS)
    })) {
        Ok(())
    } else {
        Err(AppError::BadRequest("invalid_parent"))
    }
}

/// Rol SIG: kapsam ve dal izinleri atanan kisilerde canli hesaplanir.
async fn write_role(
    st: &AppState, tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, id: Option<Uuid>, me: &User,
    b: RoleIn,
) -> Result<Uuid> {
    let name = b.name.map(|n| common::text(Some(n), NAME_MAX, "invalid_name")).transpose()?.flatten();
    if let Some(s) = &b.scopes {
        valid_scopes(&st.pool, s).await?;
    }
    if let Some(c) = &b.color {
        valid_role_color(c)?;
    }
    if let Some(nodes) = &b.node_ids {
        valid_role_nodes(st, nodes)?;
    }
    let color = b.color.or_else(|| id.is_none().then(|| "#5b8cff".to_string()));
    let id = match (id, name) {
        (None, None) => return Err(AppError::BadRequest("invalid_name")),
        (None, Some(n)) => db::insert_role(&mut **tx, n, me.id, color.clone()).await?
            .ok_or(AppError::Conflict("role_exists"))?,
        (Some(id), Some(n)) => {
            let taken = db::find_role_name_conflict(&mut **tx, &n, id).await?;
            if taken.is_some() {
                return Err(AppError::Conflict("role_exists"));
            }
            db::update_role(&mut **tx, id, n, color).await?;
            id
        }
        (Some(id), None) => {
            if let Some(color) = color {
                db::set_role_color(&mut **tx, id, color).await?;
            }
            id
        }
    };
    if let Some(s) = b.scopes {
        db::delete_role_scopes(&mut **tx, id).await?;
        db::insert_role_scopes(&mut **tx, id, s).await?;
    }
    if let Some(nodes) = b.node_ids {
        db::delete_role_nodes(&mut **tx, id).await?;
        db::insert_role_nodes(&mut **tx, id, nodes, me.id).await?;
    }
    Ok(id)
}

pub(crate) async fn create_role(st: &AppState, me: &User, b: RoleIn, ip: Option<std::net::IpAddr>) -> Result<AdminView> {
    admin_only(me)?;
    let name = b.name.clone().unwrap_or_default();
    let mut tx = st.pool.begin().await?;
    write_role(st, &mut tx, None, me, b).await?;
    tx.commit().await?;
    audit::log_event(st, ip, "role_created", Some(me.id), Some(&me.email),
        Some(name.trim())).await;
    view(&st.pool, me).await
}

pub(crate) async fn patch_role(st: &AppState, me: &User, id: Uuid, b: RoleIn) -> Result<AdminView> {
    admin_only(me)?;
    role_name(&st.pool, id).await.map_err(|_| AppError::NotFound)?;
    let mut tx = st.pool.begin().await?;
    write_role(st, &mut tx, Some(id), me, b).await?;
    tx.commit().await?;
    view(&st.pool, me).await
}

/// Rol silinince yalniz ONDAN gelen gider; ayni kapsam dogrudan da verildiyse
/// `user_scopes` satiri kalir — iki kaynak bagimsiz.
pub(crate) async fn delete_role(st: &AppState, me: &User, id: Uuid, ip: Option<std::net::IpAddr>) -> Result<AdminView> {
    admin_only(me)?;
    let name = db::delete_role(&st.pool, id).await?.ok_or(AppError::NotFound)?;
    audit::log_event(st, ip, "role_deleted", Some(me.id), Some(&me.email),
        Some(&name)).await;
    view(&st.pool, me).await
}

// --- aktivite ----------------------------------------------------------------

/// Gunluk kullanim. `requests`/`minutes` varlik sayaclari (user_activity);
/// `messages`/`changes` KATKI: o gun gonderilen mesaj ve yazdigi olay
/// (kayit acma, alan degisikligi, eylem, katilma, takim isleri — `activity`).
#[derive(Serialize)]
pub struct DayUse {
    day: chrono::NaiveDate,
    requests: i32,
    minutes: i32,
    messages: i32,
    changes: i32,
}

#[derive(Serialize)]
pub struct PersonUse {
    user_id: Uuid,
    last_login_at: Option<DateTime<Utc>>,
    last_seen_at: Option<DateTime<Utc>>,
    /// Son 120 gun, eskiden yeniye; kullanimsiz gunler yok.
    days: Vec<DayUse>,
}

/// Kisi bazli kullanim: son giris, son hareket, gunluk istek/dakika.
pub(crate) async fn activity(st: &AppState, me: &User) -> Result<Vec<PersonUse>> {
    can_manage(st, me).await?;
    let people = db::list_logins(&st.pool).await?;
    // Uc kaynak gun gun birlesir: varlik sayaclari + yazilan mesaj + yazilan olay.
    // `created_at::date` oturum saat diliminde — `current_date` ile ayni gun siniri.
    // ponytail: messages/activity'de (yazar, tarih) indeksi yok, 120 gunluk tarama;
    // satir sayisi buyurse `(author_id, created_at)` / `(actor_id, created_at)` indeksi.
    let rows = db::list_activity(&st.pool).await?;
    let mut by: HashMap<Uuid, Vec<DayUse>> = HashMap::new();
    for db::ActivityRow { user_id: u, day, requests, minutes, messages, changes } in rows {
        by.entry(u).or_default().push(DayUse { day, requests, minutes, messages, changes });
    }
    Ok(people.into_iter().map(|p| PersonUse {
        days: by.remove(&p.id).unwrap_or_default(), user_id: p.id,
        last_login_at: p.last_login_at, last_seen_at: p.last_seen_at,
    }).collect())
}
