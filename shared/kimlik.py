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

from . import config, db, sertlestirme
from .render import ORTAK as ORTAK_DIZIN
from .render import site_templates

router = APIRouter()
_TPL = site_templates(ORTAK_DIZIN)

OTURUM_ANAHTARI = "uid"          # oturum sozlugunde kullanici id'si

_oauth = OAuth()


def _google():
    """Istemci ILK KULLANIMDA kurulur.

    Import aninda kurulsaydi, AUTH_MODE sonradan degistirilen her baglamda
    (testler) istemci hic olmazdi.
    """
    if "google" not in _oauth._registry:
        _oauth.register(
            name="google",
            server_metadata_url=config.GOOGLE_KESIF,
            client_id=config.GOOGLE_CLIENT_ID,
            client_secret=config.GOOGLE_CLIENT_SECRET,
            client_kwargs={"scope": "openid email profile"},   # hassas kapsam YOK
        )
    return _oauth.google


# --- guvenlik olaylari ----------------------------------------------------


def olay(request: Request | None, tur: str, actor_id: str | None = None,
         email: str | None = None, detay: str | None = None) -> None:
    """Kim girdi, kim reddedildi, kim 403 yedi. Govde tutulmaz (spec/70 §8)."""
    ip = None
    if request is not None and detay is None:
        sid = request.session.get("sid") if hasattr(request, "session") else None
        detay = f"sid={sid}" if sid else None
    if request is not None:
        ham = request.headers.get("x-real-ip") or (
            request.client.host if request.client else None)
        # Sutun tipi inet: gecersiz deger insert'i patlatir ve denetim yazimi
        # istegi bozar. Basligi istemci gonderiyor, yani uydurulabilir.
        try:
            ip = str(ipaddress.ip_address(ham)) if ham else None
        except ValueError:
            ip = None
    db.x("insert into guvenlik_olaylari (id,created_at,tur,actor_id,email,ip,detay)"
         " values (%s,%s,%s,%s,%s,%s,%s)",
         (db.new_id(), db.now(), tur, actor_id, email, ip, detay))


# --- oturum ---------------------------------------------------------------


def oturum_ac(request: Request, user_id: str) -> None:
    """Oturum SIFIRDAN kurulur.

    clear() sart: giris oncesi oturumda duran CSRF token'i giristen sonra da
    gecerli kalsaydi, saldirgan kendi token'ini kurbanin tarayicisina yazdirip
    (alt alan adindan cookie tossing) giris sonrasi CSRF korumasini delerdi.
    Oturum sabitlemesine karsi da ayni hareket dogru olan.
    """
    request.session.clear()
    request.session[OTURUM_ANAHTARI] = str(user_id)   # oturum JSON'a yaziliyor
    # sid: tek bir oturumu ayirt etmek icin. Bugun yalnizca denetim izinde
    # kullaniliyor; tek oturum iptali gerekirse kara listenin capasi bu olur.
    request.session["sid"] = secrets.token_urlsafe(9)


def oturum_kapat(request: Request) -> None:
    """Cikista da komple temizlik: token dahil hicbir sey tasinmaz."""
    request.session.clear()


def oturumdaki_id(request: Request) -> str | None:
    """Imza gecersizse Starlette oturumu bos verir; burada ekstra kontrol gerekmez."""
    return request.session.get(OTURUM_ANAHTARI)


# --- davetli listesi ------------------------------------------------------


def girebilir(email: str, sub: str) -> tuple[dict | None, str | None]:
    """Bu e-posta iceri girebilir mi?

    Doner: (kullanici, red_sebebi). Kullanici YOKSA olusturulmaz — davetli
    listesi disi giris yok (spec/70 §2.3).
    """
    u = db.q1("select * from users where google_sub = %s", (sub,))
    if u is None:
        u = db.q1("select * from users where lower(email) = lower(%s)", (email,))
    if u is None:
        return None, "davetsiz"
    if u["google_sub"] and u["google_sub"] != sub:
        # E-posta ayni ama Google hesabi baska: adres devredilmis olabilir.
        return None, "hesap_uyusmuyor"
    if not db.as_bool(u["is_active"]):
        return None, "pasif"
    return u, None


def girisi_isle(user, sub: str, email: str) -> None:
    """Ilk girişte google_sub baglanir; her girişte son giris zamani yazilir.

    Ayni Google hesabi (sub) farkli bir e-postayla gelirse e-posta GUNCELLENIR:
    kisi kurumsal adresini degistirmis olabilir, kimligin capasi sub'dir.
    Tersi (ayni e-posta, farkli sub) girebilir() icinde REDDEDILIR — hesap
    devralma vektoru (spec/70-guvenlik.md §2.3).
    """
    db.x("update users set google_sub = %s, email = %s, last_login_at = %s where id = %s",
         (sub, email, db.now(), user["id"]))


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
    if sertlestirme.sinir_asildi(request):
        olay(request, "giris_reddi", detay="hiz siniri")
        return sertlestirme.cok_deneme()
    if oturumdaki_id(request):
        return RedirectResponse(guvenli_donus(nereye), status_code=303)
    if config.sahte_kimlik():
        return _sayfa(request)
    request.session["giris_donus"] = guvenli_donus(nereye)
    return await _google().authorize_redirect(
        request, str(request.url_for("giris_callback")))


@router.get("/giris/callback", name="giris_callback", response_class=HTMLResponse)
async def giris_callback(request: Request):
    if config.sahte_kimlik():
        raise HTTPException(404)
    if sertlestirme.sinir_asildi(request):
        olay(request, "giris_reddi", detay="hiz siniri")
        return sertlestirme.cok_deneme()
    try:
        # state dogrulamasi ve id_token imzasi authlib'in isi
        token = await _google().authorize_access_token(request)
    except Exception as e:
        # OAuthError yetmez: id_token dogrulama hatalari (joserfc) AuthlibBaseError
        # ALT SINIFI DEGIL, ag hatalari da degil. Dar yakalarsak kullaniciya ham
        # 500 doner ve red denetim izine hic yazilmaz.
        olay(request, "giris_reddi", detay=f"oauth: {type(e).__name__}")
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

    nereye = guvenli_donus(request.session.get("giris_donus", "/"))
    girisi_isle(user, sub, email)
    oturum_ac(request, user["id"])        # oturumu temizler: donus adresi ONCE okundu
    olay(request, "giris", actor_id=user["id"], email=email)
    return RedirectResponse(nereye, status_code=303)


@router.post("/cikis")
async def cikis(request: Request):
    """POST: GET olsaydi <img src="/cikis"> ile herkes attirilabilirdi."""
    uid = oturumdaki_id(request)
    oturum_kapat(request)
    if uid:
        olay(request, "cikis", actor_id=uid)
    return RedirectResponse("/giris", status_code=303)
