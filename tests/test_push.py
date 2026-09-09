"""Web push: abonelik ucu ve gonderim yolu (spec/40-push.md).

Gercek push servisine CIKILMAZ — pywebpush yamalanir. Sinanan sey ag degil,
bizim kararlarimiz: abonelik tekilligi, kimlik zorunlulugu ve OLU ABONELIK
TEMIZLIGI. Sonuncusu spec'te "en sik atlanan sey" diye isaretli, o yuzden
burada acikca sabitleniyor.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import config, db, push  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import test_veritabani  # noqa: E402
    test_veritabani("push")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_tak  # noqa: E402
        csrf_tak(c)
        yield c


@pytest.fixture(autouse=True)
def anahtarlar(monkeypatch):
    """Push'u acik say — gercek anahtar uretmeye gerek yok, imza atilmiyor."""
    monkeypatch.setattr(config, "VAPID_PRIVATE", "test-gizli")
    monkeypatch.setattr(config, "VAPID_PUBLIC", "test-acik")
    yield
    db.x("delete from push_subscriptions")


def kullanici():
    return db.q1("select * from users order by created_at, email limit 1")


def abonelik(uc="https://push.ornek/abc"):
    return {"endpoint": uc, "keys": {"p256dh": "p-anahtari", "auth": "auth-anahtari"}}


class SahteHata(Exception):
    """WebPushException yerine: response.status_code tasiyan en yalin bicim."""

    def __init__(self, kod):
        self.response = type("y", (), {"status_code": kod})()


# --- uclar ----------------------------------------------------------------


def test_vapid_acik_anahtari_verir(client):
    r = client.get("/vapid")
    assert r.status_code == 200
    assert r.json()["publicKey"] == "test-acik"


def test_vapid_gizli_anahtari_SIZDIRMAZ(client):
    assert "test-gizli" not in client.get("/vapid").text


def test_push_kurulmamissa_503(client, monkeypatch):
    """Istemci bunu 'kapali' diye anlar ve dugmeyi hic gostermez."""
    monkeypatch.setattr(config, "VAPID_PUBLIC", "")
    monkeypatch.setattr(config, "VAPID_PRIVATE", "")
    assert client.get("/vapid").status_code == 503
    assert client.post("/abone", json=abonelik()).status_code == 503


def test_abone_kaydeder(client):
    assert client.post("/abone", json=abonelik()).status_code == 200
    satir = db.q1("select * from push_subscriptions where endpoint = %s",
                  ("https://push.ornek/abc",))
    assert satir["user_id"] == kullanici()["id"]
    assert satir["fail_count"] == 0


def test_ayni_endpoint_ikinci_kez_cakismaz(client):
    """Tarayici tekrar abone olunca push servisi AYNI endpoint'i verir;
    upsert olmasaydi benzersizlik hatasi alinirdi."""
    client.post("/abone", json=abonelik())
    r = client.post("/abone", json=abonelik())
    assert r.status_code == 200
    assert db.q1("select count(*) c from push_subscriptions")["c"] == 1


def test_eksik_anahtar_reddedilir(client):
    r = client.post("/abone", json={"endpoint": "https://push.ornek/x", "keys": {}})
    assert r.status_code == 400
    assert db.q1("select count(*) c from push_subscriptions")["c"] == 0


def test_bir_kullanicinin_iki_cihazi_olabilir(client):
    client.post("/abone", json=abonelik("https://push.ornek/telefon"))
    client.post("/abone", json=abonelik("https://push.ornek/dizustu"))
    assert db.q1("select count(*) c from push_subscriptions")["c"] == 2


# --- gonderim -------------------------------------------------------------


def test_gonderim_tum_cihazlara_gider(client, monkeypatch):
    client.post("/abone", json=abonelik("https://push.ornek/1"))
    client.post("/abone", json=abonelik("https://push.ornek/2"))

    gidenler = []
    monkeypatch.setattr("pywebpush.webpush",
                        lambda **kw: gidenler.append(kw["subscription_info"]["endpoint"]))

    sonuc = push.gonder([kullanici()["id"]], "Baslik", "Govde", tag="kart-1")
    assert sonuc["gonderildi"] == 2
    assert sorted(gidenler) == ["https://push.ornek/1", "https://push.ornek/2"]


def test_basarili_gonderim_last_ok_yazar(client, monkeypatch):
    client.post("/abone", json=abonelik())
    monkeypatch.setattr("pywebpush.webpush", lambda **kw: None)
    push.gonder([kullanici()["id"]], "B", "G")
    assert db.q1("select last_ok_at from push_subscriptions")["last_ok_at"] is not None


@pytest.mark.parametrize("kod", [404, 410])
def test_olu_abonelik_SILINIR(client, monkeypatch, kod):
    """404/410: push servisi aboneligi kalici olarak dusurdu, bir daha
    calismayacak. Silinmezse sunucu olu adreslere gondermeye devam eder."""
    client.post("/abone", json=abonelik())

    def patla(**kw):
        raise SahteHata(kod)
    monkeypatch.setattr("pywebpush.webpush", patla)
    monkeypatch.setattr("pywebpush.WebPushException", SahteHata)

    sonuc = push.gonder([kullanici()["id"]], "B", "G")
    assert sonuc["silinen"] == 1
    assert db.q1("select count(*) c from push_subscriptions")["c"] == 0


@pytest.mark.parametrize("kod", [401, 403])
def test_imza_hatasinda_abonelik_SILINMEZ(client, monkeypatch, kod):
    """401/403 aboneligin degil KURULUMUN bozuk oldugunu soyler (VAPID imzasi).
    Satiri silmek hatayi gizler ve herkesin yeniden abone olmasini gerektirir.
    PoC raporundaki en pahali ders: FCM olu endpoint icin 404 donuyor, 401 degil.
    """
    client.post("/abone", json=abonelik())

    def patla(**kw):
        raise SahteHata(kod)
    monkeypatch.setattr("pywebpush.webpush", patla)
    monkeypatch.setattr("pywebpush.WebPushException", SahteHata)

    sonuc = push.gonder([kullanici()["id"]], "B", "G")
    assert sonuc["silinen"] == 0
    assert sonuc["hata"] == 1
    assert db.q1("select fail_count from push_subscriptions")["fail_count"] == 1


def test_ust_uste_hatada_esikte_silinir(client, monkeypatch):
    client.post("/abone", json=abonelik())

    def patla(**kw):
        raise SahteHata(500)
    monkeypatch.setattr("pywebpush.webpush", patla)
    monkeypatch.setattr("pywebpush.WebPushException", SahteHata)

    for _ in range(push.HATA_ESIGI):
        push.gonder([kullanici()["id"]], "B", "G")
    assert db.q1("select count(*) c from push_subscriptions")["c"] == 0


def test_ag_hatasi_abonelige_dokunmaz(client, monkeypatch):
    """DNS/zaman asimi: abonelik saglam olabilir, cezalandirma."""
    client.post("/abone", json=abonelik())

    def patla(**kw):
        raise OSError("baglanti yok")
    monkeypatch.setattr("pywebpush.webpush", patla)

    sonuc = push.gonder([kullanici()["id"]], "B", "G")
    assert sonuc["hata"] == 1
    assert db.q1("select fail_count from push_subscriptions")["fail_count"] == 0


def test_push_kapaliyken_gonderim_sessiz(monkeypatch):
    """Anahtar yoksa uygulama calismaya devam etmeli, patlamamali."""
    monkeypatch.setattr(config, "VAPID_PRIVATE", "")
    assert push.gonder(["00000000-0000-0000-0000-000000000000"], "B", "G") == {
        "gonderildi": 0, "silinen": 0, "hata": 0}


# --- deneme ucu -----------------------------------------------------------
#
# Uc yalnizca EKIPTAKIP_PUSH_TEST=1 iken KAYIT EDILIR. Bu yuzden testler ayri
# bir uygulama ornegi kuruyor: bayrak import aninda okunuyor, sonradan
# yamalanamaz (sahte kimlik rotasiyla ayni desen).


@pytest.fixture(scope="module")
def deneme_istemcisi():
    import importlib
    import os

    from conftest import test_veritabani  # noqa: E402
    test_veritabani("pushdeneme")
    os.environ["EKIPTAKIP_PUSH_TEST"] = "1"
    try:
        import app
        importlib.reload(config)
        importlib.reload(app)
        with TestClient(app.app) as c:
            yield c
    finally:
        os.environ.pop("EKIPTAKIP_PUSH_TEST", None)
        importlib.reload(config)
        import app
        importlib.reload(app)


def test_uc_bayrak_yokken_HIC_YOK():
    """Kapatildiginda 403 degil 404: rota tablosunda bulunmuyor."""
    import app
    yollar = [getattr(r, "path", "") for r in app.app.routes]
    assert "/test/bildirim" not in yollar


def test_deneme_ucu_bildirim_gonderir(deneme_istemcisi, monkeypatch):
    monkeypatch.setattr(config, "VAPID_PRIVATE", "test-gizli")
    monkeypatch.setattr(config, "VAPID_PUBLIC", "test-acik")

    u = db.q1("select * from users order by created_at limit 1")
    push.abone_ol(u["id"], abonelik("https://push.ornek/deneme"))

    gidenler = []
    monkeypatch.setattr("pywebpush.webpush",
                        lambda **kw: gidenler.append(kw["data"]))

    r = deneme_istemcisi.post("/test/bildirim", json={
        "user_id": str(u["id"]), "baslik": "Deneme", "govde": "Merhaba"})
    assert r.status_code == 200, r.text
    assert r.json()["gonderildi"] == 1
    assert "Deneme" in gidenler[0] and "Merhaba" in gidenler[0]
    db.x("delete from push_subscriptions")


def test_deneme_ucu_csrf_ISTEMEZ(deneme_istemcisi, monkeypatch):
    """curl'den cagrilabilmesi bunun sarti; kimlik cerezden gelmiyor."""
    monkeypatch.setattr(config, "VAPID_PRIVATE", "x")
    monkeypatch.setattr(config, "VAPID_PUBLIC", "y")
    r = deneme_istemcisi.post("/test/bildirim", json={"user_id": "bozuk"})
    assert r.status_code == 400          # 403 CSRF DEGIL
    assert "user_id" in r.text


def test_deneme_ucu_abonelik_yoksa_404(deneme_istemcisi, monkeypatch):
    monkeypatch.setattr(config, "VAPID_PRIVATE", "x")
    monkeypatch.setattr(config, "VAPID_PUBLIC", "y")
    db.x("delete from push_subscriptions")
    assert deneme_istemcisi.post("/test/bildirim", json={}).status_code == 404


def test_deneme_ucu_push_kapaliyken_503(deneme_istemcisi, monkeypatch):
    monkeypatch.setattr(config, "VAPID_PRIVATE", "")
    monkeypatch.setattr(config, "VAPID_PUBLIC", "")
    assert deneme_istemcisi.post("/test/bildirim", json={}).status_code == 503


# --- bildirim adresi ------------------------------------------------------


def test_bildirim_adresi_alt_alan_adinda_m_ICERMEZ(client, monkeypatch):
    """Mobil yuz kendi alan adinda KOKTE; '/m' diye bir adres yok."""
    monkeypatch.setattr(config, "HOST_APP", "app.ornek.com")
    client.post("/abone", json=abonelik())

    yukler = []
    monkeypatch.setattr("pywebpush.webpush", lambda **kw: yukler.append(kw["data"]))
    push.gonder([kullanici()["id"]], "B", "G")

    import json as _json
    assert _json.loads(yukler[0])["url"] == "/"


def test_bildirim_adresi_alan_adi_yokken_de_m_ICERMEZ(client, monkeypatch):
    """'/m' diye bir yol yok — hicbir kipte."""
    monkeypatch.setattr(config, "HOST_APP", "")
    client.post("/abone", json=abonelik())

    yukler = []
    monkeypatch.setattr("pywebpush.webpush", lambda **kw: yukler.append(kw["data"]))
    push.gonder([kullanici()["id"]], "B", "G")

    import json as _json
    assert _json.loads(yukler[0])["url"] == "/"


def test_verilen_adres_ezilmez(client, monkeypatch):
    client.post("/abone", json=abonelik())
    yukler = []
    monkeypatch.setattr("pywebpush.webpush", lambda **kw: yukler.append(kw["data"]))
    push.gonder([kullanici()["id"]], "B", "G", url="/kayit/123")

    import json as _json
    assert _json.loads(yukler[0])["url"] == "/kayit/123"
