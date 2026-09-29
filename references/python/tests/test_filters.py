"""Filtre cizimi — TASK-220'nin asil yuku.

Sablon ONCE "options() bos mu" diye bakiyordu: bos donen HER filtre metin
kutusuna dusuyor, kullanici bir sey yaziyor, clause() degeri tanimadigi icin
sessizce yutuyordu. Hicbir sey yapmayan bir input.

Ayrim artik TURDE (Filter.input_type). Bu modul kendi veritabanini aldigi icin
teams tablosunu bosaltabiliyor — asil kirilma senaryosu tam orasi.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, filters  # noqa: E402


@pytest.fixture(scope="module")
def client():
    from conftest import setup_database  # noqa: E402
    setup_database("filters")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        yield c


def _filter(param):
    return next(f for f in filters.active_filters() if f.param == param)


def test_pillar_filtresi_ORTOGONAL_BOYUT(client):
    """Eski `items.pillar` serbest metindi ve hic set edilemiyordu; dusuruldu.
    Geri gelen sey AYNI SEY DEGIL: pillar_node_id, tanimi agactaki pillar
    node'undan alan ortogonal bir bag (goc 012, spec/72 §8)."""
    assert "pillar" in {f.param for f in filters.active_filters()}
    assert ">Pillar<" in client.get("/tasks").text


def test_pillar_secenekleri_yalniz_pillar_dugumlerinden(client):
    from shared import service
    pillar = service.add_node("F-Pillar", "pillar")
    service.add_node("F-DegilPillar", "generic")
    degerler = {v for v, _et, _g in _filter("pillar").options()}
    assert pillar["id"] in degerler
    assert "none" in degerler                      # "Pillar'siz" kirilimi
    assert all(v == "none" or service.TREE.nodes[v].node_type == "pillar" for v in degerler)


def test_pillar_filtresi_kayitlari_suzer(client):
    from shared import db, service
    pillar = service.add_node("F-SuzPillar", "pillar")
    item = db.q1("select id from items limit 1")
    db.x("update items set pillar_node_id = %s where id = %s", (pillar["id"], item["id"]))
    kullanici = db.q1("select * from users limit 1")
    where, args, _order, _secili = filters.build_query(
        {"pillar": str(pillar["id"])}, kullanici)
    satirlar = db.q(f"select i.id from items i where {where}", tuple(args))
    assert [r["id"] for r in satirlar] == [item["id"]]


def test_select_filtreleri_tur_isaretini_tasir(client):
    assert _filter("team").input_type == "select"
    assert _filter("node").input_type == "select"
    assert _filter("search").input_type == "search"


def test_BOS_teams_ile_takim_filtresi_hala_select(client):
    """TASK-220'nin kabul kriteri: tohumlanmamis gercek bir veritabaninda
    Takim filtresi metin kutusuna DUSMEMELI."""
    db.x("delete from teams")
    assert _filter("team").options() == []

    text = client.get("/tasks").text
    bolum = text.split(">Takım<", 1)[1].split("</label>", 1)[0]
    assert "<select" in bolum
    assert 'type="search"' not in bolum


def test_arama_metin_kutusu_olarak_kalir(client):
    """Tek gercek metin girisi — options() bos oldugu icin degil, turu oyle."""
    text = client.get("/tasks").text
    bolum = text.split(">Ara<", 1)[1].split("</label>", 1)[0]
    assert 'type="search"' in bolum
