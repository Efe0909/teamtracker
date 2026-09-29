"""Davetli listesi betigi — tools/user.py (spec/70-guvenlik.md §2.3).

Bu betik yayinda ilk admini yazmanin TEK yolu: `users`'ta satiri olmayan
kimse giremez. Bu yuzden burada "calisiyor mu" degil "kurulum acilabiliyor
mu" sinaniyor.

Betik ayri SURECTE kosuluyor: argparse + main() + db.pool() zincirinin
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

SCRIPT = ROOT / "tools" / "user.py"


@pytest.fixture(scope="module", autouse=True)
def database():
    from conftest import setup_database  # noqa: E402
    return setup_database("user")


def user(email: str):
    return db.q1("select * from users where lower(email) = lower(%s)", (email,))


def events(email: str):
    return db.q("select * from security_events where email = %s"
                " order by created_at", (email,))


def run(*argv: str) -> subprocess.CompletedProcess:
    """Betigi test veritabanina karsi ayri surecte kosar."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("EKIPTAKIP_")}
    env.update({"PATH": os.environ["PATH"], "DATABASE_URL": db.DSN})
    return subprocess.run([sys.executable, str(SCRIPT), *argv],
                          cwd=ROOT, env=env, capture_output=True, text=True,
                          timeout=60)


def run_ok(*argv: str) -> subprocess.CompletedProcess:
    r = run(*argv)
    assert r.returncode == 0, f"{argv}\n{r.stdout}\n{r.stderr[-800:]}"
    return r


# --- add -----------------------------------------------------------------


def test_ekle_duz():
    run_ok("add", "duz@ornek.com", "Düz Kullanıcı")
    u = user("duz@ornek.com")
    assert u is not None
    # Sutunlar boolean; psycopg int kabul etmiyor. Kimlik testi de bunlari
    # `is True` olarak okuyor, tip kaymasi burada yakalanmali.
    assert u["is_admin"] is False and u["is_editor"] is False
    assert u["is_active"] is True
    assert u["name"] == "Düz Kullanıcı"
    assert u["scope_node_id"] is None
    assert u["color"]


def test_ekle_admin_ayni_zamanda_editordur():
    run_ok("add", "patron@ornek.com", "Patron", "--admin")
    u = user("patron@ornek.com")
    assert u["is_admin"] is True
    assert u["is_editor"] is True, "admin editor yetkisini de kapsar"
    assert u["is_active"] is True


def test_ekle_kapsam_dugume_baglar():
    node = db.q1("select id from nodes where name = %s", ("Malzeme Temini",))
    assert node, "tohumda 'Malzeme Temini' dugumu olmali"
    run_ok("add", "kapsamli@ornek.com", "Kapsamlı", "--scope", "Malzeme Temini")
    assert user("kapsamli@ornek.com")["scope_node_id"] == node["id"]


def test_ekle_editor():
    run_ok("add", "editor@ornek.com", "Editör", "--editor")
    u = user("editor@ornek.com")
    assert u["is_admin"] is False and u["is_editor"] is True


def test_ekle_e_posta_kucuk_harfe_iner():
    run_ok("add", "  Buyuk@Ornek.COM ", "Büyük")
    assert user("buyuk@ornek.com")["email"] == "buyuk@ornek.com"


def test_ekle_var_olani_yazmaz_buyuk_kucuk_harf_farketmez():
    """Tekillik lower(email) indeksinde: cakisma indeks hatasi degil, mesaj olmali."""
    r = run("add", "DUZ@ornek.com", "Kopya")
    assert r.returncode != 0
    assert "zaten var" in r.stdout + r.stderr
    assert user("duz@ornek.com")["name"] == "Düz Kullanıcı"


def test_ekle_olmayan_kapsam_reddedilir():
    r = run("add", "kapsamsiz@ornek.com", "Yok", "--scope", "Olmayan Düğüm")
    assert r.returncode != 0
    assert "dugum yok" in r.stdout + r.stderr
    assert user("kapsamsiz@ornek.com") is None


# --- deactivate / activate -------------------------------------------------


def test_kapat_pasiflestirir_ve_olay_yazar():
    run_ok("add", "gidici@ornek.com", "Gidici")
    before = len(events("gidici@ornek.com"))

    run_ok("deactivate", "gidici@ornek.com")
    assert user("gidici@ornek.com")["is_active"] is False

    rows = events("gidici@ornek.com")
    assert len(rows) == before + 1
    assert rows[-1]["event_type"] == "deactivation"
    assert rows[-1]["detail"] == "kapatildi"
    assert rows[-1]["actor_id"] is None


def test_ac_geri_alir_ve_olay_yazar():
    run_ok("activate", "gidici@ornek.com")
    assert user("gidici@ornek.com")["is_active"] is True

    rows = events("gidici@ornek.com")
    assert rows[-1]["event_type"] == "deactivation"
    assert rows[-1]["detail"] == "acildi"


def test_olmayan_kullanici_kapatilamaz():
    r = run("deactivate", "hicyok@ornek.com")
    assert r.returncode != 0
    assert "kullanici yok" in r.stdout + r.stderr


# --- list --------------------------------------------------------------


def test_listele_kapali_kullaniciyi_isaretler():
    run_ok("deactivate", "editor@ornek.com")
    output = run_ok("list").stdout
    assert "patron@ornek.com" in output and "admin" in output
    line = next(s for s in output.splitlines() if s.startswith("editor@ornek.com"))
    assert "KAPALI" in line
    scope_line = next(s for s in output.splitlines()
                      if s.startswith("kapsamli@ornek.com"))
    assert "Malzeme Temini" in scope_line
