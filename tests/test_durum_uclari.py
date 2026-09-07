"""Durum uclari: disa aktar / sifirla / yukle (spec/70-guvenlik.md §12).

Sinanan: anahtarsiz istegin gecmemesi, yol kacisinin kapali olmasi, gidis-donus
(disa aktar → sifirla → yukle) sonunda durumun AYNI gelmesi ve agac indeksinin
yeniden kurulmus olmasi.
"""
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import config, db, durum, service  # noqa: E402

ANAHTAR = {"X-Test-Anahtari": os.environ["EKIPTAKIP_TEST_ANAHTARI"]}


@pytest.fixture(scope="module")
def client(tmp_path_factory, monkeypatch_modul):
    from conftest import test_veritabani  # noqa: E402
    test_veritabani("durum")
    # Tohum dizini testte gecici: depoya dosya birakmayalim.
    monkeypatch_modul.setattr(config, "TOHUM_DIZINI", tmp_path_factory.mktemp("tohumlar"))
    import app  # noqa: E402
    with TestClient(app.app) as c:
        yield c


@pytest.fixture(scope="module")
def monkeypatch_modul():
    from _pytest.monkeypatch import MonkeyPatch
    mp = MonkeyPatch()
    yield mp
    mp.undo()


def sayim(tablo: str) -> int:
    return db.q1(f"select count(*) c from {tablo}")["c"]


def basliklar(client) -> list[str]:
    return [it["title"] for it in db.q("select title from items order by title")]


# --- kapi -----------------------------------------------------------------

def test_anahtarsiz_istek_gecmez(client):
    """Uc ayri metot, ayni kapi: anahtar yoksa 403 ve veri durur."""
    once = sayim("items")
    assert client.get("/test/disa-aktar").status_code == 403
    assert client.post("/test/sifirla").status_code == 403
    assert client.post("/test/yukle?yol=varsayilan").status_code == 403
    assert sayim("items") == once


def test_yanlis_anahtar_gecmez(client):
    r = client.post("/test/sifirla", headers={"X-Test-Anahtari": "yanlis"})
    assert r.status_code == 403
    assert sayim("items") > 0


def test_bozuk_anahtar_basligi_500_degil_403(client):
    """ASCII disi baslik degeri: sabit zamanli karsilastirma bayt uzerinde.

    Baslik latin-1 cozulur; metin modunda compare_digest bunu TypeError ile
    patlatir (403 yerine 500 olurdu). Deger BAYT olarak gonderiliyor: istemci
    kutuphaneleri ASCII disi metni zaten reddeder, ham bayt gonderen etmez.
    """
    r = client.post("/test/sifirla", headers={"X-Test-Anahtari": "şğü".encode()})
    assert r.status_code == 403


def test_bozuk_tohum_betigi_400_doner(client):
    """Hatali SQL 500 + traceback degil, okunur bir hata olur; islem geri alinir."""
    (Path(config.TOHUM_DIZINI) / "bozuk.sql").write_text("select bu_sutun_yok from users;")
    once = sayim("items")
    r = client.post("/test/yukle?yol=bozuk.sql", headers=ANAHTAR)
    assert r.status_code == 400 and "tohum betigi calismadi" in r.json()["detail"]
    assert sayim("items") == once


def test_uclar_arayuze_bagli_degil(client):
    """Ekranlarda bu uclara baglanti/dugme YOK: makine ucu."""
    for yol in ("/", "/gorevler"):
        assert "/test/" not in client.get(yol).text


# --- disa aktarma ---------------------------------------------------------

def test_disa_aktarim_veri_tasir_sema_tasimaz(client):
    r = client.get("/test/disa-aktar", headers=ANAHTAR)
    assert r.status_code == 200
    sql = r.text
    assert "begin;" in sql and "commit;" in sql
    assert "truncate table" in sql
    assert "insert into \"users\"" in sql and "insert into \"items\"" in sql
    assert "Bütçe onayı 6 gündür bekliyor" in sql
    assert "create table" not in sql                  # sema goclerin isi
    # uretilmis sutun (items.arama) INSERT'e girmez
    assert '"arama"' not in sql


def test_dongu_kiran_sutunlar_sonda_baglanir(client):
    """nodes.parent_id oz-referansi ve users<->nodes dongusu sonda UPDATE olur."""
    sql = client.get("/test/disa-aktar", headers=ANAHTAR).text
    assert "donguyu kiran sutunlar" in sql
    baglama = [s for s in sql.splitlines() if s.startswith('update "nodes" set')]
    # kok dugumun parent_id'si null: yalnizca DOLU olanlar sonda baglanir
    assert any('"parent_id" =' in s for s in baglama)                # oz-referans
    assert len(baglama) == db.q1("select count(*) c from nodes")["c"]
    # once satirlar yazilir, sonra baglanir
    assert sql.index('insert into "nodes"') < sql.index(baglama[0])
    # dongude olmayan sutunlar ERTELENMEZ: eylemin atanani insert'in icinde gelir
    assert '"assignee_id"' in sql.split('-- actions')[1].split("insert into")[1]


def test_plan_yalnizca_dongudeki_sutunlari_erteler(client):
    """Sema buyudukce sira sabit listeden degil FK grafiginden cikar."""
    with db.havuz().connection() as c:
        sira, ertelenen = durum.yazma_plani(c)
    assert sira.index("users") < sira.index("items")          # bagimlilik sirasi
    assert sira.index("nodes") < sira.index("items")
    # dongu kirildiktan sonra kalan yon: users.scope_node_id INSERT'te yazilabilsin
    assert sira.index("nodes") < sira.index("users")
    assert "parent_id" in ertelenen["nodes"]                  # oz-referans
    # users <-> nodes dongusunden TEK bir sutun ertelenir, ikisi birden degil
    dongu_sutunlari = ertelenen.get("users", set()) | (ertelenen["nodes"] - {"parent_id"})
    assert len(dongu_sutunlari) == 1
    assert set(ertelenen) <= {"users", "nodes"}               # baska tabloya bulasmaz


def test_ad_verilirse_tohum_dizinine_yazilir(client):
    r = client.get("/test/disa-aktar?ad=anlik", headers=ANAHTAR)
    assert r.status_code == 200
    yol = Path(r.headers["X-Tohum-Yolu"])
    assert yol.parent == Path(config.TOHUM_DIZINI) and yol.read_text() == r.text


def test_bozuk_ad_reddedilir(client):
    assert client.get("/test/disa-aktar?ad=../kacis", headers=ANAHTAR).status_code == 400


# --- sifirlama ------------------------------------------------------------

def test_sifirlama_tabloyu_bosaltir_semayi_birakir(client):
    client.get("/test/disa-aktar?ad=geri-yukle", headers=ANAHTAR)   # once yedek
    r = client.post("/test/sifirla", headers=ANAHTAR)
    assert r.status_code == 200
    assert all(n == 0 for n in r.json()["sayimlar"].values())
    assert sayim("users") == 0 and sayim("nodes") == 0
    # sema ve goc defteri durur: goc yeniden kosmaz
    assert db.q1("select count(*) c from schema_migrations")["c"] > 0
    assert service.TREE.nodes == {}                  # agac da bosaltildi


def test_yukleme_durumu_geri_getirir(client):
    """Gidis-donus: disa aktarim → sifirlama → yukleme sonunda ayni durum."""
    r = client.post("/test/yukle?yol=geri-yukle.sql", headers=ANAHTAR)
    assert r.status_code == 200
    assert r.json()["sayimlar"]["items"] == 5
    assert "Bütçe onayı 6 gündür bekliyor" in basliklar(client)
    # dongu kiran sutunlar geri baglandi
    assert db.q1("select count(*) c from users where scope_node_id is not null")["c"] == 2
    assert db.q1("select count(*) c from nodes where parent_id is not null")["c"] > 0


def test_yukleme_sonrasi_agac_yeniden_kurulur(client):
    """Agac surec bellegindedir: yukleme onu tazelemezse sayfalar bos doner."""
    assert len(service.TREE.nodes) == sayim("nodes")
    r = client.get("/gorevler")
    assert r.status_code == 200 and "Malzeme Temini" in r.text     # dugum yolu doldu


def test_varsayilan_tohum_yuklenir(client):
    r = client.post("/test/yukle?yol=varsayilan", headers=ANAHTAR)
    assert r.status_code == 200 and r.json()["kaynak"].endswith("seed.py")
    assert r.json()["sayimlar"]["items"] == 5


# --- yol kacisi -----------------------------------------------------------

def test_tohum_dizini_disina_cikilamaz(client):
    for yol in ("../app.py", "/etc/passwd", "../../etc/hosts"):
        r = client.post(f"/test/yukle?yol={yol}", headers=ANAHTAR)
        assert r.status_code in (403, 400), yol

def test_sembolik_bag_da_gecmez(client):
    """resolve() bagi cozer: tohum dizininde duran bir kisayol bile disari acamaz."""
    kok = Path(config.TOHUM_DIZINI)
    bag = kok / "kacis.sql"
    if bag.exists() or bag.is_symlink():
        bag.unlink()
    bag.symlink_to(ROOT / "app.py")
    assert client.post("/test/yukle?yol=kacis.sql", headers=ANAHTAR).status_code == 403
    bag.unlink()


def test_sadece_sql_uzantisi(client):
    (Path(config.TOHUM_DIZINI) / "not.txt").write_text("select 1;")
    assert client.post("/test/yukle?yol=not.txt", headers=ANAHTAR).status_code == 400


def test_olmayan_dosya_404(client):
    assert client.post("/test/yukle?yol=yok.sql", headers=ANAHTAR).status_code == 404


# --- kapi kapaliyken ------------------------------------------------------

def test_uclar_yayinda_hic_tanimlanmaz(monkeypatch):
    """Yayin kurulumunda rota yok: 403 degil, hic yok (app.py kosullu include)."""
    monkeypatch.setenv("EKIPTAKIP_ENV", "yayin")
    assert config.durum_uclari() is False
    monkeypatch.setenv("EKIPTAKIP_ENV", "gelistirme")
    monkeypatch.setattr(config, "TEST_ANAHTARI", "kisa")
    assert config.durum_uclari() is False             # anahtar cok kisa


def test_yayinda_anahtar_acilisi_reddettirir(monkeypatch):
    monkeypatch.setenv("EKIPTAKIP_ENV", "yayin")
    monkeypatch.setenv("EKIPTAKIP_HOST_APP", "app.ornek.com")
    monkeypatch.setattr(config, "TEST_ANAHTARI", "a" * 40)
    monkeypatch.setenv("EKIPTAKIP_TEST_YAPILANDIRMA", "0")   # yayinda bayrak yok sayilir
    with pytest.raises(SystemExit) as e:
        config.dogrula()
    assert "EKIPTAKIP_TEST_ANAHTARI" in str(e.value)
