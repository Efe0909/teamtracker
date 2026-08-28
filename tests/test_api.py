"""Kabul kriterlerinin otomatik karsiligi — ozellikle 403 (yetki sunucuda)."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, seed  # noqa: E402


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    db.DB_PATH = tmp_path_factory.mktemp("db") / "test.db"
    db._conn = None
    seed.run()
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_tak  # noqa: E402
        csrf_tak(c)                    # yazma istekleri token tasisin
        yield c


def users(client):
    return {u["name"]: u["id"] for u in db.q("select id,name from users")}


def item_by_title(title):
    return db.q1("select * from items where title = ?", (title,))


def test_home_lists_modules(client):
    """Ana sayfa modul secimi: hazir olan calisir, digerleri iskele sayfaya gider."""
    r = client.get("/")
    assert r.status_code == 200
    assert "Görev Yöneticisi" in r.text and "Kazanım Ağacı" in r.text
    assert 'href="/gorevler"' in r.text and 'href="/kazanim-agaci"' in r.text
    assert "Bütçe onayı 6 gündür bekliyor" not in r.text        # ana sayfa tablo degil


def test_module_stub_pages(client):
    assert client.get("/kazanim-agaci").status_code == 200
    assert client.get("/pivot").status_code == 200
    assert client.get("/gorevler2").status_code == 404          # kayitli olmayan slug
    r = client.get("/gorevler", follow_redirects=False)          # hazir modul iskele degil
    assert r.status_code == 200 and "Yakında" not in r.text


def test_tasks_lists_my_items(client):
    r = client.get("/gorevler")
    assert r.status_code == 200
    assert "Bütçe onayı 6 gündür bekliyor" in r.text


def test_item_fragment_is_partial(client):
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    r = client.get(f"/item/{it['id']}", headers={"HX-Request": "true"})
    assert r.status_code == 200
    assert "<html" not in r.text and 'data-fragment="card_feed"' in r.text


def test_message_appends_single_event(client):
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    before = db.q1("select count(*) c from events where subject_id=?", (it["id"],))["c"]
    r = client.post(f"/item/{it['id']}/message", data={"body": "test mesajı"},
                    headers={"HX-Request": "true"})
    assert r.status_code == 200 and "test mesajı" in r.text
    assert db.q1("select count(*) c from events where subject_id=?", (it["id"],))["c"] == before + 1


def test_field_change_writes_system_event_and_oob_feed(client):
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    r = client.patch(f"/item/{it['id']}/field", data={"status": "devam"},
                     headers={"HX-Request": "true"})
    assert r.status_code == 200
    assert 'hx-swap-oob="true"' in r.text          # card_fields + card_feed birlikte
    assert item_by_title("Bütçe onayı 6 gündür bekliyor")["status"] == "devam"
    last = db.q1("select * from events where subject_id=? order by created_at desc, rowid desc"
                 " limit 1", (it["id"],))
    assert last["event_type"] == "sistem" and "Açık → Devam" in last["body"]


def test_node_filter_includes_subtree(client):
    node = db.q1("select id from nodes where name = 'Malzeme Temini'")
    r = client.get(f"/node/{node['id']}/items", headers={"HX-Request": "true"})
    assert "Bütçe onayı 6 gündür bekliyor" in r.text
    assert "Tedarikçi teklifleri karşılaştırılamıyor" in r.text
    assert "Kapak Ünitesi — tekrar eden kayıp" not in r.text   # baska kok


def test_out_of_scope_is_403_not_just_hidden(client):
    """Efe'nin kapsami Malzeme Temini; Kapak Unitesi karti Uretim Hatti A'da."""
    u = users(client)
    it = item_by_title("Kapak Ünitesi — tekrar eden kayıp")
    client.cookies.set("uid", u["Efe"])
    frag = client.get(f"/item/{it['id']}", headers={"HX-Request": "true"}).text
    assert "salt okunur" in frag                                  # arayuzde kilitli
    assert client.patch(f"/item/{it['id']}/field", data={"status": "kapandi"}).status_code == 403
    assert client.post(f"/item/{it['id']}/message", data={"body": "x"}).status_code == 403
    assert item_by_title("Kapak Ünitesi — tekrar eden kayıp")["status"] == "beklemede"


def test_admin_can_edit_anything(client):
    u = users(client)
    it = item_by_title("Kapak Ünitesi — tekrar eden kayıp")
    client.cookies.set("uid", u["Selin"])                          # admin
    assert client.patch(f"/item/{it['id']}/field", data={"priority": "kritik"}).status_code == 200
    client.cookies.delete("uid")


def test_participant_beats_scope(client):
    """Deniz'in kapsami Uretim Hatti A ama Butce Onayi kartina dahil edilmis."""
    u = users(client)
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    client.cookies.set("uid", u["Deniz"])
    assert client.post(f"/item/{it['id']}/message", data={"body": "dahilim"}).status_code == 200
    other = item_by_title("Tedarikçi teklifleri karşılaştırılamıyor")   # dahil degil
    assert client.post(f"/item/{other['id']}/message", data={"body": "x"}).status_code == 403
    client.cookies.delete("uid")


def test_create_requires_node_and_scope(client):
    node = db.q1("select id from nodes where name = 'Bütçe Onayı'")
    bad = db.q1("select id from nodes where name = 'Kapak Ünitesi'")
    assert client.post("/item", data={"title": "yeni", "node_id": node["id"]}).status_code == 200
    assert client.post("/item", data={"title": "yeni", "node_id": bad["id"]}).status_code == 403
    assert client.post("/item", data={"title": "yeni", "node_id": "yok"}).status_code == 400


def test_whoami_and_switch(client):
    u = users(client)
    assert client.get("/whoami").json()["name"] == "Efe"
    client.post(f"/switch/{u['Selin']}", follow_redirects=False)
    assert client.get("/whoami").json()["is_admin"] is True
    client.cookies.delete("uid")
