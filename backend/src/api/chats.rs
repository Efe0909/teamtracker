//! Sohbet: kayit karti ve takim duvari AYNI uclardan (chat_id ile).
//!
//! `chats` kendi basina bir varlik, sahibi ters yonde bagli
//! (`records.chat_id`, `teams.chat_id`). Okuma herkese acik; yazma sahibin
//! kuralina gore: kayitta `can_edit_record`, takimda uyelik (ya da admin).

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    api::{attachments::{self as att, AttachView}, common::{self, Body}, records},
    auth::CurrentUser,
    db::scope,
    error::{AppError, Result},
    mentions,
    models::record::Record,
    state::AppState,
};

const BODY_MAX: usize = 4000;

/// Akisin bir satiri. `kind=activity` ise `verb` + `target_label` + `body`
/// (detay, cogunlukla `{"from","to"}` JSON'u) yapilandirilmis olgudur;
/// cumleyi on yuz kurar.
#[derive(Serialize, sqlx::FromRow)]
pub struct FeedItem {
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

#[derive(Serialize, sqlx::FromRow)]
struct Quote {
    id: Uuid,
    author_id: Option<Uuid>,
    body: String,
}

#[derive(Serialize)]
pub struct Feed {
    items: Vec<FeedItem>,
    /// Yanit alintilari: akistaki `reply_to_id`'lerin hedefleri.
    quotes: Vec<Quote>,
    /// mesaj kimligi -> ekleri (silinenler mezar tasi olarak dahil).
    attachments: HashMap<Uuid, Vec<AttachView>>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct InboxChat {
    chat_id: Uuid,
    title: String,
    kind: String, // "team" | "record"
    last_message: Option<String>,
    last_actor_id: Option<Uuid>,
    is_activity: bool,
    updated_at: Option<DateTime<Utc>>,
    unread: bool,
}

pub async fn inbox(
    State(st): State<AppState>, CurrentUser(me): CurrentUser,
) -> Result<Json<Vec<InboxChat>>> {
    let seen: Option<DateTime<Utc>> = sqlx::query_scalar("select notifications_seen_at from users where id = $1")
        .bind(me.id).fetch_one(&st.pool).await?;

    let rows: Vec<InboxChat> = sqlx::query_as(
        r#"WITH my_chats AS (
          SELECT t.chat_id, t.name as title, 'team' as kind
          FROM teams t
          JOIN team_members m ON m.team_id = t.id
          WHERE m.user_id = $1
          UNION ALL
          SELECT r.chat_id, r.title, 'record' as kind
          FROM records r
          JOIN record_participants p ON p.record_id = r.id
          WHERE p.user_id = $1
        ),
        latest_msgs AS (
          SELECT DISTINCT ON (chat_id) chat_id, body, actor_id, created_at, kind = 'activity' as is_activity
          FROM chat_feed
          WHERE chat_id IN (SELECT chat_id FROM my_chats)
          ORDER BY chat_id, created_at DESC
        )
        SELECT c.chat_id, c.title, c.kind, m.body as last_message, m.actor_id as last_actor_id,
               COALESCE(m.is_activity, false) as is_activity, m.created_at as updated_at,
               COALESCE(m.created_at > $2, false) as unread
        FROM my_chats c
        LEFT JOIN latest_msgs m ON m.chat_id = c.chat_id
        ORDER BY m.created_at DESC NULLS LAST"#
    ).bind(me.id).bind(seen).fetch_all(&st.pool).await?;

    Ok(Json(rows))
}

async fn chat_exists(st: &AppState, chat: Uuid) -> Result<()> {
    let ok: Option<i32> = sqlx::query_scalar("select 1 from chats where id = $1")
        .bind(chat).fetch_optional(&st.pool).await?;
    ok.map(|_| ()).ok_or(AppError::NotFound)
}

pub async fn feed(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Feed>> {
    let chat = common::id(&raw)?;
    chat_exists(&st, chat).await?;
    // Gizli kayitta sohbet yalniz uyelere acik.
    let owner_rec: Option<Uuid> = sqlx::query_scalar("select id from records where chat_id = $1")
        .bind(chat).fetch_optional(&st.pool).await?;
    if let Some(rid) = owner_rec {
        let rec = Record::fetch(&st.pool, rid).await?.ok_or(AppError::NotFound)?;
        if records::is_restricted(&st, &me, &rec).await? {
            return Err(AppError::Forbidden);
        }
    }
    let items: Vec<FeedItem> = sqlx::query_as(
        "select kind, id, created_at, actor_id, verb, subject_label, target_label, body,
                reply_to_id, edited_at
           from chat_feed where chat_id = $1 order by created_at, id")
        .bind(chat).fetch_all(&st.pool).await?;
    let ids: Vec<Uuid> = items.iter().filter_map(|i| i.reply_to_id).collect();
    let quotes = if ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as("select id, author_id, body from messages where id = any($1)")
            .bind(&ids).fetch_all(&st.pool).await?
    };

    // Mesaj ekleri: TEK sorgu. Etiket hakki sohbetin sahibinden, hepsinde ayni.
    let links: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "select ma.message_id, ma.attachment_id from message_attachments ma
           join messages m on m.id = ma.message_id where m.chat_id = $1")
        .bind(chat).fetch_all(&st.pool).await?;
    let mut attachments: HashMap<Uuid, Vec<AttachView>> = HashMap::new();
    if !links.is_empty() {
        let (rec, team) = owner(&st, chat).await?;
        let tag = att::can_tag(&st, &me, rec.as_ref(), team).await?;
        let aids: Vec<Uuid> = links.iter().map(|(_, a)| *a).collect();
        let mut views = att::views(&st.pool, &me, &aids, tag).await?;
        for (m, a) in links {
            if let Some(v) = views.remove(&a) {
                attachments.entry(m).or_default().push(v);
            }
        }
    }
    Ok(Json(Feed { items, quotes, attachments }))
}

/// Sohbetin sahibi: kayit mi, takim mi (ters yonde bagli).
async fn owner(st: &AppState, chat: Uuid) -> Result<(Option<Record>, Option<Uuid>)> {
    let record_id: Option<Uuid> = sqlx::query_scalar("select id from records where chat_id = $1")
        .bind(chat).fetch_optional(&st.pool).await?;
    if let Some(rid) = record_id {
        return Ok((Record::fetch(&st.pool, rid).await?, None));
    }
    let team: Option<Uuid> = sqlx::query_scalar("select id from teams where chat_id = $1")
        .bind(chat).fetch_optional(&st.pool).await?;
    Ok((None, team))
}

/// Mesaj basina en fazla bu kadar gorsel.
const ATTACH_MAX: usize = 4;

#[derive(Deserialize)]
pub struct NewMessage {
    #[serde(default)]
    body: String,
    #[serde(default)]
    reply_to_id: Option<Uuid>,
    /// Once `POST /api/attachments` ile yuklenmis, BENIM, bagsiz ekler.
    #[serde(default)]
    attachment_ids: Vec<Uuid>,
}

#[derive(Serialize)]
pub struct Posted {
    id: Uuid,
}

pub async fn post(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<NewMessage>,
) -> Result<Json<Posted>> {
    let chat = common::id(&raw)?;
    chat_exists(&st, chat).await?;
    // Yalniz gorsel de mesajdir: govde bos olabilir, ikisi birden bos olamaz.
    let body = common::text(Some(b.body), BODY_MAX, "invalid_body")?.unwrap_or_default();
    let mut attach_ids = b.attachment_ids;
    if (body.is_empty() && attach_ids.is_empty()) || attach_ids.len() > ATTACH_MAX {
        return Err(AppError::BadRequest("invalid_body"));
    }

    // Sahip: kayit mi, takim mi?
    let record_id: Option<Uuid> = sqlx::query_scalar("select id from records where chat_id = $1")
        .bind(chat).fetch_optional(&st.pool).await?;
    let allowed = match record_id {
        Some(rid) => {
            let rec: Record = Record::fetch(&st.pool, rid).await?.ok_or(AppError::NotFound)?;
            scope::can_edit_record(&st.pool, &me, &rec, &st.tree).await?
        }
        None => {
            // Takim duvari: uyeler ve admin. Uyelik BURADAN degismez.
            let member: Option<i32> = sqlx::query_scalar(
                "select 1 from teams t join team_members m on m.team_id = t.id
                  where t.chat_id = $1 and m.user_id = $2")
                .bind(chat).bind(me.id).fetch_optional(&st.pool).await?;
            me.is_admin || member.is_some()
        }
    };
    if !allowed {
        return Err(AppError::Forbidden);
    }
    if let Some(r) = b.reply_to_id {
        // FK de reddeder (sohbet disina yanit yok), ama 500 yerine kod dondur.
        let same: Option<i32> = sqlx::query_scalar(
            "select 1 from messages where id = $1 and chat_id = $2")
            .bind(r).bind(chat).fetch_optional(&st.pool).await?;
        if same.is_none() {
            return Err(AppError::BadRequest("invalid_reply"));
        }
    }
    att::claimable(&st.pool, me.id, &mut attach_ids).await?;

    let mut tx = st.pool.begin().await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into messages (chat_id, author_id, body, reply_to_id)
         values ($1, $2, $3, $4) returning id")
        .bind(chat).bind(me.id).bind(&body).bind(b.reply_to_id)
        .fetch_one(&mut *tx).await?;
    if !attach_ids.is_empty() {
        sqlx::query("insert into message_attachments (message_id, attachment_id)
                     select $1, unnest($2::uuid[])")
            .bind(id).bind(&attach_ids).execute(&mut *tx).await?;
    }
    if let Some(rid) = record_id {
        records::touch(&mut tx, rid).await?;
        invite(&mut tx, rid, me.id, &body).await?;
    }
    tx.commit().await?;
    // Push arka planda: mesaj yazma ag gecikmesini beklemez.
    tokio::spawn(crate::api::notify::fanout(st.clone(), chat, me.id, body));
    Ok(Json(Posted { id }))
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
    let users: Vec<(Uuid, String)> = sqlx::query_as("select id, name from users where is_active")
        .fetch_all(&mut **tx).await?;
    let ids: Vec<Uuid> = users.into_iter()
        .filter(|(id, name)| *id != by && keys.contains(&mentions::handle(name)))
        .map(|(id, _)| id).collect();
    if !ids.is_empty() {
        sqlx::query(
            "insert into record_participants (record_id, user_id, added_by)
             select $1, unnest($2::uuid[]), $3 on conflict do nothing")
            .bind(record).bind(ids).bind(by).execute(&mut **tx).await?;
    }
    Ok(())
}
