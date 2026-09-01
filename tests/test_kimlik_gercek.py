"""GERCEK kimlik modunda testler (spec/70-guvenlik.md AC-1, 2, 3, 4, 7).

Neden ayri dosya: diger butun testler sahte kimlikle kosuyor, orada
`current_user` asla None donmuyor — yani giris kapisi hic sinanmiyor. Denetimin
"test tabaninin en buyuk kor noktasi" dedigi yer burasi.
"""
import base64
import json
import sys
from pathlib import Path

import itsdangerous
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import config, db, seed  # noqa: E402


@pytest.fixture(scope="module")
def client():
    """AUTH_MODE'u 'google' yapar: sahte kimlik yok, kapi gercekten calisir."""
    from conftest import test_veritabani  # noqa: E402
    test_veritabani("kimlik")
    import app as app_mod  # noqa: E402
    onceki = (config.AUTH_MODE, config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET)
    config.AUTH_MODE = "google"
    config.GOOGLE_CLIENT_ID = config.GOOGLE_CLIENT_ID or "test-istemci"
    config.GOOGLE_CLIENT_SECRET = config.GOOGLE_CLIENT_SECRET or "test-sir"
    with TestClient(app_mod.app) as c:
        yield c
    (config.AUTH_MODE, config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET) = onceki


def oturum_cerezi(veri: dict) -> str:
    """SessionMiddleware'in yazdigi bicimde GECERLI bir oturum cerezi uretir.

    Testin kendisi imzayi taklit ediyor; boylece "giris yapmis kullanici"
    senaryolarini OAuth'a cikmadan kurabiliyoruz.
    """
    imzalayici = itsdangerous.TimestampSigner(str(config.SECRET_KEY))
    ham = base64.b64encode(json.dumps(veri).encode())
    return imzalayici.sign(ham).decode()


def giris_yap(client, kullanici_adi: str = "Efe") -> dict:
    u = db.q1("select * from users where name = %s", (kullanici_adi,))
    client.cookies.clear()
    client.cookies.set(config.cerez_adi(), oturum_cerezi({"uid": str(u["id"]), "sid": "test"}))
    return u


# --- AC-1: oturumsuz istek iceri giremez ---------------------------------


def test_oturumsuz_html_istegi_girise_yonlenir(client):
    client.cookies.clear()
    r = client.get("/gorevler", headers={"accept": "text/html"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/giris")


def test_oturumsuz_htmx_istegi_401_ve_hx_redirect(client):
    client.cookies.clear()
    r = client.get("/panel/tree", headers={"HX-Request": "true"})
    assert r.status_code == 401
    assert r.headers["hx-redirect"].startswith("/giris")


def test_oturumsuz_yazma_401(client):
    client.cookies.clear()
    it = db.q1("select id from items limit 1")
    for yol, metot in ((f"/item/{it['id']}/message", "post"),
                       (f"/m/kayit/{it['id']}/alan", "patch"),
                       ("/item", "post")):
        r = getattr(client, metot)(yol, data={"body": "x"})
        assert r.status_code == 401, yol


def test_korumasiz_yollar_acik_kalir(client):
    client.cookies.clear()
    for yol in ("/giris", "/static/base.css", "/sw.js", "/favicon.ico", "/manifest.json"):
        assert client.get(yol, follow_redirects=False).status_code in (200, 302, 303), yol


def test_switch_ucu_gercek_modda_yok():
    """Sahte kimlik rotasi gercek kurulumda hic TANIMLANMAZ.

    Rota import aninda kosullu kayit ediliyor; bu yuzden ayri surecte sinanir —
    bu test surecinde app zaten sahte modda import edilmisti.
    """
    import os
    import subprocess

    env = {k: v for k, v in os.environ.items() if not k.startswith("EKIPTAKIP_")}
    env.update({"PATH": os.environ["PATH"], "DATABASE_URL": db.DSN,
                "EKIPTAKIP_AUTH": "google", "GOOGLE_CLIENT_ID": "x",
                "GOOGLE_CLIENT_SECRET": "y", "EKIPTAKIP_SECRET_KEY": "k" * 40})
    r = subprocess.run(
        [sys.executable, "-c",
         "import app;"
         "yollar=[getattr(r,'path','') for r in app.app.routes];"
         "print('SWITCH_VAR' if any(y.startswith('/switch') for y in yollar) else 'YOK')"],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    assert "YOK" in r.stdout, r.stdout + r.stderr[-500:]


def test_izin_listesi_onek_hilesine_kapali(client):
    """/{slug} yakalayicisi var; izin listesi tam eslesme olmali."""
    client.cookies.clear()
    for yol in ("/girisXYZ", "/giris-raporu", "/manifest.json.map", "/sw.js.map"):
        r = client.get(yol, headers={"accept": "text/html"}, follow_redirects=False)
        assert r.status_code in (303, 401, 404), yol
        if r.status_code == 200:
            raise AssertionError(f"{yol} kimliksiz acildi")


# --- AC-2: kurcalanan cerez -----------------------------------------------


def test_gecerli_oturum_calisir(client):
    giris_yap(client, "Selin")
    assert client.get("/whoami").json()["name"] == "Selin"


def test_kurcalanan_cerez_oturumu_dusurur(client):
    giris_yap(client, "Selin")
    ad = config.cerez_adi()
    bozuk = client.cookies[ad][:-6] + "aaaaaa"
    client.cookies.clear()
    client.cookies.set(ad, bozuk)
    r = client.get("/gorevler", headers={"accept": "text/html"}, follow_redirects=False)
    assert r.status_code == 303                    # oturum yok sayildi
    assert client.get("/whoami").status_code == 401


def test_uydurma_oturum_imzasiz_gecmez(client):
    """Imzasiz/yanlis anahtarla imzalanmis cerez kabul edilmemeli."""
    u = db.q1("select * from users where name = 'Selin'")
    sahte = itsdangerous.TimestampSigner("baska-anahtar").sign(
        base64.b64encode(json.dumps({"uid": str(u["id"])}).encode())).decode()
    client.cookies.clear()
    client.cookies.set(config.cerez_adi(), sahte)
    assert client.get("/whoami").status_code == 401


# --- AC-4: pasiflestirme --------------------------------------------------


def test_pasif_kullanici_bir_sonraki_istekte_disari(client):
    u = giris_yap(client, "Deniz")
    assert client.get("/whoami").json()["name"] == "Deniz"
    db.x("update users set is_active = false where id = %s", (u["id"],))
    try:
        assert client.get("/whoami").status_code == 401      # ayni cerez, artik gecersiz
    finally:
        db.x("update users set is_active = true where id = %s", (u["id"],))


# --- AC-7: state ----------------------------------------------------------


def test_state_uyusmayan_callback_reddedilir(client):
    client.cookies.clear()
    once = db.q1("select count(*) c from guvenlik_olaylari where tur='giris_reddi'")["c"]
    r = client.get("/giris/callback?code=sahte&state=uydurma", follow_redirects=False)
    assert r.status_code == 400
    assert db.q1("select count(*) c from guvenlik_olaylari where tur='giris_reddi'")["c"] == once + 1


def test_giris_google_a_yonlendirir(client):
    client.cookies.clear()
    r = client.get("/giris", follow_redirects=False)
    assert r.status_code in (302, 303)
    hedef = r.headers["location"]
    assert hedef.startswith("https://accounts.google.com/")
    assert "state=" in hedef and "nonce=" in hedef        # ikisi de authlib'den
    assert "scope=openid+email+profile" in hedef or "scope=openid%20email%20profile" in hedef


# --- CSRF token'i giris sinirinda yenilenir (denetim bulgusu) -------------


def test_csrf_token_giris_sinirinda_yenilenir():
    """Giris oncesi token gecerli kalsaydi cookie tossing ile CSRF delinirdi.

    Saldirgan kimliksiz bir istekle kendi token'ini oturuma bastirip o cerezi
    kurbanin tarayicisina yazdirabiliyordu (alt alan adi paylasimi). Giriste
    oturum komple yenilenince o token cope gidiyor.
    """
    from shared import kimlik

    u = db.q1("select * from users where name = 'Efe'")

    class _Sahte:
        session = {"csrf": "saldirganin-token-i", "sid": "eski", "baska": "sey"}

    kimlik.oturum_ac(_Sahte, u["id"])
    assert "csrf" not in _Sahte.session          # oturum komple temizlendi
    assert "baska" not in _Sahte.session
    assert _Sahte.session["uid"] == str(u["id"])   # oturum JSON: uuid metne cevrilir
    assert _Sahte.session["sid"] != "eski"


def test_cikis_oturumu_komple_temizler():
    from shared import kimlik
    class _Sahte:
        session = {"uid": "x", "csrf": "t", "sid": "s"}
    kimlik.oturum_kapat(_Sahte)
    assert _Sahte.session == {}
