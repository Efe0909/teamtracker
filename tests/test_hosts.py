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
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("hosts")
    import app as app_mod  # noqa: E402
    from shared import config  # noqa: E402
    previous = (config.HOST_APP, config.HOST_DASH, config.COOKIE_DOMAIN)
    config.HOST_APP, config.HOST_DASH = APP, DASH
    config.COOKIE_DOMAIN = ".polonyum.com"
    with TestClient(app_mod.app) as c:
        from conftest import csrf_attach  # noqa: E402
        csrf_attach(c)
        yield c
    config.HOST_APP, config.HOST_DASH, config.COOKIE_DOMAIN = previous


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
    assert 'href="/record/' in r.text and 'href="/m/record/' not in r.text
    assert 'href="/search"' in r.text and 'href="/m/search"' not in r.text


def test_all_mobile_screens_at_root_on_app_host(client):
    for path, mark in [("/search?q=butce", "Bütçe onayı"),
                       ("/actions", 'data-fragment="mobile_actions"'),
                       ("/notifications", 'data-fragment="mobile_notifs"'),
                       ("/new", "Kaydı aç")]:
        r = app_host(client, path)
        assert r.status_code == 200 and mark in r.text, path


def test_desktop_is_unreachable_from_app_host(client):
    """Iki alan adina ayri Access politikasi yazilabilsin diye kasten 404."""
    for path in ("/tasks", "/pivot", "/panel/tree"):
        assert app_host(client, path).status_code == 404, path


def test_dashboard_host_serves_desktop(client):
    r = dash_host(client, "/")
    assert r.status_code == 200 and "Görev Yöneticisi" in r.text
    assert dash_host(client, "/tasks").status_code == 200


def test_sites_do_not_link_to_each_other(client):
    """Tasarim karari (spec/50-yapi.md): iki site birbirine hyperlink vermez.

    Mobil adresi masaustunde YAZILI durur ama tiklanabilir degil.
    """
    dash = dash_host(client, "/").text
    assert APP in dash                                   # adres gorunuyor
    assert f'href="https://{APP}' not in dash and f'href="http://{APP}' not in dash
    assert f'href="//{APP}' not in dash

    for path in ("/", "/actions", "/notifications"):
        mobile = app_host(client, path).text
        assert DASH not in mobile                         # masaustune iz yok
        assert 'href="/tasks"' not in mobile


def test_shared_paths_work_on_app_host(client):
    for path in ("/sw.js", "/favicon.ico", "/static/base.css", "/static/icon-180.png"):
        assert app_host(client, path).status_code == 200, path


def test_ortak_yollar_host_kapisindan_muaf(client):
    """/login iki alan adinda da acilmali.

    Ortak yollar Host kapisindan MUAF (app.py: mobile_only). Muaf
    olmasalardi mobil alan adindan hic giris yapilamazdi
    (spec/70-guvenlik.md §2.2, KNOW-25).
    """
    for path in ("/login", "/manifest.json", "/whoami"):
        assert app_host(client, path).status_code != 404, path


def test_manifest_start_url_her_zaman_KOK(client):
    """Eskiden dashboard host'unda "/m" donuyordu — ana ekrana eklenen
    uygulama artik 404'e acilan bir adrese gidiyordu."""
    assert app_host(client, "/manifest.json").json()["start_url"] == "/"
    assert dash_host(client, "/manifest.json").json()["start_url"] == "/"


def test_session_cookie_is_configured_for_both_subdomains(client):
    """Kimlik iki alt alan adinda ortak olmali — yoksa kullanici iki kere girer.

    Oturum cerezinin nitelikleri SessionMiddleware'e ACILISTA baglanir; bu yuzden
    fixture'in sonradan yamaladigi COOKIE_DOMAIN cereze yansimaz. Test bu yuzden
    yapilandirmayi ara katman yiginindan okur (spec/70-guvenlik.md §2.4).
    """
    from starlette.middleware.sessions import SessionMiddleware  # noqa: E402

    import app as app_mod  # noqa: E402
    from shared import config  # noqa: E402

    layer = next(m for m in app_mod.app.user_middleware if m.cls is SessionMiddleware)
    kw = layer.kwargs
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

    # Cerezi temizlemek oturumu da siler; CSRF token'i oturumda durdugu icin
    # yeniden alinmali (tarayicida da boyle olur: yeni oturum, yeni token).
    client.cookies.clear()
    from conftest import csrf_attach  # noqa: E402
    csrf_attach(client)


def test_detail_and_write_paths_work_at_root(client):
    it = db.q1("select * from items where title = 'Bütçe onayı 6 gündür bekliyor'")
    assert app_host(client, f"/record/{it['id']}").status_code == 200
    r = client.post(f"/record/{it['id']}/message", data={"body": "kök yoldan"},
                    headers={"host": APP, "HX-Request": "true"})
    assert r.status_code == 200 and "kök yoldan" in r.text
    r = client.post("/new", data={"node_id": db.q1("select id from nodes where name='Bütçe Onayı'")["id"],
                                   "title": "kök yoldan kayıt"},
                    headers={"host": APP}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/record/")   # /m yok


def test_unknown_host_keeps_single_domain_behaviour(client):
    """Bilinmeyen Host masaustu yuzu gorur; /m ILE ULASIM YOK.

    Eskiden bu test '/m 200 doner' diyordu. Kural degisti: alan adi ayrimi
    kuruluyken mobil yuze YALNIZCA app.<alan> kokunden ulasilir. Aksi halde
    'Host: baska.example' yazan biri mobil yuzu yol uzerinden aliyordu — ayrim
    bir arayuz siniri, guvenlik siniri degil, ama ikinci bir adres olmasi
    paylasilan linkleri boluyor ve PWA kapsamini karistiriyordu.
    """
    assert client.get("/m", headers={"host": "baska.example"}).status_code == 404
    assert client.get("/tasks", headers={"host": "baska.example"}).status_code == 200
