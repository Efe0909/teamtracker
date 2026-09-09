"""Sablon yukleme. Her site kendi dizinini gorur, artı ortak parcalar.

Ortak parca (mesaj balonu) iki sitede de ayni; skin kurali geregi nerede
gosterildigini bilmez, o yuzden paylasilabiliyor.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from . import auth, config, csrf

SHARED_DIR = Path(__file__).parent / "templates"
ROOT = Path(__file__).resolve().parents[1]

# --- statik surum damgasi -------------------------------------------------
#
# nginx /static/ icin uzun onbellek yaziyor (deploy/*.conf). Dosya adlari sabit
# oldugu icin bir CSS/JS duzeltmesi yayina ciksa bile tarayicilar gunlerce eski
# surumu calistirmaya devam ediyordu. Adrese surum damgasi eklenince yeni
# dagitim yeni URL demek olur ve onbellek kendiliginden gecersizlesir.
#
# Damga IMPORT aninda bir kez hesaplanir: dosyalar calisma sirasinda degismez,
# her istekte diski taramanin anlami yok. Konteyner her dagitimda yeniden
# basladigi icin deger de tazelenir.
#
# sw.js ve manifest.json BILEREK disarida: service worker sabit bir adresten
# kaydedilmeli (surum eklenirse her dagitimda ikinci bir SW kaydolur) ve ikisi
# icin nginx zaten no-cache yaziyor.
_STATIC_DIRS = (ROOT / "shared/static",
                ROOT / "sites/dashboard/static",
                ROOT / "sites/mobil/static")


def _static_version() -> str:
    digest = hashlib.sha256()
    for directory in _STATIC_DIRS:
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                info = path.stat()
                digest.update(f"{path.relative_to(ROOT)}:{info.st_mtime_ns}:{info.st_size}".encode())
    return digest.hexdigest()[:8]


STATIC_VERSION = _static_version()


def static_url(path: str) -> str:
    """/static/... adresine surum damgasi ekler."""
    return f"{path}?v={STATIC_VERSION}"


def _csrf_ctx(request):
    """Her sablon token'i gorur; <body hx-headers> ve gizli alanlar bunu kullanir."""
    return {"csrf_token": csrf.token(request) if hasattr(request, "session") else ""}


def site_templates(directory: Path) -> Jinja2Templates:
    t = Jinja2Templates(directory=[directory, SHARED_DIR], context_processors=[_csrf_ctx])
    # Sablon "kimlik sahte mi" bilsin: kullanici degistirme listesi yalnizca
    # gelistirmede gorunur, yayinda yerine cikis dugmesi durur.
    t.env.globals["fake_identity"] = config.fake_identity
    t.env.globals["static"] = static_url
    # Varlik: balonlardaki avatar noktasi bunu okuyor (shared/auth.py).
    t.env.globals["online"] = auth.online
    return t


def render(templates: Jinja2Templates, request, name: str, ctx: dict) -> HTMLResponse:
    return templates.TemplateResponse(request, name, ctx)


def is_htmx(request) -> bool:
    return request.headers.get("HX-Request") == "true"
