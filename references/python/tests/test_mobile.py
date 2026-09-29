"""Mobil site: ayni veritabani, ayni yetki, ayri yerlesim.

Mobil yuz KENDI ALAN ADINDA, KOKTE durur — '/m' diye bir yol yoktur. Bu
yuzden istemci app host'una baglaniyor ve yollar kokten yaziliyor.

Yetkinin mobilde de sunucuda uygulandigini dogrular — arayuzde gizlemek yetmez.
"""
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
    setup_database("mobile")
    import app  # noqa: E402
    from shared import config  # noqa: E402

    # Alan adi ayrimi kuruluyken mobil yuz app.<alan> kokunde durur.
    # base_url bu yuzden app host'u: yollar '/m' ile degil kokten yazilir.
    previous = config.HOST_APP
    config.HOST_APP = "app.test"
    with TestClient(app.app, base_url="http://app.test") as c:
        from conftest import csrf_attach  # noqa: E402
        csrf_attach(c)                    # yazma istekleri token tasisin
        yield c
    config.HOST_APP = previous


def users():
    return {u["name"]: str(u["id"]) for u in db.q("select id,name from users")}


def item_by_title(title):
    return db.q1("select * from items where title = %s", (title,))


def test_todo_lists_my_open_items(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "Bütçe onayı 6 gündür bekliyor" in r.text
    assert 'data-fragment="mobile_todo"' in r.text
    assert "Devam et" in r.text


def test_todo_done_tab_is_separate(client):
    open_ = client.get("/?tab=open").text
    closed = client.get("/?tab=closed").text
    assert "Bütçe onayı 6 gündür bekliyor" in open_
    assert "Bütçe onayı 6 gündür bekliyor" not in closed


def test_search_uses_fts_and_folds_turkish(client):
    """'butce' -> 'Bütçe': unicode61 remove_diacritics 2. LIKE '%..%' yok."""
    r = client.get("/search?q=butce")
    assert r.status_code == 200 and "Bütçe onayı 6 gündür bekliyor" in r.text
    assert "Tedarikçi teklifleri karşılaştırılamıyor" not in r.text


def test_search_finds_nodes_too(client):
    r = client.get("/search?q=kapak")
    assert "Kapak Ünitesi" in r.text and "Düğümler" in r.text


def test_search_htmx_returns_fragment(client):
    r = client.get("/search?q=sevkiyat", headers={"HX-Request": "true"})
    assert "<html" not in r.text and 'data-fragment="mobile_search"' in r.text


def test_search_ignores_fts_syntax(client):
    """Kullanici metni MATCH ifadesine birlestirilmez — 500 degil bos sonuc."""
    for q in ['"', 'a AND OR *', 'NEAR("x"']:
        assert client.get("/search", params={"q": q}).status_code == 200


def test_actions_group_by_due_date(client):
    r = client.get("/actions")
    assert r.status_code == 200 and 'data-fragment="mobile_actions"' in r.text


def test_notifications_exclude_my_own_events(client):
    """Bildirim = bana ait kartta BASKASININ yaptigi hareket."""
    u = users()
    client.cookies.set("uid", str(u["Deniz"]))
    r = client.get("/notifications")
    assert "Selin" in r.text
    assert "Deniz mesaj yazdı" not in r.text
    client.cookies.delete("uid")


def test_item_detail_and_message(client):
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    r = client.get(f"/record/{it['id']}")
    assert r.status_code == 200 and 'data-fragment="mobile_strip"' in r.text

    before = db.q1("select count(*) c from events where subject_id=%s", (it["id"],))["c"]
    r = client.post(f"/record/{it['id']}/message", data={"body": "mobilden yazdım"},
                    headers={"HX-Request": "true"})
    assert r.status_code == 200 and "mobilden yazdım" in r.text
    assert db.q1("select count(*) c from events where subject_id=%s", (it["id"],))["c"] == before + 1


def test_field_change_refreshes_strip_and_feed(client):
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    r = client.patch(f"/record/{it['id']}/field", data={"priority": "high"},
                     headers={"HX-Request": "true"})
    assert r.status_code == 200
    assert 'hx-swap-oob="true"' in r.text                       # serit + akis birlikte
    assert item_by_title("Bütçe onayı 6 gündür bekliyor")["priority"] == "high"
    last = db.q1("select * from events where subject_id=%s order by created_at desc"
                 " limit 1", (it["id"],))
    assert last["event_type"] == "system" and "Kritik → Yüksek" in last["body"]


def test_out_of_scope_is_403_on_mobile_too(client):
    """Efe'nin kapsami Malzeme Temini; Kapak Unitesi karti Uretim Hatti A'da."""
    it = item_by_title("Kapak Ünitesi — tekrar eden kayıp")
    assert "salt okunur" in client.get(f"/record/{it['id']}").text
    assert client.post(f"/record/{it['id']}/message", data={"body": "x"}).status_code == 403
    assert client.patch(f"/record/{it['id']}/field", data={"status": "closed"}).status_code == 403


def test_new_item_respects_scope(client):
    node = db.q1("select id from nodes where name = 'Bütçe Onayı'")
    bad = db.q1("select id from nodes where name = 'Kapak Ünitesi'")
    r = client.post("/new", data={"node_id": node["id"], "title": "mobilden kayıt"},
                    follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/record/")
    assert client.post("/new", data={"node_id": bad["id"], "title": "olmaz"}).status_code == 403
    # kapsam disindaki dal formda hic listelenmez
    assert "Kapak Ünitesi" not in client.get("/new").text


def test_new_item_is_searchable_immediately(client):
    """FTS trigger'i: insert edilen kayit ayni anda aramada cikar."""
    node = db.q1("select id from nodes where name = 'Bütçe Onayı'")
    client.post("/new", data={"node_id": node["id"], "title": "vinç halatı yıprandı"},
                follow_redirects=False)
    assert "vinç halatı yıprandı" in client.get("/search?q=vinc").text


def test_pwa_files_are_served(client):
    sw = client.get("/sw.js")
    assert sw.status_code == 200 and sw.headers["service-worker-allowed"] == "/"
    manifest = client.get("/manifest.json")
    # start_url her zaman KOK: manifest hangi alan adindan istendiyse onun
    # kokune isaret eder. Eskiden tek alan adi modunda "/m" donuyordu.
    assert manifest.status_code == 200 and manifest.json()["start_url"] == "/"
    assert client.get("/static/icon-180.png").status_code == 200
    assert 'rel="apple-touch-icon"' in client.get("/").text


# --- kayit ekrani: figure2'nin mobil hali (kullanici istegi) ---------------


def test_mobil_kayit_masaustuyle_ayni_bolumleri_tasir(client):
    """Eskiden mobilde yalniz serit + akis vardi; eylemler ve kart bloklari yoktu."""
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    page = client.get(f"/record/{it['id']}").text
    assert 'data-fragment="mobile_strip"' in page
    assert 'data-fragment="card_actions"' in page          # ORTAK sablon
    assert 'data-fragment="card_blocks"' in page


def test_mobil_serit_yatay_KAYMAZ(client):
    """figure1: `.dstrip` overflow-x:auto idi, sagdaki alanlar gorunmuyordu."""
    css = (ROOT / "sites/mobil/static/mobil.css").read_text(encoding="utf-8")
    kural = css.split(".dstrip{", 1)[1].split("}", 1)[0]
    assert "flex-wrap:wrap" in kural
    assert "overflow-x:auto" not in kural


def test_mobil_sohbet_balondan_acilir(client):
    """Sohbet varsayilan olarak KAPALI; sag alttaki balon aciyor."""
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    page = client.get(f"/record/{it['id']}").text
    assert 'class="chatfab"' in page and 'data-sheet="#sohbet"' in page
    assert 'class="sheet" id="sohbet"' in page
    css = (ROOT / "sites/mobil/static/mobil.css").read_text(encoding="utf-8")
    assert ".sheet{" in css and ".sheet.on{display:flex}" in css


def test_mobil_sohbette_hizli_eylem_dugmesi(client):
    """figure3'teki simsek: sohbet acikken popup, kart ekraninda eski form."""
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    page = client.get(f"/record/{it['id']}").text
    assert 'data-dialog="dlg-hizli-eylem"' in page
    assert 'id="dlg-hizli-eylem"' in page
    assert 'id="yeni-eylem"' in page                        # kartlar ekranindaki form duruyor


def test_mobil_alanlar_dropdown_DEGIL_dialog(client):
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    serit = client.get(f"/record/{it['id']}").text.split('id="serit"', 1)[1].split("</div>", 1)[0]
    assert "<select" not in serit
    assert 'data-dialog="dlg-f-who"' in serit


def test_mobil_ek_iptali_var(client):
    """Ek secildikten sonra gondermeden vazgecmenin yolu yoktu."""
    it = item_by_title("Bütçe onayı 6 gündür bekliyor")
    assert 'data-role="attach-clear"' in client.get(f"/record/{it['id']}").text
