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
    from conftest import setup_database  # noqa: E402
    setup_database("identity")
    import app as app_mod  # noqa: E402
    previous = (config.AUTH_MODE, config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET)
    config.AUTH_MODE = "google"
    config.GOOGLE_CLIENT_ID = config.GOOGLE_CLIENT_ID or "test-istemci"
    config.GOOGLE_CLIENT_SECRET = config.GOOGLE_CLIENT_SECRET or "test-sir"
    with TestClient(app_mod.app) as c:
        yield c
    (config.AUTH_MODE, config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET) = previous


def session_cookie(data: dict) -> str:
    """SessionMiddleware'in yazdigi bicimde GECERLI bir oturum cerezi uretir.

    Testin kendisi imzayi taklit ediyor; boylece "giris yapmis kullanici"
    senaryolarini OAuth'a cikmadan kurabiliyoruz.
    """
    signer = itsdangerous.TimestampSigner(str(config.SECRET_KEY))
    raw = base64.b64encode(json.dumps(data).encode())
    return signer.sign(raw).decode()


def login(client, user_name: str = "Efe") -> dict:
    u = db.q1("select * from users where name = %s", (user_name,))
    client.cookies.clear()
    client.cookies.set(config.cookie_name(), session_cookie({"uid": str(u["id"]), "sid": "test"}))
    return u


# --- AC-1: oturumsuz istek iceri giremez ---------------------------------


def test_oturumsuz_html_istegi_girise_yonlenir(client):
    client.cookies.clear()
    r = client.get("/tasks", headers={"accept": "text/html"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/login")


def test_oturumsuz_htmx_istegi_401_ve_hx_redirect(client):
    client.cookies.clear()
    r = client.get("/panel/tree", headers={"HX-Request": "true"})
    assert r.status_code == 401
    assert r.headers["hx-redirect"].startswith("/login")


def test_oturumsuz_yazma_401(client):
    client.cookies.clear()
    it = db.q1("select id from items limit 1")
    for path, method in ((f"/item/{it['id']}/message", "post"),
                         (f"/record/{it['id']}/field", "patch"),
                         ("/item", "post")):
        r = getattr(client, method)(path, data={"body": "x"})
        assert r.status_code == 401, path


def test_korumasiz_yollar_acik_kalir(client):
    client.cookies.clear()
    for path in ("/login", "/static/base.css", "/sw.js", "/favicon.ico", "/manifest.json"):
        assert client.get(path, follow_redirects=False).status_code in (200, 302, 303), path


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
         "paths=[getattr(r,'path','') for r in app.app.routes];"
         "print('SWITCH_VAR' if any(p.startswith('/switch') for p in paths) else 'YOK')"],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    assert "YOK" in r.stdout, r.stdout + r.stderr[-500:]


def test_izin_listesi_onek_hilesine_kapali(client):
    """/{slug} yakalayicisi var; izin listesi tam eslesme olmali."""
    client.cookies.clear()
    for path in ("/loginXYZ", "/login-raporu", "/manifest.json.map", "/sw.js.map"):
        r = client.get(path, headers={"accept": "text/html"}, follow_redirects=False)
        assert r.status_code in (303, 401, 404), path
        if r.status_code == 200:
            raise AssertionError(f"{path} kimliksiz acildi")


# --- AC-2: kurcalanan cerez -----------------------------------------------


def test_gecerli_oturum_calisir(client):
    login(client, "Selin")
    assert client.get("/whoami").json()["name"] == "Selin"


def test_kurcalanan_cerez_oturumu_dusurur(client):
    login(client, "Selin")
    name = config.cookie_name()
    tampered = client.cookies[name][:-6] + "aaaaaa"
    client.cookies.clear()
    client.cookies.set(name, tampered)
    r = client.get("/tasks", headers={"accept": "text/html"}, follow_redirects=False)
    assert r.status_code == 303                    # oturum yok sayildi
    assert client.get("/whoami").status_code == 401


def test_uydurma_oturum_imzasiz_gecmez(client):
    """Imzasiz/yanlis anahtarla imzalanmis cerez kabul edilmemeli."""
    u = db.q1("select * from users where name = 'Selin'")
    fake = itsdangerous.TimestampSigner("baska-anahtar").sign(
        base64.b64encode(json.dumps({"uid": str(u["id"])}).encode())).decode()
    client.cookies.clear()
    client.cookies.set(config.cookie_name(), fake)
    assert client.get("/whoami").status_code == 401


# --- AC-4: pasiflestirme --------------------------------------------------


def test_pasif_kullanici_bir_sonraki_istekte_disari(client):
    u = login(client, "Deniz")
    assert client.get("/whoami").json()["name"] == "Deniz"
    db.x("update users set is_active = false where id = %s", (u["id"],))
    try:
        assert client.get("/whoami").status_code == 401      # ayni cerez, artik gecersiz
    finally:
        db.x("update users set is_active = true where id = %s", (u["id"],))


# --- AC-7: state ----------------------------------------------------------


def test_state_uyusmayan_callback_reddedilir(client):
    client.cookies.clear()
    before = db.q1("select count(*) c from security_events where event_type='login_denied'")["c"]
    r = client.get("/login/callback?code=sahte&state=uydurma", follow_redirects=False)
    assert r.status_code == 400
    assert db.q1("select count(*) c from security_events where event_type='login_denied'")["c"] == before + 1


# --- bayat oturum: / <-> /login sonsuz dongusu (regresyon) ---------------
#
# LoginGate `auth.current_user()` ile DB'ye bakar; /login ise eskiden HAM
# oturuma bakiyordu. Ikisi ayrisinca tarayici iki uc arasinda sonsuz donuyor
# ve dongu kendi hiz sinirini tuketip 429'a dusuyordu ("Cok fazla deneme"),
# oysa kimse giris denemesi yapmiyor. Iki tetikleyici de gercek: kullanici
# kapatilinca (yonetim paneli) ve veritabani sifirlaninca.


def _dongu_yok(client, uid: str) -> None:
    """Bu oturumla /login KOKE geri yollamamali — yollarsa dongu baslar."""
    client.cookies.clear()
    client.cookies.set(config.cookie_name(), session_cookie({"uid": uid, "sid": "bayat"}))
    r = client.get("/login?next=/", follow_redirects=False)
    assert r.headers.get("location") != "/", "bayat oturum / <-> /login dongusune sokuyor"
    assert r.status_code in (200, 302, 303)
    if r.status_code in (302, 303):
        assert r.headers["location"].startswith("https://accounts.google.com/")


def test_silinmis_kullanicinin_oturumu_donguye_sokmaz(client):
    """Veritabani sifirlanmis: cerezdeki uid artik hicbir satira denk gelmiyor."""
    _dongu_yok(client, "00000000-0000-4000-8000-000000000000")


def test_kapatilmis_kullanicinin_oturumu_donguye_sokmaz(client):
    """Yonetim panelinden kapatilan kisi (is_active=false) cikisa dusmeli,
    sonsuz yonlendirmeye degil."""
    u = db.q1("select * from users where name = 'Deniz'")
    db.x("update users set is_active = false where id = %s", (u["id"],))
    try:
        _dongu_yok(client, str(u["id"]))
    finally:
        db.x("update users set is_active = true where id = %s", (u["id"],))


def test_gecerli_oturum_hala_koke_doner(client):
    """Duzeltme dogru oturumu bozmasin: gercek kullanici /login'e ugrayinca
    hala hedefe yonlenmeli."""
    u = login(client, "Efe")
    r = client.get("/login?next=/tasks", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/tasks"
    assert u is not None


def test_giris_google_a_yonlendirir(client):
    client.cookies.clear()
    r = client.get("/login", follow_redirects=False)
    assert r.status_code in (302, 303)
    target = r.headers["location"]
    assert target.startswith("https://accounts.google.com/")
    assert "state=" in target and "nonce=" in target        # ikisi de authlib'den
    assert "scope=openid+email+profile" in target or "scope=openid%20email%20profile" in target


# --- CSRF token'i giris sinirinda yenilenir (denetim bulgusu) -------------


def test_csrf_token_giris_sinirinda_yenilenir():
    """Giris oncesi token gecerli kalsaydi cookie tossing ile CSRF delinirdi.

    Saldirgan kimliksiz bir istekle kendi token'ini oturuma bastirip o cerezi
    kurbanin tarayicisina yazdirabiliyordu (alt alan adi paylasimi). Giriste
    oturum komple yenilenince o token cope gidiyor.
    """
    from shared import identity

    u = db.q1("select * from users where name = 'Efe'")

    class _Fake:
        session = {"csrf": "saldirganin-token-i", "sid": "eski", "baska": "sey"}

    identity.open_session(_Fake, u["id"])
    assert "csrf" not in _Fake.session          # oturum komple temizlendi
    assert "baska" not in _Fake.session
    assert _Fake.session["uid"] == str(u["id"])   # oturum JSON: uuid metne cevrilir
    assert _Fake.session["sid"] != "eski"


def test_cikis_oturumu_komple_temizler():
    from shared import identity
    class _Fake:
        session = {"uid": "x", "csrf": "t", "sid": "s"}
    identity.close_session(_Fake)
    assert _Fake.session == {}


# --- bildirim deneme ucu: OTURUMSUZ calismali ----------------------------
#
# Bu uc curl'den cagrilmak icin var; uretimde oturum Google girisinden geliyor
# ve curl ile alinamiyor. Yani "oturumsuz erisilebilir" bir kolaylik degil,
# ucun tek varlik sebebi.
#
# Bir kez ısırdı: uc CSRF muafiyetine eklenmisti ama LoginGate.EXEMPT_EXACT'e
# EKLENMEMISTI. Diger butun testler sahte kimlik kipinde kostugu icin orada
# oturum olmasa da kullanici cozuluyor ve 401 hic gorunmuyordu; uretimde
# ilk curl 401 dondu.


@pytest.fixture(scope="module")
def push_test_client():
    """Gercek kimlik + EKIPTAKIP_PUSH_TEST=1."""
    import importlib
    import os

    from conftest import setup_database  # noqa: E402
    setup_database("identitypush")
    os.environ["EKIPTAKIP_PUSH_TEST"] = "1"
    try:
        importlib.reload(config)
        import app as app_mod
        importlib.reload(app_mod)
        previous = config.AUTH_MODE
        config.AUTH_MODE = "google"
        config.GOOGLE_CLIENT_ID = config.GOOGLE_CLIENT_ID or "test-istemci"
        config.GOOGLE_CLIENT_SECRET = config.GOOGLE_CLIENT_SECRET or "test-sir"
        with TestClient(app_mod.app) as c:
            yield c
        config.AUTH_MODE = previous
    finally:
        os.environ.pop("EKIPTAKIP_PUSH_TEST", None)
        importlib.reload(config)
        import app as app_mod
        importlib.reload(app_mod)


def test_deneme_ucu_OTURUMSUZ_erisilebilir(push_test_client, monkeypatch):
    """401 DONMEMELI — giris kapisi bu ucu gecirmeli."""
    monkeypatch.setattr(config, "VAPID_PRIVATE", "x")
    monkeypatch.setattr(config, "VAPID_PUBLIC", "y")
    r = push_test_client.post("/test/notification", json={"user_id": "bozuk-uuid"})
    assert r.status_code != 401, "giris kapisi ucu kesiyor — curl'den cagrilamaz"
    assert r.status_code == 400          # uc calisti, govdeyi reddetti


def test_deneme_ucu_vapid_yokken_de_401_DEGIL(push_test_client, monkeypatch):
    """Kurulum eksikse 503 der — ama yine giris kapisina takilmaz."""
    monkeypatch.setattr(config, "VAPID_PRIVATE", "")
    monkeypatch.setattr(config, "VAPID_PUBLIC", "")
    r = push_test_client.post("/test/notification", json={})
    assert r.status_code == 503


def test_deneme_ucu_disinda_kapi_hala_kapali(push_test_client):
    """Muafiyet TAM ESLESME: yakin bir yol acilmis olmamali."""
    for path in ("/", "/tasks", "/test/notificationx", "/test/"):
        r = push_test_client.get(path, follow_redirects=False)
        assert r.status_code in (401, 303, 404), path
