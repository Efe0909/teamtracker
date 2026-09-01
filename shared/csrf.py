"""CSRF korumasi (spec/70-guvenlik.md §4).

SameSite=Lax cerezi cogu vektoru kapatiyor ama tek basina yeterli sayilmaz.
Buradaki kural: her guvensiz metot (POST/PATCH/PUT/DELETE) oturumdaki token'i
geri getirmek zorunda.

Token nereden gelir:
  - HTMX istekleri  -> X-CSRF-Token basligi (<body hx-headers=...> ile otomatik)
  - Duz form gonderimi -> gizli alan (basligi form gonderemez)

Ara katman GOVDEYI yalnizca baslik yoksa okur; okuduysa asagiya oldugu gibi
geri oynatir, yoksa uc bos govde gorurdu.
"""
from __future__ import annotations

import hmac
import secrets
from urllib.parse import parse_qs

from fastapi import Request
from fastapi.responses import JSONResponse, PlainTextResponse

ANAHTAR = "csrf"
BASLIK = "x-csrf-token"
ALAN = "csrf"
GUVENSIZ = {"POST", "PATCH", "PUT", "DELETE"}


def token(request: Request) -> str:
    """Oturuma bagli token; yoksa uretilir. Oturum yenilenince yenilenir."""
    t = request.session.get(ANAHTAR)
    if not t:
        t = secrets.token_urlsafe(32)
        request.session[ANAHTAR] = t
    return t


class CsrfKapisi:
    # Giris akisi muaf: oturum henuz yok, kendi state parametresi var.
    # Tam eslesme (yalniz /static/ onek) — bkz. GirisKapisi'ndaki ayni gerekce.
    ACIK_TAM = frozenset({"/giris", "/giris/callback", "/sw.js", "/favicon.ico",
                          "/manifest.json"})
    ACIK_ONEK = ("/static/",)

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in GUVENSIZ:
            return await self.app(scope, receive, send)
        if scope["path"] in self.ACIK_TAM or scope["path"].startswith(self.ACIK_ONEK):
            return await self.app(scope, receive, send)

        request = Request(scope, receive)
        beklenen = request.session.get(ANAHTAR)
        gelen = request.headers.get(BASLIK) or None   # bos baslik = yok say

        if gelen is None:
            # Baslik yok: duz form olabilir. Govdeyi oku, sonra geri oynat.
            govde = await request.body()
            gelen = _formdan(govde, request.headers.get("content-type", ""))
            receive = _tekrar(govde)

        if not beklenen or not gelen or not hmac.compare_digest(str(beklenen), str(gelen)):
            return await _reddet(request, scope, receive, send)
        await self.app(scope, receive, send)


def _formdan(govde: bytes, ctype: str) -> str | None:
    if "application/x-www-form-urlencoded" not in ctype:
        return None                       # multipart/json: baslik kullanilmali
    try:
        return parse_qs(govde.decode("utf-8"))[ALAN][0]
    except Exception:
        return None


def _tekrar(govde: bytes):
    """Okunan govdeyi asagiya bir kez daha veren receive."""
    verildi = False

    async def receive():
        nonlocal verildi
        if verildi:
            return {"type": "http.disconnect"}
        verildi = True
        return {"type": "http.request", "body": govde, "more_body": False}

    return receive


async def _reddet(request: Request, scope, receive, send):
    from . import kimlik                                   # dairesel import olmasin
    uid = request.session.get("uid")
    # Yalnizca OTURUMLU red yazilir: aksi hâlde kimliksiz istekler denetim
    # tablosuna sinirsiz satir yazdirir (her satir senkron bir veritabani commit'i).
    if uid:
        kimlik.olay(request, "yetki_reddi", actor_id=uid, detay=f"csrf: {scope['path']}")
    kabul = request.headers.get("accept", "")
    yanit = (JSONResponse({"hata": "csrf"}, status_code=403) if "json" in kabul
             else PlainTextResponse("Oturumun tazelenmiş olabilir. Sayfayı yenile.",
                                    status_code=403))
    await yanit(scope, receive, send)
