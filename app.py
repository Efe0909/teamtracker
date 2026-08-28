"""EkipTakip — giriş noktası.

İki site tek süreçte:
    sites/dashboard   masaüstü (tablo, kart, modüller)
    sites/mobil       mobil (ana ekrana eklenebilir)
Ortak çekirdek shared/ altında: veritabanı, yetki, ağaç, iş mantığı, palet.

Çalıştır: .venv/bin/uvicorn app:app --workers 1 --reload
--workers 1 şart: ağaç indeksi süreç belleğinde (spec/10-kararlar.md).
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from shared import auth, config, db, service
from sites.dashboard import routes as dashboard
from sites.mobil import routes as mobil

BASE = Path(__file__).parent


# --- iki alan adi: app.<alan> mobil siteyi KOKTE servis eder ---------------
#
# Ayrimi nginx server_name yapar (deploy/); burada yalnizca yol eslemesi var.
# Yapilandirma shared/config.py'de, modul niteligi olarak okunur.

def _host_of(scope) -> str:
    for k, v in scope.get("headers", ()):
        if k == b"host":
            return v.decode("latin-1").split(":")[0].lower()
    return ""


class MobileHostPrefix:
    """app.<alan> altinda /ara -> ic yolda /m/ara.

    Sablonlar da ayni oneki kullanir (config.mp), boylece adres cubugunda /m
    gorunmez. Masaustu sayfalari bu alan adindan ERISILEMEZ (/gorevler -> 404):
    iki alan adina ayri Access politikasi yazilabilsin diye kasten boyle.
    """

    ORTAK = ("/sw.js", "/favicon.ico", "/manifest.json", "/whoami")

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and config.HOST_APP and _host_of(scope) == config.HOST_APP:
            path = scope["path"]
            ortak = path in self.ORTAK or path.startswith(("/static/", "/switch/"))
            mobil_yol = path == "/m" or path.startswith("/m/")
            if not ortak and not mobil_yol:
                scope["path"] = "/m" + ("" if path == "/" else path.rstrip("/"))
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.connect()
    service.rebuild_tree()
    yield


app = FastAPI(title="EkipTakip", version="0.1.0-alpha", lifespan=lifespan)
app.add_middleware(MobileHostPrefix)

# Statik: ortak kokte, site dosyalari kendi alt yolunda (nginx de boyle ayirir).
app.mount("/static/d", StaticFiles(directory=BASE / "sites/dashboard/static"), name="statik-d")
app.mount("/static/m", StaticFiles(directory=BASE / "sites/mobil/static"), name="statik-m")
app.mount("/static", StaticFiles(directory=BASE / "shared/static"), name="statik")


# --- iki sitenin de kullandigi uclar ---------------------------------------


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(BASE / "shared/static/icon-192.png", media_type="image/png")


@app.get("/whoami")
def whoami(request: Request):
    u = auth.current_user(request)
    return JSONResponse({"id": u["id"], "name": u["name"], "email": u["email"],
                         "is_admin": db.as_bool(u["is_admin"]),
                         "scope": service.TREE.name(u["scope_node_id"]) if u["scope_node_id"] else None})


@app.post("/switch/{user_id}")
def switch_user(request: Request, user_id: str):
    """Faz 1'de kimlik sahte; Faz 2'de burasi OAuth'a baglanir (auth.current_user)."""
    if auth.get_user(user_id) is None:
        raise HTTPException(404, "kullanıcı yok")
    back = urlparse(request.headers.get("referer") or "").path or "/"   # sadece yol: acik yonlendirme yok
    r = RedirectResponse(back, status_code=303)
    # Ters vekil arkasinda uvicorn --proxy-headers ile calisir; scheme https ise
    # cerez Secure isaretlenir. Alt alan adlari kimligi paylassin diye domain.
    r.set_cookie(auth.COOKIE, user_id, httponly=True, samesite="lax",
                 secure=request.url.scheme == "https", domain=config.COOKIE_DOMAIN)
    return r


# Sira onemli: dashboard'un /{slug} iskele rotasi EN SONDA eslesmeli.
app.include_router(mobil.router)
app.include_router(dashboard.router)
