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
    from conftest import test_veritabani  # noqa: E402
    test_veritabani("varlik")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        yield c


@pytest.fixture(autouse=True)
def temiz_isaret():
    """Yazma kisitlayicisi surec bellegindeki sozluk; testler birbirini
    etkilemesin diye her testten once bosaltilir."""
    auth._son_isaret.clear()
    yield
    auth._son_isaret.clear()


def ilk_kullanici():
    return db.q1("select * from users order by created_at, email limit 1")


# --- turetim --------------------------------------------------------------


def test_hic_gorulmemis_kullanici_cevrimici_degil():
    """last_seen_at null — yeni eklenmis, hic girmemis kullanici."""
    assert auth.cevrimici({"last_seen_at": None}) is False


def test_az_once_gorulen_cevrimici():
    assert auth.cevrimici({"last_seen_at": db.now()}) is True


def test_esikten_eski_cevrimici_degil():
    eski = db.now() - auth.CEVRIMICI_ESIGI - timedelta(seconds=1)
    assert auth.cevrimici({"last_seen_at": eski}) is False


def test_esigin_hemen_icindeki_cevrimici():
    taze = db.now() - auth.CEVRIMICI_ESIGI + timedelta(seconds=5)
    assert auth.cevrimici({"last_seen_at": taze}) is True


# --- yazma ----------------------------------------------------------------


def test_istek_last_seen_yazar(client):
    db.x("update users set last_seen_at = null")
    client.get("/")
    assert ilk_kullanici()["last_seen_at"] is not None


def test_ard_arda_istekler_her_seferinde_yazmaz(client):
    """current_user her istekte kosuyor; her seferinde UPDATE atmak sayfa
    basina birkac gereksiz yazma olurdu."""
    client.get("/")
    once = ilk_kullanici()["last_seen_at"]
    for _ in range(3):
        client.get("/")
    assert ilk_kullanici()["last_seen_at"] == once


def test_aralik_gecince_yeniden_yazar(client):
    client.get("/")
    once = ilk_kullanici()["last_seen_at"]
    # Kisitlayiciyi geriye al: aralik gecmis gibi davransin.
    for k in list(auth._son_isaret):
        auth._son_isaret[k] = auth._son_isaret[k] - auth._ISARET_ARALIGI - timedelta(seconds=1)
    client.get("/")
    assert ilk_kullanici()["last_seen_at"] > once


def test_giris_yapmamis_istek_yazmaz(client):
    """Kimlik cozulmeyen istek hayat belirtisi sayilmaz."""
    db.x("update users set last_seen_at = null")
    client.get("/static/base.css")
    assert ilk_kullanici()["last_seen_at"] is None


# --- arayuz ---------------------------------------------------------------


def test_cevrimici_noktasi_baloncukta_gorunur(client):
    """Nokta YALNIZCA .on sinifiyla ciziliyor; cevrimdisi icin gri nokta yok."""
    yazar = db.q1("select * from users where id <> %s order by created_at limit 1",
                  (ilk_kullanici()["id"],))
    kayit = db.q1("select id from items limit 1")
    assert yazar and kayit, "tohum verisi gerekli"

    from shared import service
    service.log(kayit["id"], "mesaj", yazar["id"], "varlik testi")

    db.x("update users set last_seen_at = %s where id = %s", (db.now(), yazar["id"]))
    assert 'class="avw on"' in client.get(f"/gorevler/{kayit['id']}").text

    db.x("update users set last_seen_at = %s where id = %s",
         (db.now() - auth.CEVRIMICI_ESIGI - timedelta(minutes=1), yazar["id"]))
    metin = client.get(f"/gorevler/{kayit['id']}").text
    assert 'class="avw on"' not in metin
    assert 'class="avw"' in metin
