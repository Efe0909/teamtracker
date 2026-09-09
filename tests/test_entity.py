"""Varlik (presence): users.last_seen_at ve 'cevrimici' turetimi.

Ayri bir oturum tablosu YOK — cevrimici olmak turetilmis bir soru: son
gorulme yeterince yakin mi. Testler o turetimi ve yazma sikligini sabitler.
"""
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import auth, db  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("entity")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_mark():
    """Yazma kisitlayicisi surec bellegindeki sozluk; testler birbirini
    etkilemesin diye her testten once bosaltilir."""
    auth._last_mark.clear()
    yield
    auth._last_mark.clear()


def first_user():
    return db.q1("select * from users order by created_at, email limit 1")


# --- turetim --------------------------------------------------------------


def test_hic_gorulmemis_kullanici_cevrimici_degil():
    """last_seen_at null — yeni eklenmis, hic girmemis kullanici."""
    assert auth.online({"last_seen_at": None}) is False


def test_az_once_gorulen_cevrimici():
    assert auth.online({"last_seen_at": db.now()}) is True


def test_esikten_eski_cevrimici_degil():
    old = db.now() - auth.ONLINE_THRESHOLD - timedelta(seconds=1)
    assert auth.online({"last_seen_at": old}) is False


def test_esigin_hemen_icindeki_cevrimici():
    recent = db.now() - auth.ONLINE_THRESHOLD + timedelta(seconds=5)
    assert auth.online({"last_seen_at": recent}) is True


# --- yazma ----------------------------------------------------------------


def test_istek_last_seen_yazar(client):
    db.x("update users set last_seen_at = null")
    client.get("/")
    assert first_user()["last_seen_at"] is not None


def test_ard_arda_istekler_her_seferinde_yazmaz(client):
    """current_user her istekte kosuyor; her seferinde UPDATE atmak sayfa
    basina birkac gereksiz yazma olurdu."""
    client.get("/")
    before = first_user()["last_seen_at"]
    for _ in range(3):
        client.get("/")
    assert first_user()["last_seen_at"] == before


def test_aralik_gecince_yeniden_yazar(client):
    client.get("/")
    before = first_user()["last_seen_at"]
    # Kisitlayiciyi geriye al: aralik gecmis gibi davransin.
    for k in list(auth._last_mark):
        auth._last_mark[k] = auth._last_mark[k] - auth._MARK_INTERVAL - timedelta(seconds=1)
    client.get("/")
    assert first_user()["last_seen_at"] > before


def test_giris_yapmamis_istek_yazmaz(client):
    """Kimlik cozulmeyen istek hayat belirtisi sayilmaz."""
    db.x("update users set last_seen_at = null")
    client.get("/static/base.css")
    assert first_user()["last_seen_at"] is None


# --- arayuz ---------------------------------------------------------------


def test_cevrimici_noktasi_baloncukta_gorunur(client):
    """Nokta YALNIZCA .on sinifiyla ciziliyor; cevrimdisi icin gri nokta yok."""
    author = db.q1("select * from users where id <> %s order by created_at limit 1",
                   (first_user()["id"],))
    item = db.q1("select id from items limit 1")
    assert author and item, "tohum verisi gerekli"

    from shared import service
    service.log(item["id"], "message", author["id"], "varlik testi")

    db.x("update users set last_seen_at = %s where id = %s", (db.now(), author["id"]))
    assert 'class="avw on"' in client.get(f"/tasks/{item['id']}").text

    db.x("update users set last_seen_at = %s where id = %s",
         (db.now() - auth.ONLINE_THRESHOLD - timedelta(minutes=1), author["id"]))
    text = client.get(f"/tasks/{item['id']}").text
    assert 'class="avw on"' not in text
    assert 'class="avw"' in text
