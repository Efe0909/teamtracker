//! Ekler (R3-F08..F13): yukle, sun, sil, etiketle.
//!
//! Yukleme IKI ADIM: once `POST /api/attachments` (ham govde) — ek sahipsiz
//! dogar; sonra mesaj ya da medya karti onu kimligiyle baglar. Baglanmayan ek
//! bir gun sonra supurulur (`media::sweep`). Multipart gerekmez, istemci
//! ilerleme gosterebilir.
//!
//! Izin (Python `attachments.py` son hali):
//!   gorme    -> oturumu olan herkes (kartlar gibi, KNOW-47); gizli kayda
//!               bagli ek yalniz uyeye (spec/75 A5)
//!   silme    -> yukleyen ya da admin; MESAJ KALIR, gorsel mezar tasi olur
//!   etiket   -> `tag_media` + ekin durdugu sohbete/karta KATILIM;
//!               YENI etiket adi ayrica `create_tags`
//! Sunumda nginx X-Accel YOK (kullanici karari): bayt Rust'tan gecer.

use std::collections::HashMap;

use axum::{
    body::Bytes,
    extract::{rejection::BytesRejection, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    api::{common::{self, Body}, records},
    auth::CurrentUser,
    db::scope,
    error::{AppError, Result},
    media::{self, MediaError},
    mentions,
    models::{record::Record, user::User},
    state::AppState,
};

#[derive(Serialize, Clone)]
pub struct TagOut {
    id: Uuid,
    name: String,
}

/// Ekranin bir eki cizmek icin bildigi her sey. Silinmis ek de doner:
/// mesajda "(gorsel silindi)" mezar tasi cizilsin.
#[derive(Serialize, Clone)]
pub struct AttachView {
    pub id: Uuid,
    mime: String,
    width: Option<i32>,
    height: Option<i32>,
    original_name: Option<String>,
    pub deleted: bool,
    can_delete: bool,
    can_tag: bool,
    tags: Vec<TagOut>,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    mime: String,
    width: Option<i32>,
    height: Option<i32>,
    original_name: Option<String>,
    uploader_id: Option<Uuid>,
    deleted_at: Option<DateTime<Utc>>,
}

/// Ek gorunumleri, TEK sorgu + TEK etiket sorgusu (N+1 yok). `can_tag`
/// cagirandan: ayni sohbetteki/kayittaki eklerin hepsinde katilim ayni.
pub async fn views(p: &PgPool, me: &User, ids: &[Uuid], can_tag: bool) -> Result<HashMap<Uuid, AttachView>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<Row> = sqlx::query_as(
        "select id, mime, width, height, original_name, uploader_id, deleted_at
           from attachments where id = any($1)")
        .bind(ids).fetch_all(p).await?;
    let mut tags: HashMap<Uuid, Vec<TagOut>> = HashMap::new();
    let tag_rows: Vec<(Uuid, Uuid, String)> = sqlx::query_as(
        "select at.attachment_id, t.id, t.name from attachment_tags at
           join tags t on t.id = at.tag_id where at.attachment_id = any($1) order by t.name")
        .bind(ids).fetch_all(p).await?;
    for (a, id, name) in tag_rows {
        tags.entry(a).or_default().push(TagOut { id, name });
    }
    Ok(rows.into_iter().map(|r| (r.id, AttachView {
        id: r.id,
        deleted: r.deleted_at.is_some(),
        can_delete: r.deleted_at.is_none() && (me.is_admin || r.uploader_id == Some(me.id)),
        can_tag: can_tag && r.deleted_at.is_none(),
        tags: tags.remove(&r.id).unwrap_or_default(),
        mime: r.mime, width: r.width, height: r.height, original_name: r.original_name,
    })).collect())
}

/// Etiketleme hakki: `tag_media` + KATILIM (Python `can_tag`). Katilim ekin
/// durdugu yerin kurali: kayit sohbeti/karti -> kaydi duzenleyebilen; takim
/// duvari -> uye. Admin ikisini de atlar.
pub async fn can_tag(st: &AppState, me: &User, record: Option<&Record>, team: Option<Uuid>) -> Result<bool> {
    if me.is_admin {
        return Ok(true);
    }
    if !common::has_scope(st, me, "tag_media").await? {
        return Ok(false);
    }
    if let Some(rec) = record {
        return Ok(scope::can_edit_record(&st.pool, me, rec, &st.tree).await?);
    }
    if let Some(t) = team {
        let m: Option<i32> = sqlx::query_scalar(
            "select 1 from team_members where team_id = $1 and user_id = $2")
            .bind(t).bind(me.id).fetch_optional(&st.pool).await?;
        return Ok(m.is_some());
    }
    Ok(false)
}

/// Ekin yeri: hangi kaydin (mesaj ya da kart uzerinden) ya da takimin.
async fn place(st: &AppState, id: Uuid) -> Result<(Option<Record>, Option<Uuid>)> {
    let (record, team): (Option<Uuid>, Option<Uuid>) = sqlx::query_as(
        "select coalesce(rm.id, c.record_id), t.id
           from attachments a
           left join message_attachments ma on ma.attachment_id = a.id
           left join messages m on m.id = ma.message_id
           left join records rm on rm.chat_id = m.chat_id
           left join teams t on t.chat_id = m.chat_id
           left join card_attachments ca on ca.attachment_id = a.id
           left join cards c on c.id = ca.card_id
          where a.id = $1 limit 1")
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)?;
    let rec = match record {
        Some(r) => Record::fetch(&st.pool, r).await?,
        None => None,
    };
    Ok((rec, team))
}

async fn one(st: &AppState, me: &User, id: Uuid) -> Result<AttachView> {
    let (rec, team) = place(st, id).await?;
    let tag = can_tag(st, me, rec.as_ref(), team).await?;
    views(&st.pool, me, &[id], tag).await?.remove(&id).ok_or(AppError::NotFound)
}

// --- yukle -----------------------------------------------------------------

#[derive(Deserialize)]
pub struct UploadQuery {
    #[serde(default)]
    name: Option<String>,
}

pub async fn upload(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Query(q): Query<UploadQuery>,
    body: std::result::Result<Bytes, BytesRejection>,
) -> Result<Json<AttachView>> {
    // Govde siniri asilirsa axum reddi duz metin; koda cevrilir.
    let bytes = body.map_err(|_| AppError::BadRequest("file_too_big"))?;
    let volume = media::active_volume(&st.pool).await?
        .ok_or(AppError::Conflict("storage_offline"))?;
    let processed = tokio::task::spawn_blocking(move || media::process(&bytes)).await
        .map_err(|_| AppError::BadRequest("corrupt_image"))?
        .map_err(media_err)?;
    let (key, thumb_key) = media::new_keys(processed.mime);
    let root = volume.root();
    let (path, thumb_path) = match (media::path_in(&root, &key), media::path_in(&root, &thumb_key)) {
        (Some(a), Some(b)) => (a, b),
        _ => return Err(AppError::Conflict("storage_offline")),
    };
    let checksum = media::checksum(&processed.stored);
    let size = processed.stored.len() as i64;
    let (stored, thumb) = (processed.stored, processed.thumb);
    tokio::task::spawn_blocking(move || {
        media::write_atomic(&path, &stored)?;
        media::write_atomic(&thumb_path, &thumb).inspect_err(|_| {
            let _ = std::fs::remove_file(&path);
        })
    }).await.map_err(|_| AppError::Conflict("storage_offline"))?.map_err(media_err)?;

    // Ad yalniz gosterim icin; yol parcasi atilir, uzunluk sinirli.
    let name = q.name.as_deref()
        .and_then(|n| n.rsplit(['/', '\\']).next())
        .map(|n| n.chars().take(200).collect::<String>())
        .filter(|n| !n.trim().is_empty());
    let id: Uuid = sqlx::query_scalar(
        "insert into attachments (volume_id, uploader_id, mime, byte_size, checksum, width, height,
                                  original_name, storage_key, thumb_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id")
        .bind(volume.id).bind(me.id).bind(processed.mime).bind(size).bind(checksum)
        .bind(processed.width as i32).bind(processed.height as i32).bind(name)
        .bind(&key).bind(&thumb_key)
        .fetch_one(&st.pool).await?;
    // Yeni ek henuz hicbir yere bagli degil: etiket baglaninca acilir.
    views(&st.pool, &me, &[id], false).await?.remove(&id).map(Json).ok_or(AppError::NotFound)
}

fn media_err(e: MediaError) -> AppError {
    if let MediaError::Io(err) = &e {
        tracing::error!("medya yazilamadi: {err}");
        return AppError::Conflict("storage_offline");
    }
    AppError::BadRequest(e.code())
}

// --- sun -------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct Blob {
    uploader_id: Option<Uuid>,
    mime: String,
    original_name: Option<String>,
    storage_key: String,
    thumb_key: Option<String>,
    mount_path: String,
    media_prefix: String,
}

/// Silinmemis ekin blob bilgisi; silinmis ya da yok -> 404.
async fn blob(st: &AppState, id: Uuid) -> Result<Blob> {
    sqlx::query_as(
        "select a.uploader_id, a.mime, a.original_name, a.storage_key, a.thumb_key,
                v.mount_path, v.media_prefix
           from attachments a join storage_volumes v on v.id = a.volume_id
          where a.id = $1 and a.deleted_at is null")
        .bind(id).fetch_optional(&st.pool).await?.ok_or(AppError::NotFound)
}

/// Gizli kayda (sohbet ya da kart) bagli ek yalniz uyeye (spec/75 A5). Bagsiz
/// ve takim duvari ekleri herkese: `place` onlarda kayit bulmaz. Profil
/// fotografi ve takim kapagi gizli sohbetteki bir ek olsa da herkese acik.
async fn serve(st: &AppState, me: &User, raw: &str, thumb: bool) -> Result<Response> {
    let id = common::id(raw)?;
    let b = blob(st, id).await?;
    if let (Some(rec), _) = place(st, id).await? {
        if records::is_restricted(st, me, &rec).await? {
            let face: bool = sqlx::query_scalar(
                "select exists(select 1 from users where avatar_id = $1)
                     or exists(select 1 from teams where banner_id = $1)")
                .bind(id).fetch_one(&st.pool).await?;
            if !face {
                return Err(AppError::Forbidden);
            }
        }
    }
    let root = std::path::Path::new(&b.mount_path).join(&b.media_prefix);
    let (key, mime) = match (thumb, &b.thumb_key) {
        (true, Some(t)) => (t.as_str(), media::THUMB_MIME),
        _ => (b.storage_key.as_str(), b.mime.as_str()),
    };
    let path = media::path_in(&root, key).ok_or(AppError::NotFound)?;
    let bytes = tokio::fs::read(path).await.map_err(|_| AppError::NotFound)?;
    // Icerik kimlikle degismez: uzun onbellek. Tur VERITABANINDAN, sniff yok.
    let name = b.original_name.unwrap_or_else(|| "gorsel".into()).replace(['"', '\r', '\n'], "");
    Ok((
        [
            (header::CONTENT_TYPE, mime.to_string()),
            (header::CACHE_CONTROL, "private, max-age=31536000, immutable".into()),
            (header::CONTENT_DISPOSITION, format!("inline; filename=\"{name}\"")),
        ],
        bytes,
    ).into_response())
}

pub async fn get(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Response> {
    serve(&st, &me, &raw, false).await
}

pub async fn thumb(State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>) -> Result<Response> {
    serve(&st, &me, &raw, true).await
}

// --- sil -------------------------------------------------------------------

/// Yumusak silme: satir mezar tasi olarak kalir (mesaj metni durur), dosyalar
/// hemen gider.
pub async fn delete(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
) -> Result<StatusCode> {
    let id = common::id(&raw)?;
    let b = blob(&st, id).await?;
    if !(me.is_admin || b.uploader_id == Some(me.id)) {
        return Err(AppError::Forbidden);
    }
    sqlx::query("update attachments set deleted_at = now(), deleted_by = $2 where id = $1")
        .bind(id).bind(me.id).execute(&st.pool).await?;
    let root = std::path::Path::new(&b.mount_path).join(&b.media_prefix);
    media::remove(&root, Some(&b.storage_key));
    media::remove(&root, b.thumb_key.as_deref());
    Ok(StatusCode::NO_CONTENT)
}

// --- etiketler (R3-F13) -----------------------------------------------------

pub async fn tags(State(st): State<AppState>, CurrentUser(_): CurrentUser) -> Result<Json<Vec<TagOut>>> {
    Ok(Json(sqlx::query_as::<_, (Uuid, String)>("select id, name from tags order by name")
        .fetch_all(&st.pool).await?.into_iter().map(|(id, name)| TagOut { id, name }).collect()))
}

#[derive(Deserialize)]
pub struct TagIn {
    name: String,
}

/// Var olan etikete katilmak `tag_media` + katilim ister; YENI etiket adi
/// ayrica `create_tags` — sozlugu genisletmek uygulamaktan farkli ayricalik.
/// Tekillik slug'da: "İstanbul" ile "istanbul" ayni etiket.
pub async fn add_tag(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path(raw): Path<String>,
    Body(b): Body<TagIn>,
) -> Result<Json<AttachView>> {
    let id = common::id(&raw)?;
    let view = one(&st, &me, id).await?;
    if !view.can_tag {
        return Err(AppError::Forbidden);
    }
    let name = common::text(Some(b.name), 60, "invalid_name")?.ok_or(AppError::BadRequest("invalid_name"))?;
    let slug = Some(mentions::handle(&name)).filter(|s| !s.is_empty()).unwrap_or_else(|| "etiket".into());
    let existing: Option<Uuid> = sqlx::query_scalar("select id from tags where slug = $1")
        .bind(&slug).fetch_optional(&st.pool).await?;
    let tag = match existing {
        Some(t) => t,
        None if me.is_admin || common::has_scope(&st, &me, "create_tags").await? => {
            sqlx::query_scalar(
                "insert into tags (name, slug, created_by) values ($1, $2, $3)
                 on conflict (slug) do update set slug = excluded.slug returning id")
                .bind(&name).bind(&slug).bind(me.id).fetch_one(&st.pool).await?
        }
        None => return Err(AppError::Forbidden),
    };
    sqlx::query(
        "insert into attachment_tags (attachment_id, tag_id, added_by) values ($1, $2, $3)
         on conflict do nothing")
        .bind(id).bind(tag).bind(me.id).execute(&st.pool).await?;
    Ok(Json(one(&st, &me, id).await?))
}

pub async fn remove_tag(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, Path((raw, tag)): Path<(String, String)>,
) -> Result<Json<AttachView>> {
    let id = common::id(&raw)?;
    let tag = common::id(&tag)?;
    if !one(&st, &me, id).await?.can_tag {
        return Err(AppError::Forbidden);
    }
    sqlx::query("delete from attachment_tags where attachment_id = $1 and tag_id = $2")
        .bind(id).bind(tag).execute(&st.pool).await?;
    Ok(Json(one(&st, &me, id).await?))
}

/// Mesaj/kart bagi icin: bu ekler BENIM yukledigim, silinmemis ve henuz
/// hicbir yere BAGLANMAMIS mi. Baskasinin ekini kendi mesajina asamazsin.
pub async fn claimable(p: &PgPool, me: Uuid, ids: &mut Vec<Uuid>) -> Result<()> {
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return Ok(());
    }
    let n: i64 = sqlx::query_scalar(
        "select count(*) from attachments a
          where a.id = any($1) and a.uploader_id = $2 and a.deleted_at is null
            and not exists (select 1 from message_attachments x where x.attachment_id = a.id)
            and not exists (select 1 from card_attachments x where x.attachment_id = a.id)")
        .bind(&*ids).bind(me).fetch_one(p).await?;
    if n as usize == ids.len() { Ok(()) } else { Err(AppError::BadRequest("invalid_attachment")) }
}
