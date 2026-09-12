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

from fastapi import Depends, FastAPI, Form, HTTPException, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import (FileResponse, HTMLResponse, JSONResponse,
                               RedirectResponse)
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from shared import (attachments, auth, cards, config, csrf, db, hardening, identity, media,
                    push, service)
from shared.render import SHARED_DIR, site_templates
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


def _is_mobile_host(request) -> bool:
    """Bu istek mobil yuze mi ait?

    Alan adi ayrimi kuruluyken: Host == HOST_APP.
    Alan adi tanimsizken (yerel gelistirme): ilk etiket "app" ise — yani
    app.localhost:8000 mobil, localhost:8000 masaustu. Boylece yapilandirma
    olmadan da iki yuz ayri adreste durur; yol onegine gerek kalmaz.
    """
    host = (request.url.hostname or "").lower()
    if config.HOST_APP:
        return host == config.HOST_APP
    return host.split(".")[0] == "app"


def mobile_only(request: Request):
    """Mobil rotalar yalnizca mobil host'ta gorunur.

    ORTAK yollar muaf: /manifest.json ve /sw.js mobil router'da tanimli ama
    iki yuzun de kullandigi seyler (config.SHARED_PATHS). Muaf olmasalardi
    masaustu alan adinda 404 donerlerdi — ve /login de mobil router'da
    olsaydi mobil alan adindan hic girilemezdi (KNOW-25 ile ayni tuzak).
    """
    if request.url.path.startswith(config.SHARED_PATHS):
        return
    if not _is_mobile_host(request):
        raise HTTPException(404, "sayfa yok")


def desktop_only(request: Request):
    """Masaustu rotalari mobil host'ta gorunmez — iki alan adina ayri Access
    politikasi yazilabilsin diye kasten 404 (spec/50-yapi.md)."""
    if _is_mobile_host(request):
        raise HTTPException(404, "sayfa yok")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Yanlis yapilandirma calisma aninda degil ACILISTA yakalanir (spec/70 §7).
    for warning in config.validate():
        print(f"[ekiptakip] UYARI: {warning}", file=sys.stderr)
    db.pool()
    for name in db.migrate():           # uygulanmamis goc dosyalari sirayla kosar
        print(f"[ekiptakip] goc uygulandi: {name}", file=sys.stderr)
    service.rebuild_tree()
    # ASLA raise etmez (CONTRACT-V2.md §8): bagli disk yoksa metin sohbeti
    # calisir, ek yuklemesi patlar — config.validate()'in zaten aldigi durus.
    attachments.sync_volume()
    yield


class LoginGate:
    """Oturumu olmayan istek iceri girmez (spec/70-guvenlik.md §2).

    HTML gezinmesi giris sayfasina yonlenir; HTMX istegi HX-Redirect ile tam
    sayfa yonlendirmesi yapar (yoksa giris sayfasi bir parcanin icine duserdi);
    digerleri 401 alir.
    """

    # Oturum gerektirmeyenler. TAM ESLESME (yalniz /static/ onek):
    # onek eslesmesi olsaydi, ileride eklenen bir modul slug'i (/login-raporu
    # gibi) sessizce kimliksiz okunabilir olurdu — /{slug} yakalayicisi var.
    EXEMPT_EXACT = frozenset({"/login", "/login/callback", "/sw.js", "/favicon.ico",
                              "/manifest.json"}
                             # Bildirim deneme ucu: kimlik ARANMAZ, cunku curl'den
                             # cagrilabilmesi tek varlik sebebi (uretimde oturum
                             # Google girisinden geliyor, curl ile alinamaz).
                             # Yalnizca EKIPTAKIP_PUSH_TEST=1 iken; bayrak kapaliyken
                             # zaten rota da yok.
                             | ({"/test/notification"} if config.PUSH_TEST else set()))
    EXEMPT_PREFIX = ("/static/",)

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        if path in self.EXEMPT_EXACT or path.startswith(self.EXEMPT_PREFIX):
            return await self.app(scope, receive, send)

        request = Request(scope, receive)
        if auth.current_user(request) is not None:
            return await self.app(scope, receive, send)

        htmx = request.headers.get("hx-request") == "true"
        target = "/login?next=" + quote(path, safe="/")
        if htmx:
            response = Response(status_code=401, headers={"HX-Redirect": target})
        elif scope["method"] == "GET" and "text/html" in request.headers.get("accept", ""):
            response = RedirectResponse(target, status_code=303)
        else:
            response = Response("giriş gerekli", status_code=401)
        await response(scope, receive, send)


app = FastAPI(title="EkipTakip", version="0.1.0-alpha", lifespan=lifespan)

# Ara katman sirasi: EN SON eklenen EN DISTA calisir.
#   SessionMiddleware (oturumu acar) -> LoginGate (kimligi arar)
#     -> SecurityHeaders -> CsrfGate -> rotalar
#
# Yol yeniden yazan bir katman YOK: mobil rotalar kokte tanimli, ayrim
# Host'a gore bagimlilikla yapiliyor (mobile_only / desktop_only).
app.add_middleware(csrf.CsrfGate)
app.add_middleware(hardening.SecurityHeaders)
app.add_middleware(LoginGate)
app.add_middleware(
    SessionMiddleware,
    secret_key=config.SECRET_KEY,
    session_cookie=config.cookie_name(),
    max_age=config.SESSION_MAX_AGE,
    same_site="lax",                 # siteler arasi POST/PATCH cerezi tasimaz
    https_only=config.in_production(),     # yayinda yalnizca HTTPS
    domain=config.COOKIE_DOMAIN,     # bir giris, iki site
)

# Statik: ortak kokte, site dosyalari kendi alt yolunda (nginx de boyle ayirir).
app.mount("/static/d", StaticFiles(directory=BASE / "sites/dashboard/static"), name="static-d")
app.mount("/static/m", StaticFiles(directory=BASE / "sites/mobil/static"), name="static-m")
app.mount("/static", StaticFiles(directory=BASE / "shared/static"), name="static")


@app.exception_handler(HTTPException)
async def log_permission_denial(request: Request, exc: HTTPException):
    """403'ler denetim izine tek yerden yazilir (spec/70-guvenlik.md §8).

    Uclarda tek tek yazilsaydi biri unutulurdu; burasi hepsinin gectigi yer.
    """
    if exc.status_code == 403:
        try:
            identity.log_event(request, "permission_denied",
                        actor_id=request.session.get("uid") if hasattr(request, "session") else None,
                        detail=f"{request.method} {request.url.path}")
        except Exception:                      # denetim yazimi istegi bozmasin
            pass
    return await http_exception_handler(request, exc)


# --- iki sitenin de kullandigi uclar ---------------------------------------


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(BASE / "shared/static/icon-192.png", media_type="image/png")


@app.get("/whoami")
def whoami(request: Request):
    u = auth.current_user(request)
    if u is None:                                   # kapi gevserse gurultusuz duralim
        return JSONResponse({"hata": "oturum yok"}, status_code=401)
    return JSONResponse({"id": str(u["id"]), "name": u["name"], "email": u["email"],
                         "is_admin": db.as_bool(u["is_admin"]),
                         "scope": service.TREE.name(u["scope_node_id"]) if u["scope_node_id"] else None})


# --- medya ekleri (sozlesme §6) --------------------------------------------
#
# Iki router'da degil DOGRUDAN app'te, /whoami gibi: /media/* iki alan
# adinda da calismali. LoginGate zaten kapsiyor, ayrica bir istisna eklenmez.

_MEDIA_TPL = site_templates(SHARED_DIR)     # ortak/mesaj.html'i tek basina cizmek icin


def _attachment_or_404(attachment_id: str) -> dict:
    """uuid gecersizse ya da satir yok/silinmisse 404 — 500 degil.

    db.uid() gecersiz girdide None doner; bu ayni zamanda
    /media/../../etc/passwd gibi bir yolu da yol asimi degil "bulunamadi"
    yapan mekanizmadir (sozlesme §6). Satirin kendisi shared/attachments.py'den
    gelir — burasi sadece 404/silinmis kontrolu yapar.
    """
    row = attachments.get(attachment_id)
    if row is None or row["deleted_at"] is not None:
        raise HTTPException(404, "ek yok")
    return row


def _content_disposition(name: str | None, fallback: str) -> str:
    """Content-Disposition degeri: CR/LF yok, tirnak kacagi yok, ASCII yedek.

    RFC 5987 `filename*` gercek (UTF-8) adi tasir; duz `filename=` ASCII'ye
    indirgenmis bir yedek — CR/LF ve tirnak elenir ki baslik kacagi olmasin.
    """
    raw = (name or fallback).replace("\r", " ").replace("\n", " ").strip() or fallback
    ascii_name = raw.encode("ascii", "ignore").decode("ascii").replace('"', "").strip() or fallback
    return f'inline; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(raw, safe="")}'


def _serve_blob(row: dict, thumb: bool, mime: str, filename: str | None,
                 fallback: str) -> Response:
    """Byte'i yolla. MEDIA_ACCEL bosken bugunku FileResponse; doluyken bos govde
    + X-Accel-Redirect (CONTRACT-V2.md §10) — iki yol da AYNI kilitleme
    kontrolunden (attachments.abs_path / accel_relpath) gecer.
    """
    headers = {
        "Content-Disposition": _content_disposition(filename, fallback),
        # id'ler DEGISMEZ (silinen ek zaten 404): sonsuza kadar onbellekle.
        "Cache-Control": "private, max-age=31536000, immutable",
    }
    if config.MEDIA_ACCEL:
        try:
            rel = attachments.accel_relpath(row, thumb=thumb)
        except media.MediaError:
            raise HTTPException(404, "ek yok")          # bozuk kayit, 500 degil
        headers["X-Accel-Redirect"] = f"{config.MEDIA_ACCEL}/{quote(rel)}"
        headers["Content-Type"] = mime
        return Response(status_code=200, headers=headers)

    try:
        path = attachments.abs_path(row, thumb=thumb)
    except media.MediaError:
        raise HTTPException(404, "ek yok")              # bozuk kayit, 500 degil
    if not path.is_file():
        raise HTTPException(404, "ek yok")
    return FileResponse(path, media_type=mime, headers=headers)


@app.get("/media/{attachment_id}")
def get_attachment(request: Request, attachment_id: str):
    user = auth.current_user(request)
    row = _attachment_or_404(attachment_id)
    if not attachments.can_view(user, row):
        raise HTTPException(403, "bu eki görme yetkin yok")
    return _serve_blob(row, False, row["mime"], row["original_name"], attachment_id)


@app.get("/media/{attachment_id}/thumb")
def get_attachment_thumb(request: Request, attachment_id: str):
    """Kucuk resim; thumb_key yoksa TAM goruntuye duser (sozlesme §6)."""
    user = auth.current_user(request)
    row = _attachment_or_404(attachment_id)
    if not attachments.can_view(user, row):
        raise HTTPException(403, "bu eki görme yetkin yok")
    has_thumb = bool(row["thumb_key"])
    mime = media.THUMB_MIME if has_thumb else row["mime"]     # dususte GERCEK mime
    return _serve_blob(row, has_thumb, mime, row["original_name"], f"{attachment_id}-thumb")


@app.delete("/media/{attachment_id}", response_class=HTMLResponse)
def delete_attachment(request: Request, attachment_id: str):
    """Yumusak silme: deleted_at/deleted_by yazilir, sonra blob'lar silinir.

    events satiri ve metni KALIR — balon "(görsel silindi)" mezar tasiyla
    yeniden cizilir (sozlesme §6). Yetki: yukleyen ya da admin.
    """
    user = auth.current_user(request)
    row = _attachment_or_404(attachment_id)
    if not attachments.can_delete(user, row):
        raise HTTPException(403, "bu eki silme yetkin yok")
    attachments.soft_delete(row, user)
    # Bugun SADECE 'event' baglaniyor (CONTRACT-V2 §1b); baska bir owner_type
    # icin (item/node/team) henuz cizilecek bir balon yok — bos govde donulur,
    # varsayim degil GERCEK bir dal ayrimi (sozlesme §9).
    if row["owner_type"] != "event":
        return HTMLResponse("")
    m = service.event_message(row["owner_id"], user)
    return _MEDIA_TPL.TemplateResponse(request, "ortak/mesaj.html", {"m": m})


# --- eylemler + kart bloklari: IKI YUZDE de ayni uc -------------------------
#
# /media/* gibi DOGRUDAN app'te, router'larda degil: eylem seridi ve kart
# bloklari artik ortak sablon (shared/templates/ortak/), yani mobil ve
# masaustu ayni parcayi ciziyor. Uclari da kopyalasaydik iki yuz zamanla
# ayrisirdi — hangi davranisin nerede oldugu ikinci bir soru olurdu.


def _blocks(request: Request, item, user, name: str, **extra) -> HTMLResponse:
    ctx = {**service.item_blocks_ctx(item, user), **extra}
    return _MEDIA_TPL.TemplateResponse(request, name, ctx)


def _editable_item(request: Request, item_id: str):
    """Kayit + yazma yetkisi — dort ucun ortak kapisi."""
    user = auth.current_user(request)
    item = service.get_item(item_id)
    if not auth.can_edit_item(user, item, service.TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    return user, item


@app.post("/item/{item_id}/action", response_class=HTMLResponse)
async def create_action(request: Request, item_id: str):
    user, item = _editable_item(request, item_id)
    form = await request.form()
    service.require_deadline_scope(user, form)
    service.add_action(user, item, str(form.get("title") or ""),
                       form.get("assignee_id") or None, form.get("due_date") or None)
    return _blocks(request, service.get_item(item_id), user, "ortak/eylemler.html", oob_feed=True)


@app.patch("/action/{action_id}", response_class=HTMLResponse)
async def patch_action(request: Request, action_id: str):
    action = service.get_action(action_id)
    user, item = _editable_item(request, action["item_id"])
    form = await request.form()
    service.require_deadline_scope(user, form)
    changed = service.change_action(user, item, action, form)
    return _blocks(request, service.get_item(item["id"]), user, "ortak/eylemler.html",
                   oob_feed=changed)


@app.post("/item/{item_id}/card", response_class=HTMLResponse)
async def create_card(request: Request, item_id: str):
    user, item = _editable_item(request, item_id)
    form = await request.form()
    cards.add(item["id"], str(form.get("card_type") or ""), str(form.get("title") or ""),
              form, user["id"])
    return _blocks(request, item, user, "ortak/kartlar.html")


def _card_or_404(card_id: str) -> dict:
    card = cards.get(card_id)
    if card is None:
        raise HTTPException(404, "kart yok")
    return card


@app.patch("/card/{card_id}", response_class=HTMLResponse)
async def patch_card(request: Request, card_id: str):
    card = _card_or_404(card_id)
    user, item = _editable_item(request, card["item_id"])
    form = await request.form()
    cards.update(card["id"], str(form.get("title") or ""), form)
    return _blocks(request, item, user, "ortak/kartlar.html")


@app.delete("/card/{card_id}", response_class=HTMLResponse)
def remove_card(request: Request, card_id: str):
    card = _card_or_404(card_id)
    user, item = _editable_item(request, card["item_id"])
    cards.delete(card["id"])
    return _blocks(request, item, user, "ortak/kartlar.html")


@app.post("/card/{card_id}/media", response_class=HTMLResponse)
async def add_card_media(request: Request, card_id: str):
    """Medya kartina gorsel. Ek KARTIN kendisine asilir (owner_type='card'),
    kaydin tamamina degil — ayni karttaki iki medya blogu ayirt edilebilsin."""
    service.reject_oversized_upload(request)
    card = _card_or_404(card_id)
    user, item = _editable_item(request, card["item_id"])
    form = await request.form()
    image = form.get("image")
    image = image if getattr(image, "filename", None) else None
    saved = service.save_upload(image)
    if saved is not None:
        attachments.attach("card", card["id"], user["id"], saved)
    return _blocks(request, item, user, "ortak/kartlar.html")


# --- etiketler (CONTRACT-V2.md §6) ------------------------------------------
#
# Serit AYRI bir sablonda (ortak/tag_strip.html) ve akistaki balon da ayni
# parcayi include ediyor: yanit ile akis tek kaynaktan cizilsin. HTML'i
# Python'da dizgi olarak kurmak kacisi elle tasimak demekti — Jinja'nin
# select_autoescape'i o isi zaten yapiyor (README "XSS'e karsi kacis acik").


def _tag_strip(request: Request, row: dict) -> HTMLResponse:
    """Bir ekin etiket seridini yeniden cizer (POST/DELETE ortak donusu)."""
    tags = attachments.tags_for([row["id"]]).get(row["id"], [])
    return _MEDIA_TPL.TemplateResponse(
        request, "ortak/tag_strip.html",
        {"media": {"id": row["id"], "tags": tags, "can_tag": True}})


@app.post("/media/{attachment_id}/tags", response_class=HTMLResponse)
def add_media_tag(request: Request, attachment_id: str, name: str = Form(...)):
    user = auth.current_user(request)
    row = _attachment_or_404(attachment_id)
    if not attachments.can_tag(user, row):
        raise HTTPException(403, "bu eki etiketleme yetkin yok")
    attachments.add_tag(user, row, name)
    return _tag_strip(request, row)


@app.delete("/media/{attachment_id}/tags/{tag_id}", response_class=HTMLResponse)
def remove_media_tag(request: Request, attachment_id: str, tag_id: str):
    user = auth.current_user(request)
    row = _attachment_or_404(attachment_id)
    if not attachments.can_tag(user, row):
        raise HTTPException(403, "bu eki etiketleme yetkin yok")
    attachments.remove_tag(user, row, tag_id)
    return _tag_strip(request, row)


@app.get("/tags")
def list_tags(request: Request):
    """Sozluk — datalist icin (CONTRACT-V2.md §6)."""
    user = auth.current_user(request)
    if user is None:
        return JSONResponse({"hata": "oturum yok"}, status_code=401)
    return JSONResponse({"tags": [
        {"id": str(t["id"]), "name": t["name"], "slug": t["slug"], "color": t["color"]}
        for t in attachments.all_tags()]})


# --- web push (spec/40-push.md) -------------------------------------------
#
# Iki uc de config.SHARED_PATHS icinde: mobil onekine girmezler, iki alan
# adinda da ayni yoldan calisirlar.


@app.get("/vapid")
def vapid(request: Request):
    """Tarayicinin abone olurken ihtiyac duydugu ACIK anahtar.

    Gizli anahtar burada DEGIL — o yalnizca sunucuda imza atarken kullanilir.
    Push kurulmamissa 503: istemci "kapali" diye anlar ve dugmeyi gostermez.
    """
    if not push.enabled():
        return JSONResponse({"hata": "push kurulmamis"}, status_code=503)
    return JSONResponse({"publicKey": config.VAPID_PUBLIC})


@app.post("/subscribe")
async def subscribe(request: Request):
    """Tarayicidan gelen PushSubscription'i kaydeder.

    Kimlik zorunlu: abonelik bir kullaniciya baglanir, yoksa kime gonderilecegi
    bilinmez. CSRF kapisindan gecer (guvensiz metot) — istemci token'i
    <body hx-headers> icinden okuyup basliga koyar.
    """
    u = auth.current_user(request)
    if u is None:
        return JSONResponse({"hata": "oturum yok"}, status_code=401)
    if not push.enabled():
        return JSONResponse({"hata": "push kurulmamis"}, status_code=503)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"hata": "gecersiz govde"}, status_code=400)

    if not push.subscribe(u["id"], body, request.headers.get("user-agent")):
        return JSONResponse({"hata": "eksik abonelik"}, status_code=400)
    return JSONResponse({"ok": True})


if config.PUSH_TEST:
    # Bildirim deneme ucu. Rota YALNIZCA EKIPTAKIP_PUSH_TEST=1 iken kayit
    # edilir — kapatildiginda 403 degil 404 doner, cunku hic yoktur.
    #
    #   curl -X POST https://app.polonyum.com/test/notification \
    #     -H 'Content-Type: application/json' \
    #     -d '{"user_id":"<uuid>","baslik":"Deneme","govde":"Merhaba"}'
    #
    # user_id verilmezse ABONELIGI OLAN HERKESE gider.

    @app.post("/test/notification")
    async def test_notification(request: Request):
        if not push.enabled():
            return JSONResponse({"hata": "push kurulmamis (VAPID yok)"}, status_code=503)
        try:
            g = await request.json()
        except Exception:
            return JSONResponse({"hata": "govde JSON olmali"}, status_code=400)

        user_id = g.get("user_id")
        if user_id:
            if db.uid(user_id) is None:
                return JSONResponse({"hata": "gecersiz user_id"}, status_code=400)
            targets = [user_id]
        else:
            targets = [r["user_id"] for r in
                        db.q("select distinct user_id from push_subscriptions")]

        # Deneme ucunun isi hata ayiklamak: "0 gonderildi" deyip birakmak
        # "neden gelmedi" sorusunu cevapsiz birakir. Abonelik yoklugunu
        # ACIKCA soyle — telefon henuz abone olmamis demektir.
        if not push.subscriptions(targets):
            return JSONResponse(
                {"hata": "bu kullanicinin abonelik kaydi yok"
                         " — telefondan 'Bildirimleri aç' yapilmis mi?"},
                status_code=404)

        result = push.send(targets,
                            g.get("baslik") or "EkipTakip",
                            g.get("govde") or "Deneme bildirimi",
                            g.get("url") or config.mobile_path("/"),
                            g.get("tag"))
        return JSONResponse({"hedef": len(targets), **result})


if config.fake_identity():
    # Kullanici degistirme YALNIZCA gelistirme modunda var; yayin kurulumunda
    # bu rota hic tanimlanmaz (sahte kimlik zaten acilisi reddettirir).
    @app.post("/switch/{user_id}")
    def switch_user(request: Request, user_id: str):
        if auth.get_user(user_id) is None:
            raise HTTPException(404, "kullanıcı yok")
        identity.open_session(request, user_id)
        back = urlparse(request.headers.get("referer") or "").path or "/"
        return RedirectResponse(back, status_code=303)


app.include_router(identity.router)

# Iki yuz de KOKTE tanimli; '/m' gibi bir yol yok. Ayrim Host'a gore, rota
# seviyesinde bagimlilikla. Cakisan tek yol '/' — o yuzden iki router'daki
# kok rotalari asagida tek bir dagiticiya baglaniyor.
#
# Sira onemli: dashboard'un /{slug} iskele rotasi EN SONDA eslesmeli, yoksa
# /search, /actions gibi mobil yollari yutar.
@app.get("/", response_class=HTMLResponse)
def root(request: Request, tab: str = "open"):
    """Iki yuzun cakistigi TEK yol.

    Mobil yuz de masaustu yuzu de kokte duruyor ('/m' yok), o yuzden '/'
    iki router'da birden tanimlanamaz — burada Host'a gore dagitiliyor.
    """
    if _is_mobile_host(request):
        return mobil.todo_page(request, tab)
    return dashboard.home(request)


app.include_router(mobil.router, dependencies=[Depends(mobile_only)])
app.include_router(dashboard.router, dependencies=[Depends(desktop_only)])
