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

ORTAK = Path(__file__).parent / "templates"
KOK = Path(__file__).resolve().parents[1]

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
_STATIK_DIZINLER = (KOK / "shared/static",
                    KOK / "sites/dashboard/static",
                    KOK / "sites/mobil/static")


def _statik_surum() -> str:
    ozet = hashlib.sha256()
    for dizin in _STATIK_DIZINLER:
        if not dizin.is_dir():
            continue
        for yol in sorted(dizin.rglob("*")):
            if yol.is_file():
                bilgi = yol.stat()
                ozet.update(f"{yol.relative_to(KOK)}:{bilgi.st_mtime_ns}:{bilgi.st_size}".encode())
    return ozet.hexdigest()[:8]


STATIK_SURUM = _statik_surum()


def statik(yol: str) -> str:
    """/static/... adresine surum damgasi ekler."""
    return f"{yol}?v={STATIK_SURUM}"


def _csrf_ctx(request):
    """Her sablon token'i gorur; <body hx-headers> ve gizli alanlar bunu kullanir."""
    return {"csrf_token": csrf.token(request) if hasattr(request, "session") else ""}


def site_templates(dizin: Path) -> Jinja2Templates:
    t = Jinja2Templates(directory=[dizin, ORTAK], context_processors=[_csrf_ctx])
    # Sablon "kimlik sahte mi" bilsin: kullanici degistirme listesi yalnizca
    # gelistirmede gorunur, yayinda yerine cikis dugmesi durur.
    t.env.globals["sahte_kimlik"] = config.sahte_kimlik
    t.env.globals["statik"] = statik
    # Varlik: balonlardaki avatar noktasi bunu okuyor (shared/auth.py).
    t.env.globals["cevrimici"] = auth.cevrimici
    return t


def render(templates: Jinja2Templates, request, name: str, ctx: dict) -> HTMLResponse:
    return templates.TemplateResponse(request, name, ctx)


def is_htmx(request) -> bool:
    return request.headers.get("HX-Request") == "true"
