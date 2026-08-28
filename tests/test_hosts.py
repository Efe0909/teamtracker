"""Iki alan adi: app.<alan> mobil (kokte), dashboard.<alan> masaustu.

Tek alan adi modunda (ortam degiskeni yok) davranis degismez — bunu da dogrular.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, seed  # noqa: E402

APP = "app.polonyum.com"
DASH = "dashboard.polonyum.com"


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    db.DB_PATH = tmp_path_factory.mktemp("db") / "test.db"
    db._conn = None
    seed.run()
    import app as app_mod  # noqa: E402
    from shared import config  # noqa: E402
    onceki = (config.HOST_APP, config.HOST_DASH, config.COOKIE_DOMAIN)
    config.HOST_APP, config.HOST_DASH = APP, DASH
    config.COOKIE_DOMAIN = ".polonyum.com"
    with TestClient(app_mod.app) as c:
        yield c
    config.HOST_APP, config.HOST_DASH, config.COOKIE_DOMAIN = onceki


def app_host(client, path, **kw):
    return client.get(path, headers={"host": APP}, **kw)


def dash_host(client, path, **kw):
    return client.get(path, headers={"host": DASH}, **kw)


def test_mobile_lives_at_root_on_app_host(client):
    r = app_host(client, "/")
    assert r.status_code == 200 and 'data-fragment="mobile_todo"' in r.text
    assert "Bütçe onayı 6 gündür bekliyor" in r.text


def test_app_host_links_have_no_m_prefix(client):
    r = app_host(client, "/")
    assert 'href="/kayit/' in r.text and 'href="/m/kayit/' not in r.text
    assert 'href="/ara"' in r.text and 'href="/m/ara"' not in r.text


def test_all_mobile_screens_at_root_on_app_host(client):
    for path, mark in [("/ara?q=butce", "Bütçe onayı"),
                       ("/eylemler", 'data-fragment="mobile_actions"'),
                       ("/bildirimler", 'data-fragment="mobile_notifs"'),
                       ("/yeni", "Kaydı aç")]:
        r = app_host(client, path)
        assert r.status_code == 200 and mark in r.text, path


def test_desktop_is_unreachable_from_app_host(client):
    """Iki alan adina ayri Access politikasi yazilabilsin diye kasten 404."""
    for path in ("/gorevler", "/pivot", "/panel/tree"):
        assert app_host(client, path).status_code == 404, path


def test_dashboard_host_serves_desktop(client):
    r = dash_host(client, "/")
    assert r.status_code == 200 and "Görev Yöneticisi" in r.text
    assert dash_host(client, "/gorevler").status_code == 200


def test_sites_do_not_link_to_each_other(client):
    """Tasarim karari (spec/50-yapi.md): iki site birbirine hyperlink vermez.

    Mobil adresi masaustunde YAZILI durur ama tiklanabilir degil.
    """
    dash = dash_host(client, "/").text
    assert APP in dash                                   # adres gorunuyor
    assert f'href="https://{APP}' not in dash and f'href="http://{APP}' not in dash
    assert f'href="//{APP}' not in dash

    for path in ("/", "/eylemler", "/bildirimler"):
        mobil = app_host(client, path).text
        assert DASH not in mobil                         # masaustune iz yok
        assert 'href="/gorevler"' not in mobil


def test_shared_paths_work_on_app_host(client):
    for path in ("/sw.js", "/favicon.ico", "/static/base.css", "/static/icon-180.png"):
        assert app_host(client, path).status_code == 200, path


def test_login_paths_are_not_rewritten_on_app_host(client):
    """/giris mobil onegine girmemeli.

    Girseydi app.<alan>/giris -> /m/giris olur, 404 doner ve mobil alan adindan
    HIC giris yapilamazdi (spec/70-guvenlik.md §2.2).
    """
    for path in ("/giris", "/manifest.json", "/whoami"):
        assert app_host(client, path).status_code != 404, path


def test_manifest_start_url_follows_host(client):
    assert app_host(client, "/manifest.json").json()["start_url"] == "/"
    assert dash_host(client, "/manifest.json").json()["start_url"] == "/m"


def test_session_cookie_is_configured_for_both_subdomains(client):
    """Kimlik iki alt alan adinda ortak olmali — yoksa kullanici iki kere girer.

    Oturum cerezinin nitelikleri SessionMiddleware'e ACILISTA baglanir; bu yuzden
    fixture'in sonradan yamaladigi COOKIE_DOMAIN cereze yansimaz. Test bu yuzden
    yapilandirmayi ara katman yiginindan okur (spec/70-guvenlik.md §2.4).
    """
    from starlette.middleware.sessions import SessionMiddleware  # noqa: E402

    import app as app_mod  # noqa: E402
    from shared import config  # noqa: E402

    katman = next(m for m in app_mod.app.user_middleware if m.cls is SessionMiddleware)
    kw = katman.kwargs
    assert kw["session_cookie"] == config.SESSION_COOKIE
    assert kw["same_site"] == "lax"                  # siteler arasi istek cerezi tasimaz
    assert kw["max_age"] == config.SESSION_MAX_AGE
    assert "domain" in kw                            # config.COOKIE_DOMAIN buradan gecer
    assert kw["secret_key"]                          # imzasiz oturum olmaz


def test_session_survives_across_both_hosts(client):
    """Sahte kimlik modunda oturum acilir; iki alan adinda da ayni kullanici gorunur."""
    uid = db.q1("select id from users where name = 'Selin'")["id"]
    r = client.post(f"/switch/{uid}", headers={"host": APP}, follow_redirects=False)
    assert r.status_code == 303
    assert app_host(client, "/whoami").json()["name"] == "Selin"
    assert dash_host(client, "/whoami").json()["name"] == "Selin"
    client.cookies.clear()


def test_detail_and_write_paths_work_at_root(client):
    it = db.q1("select * from items where title = 'Bütçe onayı 6 gündür bekliyor'")
    assert app_host(client, f"/kayit/{it['id']}").status_code == 200
    r = client.post(f"/kayit/{it['id']}/mesaj", data={"body": "kök yoldan"},
                    headers={"host": APP, "HX-Request": "true"})
    assert r.status_code == 200 and "kök yoldan" in r.text
    r = client.post("/yeni", data={"node_id": db.q1("select id from nodes where name='Bütçe Onayı'")["id"],
                                   "title": "kök yoldan kayıt"},
                    headers={"host": APP}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/kayit/")   # /m yok


def test_unknown_host_keeps_single_domain_behaviour(client):
    """Baska bir Host ile gelen istek eski davranisi gorur: /m ve /gorevler."""
    r = client.get("/m", headers={"host": "baska.example"})
    assert r.status_code == 200 and 'data-fragment="mobile_todo"' in r.text
    assert client.get("/gorevler", headers={"host": "baska.example"}).status_code == 200
