"""Veri yonetimi: dugum ekle / adlandir / tasi / sil.

Agac SUREC BELLEGINDE (shared/tree.py) ve yalnizca acilista kuruluyordu; her
degisiklikten sonra yeniden kurulmazsa ekran bayat kalir. Testlerin yarisi tam
bunu sabitliyor: veritabani degisti mi YETMEZ, TREE de degismis olmali.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, service  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("datamanagement")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_attach  # noqa: E402
        csrf_attach(c)
        yield c


@pytest.fixture(autouse=True)
def _tree(client):
    """Her test tohum agaciyla baslasin."""
    yield
    # Desen PARAMETRE olarak gecer: satir ici yazilirsa psycopg '%'' yi kendi
    # yer tutucusu sanip "only '%s', '%b', '%t' are allowed" der.
    db.x("delete from nodes where name like %s", ("T-%",))
    service.rebuild_tree()


def _switch(client, user_id):
    """Kullanici degistir VE CSRF token'ini tazele — switch oturumu
    temizledigi icin eski token gecersiz kalir ve 403'u YETKI degil CSRF
    uretir."""
    from conftest import csrf_attach
    client.post(f"/switch/{user_id}", follow_redirects=False)
    csrf_attach(client)


def root_count():
    return len(service.TREE.roots)


# --- ekleme ---------------------------------------------------------------


def test_kok_dugum_eklenir(client):
    before = root_count()
    row = service.add_node("T-Maliye", "generic")
    assert row is not None
    assert row["parent_id"] is None
    # Veritabani DEGIL, bellekteki agac da bilmeli:
    assert root_count() == before + 1
    assert row["id"] in service.TREE.nodes
    assert row["id"] in service.TREE.roots


def test_alt_dugum_eklenir(client):
    parent = service.add_node("T-Ust", "generic")
    child = service.add_node("T-Alt", "step", parent_id=parent["id"])
    assert service.TREE.parent[child["id"]] == parent["id"]
    assert child["id"] in service.TREE.children[parent["id"]]
    assert service.TREE.depth[child["id"]] == service.TREE.depth[parent["id"]] + 1


def test_aciklama_kaydedilir(client):
    d = service.add_node("T-Aciklamali", "generic", description="  Bütçe ve ödemeler  ")
    assert d["description"] == "Bütçe ve ödemeler"      # kirpilir


def test_adsiz_dugum_reddedilir(client):
    assert service.add_node("   ", "generic") is None
    assert service.add_node("T-X", "  ") is None


def test_olmayan_ustun_altina_eklenmez(client):
    assert service.add_node("T-Yetim", "step",
                            parent_id="00000000-0000-0000-0000-000000000000") is None


def test_kardesler_sona_eklenir(client):
    parent = service.add_node("T-Sira", "generic")
    a = service.add_node("T-Bir", "step", parent_id=parent["id"])
    b = service.add_node("T-Iki", "step", parent_id=parent["id"])
    assert b["sort_order"] > a["sort_order"]
    assert service.TREE.children[parent["id"]] == [a["id"], b["id"]]


# --- guncelleme -----------------------------------------------------------


def test_ad_degisir_ve_agac_taze_kalir(client):
    d = service.add_node("T-Eski", "generic")
    assert service.update_node(d["id"], name="T-Yeni")
    assert service.TREE.name(d["id"]) == "T-Yeni"


def test_verilmeyen_alan_degismez(client):
    d = service.add_node("T-Kismi", "generic", description="kalsin")
    service.update_node(d["id"], name="T-Kismi2")
    row = db.q1("select * from nodes where id = %s", (d["id"],))
    assert row["description"] == "kalsin"
    assert row["node_type"] == "generic"


def test_bos_aciklama_temizler(client):
    d = service.add_node("T-Temiz", "generic", description="silinecek")
    service.update_node(d["id"], description="")
    assert db.q1("select description from nodes where id = %s", (d["id"],))["description"] is None


def test_bos_ad_reddedilir(client):
    d = service.add_node("T-Kalici", "generic")
    assert service.update_node(d["id"], name="  ") is False
    assert service.TREE.name(d["id"]) == "T-Kalici"


# --- tasima ---------------------------------------------------------------


def test_dugum_tasinir(client):
    a = service.add_node("T-A", "generic")
    b = service.add_node("T-B", "generic")
    child = service.add_node("T-Cocuk", "step", parent_id=a["id"])

    assert service.move_node(child["id"], b["id"])
    assert service.TREE.parent[child["id"]] == b["id"]
    assert child["id"] not in service.TREE.children[a["id"]]


def test_koke_cikarilir(client):
    parent = service.add_node("T-Ust2", "generic")
    child = service.add_node("T-Cocuk2", "step", parent_id=parent["id"])
    assert service.move_node(child["id"], None)
    assert child["id"] in service.TREE.roots


def test_kendi_altina_tasinamaz(client):
    """DONGU KORUMASI. Olmasaydi agac halkaya doner, Euler turu sonsuz donerdi."""
    parent = service.add_node("T-Dongu", "generic")
    child = service.add_node("T-DonguCocuk", "step", parent_id=parent["id"])
    grandchild = service.add_node("T-DonguTorun", "step", parent_id=child["id"])

    assert service.move_node(parent["id"], child["id"]) is False
    assert service.move_node(parent["id"], grandchild["id"]) is False, "torun da alt agacta"
    assert service.TREE.parent[parent["id"]] is None, "yapı bozulmamalı"


def test_kendisine_tasinamaz(client):
    d = service.add_node("T-Kendi", "generic")
    assert service.move_node(d["id"], d["id"]) is False


# --- silme ----------------------------------------------------------------


def test_alt_agac_da_silinir(client):
    parent = service.add_node("T-Sil", "generic")
    child = service.add_node("T-SilCocuk", "step", parent_id=parent["id"])

    assert service.delete_node(parent["id"])
    assert parent["id"] not in service.TREE.nodes
    assert child["id"] not in service.TREE.nodes, "cascade alt agaci da almali"


def test_kayit_sayilari_silmeden_once_gorunur(client):
    from shared import nodes
    counts = {nid: c["records"] for nid, c in nodes.counts_by_node().items()}
    item = db.q1("select node_id from items limit 1")
    assert counts.get(item["node_id"], 0) > 0


# --- uclar ----------------------------------------------------------------


def test_sayfa_acilir(client):
    r = client.get("/outcome-tree")
    assert r.status_code == 200
    assert "Veri Yönetimi" in r.text


def test_htmx_yalnizca_agac_parcasini_doner(client):
    full = client.get("/outcome-tree").text
    fragment = client.get("/outcome-tree", headers={"HX-Request": "true"}).text
    assert fragment.lstrip().startswith("<div id=\"agac\"")
    assert "<!DOCTYPE" not in fragment
    assert len(fragment) < len(full)


def test_uctan_dugum_eklenir(client):
    r = client.post("/node", data={"name": "T-Uctan", "type": "generic", "description": "not"})
    assert r.status_code == 200
    assert "T-Uctan" in r.text
    assert db.q1("select 1 from nodes where name = %s", ("T-Uctan",)) is not None


def test_uctan_silinir(client):
    d = service.add_node("T-Silinecek", "generic")
    r = client.request("DELETE", f"/node/{d['id']}")
    assert r.status_code == 200
    assert d["id"] not in service.TREE.nodes


def test_yetkisiz_kullanici_yapiyi_degistiremez(client):
    """Editör olmayan 403 alır — panelin düğmeyi gizlemesi YETMEZ,
    kontrol ucun kendisinde (spec/70-guvenlik.md: yetki sunucuda)."""
    deniz = db.q1("select id from users where name = 'Deniz'")   # is_editor=false
    assert deniz, "tohumda yetkisiz kullanıcı olmalı"
    _switch(client, deniz["id"])
    try:
        assert client.post("/node", data={"name": "T-Yasak", "type": "X"}).status_code == 403
        assert db.q1("select 1 from nodes where name = %s", ("T-Yasak",)) is None
    finally:
        _switch(client, db.q1("select id from users where name = 'Efe'")["id"])


def test_yetkisiz_kullanici_sayfayi_gorur_ama_form_yok(client):
    """Yapıyı okumak herkese açık; değiştirmek değil."""
    deniz = db.q1("select id from users where name = 'Deniz'")
    _switch(client, deniz["id"])
    try:
        text = client.get("/outcome-tree").text
        assert "Veri Yönetimi" in text
        assert 'hx-post="/node"' not in text
        assert "editör yetkisi gerekiyor" in text
    finally:
        _switch(client, db.q1("select id from users where name = 'Efe'")["id"])
def test_taninmayan_tur_reddedilir(client):
    assert service.add_node("T-Gecersiz", "olmayan-tur") is None


def test_root_only_kurali_gecerlidir(client):
    # Koke cell eklenebilir
    c = service.add_node("T-Kok-Cell", "cell")
    assert c is not None
    
    # Alta cell eklenemez
    assert service.add_node("T-Alt-Cell", "cell", parent_id=c["id"]) is None
    
    # Guncelleme sirasinda koke cikarilmamisken cell yapilamaz
    g = service.add_node("T-Alt-Gen", "generic", parent_id=c["id"])
    assert service.update_node(g["id"], node_type="cell") is False
    
    # Cell olan dugum alta tasinamaz
    assert service.move_node(c["id"], g["id"]) is False


def test_pasif_node_altina_eklenemez_veya_tasinamaz(client):
    p = service.add_node("T-Pasif-Ust", "generic")
    service.set_node_active(p["id"], False)
    
    # Altina eklenemez
    assert service.add_node("T-Alt", "generic", parent_id=p["id"]) is None
    
    # Altina tasinamaz
    a = service.add_node("T-Baska", "generic")
    assert service.move_node(a["id"], p["id"]) is False


def test_tur_kilidi_has_projection(client):
    n = service.add_node("T-Takim-Icin", "generic")
    # Projection yarat
    db.x("insert into teams (id, name, node_id, color) values (%s, %s, %s, '#000000')", 
         (db.new_id(), "T-Takim-X", n["id"]))
    
    assert service.update_node(n["id"], node_type="step") is False
    
    # Ad degisebilir ama tur degisemez
    assert service.update_node(n["id"], name="T-Takim-Icin-Yeni") is True
    assert service.TREE.nodes[n["id"]].node_type == "generic"


def test_pasiflestirme_ve_geri_acma(client):
    n = service.add_node("T-AcKapa", "generic")
    
    assert service.set_node_active(n["id"], False)
    assert not service.TREE.nodes[n["id"]].is_active
    
    assert service.set_node_active(n["id"], True)
    assert service.TREE.nodes[n["id"]].is_active


def test_pasif_node_agacta_kalir(client):
    # Agactan silinmez, sadece is_active=False olur
    n = service.add_node("T-Pasif", "generic")
    service.set_node_active(n["id"], False)
    assert n["id"] in service.TREE.nodes
