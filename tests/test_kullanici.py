"""Davetli listesi betigi — tools/kullanici.py (spec/70-guvenlik.md §2.3).

Bu betik yayinda ilk admini yazmanin TEK yolu: `users`'ta satiri olmayan
kimse giremez. Bu yuzden burada "calisiyor mu" degil "kurulum acilabiliyor
mu" sinaniyor.

Betik ayri SURECTE kosuluyor: argparse + main() + db.havuz() zincirinin
tamami dahil olsun diye. Postgres gecisinde tam bu zincir gozden kacmisti
(int -> boolean sutun hatasi), in-process cagri onu yakalamazdi.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared import db  # noqa: E402

BETIK = ROOT / "tools" / "kullanici.py"


@pytest.fixture(scope="module", autouse=True)
def veritabani():
    from conftest import test_veritabani  # noqa: E402
    return test_veritabani("kullanici")


def kullanici(email: str):
    return db.q1("select * from users where lower(email) = lower(%s)", (email,))


def olaylar(email: str):
    return db.q("select * from guvenlik_olaylari where email = %s"
                " order by created_at", (email,))


def calistir(*argv: str) -> subprocess.CompletedProcess:
    """Betigi test veritabanina karsi ayri surecte kosar."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("EKIPTAKIP_")}
    env.update({"PATH": os.environ["PATH"], "DATABASE_URL": db.DSN})
    return subprocess.run([sys.executable, str(BETIK), *argv],
                          cwd=ROOT, env=env, capture_output=True, text=True,
                          timeout=60)


def basarili(*argv: str) -> subprocess.CompletedProcess:
    r = calistir(*argv)
    assert r.returncode == 0, f"{argv}\n{r.stdout}\n{r.stderr[-800:]}"
    return r


# --- ekle -----------------------------------------------------------------


def test_ekle_duz():
    basarili("ekle", "duz@ornek.com", "Düz Kullanıcı")
    u = kullanici("duz@ornek.com")
    assert u is not None
    # Sutunlar boolean; psycopg int kabul etmiyor. Kimlik testi de bunlari
    # `is True` olarak okuyor, tip kaymasi burada yakalanmali.
    assert u["is_admin"] is False and u["is_editor"] is False
    assert u["is_active"] is True
    assert u["name"] == "Düz Kullanıcı"
    assert u["scope_node_id"] is None
    assert u["color"]


def test_ekle_admin_ayni_zamanda_editordur():
    basarili("ekle", "patron@ornek.com", "Patron", "--admin")
    u = kullanici("patron@ornek.com")
    assert u["is_admin"] is True
    assert u["is_editor"] is True, "admin editor yetkisini de kapsar"
    assert u["is_active"] is True


def test_ekle_kapsam_dugume_baglar():
    dugum = db.q1("select id from nodes where name = %s", ("Malzeme Temini",))
    assert dugum, "tohumda 'Malzeme Temini' dugumu olmali"
    basarili("ekle", "kapsamli@ornek.com", "Kapsamlı", "--kapsam", "Malzeme Temini")
    assert kullanici("kapsamli@ornek.com")["scope_node_id"] == dugum["id"]


def test_ekle_editor():
    basarili("ekle", "editor@ornek.com", "Editör", "--editor")
    u = kullanici("editor@ornek.com")
    assert u["is_admin"] is False and u["is_editor"] is True


def test_ekle_e_posta_kucuk_harfe_iner():
    basarili("ekle", "  Buyuk@Ornek.COM ", "Büyük")
    assert kullanici("buyuk@ornek.com")["email"] == "buyuk@ornek.com"


def test_ekle_var_olani_yazmaz_buyuk_kucuk_harf_farketmez():
    """Tekillik lower(email) indeksinde: cakisma indeks hatasi degil, mesaj olmali."""
    r = calistir("ekle", "DUZ@ornek.com", "Kopya")
    assert r.returncode != 0
    assert "zaten var" in r.stdout + r.stderr
    assert kullanici("duz@ornek.com")["name"] == "Düz Kullanıcı"


def test_ekle_olmayan_kapsam_reddedilir():
    r = calistir("ekle", "kapsamsiz@ornek.com", "Yok", "--kapsam", "Olmayan Düğüm")
    assert r.returncode != 0
    assert "dugum yok" in r.stdout + r.stderr
    assert kullanici("kapsamsiz@ornek.com") is None


# --- kapat / ac -----------------------------------------------------------


def test_kapat_pasiflestirir_ve_olay_yazar():
    basarili("ekle", "gidici@ornek.com", "Gidici")
    onceki = len(olaylar("gidici@ornek.com"))

    basarili("kapat", "gidici@ornek.com")
    assert kullanici("gidici@ornek.com")["is_active"] is False

    kayitlar = olaylar("gidici@ornek.com")
    assert len(kayitlar) == onceki + 1
    assert kayitlar[-1]["tur"] == "pasiflestirme"
    assert kayitlar[-1]["detay"] == "kapatildi"
    assert kayitlar[-1]["actor_id"] is None


def test_ac_geri_alir_ve_olay_yazar():
    basarili("ac", "gidici@ornek.com")
    assert kullanici("gidici@ornek.com")["is_active"] is True

    kayitlar = olaylar("gidici@ornek.com")
    assert kayitlar[-1]["tur"] == "pasiflestirme"
    assert kayitlar[-1]["detay"] == "acildi"


def test_olmayan_kullanici_kapatilamaz():
    r = calistir("kapat", "hicyok@ornek.com")
    assert r.returncode != 0
    assert "kullanici yok" in r.stdout + r.stderr


# --- listele --------------------------------------------------------------


def test_listele_kapali_kullaniciyi_isaretler():
    basarili("kapat", "editor@ornek.com")
    cikti = basarili("listele").stdout
    assert "patron@ornek.com" in cikti and "admin" in cikti
    satir = next(s for s in cikti.splitlines() if s.startswith("editor@ornek.com"))
    assert "KAPALI" in satir
    kapsam_satiri = next(s for s in cikti.splitlines()
                         if s.startswith("kapsamli@ornek.com"))
    assert "Malzeme Temini" in kapsam_satiri
