"""Kabul kriterlerinin otomatik karsiligi — ozellikle 403 (yetki sunucuda)."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, seed  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("api")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_attach  # noqa: E402
        csrf_attach(c)                    # yazma istekleri token tasisin
        yield c


def users(client):
    return {u["name"]: str(u["id"]) for u in db.q("select id,name from users")}


def item_by_title(title):
    return db.q1("select * from items where title = %s", (title,))


def test_home_lists_modules(client):
    """Ana sayfa modul secimi: hazir olan calisir, digerleri iskele sayfaya gider."""
    r = client.get("/")
    assert r.status_code == 200
    assert "Görev Yöneticisi" in r.text and "Veri Yönetimi" in r.text
    assert 'href="/tasks"' in r.text and 'href="/outcome-tree"' in r.text
    assert "Bütçe onayı 6 gündür bekliyor" not in r.text        # ana sayfa tablo degil


def test_module_stub_pages(client):
    assert client.get("/outcome-tree").status_code == 200
    assert client.get("/pivot").status_code == 200
    assert client.get("/tasks2").status_code == 404          # kayitli olmayan slug
    r = client.get("/tasks", follow_redirects=False)          # hazir modul iskele degil
    assert r.status_code == 200 and "Yakında" not in r.text


def test_tasks_lists_my_items(client):
    r = client.get("/tasks")
    assert r.status_code == 200
    assert "Bütçe onayı 6 gündür bekliyor" in r.text


def test_item_redirects_to_task_page(client):
    """Eski /item ucu kayit sayfasina yonlendirir; sayfa URL'si paylasilabilir (spec/60 2.4)."""
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    r = client.get(f"/item/{it['id']}", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == f"/tasks/{it['id']}"
    page = client.get(f"/tasks/{it['id']}").text
    assert 'data-fragment="card_feed"' in page and 'data-fragment="card_actions"' in page


def test_table_fragment_on_htmx(client):
    """Filtre degisince tam sayfa degil yalnizca #sonuc parcasi doner."""
    r = client.get("/tasks", headers={"HX-Request": "true"})
    assert r.status_code == 200
    assert "<html" not in r.text and 'data-fragment="tablo"' in r.text


def test_message_appends_single_event(client):
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    before = db.q1("select count(*) c from events where subject_id=%s", (it["id"],))["c"]
    r = client.post(f"/item/{it['id']}/message", data={"body": "test mesajı"},
                    headers={"HX-Request": "true"})
    assert r.status_code == 200 and "test mesajı" in r.text
    assert db.q1("select count(*) c from events where subject_id=%s", (it["id"],))["c"] == before + 1


def test_field_change_writes_system_event_and_oob_feed(client):
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    r = client.patch(f"/item/{it['id']}/field", data={"status": "in_progress"},
                     headers={"HX-Request": "true"})
    assert r.status_code == 200
    assert 'hx-swap-oob="true"' in r.text          # card_fields + card_feed birlikte
    assert item_by_title("Bütçe onayı 6 gündür bekliyor")["status"] == "in_progress"
    last = db.q1("select * from events where subject_id=%s order by created_at desc"
                 " limit 1", (it["id"],))
    assert last["event_type"] == "system" and "Açık → Devam" in last["body"]


def test_node_filter_includes_subtree(client):
    """dugum filtresi alt agaci kapsar (tin/tout, shared/filters.NodeFilter)."""
    node = db.q1("select id from nodes where name = 'Malzeme Temini'")
    r = client.get(f"/tasks?node={node['id']}")
    assert "Bütçe onayı 6 gündür bekliyor" in r.text
    assert "Tedarikçi teklifleri karşılaştırılamıyor" in r.text
    assert "Kapak Ünitesi — tekrar eden kayıp" not in r.text   # baska kok


def test_pillar_ortogonal_sutun(client):
    """Eski serbest metin `items.pillar` gitti (goc 011) ve GERI GELMEDI;
    yerine agactaki pillar node'una bakan bir FK var (goc 012)."""
    assert db.q1("select 1 from information_schema.columns where table_name='items'"
                 " and column_name='pillar'") is None
    assert db.q1("select 1 from information_schema.columns where table_name='items'"
                 " and column_name='pillar_node_id'") is not None
    assert ">Pillar<" in client.get("/tasks").text


def test_team_filter(client):
    team = db.q1("select id from teams where name = 'Maliye'")
    r = client.get(f"/tasks?team={team['id']}")
    assert "Bütçe onayı 6 gündür bekliyor" in r.text
    assert "Onay akışına vekalet mekanizması ekle" in r.text
    assert "Sevkiyat tarihi etkinlikten sonraya düşüyor" not in r.text  # Satın Alım


def test_quick_filter_overdue_via_action(client):
    """geciken: kaydin kendisi degil, acik bir eyleminin son tarihi gecmis olsa da dusmeli."""
    r = client.get("/tasks?quick=overdue")
    assert "Bütçe onayı 6 gündür bekliyor" in r.text        # eylemi dun'e gecikmis
    assert "Kapak Ünitesi — tekrar eden kayıp" not in r.text


def test_quick_filter_my_open_actions(client):
    u = users(client)
    client.cookies.set("uid", u["Deniz"])
    r = client.get("/tasks?quick=my_actions")
    assert "Bütçe onayı 6 gündür bekliyor" in r.text        # CFO vekalet eylemi Deniz'de
    assert "Tedarikçi teklifleri karşılaştırılamıyor" not in r.text  # eylemi kapali
    client.cookies.delete("uid")


def test_bad_filter_values_fall_back(client):
    """Gecersiz filtre degeri sorguya sizmaz, sessizce yok sayilir."""
    r = client.get("/tasks?team=xx&sort='; drop table items;--&quick=bilinmez")
    assert r.status_code == 200
    assert "Bütçe onayı 6 gündür bekliyor" in r.text


def test_out_of_scope_is_403_not_just_hidden(client):
    """Efe'nin kapsami Malzeme Temini; Kapak Unitesi karti Uretim Hatti A'da."""
    u = users(client)
    it = item_by_title("Kapak Ünitesi — tekrar eden kayıp")
    client.cookies.set("uid", str(u["Efe"]))
    frag = client.get(f"/item/{it['id']}", headers={"HX-Request": "true"}).text
    assert "salt okunur" in frag                                  # arayuzde kilitli
    assert client.patch(f"/item/{it['id']}/field", data={"status": "closed"}).status_code == 403
    assert client.post(f"/item/{it['id']}/message", data={"body": "x"}).status_code == 403
    assert item_by_title("Kapak Ünitesi — tekrar eden kayıp")["status"] == "pending"


def test_admin_can_edit_anything(client):
    u = users(client)
    it = item_by_title("Kapak Ünitesi — tekrar eden kayıp")
    client.cookies.set("uid", str(u["Selin"]))                          # admin
    assert client.patch(f"/item/{it['id']}/field", data={"priority": "critical"}).status_code == 200
    client.cookies.delete("uid")


def test_participant_beats_scope(client):
    """Deniz'in kapsami Uretim Hatti A ama Butce Onayi kartina dahil edilmis."""
    u = users(client)
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    client.cookies.set("uid", str(u["Deniz"]))
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
    r = client.post(f"/item/{it['id']}/action", data={"title": "Nakliye planını revize et",
                                                       "assignee_id": u["Deniz"]},
                    headers={"HX-Request": "true"})
    assert r.status_code == 200 and "Nakliye planını revize et" in r.text
    # kayit acik eylem varken kapanamaz
    assert client.patch(f"/item/{it['id']}/field", data={"status": "closed"}).status_code == 400
    # tum eylemleri kapat, sonra kayit kapanabilsin
    for a in db.q("select id from actions where item_id=%s and status in ('open','in_progress')", (it["id"],)):
        assert client.patch(f"/action/{a['id']}", data={"status": "closed"},
                            headers={"HX-Request": "true"}).status_code == 200
    assert client.patch(f"/item/{it['id']}/field", data={"status": "closed"}).status_code == 200
    # sistem olaylari kartin akisina dustu
    recent = db.q("select body from events where subject_id=%s order by created_at desc limit 5", (it["id"],))
    assert any("eylem" in r["body"] for r in recent)


def test_action_endpoints_respect_card_permission(client):
    """Eylem uclari da kart yetkisinden gecer: kapsam disi kullaniciya 403."""
    u = users(client)
    it = item_by_title("Onay akışına vekalet mekanizması ekle")     # Maliye; Deniz disarida
    a = db.q1("select id from actions where item_id = %s", (it["id"],))
    client.cookies.set("uid", u["Deniz"])
    assert client.post(f"/item/{it['id']}/action", data={"title": "x"}).status_code == 403
    if a:
        assert client.patch(f"/action/{a['id']}", data={"status": "closed"}).status_code == 403
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


# --- kompozer ve alan dialoglari (kullanici istegi, figure2) ----------------


def test_kompozerde_ek_iptali_var(client):
    """Dosya secildikten sonra gondermeden vazgecmenin yolu yoktu."""
    it = db.q1("select id from items limit 1")
    page = client.get(f"/tasks/{it['id']}").text
    assert 'data-role="attach-clear"' in page
    js = (ROOT / "shared/static/ortak.js").read_text(encoding="utf-8")
    assert "attach-clear" in js and "ekTemizle" in js


def test_alanlar_dropdown_DEGIL_dialog(client):
    """Bir <select> tek dokunusla sorumluyu degistiriyordu; artik iki adim."""
    it = db.q1("select id from items limit 1")
    serit = client.get(f"/tasks/{it['id']}").text.split('id="fields"', 1)[1] \
                  .split('data-fragment="card_actions"', 1)[0]
    assert "<select" not in serit                      # dropdown kalmadi
    assert 'data-dialog="dlg-f-who"' in serit          # tetikleyici
    assert 'id="dlg-f-who"' in serit                   # ve dialogun kendisi


def test_sohbette_hizli_eylem_simsegi(client):
    it = db.q1("select id from items limit 1")
    page = client.get(f"/tasks/{it['id']}").text
    assert 'class="simsek" data-dialog="dlg-hizli-eylem"' in page


def test_alan_degisimi_zaman_damgali_bildirim_birakir(client, csrf):
    """Dialogla degistirmek de akisa sistem olayi yaziyor (kullanici istegi)."""
    it = db.q1("select id from items where status <> 'closed' limit 1")
    client.patch(f"/item/{it['id']}/field", data={"priority": "low"},
                 headers={"HX-Request": "true"})
    son = db.q1("select * from events where subject_id = %s order by created_at desc limit 1",
                (it["id"],))
    assert son["event_type"] == "system" and "önceliği" in son["body"]
    assert son["created_at"] is not None


def test_sorumlu_ve_takim_degisikligi_gercekten_yaziliyor(client, csrf):
    """Formdan gelen METIN, sutun UUID: cevrim yapilmazsa users_by_id()
    sozlugunde (UUID anahtarli) hicbir sey eslesmez ve her atama sessizce
    400 'kullanici yok' donerdi."""
    it = db.q1("select id from items limit 1")
    hedef = db.q1("select id from users where is_active order by name limit 1")
    takim = db.q1("select id from teams order by name limit 1")

    r = client.patch(f"/item/{it['id']}/field", data={"assignee_id": str(hedef["id"])},
                     headers={"HX-Request": "true"})
    assert r.status_code == 200
    assert db.q1("select assignee_id from items where id = %s", (it["id"],))["assignee_id"] == hedef["id"]

    r = client.patch(f"/item/{it['id']}/field", data={"team_id": str(takim["id"])},
                     headers={"HX-Request": "true"})
    assert r.status_code == 200
    assert db.q1("select team_id from items where id = %s", (it["id"],))["team_id"] == takim["id"]

    # Bozuk metin alani SESSIZCE bosaltmaz.
    assert client.patch(f"/item/{it['id']}/field", data={"assignee_id": "abc"},
                        headers={"HX-Request": "true"}).status_code == 400
    assert db.q1("select assignee_id from items where id = %s", (it["id"],))["assignee_id"] == hedef["id"]


def test_pillar_karttan_secilir(client, csrf):
    from shared import service
    pillar = service.add_node("SN", "pillar")
    it = db.q1("select id from items limit 1")
    r = client.patch(f"/item/{it['id']}/field", data={"pillar_node_id": str(pillar["id"])},
                     headers={"HX-Request": "true"})
    assert r.status_code == 200
    assert db.q1("select pillar_node_id from items where id = %s",
                 (it["id"],))["pillar_node_id"] == pillar["id"]
    # Pillar OLMAYAN bir dugum buraya yazilamaz.
    baska = service.add_node("SN-degil", "generic")
    assert client.patch(f"/item/{it['id']}/field", data={"pillar_node_id": str(baska["id"])},
                        headers={"HX-Request": "true"}).status_code == 400
