//! Sohbet: kayit karti ve takim duvari AYNI uclardan (chat_id ile).
//!
//! `chats` kendi basina bir varlik, sahibi ters yonde bagli
//! (`records.chat_id`, `teams.chat_id`). Okuma herkese acik; yazma sahibin
//! kuralina gore: kayitta `can_edit_record`, takimda uyelik (ya da admin).

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    api::{common::{self, Body}, records},
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
}

async fn chat_exists(st: &AppState, chat: Uuid) -> Result<()> {
    let ok: Option<i32> = sqlx::query_scalar("select 1 from chats where id = $1")
        .bind(chat).fetch_optional(&st.pool).await?;
    ok.map(|_| ()).ok_or(AppError::NotFound)
}

pub async fn feed(
    State(st): State<AppState>, CurrentUser(_): CurrentUser, Path(raw): Path<String>,
) -> Result<Json<Feed>> {
    let chat = common::id(&raw)?;
    chat_exists(&st, chat).await?;
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
    Ok(Json(Feed { items, quotes }))
}

#[derive(Deserialize)]
pub struct NewMessage {
    body: String,
    #[serde(default)]
    reply_to_id: Option<Uuid>,
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
    let body = common::text(Some(b.body), BODY_MAX, "invalid_body")?
        .ok_or(AppError::BadRequest("invalid_body"))?;

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

    let mut tx = st.pool.begin().await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into messages (chat_id, author_id, body, reply_to_id)
         values ($1, $2, $3, $4) returning id")
        .bind(chat).bind(me.id).bind(&body).bind(b.reply_to_id)
        .fetch_one(&mut *tx).await?;
    if let Some(rid) = record_id {
        records::touch(&mut tx, rid).await?;
        invite(&mut tx, rid, me.id, &body).await?;
    }
    tx.commit().await?;
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
