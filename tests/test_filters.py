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


def test_pillar_filtresi_YOK(client):
    """items.pillar olu sutundu ve dusuruldu; kayitla bagi olmayan boyutta
    filtre kurulamaz (spec/72 §8)."""
    assert "pillar" not in {f.param for f in filters.active_filters()}
    assert ">Pillar<" not in client.get("/tasks").text


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
