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
//!
//! Belge ve metin (spec/83): ayni kural 1, ama YENIDEN KODLANMAZ, kucuk resmi
//! yok. PDF baslik + `%%EOF`; OOXML merkez dizini okunur (zip bombasi, makro,
//! yol gecisi); metin uzantidan secilir ama icerik UTF-8 ve NUL'suz olmali.
//! Eski Office (OLE) ve makrolu paket reddedilir. Sinir AMAC basina
//! (`Purpose`): uc hangi amacla yukluyorsa onun sinirina ve turlerine bakilir.

use std::{
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
};

use image::{
    codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, ImageDecoder, ImageFormat,
    ImageReader, Limits, RgbImage,
};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

/// Amaclarin varsayilan siniri (spec/83 D2).
pub const DEFAULT_MAX_BYTES: usize = 10 * 1024 * 1024;
const AVATAR_MAX_BYTES: usize = 5 * 1024 * 1024;
/// Rota katmaninin govde siniri: en buyuk amacin siniri.
pub const LARGEST_MAX_BYTES: usize = DEFAULT_MAX_BYTES;
const MAX_EDGE: u32 = 2560;
const THUMB_EDGE: u32 = 640;
const MAX_PIXELS: u64 = 50_000_000;
pub const THUMB_MIME: &str = "image/jpeg";
/// OOXML paketinin acilmis toplami ve girdi sayisi tavani (zip bombasi).
const ZIP_MAX_TOTAL: u64 = 100 * 1024 * 1024;
const ZIP_MAX_ENTRIES: usize = 2000;
/// Tek girdide sikistirma orani tavani; kucuk XML'ler cok iyi sikisir, bu
/// yuzden yalniz 1 MB'den buyuk girdide bakilir.
const ZIP_MAX_RATIO: u64 = 100;

#[derive(Debug)]
pub enum MediaError {
    Empty,
    TooBig,
    BadType,
    Corrupt,
    CorruptFile,
    MacroNotAllowed,
    LegacyOffice,
    BadText,
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
            MediaError::CorruptFile => "corrupt_file",
            MediaError::MacroNotAllowed => "macro_not_allowed",
            MediaError::LegacyOffice => "legacy_office_not_allowed",
            MediaError::BadText => "bad_text_encoding",
            MediaError::Io(_) => "storage_offline",
        }
    }
}

/// Ek ailesi (`attachments.kind`): dogrulama ve sunum aileye gore.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Image,
    Document,
    Text,
}

impl Kind {
    pub fn key(self) -> &'static str {
        match self {
            Kind::Image => "image",
            Kind::Document => "document",
            Kind::Text => "text",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        [Kind::Image, Kind::Document, Kind::Text].into_iter().find(|k| k.key() == s)
    }
}

/// Kabul edilen bicimler. MIME `attachments.mime` kontroluyle ayni liste (goc 026).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Jpeg,
    Png,
    Gif,
    Webp,
    Pdf,
    Docx,
    Xlsx,
    Pptx,
    Markdown,
    Plain,
    Csv,
    Python,
}

impl Format {
    pub const ALL: [Format; 12] = [
        Format::Jpeg, Format::Png, Format::Gif, Format::Webp, Format::Pdf, Format::Docx,
        Format::Xlsx, Format::Pptx, Format::Markdown, Format::Plain, Format::Csv, Format::Python,
    ];

    pub fn mime(self) -> &'static str {
        match self {
            Format::Jpeg => "image/jpeg",
            Format::Png => "image/png",
            Format::Gif => "image/gif",
            Format::Webp => "image/webp",
            Format::Pdf => "application/pdf",
            Format::Docx => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Format::Xlsx => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            Format::Pptx => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            Format::Markdown => "text/markdown",
            Format::Plain => "text/plain",
            Format::Csv => "text/csv",
            Format::Python => "text/x-python",
        }
    }

    pub fn ext(self) -> &'static str {
        match self {
            Format::Jpeg => "jpg",
            Format::Png => "png",
            Format::Gif => "gif",
            Format::Webp => "webp",
            Format::Pdf => "pdf",
            Format::Docx => "docx",
            Format::Xlsx => "xlsx",
            Format::Pptx => "pptx",
            Format::Markdown => "md",
            Format::Plain => "txt",
            Format::Csv => "csv",
            Format::Python => "py",
        }
    }

    pub fn kind(self) -> Kind {
        match self {
            Format::Jpeg | Format::Png | Format::Gif | Format::Webp => Kind::Image,
            Format::Pdf | Format::Docx | Format::Xlsx | Format::Pptx => Kind::Document,
            Format::Markdown | Format::Plain | Format::Csv | Format::Python => Kind::Text,
        }
    }

    fn of_mime(mime: &str) -> Option<Self> {
        Format::ALL.into_iter().find(|f| f.mime() == mime)
    }

    /// Metin alt turu yalniz uzantidan (icerik her metin icin ayni denetlenir).
    fn text_of_name(name: &str) -> Option<Self> {
        let ext = name.rsplit_once('.')?.1.to_ascii_lowercase();
        match ext.as_str() {
            "md" | "markdown" => Some(Format::Markdown),
            "txt" => Some(Format::Plain),
            "csv" => Some(Format::Csv),
            "py" => Some(Format::Python),
            _ => None,
        }
    }
}

/// Yuklemenin amaci (`?purpose=`): sinir ve kabul edilen bicimler (spec/83 §2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    Chat,
    Avatar,
    Banner,
    Invoice,
    Ledger,
}

impl Purpose {
    pub const ALL: [Purpose; 5] = [Purpose::Chat, Purpose::Avatar, Purpose::Banner, Purpose::Invoice, Purpose::Ledger];

    pub fn key(self) -> &'static str {
        match self {
            Purpose::Chat => "chat",
            Purpose::Avatar => "avatar",
            Purpose::Banner => "banner",
            Purpose::Invoice => "invoice",
            Purpose::Ledger => "ledger",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Purpose::ALL.into_iter().find(|p| p.key() == s)
    }

    pub fn max_bytes(self) -> usize {
        match self {
            Purpose::Avatar => AVATAR_MAX_BYTES,
            Purpose::Chat | Purpose::Banner | Purpose::Invoice | Purpose::Ledger => DEFAULT_MAX_BYTES,
        }
    }

    pub fn accepts(self, f: Format) -> bool {
        match self {
            Purpose::Chat => true,
            Purpose::Avatar | Purpose::Banner => f.kind() == Kind::Image,
            Purpose::Invoice => matches!(f.kind(), Kind::Image) || matches!(f, Format::Pdf | Format::Xlsx | Format::Csv),
            Purpose::Ledger => matches!(f.kind(), Kind::Image) || f == Format::Pdf,
        }
    }

    /// Dosya secicinin `accept` ozniteligi: MIME + uzanti (`.md`'nin MIME'i
    /// tarayicidan tarayiciya degisir, uzanti sart).
    pub fn accept(self) -> String {
        Format::ALL.into_iter().filter(|f| self.accepts(*f))
            .flat_map(|f| [f.mime().to_string(), format!(".{}", f.ext())])
            .collect::<Vec<_>>().join(",")
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

/// Isleme ciktisi: diske yazilacak blob(lar) + meta. Belge ve metinde kucuk
/// resim ve boyut yok.
pub struct Processed {
    pub format: Format,
    pub stored: Vec<u8>,
    pub thumb: Option<Vec<u8>>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// CPU isi — cagiran `spawn_blocking` icinde calistirir. `name` yalniz metin
/// alt turunu secer (uzanti); tur her zaman icerikten.
pub fn process(bytes: &[u8], name: Option<&str>, purpose: Purpose) -> Result<Processed, MediaError> {
    if bytes.is_empty() {
        return Err(MediaError::Empty);
    }
    if bytes.len() > purpose.max_bytes() {
        return Err(MediaError::TooBig);
    }
    let format = detect(bytes, name)?;
    if !purpose.accepts(format) {
        return Err(MediaError::BadType);
    }
    match format.kind() {
        Kind::Image => image(bytes, format),
        Kind::Text => Ok(raw(format, bytes.strip_prefix(UTF8_BOM).unwrap_or(bytes))),
        Kind::Document => Ok(raw(format, bytes)),
    }
}

const UTF8_BOM: &[u8] = b"\xef\xbb\xbf";
const OLE_MAGIC: &[u8] = &[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

fn raw(format: Format, bytes: &[u8]) -> Processed {
    Processed { format, stored: bytes.to_vec(), thumb: None, width: None, height: None }
}

/// Bicim: once sihirli bayt; hicbiri degilse ve ad metin uzantisi tasiyorsa metin.
pub fn detect(b: &[u8], name: Option<&str>) -> Result<Format, MediaError> {
    if let Some(m) = sniff(b) {
        return Format::of_mime(m).ok_or(MediaError::BadType);
    }
    if b.starts_with(b"%PDF-") {
        return pdf(b);
    }
    if b.starts_with(b"PK\x03\x04") {
        return ooxml(b);
    }
    if b.starts_with(OLE_MAGIC) {
        return Err(MediaError::LegacyOffice);
    }
    let f = name.and_then(Format::text_of_name).ok_or(MediaError::BadType)?;
    let body = b.strip_prefix(UTF8_BOM).unwrap_or(b);
    if body.contains(&0) || std::str::from_utf8(body).is_err() {
        return Err(MediaError::BadText);
    }
    Ok(f)
}

/// PDF: baslik zaten eslesti; sondaki `%%EOF` yarim yuklemeyi yakalar.
fn pdf(b: &[u8]) -> Result<Format, MediaError> {
    let tail = &b[b.len().saturating_sub(1024)..];
    if tail.windows(5).any(|w| w == b"%%EOF") { Ok(Format::Pdf) } else { Err(MediaError::CorruptFile) }
}

/// OOXML: paket ACILMADAN merkez dizini okunur. Siradan ZIP kabul edilmez.
fn ooxml(b: &[u8]) -> Result<Format, MediaError> {
    let mut zip = zip::ZipArchive::new(Cursor::new(b)).map_err(|_| MediaError::CorruptFile)?;
    if zip.len() > ZIP_MAX_ENTRIES {
        return Err(MediaError::CorruptFile);
    }
    let (mut total, mut main, mut types) = (0u64, None, false);
    for i in 0..zip.len() {
        let f = zip.by_index_raw(i).map_err(|_| MediaError::CorruptFile)?;
        let name = f.name();
        if name.starts_with(['/', '\\']) || name.split(['/', '\\']).any(|p| p == "..") {
            return Err(MediaError::CorruptFile);
        }
        if name.rsplit('/').next().is_some_and(|n| n.eq_ignore_ascii_case("vbaProject.bin")) {
            return Err(MediaError::MacroNotAllowed);
        }
        total = total.saturating_add(f.size());
        let bomb = f.size() > 1024 * 1024
            && (f.compressed_size() == 0 || f.size() / f.compressed_size() > ZIP_MAX_RATIO);
        if total > ZIP_MAX_TOTAL || bomb {
            return Err(MediaError::CorruptFile);
        }
        match name {
            "[Content_Types].xml" => types = true,
            "word/document.xml" => main = Some(Format::Docx),
            "xl/workbook.xml" => main = Some(Format::Xlsx),
            "ppt/presentation.xml" => main = Some(Format::Pptx),
            _ => {}
        }
    }
    let format = main.filter(|_| types).ok_or(MediaError::BadType)?;
    let mut ct = String::new();
    zip.by_name("[Content_Types].xml").map_err(|_| MediaError::CorruptFile)?
        .take(1024 * 1024).read_to_string(&mut ct).map_err(|_| MediaError::CorruptFile)?;
    if ct.to_ascii_lowercase().contains("macroenabled") {
        return Err(MediaError::MacroNotAllowed);
    }
    Ok(format)
}

/// Gorsel hatti (spec/83 oncesiyle ayni): coz, EXIF, kucult, yeniden kodla.
fn image(bytes: &[u8], format: Format) -> Result<Processed, MediaError> {
    let mime = format.mime();
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
    Ok(Processed {
        format, thumb: Some(thumbnail(&img)?), width: Some(img.width()), height: Some(img.height()), stored,
    })
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

/// "2026/09/<uuid>.jpg" ve (gorselse) "2026/09/<uuid>-thumb.jpg".
pub fn new_keys(format: Format) -> (String, Option<String>) {
    let id = Uuid::new_v4();
    let dir = chrono::Utc::now().format("%Y/%m");
    let thumb = (format.kind() == Kind::Image).then(|| format!("{dir}/{id}-thumb.jpg"));
    (format!("{dir}/{id}.{}", format.ext()), thumb)
}

/// `a` takma adli ek icin "hicbir sahibe bagli degil" kosulu: supurme ve
/// `claimable` AYNI metni kullanir (spec/83 §4.1). Listede olmayan bag,
/// supurmede ekini kaybeder; test kosulu goclerdeki `references attachments`
/// satirlariyla karsilastirir (`OWNER_TABLES`). Makro: sorgu `concat!` ile
/// statik kalsin.
macro_rules! unowned {
    () => {
        "not exists (select 1 from card_attachments x where x.attachment_id = a.id)
         and not exists (select 1 from message_attachments x where x.attachment_id = a.id)
         and not exists (select 1 from users x where x.avatar_id = a.id)
         and not exists (select 1 from teams x where x.banner_id = a.id)
         and not exists (select 1 from invoice_attachments x where x.attachment_id = a.id)
         and not exists (select 1 from ledger_attachments x where x.attachment_id = a.id)"
    };
}
pub(crate) use unowned;

/// Eki sahiplenen bag tablolari: (tablo, sutun) — `unowned!` ile ayni liste.
#[cfg(test)]
const OWNER_TABLES: &[(&str, &str)] = &[
    ("card_attachments", "attachment_id"),
    ("message_attachments", "attachment_id"),
    ("users", "avatar_id"),
    ("teams", "banner_id"),
    ("invoice_attachments", "attachment_id"),
    ("ledger_attachments", "attachment_id"),
];

/// Eke isaret eden ama SAHIPLENMEYEN tablolar (etiket baglari).
#[cfg(test)]
const NON_OWNER_TABLES: &[&str] = &["attachment_tags"];

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
///  - hicbir mesaja/karta/profile/banner'a BAGLANMAMIS ekler: yuklenip gonderilmeyen, ya da
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
    let gone: Vec<(String, String, String, Option<String>)> = sqlx::query_as(concat!(
        "with d as (
           delete from attachments a
            where a.created_at < now() - interval '1 day' and ", unowned!(), "
           returning volume_id, storage_key, thumb_key)
         select v.mount_path, v.media_prefix, d.storage_key, d.thumb_key
           from d join storage_volumes v on v.id = d.volume_id"))
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
        let p = process(png.get_ref(), None, Purpose::Chat);
        assert!(p.is_ok(), "islenemedi");
        if let Ok(p) = p {
            assert_eq!((p.format, p.width), (Format::Png, Some(MAX_EDGE)));
            assert_eq!(p.thumb.as_deref().and_then(sniff), Some("image/jpeg"));
        }
        assert!(matches!(process(b"not an image", None, Purpose::Chat), Err(MediaError::BadType)));
        assert!(matches!(process(b"\x89PNG\r\n\x1a\ngarbage", None, Purpose::Chat), Err(MediaError::Corrupt)));
    }

    /// Bellekte OOXML paketi: verilen girdiler, hepsi deflate.
    fn package(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut out = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, body) in entries {
            assert!(out.start_file(*name, opt).is_ok());
            assert!(out.write_all(body).is_ok());
        }
        out.finish().map(Cursor::into_inner).unwrap_or_default()
    }

    const TYPES: &[u8] = b"<Types><Override ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>";

    #[test]
    fn belgeler() {
        let pdf = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n";
        assert!(matches!(detect(pdf, None), Ok(Format::Pdf)));
        assert!(matches!(detect(b"%PDF-1.7 yarim", None), Err(MediaError::CorruptFile)));

        let docx = package(&[("[Content_Types].xml", TYPES), ("word/document.xml", b"<w:document/>")]);
        assert!(matches!(detect(&docx, Some("x.docx")), Ok(Format::Docx)));
        let xlsx = package(&[("[Content_Types].xml", b"<Types/>"), ("xl/workbook.xml", b"<workbook/>")]);
        assert!(matches!(detect(&xlsx, None), Ok(Format::Xlsx)));

        let macro_bin = package(&[("[Content_Types].xml", TYPES), ("word/document.xml", b"<d/>"), ("word/vbaProject.bin", b"x")]);
        assert!(matches!(detect(&macro_bin, None), Err(MediaError::MacroNotAllowed)));
        let macro_ct = package(&[
            ("[Content_Types].xml", b"<Types><Override ContentType=\"application/vnd.ms-word.document.macroEnabled.main+xml\"/></Types>"),
            ("word/document.xml", b"<d/>"),
        ]);
        assert!(matches!(detect(&macro_ct, None), Err(MediaError::MacroNotAllowed)));

        let plain_zip = package(&[("notlar.txt", b"merhaba")]);
        assert!(matches!(detect(&plain_zip, Some("a.zip")), Err(MediaError::BadType)));
        let escape = package(&[("[Content_Types].xml", TYPES), ("../word/document.xml", b"<d/>")]);
        assert!(matches!(detect(&escape, None), Err(MediaError::CorruptFile)));
        // Yuksek oranli buyuk girdi: 2 MB sifir birkac KB'a sikisir.
        let bomb = package(&[("[Content_Types].xml", TYPES), ("word/document.xml", &vec![0u8; 2 * 1024 * 1024])]);
        assert!(matches!(detect(&bomb, None), Err(MediaError::CorruptFile)));

        assert!(matches!(detect(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1rest", Some("eski.xls")), Err(MediaError::LegacyOffice)));
    }

    #[test]
    fn metinler() {
        assert!(matches!(detect("# Başlık\nçğış".as_bytes(), Some("not.md")), Ok(Format::Markdown)));
        assert!(matches!(detect(b"\xef\xbb\xbfa;b\n1;2", Some("dokum.CSV")), Ok(Format::Csv)));
        assert!(matches!(detect(b"print(1)", Some("a.py")), Ok(Format::Python)));
        assert!(matches!(detect(b"print(1)", Some("a.sh")), Err(MediaError::BadType)));
        assert!(matches!(detect(b"print(1)", None), Err(MediaError::BadType)));
        assert!(matches!(detect(b"a\0b", Some("a.txt")), Err(MediaError::BadText)));
        assert!(matches!(detect(b"\xff\xfe\x00", Some("a.txt")), Err(MediaError::BadText)));
        // BOM saklanmaz.
        let p = process(b"\xef\xbb\xbfmerhaba", Some("a.txt"), Purpose::Chat);
        assert!(p.is_ok_and(|p| p.stored == b"merhaba" && p.thumb.is_none() && p.width.is_none()));
    }

    #[test]
    fn amac_sinir_ve_tur() {
        let pdf = b"%PDF-1.7\n%%EOF".to_vec();
        assert!(process(&pdf, None, Purpose::Invoice).is_ok());
        assert!(matches!(process(&pdf, None, Purpose::Avatar), Err(MediaError::BadType)));
        assert!(matches!(process(b"a,b", Some("a.csv"), Purpose::Ledger), Err(MediaError::BadType)));
        let big = vec![b'a'; AVATAR_MAX_BYTES + 1];
        assert!(matches!(process(&big, Some("a.txt"), Purpose::Avatar), Err(MediaError::TooBig)));
        assert!(process(&big, Some("a.txt"), Purpose::Chat).is_ok());
        assert!(Purpose::ALL.iter().all(|p| p.max_bytes() <= LARGEST_MAX_BYTES));
        assert!(Purpose::Chat.accept().contains(".md"));
        assert!(!Purpose::Avatar.accept().contains("pdf"));
    }

    /// Goclerde eke isaret eden her tablo ya sahip listesinde ya etiket listesinde;
    /// sahip listesindeki her bag `unowned!` kosulunda. Yeni bag tablosu eklenip
    /// burada unutulursa supurme o tablonun eklerini siler.
    #[test]
    fn sahip_listesi_goclerle_ayni() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
        let mut found = Vec::new();
        let mut files: Vec<_> = std::fs::read_dir(&dir).map(|d| d.flatten().map(|e| e.path()).collect()).unwrap_or_default();
        files.sort();
        assert!(!files.is_empty(), "goc dizini okunamadi");
        for f in files {
            let mut table = String::new();
            for line in std::fs::read_to_string(&f).unwrap_or_default().lines() {
                let l = line.trim().to_ascii_lowercase();
                for p in ["create table if not exists ", "create table ", "alter table "] {
                    if let Some(rest) = l.strip_prefix(p) {
                        table = rest.split([' ', '(']).next().unwrap_or_default().to_string();
                        break;
                    }
                }
                if l.contains("references attachments") && !found.contains(&table) {
                    found.push(table.clone());
                }
            }
        }
        let sql = unowned!();
        for t in &found {
            let owner = OWNER_TABLES.iter().find(|(o, _)| o == t);
            assert!(owner.is_some() || NON_OWNER_TABLES.contains(&t.as_str()), "{t} listede yok");
            if let Some((o, c)) = owner {
                assert!(sql.contains(&format!("from {o} x where x.{c} = a.id")), "{o}.{c} unowned! kosulunda yok");
            }
        }
        assert_eq!(found.len(), OWNER_TABLES.len() + NON_OWNER_TABLES.len());
    }
}
