//! Sohbet kutusunun besleyicisi — `chat_feed` view'i.
//!
//! Mesaj ve sistem bildirimi TEK kronolojik akista (spec/21-sema-v2.md §8).
//! View'de HIC JOIN YOK: iki dal da dogrudan `chat_id` uzerinde.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{models::record::short_time, render::UserChip};

#[derive(Debug, sqlx::FromRow)]
pub struct FeedRow {
    pub kind: String,
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub actor_id: Option<Uuid>,
    pub verb: Option<String>,
    pub subject_label: Option<String>,
    pub target_label: Option<String>,
    pub body: Option<String>,
    pub reply_to_id: Option<Uuid>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Author {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub last_seen_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct ReplyQuote {
    pub id: Uuid,
    pub author_name: String,
    pub color: Option<String>,
    pub body: String,
}

/// Sablonun bekledigi balon bicimi. `type` alan adi Rust'ta ayrilmis kelime,
/// serde ile yeniden adlandiriliyor.
#[derive(Debug, Serialize)]
pub struct Bubble {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub author: Option<Author>,
    pub body: String,
    pub time: String,
    /// "benim mesajim" — balonun hangi tarafa yaslanacagini belirler.
    pub mine: bool,
    pub reply: Option<ReplyQuote>,
    pub media: Vec<u8>,
}

/// Bir sohbetin akisi, kronolojik.
pub async fn of_chat(
    pool: &PgPool, chat_id: Uuid, me: Uuid, people: &[UserChip],
) -> Result<Vec<Bubble>, sqlx::Error> {
    let rows: Vec<FeedRow> = sqlx::query_as(
        "select kind, id, chat_id, created_at, actor_id, verb, subject_label,
                target_label, body, reply_to_id, edited_at
           from chat_feed where chat_id = $1 order by created_at, id")
        .bind(chat_id)
        .fetch_all(pool)
        .await?;

    // Yanit ALINTISI: hedef mesajin govdesi ve yazari. Anma ile KARISTIRMA —
    // anma "kime haber", yanit "hangi mesaja" (KNOW-273).
    let reply_ids: Vec<Uuid> = rows.iter().filter_map(|r| r.reply_to_id).collect();
    let quotes: Vec<(Uuid, Option<Uuid>, String)> = if reply_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as("select id, author_id, body from messages where id = any($1)")
            .bind(&reply_ids).fetch_all(pool).await?
    };

    let find = |id: Option<Uuid>| id.and_then(|i| people.iter().find(|p| p.id == i))
        .map(|p| Author { id: p.id, name: p.name.clone(), color: p.color.clone(),
                          last_seen_at: p.last_seen_at });

    Ok(rows.into_iter().map(|r| {
        let author = find(r.actor_id);
        Bubble {
            reply: r.reply_to_id.and_then(|rid| quotes.iter().find(|(i, _, _)| *i == rid))
                .map(|(id, aid, body)| ReplyQuote {
                    id: *id,
                    author_name: find(*aid).map(|a| a.name).unwrap_or_else(|| "?".into()),
                    color: find(*aid).and_then(|a| a.color),
                    body: body.clone(),
                }),
            mine: r.kind == "message" && r.actor_id == Some(me),
            kind: if r.kind == "message" { "message" } else { "system" },
            // Sistem satirinda govde `detail`; Python'da ayri bir sutun degildi.
            body: r.body.unwrap_or_default(),
            time: short_time(r.created_at),
            author,
            id: r.id,
            media: Vec::new(),
        }
    }).collect())
}
