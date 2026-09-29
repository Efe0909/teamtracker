"""Google ile giris, imzali oturum, guvenlik olaylari (spec/70-guvenlik.md §2, §8).

Kripto elle yazilmaz:
  - oturum  -> Starlette SessionMiddleware (itsdangerous ile imzali cerez)
  - id_token -> authlib dogrular (imza, iss, aud, exp)
Bizim isimiz akisi dogru kurmak ve KIMIN gireceğine karar vermek.
"""
from __future__ import annotations

import ipaddress
import secrets

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from . import auth, config, db, hardening
from .render import SHARED_DIR
from .render import site_templates

router = APIRouter()
_TPL = site_templates(SHARED_DIR)

SESSION_KEY = "uid"          # oturum sozlugunde kullanici id'si

_oauth = OAuth()


def _google():
    """Istemci ILK KULLANIMDA kurulur.

    Import aninda kurulsaydi, AUTH_MODE sonradan degistirilen her baglamda
    (testler) istemci hic olmazdi.
    """
    if "google" not in _oauth._registry:
        _oauth.register(
            name="google",
            server_metadata_url=config.GOOGLE_DISCOVERY,
            client_id=config.GOOGLE_CLIENT_ID,
            client_secret=config.GOOGLE_CLIENT_SECRET,
            client_kwargs={"scope": "openid email profile"},   # hassas kapsam YOK
        )
    return _oauth.google


# --- guvenlik olaylari ----------------------------------------------------


def log_event(request: Request | None, event_type: str, actor_id: str | None = None,
              email: str | None = None, detail: str | None = None) -> None:
    """Kim girdi, kim reddedildi, kim 403 yedi. Govde tutulmaz (spec/70 §8)."""
    ip = None
    if request is not None and detail is None:
        sid = request.session.get("sid") if hasattr(request, "session") else None
        detail = f"sid={sid}" if sid else None
    if request is not None:
        raw = request.headers.get("x-real-ip") or (
            request.client.host if request.client else None)
        # Sutun tipi inet: gecersiz deger insert'i patlatir ve denetim yazimi
        # istegi bozar. Basligi istemci gonderiyor, yani uydurulabilir.
        try:
            ip = str(ipaddress.ip_address(raw)) if raw else None
        except ValueError:
            ip = None
    db.x("insert into security_events (id,created_at,event_type,actor_id,email,ip,detail)"
         " values (%s,%s,%s,%s,%s,%s,%s)",
         (db.new_id(), db.now(), event_type, actor_id, email, ip, detail))


# --- oturum ---------------------------------------------------------------


def open_session(request: Request, user_id: str) -> None:
    """Oturum SIFIRDAN kurulur.

    clear() sart: giris oncesi oturumda duran CSRF token'i giristen sonra da
    gecerli kalsaydi, saldirgan kendi token'ini kurbanin tarayicisina yazdirip
    (alt alan adindan cookie tossing) giris sonrasi CSRF korumasini delerdi.
    Oturum sabitlemesine karsi da ayni hareket dogru olan.
    """
    request.session.clear()
    request.session[SESSION_KEY] = str(user_id)   # oturum JSON'a yaziliyor
    # sid: tek bir oturumu ayirt etmek icin. Bugun yalnizca denetim izinde
    # kullaniliyor; tek oturum iptali gerekirse kara listenin capasi bu olur.
    request.session["sid"] = secrets.token_urlsafe(9)


def close_session(request: Request) -> None:
    """Cikista da komple temizlik: token dahil hicbir sey tasinmaz."""
    request.session.clear()


def session_user_id(request: Request) -> str | None:
    """Imza gecersizse Starlette oturumu bos verir; burada ekstra kontrol gerekmez."""
    return request.session.get(SESSION_KEY)


# --- davetli listesi ------------------------------------------------------


def can_enter(email: str, sub: str) -> tuple[dict | None, str | None]:
    """Bu e-posta iceri girebilir mi?

    Doner: (kullanici, red_sebebi). Kullanici YOKSA olusturulmaz — davetli
    listesi disi giris yok (spec/70 §2.3).
    """
    u = db.q1("select * from users where google_sub = %s", (sub,))
    if u is None:
        u = db.q1("select * from users where lower(email) = lower(%s)", (email,))
    if u is None:
        return None, "uninvited"
    if u["google_sub"] and u["google_sub"] != sub:
        # E-posta ayni ama Google hesabi baska: adres devredilmis olabilir.
        return None, "account_mismatch"
    if not db.as_bool(u["is_active"]):
        return None, "inactive"
    return u, None


def handle_login(user, sub: str, email: str) -> None:
    """Ilk girişte google_sub baglanir; her girişte son giris zamani yazilir.

    Ayni Google hesabi (sub) farkli bir e-postayla gelirse e-posta GUNCELLENIR:
    kisi kurumsal adresini degistirmis olabilir, kimligin capasi sub'dir.
    Tersi (ayni e-posta, farkli sub) can_enter() icinde REDDEDILIR — hesap
    devralma vektoru (spec/70-guvenlik.md §2.3).
    """
    db.x("update users set google_sub = %s, email = %s, last_login_at = %s where id = %s",
         (sub, email, db.now(), user["id"]))


# --- donus adresi ---------------------------------------------------------


def safe_return(where: str | None) -> str:
    """Yalnizca kendi yolumuz. Tam URL ya da // ile baslayan deger reddedilir."""
    if not where or not where.startswith("/") or where.startswith("//"):
        return "/"
    return where


# --- uclar ----------------------------------------------------------------


def _page(request: Request, error: str | None = None, code: int = 200) -> HTMLResponse:
    return _TPL.TemplateResponse(request, "ortak/giris.html",
                                 {"hata": error, "sahte": config.fake_identity()},
                                 status_code=code)


@router.get("/login", response_class=HTMLResponse)
async def login(request: Request, next: str = "/"):
    if hardening.limit_exceeded(request):
        log_event(request, "login_denied", detail="hiz siniri")
        return hardening.too_many_attempts()
    # "Zaten girmissin" demeden ONCE kullanicinin gercekten COZULDUGUNU
    # dogrula. Oturumda uid olmasi yetmez: satir silinmis, `is_active=false`
    # yapilmis (yonetim paneli!) ya da veritabani sifirlanmis olabilir.
    #
    # Dogrulamazsak LoginGate ile bu uc birbirini suclar ve tarayici SONSUZ
    # DONGUYE girer: LoginGate `auth.current_user()` (DB'ye bakar) None
    # gorup buraya yollar, burasi ham oturuma bakip "girmissin" deyip geri
    # yollar. Ustelik dongunun kendisi GET /login'i dovup hiz sinirini
    # tuketir ve 429'a duser — belirti "cok fazla deneme" olur, oysa kimse
    # giris denemesi yapmamistir.
    if session_user_id(request):
        if auth.current_user(request) is not None:
            return RedirectResponse(safe_return(next), status_code=303)
        close_session(request)        # bayat oturum: temizle, akis bastan bassin
    if config.fake_identity():
        return _page(request)
    request.session["login_return"] = safe_return(next)
    return await _google().authorize_redirect(
        request, str(request.url_for("login_callback")))


@router.get("/login/callback", name="login_callback", response_class=HTMLResponse)
async def login_callback(request: Request):
    if config.fake_identity():
        raise HTTPException(404)
    if hardening.limit_exceeded(request):
        log_event(request, "login_denied", detail="hiz siniri")
        return hardening.too_many_attempts()
    try:
        # state dogrulamasi ve id_token imzasi authlib'in isi
        token = await _google().authorize_access_token(request)
    except Exception as e:
        # OAuthError yetmez: id_token dogrulama hatalari (joserfc) AuthlibBaseError
        # ALT SINIFI DEGIL, ag hatalari da degil. Dar yakalarsak kullaniciya ham
        # 500 doner ve red denetim izine hic yazilmaz.
        log_event(request, "login_denied", detail=f"oauth: {type(e).__name__}")
        return _page(request, "Giriş tamamlanamadı. Tekrar dene.", 400)

    claims = token.get("userinfo") or {}
    email, sub = claims.get("email"), claims.get("sub")
    if not email or not sub or not claims.get("email_verified"):
        log_event(request, "login_denied", email=email, detail="e-posta dogrulanmamis")
        return _page(request, "Google hesabının e-postası doğrulanmamış.", 403)

    user, reason = can_enter(email, sub)
    if user is None:
        log_event(request, "login_denied", email=email, detail=reason)
        messages = {
            "uninvited": "Bu e-posta kulüp listesinde yok. Yöneticine söyle, seni eklesin.",
            "inactive": "Hesabın kapatılmış. Yöneticine sor.",
            "account_mismatch": "Bu e-posta başka bir Google hesabına bağlı. Yöneticine sor.",
        }
        return _page(request, messages[reason], 403)

    next = safe_return(request.session.get("login_return", "/"))
    handle_login(user, sub, email)
    open_session(request, user["id"])        # oturumu temizler: donus adresi ONCE okundu
    log_event(request, "login", actor_id=user["id"], email=email)
    return RedirectResponse(next, status_code=303)


@router.post("/logout")
async def logout(request: Request):
    """POST: GET olsaydi <img src="/logout"> ile herkes attirilabilirdi."""
    uid = session_user_id(request)
    close_session(request)
    if uid:
        log_event(request, "logout", actor_id=uid)
    return RedirectResponse("/login", status_code=303)
