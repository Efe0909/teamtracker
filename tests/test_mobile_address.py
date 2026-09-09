"""Mobil yüze YALNIZCA kendi alan adından, kökten erişilir.

`/m` diye bir rota YOKTUR — gizlenmiş değil, tanımlı değil. Mobil rotalar
kökte (`/`, `/search`, `/actions`…), masaüstü rotaları da kökte; ayrım Host'a
göre yapılır (app.py: mobile_only / desktop_only).

Bu dosyadaki "/m" dizgeleri kasıtlı: o yolun ARTIK OLMADIĞINI sınıyorlar.

Kaldırılmadan önce iki sızıntı vardı:
  1. app.<alan>/m aynı içeriğe ikinci bir adresti — paylaşılan link bölünür,
     PWA kapsamı karışır, adres çubuğunda önek sızar.
  2. dashboard.<alan>/m mobil yüzü MASAÜSTÜ alan adından açıyordu; yol yeniden
     yazma yalnızca app host'unda çalıştığı için ham rotalar oradan doğrudan
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
    from conftest import setup_database  # noqa: E402
    setup_database("mobileaddress")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        yield c


@pytest.fixture
def two_hosts(monkeypatch):
    """Alan adlarını MODÜL NİTELİĞİ olarak yamala.

    Ortam değişkeni verilirse in_production() true olur ve sahte kimlik açılışı
    reddedilir; nitelik yaması o kapıyı tetiklemez (shared/config.py'nin
    kendi notu: nitelikler yamalanabilir, ortam yamalanamaz)."""
    monkeypatch.setattr(config, "HOST_APP", APP)
    monkeypatch.setattr(config, "HOST_DASH", DASH)


def get(client, host, path):
    return client.get(path, headers={"host": host}, follow_redirects=False)


# --- iki alan adı modu ----------------------------------------------------


@pytest.mark.parametrize("path", ["/m", "/m/actions", "/m/search", "/m/new"])
def test_app_alan_adinda_m_yolu_404(client, two_hosts, path):
    """'/m' diye bir rota ARTIK YOK — tanimli degil, gizlenmis degil."""
    assert get(client, APP, path).status_code == 404


@pytest.mark.parametrize("path", ["/m", "/m/actions"])
def test_dashboard_alan_adinda_m_yolu_404(client, two_hosts, path):
    """En ciddi sızıntı buydu: mobil yüz masaüstü alan adından açılıyordu."""
    assert get(client, DASH, path).status_code == 404


def test_app_alan_adinda_mobil_KOKTE(client, two_hosts):
    assert get(client, APP, "/").status_code == 200
    assert get(client, APP, "/actions").status_code == 200


def test_masaustu_yollari_app_alan_adinda_yok(client, two_hosts):
    """Ayrım iki yönlü: /tasks mobil alan adında görünmez (kasten)."""
    assert get(client, APP, "/tasks").status_code == 404


def test_ortak_yollar_engellenmez(client, two_hosts):
    """/login önekten muaf — olmasaydı mobil alan adında hiç girilemezdi."""
    assert get(client, APP, "/login").status_code == 200
    assert get(client, APP, "/static/base.css").status_code == 200


def test_bildirim_adresi_m_icermez(two_hosts):
    assert config.mobile_path("/") == "/"
    assert config.mobile_path("/notifications") == "/notifications"


# --- tek alan adı modu (yedek) --------------------------------------------


def test_alan_adi_yokken_de_m_YOK(client, monkeypatch):
    """Tek alan adı kipi kaldırıldı.

    Alan adı değişkeni tanımsızken bile ayrım Host'un ilk etiketine bakar:
    app.localhost mobil, localhost masaüstü. Böylece yapılandırma olmadan da
    iki yüz ayrı adreste durur ve '/m' gibi bir yola gerek kalmaz.
    """
    monkeypatch.setattr(config, "HOST_APP", "")
    assert client.get("/m").status_code == 404
    assert config.mobile_path("/") == "/"


def test_alan_adi_yokken_app_etiketi_mobili_verir(client, monkeypatch):
    """Yerel geliştirme: app.localhost:8000 mobil, localhost:8000 masaüstü."""
    monkeypatch.setattr(config, "HOST_APP", "")
    assert 'data-fragment="mobile_todo"' in get(client, "app.localhost", "/").text
    assert "Görev Yöneticisi" in get(client, "localhost", "/").text
