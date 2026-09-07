"""Durum betigi: disa aktar / sifirla / yukle (spec/80-veritabani.md §10).

Sinanan: dokumun yalnizca veri tasimasi, dongu kiran sutunlarin sonda
baglanmasi, gidis-donusun (disa aktar → sifirla → yukle) durumu AYNI getirmesi
ve komut satiri yuzunun gercekten kosmasi.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db, durum  # noqa: E402


@pytest.fixture(scope="module")
def veritabani(tmp_path_factory):
    """Kendi veritabani + gecici tohum dizini (depoya dosya birakmayalim)."""
    from conftest import test_veritabani  # noqa: E402
    test_veritabani("durum")
    onceki = durum.TOHUM_DIZINI
    durum.TOHUM_DIZINI = tmp_path_factory.mktemp("tohumlar")
    yield durum.TOHUM_DIZINI
    durum.TOHUM_DIZINI = onceki


def sayim(tablo: str) -> int:
    return db.q1(f"select count(*) c from {tablo}")["c"]


def betik(*argv: str) -> subprocess.CompletedProcess:
    """tools/durum.py'yi ayri surecte kosturur — CLI gercekten calissin."""
    return subprocess.run([sys.executable, str(ROOT / "tools" / "durum.py"), *argv],
                          capture_output=True, text=True,
                          env={**os.environ, "DATABASE_URL": db.DSN,
                               "EKIPTAKIP_TOHUMLAR": str(durum.TOHUM_DIZINI)})


# --- disa aktarma ---------------------------------------------------------

def test_dokum_veri_tasir_sema_tasimaz(veritabani):
    sql = durum.disa_aktar()
    assert "begin;" in sql and "commit;" in sql and "truncate table" in sql
    assert 'insert into "users"' in sql and 'insert into "items"' in sql
    assert "Bütçe onayı 6 gündür bekliyor" in sql
    assert "create table" not in sql              # sema goclerin isi
    assert '"arama"' not in sql                   # uretilmis sutun INSERT'e girmez


def test_dongu_kiran_sutunlar_sonda_baglanir(veritabani):
    sql = durum.disa_aktar()
    assert "donguyu kiran sutunlar" in sql
    baglama = [s for s in sql.splitlines() if s.startswith('update "nodes" set')]
    # kok dugumun parent_id'si null: yalnizca DOLU olanlar sonda baglanir
    assert any('"parent_id" =' in s for s in baglama)
    assert len(baglama) == sayim("nodes")
    assert sql.index('insert into "nodes"') < sql.index(baglama[0])


def test_plan_yalnizca_dongudeki_sutunlari_erteler(veritabani):
    """Sira sabit listeden degil FK grafiginden cikar: sema buyuyunce eskimez."""
    with db.havuz().connection() as c:
        sira, ertelenen = durum.yazma_plani(c)
    assert sira.index("users") < sira.index("items")
    assert sira.index("nodes") < sira.index("items")
    assert sira.index("nodes") < sira.index("users")   # dongu kirildiktan sonraki yon
    assert "parent_id" in ertelenen["nodes"]           # oz-referans
    dongu_sutunlari = ertelenen.get("users", set()) | (ertelenen["nodes"] - {"parent_id"})
    assert len(dongu_sutunlari) == 1                   # dongudeki TEK sutun ertelenir
    assert set(ertelenen) <= {"users", "nodes"}        # baska tabloya bulasmaz


def test_kaydet_ciplak_adi_tohumlara_yazar(veritabani):
    hedef = durum.kaydet("yedek", durum.disa_aktar())
    assert hedef == veritabani / "yedek.sql" and hedef.read_text().startswith("--")


# --- gidis-donus ----------------------------------------------------------

def test_sifirla_yukle_ayni_durumu_getirir(veritabani):
    durum.kaydet("tur", durum.disa_aktar())
    once = durum.sayimlar()

    silinen = durum.sifirla()
    assert "items" in silinen and all(n == 0 for n in durum.sayimlar().values())
    # sema ve goc defteri durur: goc yeniden kosmaz
    assert db.q1("select count(*) c from schema_migrations")["c"] > 0

    sonuc = durum.yukle("tur")
    assert sonuc["sayimlar"] == once
    assert db.q1("select count(*) c from items where title = %s",
                 ("Bütçe onayı 6 gündür bekliyor",))["c"] == 1
    # dongu kiran sutunlar geri baglandi
    assert db.q1("select count(*) c from users where scope_node_id is not null")["c"] == 2
    assert db.q1("select count(*) c from nodes where parent_id is not null")["c"] > 0


def test_varsayilan_tohum_yuklenir(veritabani):
    sonuc = durum.yukle("varsayilan")
    assert sonuc["kaynak"].endswith("seed.py") and sonuc["sayimlar"]["items"] == 5


def test_olmayan_dosya_anlasilir_hata(veritabani):
    with pytest.raises(FileNotFoundError) as e:
        durum.yukle("yok.sql")
    assert "bakilan" in str(e.value)                   # nereye baktigini soyler


# --- komut satiri ---------------------------------------------------------

def test_cli_disa_aktarim_ekrana_basar(veritabani):
    r = betik("disa-aktar")
    assert r.returncode == 0
    assert r.stdout.startswith("-- EkipTakip durum") and 'insert into "users"' in r.stdout


def test_cli_dosyaya_yazar_ve_geri_yukler(veritabani):
    yaz = betik("disa-aktar", "-o", "cli-yedek")
    assert yaz.returncode == 0
    yol = Path(re.search(r"yazildi: (\S+)", yaz.stderr).group(1))
    assert yol.is_file()

    sil = betik("sifirla", "--evet")
    assert sil.returncode == 0 and sayim("items") == 0

    geri = betik("yukle", "cli-yedek")
    assert geri.returncode == 0 and "yuklendi" in geri.stdout
    assert sayim("items") == 5
    assert "yeniden başlat" in geri.stdout             # agac indeksi uyarisi


def test_cli_sifirlama_onaysiz_calismaz(veritabani):
    """Boru hattinda (tty yok) --evet olmadan veri silinmez."""
    once = sayim("items")
    r = betik("sifirla")
    assert r.returncode != 0 and "vazgecildi" in r.stderr
    assert sayim("items") == once


def test_cli_olmayan_tohumda_hata_verir(veritabani):
    r = betik("yukle", "yok.sql")
    assert r.returncode != 0 and "tohum yok" in r.stderr


def test_cli_sayimlar(veritabani):
    r = betik("sayimlar")
    assert r.returncode == 0 and "items=5" in r.stdout
