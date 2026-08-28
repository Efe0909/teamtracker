"""Guvenlik basliklari, giris hiz siniri, 403 denetim izi (spec/70 §5, §6, §8).

Basliklar UYGULAMADA uretilir, yalniz nginx'te degil: tunelsiz/vekilsiz
calistirildiginda da gecerli olsunlar (spec/70 §9 — onundeki katmana guvenme).
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import PlainTextResponse

# script-src 'self': satir ici <script> yok, hx-on= yok (htmx onlari new Function
# ile derler). style-src'de 'unsafe-inline' KALIYOR: sablonlarda
# style="background:{{ user.color }}" var; kaldirmak icin renkleri veri
# ozniteligine tasimak gerekir, o ayri is.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data:; connect-src 'self'; font-src 'self'; "
       "form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'")

BASLIKLAR = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
}


class GuvenlikBasliklari:
    """Her yanita ekler; yaniti uretenin unutma ihtimali kalmasin."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def gonder(mesaj):
            if mesaj["type"] == "http.response.start":
                var = {k.lower() for k, _ in mesaj["headers"]}
                mesaj["headers"] = list(mesaj["headers"]) + [
                    (k.lower().encode(), v.encode())
                    for k, v in BASLIKLAR.items() if k.lower().encode() not in var]
            await send(mesaj)

        await self.app(scope, receive, gonder)


# --- giris hiz siniri -----------------------------------------------------

PENCERE = 60          # saniye
SINIR = 10            # ayni IP'den dakikada en fazla giris denemesi
_gecmis: dict[str, deque] = defaultdict(deque)


def istemci_ip(request: Request) -> str:
    """Vekil arkasindayken gercek IP.

    nginx `proxy_set_header X-Real-IP $remote_addr` yazar (deploy/). Bu baslik
    yoksa butun istekler 127.0.0.1 gorunur ve tek kova olur — o zaman bir kisi
    butun kulubu kilitler. Bu yuzden vekil yapilandirmasi bu kuralin parcasidir.
    """
    return (request.headers.get("x-real-ip")
            or (request.client.host if request.client else "bilinmeyen"))


def sinir_asildi(request: Request) -> bool:
    simdi = time.monotonic()
    kuyruk = _gecmis[istemci_ip(request)]
    while kuyruk and simdi - kuyruk[0] > PENCERE:
        kuyruk.popleft()
    if len(kuyruk) >= SINIR:
        return True
    kuyruk.append(simdi)
    return False


def cok_deneme() -> PlainTextResponse:
    return PlainTextResponse("Çok fazla deneme. Bir dakika sonra tekrar dene.",
                             status_code=429, headers={"Retry-After": str(PENCERE)})
