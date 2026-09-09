"""Ortam degiskenleri: alan adlari, sirlar, kimlik modu.

Degerler MODUL NITELIGI olarak okunur (config.HOST_APP) — from-import ile degil:
testler yamalayabilsin, ileride tek yerden degistirilebilsin diye.

Sirlar .env'de durur, koda gomulmez, log'a yazilmaz (spec/70-guvenlik.md §7).
Isimler .env.ornek'te; degerler ASLA depoda degil.
"""
from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path

from dotenv import load_dotenv

# .env depo kokunde; systemd WorkingDirectory de orasi. Ortamda zaten tanimli
# olan degerler EZILMEZ (override=False): systemd Environment= satirlari kazanir.
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)

# --- iki alan adi ---------------------------------------------------------
#   EKIPTAKIP_HOST_APP=app.polonyum.com
#   EKIPTAKIP_HOST_DASHBOARD=dashboard.polonyum.com
#   EKIPTAKIP_COOKIE_DOMAIN=.polonyum.com     (kimlik iki alt alan adinda ortak)

HOST_APP = os.getenv("EKIPTAKIP_HOST_APP", "").lower()
HOST_DASH = os.getenv("EKIPTAKIP_HOST_DASHBOARD", "").lower()
COOKIE_DOMAIN = os.getenv("EKIPTAKIP_COOKIE_DOMAIN") or None

# --- kimlik ---------------------------------------------------------------

AUTH_MODE = os.getenv("EKIPTAKIP_AUTH", "google").lower()   # "google" | "sahte"
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_KESIF = "https://accounts.google.com/.well-known/openid-configuration"

# Fallback burada olmali: SessionMiddleware bu degeri IMPORT aninda okuyor.
# dogrula() icinde uretilseydi oturumlar bos anahtarla imzalanirdi.
SECRET_KEY = os.getenv("EKIPTAKIP_SECRET_KEY", "")
SECRET_URETILDI = not SECRET_KEY
if SECRET_URETILDI:
    SECRET_KEY = secrets.token_urlsafe(32)
# --- web push (spec/40-push.md) -------------------------------------------
# Anahtarlar .env'de, koda gomulmez. Tanimli degilse push sessizce kapali
# kalir — uygulama push olmadan da calisir (shared/push.py: acik()).
#
# Uretim:
#   .venv/bin/python tools/vapid_uret.py
#
# DIKKAT: anahtar degisirse MEVCUT TUM ABONELIKLER gecersizlesir; herkesin
# telefondan yeniden abone olmasi gerekir.
VAPID_PRIVATE = os.getenv("VAPID_PRIVATE", "")
VAPID_PUBLIC = os.getenv("VAPID_PUBLIC", "")
VAPID_SUB = os.getenv("VAPID_SUB", "mailto:yonetici@polonyum.com")

# --- push deneme ucu ------------------------------------------------------
# EKIPTAKIP_PUSH_TEST=1 verilmedikce /test/bildirim ucu HIC KAYIT EDILMEZ —
# devre disi degil, rota tablosunda yok (sahte kimlik rotasiyla ayni desen).
# Boylece "yayinda kapatiriz" bir soz degil, bir anahtar.
#
# Kimlik yok, kullanici id'si yeterli sayiliyor: deneme ucu, acik karar.
# Acikken bilinen bir id'ye rasgele baslik/govde ile bildirim gonderilebilir —
# yani kilit ekranina metin yazdirmak isteyen biri icin bir yol. Yayinda acik
# birakma.
PUSH_TEST = os.getenv("EKIPTAKIP_PUSH_TEST") == "1"

SESSION_COOKIE = "ekiptakip"          # yayinda __Secure- onekiyle (bkz. cerez_adi)
SESSION_MAX_AGE = 30 * 24 * 3600            # 30 gun: telefondaki uygulama surekli sormasin

# --- ortak yollar (mobil onekine girmezler) -------------------------------

# Iki alan adinda da AYNI yoldan servis edilenler: mobil onegine girmezler.
# Ortak yollar iki yuzde de ayni adresten calisir; Host kapisina takilmazlar
# (app.py: sadece_mobil). /giris burada olmazsa mobil alan adindan girilemez.
SHARED_PATHS = ("/static/", "/sw.js", "/favicon.ico", "/manifest.json",
                "/giris", "/cikis", "/whoami", "/switch/",
                # Push: iki yuz de ayni uctan abone olur, mobil onekine girmez.
                "/vapid", "/abone", "/test/bildirim")


def yayinda() -> bool:
    """Yayin kurulumu mu — kurallarin sertlestigi yer.

    Iki isaret: acikca EKIPTAKIP_ENV=yayin, ya da alan adi ORTAM DEGISKENIYLE
    verilmis olmasi. Ikincisi unutulmaya karsi emniyet: alan adi verildiyse
    bu is ciddidir.

    Dikkat: modul nitelikleri (HOST_APP/HOST_DASH) degil ORTAM okunur. Bu ikisi
    farkli sorular: nitelikler "istek hangi yuze gidecek" (testler yamalar),
    ortam "burasi gercek bir kurulum mu" (yamalanmaz).
    """
    return (os.getenv("EKIPTAKIP_ENV", "").lower() == "yayin"
            or bool(os.getenv("EKIPTAKIP_HOST_APP") or os.getenv("EKIPTAKIP_HOST_DASHBOARD")))


def _test_kosumu() -> bool:
    """Testte olumcul kontroller uyariya doner.

    Acik bayrak: yalnizca tests/conftest.py koyar. Onceki surum "pytest
    sys.modules'te mi" diye bakiyordu; pytest yayin venv'inde de kurulu
    oldugu icin savunma bir import zincirine asili kaliyordu.

    YAYINDA BU BAYRAK YOK SAYILIR — arka kapi olmasin diye.
    """
    return os.getenv("EKIPTAKIP_TEST_YAPILANDIRMA") == "1" and not yayinda()


def cerez_adi() -> str:
    """Yayinda __Secure- oneki: cerez yalnizca HTTPS uzerinden yazilabilir.

    __Host- kullanamiyoruz: o onek Domain niteligini yasaklar, biz ise iki alt
    alan adinda tek oturum icin Domain'e muhtaciz (spec/70-guvenlik.md §2.4).
    """
    return ("__Secure-" + SESSION_COOKIE) if yayinda() else SESSION_COOKIE


def gelistirmede() -> bool:
    """Sahte kimligin kabul edildigi TEK durum: acikca gelistirme denmis olmasi.

    Onceki surum tersini yapiyordu (yayin oldugunu cikarmaya calisiyordu) ve
    tek alan adi modunda kurulan gercek bir sunucuda — EKIPTAKIP_ENV yazilmayi
    unutulursa — sahte kimlik sessizce acilabiliyordu.
    """
    return os.getenv("EKIPTAKIP_ENV", "").lower() == "gelistirme"


def sahte_kimlik() -> bool:
    return AUTH_MODE == "sahte" and gelistirmede()


def dogrula() -> list[str]:
    """Acilista calisir. Olumcul eksikte SystemExit, digerlerinde uyari dondurur.

    Amac: yanlis yapilandirmayi calisma aninda degil ACILISTA yakalamak.
    """
    uyarilar: list[str] = []
    olumcul: list[str] = []

    if AUTH_MODE not in ("google", "sahte"):
        olumcul.append(f"EKIPTAKIP_AUTH gecersiz: {AUTH_MODE!r}. "
                       "Yalnizca 'google' ya da 'sahte' olabilir.")

    if AUTH_MODE == "sahte" and not gelistirmede():
        olumcul.append("EKIPTAKIP_AUTH=sahte yalnizca EKIPTAKIP_ENV=gelistirme ile "
                       "birlikte kabul edilir. Gercek kurulumda gercek kimlik sart.")
    if AUTH_MODE == "sahte" and yayinda():
        olumcul.append("EKIPTAKIP_AUTH=sahte ile yayin kurulumu acilamaz.")

    if AUTH_MODE == "google" and not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET):
        olumcul.append("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET tanimli degil. "
                       "Ya .env'e koy ya da gelistirme icin "
                       "EKIPTAKIP_AUTH=sahte EKIPTAKIP_ENV=gelistirme kullan.")

    if SECRET_URETILDI:
        if yayinda():
            olumcul.append("EKIPTAKIP_SECRET_KEY tanimli degil — yayinda acilmaz.")
        uyarilar.append("EKIPTAKIP_SECRET_KEY yok: gecici anahtar uretildi, "
                        "surec kapaninca butun oturumlar duser.")
    elif len(SECRET_KEY) < 32:
        mesaj = ("EKIPTAKIP_SECRET_KEY 32 karakterden kisa; uret: "
                 "python -c \"import secrets;print(secrets.token_urlsafe(32))\"")
        (olumcul if yayinda() else uyarilar).append(mesaj)

    if sahte_kimlik():
        uyarilar.append("KIMLIK SAHTE (EKIPTAKIP_AUTH=sahte): giris yok, ilk kullanici "
                        "olarak calisiliyor. Yalnizca gelistirme icin.")

    if yayinda() and not COOKIE_DOMAIN:
        uyarilar.append("EKIPTAKIP_COOKIE_DOMAIN yok: iki alan adinda ayri ayri "
                        "giris yapmak gerekir.")

    if olumcul and not _test_kosumu():
        raise SystemExit("GUVENLIK yapilandirmasi eksik:\n  - " + "\n  - ".join(olumcul))
    return uyarilar + [f"(testte uyariya cevrildi) {m}" for m in olumcul]


def is_app_host(request) -> bool:
    return bool(HOST_APP) and (request.url.hostname or "").lower() == HOST_APP


def mp(request) -> str:
    """Mobil yol oneki — ARTIK HER ZAMAN BOS.

    Mobil yuz kendi alan adinda KOKTE duruyor; yol oneki YOK. Islev duruyor
    cunku sablonlar cagiriyor ve ileride baska bir onek gerekirse tek yer
    burasi olsun. Sabit "" yazmak yerine burayi cagirmaya devam edin.
    """
    return ""


def mobil_yol(yol: str = "/") -> str:
    """Mobil yuzun yolu — ISTEK OLMADAN (push gonderimi, arka plan isleri).

    mp() istekteki Host'a bakar; buranin oyle bir lüksü yok. Ama mod
    yapilandirmadan da bilinir: HOST_APP tanimliysa mobil yuz o alan adinda
    KOKTE duruyor, yol oneki YOK.

    Bildirim adresine onek gomme: adres cubuguna sizar ve yanlis alan adinda
    404 olur.
    """
    return yol if yol.startswith("/") else "/" + yol


def site_adresi(request, app_site: bool) -> str:
    """Diger yuzun adresi — YAZMAK icin, baglanti kurmak icin degil.

    Tasarim karari (spec/50-yapi.md): iki site birbirine hyperlink vermez.
    """
    host = HOST_APP if app_site else HOST_DASH
    if not host:
        return "/" 
    return host
