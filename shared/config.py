"""Ortam degiskenleri — iki alan adi ayrimi ve ortak veritabani.

Bos birakilirsa tek alan adi modunda calisir (/m ve /gorevler yollari).
Ayirmak icin (deploy/):
  EKIPTAKIP_HOST_APP=app.polonyum.com
  EKIPTAKIP_HOST_DASHBOARD=dashboard.polonyum.com
  EKIPTAKIP_COOKIE_DOMAIN=.polonyum.com

Degerler MODUL NITELIGI olarak okunur (config.HOST_APP), from-import ile degil:
testler ve ileride ayrik veritabanina gecis tek yerden degistirilebilsin diye.
"""
from __future__ import annotations

import os

HOST_APP = os.getenv("EKIPTAKIP_HOST_APP", "").lower()
HOST_DASH = os.getenv("EKIPTAKIP_HOST_DASHBOARD", "").lower()
COOKIE_DOMAIN = os.getenv("EKIPTAKIP_COOKIE_DOMAIN") or None


def is_app_host(request) -> bool:
    return bool(HOST_APP) and (request.url.hostname or "").lower() == HOST_APP


def mp(request) -> str:
    """Mobil yol oneki: app alan adinda bos, tek alan adi modunda '/m'."""
    return "" if is_app_host(request) else "/m"


def site_adresi(request, app_site: bool) -> str:
    """Diger yuzun adresi — YAZMAK icin, baglanti kurmak icin degil.

    Tasarim karari (spec/50-yapi.md): iki site birbirine hyperlink vermez.
    Bu yuzden donen deger href'e degil, ekranda gosterilen metne gider.
    """
    host = HOST_APP if app_site else HOST_DASH
    if not host:
        return "/m" if app_site else "/"
    return host
