"""Mobil site (/m): ayni veritabani, ayni yetki, ayri yerlesim.

Yetkinin mobilde de sunucuda uygulandigini dogrular — arayuzde gizlemek yetmez.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import db  # noqa: E402
import seed  # noqa: E402


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    db.DB_PATH = tmp_path_factory.mktemp("db") / "test.db"
    db._conn = None
    seed.run()
    import app  # noqa: E402
    with TestClient(app.app) as c:
        yield c


def users():
    return {u["name"]: u["id"] for u in db.q("select id,name from users")}


def item_by_title(title):
    return db.q1("select * from items where title = ?", (title,))


def test_todo_lists_my_open_items(client):
    r = client.get("/m")
    assert r.status_code == 200
    assert "Bütçe onayı 6 gündür bekliyor" in r.text
    assert 'data-fragment="mobile_todo"' in r.text
    assert "Devam et" in r.text


def test_todo_done_tab_is_separate(client):
    acik = client.get("/m?sekme=acik").text
    kapali = client.get("/m?sekme=kapali").text
    assert "Bütçe onayı 6 gündür bekliyor" in acik
    assert "Bütçe onayı 6 gündür bekliyor" not in kapali


def test_search_uses_fts_and_folds_turkish(client):
    """'butce' -> 'Bütçe': unicode61 remove_diacritics 2. LIKE '%..%' yok."""
    r = client.get("/m/ara?q=butce")
    assert r.status_code == 200 and "Bütçe onayı 6 gündür bekliyor" in r.text
    assert "Tedarikçi teklifleri karşılaştırılamıyor" not in r.text


def test_search_finds_nodes_too(client):
    r = client.get("/m/ara?q=kapak")
    assert "Kapak Ünitesi" in r.text and "Düğümler" in r.text


def test_search_htmx_returns_fragment(client):
    r = client.get("/m/ara?q=sevkiyat", headers={"HX-Request": "true"})
    assert "<html" not in r.text and 'data-fragment="mobile_search"' in r.text


def test_search_ignores_fts_syntax(client):
    """Kullanici metni MATCH ifadesine birlestirilmez — 500 degil bos sonuc."""
    for q in ['"', 'a AND OR *', 'NEAR("x"']:
        assert client.get("/m/ara", params={"q": q}).status_code == 200


def test_actions_group_by_due_date(client):
    r = client.get("/m/eylemler")
    assert r.status_code == 200 and 'data-fragment="mobile_actions"' in r.text


def test_notifications_exclude_my_own_events(client):
    """Bildirim = bana ait kartta BASKASININ yaptigi hareket."""
    u = users()
    client.cookies.set("uid", u["Deniz"])
    r = client.get("/m/bildirimler")
    assert "Selin" in r.text
    assert "Deniz mesaj yazdı" not in r.text
    client.cookies.delete("uid")


def test_item_detail_and_message(client):
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    r = client.get(f"/m/kayit/{it['id']}")
    assert r.status_code == 200 and 'data-fragment="mobile_strip"' in r.text

    before = db.q1("select count(*) c from events where subject_id=?", (it["id"],))["c"]
    r = client.post(f"/m/kayit/{it['id']}/mesaj", data={"body": "mobilden yazdım"},
                    headers={"HX-Request": "true"})
    assert r.status_code == 200 and "mobilden yazdım" in r.text
    assert db.q1("select count(*) c from events where subject_id=?", (it["id"],))["c"] == before + 1


def test_field_change_refreshes_strip_and_feed(client):
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    r = client.patch(f"/m/kayit/{it['id']}/alan", data={"priority": "yuksek"},
                     headers={"HX-Request": "true"})
    assert r.status_code == 200
    assert 'hx-swap-oob="true"' in r.text                       # serit + akis birlikte
    assert item_by_title("Bütçe onayı 6 gündür bekliyor")["priority"] == "yuksek"
    last = db.q1("select * from events where subject_id=? order by created_at desc, rowid desc"
                 " limit 1", (it["id"],))
    assert last["event_type"] == "sistem" and "Kritik → Yüksek" in last["body"]


def test_out_of_scope_is_403_on_mobile_too(client):
    """Efe'nin kapsami Malzeme Temini; Kapak Unitesi karti Uretim Hatti A'da."""
    it = item_by_title("Kapak Ünitesi — tekrar eden kayıp")
    assert "salt okunur" in client.get(f"/m/kayit/{it['id']}").text
    assert client.post(f"/m/kayit/{it['id']}/mesaj", data={"body": "x"}).status_code == 403
    assert client.patch(f"/m/kayit/{it['id']}/alan", data={"status": "kapandi"}).status_code == 403


def test_new_item_respects_scope(client):
    node = db.q1("select id from nodes where name = 'Bütçe Onayı'")
    bad = db.q1("select id from nodes where name = 'Kapak Ünitesi'")
    r = client.post("/m/yeni", data={"node_id": node["id"], "title": "mobilden kayıt"},
                    follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/m/kayit/")
    assert client.post("/m/yeni", data={"node_id": bad["id"], "title": "olmaz"}).status_code == 403
    # kapsam disindaki dal formda hic listelenmez
    assert "Kapak Ünitesi" not in client.get("/m/yeni").text


def test_new_item_is_searchable_immediately(client):
    """FTS trigger'i: insert edilen kayit ayni anda aramada cikar."""
    node = db.q1("select id from nodes where name = 'Bütçe Onayı'")
    client.post("/m/yeni", data={"node_id": node["id"], "title": "vinç halatı yıprandı"},
                follow_redirects=False)
    assert "vinç halatı yıprandı" in client.get("/m/ara?q=vinc").text


def test_pwa_files_are_served(client):
    sw = client.get("/sw.js")
    assert sw.status_code == 200 and sw.headers["service-worker-allowed"] == "/"
    man = client.get("/static/manifest.json")
    assert man.status_code == 200 and '"start_url": "/m"' in man.text
    assert client.get("/static/icon-180.png").status_code == 200
    assert 'rel="apple-touch-icon"' in client.get("/m").text
