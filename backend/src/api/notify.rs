//! Bildirimler: uygulama ici liste, iki katmanli tercih, push abonelikleri.
//!
//! Liste hala `chat_feed`'den turetilir (tablo yok). Hangi satirin gorunecegi
//! TEK kapida (`push::decide`) karar verilir: sohbete ozel secim varsa o,
//! yoksa kisinin varsayilani. Okundu bilgisi tek damga
//! (`users.notifications_seen_at`): ondan yenisi "okunmamis".

use std::collections::HashMap;


use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Timelike, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    api::common::{self, Body},
    auth::CurrentUser,
    error::{AppError, Result},
    mentions,
    models::enums::NotifyLevel,
    push,
    state::AppState,
    channel::{Address, Channel, Message, Outcome},
};

/// Beni ilgilendiren sohbetlerdeki son hareketler, benimkiler haric; tercihime
/// gore suzulmus. Son 60 satir.
#[derive(Serialize, sqlx::FromRow)]
pub struct Notice {
    kind: String,
    id: Uuid,
    created_at: DateTime<Utc>,
    chat_id: Uuid,
    actor_id: Option<Uuid>,
    verb: Option<String>,
    subject_label: Option<String>,
    target_label: Option<String>,
    body: Option<String>,
    record_id: Option<Uuid>,
    team_id: Option<Uuid>,
    title: String,
    #[sqlx(skip)]
    unread: bool,
}

#[derive(Serialize)]
pub struct NoticeList {
    items: Vec<Notice>,
    unread: usize,
}

/// Tercihlerim: varsayilan + sessiz saat + sohbet basina ozel secimler.
#[derive(Serialize)]
pub struct Prefs {
    level: NotifyLevel,
    quiet_start: Option<i16>,
    quiet_end: Option<i16>,
    chats: HashMap<Uuid, NotifyLevel>,
}

async fn load_prefs(st: &AppState, me: Uuid) -> Result<Prefs> {
    let (level, quiet_start, quiet_end): (NotifyLevel, Option<i16>, Option<i16>) = sqlx::query_as(
        "select notify_level, quiet_start, quiet_end from users where id = $1")
        .bind(me).fetch_one(&st.pool).await?;
    let rows: Vec<(Uuid, NotifyLevel)> = sqlx::query_as(
        "select chat_id, mode from chat_prefs where user_id = $1")
        .bind(me).fetch_all(&st.pool).await?;
    Ok(Prefs { level, quiet_start, quiet_end, chats: rows.into_iter().collect() })
}

/// Mesaj beni aniyor mu: `@adim` ya da grup anmasi (@all, @here, @team).
fn mentions_me(body: Option<&str>, my_handle: &str) -> bool {
    body.is_some_and(|b| mentions::tokens(b).iter()
        .any(|k| k == my_handle || mentions::GROUPS.contains(&k.as_str())))
}

pub async fn list(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<NoticeList>> {
    let prefs = load_prefs(&st, me.id).await?;
    let seen: DateTime<Utc> = sqlx::query_scalar("select notifications_seen_at from users where id = $1")
        .bind(me.id).fetch_one(&st.pool).await?;
    // Suzme Rust'ta: fazladan cekilir (4x), sonra kirpilir.
    let rows: Vec<Notice> = sqlx::query_as(
        "with mine as (
           select r.chat_id, r.id as record_id, null::uuid as team_id, r.title
             from records r
            where r.owner_id = $1 or r.created_by = $1
               or exists(select 1 from record_participants p
                          where p.record_id = r.id and p.user_id = $1)
               or exists(select 1 from actions a where a.record_id = r.id and a.owner_id = $1)
               or r.team_id in (select team_id from team_members where user_id = $1)
           union all
           select t.chat_id, null, t.id, t.name
             from teams t join team_members m on m.team_id = t.id and m.user_id = $1
         )
         select f.kind, f.id, f.created_at, f.chat_id, f.actor_id, f.verb, f.subject_label,
                f.target_label, f.body, mine.record_id, mine.team_id, mine.title
           from chat_feed f join mine on mine.chat_id = f.chat_id
          where f.actor_id is distinct from $1
          order by f.created_at desc limit 240")
        .bind(me.id).fetch_all(&st.pool).await?;
    let handle = mentions::handle(&me.name);
    let items: Vec<Notice> = rows.into_iter().filter(|n| {
        let mentioned = n.kind == "message" && mentions_me(n.body.as_deref(), &handle);
        push::decide(prefs.level, prefs.chats.get(&n.chat_id).copied(), mentioned, None, 0).in_app
    }).take(60).map(|mut n| { n.unread = n.created_at > seen; n }).collect();
    let unread = items.iter().filter(|n| n.unread).count();
    Ok(Json(NoticeList { items, unread }))
}

pub async fn seen(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<StatusCode> {
    sqlx::query("update users set notifications_seen_at = now() where id = $1")
        .bind(me.id).execute(&st.pool).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn prefs(State(st): State<AppState>, CurrentUser(me): CurrentUser) -> Result<Json<Prefs>> {
    Ok(Json(load_prefs(&st, me.id).await?))
}

/// Verilmeyen alan DEGISMEZ; sessiz saat `null` ile kapanir (ikisi birlikte).
#[derive(Deserialize)]
pub struct PrefsPatch {
    #[serde(default)]
    level: Option<NotifyLevel>,
    #[serde(default, deserialize_with = "common::present")]
    quiet_start: Option<Option<i16>>,
    #[serde(default, deserialize_with = "common::present")]
    quiet_end: Option<Option<i16>>,
}

pub async fn patch_prefs(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(p): Body<PrefsPatch>,
) -> Result<Json<Prefs>> {
    let old = load_prefs(&st, me.id).await?;
    let (start, end) = (p.quiet_start.unwrap_or(old.quiet_start), p.quiet_end.unwrap_or(old.quiet_end));
    let hour_ok = |h: Option<i16>| h.is_none_or(|h| (0..24).contains(&h));
    if start.is_some() != end.is_some() || !hour_ok(start) || !hour_ok(end) {
        return Err(AppError::BadRequest("invalid_quiet_hours"));
    }
    sqlx::query("update users set notify_level = $2, quiet_start = $3, quiet_end = $4 where id = $1")
        .bind(me.id).bind(p.level.unwrap_or(old.level)).bind(start).bind(end)
        .execute(&st.pool).await?;
    Ok(Json(load_prefs(&st, me.id).await?))
}

#[derive(Deserialize)]
pub struct ChatPref {
    /// null = ozel secimi kaldir, varsayilana don.
    mode: Option<NotifyLevel>,
}

pub async fn set_chat(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<ChatPref>,
) -> Result<Json<Prefs>> {
    let chat = common::id(&raw)?;
    let exists: Option<i32> = sqlx::query_scalar("select 1 from chats where id = $1")
        .bind(chat).fetch_optional(&st.pool).await?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }
    match b.mode {
        Some(mode) => {
            sqlx::query(
                "insert into chat_prefs (user_id, chat_id, mode) values ($1, $2, $3)
                 on conflict (user_id, chat_id) do update set mode = excluded.mode")
                .bind(me.id).bind(chat).bind(mode).execute(&st.pool).await?;
        }
        None => {
            sqlx::query("delete from chat_prefs where user_id = $1 and chat_id = $2")
                .bind(me.id).bind(chat).execute(&st.pool).await?;
        }
    }
    Ok(Json(load_prefs(&st, me.id).await?))
}

// --- push abonelikleri -----------------------------------------------------

#[derive(Deserialize)]
pub struct Subscription {
    endpoint: String,
    p256dh: String,
    auth: String,
}

pub async fn subscribe(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<Subscription>,
) -> Result<StatusCode> {
    if !b.endpoint.starts_with("https://") || b.endpoint.len() > 2000
        || b.p256dh.is_empty() || b.auth.is_empty() {
        return Err(AppError::BadRequest("invalid_subscription"));
    }
    // Ayni tarayici baska hesapla girdiyse abonelik ona gecer.
    sqlx::query(
        "insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)
         on conflict (endpoint) do update
           set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth")
        .bind(me.id).bind(&b.endpoint).bind(&b.p256dh).bind(&b.auth).execute(&st.pool).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct Unsubscribe {
    endpoint: String,
}

pub async fn unsubscribe(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Body(b): Body<Unsubscribe>,
) -> Result<StatusCode> {
    sqlx::query("delete from push_subscriptions where user_id = $1 and endpoint = $2")
        .bind(me.id).bind(&b.endpoint).execute(&st.pool).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
pub struct VapidKey {
    /// `applicationServerKey`; null = sunucuda push kapali.
    public_key: Option<String>,
}

pub async fn vapid(State(st): State<AppState>, CurrentUser(_): CurrentUser) -> Json<VapidKey> {
    Json(VapidKey { public_key: st.vapid.as_ref().map(|v| v.public_key().to_string()) })
}

/// Bu sohbete yazilan mesaj icin push: kimlere, `push::decide` karar verir.
/// Arka planda calisir; hata mesaj yazmayi bozmaz. Icerik push'a KONMAZ
/// (kilit ekraninda gorunur, spec/40): yalniz "kim, nerede".
pub async fn fanout(st: AppState, chat: Uuid, author: Uuid, body: String) {
    if st.vapid.is_none() {
        return;
    }
    if let Err(e) = fanout_inner(&st, chat, author, &body).await {
        tracing::warn!("push dagitimi: {e:?}");
    }
}

async fn fanout_inner(st: &AppState, chat: Uuid, author: Uuid, body: &str) -> Result<()> {
    let Some(vapid) = st.vapid.as_ref() else { return Ok(()) };
    let push_channel = Channel::Push(vapid.clone());
    // Sohbetin sahibi ve izleyicileri: kayit ya da takim duvari.
    let rec: Option<(Uuid, String, Vec<Uuid>)> = sqlx::query_as(
        "select r.id, r.title, array(
                  select r.owner_id where r.owner_id is not null
                  union select r.created_by
                  union select user_id from record_participants where record_id = r.id
                  union select owner_id from actions where record_id = r.id and owner_id is not null
                  union select user_id from team_members where team_id = r.team_id)
           from records r where r.chat_id = $1")
        .bind(chat).fetch_optional(&st.pool).await?;
    let (url, title, audience) = match rec {
        Some((id, title, aud)) => (format!("/record/{id}"), title, aud),
        None => {
            let team: Option<(Uuid, String, Vec<Uuid>)> = sqlx::query_as(
                "select t.id, t.name, array(select user_id from team_members where team_id = t.id)
                   from teams t where t.chat_id = $1")
                .bind(chat).fetch_optional(&st.pool).await?;
            let Some((id, name, aud)) = team else { return Ok(()) };
            (format!("/team/{id}"), name, aud)
        }
    };
    let author_name: String = sqlx::query_scalar("select name from users where id = $1")
        .bind(author).fetch_one(&st.pool).await?;
    let hour = Utc::now().hour() as i16;
    for uid in audience.into_iter().filter(|u| *u != author) {
        let prefs = load_prefs(st, uid).await?;
        let name: Option<String> = sqlx::query_scalar("select name from users where id = $1 and is_active")
            .bind(uid).fetch_optional(&st.pool).await?;
        let Some(name) = name else { continue };
        let mentioned = mentions_me(Some(body), &mentions::handle(&name));
        let quiet = prefs.quiet_start.zip(prefs.quiet_end);
        if !push::decide(prefs.level, prefs.chats.get(&chat).copied(), mentioned, quiet, hour).push {
            continue;
        }
        let text = if mentioned { format!("{author_name} seni andı") } else { format!("{author_name} yeni mesaj yazdı") };
        let msg = Message { title: title.clone(), body: text, url: url.clone(), tag: chat.to_string() };
        let subs: Vec<(Uuid, String, String, String)> = sqlx::query_as(
            "select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1")
            .bind(uid).fetch_all(&st.pool).await?;
        for (id, endpoint, p256dh, auth) in subs {
            match push_channel.deliver(&Address::Push { endpoint: &endpoint, p256dh: &p256dh, auth: &auth }, &msg).await {
                Outcome::Sent => {
                    sqlx::query("update push_subscriptions set last_ok_at = now(), fail_count = 0 where id = $1")
                        .bind(id).execute(&st.pool).await?;
                }
                // Olu abonelik: sil, yoksa sunucu olu adreslere gondermeye devam eder.
                Outcome::Gone => {
                    sqlx::query("delete from push_subscriptions where id = $1").bind(id).execute(&st.pool).await?;
                }
                Outcome::Retry | Outcome::Rejected => {
                    sqlx::query("update push_subscriptions set fail_count = fail_count + 1 where id = $1")
                        .bind(id).execute(&st.pool).await?;
                    sqlx::query("delete from push_subscriptions where id = $1 and fail_count >= 5")
                        .bind(id).execute(&st.pool).await?;
                }
            }
        }
    }
    Ok(())
}
