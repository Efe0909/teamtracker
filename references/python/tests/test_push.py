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
    from conftest import setup_database  # noqa: E402
    setup_database("push")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_attach  # noqa: E402
        csrf_attach(c)
        yield c


@pytest.fixture(autouse=True)
def keys(monkeypatch):
    """Push'u acik say — gercek anahtar uretmeye gerek yok, imza atilmiyor."""
    monkeypatch.setattr(config, "VAPID_PRIVATE", "test-gizli")
    monkeypatch.setattr(config, "VAPID_PUBLIC", "test-acik")
    yield
    db.x("delete from push_subscriptions")


def user():
    return db.q1("select * from users order by created_at, email limit 1")


def subscription(endpoint="https://push.ornek/abc"):
    return {"endpoint": endpoint, "keys": {"p256dh": "p-anahtari", "auth": "auth-anahtari"}}


class FakeError(Exception):
    """WebPushException yerine: response.status_code tasiyan en yalin bicim."""

    def __init__(self, code):
        self.response = type("y", (), {"status_code": code})()


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
    assert client.post("/subscribe", json=subscription()).status_code == 503


def test_abone_kaydeder(client):
    assert client.post("/subscribe", json=subscription()).status_code == 200
    row = db.q1("select * from push_subscriptions where endpoint = %s",
                ("https://push.ornek/abc",))
    assert row["user_id"] == user()["id"]
    assert row["fail_count"] == 0


def test_ayni_endpoint_ikinci_kez_cakismaz(client):
    """Tarayici tekrar abone olunca push servisi AYNI endpoint'i verir;
    upsert olmasaydi benzersizlik hatasi alinirdi."""
    client.post("/subscribe", json=subscription())
    r = client.post("/subscribe", json=subscription())
    assert r.status_code == 200
    assert db.q1("select count(*) c from push_subscriptions")["c"] == 1


def test_eksik_anahtar_reddedilir(client):
    r = client.post("/subscribe", json={"endpoint": "https://push.ornek/x", "keys": {}})
    assert r.status_code == 400
    assert db.q1("select count(*) c from push_subscriptions")["c"] == 0


def test_bir_kullanicinin_iki_cihazi_olabilir(client):
    client.post("/subscribe", json=subscription("https://push.ornek/telefon"))
    client.post("/subscribe", json=subscription("https://push.ornek/dizustu"))
    assert db.q1("select count(*) c from push_subscriptions")["c"] == 2


# --- gonderim -------------------------------------------------------------


def test_gonderim_tum_cihazlara_gider(client, monkeypatch):
    client.post("/subscribe", json=subscription("https://push.ornek/1"))
    client.post("/subscribe", json=subscription("https://push.ornek/2"))

    sent = []
    monkeypatch.setattr("pywebpush.webpush",
                        lambda **kw: sent.append(kw["subscription_info"]["endpoint"]))

    result = push.send([user()["id"]], "Baslik", "Govde", tag="kart-1")
    assert result["sent"] == 2
    assert sorted(sent) == ["https://push.ornek/1", "https://push.ornek/2"]


def test_basarili_gonderim_last_ok_yazar(client, monkeypatch):
    client.post("/subscribe", json=subscription())
    monkeypatch.setattr("pywebpush.webpush", lambda **kw: None)
    push.send([user()["id"]], "B", "G")
    assert db.q1("select last_ok_at from push_subscriptions")["last_ok_at"] is not None


@pytest.mark.parametrize("code", [404, 410])
def test_olu_abonelik_SILINIR(client, monkeypatch, code):
    """404/410: push servisi aboneligi kalici olarak dusurdu, bir daha
    calismayacak. Silinmezse sunucu olu adreslere gondermeye devam eder."""
    client.post("/subscribe", json=subscription())

    def boom(**kw):
        raise FakeError(code)
    monkeypatch.setattr("pywebpush.webpush", boom)
    monkeypatch.setattr("pywebpush.WebPushException", FakeError)

    result = push.send([user()["id"]], "B", "G")
    assert result["removed"] == 1
    assert db.q1("select count(*) c from push_subscriptions")["c"] == 0


@pytest.mark.parametrize("code", [401, 403])
def test_imza_hatasinda_abonelik_SILINMEZ(client, monkeypatch, code):
    """401/403 aboneligin degil KURULUMUN bozuk oldugunu soyler (VAPID imzasi).
    Satiri silmek hatayi gizler ve herkesin yeniden abone olmasini gerektirir.
    PoC raporundaki en pahali ders: FCM olu endpoint icin 404 donuyor, 401 degil.
    """
    client.post("/subscribe", json=subscription())

    def boom(**kw):
        raise FakeError(code)
    monkeypatch.setattr("pywebpush.webpush", boom)
    monkeypatch.setattr("pywebpush.WebPushException", FakeError)

    result = push.send([user()["id"]], "B", "G")
    assert result["removed"] == 0
    assert result["failed"] == 1
    assert db.q1("select fail_count from push_subscriptions")["fail_count"] == 1


def test_ust_uste_hatada_esikte_silinir(client, monkeypatch):
    client.post("/subscribe", json=subscription())

    def boom(**kw):
        raise FakeError(500)
    monkeypatch.setattr("pywebpush.webpush", boom)
    monkeypatch.setattr("pywebpush.WebPushException", FakeError)

    for _ in range(push.FAIL_THRESHOLD):
        push.send([user()["id"]], "B", "G")
    assert db.q1("select count(*) c from push_subscriptions")["c"] == 0


def test_ag_hatasi_abonelige_dokunmaz(client, monkeypatch):
    """DNS/zaman asimi: abonelik saglam olabilir, cezalandirma."""
    client.post("/subscribe", json=subscription())

    def boom(**kw):
        raise OSError("baglanti yok")
    monkeypatch.setattr("pywebpush.webpush", boom)

    result = push.send([user()["id"]], "B", "G")
    assert result["failed"] == 1
    assert db.q1("select fail_count from push_subscriptions")["fail_count"] == 0


def test_push_kapaliyken_gonderim_sessiz(monkeypatch):
    """Anahtar yoksa uygulama calismaya devam etmeli, patlamamali."""
    monkeypatch.setattr(config, "VAPID_PRIVATE", "")
    assert push.send(["00000000-0000-0000-0000-000000000000"], "B", "G") == {
        "sent": 0, "removed": 0, "failed": 0}


# --- deneme ucu -----------------------------------------------------------
#
# Uc yalnizca EKIPTAKIP_PUSH_TEST=1 iken KAYIT EDILIR. Bu yuzden testler ayri
# bir uygulama ornegi kuruyor: bayrak import aninda okunuyor, sonradan
# yamalanamaz (sahte kimlik rotasiyla ayni desen).


@pytest.fixture(scope="module")
def test_client():
    import importlib
    import os

    from conftest import setup_database  # noqa: E402
    setup_database("pushtest")
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
    paths = [getattr(r, "path", "") for r in app.app.routes]
    assert "/test/notification" not in paths


def test_deneme_ucu_bildirim_gonderir(test_client, monkeypatch):
    monkeypatch.setattr(config, "VAPID_PRIVATE", "test-gizli")
    monkeypatch.setattr(config, "VAPID_PUBLIC", "test-acik")

    u = db.q1("select * from users order by created_at limit 1")
    push.subscribe(u["id"], subscription("https://push.ornek/deneme"))

    sent = []
    monkeypatch.setattr("pywebpush.webpush",
                        lambda **kw: sent.append(kw["data"]))

    r = test_client.post("/test/notification", json={
        "user_id": str(u["id"]), "baslik": "Deneme", "govde": "Merhaba"})
    assert r.status_code == 200, r.text
    assert r.json()["sent"] == 1
    assert "Deneme" in sent[0] and "Merhaba" in sent[0]
    db.x("delete from push_subscriptions")


def test_deneme_ucu_csrf_ISTEMEZ(test_client, monkeypatch):
    """curl'den cagrilabilmesi bunun sarti; kimlik cerezden gelmiyor."""
    monkeypatch.setattr(config, "VAPID_PRIVATE", "x")
    monkeypatch.setattr(config, "VAPID_PUBLIC", "y")
    r = test_client.post("/test/notification", json={"user_id": "bozuk"})
    assert r.status_code == 400          # 403 CSRF DEGIL
    assert "user_id" in r.text


def test_deneme_ucu_abonelik_yoksa_404(test_client, monkeypatch):
    monkeypatch.setattr(config, "VAPID_PRIVATE", "x")
    monkeypatch.setattr(config, "VAPID_PUBLIC", "y")
    db.x("delete from push_subscriptions")
    assert test_client.post("/test/notification", json={}).status_code == 404


def test_deneme_ucu_push_kapaliyken_503(test_client, monkeypatch):
    monkeypatch.setattr(config, "VAPID_PRIVATE", "")
    monkeypatch.setattr(config, "VAPID_PUBLIC", "")
    assert test_client.post("/test/notification", json={}).status_code == 503


# --- bildirim adresi ------------------------------------------------------


def test_bildirim_adresi_alt_alan_adinda_m_ICERMEZ(client, monkeypatch):
    """Mobil yuz kendi alan adinda KOKTE; '/m' diye bir adres yok."""
    monkeypatch.setattr(config, "HOST_APP", "app.ornek.com")
    client.post("/subscribe", json=subscription())

    payloads = []
    monkeypatch.setattr("pywebpush.webpush", lambda **kw: payloads.append(kw["data"]))
    push.send([user()["id"]], "B", "G")

    import json as _json
    assert _json.loads(payloads[0])["url"] == "/"


def test_bildirim_adresi_alan_adi_yokken_de_m_ICERMEZ(client, monkeypatch):
    """'/m' diye bir yol yok — hicbir kipte."""
    monkeypatch.setattr(config, "HOST_APP", "")
    client.post("/subscribe", json=subscription())

    payloads = []
    monkeypatch.setattr("pywebpush.webpush", lambda **kw: payloads.append(kw["data"]))
    push.send([user()["id"]], "B", "G")

    import json as _json
    assert _json.loads(payloads[0])["url"] == "/"


def test_verilen_adres_ezilmez(client, monkeypatch):
    client.post("/subscribe", json=subscription())
    payloads = []
    monkeypatch.setattr("pywebpush.webpush", lambda **kw: payloads.append(kw["data"]))
    push.send([user()["id"]], "B", "G", url="/record/123")

    import json as _json
    assert _json.loads(payloads[0])["url"] == "/record/123"
