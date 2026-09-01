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
def client():
    from conftest import test_veritabani  # noqa: E402
    test_veritabani("guvenlik")
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
    env.update({"PATH": os.environ["PATH"], "DATABASE_URL": db.DSN})
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
    r = _alt_surec({"EKIPTAKIP_AUTH": "sahte", "EKIPTAKIP_ENV": "gelistirme",
                    "EKIPTAKIP_SECRET_KEY": "k" * 40})
    assert r.returncode == 0, r.stderr[-800:]


def test_sahte_kimlik_acik_bayrak_olmadan_acilmaz():
    """'Yayin oldugunu kanitla' degil 'gelistirme oldugunu kanitla'.

    Tek alan adi modunda kurulan gercek bir sunucuda EKIPTAKIP_ENV yazilmayi
    unutulursa sahte kimlik sessizce acilmamali.
    """
    r = _alt_surec({"EKIPTAKIP_AUTH": "sahte", "EKIPTAKIP_SECRET_KEY": "k" * 40})
    assert r.returncode != 0
    assert "gelistirme" in (r.stderr + r.stdout)


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

    db.x("update users set is_active = false where id = %s", (u["id"],))
    assert client.get("/whoami").json()["name"] != "Selin"    # duser
    db.x("update users set is_active = true where id = %s", (u["id"],))
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
    db.x("update users set google_sub = %s where id = %s", ("gercek-sub", u["id"]))
    bulunan, sebep = kimlik.girebilir(u["email"], "baska-sub")
    assert bulunan is None and sebep == "hesap_uyusmuyor"
    db.x("update users set google_sub = null where id = %s", (u["id"],))


def test_pasif_kullanici_giris_yapamaz():
    u = db.q1("select * from users where name = 'Deniz'")
    db.x("update users set is_active = false where id = %s", (u["id"],))
    bulunan, sebep = kimlik.girebilir(u["email"], "sub-x")
    assert bulunan is None and sebep == "pasif"
    db.x("update users set is_active = true where id = %s", (u["id"],))


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
    """Oturumlu reddin izi kalir."""
    from conftest import csrf_tak

    u = db.q1("select id from users where name = 'Efe'")
    client.post(f"/switch/{u['id']}", follow_redirects=False)   # gercek oturum ac
    csrf_tak(client)
    once = db.q1("select count(*) c from guvenlik_olaylari where tur='yetki_reddi'")["c"]
    it = db.q1("select id from items limit 1")
    client.post(f"/item/{it['id']}/message", data={"body": "x"},
                headers={"X-CSRF-Token": "yanlis"})
    sonra = db.q1("select count(*) c from guvenlik_olaylari where tur='yetki_reddi'")["c"]
    assert sonra == once + 1


def test_kimliksiz_csrf_reddi_denetime_yazilmaz(client):
    """Aksi hâlde kimliksiz istekler denetim tablosunu sinirsiz sisirir.

    Her satir senkron bir veritabani commit'i; ucuz bir yavaslatma vektoru olurdu.
    """
    from conftest import csrf_tak

    client.cookies.clear()                       # oturumsuz
    once = db.q1("select count(*) c from guvenlik_olaylari")["c"]
    for _ in range(5):
        client.post("/cikis", headers={"X-CSRF-Token": "yanlis"})
    assert db.q1("select count(*) c from guvenlik_olaylari")["c"] == once
    csrf_tak(client)


# --- goc (denetim bulgusu B3) ---------------------------------------------


def test_gocler_idempotent_ve_kayitli():
    """Goc kosucusu iki kez calisinca ikinci sefer hicbir sey yapmaz (AC-5).

    Hangi surumun uygulandigi veritabaninda yazili durur; elle alter table
    tahminine gerek kalmaz (spec/80-veritabani.md §4).
    """
    assert db.gocler() == []                       # fixture zaten uygulamisti
    kayit = {r["ad"] for r in db.q("select ad from schema_migrations")}
    assert "001_sema.sql" in kayit


def test_arama_sutunu_kendini_gunceller():
    """tsvector generated column: FTS5'teki uc trigger'in yerini aldi."""
    it = db.q1("select id from items limit 1")
    db.x("update items set title = %s where id = %s", ("vinç halatı yıprandı", it["id"]))
    bulunan = db.q("select title from items where arama @@ to_tsquery('tr', %s)", ("vinc:*",))
    assert any("vinç halatı" in r["title"] for r in bulunan)


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
    once = db.q1("select count(*) c from guvenlik_olaylari where tur=%s", ("yetki_reddi",))["c"]
    r = client.post(f"/item/{it['id']}/message", data={"body": "kapsam disi"})
    assert r.status_code == 403
    assert db.q1("select count(*) c from guvenlik_olaylari where tur=%s", ("yetki_reddi",))["c"] == once + 1
