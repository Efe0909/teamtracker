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
def test_virgin_node_ek_kapsam_istemez(client):
    from shared import service, scope
    u = person("Efe")
    _switch(client, None)
    scope.grant_scope(u["id"], "edit_nodes")
    scope.grant_node_permission(u["id"], node("Malzeme Temini")["id"])
    
    p = service.add_node("K-Virgin-Sil", "generic", parent_id=node("Malzeme Temini")["id"])
    
    _switch(client, u["id"])
    assert client.delete(f"/node/{p['id']}").status_code == 200


def test_dolu_node_hard_delete_kapsami_ister(client):
    from shared import service, db, scope
    u = person("Deniz")
    
    _switch(client, None)
    scope.grant_scope(u["id"], "edit_nodes")
    scope.grant_node_permission(u["id"], node("Üretim Hattı A")["id"])
    
    p = service.add_node("K-Dolu-Sil", "generic", parent_id=node("Üretim Hattı A")["id"])
    service.add_node("K-Dolu-Cocuk", "step", parent_id=p["id"])
    
    _switch(client, u["id"])
    assert client.delete(f"/node/{p['id']}").status_code == 403
    
    _switch(client, None)
    scope.grant_scope(u["id"], "hard_delete_nodes")
    
    _switch(client, u["id"])
    assert client.delete(f"/node/{p['id']}").status_code == 200


def test_hard_delete_kapsami_dal_disinda_islemez(client):
    from shared import service, scope
    u = person("Efe")
    
    _switch(client, None)
    scope.grant_scope(u["id"], "edit_nodes")
    scope.grant_scope(u["id"], "hard_delete_nodes")
    scope.grant_node_permission(u["id"], node("Malzeme Temini")["id"])
    
    _switch(client, u["id"])
    assert client.delete(f"/node/{node('Bütçe Onayı')['id']}").status_code == 200
    assert client.delete(f"/node/{node('Dolum Makinesi')['id']}").status_code == 403


def test_eski_editor_hard_delete_yapamaz(client):
    from shared import service, db
    
    u_id = db.new_id()
    db.x("insert into users (id, email, name, is_editor) values (%s, %s, %s, true)", 
         (u_id, "eski@example.com", "Eski Editor"))
    u = person("Eski Editor")
    
    p = service.add_node("K-Eski-Editor", "generic")
    service.add_node("K-Eski-Editor-Cocuk", "step", parent_id=p["id"])
    
    _switch(client, u["id"])
    assert client.delete(f"/node/{p['id']}").status_code == 403
