"""Kart bloklari, son tarih kapsami, pano pinleri, takim projeksiyonu.

Hepsi ayni turda istenen "ufak tefek isler" batch'i; tek modul tek veritabani
kurar (modul basina `ekiptakip_test_<ad>`, tests/conftest.py).

Kart bloklari ve eylem seridi ARTIK ORTAK sablon (shared/templates/ortak/) ve
uclar app.py'de: burada masaustu yuzunden sinaniyor, mobil ayni uca gidiyor —
mobil yerlesimi tests/test_mobile.py'de.
"""
import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import attachments, cards, config, db, pins, scope, service  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("cards")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_attach  # noqa: E402
        csrf_attach(c)
        yield c


@pytest.fixture(autouse=True)
def _media_root(tmp_path, monkeypatch):
    """Depo agacina hicbir sey yazilmaz (tests/test_attachments.py kalibi)."""
    monkeypatch.setattr(config, "MEDIA_ROOT", str(tmp_path))
    attachments.sync_volume()
    yield


def user(name: str):
    return db.q1("select * from users where name = %s", (name,))


def item_of(title_like: str):
    return db.q1("select * from items where title like %s limit 1", (f"%{title_like}%",))


def png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 160, 90)).save(buf, format="PNG")
    return buf.getvalue()


# --- kart bloklari --------------------------------------------------------


def test_yer_tutucu_ekler_kutusu_gitti_kartlar_geldi(client):
    item = item_of("Bütçe onayı")
    page = client.get(f"/tasks/{item['id']}").text
    assert "saklama kararına bağlı" not in page          # eski 🚧 yer tutucu
    assert 'data-fragment="card_blocks"' in page
    assert "Kart ekle" in page


def test_kart_eklenir_ve_turu_ekranda_gorunur(client):
    item = item_of("Bütçe onayı")
    r = client.post(f"/item/{item['id']}/card", data={"card_type": "meeting"})
    assert r.status_code == 200
    assert "Toplantı planı" in r.text
    assert db.q1("select 1 from item_cards where item_id = %s and card_type = 'meeting'",
                 (item["id"],)) is not None


def test_gecersiz_tur_400(client):
    item = item_of("Bütçe onayı")
    assert client.post(f"/item/{item['id']}/card", data={"card_type": "uydurma"}).status_code == 400


def test_toplanti_alanlari_jsonb_ye_beyaz_listeyle_yazilir(client):
    item = item_of("vekalet")
    client.post(f"/item/{item['id']}/card", data={"card_type": "meeting"})
    card = db.q1("select * from item_cards where item_id = %s order by created_at desc limit 1",
                 (item["id"],))
    r = client.patch(f"/card/{card['id']}", data={
        "title": "Haftalık senkron", "when": "2026-09-20T14:30",
        "place": "Toplantı odası", "agenda": "Vekalet akışı",
        "uydurma_alan": "buraya girmemeli"})
    assert r.status_code == 200
    data = db.q1("select * from item_cards where id = %s", (card["id"],))["data"]
    assert data["place"] == "Toplantı odası"
    assert "uydurma_alan" not in data                    # tanimsiz anahtar jsonb'ye girmez
    assert "20.09.2026 14:30" in r.text                  # ekranda okunur bicim


def test_medya_karti_eki_KARTA_asilir(client):
    """owner_type='item' olsaydi ayni karttaki iki medya blogu ayirt edilemezdi."""
    item = item_of("Tedarikçi teklifleri")
    client.post(f"/item/{item['id']}/card", data={"card_type": "media"})
    card = db.q1("select * from item_cards where item_id = %s order by created_at desc limit 1",
                 (item["id"],))
    r = client.post(f"/card/{card['id']}/media",
                    files={"image": ("kanit.png", png_bytes(), "image/png")})
    assert r.status_code == 200
    ek = db.q1("select * from attachments where owner_type = 'card' and owner_id = %s",
               (card["id"],))
    assert ek is not None
    assert f"/media/{ek['id']}/thumb" in r.text


def test_kart_silinir(client):
    item = item_of("Sevkiyat tarihi")
    client.post(f"/item/{item['id']}/card", data={"card_type": "meeting"})
    card = db.q1("select * from item_cards where item_id = %s limit 1", (item["id"],))
    assert client.delete(f"/card/{card['id']}").status_code == 200
    assert cards.get(card["id"]) is None


def test_yetkisiz_kart_ekleyemez(client):
    """Kart bloklari KARTIN yetkisine uyar, ikinci bir model kurulmaz.

    Efe "Kapak Ünitesi"nde hicbir yolla yetkili degil (tohum: atanan Deniz,
    acan Selin, takim yok, Efe'nin kapsami baska dalda) — tam da bu yuzden
    dogru ornek."""
    item = item_of("Kapak Ünitesi")
    assert client.post(f"/item/{item['id']}/card",
                       data={"card_type": "meeting"}).status_code == 403
    assert client.get(f"/tasks/{item['id']}").text.count("Kart ekle") == 0


# --- son tarih kapsami (edit_deadline) ------------------------------------


def test_son_tarih_kapsamsiz_403(client):
    item = item_of("Bütçe onayı")
    efe = user("Efe")
    onceki = efe["is_admin"]
    db.x("update users set is_admin = false where id = %s", (efe["id"],))
    try:
        r = client.patch(f"/item/{item['id']}/field", data={"due_date": "2026-12-01"})
        assert r.status_code == 403
        assert "edit_deadline" in r.text
        # Diger alanlar ETKILENMEZ: kural yalniz son tarihe ait.
        assert client.patch(f"/item/{item['id']}/field",
                            data={"priority": "high"}).status_code == 200
    finally:
        db.x("update users set is_admin = %s where id = %s", (onceki, efe["id"]))


def test_kapsamla_son_tarih_degisir(client):
    item = item_of("Bütçe onayı")
    efe = user("Efe")
    onceki = efe["is_admin"]
    db.x("update users set is_admin = false where id = %s", (efe["id"],))
    scope.grant_scope(efe["id"], "edit_deadline")
    try:
        assert client.patch(f"/item/{item['id']}/field",
                            data={"due_date": "2026-12-01"}).status_code == 200
        assert str(db.q1("select due_date from items where id = %s",
                         (item["id"],))["due_date"]) == "2026-12-01"
    finally:
        scope.revoke_scope(efe["id"], "edit_deadline")
        db.x("update users set is_admin = %s where id = %s", (onceki, efe["id"]))


def test_eylem_son_tarihi_ayni_kapsami_ister(client):
    """Kural TEK: kayit alani ve eylem ayni cagriyi yapiyor."""
    item = item_of("Bütçe onayı")
    action = db.q1("select * from actions where item_id = %s limit 1", (item["id"],))
    efe = user("Efe")
    onceki = efe["is_admin"]
    db.x("update users set is_admin = false where id = %s", (efe["id"],))
    try:
        assert client.patch(f"/action/{action['id']}",
                            data={"due_date": "2026-12-02"}).status_code == 403
        # durum degistirmek kapsam istemez
        assert client.patch(f"/action/{action['id']}",
                            data={"status": "in_progress"}).status_code == 200
    finally:
        db.x("update users set is_admin = %s where id = %s", (onceki, efe["id"]))


def test_kapsam_katalogda_var(client):
    assert db.q1("select 1 from scopes where name = 'edit_deadline'") is not None
    assert "edit_deadline" in scope.SCOPES


# --- pano pinleri ---------------------------------------------------------


def test_panolarda_her_kartta_pin_var(client):
    page = client.get("/").text
    assert 'data-fragment="panolar"' in page
    assert 'hx-post="/pins/tasks"' in page and 'hx-post="/pins/pivot"' in page


def test_pin_raya_ekler_ve_birakir(client):
    efe = user("Efe")
    assert "pivot" not in pins.slugs(efe["id"])
    client.post("/pins/pivot")
    assert "pivot" in pins.slugs(efe["id"])
    assert "Pivot" in client.get("/tasks").text          # ray bunu cizer

    client.post("/pins/pivot")
    assert "pivot" not in pins.slugs(efe["id"])


def test_varsayilan_pin_kaldirilabilir(client):
    """Bos kume 'varsayilan' demek; ilk degisiklikte varsayilanlar satira
    cevrilmezse 'Gorev Yoneticisi'ni kaldir' hicbir sey yapmazdi."""
    efe = user("Efe")
    assert "tasks" in pins.slugs(efe["id"])
    client.post("/pins/tasks")
    assert "tasks" not in pins.slugs(efe["id"])
    client.post("/pins/tasks")                           # geri al
    assert "tasks" in pins.slugs(efe["id"])


def test_bilinmeyen_modul_pinlenemez(client):
    assert client.post("/pins/uydurma").status_code == 404


# --- takim projeksiyonu ---------------------------------------------------


def test_takim_dugumu_takim_kartini_dogurur(client):
    node = service.add_node("Bakım Ekibi", "team", description="Arıza ve planlı bakım.")
    team = db.q1("select * from teams where node_id = %s", (node["id"],))
    assert team is not None
    assert team["name"] == "Bakım Ekibi"
    assert team["description"] == "Arıza ve planlı bakım."
    assert team["color"]                                 # renk rastgele ama BOS DEGIL
    assert "Bakım Ekibi" in client.get("/teams").text


def test_ayni_adli_ikinci_takim_dugumu_insert_patlatmaz(client):
    """teams.name TEKIL; agacta ayni ad iki dalda serbest."""
    service.add_node("Dolum", "team")
    ikinci = service.add_node("Dolum", "team")
    assert db.q1("select name from teams where node_id = %s", (ikinci["id"],))["name"] == "Dolum (2)"


def test_dugum_adi_degisince_takim_da_degisir(client):
    node = service.add_node("Eski Ad", "team")
    service.update_node(node["id"], name="Yeni Ad", description="tazelendi")
    team = db.q1("select * from teams where node_id = %s", (node["id"],))
    assert team["name"] == "Yeni Ad" and team["description"] == "tazelendi"


def test_takim_sayfasindan_yazma_KAYNAGA_gider(client):
    """Iki arayuz tek gercegi degistirir (spec/72 §5)."""
    node = service.add_node("Ad Testi", "team")
    team = db.q1("select * from teams where node_id = %s", (node["id"],))
    efe = user("Efe")
    assert client.post(f"/team/{team['id']}", data={"name": "X"},
                       follow_redirects=False).status_code == 403      # kapsamsiz giremez
    scope.grant_scope(efe["id"], "manage_teams")
    r = client.post(f"/team/{team['id']}",
                    data={"name": "Ad Testi 2", "description": "sayfadan"}, follow_redirects=False)
    scope.revoke_scope(efe["id"], "manage_teams")
    assert r.status_code == 303
    assert service.TREE.nodes[node["id"]].name == "Ad Testi 2"          # NODE degisti
    assert db.q1("select name from teams where id = %s", (team["id"],))["name"] == "Ad Testi 2"


def test_pasif_takim_dugumu_kartta_soluk(client):
    node = service.add_node("Kapanan Ekip", "team")
    service.set_node_active(node["id"], False)
    satir = next(t for t in service.team_rows() if t["node_id"] == node["id"])
    assert satir["is_active"] is False
    assert "tpasif" in client.get("/teams").text


def test_ekran_adi_takimlar(client):
    """Kullanici istegi: 'Ekipler' -> 'Takımlar'. Rota /teams (Ingilizce) kalir."""
    assert "<h1>Takımlar</h1>" in client.get("/teams").text
    assert ">Ekipler<" not in client.get("/").text
