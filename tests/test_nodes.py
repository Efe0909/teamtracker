"""Dugum bagimlilik yuklemleri (shared/nodes.py, spec/72-node-turleri.md §6).

Iki yuklem AYRI olmak zorunda ve testlerin yarisi tam bunu sabitliyor:

  is_virgin       — bes bagimliligin hepsi sifir; SERT SILME izni (§6.2)
  has_projection  — yalniz projeksiyon satiri (teams); TUR KILIDI (§6.3)

Ayni yuklem kullanilsaydi cocugu olan hicbir dugumun turu degistirilemezdi.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, nodes, scope, service  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("nodes")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean(client):
    yield
    db.x("delete from user_node_scopes")
    db.x("delete from nodes where name like %s", ("N-%",))
    service.rebuild_tree()


def node(name):
    return db.q1("select * from nodes where name = %s", (name,))


# --- katalog --------------------------------------------------------------


def test_turler_ingilizce_anahtar_turkce_etiket():
    """CLAUDE.md "Kod dili": anahtar kodun, etiket ekranin."""
    assert nodes.valid("cell") and not nodes.valid("Departman")
    assert nodes.label("team") == "Takım"
    assert nodes.label("bilinmeyen") == "bilinmeyen"     # goc oncesi veriyi gizleme


def test_root_only_yalnizca_cell():
    """spec/72 §7 ve §11: cell disinda YERLESIM KURALI YOK. Ozellikle machine
    hicbir yere dayatilmiyor — tohumun kendi sekli (machine > machine) bunu
    gerektiriyor."""
    assert nodes.ROOT_ONLY == frozenset({"cell"})
    assert not nodes.root_only("machine")


# --- is_virgin ------------------------------------------------------------


def test_bos_dugum_virgin(client):
    d = service.add_node("N-Bos", "generic")
    assert nodes.is_virgin(d["id"])


def test_gecmis_virginligi_BOZMAZ(client):
    """TASIYICI TEST. events BILEREK sayilmiyor: subject_id FK degil (goc 001)
    ve add_node HER dugum icin bir olusturma olayi yaziyor. Sayilsaydi hicbir
    dugum virgin olamaz, ozellik hic calismazdi."""
    d = service.add_node("N-Gecmisli", "generic", created_by=None)
    assert db.q1("select 1 from events where subject_type='node' and subject_id=%s",
                 (d["id"],)) is not None, "olusturma olayi yazilmis olmali"
    assert nodes.is_virgin(d["id"]), "olay varligi silmeyi engellememeli"


def test_cocuk_virginligi_bozar(client):
    parent = service.add_node("N-Ust", "generic")
    service.add_node("N-Alt", "step", parent_id=parent["id"])
    assert not nodes.is_virgin(parent["id"])


def test_kayit_virginligi_bozar(client):
    assert not nodes.is_virgin(node("Bütçe Onayı")["id"])


def test_dal_izni_virginligi_bozar(client):
    d = service.add_node("N-Izinli", "generic")
    u = db.q1("select id from users where name = 'Deniz'")
    scope.grant_node_permission(u["id"], d["id"])
    assert not nodes.is_virgin(d["id"])


def test_takim_karti_virginligi_bozar(client):
    """teams.node_id — projeksiyon (bugun gevsek bagli, 2. asamada sikilasacak)."""
    d = service.add_node("N-Takimli", "team")
    db.x("update teams set node_id = %s where name = 'Maliye'", (d["id"],))
    assert not nodes.is_virgin(d["id"])
    db.x("update teams set node_id = null where name = 'Maliye'")


# --- has_projection: is_virgin'den DAR ------------------------------------


def test_cocuk_projeksiyon_SAYILMAZ(client):
    """Turu degistirmek cocugu sahipsiz birakmaz — sahipsiz kalan projeksiyon
    satiridir. Bu ayrim olmasaydi cocugu olan hicbir dugumun turu degismezdi."""
    parent = service.add_node("N-PUst", "generic")
    service.add_node("N-PAlt", "step", parent_id=parent["id"])
    assert not nodes.is_virgin(parent["id"])
    assert not nodes.has_projection(parent["id"]), "cocuk tur kilidini kurmamali"


def test_takim_karti_projeksiyondur(client):
    d = service.add_node("N-PTakim", "team")
    db.x("update teams set node_id = %s where name = 'Maliye'", (d["id"],))
    assert nodes.has_projection(d["id"])
    db.x("update teams set node_id = null where name = 'Maliye'")


# --- alt agac sayilari: silme onayinin yazdigi sayilar --------------------


def test_alt_agac_sayilari_silme_onayini_besler(client):
    parent = service.add_node("N-SUst", "generic")
    child = service.add_node("N-SAlt", "step", parent_id=parent["id"])
    service.add_node("N-STorun", "step", parent_id=child["id"])
    u = db.q1("select id from users where name = 'Deniz'")
    scope.grant_node_permission(u["id"], child["id"])

    total = nodes.subtree_counts(service.TREE.subtree(parent["id"]))
    assert total["children"] == 2, "kokun kendisi sayilmaz"
    assert total["permissions"] == 1
    assert total["records"] == 0


def test_tek_sorgu_haritasi_paylasilir(client):
    """counts_by_node() bir kez kosar, uc tuketici ayni haritayi okur."""
    counts = nodes.counts_by_node()
    butce = node("Bütçe Onayı")["id"]
    assert nodes.counts_of(butce, counts)["records"] > 0
    assert not nodes.is_virgin(butce, counts)
    assert not nodes.has_projection(butce, counts)


# --- goc tanilamasi -------------------------------------------------------


def test_goc_uyarilari_loga_duser(client, caplog, tmp_path):
    """011, taninmayan turu ve ROOT_ONLY ihlalini `raise warning` ile bildiriyor.

    psycopg3 sunucu notice'larini VARSAYILAN OLARAK YUTUYOR: db.migrate()
    handler takmasaydi o uyarilar hicbir yerde gorunmez, yani hicbir ise
    yaramazdi. Burada gercek migrate() yolu kosuluyor, gecici bir goc dosyasiyla.
    """
    import logging

    (tmp_path / "999_uyari_denemesi.sql").write_text(
        "do $$ begin raise warning 'bilinmeyen node_type: Zamazingo'; end $$;",
        encoding="utf-8")
    real = db.MIGRATIONS_DIR
    db.MIGRATIONS_DIR = tmp_path
    try:
        with caplog.at_level(logging.WARNING, logger="ekiptakip.db"):
            assert db.migrate() == ["999_uyari_denemesi.sql"]
    finally:
        db.MIGRATIONS_DIR = real
        db.x("delete from schema_migrations where name = %s", ("999_uyari_denemesi.sql",))

    assert any("Zamazingo" in r.getMessage() for r in caplog.records), \
        "goc uyarisi sessizce yutulmus"
