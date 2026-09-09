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

KEY = "csrf"
HEADER = "x-csrf-token"
FIELD = "csrf"
UNSAFE_METHODS = {"POST", "PATCH", "PUT", "DELETE"}


def token(request: Request) -> str:
    """Oturuma bagli token; yoksa uretilir. Oturum yenilenince yenilenir."""
    t = request.session.get(KEY)
    if not t:
        t = secrets.token_urlsafe(32)
        request.session[KEY] = t
    return t


class CsrfGate:
    # Giris akisi muaf: oturum henuz yok, kendi state parametresi var.
    # Tam eslesme (yalniz /static/ onek) — bkz. LoginGate'deki ayni gerekce.
    # /test/notification: kimlik CEREZDEN gelmiyor (uc zaten yalnizca
    # EKIPTAKIP_PUSH_TEST=1 iken var). CSRF ambient cerezle yapilan istegi
    # korur; burada cerez kullanilmadigi icin korunacak sey yok.
    EXEMPT_EXACT = frozenset({"/login", "/login/callback", "/sw.js", "/favicon.ico",
                             "/manifest.json", "/test/notification"})
    EXEMPT_PREFIX = ("/static/",)

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in UNSAFE_METHODS:
            return await self.app(scope, receive, send)
        if scope["path"] in self.EXEMPT_EXACT or scope["path"].startswith(self.EXEMPT_PREFIX):
            return await self.app(scope, receive, send)

        request = Request(scope, receive)
        expected = request.session.get(KEY)
        given = request.headers.get(HEADER) or None   # bos baslik = yok say

        if given is None:
            # Baslik yok: duz form olabilir. Govdeyi oku, sonra geri oynat.
            body = await request.body()
            given = _from_form(body, request.headers.get("content-type", ""))
            receive = _replay(body)

        if not expected or not given or not hmac.compare_digest(str(expected), str(given)):
            return await _reject(request, scope, receive, send)
        await self.app(scope, receive, send)


def _from_form(body: bytes, ctype: str) -> str | None:
    if "application/x-www-form-urlencoded" not in ctype:
        return None                       # multipart/json: baslik kullanilmali
    try:
        return parse_qs(body.decode("utf-8"))[FIELD][0]
    except Exception:
        return None


def _replay(body: bytes):
    """Okunan govdeyi asagiya bir kez daha veren receive."""
    given = False

    async def receive():
        nonlocal given
        if given:
            return {"type": "http.disconnect"}
        given = True
        return {"type": "http.request", "body": body, "more_body": False}

    return receive


async def _reject(request: Request, scope, receive, send):
    from . import identity                                   # dairesel import olmasin
    uid = request.session.get("uid")
    # Yalnizca OTURUMLU red yazilir: aksi hâlde kimliksiz istekler denetim
    # tablosuna sinirsiz satir yazdirir (her satir senkron bir veritabani commit'i).
    if uid:
        identity.log_event(request, "permission_denied", actor_id=uid, detail=f"csrf: {scope['path']}")
    accept = request.headers.get("accept", "")
    response = (JSONResponse({"hata": "csrf"}, status_code=403) if "json" in accept
             else PlainTextResponse("Oturumun tazelenmiş olabilir. Sayfayı yenile.",
                                    status_code=403))
    await response(scope, receive, send)
