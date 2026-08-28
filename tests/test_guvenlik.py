"""Guvenlik kabul kriterleri (spec/70-guvenlik.md §10) ve denetim bulgulari.

Bu dosya "calisiyor mu" degil "kapali mi" sorusunu sorar: her test bir saldiri
ya da yanlis yapilandirma senaryosudur.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, kimlik, seed  # noqa: E402


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    db.DB_PATH = tmp_path_factory.mktemp("db") / "test.db"
    db._conn = None
    seed.run()
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_tak  # noqa: E402
        csrf_tak(c)
        yield c


def _alt_surec(env_ek: dict) -> subprocess.CompletedProcess:
    """Uygulamayi AYRI SURECTE ac. Acilis kontrolleri ancak boyle sinanir:

    test surecinde bayrak olumculleri uyariya cevirir (bilerek), bu yuzden
    kabul kriteri 8 in-process yazilamaz.
    """
    env = {k: v for k, v in os.environ.items() if not k.startswith("EKIPTAKIP_")}
    env.update({"PATH": os.environ["PATH"], "EKIPTAKIP_DB": str(db.DB_PATH)})
    env.update(env_ek)
    return subprocess.run(
        [sys.executable, "-c",
         "import app;"
         "from fastapi.testclient import TestClient;"
         "c=TestClient(app.app);"
         "c.__enter__()"],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)


# --- yapilandirma: yanlissa ACILMAZ (AC-8) --------------------------------


def test_yayinda_sahte_kimlik_acilmaz():
    r = _alt_surec({"EKIPTAKIP_ENV": "yayin", "EKIPTAKIP_AUTH": "sahte",
                    "EKIPTAKIP_SECRET_KEY": "k" * 40})
    assert r.returncode != 0
    assert "sahte" in (r.stderr + r.stdout)


def test_test_bayragi_yayinda_yok_sayilir():
    """Arka kapi olmasin: test bayragi yayinda olumculleri gizleyemez."""
    r = _alt_surec({"EKIPTAKIP_ENV": "yayin", "EKIPTAKIP_AUTH": "sahte",
                    "EKIPTAKIP_SECRET_KEY": "k" * 40,
                    "EKIPTAKIP_TEST_YAPILANDIRMA": "1"})
    assert r.returncode != 0


def test_gecersiz_auth_modu_acilmaz():
    """Yazim hatasi sessizce gecmemeli — iki mod var, ucuncusu yok."""
    r = _alt_surec({"EKIPTAKIP_AUTH": "oidc", "EKIPTAKIP_SECRET_KEY": "k" * 40})
    assert r.returncode != 0
    assert "EKIPTAKIP_AUTH" in (r.stderr + r.stdout)


def test_yayinda_kisa_anahtar_acilmaz():
    r = _alt_surec({"EKIPTAKIP_ENV": "yayin", "EKIPTAKIP_AUTH": "google",
                    "GOOGLE_CLIENT_ID": "x", "GOOGLE_CLIENT_SECRET": "y",
                    "EKIPTAKIP_SECRET_KEY": "kisa"})
    assert r.returncode != 0


def test_gelistirmede_sahte_kimlik_acilir():
    r = _alt_surec({"EKIPTAKIP_AUTH": "sahte", "EKIPTAKIP_SECRET_KEY": "k" * 40})
    assert r.returncode == 0, r.stderr[-800:]


def test_oturum_anahtari_bos_olamaz():
    """Bos anahtarla imzalanan oturum imzasiz oturumdur."""
    from shared import config
    assert config.SECRET_KEY and len(config.SECRET_KEY) >= 32


# --- oturum ---------------------------------------------------------------


def test_kurcalanan_oturum_cerezi_gecersiz(client):
    """AC-2: imza bozulursa oturumdaki kimlik dusar.

    Selin'e gecilir, cerezin son karakterleri bozulur: sunucu imzayi dogrulayamaz,
    oturum bos gorunur ve kullanici artik Selin degildir.
    """
    from conftest import csrf_tak

    u = db.q1("select * from users where name = 'Selin'")
    client.post(f"/switch/{u['id']}", follow_redirects=False)
    assert client.get("/whoami").json()["name"] == "Selin"

    ad = next(k for k in client.cookies.keys() if "ekiptakip" in k)
    bozuk = client.cookies[ad][:-6] + "aaaaaa"
    client.cookies.clear()
    client.cookies.set(ad, bozuk)
    assert client.get("/whoami").json()["name"] != "Selin"

    client.cookies.clear()
    csrf_tak(client)


def test_pasif_kullanicinin_oturumu_bir_sonraki_istekte_oluh(client):
    """AC-4: is_active=0 -> ayri oturum tablosu olmadan aninda iptal."""
    u = db.q1("select * from users where name = 'Selin'")
    client.post(f"/switch/{u['id']}", follow_redirects=False)
    assert client.get("/whoami").json()["name"] == "Selin"

    db.x("update users set is_active = 0 where id = ?", (u["id"],))
    assert client.get("/whoami").json()["name"] != "Selin"    # duser
    db.x("update users set is_active = 1 where id = ?", (u["id"],))
    client.cookies.clear()
    from conftest import csrf_tak
    csrf_tak(client)


# --- davetli listesi (AC-3) -----------------------------------------------


def test_davetsiz_eposta_giremez_ve_kullanici_olusmaz():
    once = db.q1("select count(*) c from users")["c"]
    user, sebep = kimlik.girebilir("yabanci@ornek.com", "google-sub-yok")
    assert user is None and sebep == "davetsiz"
    assert db.q1("select count(*) c from users")["c"] == once


def test_eposta_buyuk_kucuk_harf_ayirmiyor():
    """Yonetici 'Efe@...' yazarsa Google'in 'efe@...' claim'i eslesmeli."""
    u = db.q1("select * from users where name = 'Efe'")
    bulunan, sebep = kimlik.girebilir(u["email"].upper(), "yeni-sub-1")
    assert sebep is None and bulunan["id"] == u["id"]


def test_ayni_eposta_farkli_google_hesabi_reddedilir():
    """Hesap devralma vektoru: adres geri donusturulmus olabilir."""
    u = db.q1("select * from users where name = 'Deniz'")
    db.x("update users set google_sub = ? where id = ?", ("gercek-sub", u["id"]))
    bulunan, sebep = kimlik.girebilir(u["email"], "baska-sub")
    assert bulunan is None and sebep == "hesap_uyusmuyor"
    db.x("update users set google_sub = null where id = ?", (u["id"],))


def test_pasif_kullanici_giris_yapamaz():
    u = db.q1("select * from users where name = 'Deniz'")
    db.x("update users set is_active = 0 where id = ?", (u["id"],))
    bulunan, sebep = kimlik.girebilir(u["email"], "sub-x")
    assert bulunan is None and sebep == "pasif"
    db.x("update users set is_active = 1 where id = ?", (u["id"],))


def test_donus_adresi_yalnizca_kendi_yolumuz():
    """AC-7: acik yonlendirme kapali."""
    assert kimlik.guvenli_donus("/gorevler") == "/gorevler"
    for kotu in ("https://baska.site/x", "//baska.site", "http://x", None, ""):
        assert kimlik.guvenli_donus(kotu) == "/"


# --- CSRF (AC-5) ----------------------------------------------------------


def test_csrf_token_olmadan_yazma_reddedilir(client):
    it = db.q1("select id from items limit 1")
    r = client.post(f"/item/{it['id']}/message", data={"body": "x"},
                    headers={"X-CSRF-Token": ""})
    assert r.status_code == 403


def test_csrf_yanlis_token_reddedilir(client):
    it = db.q1("select id from items limit 1")
    r = client.post(f"/item/{it['id']}/message", data={"body": "x"},
                    headers={"X-CSRF-Token": "uydurma-token"})
    assert r.status_code == 403


def test_csrf_dogru_token_gecer(client):
    it = db.q1("select id from items where title = 'Bütçe onayı 6 gündür bekliyor'")
    r = client.post(f"/item/{it['id']}/message", data={"body": "csrf ile"})
    assert r.status_code == 200


def test_csrf_form_alaniyla_da_calisir(client):
    """Duz form baslik gonderemez; gizli alan da kabul edilir."""
    token = client.headers["X-CSRF-Token"]
    it = db.q1("select id from items where title = 'Bütçe onayı 6 gündür bekliyor'")
    r = client.post(f"/item/{it['id']}/message",
                    data={"body": "form alanindan", "csrf": token},
                    headers={"X-CSRF-Token": ""})
    assert r.status_code == 200


def test_okuma_istekleri_token_istemez(client):
    assert client.get("/gorevler", headers={"X-CSRF-Token": ""}).status_code == 200


# --- denetim izi (§8) -----------------------------------------------------


def test_csrf_reddi_denetim_izine_yazilir(client):
    once = db.q1("select count(*) c from guvenlik_olaylari where tur='yetki_reddi'")["c"]
    it = db.q1("select id from items limit 1")
    client.post(f"/item/{it['id']}/message", data={"body": "x"},
                headers={"X-CSRF-Token": "yanlis"})
    sonra = db.q1("select count(*) c from guvenlik_olaylari where tur='yetki_reddi'")["c"]
    assert sonra == once + 1


# --- goc (denetim bulgusu B3) ---------------------------------------------


def test_gocler_eski_veritabanina_sutun_ekler(tmp_path):
    """Kurulu bir instance yeni sutunlari almazsa her sayfa 500 verirdi."""
    eski = tmp_path / "eski.db"
    import sqlite3
    with sqlite3.connect(eski) as c:
        c.execute("create table users (id text primary key, email text unique not null,"
                  " name text not null, color text, is_admin integer not null default 0,"
                  " is_editor integer not null default 0, scope_node_id text,"
                  " created_at text not null)")
        c.execute("insert into users values ('1','a@b.c','A',null,0,0,null,'2026-01-01T00:00:00Z')")

    onceki_yol, onceki_conn = db.DB_PATH, db._conn
    db.DB_PATH, db._conn = eski, None
    try:
        yapildi = db.gocler()
        assert "users.is_active" in yapildi and "users.google_sub" in yapildi
        assert db.q1("select is_active from users where id='1'")["is_active"] == 1
        db.x("insert into guvenlik_olaylari (id,created_at,tur) values ('x','t','giris')")
        assert db.gocler() == []          # idempotent
    finally:
        db._conn.close()
        db.DB_PATH, db._conn = onceki_yol, onceki_conn


# --- sertlestirme (AC-9, AC-10, §8) ---------------------------------------


def test_guvenlik_basliklari_uygulamadan_gelir(client):
    """AC-9: nginx olmadan da gecerli olsunlar."""
    r = client.get("/gorevler")
    csp = r.headers["content-security-policy"]
    assert "script-src 'self'" in csp
    assert "unsafe-inline" not in csp.split("style-src")[0]   # script tarafinda YOK
    assert "unsafe-eval" not in csp
    assert "frame-ancestors 'none'" in csp and "form-action 'self'" in csp
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "same-origin"
    assert r.headers["x-frame-options"] == "DENY"


def test_sablonlarda_satir_ici_script_yok():
    """CSP'nin script-src 'self' kalabilmesi buna bagli."""
    for yol in Path(ROOT).rglob("sites/*/templates/**/*.html"):
        metin = yol.read_text(encoding="utf-8")
        assert "<script>" not in metin, yol
        assert "hx-on" not in metin, yol          # htmx onu new Function ile derler


def test_giris_hiz_siniri(client):
    """AC-10: kaba kuvvete karsi dakikada 10 deneme."""
    from shared import sertlestirme
    sertlestirme._gecmis.clear()
    kodlar = [client.get("/giris", follow_redirects=False).status_code for _ in range(12)]
    assert 429 in kodlar
    assert kodlar.index(429) >= sertlestirme.SINIR
    sertlestirme._gecmis.clear()


def test_403_denetim_izine_yazilir(client):
    """AC-6'nin ikinci yarisi: kapsam disi yazma denemesi iz birakir."""
    u = db.q1("select id from users where name = 'Efe'")
    client.post(f"/switch/{u['id']}", follow_redirects=False)
    it = db.q1("select * from items where title = 'Kapak Ünitesi — tekrar eden kayıp'")
    once = db.q1("select count(*) c from guvenlik_olaylari where tur='yetki_reddi'")["c"]
    r = client.post(f"/item/{it['id']}/message", data={"body": "kapsam disi"})
    assert r.status_code == 403
    assert db.q1("select count(*) c from guvenlik_olaylari where tur='yetki_reddi'")["c"] == once + 1
