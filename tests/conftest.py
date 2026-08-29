"""Test ortami: gercek Google girisi yerine sahte kimlik.

Ortam degiskenleri app/config import edilmeden ONCE kurulmali; conftest bunun
icin dogru yer. Olumcul yapilandirma kontrolleri testte uyariya doner
(shared/config._test_kosumu) — yayin surecinde pytest yoktur.
"""
import os

os.environ.setdefault("EKIPTAKIP_AUTH", "sahte")
# Sahte kimlik yalnizca acikca "gelistirme" denince kabul edilir.
os.environ.setdefault("EKIPTAKIP_ENV", "gelistirme")
os.environ.setdefault("EKIPTAKIP_SECRET_KEY", "test-" + "y" * 40)
# Olumcul yapilandirma kontrolleri testte uyariya doner. Bu bayrak YAYINDA
# yok sayilir (shared/config._test_kosumu) — arka kapi degil.
os.environ["EKIPTAKIP_TEST_YAPILANDIRMA"] = "1"


import re  # noqa: E402

import pytest  # noqa: E402

TOKEN_DESENI = re.compile(r'X-CSRF-Token": "([^"]+)"')


@pytest.fixture
def csrf(client):
    """Istemciye CSRF token'ini varsayilan baslik olarak takar.

    Token oturumda durur; sayfadan okunur (tarayicinin yaptigi da bu).
    """
    return csrf_tak(client)


def csrf_tak(client, yol: str = "/") -> str:
    m = TOKEN_DESENI.search(client.get(yol).text)
    assert m, f"{yol} sayfasinda CSRF token'i yok"
    client.headers["X-CSRF-Token"] = m.group(1)
    return m.group(1)


# --- her test modulu kendi veritabanini alir ------------------------------
#
# Testler Postgres'e karsi kosar (spec/80-veritabani.md §5). SQLite'a dusen bir
# yol BILEREK yok: gecisin asil riski lehce farki ve o fark tam da testlerin
# gormedigi yerde kalirdi.

import re as _re  # noqa: E402
import sys as _sys  # noqa: E402
from pathlib import Path as _Path  # noqa: E402

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))


def _yonetim_dsn(dsn: str) -> str:
    return _re.sub(r"/[^/?]+(\?|$)", r"/postgres\1", dsn)


def test_veritabani(ad: str):
    """`ekiptakip_test_<ad>` veritabanini sifirdan kurar ve baglanir."""
    import psycopg

    from shared import db, seed

    temel = os.getenv("DATABASE_URL") or db.DSN
    yeni_ad = f"ekiptakip_test_{ad}"
    try:
        with psycopg.connect(_yonetim_dsn(temel), autocommit=True) as c:
            c.execute(f'drop database if exists "{yeni_ad}" with (force)')
            c.execute(f'create database "{yeni_ad}"')
    except psycopg.OperationalError as e:
        raise RuntimeError(
            "Testler icin PostgreSQL gerekiyor. `docker compose up -d` ile kaldir.\n"
            f"Denenen: {_yonetim_dsn(temel)}\n{e}") from e

    db.baglan(_re.sub(r"/[^/?]+(\?|$)", f"/{yeni_ad}\\1", temel))
    seed.run()
    return db
