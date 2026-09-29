"""Medya depolama + goruntu isleme (sozlesme §2-4).

Salt depolama katmani: HTTP'den, istekten, kullanicidan HABERSIZ. Rotalar
(baska bir ajanin alani) burayi cagirir, MediaError'i HTTPException'a cevirir.

Ic hatti (save()):
  1. fileobj 64 KiB parcalar halinde SAYILARAK kopyalanir — MAX_BYTES asilir
     asilmaz durulur, dosyanin tamami ASLA read() edilmez.
  2. Tur SIHIRLI BAYTLARDAN cikarilir — dosya adina ya da istemcinin
     content-type'ina hicbir zaman guvenilmez ("photo.jpg" adli bir PDF
     reddedilir).
  3. Image.MAX_IMAGE_PIXELS sikistirma bombasina karsi tavan koyar.
  4. ImageOps.exif_transpose() EXIF SILINMEDEN ONCE uygulanir — bu sirayi
     atlamak bu ozelligin en riskli hatasi: donusu EXIF'te tasiyan bir telefon
     fotografi, EXIF'i silinip donusu uygulanmazsa HERKESE surekli yan gorunur.
  5. JPEG/PNG/WebP: cozulmus goruntuden, exif= verilmeden yeniden kodlanir ve
     MAX_EDGE'e kucultulur — yeniden kodlama ayni zamanda asil icerik
     dogrulamasidir (goruntu olmayan bir yuk burada coker).
  6. GIF: cozup DOGRULADIKTAN sonra HAM baytlar degismeden yazilir; animasyon
     boylece hayatta kalir. Bilinen odun: GIF yeniden kodlanmiyor, guvenligi
     cozum-dogrulamasina ve sunum anindaki sabit Content-Type + nosniff'e
     yasliyor.
  7. Kucuk resim HER ZAMAN WebP, en uzun kenar THUMB_EDGE, ilk kareden.
  8. width/height depolanan goruntunun (donusu + kucultmeden SONRAKI)
     boyutlaridir.
  9. Gecici dosyaya yazip os.replace ile yerine konur — yari yazilmis bir blob
     canli bir anahtarda ASLA kalmaz.
"""
from __future__ import annotations

import io
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError

from . import config

MAX_BYTES = 10 * 1024 * 1024
THUMB_EDGE = 640          # kucuk resmin en uzun kenari, piksel
MAX_EDGE = 2560           # depolanan asil goruntu bu kenara kucultulur
MAX_PIXELS = 50_000_000   # sikistirma bombasi tavani
THUMB_MIME = "image/webp"

# mime -> uzanti
ALLOWED = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

# Pillow'un sikistirma-bombasi savunmasi: bu tavanin UZERINDE
# Image.open() DecompressionBombError firlatir (islem 3).
Image.MAX_IMAGE_PIXELS = MAX_PIXELS

_CHUNK_SIZE = 64 * 1024
# SpooledTemporaryFile varsayilani (max_size=0) ASLA diske dokmuyor — bellek
# sinirini gercekten uygulamak icin acikca bir esik veriyoruz.
_SPOOL_MAX = 1024 * 1024

# Sihirli baytlar: dosya adina/istemci content-type'ina guvenilmez (islem 2).
_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)

_SAVE_FORMAT = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}


class MediaError(Exception):
    """code makineye, message ekrana (Türkçe)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def root() -> Path:
    """config.MEDIA_ROOT'u HER ÇAĞRIDA okur (testler yamalayabilsin)."""
    return Path(config.MEDIA_ROOT)


def path_of(key: str) -> Path:
    """Göreli anahtarı köke kilitli mutlak yola çevirir.

    Kökün dışına çıkan anahtar -> MediaError("corrupt", ...).
    """
    if not key:
        raise MediaError("corrupt", "Gecersiz depolama anahtari.")

    base = root().resolve()
    candidate = (base / key).resolve()
    try:
        candidate.relative_to(base)
    except ValueError as e:
        raise MediaError("corrupt", "Gecersiz depolama anahtari.") from e
    return candidate


def remove(storage_key: str | None, thumb_key: str | None) -> None:
    """Blobları siler. Dosya yoksa sessizce geçer."""
    for key in (storage_key, thumb_key):
        if not key:
            continue
        try:
            target = path_of(key)
        except MediaError:
            continue
        try:
            target.unlink()
        except FileNotFoundError:
            pass


def save(fileobj, filename: str | None) -> dict:
    """Doğrula, yeniden kodla, diske yaz. Hatada MediaError.

    fileobj: binary read() destekleyen dosya nesnesi (UploadFile.file).
    Döner: {"storage_key", "thumb_key", "mime", "byte_size",
            "width", "height", "original_name"}
    """
    if fileobj is None:
        raise MediaError("no_file", "Dosya secilmedi.")

    spool, size = _spool_upload(fileobj)
    try:
        if size == 0:
            raise MediaError("no_file", "Dosya bos.")

        header = spool.read(32)
        spool.seek(0)
        mime = _sniff(header)
        if mime is None:
            raise MediaError(
                "bad_type",
                "Desteklenmeyen dosya turu. Yalnizca JPEG, PNG, WebP, GIF kabul edilir.",
            )

        try:
            decoded = Image.open(spool)
            decoded.load()
        except Image.DecompressionBombError as e:
            raise MediaError("corrupt", "Goruntu cok buyuk (sikistirma bombasi supheli).") from e
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as e:
            raise MediaError("corrupt", "Goruntu bozuk ya da okunamiyor.") from e

        # 4) Donus ONCE, EXIF SILME sonra. Silinen tag sadece Orientation
        # degil: geri kalan EXIF (GPS dahil) sizmasin diye info'dan da atiyoruz
        # (exif= hicbir zaman verilmeyecek olsa da, bazi Pillow surumleri
        # kaydederken info["exif"]'e geri donebiliyor).
        transposed = ImageOps.exif_transpose(decoded) or decoded
        transposed.info.pop("exif", None)

        if mime == "image/gif":
            # 6) GIF: cozum dogrulamasi yeterli, HAM baytlar degismeden gider.
            spool.seek(0)
            stored_bytes = spool.read()
            thumb_source = transposed
            width, height = transposed.size
        else:
            # 5) Yeniden kodlama + kucultme = asil icerik dogrulamasi.
            downscaled = _downscale(transposed, MAX_EDGE)
            stored_bytes = _encode(downscaled, mime)
            thumb_source = downscaled
            width, height = downscaled.size

        # 7) Kucuk resim her zaman WebP, ilk kareden (thumb_source zaten
        # tek kare/ilk kare cunku GIF coklu-kare seekletilmedi).
        thumb_bytes = _make_thumb(thumb_source)

        storage_key, thumb_key = _new_keys(mime)

        # 9) Gecici dosya + os.replace: yari yazilmis blob canli anahtarda kalmaz.
        _atomic_write(path_of(storage_key), stored_bytes)
        try:
            _atomic_write(path_of(thumb_key), thumb_bytes)
        except BaseException:
            remove(storage_key, None)
            raise

        return {
            "storage_key": storage_key,
            "thumb_key": thumb_key,
            "mime": mime,
            "byte_size": len(stored_bytes),
            "width": width,
            "height": height,
            "original_name": Path(filename).name if filename else None,
        }
    finally:
        spool.close()


# --- ic yardimcilar --------------------------------------------------------


def _spool_upload(fileobj) -> tuple[tempfile.SpooledTemporaryFile, int]:
    """fileobj'u 64 KiB'lik parcalar halinde sayarak kopyalar.

    MAX_BYTES asilir asilmaz durur — dosyanin tamami hicbir zaman tek
    seferde read() edilmez (islem 1).
    """
    spool = tempfile.SpooledTemporaryFile(max_size=_SPOOL_MAX)
    size = 0
    while True:
        chunk = fileobj.read(_CHUNK_SIZE)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_BYTES:
            spool.close()
            raise MediaError(
                "too_large",
                f"Dosya cok buyuk (en fazla {MAX_BYTES // (1024 * 1024)} MB).",
            )
        spool.write(chunk)
    spool.seek(0)
    return spool, size


def _sniff(header: bytes) -> str | None:
    """Yalnizca sihirli baytlardan tur cikarir (islem 2)."""
    for magic, mime in _MAGIC:
        if header.startswith(magic):
            return mime
    if header[0:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "image/webp"
    return None


def _downscale(img: Image.Image, max_edge: int) -> Image.Image:
    width, height = img.size
    longest = max(width, height)
    if longest <= max_edge:
        return img
    scale = max_edge / float(longest)
    new_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return img.resize(new_size, Image.Resampling.LANCZOS)


def _prepare_mode(img: Image.Image, mime: str) -> Image.Image:
    """Hedef formatla uyumsuz modu (orn. paletli "P") donusturur."""
    if mime == "image/jpeg":
        if img.mode not in ("RGB", "L"):
            return img.convert("RGB")
        return img
    if img.mode == "P":
        return img.convert("RGBA") if "transparency" in img.info else img.convert("RGB")
    if img.mode not in ("RGB", "RGBA", "L", "LA"):
        return img.convert("RGBA")
    return img


def _encode(img: Image.Image, mime: str) -> bytes:
    """Yeniden kodlar. exif= HICBIR ZAMAN verilmez (islem 5)."""
    fmt = _SAVE_FORMAT[mime]
    prepared = _prepare_mode(img, mime)
    buf = io.BytesIO()
    kwargs = {"quality": 90} if fmt in ("JPEG", "WEBP") else {}
    prepared.save(buf, format=fmt, **kwargs)
    return buf.getvalue()


def _make_thumb(img: Image.Image) -> bytes:
    """Her zaman WebP, en uzun kenar THUMB_EDGE (islem 7)."""
    thumb = _prepare_mode(img.copy(), "image/webp")
    thumb.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    thumb.save(buf, format="WEBP", quality=80)
    return buf.getvalue()


def _new_keys(mime: str) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    stem = f"{now:%Y}/{now:%m}/{uuid4()}"
    return f"{stem}{ALLOWED[mime]}", f"{stem}.thumb.webp"


def _atomic_write(dest: Path, data: bytes) -> None:
    """Hedef dizinde gecici dosyaya yazip os.replace ile yerine koyar (islem 9)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(dest.parent), prefix=".tmp-", suffix=dest.suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, dest)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
