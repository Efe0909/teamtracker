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
    from conftest import test_veritabani  # noqa: E402
    test_veritabani("veriyonetimi")
    import app  # noqa: E402
    with TestClient(app.app) as c:
        from conftest import csrf_tak  # noqa: E402
        csrf_tak(c)
        yield c


@pytest.fixture(autouse=True)
def _agac(client):
    """Her test tohum agaciyla baslasin."""
    yield
    # Desen PARAMETRE olarak gecer: satir ici yazilirsa psycopg '%'' yi kendi
    # yer tutucusu sanip "only '%s', '%b', '%t' are allowed" der.
    db.x("delete from nodes where name like %s", ("T-%",))
    service.rebuild_tree()


def _gec(client, user_id):
    """Kullanici degistir VE CSRF token'ini tazele — switch oturumu
    temizledigi icin eski token gecersiz kalir ve 403'u YETKI degil CSRF
    uretir."""
    from conftest import csrf_tak
    client.post(f"/switch/{user_id}", follow_redirects=False)
    csrf_tak(client)


def kok_sayisi():
    return len(service.TREE.roots)


# --- ekleme ---------------------------------------------------------------


def test_kok_dugum_eklenir(client):
    once = kok_sayisi()
    satir = service.dugum_ekle("T-Maliye", "Bölüm")
    assert satir is not None
    assert satir["parent_id"] is None
    # Veritabani DEGIL, bellekteki agac da bilmeli:
    assert kok_sayisi() == once + 1
    assert satir["id"] in service.TREE.nodes
    assert satir["id"] in service.TREE.roots


def test_alt_dugum_eklenir(client):
    ust = service.dugum_ekle("T-Ust", "Bölüm")
    alt = service.dugum_ekle("T-Alt", "Adım", parent_id=ust["id"])
    assert service.TREE.parent[alt["id"]] == ust["id"]
    assert alt["id"] in service.TREE.children[ust["id"]]
    assert service.TREE.depth[alt["id"]] == service.TREE.depth[ust["id"]] + 1


def test_aciklama_kaydedilir(client):
    d = service.dugum_ekle("T-Aciklamali", "Bölüm", aciklama="  Bütçe ve ödemeler  ")
    assert d["description"] == "Bütçe ve ödemeler"      # kirpilir


def test_adsiz_dugum_reddedilir(client):
    assert service.dugum_ekle("   ", "Bölüm") is None
    assert service.dugum_ekle("T-X", "  ") is None


def test_olmayan_ustun_altina_eklenmez(client):
    assert service.dugum_ekle("T-Yetim", "Adım",
                              parent_id="00000000-0000-0000-0000-000000000000") is None


def test_kardesler_sona_eklenir(client):
    ust = service.dugum_ekle("T-Sira", "Bölüm")
    a = service.dugum_ekle("T-Bir", "Adım", parent_id=ust["id"])
    b = service.dugum_ekle("T-Iki", "Adım", parent_id=ust["id"])
    assert b["sort_order"] > a["sort_order"]
    assert service.TREE.children[ust["id"]] == [a["id"], b["id"]]


# --- guncelleme -----------------------------------------------------------


def test_ad_degisir_ve_agac_taze_kalir(client):
    d = service.dugum_ekle("T-Eski", "Bölüm")
    assert service.dugum_guncelle(d["id"], ad="T-Yeni")
    assert service.TREE.name(d["id"]) == "T-Yeni"


def test_verilmeyen_alan_degismez(client):
    d = service.dugum_ekle("T-Kismi", "Bölüm", aciklama="kalsin")
    service.dugum_guncelle(d["id"], ad="T-Kismi2")
    satir = db.q1("select * from nodes where id = %s", (d["id"],))
    assert satir["description"] == "kalsin"
    assert satir["node_type"] == "Bölüm"


def test_bos_aciklama_temizler(client):
    d = service.dugum_ekle("T-Temiz", "Bölüm", aciklama="silinecek")
    service.dugum_guncelle(d["id"], aciklama="")
    assert db.q1("select description from nodes where id = %s", (d["id"],))["description"] is None


def test_bos_ad_reddedilir(client):
    d = service.dugum_ekle("T-Kalici", "Bölüm")
    assert service.dugum_guncelle(d["id"], ad="  ") is False
    assert service.TREE.name(d["id"]) == "T-Kalici"


# --- tasima ---------------------------------------------------------------


def test_dugum_tasinir(client):
    a = service.dugum_ekle("T-A", "Bölüm")
    b = service.dugum_ekle("T-B", "Bölüm")
    cocuk = service.dugum_ekle("T-Cocuk", "Adım", parent_id=a["id"])

    assert service.dugum_tasi(cocuk["id"], b["id"])
    assert service.TREE.parent[cocuk["id"]] == b["id"]
    assert cocuk["id"] not in service.TREE.children[a["id"]]


def test_koke_cikarilir(client):
    ust = service.dugum_ekle("T-Ust2", "Bölüm")
    cocuk = service.dugum_ekle("T-Cocuk2", "Adım", parent_id=ust["id"])
    assert service.dugum_tasi(cocuk["id"], None)
    assert cocuk["id"] in service.TREE.roots


def test_kendi_altina_tasinamaz(client):
    """DONGU KORUMASI. Olmasaydi agac halkaya doner, Euler turu sonsuz donerdi."""
    ust = service.dugum_ekle("T-Dongu", "Bölüm")
    cocuk = service.dugum_ekle("T-DonguCocuk", "Adım", parent_id=ust["id"])
    torun = service.dugum_ekle("T-DonguTorun", "Adım", parent_id=cocuk["id"])

    assert service.dugum_tasi(ust["id"], cocuk["id"]) is False
    assert service.dugum_tasi(ust["id"], torun["id"]) is False, "torun da alt agacta"
    assert service.TREE.parent[ust["id"]] is None, "yapı bozulmamalı"


def test_kendisine_tasinamaz(client):
    d = service.dugum_ekle("T-Kendi", "Bölüm")
    assert service.dugum_tasi(d["id"], d["id"]) is False


# --- silme ----------------------------------------------------------------


def test_alt_agac_da_silinir(client):
    ust = service.dugum_ekle("T-Sil", "Bölüm")
    cocuk = service.dugum_ekle("T-SilCocuk", "Adım", parent_id=ust["id"])

    assert service.dugum_sil(ust["id"])
    assert ust["id"] not in service.TREE.nodes
    assert cocuk["id"] not in service.TREE.nodes, "cascade alt agaci da almali"


def test_kayit_sayilari_silmeden_once_gorunur(client):
    sayilar = service.dugum_kayit_sayilari()
    kayitli = db.q1("select node_id from items limit 1")
    assert sayilar.get(kayitli["node_id"], 0) > 0


# --- uclar ----------------------------------------------------------------


def test_sayfa_acilir(client):
    r = client.get("/kazanim-agaci")
    assert r.status_code == 200
    assert "Veri Yönetimi" in r.text


def test_htmx_yalnizca_agac_parcasini_doner(client):
    tam = client.get("/kazanim-agaci").text
    parca = client.get("/kazanim-agaci", headers={"HX-Request": "true"}).text
    assert parca.lstrip().startswith("<div id=\"agac\"")
    assert "<!DOCTYPE" not in parca
    assert len(parca) < len(tam)


def test_uctan_dugum_eklenir(client):
    r = client.post("/dugum", data={"ad": "T-Uctan", "tur": "Bölüm", "aciklama": "not"})
    assert r.status_code == 200
    assert "T-Uctan" in r.text
    assert db.q1("select 1 from nodes where name = %s", ("T-Uctan",)) is not None


def test_uctan_silinir(client):
    d = service.dugum_ekle("T-Silinecek", "Bölüm")
    r = client.request("DELETE", f"/dugum/{d['id']}")
    assert r.status_code == 200
    assert d["id"] not in service.TREE.nodes


def test_yetkisiz_kullanici_yapiyi_degistiremez(client):
    """Editör olmayan 403 alır — panelin düğmeyi gizlemesi YETMEZ,
    kontrol ucun kendisinde (spec/70-guvenlik.md: yetki sunucuda)."""
    deniz = db.q1("select id from users where name = 'Deniz'")   # is_editor=false
    assert deniz, "tohumda yetkisiz kullanıcı olmalı"
    _gec(client, deniz["id"])
    try:
        assert client.post("/dugum", data={"ad": "T-Yasak", "tur": "X"}).status_code == 403
        assert db.q1("select 1 from nodes where name = %s", ("T-Yasak",)) is None
    finally:
        _gec(client, db.q1("select id from users where name = 'Efe'")["id"])


def test_yetkisiz_kullanici_sayfayi_gorur_ama_form_yok(client):
    """Yapıyı okumak herkese açık; değiştirmek değil."""
    deniz = db.q1("select id from users where name = 'Deniz'")
    _gec(client, deniz["id"])
    try:
        metin = client.get("/kazanim-agaci").text
        assert "Veri Yönetimi" in metin
        assert 'hx-post="/dugum"' not in metin
        assert "editör yetkisi gerekiyor" in metin
    finally:
        _gec(client, db.q1("select id from users where name = 'Efe'")["id"])
