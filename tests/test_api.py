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


def test_item_redirects_to_task_page(client):
    """Eski /item ucu kayit sayfasina yonlendirir; sayfa URL'si paylasilabilir (spec/60 2.4)."""
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    r = client.get(f"/item/{it['id']}", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == f"/gorevler/{it['id']}"
    page = client.get(f"/gorevler/{it['id']}").text
    assert 'data-fragment="card_feed"' in page and 'data-fragment="card_actions"' in page


def test_table_fragment_on_htmx(client):
    """Filtre degisince tam sayfa degil yalnizca #sonuc parcasi doner."""
    r = client.get("/gorevler", headers={"HX-Request": "true"})
    assert r.status_code == 200
    assert "<html" not in r.text and 'data-fragment="tablo"' in r.text


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
    """dugum filtresi alt agaci kapsar (tin/tout, shared/filters.DugumFiltre)."""
    node = db.q1("select id from nodes where name = 'Malzeme Temini'")
    r = client.get(f"/gorevler?dugum={node['id']}")
    assert "Bütçe onayı 6 gündür bekliyor" in r.text
    assert "Tedarikçi teklifleri karşılaştırılamıyor" in r.text
    assert "Kapak Ünitesi — tekrar eden kayıp" not in r.text   # baska kok


def test_team_filter(client):
    team = db.q1("select id from teams where name = 'Maliye'")
    r = client.get(f"/gorevler?takim={team['id']}")
    assert "Bütçe onayı 6 gündür bekliyor" in r.text
    assert "Onay akışına vekalet mekanizması ekle" in r.text
    assert "Sevkiyat tarihi etkinlikten sonraya düşüyor" not in r.text  # Satın Alım


def test_quick_filter_overdue_via_action(client):
    """geciken: kaydin kendisi degil, acik bir eyleminin son tarihi gecmis olsa da dusmeli."""
    r = client.get("/gorevler?hizli=geciken")
    assert "Bütçe onayı 6 gündür bekliyor" in r.text        # eylemi dun'e gecikmis
    assert "Kapak Ünitesi — tekrar eden kayıp" not in r.text


def test_quick_filter_my_open_actions(client):
    u = users(client)
    client.cookies.set("uid", u["Deniz"])
    r = client.get("/gorevler?hizli=eylemim")
    assert "Bütçe onayı 6 gündür bekliyor" in r.text        # CFO vekalet eylemi Deniz'de
    assert "Tedarikçi teklifleri karşılaştırılamıyor" not in r.text  # eylemi kapali
    client.cookies.delete("uid")


def test_bad_filter_values_fall_back(client):
    """Gecersiz filtre degeri sorguya sizmaz, sessizce yok sayilir."""
    r = client.get("/gorevler?takim=xx&sirala='; drop table items;--&hizli=bilinmez")
    assert r.status_code == 200
    assert "Bütçe onayı 6 gündür bekliyor" in r.text


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
    # vekalet: Maliye takimi, Deniz uye degil, dahil degil, kapsam disi -> 403
    other = item_by_title("Onay akışına vekalet mekanizması ekle")
    assert client.post(f"/item/{other['id']}/message", data={"body": "x"}).status_code == 403
    client.cookies.delete("uid")


def test_team_membership_beats_scope(client):
    """Kartin takiminin uyesi, dugum kapsam disinda olsa da kartta yetkilidir (spec/20 §2a).

    Teklif karti Satin Alim'da; Deniz uye ama karta dahil degil, kapsami baska agac.
    """
    u = users(client)
    it = item_by_title("Tedarikçi teklifleri karşılaştırılamıyor")
    client.cookies.set("uid", u["Deniz"])
    assert client.post(f"/item/{it['id']}/message", data={"body": "takımdanım"}).status_code == 200
    client.cookies.delete("uid")


def test_actions_crud_and_close_guard(client):
    """Eylem ekle -> kayit kapanamaz -> eylemleri kapat -> kayit kapanir (spec/20 §3a)."""
    it = item_by_title("Sevkiyat tarihi etkinlikten sonraya düşüyor")
    u = users(client)
    r = client.post(f"/item/{it['id']}/eylem", data={"title": "Nakliye planını revize et",
                                                     "assignee_id": u["Deniz"]},
                    headers={"HX-Request": "true"})
    assert r.status_code == 200 and "Nakliye planını revize et" in r.text
    # kayit acik eylem varken kapanamaz
    assert client.patch(f"/item/{it['id']}/field", data={"status": "kapandi"}).status_code == 400
    # tum eylemleri kapat, sonra kayit kapanabilsin
    for a in db.q("select id from actions where item_id=? and status in ('acik','devam')", (it["id"],)):
        assert client.patch(f"/eylem/{a['id']}", data={"status": "kapandi"},
                            headers={"HX-Request": "true"}).status_code == 200
    assert client.patch(f"/item/{it['id']}/field", data={"status": "kapandi"}).status_code == 200
    # sistem olaylari kartin akisina dustu
    son = db.q("select body from events where subject_id=? order by created_at desc limit 5", (it["id"],))
    assert any("eylem" in r["body"] for r in son)


def test_action_endpoints_respect_card_permission(client):
    """Eylem uclari da kart yetkisinden gecer: kapsam disi kullaniciya 403."""
    u = users(client)
    it = item_by_title("Onay akışına vekalet mekanizması ekle")     # Maliye; Deniz disarida
    a = db.q1("select id from actions where item_id = ?", (it["id"],))
    client.cookies.set("uid", u["Deniz"])
    assert client.post(f"/item/{it['id']}/eylem", data={"title": "x"}).status_code == 403
    if a:
        assert client.patch(f"/eylem/{a['id']}", data={"status": "kapandi"}).status_code == 403
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
