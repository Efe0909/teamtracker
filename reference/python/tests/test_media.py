"""shared/media.py -- veritabani gerektirmeyen saf birim testler.

media.py'nin DB baglantisi yok, o yuzden burada `client`/`db` fixture'lari
KULLANILMIYOR: her test kendi gecici dizinini alir (tmp_path), config.MEDIA_ROOT
oraya yamanir (monkeypatch). Ikili sabit dosya COMMIT EDILMEDI -- her ornek
goruntu Pillow ile testin icinde uretiliyor.
"""
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import config, media  # noqa: E402


@pytest.fixture(autouse=True)
def _media_root(tmp_path, monkeypatch):
    """Her testte config.MEDIA_ROOT gecici bir dizine yamanir.

    Depo agacina HICBIR SEY yazilmaz.
    """
    monkeypatch.setattr(config, "MEDIA_ROOT", str(tmp_path))
    yield


# --- ornek goruntu uretimi (ikili dosya commit edilmiyor) ------------------


def _jpeg_bytes(size=(64, 48), color=(200, 50, 50)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


def _png_bytes(size=(64, 48), color=(10, 200, 10, 128)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _webp_bytes(size=(64, 48), color=(10, 10, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="WEBP")
    return buf.getvalue()


def _gif_bytes(frames: int = 1, size=(40, 30)) -> bytes:
    palette = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)]
    imgs = [Image.new("RGB", size, palette[i % len(palette)]) for i in range(max(frames, 1))]
    buf = io.BytesIO()
    if frames > 1:
        imgs[0].save(buf, format="GIF", save_all=True, append_images=imgs[1:],
                     duration=100, loop=0)
    else:
        imgs[0].save(buf, format="GIF")
    return buf.getvalue()


def _exif_jpeg_bytes(size=(120, 80)) -> bytes:
    """Yatay bir JPEG; Orientation=6 (90 derece) ve bir GPS etiketi tasir."""
    img = Image.new("RGB", size, (200, 50, 50))
    exif = img.getexif()
    exif[0x0112] = 6  # Orientation
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (40.0, 26.0, 0.0)
    gps[3] = "E"
    gps[4] = (29.0, 0.0, 0.0)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def _bomb_png_bytes() -> bytes:
    """2*MAX_PIXELS'in uzerinde piksel bildiren ama diskte kucuk kalan PNG.

    Tek renkli + 1-bit mod: bellekte de cok az yer kaplar, Image.open()
    piksel verisini cozmeden ONCE boyuttan reddedecek.
    """
    width = 12000
    height = (media.MAX_PIXELS * 2) // width + 100
    buf = io.BytesIO()
    Image.new("1", (width, height), 0).save(buf, format="PNG")
    return buf.getvalue()


class _CountingReader:
    """fileobj sarmalayici: read() cagrilarinin boyutunu izler.

    "dosyanin tamami asla tek seferde read() edilmez" kuralini kanitlamak icin.
    """

    def __init__(self, data: bytes):
        self._buf = io.BytesIO(data)
        self.max_chunk = 0
        self.total_read = 0

    def read(self, n: int = -1) -> bytes:
        chunk = self._buf.read(n)
        self.max_chunk = max(self.max_chunk, len(chunk))
        self.total_read += len(chunk)
        return chunk


def _all_files(root: Path) -> list[Path]:
    return [p for p in root.rglob("*") if p.is_file()]


# --- islenen turler ---------------------------------------------------------


@pytest.mark.parametrize("make_bytes, mime, ext", [
    (_jpeg_bytes, "image/jpeg", ".jpg"),
    (_png_bytes, "image/png", ".png"),
    (_webp_bytes, "image/webp", ".webp"),
    (_gif_bytes, "image/gif", ".gif"),
], ids=["jpeg", "png", "webp", "gif"])
def test_allowed_type_round_trips_and_lands_on_disk(tmp_path, make_bytes, mime, ext):
    data = make_bytes()
    result = media.save(io.BytesIO(data), "orijinal" + ext)

    assert result["mime"] == mime
    assert result["storage_key"].endswith(ext)
    assert result["thumb_key"].endswith(".thumb.webp")
    assert result["width"] and result["height"]
    assert result["byte_size"] > 0
    assert result["original_name"] == "orijinal" + ext

    full_path = media.path_of(result["storage_key"])
    thumb_path = media.path_of(result["thumb_key"])
    assert full_path.is_file()
    assert thumb_path.is_file()
    assert str(full_path).startswith(str(tmp_path))

    with Image.open(thumb_path) as th:
        assert th.format == "WEBP"


def test_save_leaves_no_temp_files_behind():
    result = media.save(io.BytesIO(_jpeg_bytes()), "resim.jpg")
    files = _all_files(media.root())
    # tam olarak asil + kucuk resim -- .tmp- artigi yok
    assert len(files) == 2
    assert all(not f.name.startswith(".tmp-") for f in files)
    assert media.path_of(result["storage_key"]) in files
    assert media.path_of(result["thumb_key"]) in files


# --- boyut siniri ------------------------------------------------------------


def test_too_large_rejected_and_writes_nothing(tmp_path):
    data = b"\xff" * (media.MAX_BYTES + 1024)
    with pytest.raises(media.MediaError) as excinfo:
        media.save(io.BytesIO(data), "buyuk.jpg")
    assert excinfo.value.code == "too_large"
    assert _all_files(tmp_path) == []


def test_too_large_never_buffers_whole_file(tmp_path):
    data = b"\xff" * (media.MAX_BYTES * 3)
    reader = _CountingReader(data)
    with pytest.raises(media.MediaError) as excinfo:
        media.save(reader, "buyuk.jpg")
    assert excinfo.value.code == "too_large"
    # tek bir read() cagrisi asla parca boyutunu asmamali
    assert reader.max_chunk <= 64 * 1024
    # akis siniri asar asmaz durmus: dosyanin tamami tuketilmemis
    assert reader.total_read < len(data)
    assert _all_files(tmp_path) == []


# --- tur sniff'i --------------------------------------------------------------


def test_text_file_named_jpg_is_rejected():
    data = ("bu bir metin dosyasidir, resim degil\n" * 50).encode("utf-8")
    with pytest.raises(media.MediaError) as excinfo:
        media.save(io.BytesIO(data), "photo.jpg")
    assert excinfo.value.code == "bad_type"


def test_svg_is_rejected():
    svg = b"<?xml version='1.0' encoding='UTF-8'?><svg xmlns='http://www.w3.org/2000/svg'/>"
    with pytest.raises(media.MediaError) as excinfo:
        media.save(io.BytesIO(svg), "sekil.svg")
    assert excinfo.value.code == "bad_type"


def test_pdf_is_rejected():
    pdf = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< >>\nendobj\n%%EOF"
    with pytest.raises(media.MediaError) as excinfo:
        media.save(io.BytesIO(pdf), "belge.pdf")
    assert excinfo.value.code == "bad_type"


# --- EXIF ---------------------------------------------------------------------


def test_exif_orientation_transposed_and_exif_stripped():
    data = _exif_jpeg_bytes(size=(120, 80))  # yatay + Orientation=6 -> dikey donmeli
    result = media.save(io.BytesIO(data), "telefon.jpg")

    assert result["width"] == 80
    assert result["height"] == 120

    stored = media.path_of(result["storage_key"])
    with Image.open(stored) as img:
        assert img.size == (80, 120)
        assert dict(img.getexif()) == {}
        assert dict(img.getexif().get_ifd(0x8825)) == {}

    raw = stored.read_bytes()
    assert b"Exif" not in raw


# --- GIF animasyonu -------------------------------------------------------


def test_animated_gif_survives():
    data = _gif_bytes(frames=4)
    result = media.save(io.BytesIO(data), "hareket.gif")
    assert result["mime"] == "image/gif"

    stored = media.path_of(result["storage_key"])
    with Image.open(stored) as img:
        assert getattr(img, "n_frames", 1) > 1

    thumb = media.path_of(result["thumb_key"])
    with Image.open(thumb) as th:
        assert th.format == "WEBP"


# --- sikistirma bombasi -----------------------------------------------------


def test_decompression_bomb_rejected():
    data = _bomb_png_bytes()
    assert len(data) < media.MAX_BYTES  # boyut sinirini asmadan sniff'e ulasmali
    with pytest.raises(media.MediaError) as excinfo:
        media.save(io.BytesIO(data), "bomba.png")
    assert excinfo.value.code == "corrupt"


# --- path_of() kok kilidi ------------------------------------------------


def test_path_of_blocks_parent_traversal():
    with pytest.raises(media.MediaError) as excinfo:
        media.path_of("../../etc/passwd")
    assert excinfo.value.code == "corrupt"


def test_path_of_blocks_absolute_key():
    with pytest.raises(media.MediaError) as excinfo:
        media.path_of("/etc/passwd")
    assert excinfo.value.code == "corrupt"


def test_path_of_allows_normal_key(tmp_path):
    result = media.path_of("2026/09/abc.jpg")
    assert result == (tmp_path / "2026" / "09" / "abc.jpg").resolve()


# --- remove() ---------------------------------------------------------------


def test_remove_missing_files_is_silent():
    media.remove("2026/09/eksik.jpg", "2026/09/eksik.thumb.webp")
    media.remove(None, None)
    media.remove(None, "2026/09/sadece-kucuk-yok.thumb.webp")


# --- root() config'i her cagrida okur ---------------------------------------


def test_root_rereads_config_each_call(tmp_path, monkeypatch):
    first = tmp_path / "birinci"
    second = tmp_path / "ikinci"
    first.mkdir()
    second.mkdir()

    monkeypatch.setattr(config, "MEDIA_ROOT", str(first))
    assert media.root() == first

    monkeypatch.setattr(config, "MEDIA_ROOT", str(second))
    assert media.root() == second
