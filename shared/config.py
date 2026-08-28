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

SECRET_KEY = os.getenv("EKIPTAKIP_SECRET_KEY", "")
SESSION_COOKIE = "ekiptakip"
SESSION_MAX_AGE = 30 * 24 * 3600            # 30 gun: telefondaki uygulama surekli sormasin

# --- ortak yollar (mobil onekine girmezler) -------------------------------

# Iki alan adinda da AYNI yoldan servis edilenler: mobil onegine girmezler.
# /giris burada olmazsa app.<alan>/giris -> /m/giris olur ve giris yapilamaz.
SHARED_PATHS = ("/static/", "/sw.js", "/favicon.ico", "/manifest.json",
                "/giris", "/cikis", "/whoami", "/switch/")


def yayinda() -> bool:
    """Yayin kurulumu mu — kurallarin sertlestigi yer.

    Iki isaret: acikca EKIPTAKIP_ENV=yayin, ya da alan adi tanimli olmasi.
    Ikincisi unutulmaya karsi emniyet: alan adi verildiyse bu is ciddidir.
    """
    return os.getenv("EKIPTAKIP_ENV", "").lower() == "yayin" or bool(HOST_APP or HOST_DASH)


def _test_kosumu() -> bool:
    """Testte olumcul kontroller uyariya doner.

    Ortam degiskeniyle degil pytest'in yuklu olmasiyla anlasilir: yayin sureci
    icinde pytest yoktur, dolayisiyla bu bir arka kapi degildir.
    """
    return "pytest" in sys.modules


def sahte_kimlik() -> bool:
    return AUTH_MODE == "sahte"


def dogrula() -> list[str]:
    """Acilista calisir. Olumcul eksikte SystemExit, digerlerinde uyari dondurur.

    Amac: yanlis yapilandirmayi calisma aninda degil ACILISTA yakalamak.
    """
    global SECRET_KEY
    uyarilar: list[str] = []
    olumcul: list[str] = []

    if sahte_kimlik() and yayinda():
        olumcul.append("EKIPTAKIP_AUTH=sahte ile yayin kurulumu acilamaz "
                       "(EKIPTAKIP_ENV=yayin ya da alan adi tanimli). Gercek kimlik sart.")

    if AUTH_MODE == "google" and not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET):
        olumcul.append("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET tanimli degil. "
                       "Ya .env'e koy ya da gelistirme icin EKIPTAKIP_AUTH=sahte kullan.")

    if not SECRET_KEY:
        if yayinda():
            olumcul.append("EKIPTAKIP_SECRET_KEY tanimli degil — yayinda acilmaz.")
        SECRET_KEY = secrets.token_urlsafe(32)
        uyarilar.append("EKIPTAKIP_SECRET_KEY yok: gecici anahtar uretildi, "
                        "surec kapaninca butun oturumlar duser.")
    elif len(SECRET_KEY) < 32:
        uyarilar.append("EKIPTAKIP_SECRET_KEY 32 karakterden kisa; "
                        "`python -c \"import secrets;print(secrets.token_urlsafe(32))\"`")

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
    """Mobil yol oneki: app alan adinda bos, tek alan adi modunda '/m'."""
    return "" if is_app_host(request) else "/m"


def site_adresi(request, app_site: bool) -> str:
    """Diger yuzun adresi — YAZMAK icin, baglanti kurmak icin degil.

    Tasarim karari (spec/50-yapi.md): iki site birbirine hyperlink vermez.
    """
    host = HOST_APP if app_site else HOST_DASH
    if not host:
        return "/m" if app_site else "/"
    return host
