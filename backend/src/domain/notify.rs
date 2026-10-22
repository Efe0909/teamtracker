//! Bildirimler: uygulama ici liste, iki katmanli tercih, push abonelikleri.
//!
//! Liste hala `chat_feed`'den turetilir (tablo yok). Hangi satirin gorunecegi
//! TEK kapida (`push::decide`) karar verilir: sohbete ozel secim varsa o,
//! yoksa kisinin varsayilani. Okundu bilgisi tek damga
//! (`users.notifications_seen_at`): ondan yenisi "okunmamis".

use std::collections::HashMap;


use chrono::{DateTime, Timelike, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::notify as db,
    error::{AppError, Result},
    mentions,
    models::enums::NotifyLevel,
    push,
    models::user::User,
    state::AppState,
    channel::{Address, Channel, Message, Outcome},
};

/// Beni ilgilendiren sohbetlerdeki son hareketler, benimkiler haric; tercihime
/// gore suzulmus. Son 60 satir.
#[derive(Serialize)]
pub(crate) struct Notice {
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
    unread: bool,
}

#[derive(Serialize)]
pub(crate) struct NoticeList {
    items: Vec<Notice>,
    unread: usize,
}

/// Tercihlerim: varsayilan + sessiz saat + sohbet basina ozel secimler.
#[derive(Serialize)]
pub(crate) struct Prefs {
    level: NotifyLevel,
    quiet_start: Option<i16>,
    quiet_end: Option<i16>,
    chats: HashMap<Uuid, NotifyLevel>,
}

async fn load_prefs(st: &AppState, me: Uuid) -> Result<Prefs> {
    let (level, quiet_start, quiet_end) = db::get_preferences(&st.pool, me).await?;
    let rows = db::list_chat_preferences(&st.pool, me).await?;
    Ok(Prefs { level, quiet_start, quiet_end, chats: rows.into_iter().collect() })
}

/// Mesaj beni aniyor mu: `@adim` ya da grup anmasi (@all, @here, @team).
fn mentions_me(body: Option<&str>, my_handle: &str) -> bool {
    body.is_some_and(|b| mentions::tokens(b).iter()
        .any(|k| k == my_handle || mentions::GROUPS.contains(&k.as_str())))
}

pub(crate) async fn list(st: &AppState, me: &User) -> Result<NoticeList> {
    let prefs = load_prefs(st, me.id).await?;
    let seen = db::get_seen_at(&st.pool, me.id).await?;
    // Suzme Rust'ta: fazladan cekilir (4x), sonra kirpilir.
    let rows = db::list_notices(&st.pool, me.id).await?;
    let handle = mentions::handle(&me.name);
    let items: Vec<Notice> = rows.into_iter().filter(|n| {
        let mentioned = n.kind == "message" && mentions_me(n.body.as_deref(), &handle);
        push::decide(prefs.level, prefs.chats.get(&n.chat_id).copied(), mentioned, None, 0).in_app
    }).take(60).map(|n| Notice {
        unread: n.created_at > seen, kind: n.kind, id: n.id, created_at: n.created_at, chat_id: n.chat_id,
        actor_id: n.actor_id, verb: n.verb, subject_label: n.subject_label, target_label: n.target_label,
        body: n.body, record_id: n.record_id, team_id: n.team_id, title: n.title,
    }).collect();
    let unread = items.iter().filter(|n| n.unread).count();
    Ok(NoticeList { items, unread })
}

pub(crate) async fn seen(st: &AppState, me: &User) -> Result<()> {
    db::mark_seen(&st.pool, me.id).await?;
    Ok(())
}

pub(crate) async fn prefs(st: &AppState, me: &User) -> Result<Prefs> {
    load_prefs(st, me.id).await
}

/// Verilmeyen alan DEGISMEZ; sessiz saat `null` ile kapanir (ikisi birlikte).
#[derive(Deserialize)]
pub(crate) struct PrefsPatch {
    #[serde(default)]
    level: Option<NotifyLevel>,
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    quiet_start: Option<Option<i16>>,
    #[serde(default, deserialize_with = "crate::domain::common::present")]
    quiet_end: Option<Option<i16>>,
}

pub(crate) async fn patch_prefs(st: &AppState, me: &User, p: PrefsPatch) -> Result<Prefs> {
    let old = load_prefs(st, me.id).await?;
    let (start, end) = (p.quiet_start.unwrap_or(old.quiet_start), p.quiet_end.unwrap_or(old.quiet_end));
    let hour_ok = |h: Option<i16>| h.is_none_or(|h| (0..24).contains(&h));
    if start.is_some() != end.is_some() || !hour_ok(start) || !hour_ok(end) {
        return Err(AppError::BadRequest("invalid_quiet_hours"));
    }
    db::update_preferences(&st.pool, me.id, p.level.unwrap_or(old.level), start, end).await?;
    load_prefs(st, me.id).await
}

#[derive(Deserialize)]
pub(crate) struct ChatPref {
    /// null = ozel secimi kaldir, varsayilana don.
    mode: Option<NotifyLevel>,
}

pub(crate) async fn set_chat(st: &AppState, me: &User, chat: Uuid, b: ChatPref) -> Result<Prefs> {
    let exists = db::find_chat(&st.pool, chat).await?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }
    match b.mode {
        Some(mode) => {
            db::upsert_chat_preference(&st.pool, me.id, chat, mode).await?;
        }
        None => {
            db::delete_chat_preference(&st.pool, me.id, chat).await?;
        }
    }
    load_prefs(st, me.id).await
}

// --- push abonelikleri -----------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct Subscription {
    endpoint: String,
    p256dh: String,
    auth: String,
}

pub(crate) async fn subscribe(st: &AppState, me: &User, b: Subscription) -> Result<()> {
    if !b.endpoint.starts_with("https://") || b.endpoint.len() > 2000
        || b.p256dh.is_empty() || b.auth.is_empty() {
        return Err(AppError::BadRequest("invalid_subscription"));
    }
    // Ayni tarayici baska hesapla girdiyse abonelik ona gecer.
    db::upsert_subscription(&st.pool, me.id, &b.endpoint, &b.p256dh, &b.auth).await?;
    Ok(())
}

#[derive(Deserialize)]
pub(crate) struct Unsubscribe {
    endpoint: String,
}

pub(crate) async fn unsubscribe(st: &AppState, me: &User, b: Unsubscribe) -> Result<()> {
    db::delete_user_subscription(&st.pool, me.id, &b.endpoint).await?;
    Ok(())
}

#[derive(Serialize)]
pub(crate) struct VapidKey {
    /// `applicationServerKey`; null = sunucuda push kapali.
    public_key: Option<String>,
}

pub(crate) fn vapid(st: &AppState) -> VapidKey {
    VapidKey { public_key: st.vapid.as_ref().map(|v| v.public_key().to_string()) }
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
    let rec = db::find_record_audience(&st.pool, chat).await?;
    let (url, title, audience) = match rec {
        Some((id, title, aud)) => (format!("/record/{id}"), title, aud),
        None => {
            let team = db::find_team_audience(&st.pool, chat).await?;
            let Some((id, name, aud)) = team else { return Ok(()) };
            (format!("/team/{id}"), name, aud)
        }
    };
    let author_name = db::get_user_name(&st.pool, author).await?;
    let hour = Utc::now().hour() as i16;
    for uid in audience.into_iter().filter(|u| *u != author) {
        let prefs = load_prefs(st, uid).await?;
        let name = db::find_active_user_name(&st.pool, uid).await?;
        let Some(name) = name else { continue };
        let mentioned = mentions_me(Some(body), &mentions::handle(&name));
        let quiet = prefs.quiet_start.zip(prefs.quiet_end);
        if !push::decide(prefs.level, prefs.chats.get(&chat).copied(), mentioned, quiet, hour).push {
            continue;
        }
        let text = if mentioned { format!("{author_name} seni andı") } else { format!("{author_name} yeni mesaj yazdı") };
        let msg = Message { title: title.clone(), body: text, url: url.clone(), tag: chat.to_string() };
        let subs = db::list_subscriptions(&st.pool, uid).await?;
        for db::SubscriptionRow { id, endpoint, p256dh, auth } in subs {
            match push_channel.deliver(&Address::Push { endpoint: &endpoint, p256dh: &p256dh, auth: &auth }, &msg).await {
                Outcome::Sent => {
                    db::mark_subscription_ok(&st.pool, id).await?;
                }
                // Olu abonelik: sil, yoksa sunucu olu adreslere gondermeye devam eder.
                Outcome::Gone => {
                    db::delete_subscription(&st.pool, id).await?;
                }
                Outcome::Retry | Outcome::Rejected => {
                    db::increment_subscription_failures(&st.pool, id).await?;
                    db::delete_failed_subscription(&st.pool, id).await?;
                }
            }
        }
    }
    Ok(())
}
