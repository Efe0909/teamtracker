"""Yetki kapsamlari ve dugum bazli izinler (goc 007, shared/scope.py).

Model iki parcali:
  SCOPE            — ne yapabilir ("edit_nodes")
  NODE PERMISSION  — hangi dalda; ALT AGACA MIRAS KALIR

Testlerin cogu mirasi ve dal sinirlarini sabitliyor: bir dala yetkili olan
komsu dala karisamamali, ama kendi dalinin derinliklerine inebilmeli.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, scope, service  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("scope")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_attach  # noqa: E402
        csrf_attach(c)
        yield c


@pytest.fixture(autouse=True)
def clean(client):
    yield
    db.x("delete from user_scopes")
    db.x("delete from user_node_scopes")
    db.x("delete from nodes where name like %s", ("K-%",))
    service.rebuild_tree()


def person(name):
    return db.q1("select * from users where name = %s", (name,))


def node(name):
    return db.q1("select * from nodes where name = %s", (name,))


def _switch(client, user_id):
    """Kullanici degistir VE CSRF token'ini tazele.

    open_session() oturumu tamamen temizliyor (sabitleme ve token mirasi
    riskine karsi), yani switch sonrasi istemcideki baslik BAYAT kalir ve
    sonraki POST 403 doner. O 403 yetkiden degil CSRF'ten gelir — testin
    olcmek istedigi seyi gizler.
    """
    from conftest import csrf_attach
    client.post(f"/switch/{user_id}", follow_redirects=False)
    csrf_attach(client)


# --- kapsam --------------------------------------------------------------


def test_kapsam_verilir_ve_okunur(client):
    u = person("Deniz")
    assert scope.grant_scope(u["id"], "edit_nodes")
    assert scope.has_scope(u, "edit_nodes")


def test_uydurma_kapsam_kabul_edilmez(client):
    """Yonetim panelindeki yazim hatasi sessizce yetki vermesin."""
    u = person("Deniz")
    assert scope.grant_scope(u["id"], "do_everything") is False
    assert "do_everything" not in scope.active_scopes(u)


def test_tanimsiz_kapsam_yazilamaz(client):
    """Uydurma kapsam artik veritabani seviyesinde reddedilir (goc 008,
    user_scopes.scope -> scopes.name FK) — eskiden yalniz okuma anindaki
    active_scopes() filtrelerdi, artik yazma anindan itibaren imkansiz."""
    u = person("Deniz")
    import psycopg
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        db.x("insert into user_scopes (user_id, scope) values (%s,%s)", (u["id"], "uydurma"))


def test_admin_tum_kapsamlara_sahiptir(client):
    """Yetkilendirmenin tepesi tek yerde; her kontrol ayrica admin sormasin."""
    assert scope.active_scopes(person("Selin")) == set(scope.SCOPES)


def test_kapsam_geri_alinir(client):
    u = person("Deniz")
    scope.grant_scope(u["id"], "edit_nodes")
    scope.revoke_scope(u["id"], "edit_nodes")
    assert not scope.has_scope(u, "edit_nodes")


def test_ayni_kapsam_iki_kez_verilebilir(client):
    u = person("Deniz")
    assert scope.grant_scope(u["id"], "edit_nodes")
    assert scope.grant_scope(u["id"], "edit_nodes")     # cakisma degil


# --- dugum izni ve miras --------------------------------------------------


def test_izin_alt_agaca_miras_kalir(client):
    """Asil kural: bir dugume izin = tum altina izin. Tek tek satir yok."""
    u = person("Deniz")
    scope.grant_scope(u["id"], "edit_nodes")
    scope.grant_node_permission(u["id"], node("Malzeme Temini")["id"])

    assert scope.authorized_on_node(u, node("Malzeme Temini")["id"])
    assert scope.authorized_on_node(u, node("Bütçe Onayı")["id"]), "cocuk"
    assert scope.authorized_on_node(u, node("Tedarikçi Seçimi")["id"]), "kardes cocuk"


def test_miras_yeni_eklenen_torunu_da_kapsar(client):
    u = person("Deniz")
    scope.grant_scope(u["id"], "edit_nodes")
    scope.grant_node_permission(u["id"], node("Malzeme Temini")["id"])

    new = service.add_node("K-Torun", "step", parent_id=node("Bütçe Onayı")["id"])
    assert scope.authorized_on_node(u, new["id"]), "sonradan eklenen de kapsanmali"


def test_komsu_dala_karisamaz(client):
    u = person("Deniz")
    scope.grant_scope(u["id"], "edit_nodes")
    scope.grant_node_permission(u["id"], node("Malzeme Temini")["id"])
    assert scope.authorized_on_node(u, node("Mekan & Lojistik")["id"]) is False


def test_ustune_cikamaz(client):
    """Cocuga izin, ebeveyni duzenleme hakki VERMEZ."""
    u = person("Deniz")
    scope.grant_scope(u["id"], "edit_nodes")
    scope.grant_node_permission(u["id"], node("Bütçe Onayı")["id"])
    assert scope.authorized_on_node(u, node("Malzeme Temini")["id"]) is False


def test_kapsamsiz_izin_yetmez(client):
    """Dugum izni var ama 'edit_nodes' kapsami yok — ikisi birlikte gerekir."""
    u = person("Deniz")
    scope.grant_node_permission(u["id"], node("Malzeme Temini")["id"])
    assert scope.authorized_on_node(u, node("Malzeme Temini")["id"]) is False


def test_izinsiz_kapsam_yetmez(client):
    """Kapsam var ama hicbir dugume izin yok."""
    u = person("Deniz")
    scope.grant_scope(u["id"], "edit_nodes")
    assert scope.authorized_on_node(u, node("Malzeme Temini")["id"]) is False


def test_olmayan_dugume_izin_verilmez(client):
    u = person("Deniz")
    assert scope.grant_node_permission(u["id"], "00000000-0000-0000-0000-000000000000") is False


def test_dugum_silinince_izin_de_gider(client):
    """Cascade: olmayan dugume izin tasima."""
    u = person("Deniz")
    d = service.add_node("K-Gecici", "generic")
    scope.grant_node_permission(u["id"], d["id"])
    service.delete_node(d["id"])
    assert scope.permitted_nodes(u) == []


def test_kok_islemi_yalnizca_admin(client):
    """Dugum izni bir DALI kapsar; kok hicbir dala girmez. Aksi halde bir dala
    izinli kisi agacin yanina kendi agacini kurabilirdi."""
    u = person("Deniz")
    scope.grant_scope(u["id"], "edit_nodes")
    scope.grant_node_permission(u["id"], node("Malzeme Temini")["id"])
    assert scope.can_do_root_operation(u) is False
    assert scope.can_do_root_operation(person("Selin")) is True     # admin


# --- uclarda -------------------------------------------------------------


def test_uc_dal_sinirini_uygular(client):
    """Kontrol UCUN KENDISINDE — formu gizlemek yetmez."""
    u = person("Deniz")
    scope.grant_scope(u["id"], "edit_nodes")
    scope.grant_node_permission(u["id"], node("Malzeme Temini")["id"])
    _switch(client, u["id"])
    try:
        inside = client.post("/node", data={
            "name": "K-Icinde", "type": "step", "parent": str(node("Bütçe Onayı")["id"])})
        assert inside.status_code == 200, inside.text[:200]

        outside = client.post("/node", data={
            "name": "K-Disinda", "type": "step", "parent": str(node("Salon Sözleşmesi")["id"])})
        assert outside.status_code == 403
        assert db.q1("select 1 from nodes where name = %s", ("K-Disinda",)) is None
    finally:
        _switch(client, person("Efe")["id"])


# --- agac gecmisi ---------------------------------------------------------


def test_ekleme_gecmise_yazilir(client):
    d = service.add_node("K-Gecmis", "generic", created_by=person("Efe")["id"])
    event = db.q1("select * from events where subject_type = 'node' and subject_id = %s"
                 " order by created_at desc limit 1", (d["id"],))
    assert event is not None
    assert "K-Gecmis" in event["body"]
    assert event["author_id"] == person("Efe")["id"]


def test_silme_gecmisi_ADI_TASIR(client):
    """events.subject_id FK degil — satir kalir ama dugum gider. Ad body'de
    yazili olmazsa gecmis 'bir sey silindi' demekten oteye gitmez."""
    d = service.add_node("K-Silinen", "generic")
    service.delete_node(d["id"], deleted_by=person("Efe")["id"])

    event = db.q1("select * from events where subject_type = 'node' and subject_id = %s"
                 " order by created_at desc limit 1", (d["id"],))
    assert event is not None, "dugum gitti, gecmis kalmali"
    assert "K-Silinen" in event["body"]
    assert "silindi" in event["body"]


def test_silme_gecmisi_alt_agac_sayisini_yazar(client):
    parent = service.add_node("K-Ust", "generic")
    service.add_node("K-Alt", "step", parent_id=parent["id"])
    service.delete_node(parent["id"])
    event = db.q1("select body from events where subject_type = 'node' and subject_id = %s"
                 " order by created_at desc limit 1", (parent["id"],))
    assert "1 alt düğüm" in event["body"]


def test_adlandirma_gecmisi_eski_ADI_TASIR(client):
    d = service.add_node("K-Once", "generic")
    service.update_node(d["id"], name="K-Sonra", changed_by=person("Efe")["id"])
    event = db.q1("select body from events where subject_type = 'node' and subject_id = %s"
                 " order by created_at desc limit 1", (d["id"],))
    assert "K-Once" in event["body"] and "K-Sonra" in event["body"]


def test_tasima_gecmise_yazilir(client):
    a = service.add_node("K-A", "generic")
    b = service.add_node("K-B", "generic")
    child = service.add_node("K-Cocuk", "step", parent_id=a["id"])
    service.move_node(child["id"], b["id"], moved_by=person("Efe")["id"])
    event = db.q1("select body from events where subject_type = 'node' and subject_id = %s"
                 " order by created_at desc limit 1", (child["id"],))
    assert "taşındı" in event["body"] and "K-B" in event["body"]


# --- iki kademeli silme (spec/72 §6.2) ------------------------------------
#
# Bos (virgin) dugumu silmek ayricalik ISTEMEZ: kaybolan gecmis yok, yanlislikla
# acilmis bos bir dugumu ekleyebilen kaldirabilmeli de. Bagimlisi olani silmek
# kayitlari, alt agaci ve dal izinlerini birlikte goturur — ayrica
# hard_delete_nodes gerekir.


def test_virgin_dugum_ek_kapsam_istemez(client):
    u = person("Deniz")
    scope.grant_scope(u["id"], "edit_nodes")
    parent = node("Malzeme Temini")
    scope.grant_node_permission(u["id"], parent["id"])
    d = service.add_node("K-Virgin", "step", parent_id=parent["id"])
    _switch(client, u["id"])
    try:
        assert "hard_delete_nodes" not in scope.active_scopes(person("Deniz"))
        r = client.request("DELETE", f"/node/{d['id']}")
        assert r.status_code == 200, r.text[:200]
        assert d["id"] not in service.TREE.nodes
    finally:
        _switch(client, person("Efe")["id"])


def test_bagimlisi_olan_dugum_ek_kapsam_ister(client):
    u = person("Deniz")
    scope.grant_scope(u["id"], "edit_nodes")
    parent = node("Malzeme Temini")
    scope.grant_node_permission(u["id"], parent["id"])
    d = service.add_node("K-Dolu", "step", parent_id=parent["id"])
    service.add_node("K-DoluAlt", "step", parent_id=d["id"])     # cocuk = bagimlilik
    _switch(client, u["id"])
    try:
        assert client.request("DELETE", f"/node/{d['id']}").status_code == 403
        assert d["id"] in service.TREE.nodes

        scope.grant_scope(u["id"], "hard_delete_nodes")
        assert client.request("DELETE", f"/node/{d['id']}").status_code == 200
        assert d["id"] not in service.TREE.nodes
    finally:
        _switch(client, person("Efe")["id"])


def test_kapsam_dal_disinda_islemez(client):
    """hard_delete_nodes NODE_DEPENDENT: kapsam tek basina yetmez, silinecek
    dalda izin de gerekir."""
    u = person("Deniz")
    scope.grant_scope(u["id"], "edit_nodes")
    scope.grant_scope(u["id"], "hard_delete_nodes")
    scope.grant_node_permission(u["id"], node("Malzeme Temini")["id"])
    komsu = node("Mekan & Lojistik")
    d = service.add_node("K-Komsu", "step", parent_id=komsu["id"])
    service.add_node("K-KomsuAlt", "step", parent_id=d["id"])
    _switch(client, u["id"])
    try:
        assert client.request("DELETE", f"/node/{d['id']}").status_code == 403
        assert d["id"] in service.TREE.nodes
    finally:
        _switch(client, person("Efe")["id"])


def test_kapsamsiz_eski_editor_yikici_yetkiyi_MIRAS_ALMAZ(client):
    """_authorized_on_node'daki gecis donemi kacis kapisi (is_editor + hic
    user_node_scopes satiri yok) ikinci kademeye TASINMAZ."""
    efe = person("Efe")
    assert db.as_bool(efe["is_editor"]) and not db.as_bool(efe["is_admin"])
    assert scope.permitted_nodes(efe) == [], "kacis kapisinin kosulu"
    assert "hard_delete_nodes" not in scope.active_scopes(efe)

    parent = node("Malzeme Temini")
    d = service.add_node("K-EskiEditor", "step", parent_id=parent["id"])
    service.add_node("K-EskiEditorAlt", "step", parent_id=d["id"])
    # Efe zaten oturumdaki kullanici.
    assert client.request("DELETE", f"/node/{d['id']}").status_code == 403
    assert d["id"] in service.TREE.nodes
    # Ama BOS olani silebilir — kaybolan gecmis yok.
    bos = service.add_node("K-EskiEditorBos", "step", parent_id=parent["id"])
    assert client.request("DELETE", f"/node/{bos['id']}").status_code == 200


def test_kullanici_kapsam_dugumu_de_bagimliliktir(client):
    """users.scope_node_id — spec/72 §6.1'deki bes bagimliliktan biri.
    Tohumda Deniz'in kapsami "Üretim Hattı A"ya bagli."""
    from shared import nodes as node_lib
    hat = node("Üretim Hattı A")
    assert node_lib.counts_of(hat["id"])["user_scopes"] == 1
    assert not node_lib.is_virgin(hat["id"])


def test_pasiflestirme_ek_kapsam_ISTEMEZ(client):
    """Yikici degil, geri alinabilir: edit_nodes yeter (spec/72 §6)."""
    u = person("Deniz")
    scope.grant_scope(u["id"], "edit_nodes")
    parent = node("Malzeme Temini")
    scope.grant_node_permission(u["id"], parent["id"])
    d = service.add_node("K-Pasif", "step", parent_id=parent["id"])
    _switch(client, u["id"])
    try:
        assert client.post(f"/node/{d['id']}/active", data={"active": "0"}).status_code == 200
        assert service.TREE.nodes[d["id"]].is_active is False
        # Komsu dalda yine 403:
        disari = service.add_node("K-PasifDis", "step",
                                  parent_id=node("Mekan & Lojistik")["id"])
        assert client.post(f"/node/{disari['id']}/active",
                           data={"active": "0"}).status_code == 403
    finally:
        _switch(client, person("Efe")["id"])
