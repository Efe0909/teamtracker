"""Google ile giris, imzali oturum, guvenlik olaylari (spec/70-guvenlik.md §2, §8).

Kripto elle yazilmaz:
  - oturum  -> Starlette SessionMiddleware (itsdangerous ile imzali cerez)
  - id_token -> authlib dogrular (imza, iss, aud, exp)
Bizim isimiz akisi dogru kurmak ve KIMIN gireceğine karar vermek.
"""
from __future__ import annotations

from datetime import datetime, timezone

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from . import config, db
from .render import ORTAK

router = APIRouter()
_TPL = Jinja2Templates(directory=[ORTAK])

OTURUM_ANAHTARI = "uid"          # oturum sozlugunde kullanici id'si

_oauth = OAuth()
if config.AUTH_MODE == "google":
    _oauth.register(
        name="google",
        server_metadata_url=config.GOOGLE_KESIF,
        client_id=config.GOOGLE_CLIENT_ID,
        client_secret=config.GOOGLE_CLIENT_SECRET,
        client_kwargs={"scope": "openid email profile"},   # hassas kapsam YOK
    )


# --- guvenlik olaylari ----------------------------------------------------


def olay(request: Request | None, tur: str, actor_id: str | None = None,
         email: str | None = None, detay: str | None = None) -> None:
    """Kim girdi, kim reddedildi, kim 403 yedi. Govde tutulmaz (spec/70 §8)."""
    ip = None
    if request is not None:
        ip = request.headers.get("x-real-ip") or (
            request.client.host if request.client else None)
    db.x("insert into guvenlik_olaylari (id,created_at,tur,actor_id,email,ip,detay)"
         " values (?,?,?,?,?,?,?)",
         (db.new_id(), db.now(), tur, actor_id, email, ip, detay))


# --- oturum ---------------------------------------------------------------


def oturum_ac(request: Request, user_id: str) -> None:
    request.session[OTURUM_ANAHTARI] = user_id


def oturum_kapat(request: Request) -> None:
    request.session.pop(OTURUM_ANAHTARI, None)


def oturumdaki_id(request: Request) -> str | None:
    """Imza gecersizse Starlette oturumu bos verir; burada ekstra kontrol gerekmez."""
    return request.session.get(OTURUM_ANAHTARI)


# --- davetli listesi ------------------------------------------------------


def girebilir(email: str, sub: str) -> tuple[dict | None, str | None]:
    """Bu e-posta iceri girebilir mi?

    Doner: (kullanici, red_sebebi). Kullanici YOKSA olusturulmaz — davetli
    listesi disi giris yok (spec/70 §2.3).
    """
    u = db.q1("select * from users where google_sub = ?", (sub,))
    if u is None:
        u = db.q1("select * from users where lower(email) = lower(?)", (email,))
    if u is None:
        return None, "davetsiz"
    if u["google_sub"] and u["google_sub"] != sub:
        # E-posta ayni ama Google hesabi baska: adres devredilmis olabilir.
        return None, "hesap_uyusmuyor"
    if not db.as_bool(u["is_active"]):
        return None, "pasif"
    return u, None


def girisi_isle(user, sub: str) -> None:
    """Ilk girişte google_sub baglanir; her girişte son giris zamani yazilir."""
    db.x("update users set google_sub = ?, last_login_at = ? where id = ?",
         (sub, db.now(), user["id"]))


# --- donus adresi ---------------------------------------------------------


def guvenli_donus(nereye: str | None) -> str:
    """Yalnizca kendi yolumuz. Tam URL ya da // ile baslayan deger reddedilir."""
    if not nereye or not nereye.startswith("/") or nereye.startswith("//"):
        return "/"
    return nereye


# --- uclar ----------------------------------------------------------------


def _sayfa(request: Request, hata: str | None = None, kod: int = 200) -> HTMLResponse:
    return _TPL.TemplateResponse(request, "ortak/giris.html",
                                 {"hata": hata, "sahte": config.sahte_kimlik()},
                                 status_code=kod)


@router.get("/giris", response_class=HTMLResponse)
async def giris(request: Request, nereye: str = "/"):
    if oturumdaki_id(request):
        return RedirectResponse(guvenli_donus(nereye), status_code=303)
    if config.sahte_kimlik():
        return _sayfa(request)
    request.session["giris_donus"] = guvenli_donus(nereye)
    return await _oauth.google.authorize_redirect(
        request, str(request.url_for("giris_callback")))


@router.get("/giris/callback", name="giris_callback", response_class=HTMLResponse)
async def giris_callback(request: Request):
    if config.sahte_kimlik():
        raise HTTPException(404)
    try:
        # state dogrulamasi ve id_token imzasi authlib'in isi
        token = await _oauth.google.authorize_access_token(request)
    except OAuthError as e:
        olay(request, "giris_reddi", detay=f"oauth: {e.error}")
        return _sayfa(request, "Giriş tamamlanamadı. Tekrar dene.", 400)

    claims = token.get("userinfo") or {}
    email, sub = claims.get("email"), claims.get("sub")
    if not email or not sub or not claims.get("email_verified"):
        olay(request, "giris_reddi", email=email, detay="e-posta dogrulanmamis")
        return _sayfa(request, "Google hesabının e-postası doğrulanmamış.", 403)

    user, sebep = girebilir(email, sub)
    if user is None:
        olay(request, "giris_reddi", email=email, detay=sebep)
        mesajlar = {
            "davetsiz": "Bu e-posta kulüp listesinde yok. Yöneticine söyle, seni eklesin.",
            "pasif": "Hesabın kapatılmış. Yöneticine sor.",
            "hesap_uyusmuyor": "Bu e-posta başka bir Google hesabına bağlı. Yöneticine sor.",
        }
        return _sayfa(request, mesajlar[sebep], 403)

    girisi_isle(user, sub)
    oturum_ac(request, user["id"])
    olay(request, "giris", actor_id=user["id"], email=email)
    return RedirectResponse(guvenli_donus(request.session.pop("giris_donus", "/")),
                            status_code=303)


@router.post("/cikis")
async def cikis(request: Request):
    """POST: GET olsaydi <img src="/cikis"> ile herkes attirilabilirdi."""
    uid = oturumdaki_id(request)
    oturum_kapat(request)
    if uid:
        olay(request, "cikis", actor_id=uid)
    return RedirectResponse("/giris", status_code=303)
