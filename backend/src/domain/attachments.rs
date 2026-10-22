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

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    domain::{common, records},
    db::{attachments::{self as db, Blob}, scope},
    error::{AppError, Result},
    media::{self, MediaError},
    mentions,
    models::{record::Record, user::User},
    state::AppState,
};

#[derive(Serialize, Clone)]
pub(crate) struct TagOut {
    id: Uuid,
    name: String,
}

/// Ekranin bir eki cizmek icin bildigi her sey. Silinmis ek de doner:
/// mesajda "(gorsel silindi)" mezar tasi cizilsin.
#[derive(Serialize, Clone)]
pub(crate) struct AttachView {
    pub id: Uuid,
    mime: String,
    /// `image` | `document` | `text` (spec/83): gorsel kucuk resimle, digerleri dosya cipiyle.
    kind: String,
    byte_size: i64,
    width: Option<i32>,
    height: Option<i32>,
    original_name: Option<String>,
    pub deleted: bool,
    can_delete: bool,
    can_tag: bool,
    tags: Vec<TagOut>,
}

/// Ek gorunumleri, TEK sorgu + TEK etiket sorgusu (N+1 yok). `can_tag`
/// cagirandan: ayni sohbetteki/kayittaki eklerin hepsinde katilim ayni.
pub(crate) async fn views(p: &PgPool, me: &User, ids: &[Uuid], can_tag: bool) -> Result<HashMap<Uuid, AttachView>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = db::list_attachments(p, ids).await?;
    let mut tags: HashMap<Uuid, Vec<TagOut>> = HashMap::new();
    let tag_rows = db::list_attachment_tags(p, ids).await?;
    for (a, id, name) in tag_rows {
        tags.entry(a).or_default().push(TagOut { id, name });
    }
    Ok(rows.into_iter().map(|r| (r.id, AttachView {
        id: r.id,
        deleted: r.deleted_at.is_some(),
        can_delete: r.deleted_at.is_none() && (me.is_admin || r.uploader_id == Some(me.id)),
        can_tag: can_tag && r.deleted_at.is_none(),
        tags: tags.remove(&r.id).unwrap_or_default(),
        mime: r.mime, kind: r.kind, byte_size: r.byte_size, width: r.width, height: r.height,
        original_name: r.original_name,
    })).collect())
}

/// Etiketleme hakki: `tag_media` + KATILIM (Python `can_tag`). Katilim ekin
/// durdugu yerin kurali: kayit sohbeti/karti -> kaydi duzenleyebilen; takim
/// duvari -> uye. Admin ikisini de atlar.
pub(crate) async fn can_tag(st: &AppState, me: &User, record: Option<&Record>, team: Option<Uuid>) -> Result<bool> {
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
        let m = db::find_member(&st.pool, t, me.id).await?;
        return Ok(m.is_some());
    }
    Ok(false)
}

/// Ekin yeri: hangi kaydin (mesaj ya da kart uzerinden) ya da takimin.
async fn place(st: &AppState, id: Uuid) -> Result<(Option<Record>, Option<Uuid>)> {
    let (record, team) = db::find_place(&st.pool, id).await?.ok_or(AppError::NotFound)?;
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
pub(crate) struct UploadQuery {
    #[serde(default)]
    name: Option<String>,
    /// spec/83 §2; yoksa `chat` (eski istemci degismeden calisir).
    #[serde(default)]
    purpose: Option<String>,
}

pub(crate) async fn upload(st: &AppState, me: &User, q: UploadQuery, bytes: Vec<u8>) -> Result<AttachView> {
    let purpose = match q.purpose.as_deref() {
        None => media::Purpose::Chat,
        Some(p) => media::Purpose::parse(p).ok_or(AppError::BadRequest("invalid_purpose"))?,
    };
    // Govde siniri asilirsa axum reddi duz metin; koda cevrilir.
    let volume = media::active_volume(&st.pool).await?
        .ok_or(AppError::Conflict("storage_offline"))?;
    // Ad gosterim icin ve metin alt turu (uzanti) icin; yol parcasi atilir, uzunluk sinirli.
    let name = q.name.as_deref()
        .and_then(|n| n.rsplit(['/', '\\']).next())
        .map(|n| n.chars().take(200).collect::<String>())
        .filter(|n| !n.trim().is_empty());
    let for_type = name.clone();
    let processed = tokio::task::spawn_blocking(move || media::process(&bytes, for_type.as_deref(), purpose)).await
        .map_err(|_| AppError::BadRequest("corrupt_file"))?
        .map_err(media_err)?;
    let (key, thumb_key) = media::new_keys(processed.format);
    let root = volume.root();
    let path = media::path_in(&root, &key).ok_or(AppError::Conflict("storage_offline"))?;
    let thumb_path = match &thumb_key {
        Some(k) => Some(media::path_in(&root, k).ok_or(AppError::Conflict("storage_offline"))?),
        None => None,
    };
    let checksum = media::checksum(&processed.stored);
    let size = processed.stored.len() as i64;
    let (stored, thumb) = (processed.stored, processed.thumb);
    tokio::task::spawn_blocking(move || {
        media::write_atomic(&path, &stored)?;
        if let (Some(tp), Some(t)) = (thumb_path, thumb) {
            media::write_atomic(&tp, &t).inspect_err(|_| {
                let _ = std::fs::remove_file(&path);
            })?;
        }
        Ok::<(), MediaError>(())
    }).await.map_err(|_| AppError::Conflict("storage_offline"))?.map_err(media_err)?;

    let id = db::insert_attachment(&st.pool, volume.id, me.id, processed.format.mime(), processed.format.kind().key(),
        purpose.key(), size, checksum, processed.width.map(|w| w as i32), processed.height.map(|h| h as i32),
        name, &key, &thumb_key).await?;
    // Yeni ek henuz hicbir yere bagli degil: etiket baglaninca acilir.
    views(&st.pool, me, &[id], false).await?.remove(&id).ok_or(AppError::NotFound)
}

fn media_err(e: MediaError) -> AppError {
    if let MediaError::Io(err) = &e {
        tracing::error!("medya yazilamadi: {err}");
        return AppError::Conflict("storage_offline");
    }
    AppError::BadRequest(e.code())
}

// --- sun -------------------------------------------------------------------

pub(crate) struct ServedAttachment {
    pub(crate) bytes: Vec<u8>,
    pub(crate) content_type: String,
    pub(crate) disposition: String,
    pub(crate) sandbox: bool,
}

/// Silinmemis ekin blob bilgisi; silinmis ya da yok -> 404.
async fn blob(st: &AppState, id: Uuid) -> Result<Blob> {
    db::find_blob(&st.pool, id).await?.ok_or(AppError::NotFound)
}

/// Gizli kayda (sohbet ya da kart) bagli ek yalniz uyeye (spec/75 A5). Bagsiz
/// ve takim duvari ekleri herkese: `place` onlarda kayit bulmaz. Profil
/// fotografi ve takim kapagi gizli sohbetteki bir ek olsa da herkese acik.
pub(crate) async fn serve(st: &AppState, me: &User, id: Uuid, thumb: bool) -> Result<ServedAttachment> {
    let b = blob(st, id).await?;
    if let (Some(rec), _) = place(st, id).await? {
        if records::is_restricted(st, me, &rec).await? {
            let face = db::is_face(&st.pool, id).await?;
            if !face {
                return Err(AppError::Forbidden);
            }
        }
    }
    let kind = media::Kind::parse(&b.kind).unwrap_or(media::Kind::Document);
    let root = std::path::Path::new(&b.mount_path).join(&b.media_prefix);
    let (key, mime) = match (thumb, &b.thumb_key) {
        (true, Some(t)) => (t.as_str(), media::THUMB_MIME),
        // Belgenin kucuk resmi yok: tam dosyaya dusmesin.
        (true, None) => return Err(AppError::NotFound),
        (false, _) => (b.storage_key.as_str(), b.mime.as_str()),
    };
    let path = media::path_in(&root, key).ok_or(AppError::NotFound)?;
    let bytes = tokio::fs::read(path).await.map_err(|_| AppError::NotFound)?;
    // Icerik kimlikle degismez: uzun onbellek. Tur VERITABANINDAN, sniff yok.
    let name = b.original_name.unwrap_or_else(|| "ek".into());
    let (content_type, disposition) = match kind {
        media::Kind::Image => (mime.to_string(), "inline"),
        // Metin asla text/html olarak sunulmaz; belge ve metin indirilir (spec/83 D6).
        media::Kind::Text => ("text/plain; charset=utf-8".to_string(), "attachment"),
        media::Kind::Document => (mime.to_string(), "attachment"),
    };
    Ok(ServedAttachment {
        bytes,
        content_type,
        disposition: content_disposition(disposition, &name),
        sandbox: kind != media::Kind::Image,
    })
}

/// RFC 6266 + 5987: ASCII yedek ad + `filename*` UTF-8. Turkce karakterli ad
/// bazi tarayicida ham yazilinca bozuluyordu.
pub(crate) fn content_disposition(kind: &str, name: &str) -> String {
    let ascii: String = name.chars()
        .map(|c| if (c.is_ascii_graphic() && c != '"' && c != '\\') || c == ' ' { c } else { '_' })
        .collect();
    let mut enc = String::new();
    for b in name.bytes() {
        if b.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&b) {
            enc.push(b as char);
        } else {
            enc.push_str(&format!("%{b:02X}"));
        }
    }
    format!("{kind}; filename=\"{ascii}\"; filename*=UTF-8''{enc}")
}

// --- sil -------------------------------------------------------------------

/// Yumusak silme: satir mezar tasi olarak kalir (mesaj metni durur), dosyalar
/// hemen gider.
pub(crate) async fn delete(st: &AppState, me: &User, id: Uuid) -> Result<()> {
    let b = blob(st, id).await?;
    if !(me.is_admin || b.uploader_id == Some(me.id)) {
        return Err(AppError::Forbidden);
    }
    // Fatura ve kasa belgesi yasal saklama: silinmez (spec/83 D7).
    let locked = db::is_locked(&st.pool, id).await?;
    if locked {
        return Err(AppError::Conflict("attachment_locked"));
    }
    db::mark_deleted(&st.pool, id, me.id).await?;
    let root = std::path::Path::new(&b.mount_path).join(&b.media_prefix);
    media::remove(&root, Some(&b.storage_key));
    media::remove(&root, b.thumb_key.as_deref());
    Ok(())
}

// --- etiketler (R3-F13) -----------------------------------------------------

pub(crate) async fn tags(st: &AppState) -> Result<Vec<TagOut>> {
    Ok(db::list_tags(&st.pool).await?.into_iter().map(|(id, name)| TagOut { id, name }).collect())
}

#[derive(Deserialize)]
pub(crate) struct TagIn {
    name: String,
}

/// Var olan etikete katilmak `tag_media` + katilim ister; YENI etiket adi
/// ayrica `create_tags` — sozlugu genisletmek uygulamaktan farkli ayricalik.
/// Tekillik slug'da: "İstanbul" ile "istanbul" ayni etiket.
pub(crate) async fn add_tag(st: &AppState, me: &User, id: Uuid, b: TagIn) -> Result<AttachView> {
    let view = one(st, me, id).await?;
    if !view.can_tag {
        return Err(AppError::Forbidden);
    }
    let name = common::text(Some(b.name), 60, "invalid_name")?.ok_or(AppError::BadRequest("invalid_name"))?;
    let slug = Some(mentions::handle(&name)).filter(|s| !s.is_empty()).unwrap_or_else(|| "etiket".into());
    let existing = db::find_tag(&st.pool, &slug).await?;
    let tag = match existing {
        Some(t) => t,
        None if me.is_admin || common::has_scope(st, me, "create_tags").await? => {
            db::upsert_tag(&st.pool, &name, &slug, me.id).await?
        }
        None => return Err(AppError::Forbidden),
    };
    db::insert_tag_link(&st.pool, id, tag, me.id).await?;
    one(st, me, id).await
}

pub(crate) async fn remove_tag(st: &AppState, me: &User, id: Uuid, tag: Uuid) -> Result<AttachView> {
    if !one(st, me, id).await?.can_tag {
        return Err(AppError::Forbidden);
    }
    db::delete_tag_link(&st.pool, id, tag).await?;
    one(st, me, id).await
}

/// Mesaj/kart bagi icin: bu ekler BENIM yukledigim, silinmemis, sohbet amacli
/// (spec/83 §4.1: fatura eki sohbete takilmaz) ve henuz hicbir yere
/// BAGLANMAMIS mi. Baskasinin ekini kendi mesajina asamazsin.
pub(crate) async fn claimable(p: &PgPool, me: Uuid, ids: &mut Vec<Uuid>) -> Result<()> {
    claimable_for(p, me, ids, media::Purpose::Chat).await
}

/// `claimable`'in amacli hali: fatura `invoice`, kasa `ledger` amacli eki alir.
/// `p` havuz ya da islem olabilir (fatura gonderimi tek islemde).
pub(crate) async fn claimable_for<'e, E: sqlx::PgExecutor<'e>>(
    p: E, me: Uuid, ids: &mut Vec<Uuid>, purpose: media::Purpose,
) -> Result<()> {
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return Ok(());
    }
    let n = db::count_claimable(p, ids, me, purpose.key()).await?;
    if n as usize == ids.len() { Ok(()) } else { Err(AppError::BadRequest("invalid_attachment")) }
}
