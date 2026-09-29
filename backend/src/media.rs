//! Gorsel isleme + depolama birimi (R3-F08, F12). HTTP ve kullanici bilmez.
//!
//! Bloblar DOSYA SISTEMINDE (KNOW-230), `attachments` yalniz meta. Hat
//! Python `references/python/shared/media.py` ile ayni sirada; nedenleri orada uzun uzun:
//!
//!  1. Tur SIHIRLI BAYTLARDAN cikarilir — dosya adina ya da istemcinin
//!     content-type'ina guvenilmez.
//!  2. Cozum ASIL icerik dogrulamasidir; piksel tavani sikistirma bombasina.
//!  3. EXIF yonu UYGULANIR, yeniden kodlama metadatayi (GPS dahil) atar.
//!     Sirayi atlamak: yan cekilmis telefon fotografi herkese yan gorunur.
//!  4. JPEG/PNG/WebP `MAX_EDGE`'e kucultulup yeniden kodlanir; GIF cozulup
//!     dogrulandiktan sonra HAM yazilir (animasyon yasasin).
//!  5. Kucuk resim JPEG, `THUMB_EDGE`, ilk kareden; saydamlik beyaza duser.
//!     (Python WebP uretiyordu; `image`'in WebP kodlayicisi yalniz kayipsiz,
//!     kucuk resim icin fazla buyuk.)
//!  6. Gecici dosya + rename: yari yazilmis blob canli anahtarda kalmaz.

use std::{
    io::Cursor,
    path::{Component, Path, PathBuf},
};

use image::{
    codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, ImageDecoder, ImageFormat,
    ImageReader, Limits, RgbImage,
};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

pub const MAX_BYTES: usize = 10 * 1024 * 1024;
const MAX_EDGE: u32 = 2560;
const THUMB_EDGE: u32 = 640;
const MAX_PIXELS: u64 = 50_000_000;
pub const THUMB_MIME: &str = "image/jpeg";

#[derive(Debug)]
pub enum MediaError {
    Empty,
    TooBig,
    BadType,
    Corrupt,
    Io(std::io::Error),
}

impl MediaError {
    /// API hata kodu (spec/15: metin on yuzde).
    pub fn code(&self) -> &'static str {
        match self {
            MediaError::Empty => "empty_file",
            MediaError::TooBig => "file_too_big",
            MediaError::BadType => "bad_file_type",
            MediaError::Corrupt => "corrupt_image",
            MediaError::Io(_) => "storage_offline",
        }
    }
}

impl From<std::io::Error> for MediaError {
    fn from(e: std::io::Error) -> Self {
        MediaError::Io(e)
    }
}

pub fn sniff(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn format_of(mime: &str) -> ImageFormat {
    match mime {
        "image/png" => ImageFormat::Png,
        "image/gif" => ImageFormat::Gif,
        "image/webp" => ImageFormat::WebP,
        _ => ImageFormat::Jpeg,
    }
}

fn ext_of(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "jpg",
    }
}

/// Isleme ciktisi: diske yazilacak iki blob + meta.
pub struct Processed {
    pub mime: &'static str,
    pub stored: Vec<u8>,
    pub thumb: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// CPU isi — cagiran `spawn_blocking` icinde calistirir.
pub fn process(bytes: &[u8]) -> Result<Processed, MediaError> {
    if bytes.is_empty() {
        return Err(MediaError::Empty);
    }
    if bytes.len() > MAX_BYTES {
        return Err(MediaError::TooBig);
    }
    let mime = sniff(bytes).ok_or(MediaError::BadType)?;

    let mut reader = ImageReader::with_format(Cursor::new(bytes), format_of(mime));
    let mut limits = Limits::default();
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|_| MediaError::Corrupt)?;
    let (w, h) = decoder.dimensions();
    if u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err(MediaError::Corrupt);
    }
    let orientation = decoder.orientation().map_err(|_| MediaError::Corrupt)?;
    let mut img = DynamicImage::from_decoder(decoder).map_err(|_| MediaError::Corrupt)?;
    img.apply_orientation(orientation);

    let (stored, img) = if mime == "image/gif" {
        (bytes.to_vec(), img)
    } else {
        let img = if img.width() > MAX_EDGE || img.height() > MAX_EDGE {
            img.resize(MAX_EDGE, MAX_EDGE, FilterType::Triangle)
        } else {
            img
        };
        (encode(&img, mime)?, img)
    };
    Ok(Processed { mime, thumb: thumbnail(&img)?, width: img.width(), height: img.height(), stored })
}

fn encode(img: &DynamicImage, mime: &str) -> Result<Vec<u8>, MediaError> {
    let mut out = Cursor::new(Vec::new());
    let res = if mime == "image/jpeg" {
        DynamicImage::ImageRgb8(img.to_rgb8())
            .write_with_encoder(JpegEncoder::new_with_quality(&mut out, 85))
    } else {
        img.write_to(&mut out, format_of(mime))
    };
    res.map_err(|_| MediaError::Corrupt)?;
    Ok(out.into_inner())
}

/// Saydamlik beyaza karisir: JPEG'de alfa yok, siyah zemin kotu gorunur.
fn thumbnail(img: &DynamicImage) -> Result<Vec<u8>, MediaError> {
    let small = img.thumbnail(THUMB_EDGE, THUMB_EDGE).to_rgba8();
    let flat = RgbImage::from_fn(small.width(), small.height(), |x, y| {
        let p = small.get_pixel(x, y);
        let a = u16::from(p[3]);
        let mix = |c: u8| ((u16::from(c) * a + 255 * (255 - a)) / 255) as u8;
        image::Rgb([mix(p[0]), mix(p[1]), mix(p[2])])
    });
    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(flat)
        .write_with_encoder(JpegEncoder::new_with_quality(&mut out, 80))
        .map_err(|_| MediaError::Corrupt)?;
    Ok(out.into_inner())
}

// --- depolama birimi -------------------------------------------------------

/// Etkin birimin koku. Coklu birim takibi Python'daki gibi (kullanici karari):
/// her ek HANGI birimde oldugunu tasir, birim degisse de eski ekler bulunur.
#[derive(sqlx::FromRow)]
pub struct Volume {
    pub id: Uuid,
    pub mount_path: String,
    pub media_prefix: String,
}

impl Volume {
    pub fn root(&self) -> PathBuf {
        Path::new(&self.mount_path).join(&self.media_prefix)
    }
}

/// Anahtari koke KILITLI yola cevirir. Anahtarlari biz uretiyoruz; yine de
/// `..` ya da mutlak yol iceren anahtar reddedilir (kok disina cikamaz).
pub fn path_in(root: &Path, key: &str) -> Option<PathBuf> {
    let rel = Path::new(key);
    let normal = !key.is_empty() && rel.components().all(|c| matches!(c, Component::Normal(_)));
    normal.then(|| root.join(rel))
}

/// "2026/09/<uuid>.jpg" ve "2026/09/<uuid>-thumb.jpg".
pub fn new_keys(mime: &str) -> (String, String) {
    let id = Uuid::new_v4();
    let dir = chrono::Utc::now().format("%Y/%m");
    (format!("{dir}/{id}.{}", ext_of(mime)), format!("{dir}/{id}-thumb.jpg"))
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), MediaError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;
    Ok(())
}

pub fn checksum(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Dosyayi sil; yoksa sessiz. Anahtar kok disini gosteriyorsa dokunulmaz.
pub fn remove(root: &Path, key: Option<&str>) {
    if let Some(p) = key.and_then(|k| path_in(root, k)) {
        let _ = std::fs::remove_file(p);
    }
}

pub async fn active_volume(pool: &PgPool) -> Result<Option<Volume>, sqlx::Error> {
    sqlx::query_as("select id, mount_path, media_prefix from storage_volumes where is_active")
        .fetch_optional(pool).await
}

/// Acilista: `EKIPTAKIP_MEDIA_ROOT` etkin birim olarak kaydedilir, donanim
/// yoklanir (Python `sync_volume`). ASLA acilisi durdurmaz: disk yoksa metin
/// sohbeti calisir, yalniz ek yuklemesi hata verir.
pub async fn sync_volume(pool: &PgPool, root: &str) {
    let online = std::fs::create_dir_all(root).is_ok()
        && std::fs::metadata(root).is_ok_and(|m| m.is_dir() && !m.permissions().readonly());
    let (device, fs_uuid, fs_type) = if online { probe(Path::new(root)) } else { (None, None, None) };
    let res = sqlx::query(
        "with v as (
           insert into storage_volumes (label, kind, mount_path, device, fs_uuid, fs_type,
                                        is_active, is_online, checked_at)
           values ('default', 'local', $1, $2, $3, $4, true, $5, now())
           on conflict (label) do update set mount_path = $1, device = $2, fs_uuid = $3,
             fs_type = $4, is_active = true, is_online = $5, checked_at = now()
           returning id)
         update storage_volumes set is_active = false
          where is_active and id <> (select id from v)")
        .bind(root).bind(device).bind(fs_uuid).bind(fs_type).bind(online)
        .execute(pool).await;
    match res {
        Ok(_) if online => tracing::info!("medya birimi: {root}"),
        Ok(_) => tracing::warn!("medya birimi cevrimdisi: {root}"),
        Err(e) => tracing::error!("medya birimi kaydedilemedi: {e}"),
    }
}

/// /proc/mounts'tan cihaz + dosya sistemi, /dev/disk/by-uuid'den UUID.
/// Linux disinda (gelistirme Mac'i) hepsi None. Hata firlatmaz.
fn probe(root: &Path) -> (Option<String>, Option<String>, Option<String>) {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        let Ok(dev) = std::fs::metadata(root).map(|m| m.dev()) else { return (None, None, None) };
        let mounts = std::fs::read_to_string("/proc/mounts").unwrap_or_default();
        // Ic ice mount'larda EN UZUN eslesen nokta dogrudur.
        let best = mounts.lines()
            .filter_map(|l| {
                let mut f = l.split_whitespace();
                Some((f.next()?, f.next()?, f.next()?))
            })
            .filter(|(_, mp, _)| std::fs::metadata(mp).is_ok_and(|m| m.dev() == dev))
            .max_by_key(|(_, mp, _)| mp.len());
        let Some((device, _, fs_type)) = best else { return (None, None, None) };
        let real = std::fs::canonicalize(device).ok();
        let fs_uuid = std::fs::read_dir("/dev/disk/by-uuid").ok().and_then(|d| {
            d.flatten().find(|e| std::fs::canonicalize(e.path()).ok() == real)
                .map(|e| e.file_name().to_string_lossy().into_owned())
        });
        (Some(device.to_string()), fs_uuid, Some(fs_type.to_string()))
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = root;
        (None, None, None)
    }
}

// --- supurme (KNOW-278) ----------------------------------------------------

/// Sahipsiz kalanlari temizler, gunde bir. Iki kaynak:
///  - sahibi (kayit/takim) silinmis SOHBETLER: dugum kalici silinince kayit
///    cascade ile gider ama `records.chat_id` sohbeti tutmaz; mesajlari ve
///    ekleri kimsenin gormedigi yerde kalirdi.
///  - hicbir mesaja/karta BAGLANMAMIS ekler: yuklenip gonderilmeyen, ya da
///    karti/mesaji silinen. Satir gider, DOSYA da (cascade diske dokunmaz).
///
/// Bir gunluk pay: yeni yuklenmis ama henuz baglanmamis ek silinmesin.
pub async fn sweep(pool: &PgPool) -> Result<(u64, usize), sqlx::Error> {
    let chats = sqlx::query(
        "delete from chats c
          where c.created_at < now() - interval '1 day'
            and not exists (select 1 from records r where r.chat_id = c.id)
            and not exists (select 1 from teams t where t.chat_id = c.id)")
        .execute(pool).await?.rows_affected();
    let gone: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        "with d as (
           delete from attachments a
            where a.created_at < now() - interval '1 day'
              and not exists (select 1 from card_attachments x where x.attachment_id = a.id)
              and not exists (select 1 from message_attachments x where x.attachment_id = a.id)
           returning volume_id, storage_key, thumb_key)
         select v.mount_path, v.media_prefix, d.storage_key, d.thumb_key
           from d join storage_volumes v on v.id = d.volume_id")
        .fetch_all(pool).await?;
    for (mount, prefix, key, thumb) in &gone {
        let root = Path::new(mount).join(prefix);
        remove(&root, Some(key));
        remove(&root, thumb.as_deref());
    }
    Ok((chats, gone.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tur_baytlardan() {
        assert_eq!(sniff(b"\xff\xd8\xff\xe0rest"), Some("image/jpeg"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff(b"%PDF-1.7 photo.jpg"), None);
    }

    #[test]
    fn anahtar_koke_kilitli() {
        let root = Path::new("/m");
        assert_eq!(path_in(root, "2026/09/a.jpg"), Some(PathBuf::from("/m/2026/09/a.jpg")));
        assert_eq!(path_in(root, "../etc/passwd"), None);
        assert_eq!(path_in(root, "/etc/passwd"), None);
        assert_eq!(path_in(root, ""), None);
    }

    #[test]
    fn yeniden_kodlar_ve_kucultur() {
        // 3000x10 PNG: MAX_EDGE'e iner, kucuk resim JPEG olur.
        let img = DynamicImage::ImageRgba8(image::RgbaImage::new(3000, 10));
        let mut png = Cursor::new(Vec::new());
        assert!(img.write_to(&mut png, ImageFormat::Png).is_ok());
        let p = process(png.get_ref());
        assert!(p.is_ok(), "islenemedi");
        if let Ok(p) = p {
            assert_eq!((p.mime, p.width), ("image/png", MAX_EDGE));
            assert_eq!(sniff(&p.thumb), Some("image/jpeg"));
        }
        assert!(matches!(process(b"not an image"), Err(MediaError::BadType)));
        assert!(matches!(process(b"\x89PNG\r\n\x1a\ngarbage"), Err(MediaError::Corrupt)));
    }
}
