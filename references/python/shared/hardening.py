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

HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
}


class SecurityHeaders:
    """Her yanita ekler; yaniti uretenin unutma ihtimali kalmasin."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                have = {k.lower() for k, _ in message["headers"]}
                message["headers"] = list(message["headers"]) + [
                    (k.lower().encode(), v.encode())
                    for k, v in HEADERS.items() if k.lower().encode() not in have]
            await send(message)

        await self.app(scope, receive, send_wrapper)


# --- giris hiz siniri -----------------------------------------------------

WINDOW = 60          # saniye
LIMIT = 10           # ayni IP'den dakikada en fazla giris denemesi
_history: dict[str, deque] = defaultdict(deque)


def client_ip(request: Request) -> str:
    """Vekil arkasindayken gercek IP.

    nginx `proxy_set_header X-Real-IP $remote_addr` yazar (deploy/). Bu baslik
    yoksa butun istekler 127.0.0.1 gorunur ve tek kova olur — o zaman bir kisi
    butun kulubu kilitler. Bu yuzden vekil yapilandirmasi bu kuralin parcasidir.
    """
    return (request.headers.get("x-real-ip")
            or (request.client.host if request.client else "unknown"))


def limit_exceeded(request: Request) -> bool:
    now = time.monotonic()
    queue = _history[client_ip(request)]
    while queue and now - queue[0] > WINDOW:
        queue.popleft()
    if len(queue) >= LIMIT:
        return True
    queue.append(now)
    return False


def too_many_attempts() -> PlainTextResponse:
    return PlainTextResponse("Çok fazla deneme. Bir dakika sonra tekrar dene.",
                             status_code=429, headers={"Retry-After": str(WINDOW)})
