//! Sohbet: kayit karti ve takim duvari AYNI uclardan (chat_id ile).
//!
//! `chats` kendi basina bir varlik, sahibi ters yonde bagli
//! (`records.chat_id`, `teams.chat_id`). Okuma herkese acik; yazma sahibin
//! kuralina gore: kayitta `can_edit_record`, takimda uyelik (ya da admin).

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    domain::{attachments::{self as att, AttachView}, common, records},
    db::{chats as db, scope},
    error::{AppError, Result},
    mentions,
    models::{record::Record, user::User},
    state::AppState,
};

const BODY_MAX: usize = 4000;

/// Akisin bir satiri. `kind=activity` ise `verb` + `target_label` + `body`
/// (detay, cogunlukla `{"from","to"}` JSON'u) yapilandirilmis olgudur;
/// cumleyi on yuz kurar.
#[derive(Serialize)]
pub(crate) struct FeedItem {
    kind: String,
    id: Uuid,
    created_at: DateTime<Utc>,
    actor_id: Option<Uuid>,
    verb: Option<String>,
    subject_label: Option<String>,
    target_label: Option<String>,
    body: Option<String>,
    reply_to_id: Option<Uuid>,
    edited_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub(crate) struct Quote {
    id: Uuid,
    author_id: Option<Uuid>,
    body: String,
}

#[derive(Serialize)]
pub(crate) struct Feed {
    items: Vec<FeedItem>,
    /// Yanit alintilari: akistaki `reply_to_id`'lerin hedefleri.
    quotes: Vec<Quote>,
    /// mesaj kimligi -> ekleri (silinenler mezar tasi olarak dahil).
    attachments: HashMap<Uuid, Vec<AttachView>>,
}

#[derive(Serialize)]
pub(crate) struct InboxChat {
    chat_id: Uuid,
    title: String,
    kind: String, // "team" | "record"
    record_id: Option<Uuid>,
    team_id: Option<Uuid>,
    can_post: bool,
    last_message: Option<String>,
    last_actor_id: Option<Uuid>,
    updated_at: Option<DateTime<Utc>>,
}

pub(crate) async fn inbox(st: &AppState, me: &User) -> Result<Vec<InboxChat>> {
    // Kisisel gelen kutusu: admin/dal izniyle gorulebilen HER sohbet degil,
    // iliskili olduklarim. Bu iliskilerin hepsi mevcut yazma kuralini saglar.
    // Okunmamis bilgisi yok: notifications_seen_at sohbet okuma zamani degil.
    let rows = db::list_inbox(&st.pool, me.id).await?.into_iter().map(|r| InboxChat {
        chat_id: r.chat_id, title: r.title, kind: r.kind, record_id: r.record_id, team_id: r.team_id,
        can_post: r.can_post, last_message: r.last_message, last_actor_id: r.last_actor_id, updated_at: r.updated_at,
    }).collect();

    Ok(rows)
}

async fn chat_exists(st: &AppState, chat: Uuid) -> Result<()> {
    let ok = db::find_chat(&st.pool, chat).await?;
    ok.map(|_| ()).ok_or(AppError::NotFound)
}

/// Sohbeti okuma kurali: sohbet var ve gizli kaydin sohbeti degil ya da
/// kullanici o kaydi duzenleyebiliyor. Akis ucu ve WebSocket aboneligi AYNI
/// kapidan gecer (`realtime.rs`).
pub(crate) async fn authorize_read(st: &AppState, me: &User, chat: Uuid) -> Result<()> {
    chat_exists(st, chat).await?;
    // Gizli kayitta sohbet yalniz uyelere acik.
    let owner_rec = db::find_record(&st.pool, chat).await?;
    if let Some(rid) = owner_rec {
        let rec = Record::fetch(&st.pool, rid).await?.ok_or(AppError::NotFound)?;
        if records::is_restricted(st, me, &rec).await? {
            return Err(AppError::Forbidden);
        }
    }
    Ok(())
}

pub(crate) async fn feed(st: &AppState, me: &User, chat: Uuid) -> Result<Feed> {
    authorize_read(st, me, chat).await?;
    let items: Vec<FeedItem> = db::list_feed(&st.pool, chat).await?.into_iter().map(|r| FeedItem {
        kind: r.kind, id: r.id, created_at: r.created_at, actor_id: r.actor_id, verb: r.verb,
        subject_label: r.subject_label, target_label: r.target_label, body: r.body,
        reply_to_id: r.reply_to_id, edited_at: r.edited_at,
    }).collect();
    let ids: Vec<Uuid> = items.iter().filter_map(|i| i.reply_to_id).collect();
    let quotes = if ids.is_empty() {
        Vec::new()
    } else {
        db::list_quotes(&st.pool, &ids).await?.into_iter().map(|(id, author_id, body)| Quote { id, author_id, body }).collect()
    };

    // Mesaj ekleri: TEK sorgu. Etiket hakki sohbetin sahibinden, hepsinde ayni.
    let links = db::list_attachments(&st.pool, chat).await?;
    let mut attachments: HashMap<Uuid, Vec<AttachView>> = HashMap::new();
    if !links.is_empty() {
        let (rec, team) = owner(st, chat).await?;
        let tag = att::can_tag(st, me, rec.as_ref(), team).await?;
        let aids: Vec<Uuid> = links.iter().map(|(_, a)| *a).collect();
        let mut views = att::views(&st.pool, me, &aids, tag).await?;
        for (m, a) in links {
            if let Some(v) = views.remove(&a) {
                attachments.entry(m).or_default().push(v);
            }
        }
    }
    Ok(Feed { items, quotes, attachments })
}

/// Sohbetin sahibi: kayit mi, takim mi (ters yonde bagli).
async fn owner(st: &AppState, chat: Uuid) -> Result<(Option<Record>, Option<Uuid>)> {
    let record_id = db::find_record(&st.pool, chat).await?;
    if let Some(rid) = record_id {
        return Ok((Record::fetch(&st.pool, rid).await?, None));
    }
    let team = db::find_team(&st.pool, chat).await?;
    Ok((None, team))
}

/// Mesaj basina en fazla bu kadar gorsel.
const ATTACH_MAX: usize = 4;

#[derive(Deserialize)]
pub(crate) struct NewMessage {
    #[serde(default)]
    body: String,
    #[serde(default)]
    reply_to_id: Option<Uuid>,
    /// Once `POST /api/attachments` ile yuklenmis, BENIM, bagsiz ekler.
    #[serde(default)]
    attachment_ids: Vec<Uuid>,
}

#[derive(Serialize)]
pub(crate) struct Posted {
    id: Uuid,
}

pub(crate) async fn post(st: &AppState, me: &User, chat: Uuid, b: NewMessage) -> Result<Posted> {
    chat_exists(st, chat).await?;
    // Yalniz gorsel de mesajdir: govde bos olabilir, ikisi birden bos olamaz.
    let body = common::text(Some(b.body), BODY_MAX, "invalid_body")?.unwrap_or_default();
    let mut attach_ids = b.attachment_ids;
    if (body.is_empty() && attach_ids.is_empty()) || attach_ids.len() > ATTACH_MAX {
        return Err(AppError::BadRequest("invalid_body"));
    }

    // Sahip: kayit mi, takim mi?
    let record_id = db::find_record(&st.pool, chat).await?;
    let allowed = match record_id {
        Some(rid) => {
            let rec: Record = Record::fetch(&st.pool, rid).await?.ok_or(AppError::NotFound)?;
            scope::can_edit_record(&st.pool, me, &rec, &st.tree).await?
        }
        None => {
            // Takim duvari: uyeler ve admin. Uyelik BURADAN degismez.
            let member = db::find_member(&st.pool, chat, me.id).await?;
            me.is_admin || member.is_some()
        }
    };
    if !allowed {
        return Err(AppError::Forbidden);
    }
    if let Some(r) = b.reply_to_id {
        // FK de reddeder (sohbet disina yanit yok), ama 500 yerine kod dondur.
        let same = db::find_reply(&st.pool, r, chat).await?;
        if same.is_none() {
            return Err(AppError::BadRequest("invalid_reply"));
        }
    }
    att::claimable(&st.pool, me.id, &mut attach_ids).await?;

    let mut tx = st.pool.begin().await?;
    let id = db::insert_message(&mut *tx, chat, me.id, &body, b.reply_to_id).await?;
    if !attach_ids.is_empty() {
        db::insert_attachments(&mut *tx, id, &attach_ids).await?;
    }
    if let Some(rid) = record_id {
        records::touch(&mut tx, rid).await?;
        invite(&mut tx, rid, me.id, &body).await?;
    }
    tx.commit().await?;
    // Push arka planda: mesaj yazma ag gecikmesini beklemez.
    tokio::spawn(crate::domain::notify::fanout(st.clone(), chat, me.id, body));
    Ok(Posted { id })
}

/// Kart sohbetinde `@kisi` DAVETTIR (mentions.rs): anilan aktif kullanici
/// karta katilimci olur, zaten ise dokunulmaz. Yazanin kendisi elenir.
/// Takim duvarinda davet yok: uyelik takim sayfasindan yonetilir.
async fn invite(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, record: Uuid, by: Uuid, body: &str,
) -> Result<()> {
    let keys: Vec<String> = mentions::tokens(body).into_iter()
        .filter(|k| !mentions::GROUPS.contains(&k.as_str())).collect();
    if keys.is_empty() {
        return Ok(());
    }
    // Katlama Rust'ta, SQL'de degil: Turkce I/i katlamasi SQL'de ayni sonucu
    // vermeyebilir. Aktif kullanici sayisi kulup olceginde.
    let users = db::list_active_users(&mut **tx).await?;
    let ids: Vec<Uuid> = users.into_iter()
        .filter(|(id, name)| *id != by && keys.contains(&mentions::handle(name)))
        .map(|(id, _)| id).collect();
    if !ids.is_empty() {
        db::insert_participants(&mut **tx, record, ids, by).await?;
    }
    Ok(())
}
