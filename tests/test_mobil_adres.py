"""Mobil yüze YALNIZCA alt alan adından, kökten erişilir — '/m' ile değil.

Mobil yüz `app.<alan>` altında kökte durur. `/m` iç yoldur (MobileHostPrefix
gelen `/eylemler`'i `/m/eylemler`'e çevirir), dışarıdan görünen bir adres
DEĞİLDİR.

Kapatılmadan önce iki sızıntı vardı:
  1. app.<alan>/m aynı içeriğe ikinci bir adresti — paylaşılan link bölünür,
     PWA kapsamı karışır, adres çubuğunda '/m' sızar.
  2. dashboard.<alan>/m mobil yüzü MASAÜSTÜ alan adından açıyordu; önek
     yalnızca app host'unda yazıldığı için ham rotalar oradan doğrudan
     servis ediliyordu.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import config  # noqa: E402

APP, DASH = "app.test", "dash.test"


@pytest.fixture(scope="module")
def client():
    from conftest import test_veritabani  # noqa: E402
    test_veritabani("mobiladres")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        yield c


@pytest.fixture
def iki_alan(monkeypatch):
    """Alan adlarını MODÜL NİTELİĞİ olarak yamala.

    Ortam değişkeni verilirse yayinda() true olur ve sahte kimlik açılışı
    reddedilir; nitelik yaması o kapıyı tetiklemez (shared/config.py'nin
    kendi notu: nitelikler yamalanabilir, ortam yamalanamaz)."""
    monkeypatch.setattr(config, "HOST_APP", APP)
    monkeypatch.setattr(config, "HOST_DASH", DASH)


def al(client, host, yol):
    return client.get(yol, headers={"host": host}, follow_redirects=False)


# --- iki alan adı modu ----------------------------------------------------


@pytest.mark.parametrize("yol", ["/m", "/m/", "/m/eylemler", "/m/ara"])
def test_app_alan_adinda_m_yolu_404(client, iki_alan, yol):
    assert al(client, APP, yol).status_code == 404


@pytest.mark.parametrize("yol", ["/m", "/m/eylemler"])
def test_dashboard_alan_adinda_m_yolu_404(client, iki_alan, yol):
    """En ciddi sızıntı buydu: mobil yüz masaüstü alan adından açılıyordu."""
    assert al(client, DASH, yol).status_code == 404


def test_app_alan_adinda_mobil_KOKTE(client, iki_alan):
    assert al(client, APP, "/").status_code == 200
    assert al(client, APP, "/eylemler").status_code == 200


def test_masaustu_yollari_app_alan_adinda_yok(client, iki_alan):
    """Ayrım iki yönlü: /gorevler mobil alan adında görünmez (kasten)."""
    assert al(client, APP, "/gorevler").status_code == 404


def test_ortak_yollar_engellenmez(client, iki_alan):
    """/giris önekten muaf — olmasaydı mobil alan adında hiç girilemezdi."""
    assert al(client, APP, "/giris").status_code == 200
    assert al(client, APP, "/static/base.css").status_code == 200


def test_bildirim_adresi_m_icermez(iki_alan):
    assert config.mobil_yol("/") == "/"
    assert config.mobil_yol("/bildirimler") == "/bildirimler"


# --- tek alan adı modu (yedek) --------------------------------------------


def test_alan_adi_yokken_m_TEK_yoldur(client, monkeypatch):
    """Yerel/geliştirme kurulumu: alt alan adı yok, mobil yüze başka türlü
    ulaşılamaz. Bu yüzden orada /m kapatılmıyor."""
    monkeypatch.setattr(config, "HOST_APP", "")
    assert client.get("/m").status_code == 200
    assert config.mobil_yol("/") == "/m"
