"""EkipTakip — giriş noktası.

İki site tek süreçte:
    sites/dashboard   masaüstü (tablo, kart, modüller)
    sites/mobil       mobil (ana ekrana eklenebilir)
Ortak çekirdek shared/ altında: veritabanı, yetki, ağaç, iş mantığı, palet.

Çalıştır: .venv/bin/uvicorn app:app --workers 1 --reload
--workers 1 şart: ağaç indeksi süreç belleğinde (spec/10-kararlar.md).
"""
from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from shared import auth, config, csrf, db, kimlik, service
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
    gorunmez. Masaustu sayfalari bu alan adindan gorunmez (/gorevler -> 404).

    DIKKAT: bu bir ARAYUZ ayrimidir, yetki siniri DEGIL. Ayrim istemcinin
    gonderdigi Host basligina bakar; surece dogrudan erisen biri baska bir Host
    yazarak diger yuzu alir. Gercek sinir kimlik + yetki kontrolleridir
    (spec/70-guvenlik.md §9: uygulama onundeki katmana guvenerek atlamaz).
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and config.HOST_APP and _host_of(scope) == config.HOST_APP:
            path = scope["path"]
            # Ortak yollar onege girmez — /giris burada olmazsa mobil alan adinda
            # giris /m/giris'e cevrilir ve 404 doner (yani hic girilemez).
            ortak = path.startswith(config.SHARED_PATHS)
            mobil_yol = path == "/m" or path.startswith("/m/")
            if not ortak and not mobil_yol:
                scope["path"] = "/m" + ("" if path == "/" else path.rstrip("/"))
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Yanlis yapilandirma calisma aninda degil ACILISTA yakalanir (spec/70 §7).
    for uyari in config.dogrula():
        print(f"[ekiptakip] UYARI: {uyari}", file=sys.stderr)
    db.connect()
    for ad in db.gocler():           # kurulu veritabani yeni sutunlari alsin
        print(f"[ekiptakip] goc: {ad}", file=sys.stderr)
    service.rebuild_tree()
    yield


class GirisKapisi:
    """Oturumu olmayan istek iceri girmez (spec/70-guvenlik.md §2).

    HTML gezinmesi giris sayfasina yonlenir; HTMX istegi HX-Redirect ile tam
    sayfa yonlendirmesi yapar (yoksa giris sayfasi bir parcanin icine duserdi);
    digerleri 401 alir.
    """

    # Oturum gerektirmeyenler: giris akisi, PWA kabugu, statikler.
    ACIK = ("/giris", "/cikis", "/sw.js", "/favicon.ico", "/manifest.json", "/static/")

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        yol = scope["path"]
        if yol.startswith(self.ACIK):
            return await self.app(scope, receive, send)

        request = Request(scope, receive)
        if auth.current_user(request) is not None:
            return await self.app(scope, receive, send)

        htmx = request.headers.get("hx-request") == "true"
        hedef = "/giris?nereye=" + quote(yol, safe="/")
        if htmx:
            yanit = Response(status_code=401, headers={"HX-Redirect": hedef})
        elif scope["method"] == "GET" and "text/html" in request.headers.get("accept", ""):
            yanit = RedirectResponse(hedef, status_code=303)
        else:
            yanit = Response("giriş gerekli", status_code=401)
        await yanit(scope, receive, send)


app = FastAPI(title="EkipTakip", version="0.1.0-alpha", lifespan=lifespan)

# Ara katman sirasi: EN SON eklenen EN DISTA calisir.
#   MobileHostPrefix (yolu duzeltir) -> SessionMiddleware (oturumu acar)
#     -> GirisKapisi (kimligi arar) -> CsrfKapisi (token) -> rotalar
app.add_middleware(csrf.CsrfKapisi)
app.add_middleware(GirisKapisi)
app.add_middleware(
    SessionMiddleware,
    secret_key=config.SECRET_KEY,
    session_cookie=config.cerez_adi(),
    max_age=config.SESSION_MAX_AGE,
    same_site="lax",                 # siteler arasi POST/PATCH cerezi tasimaz
    https_only=config.yayinda(),     # yayinda yalnizca HTTPS
    domain=config.COOKIE_DOMAIN,     # bir giris, iki site
)
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


if config.sahte_kimlik():
    # Kullanici degistirme YALNIZCA gelistirme modunda var; yayin kurulumunda
    # bu rota hic tanimlanmaz (sahte kimlik zaten acilisi reddettirir).
    @app.post("/switch/{user_id}")
    def switch_user(request: Request, user_id: str):
        if auth.get_user(user_id) is None:
            raise HTTPException(404, "kullanıcı yok")
        kimlik.oturum_ac(request, user_id)
        back = urlparse(request.headers.get("referer") or "").path or "/"
        return RedirectResponse(back, status_code=303)


app.include_router(kimlik.router)

# Sira onemli: dashboard'un /{slug} iskele rotasi EN SONDA eslesmeli.
app.include_router(mobil.router)
app.include_router(dashboard.router)
