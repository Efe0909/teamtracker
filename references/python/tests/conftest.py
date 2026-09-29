"""Test ortami: gercek Google girisi yerine sahte kimlik.

Ortam degiskenleri app/config import edilmeden ONCE kurulmali; conftest bunun
icin dogru yer. Olumcul yapilandirma kontrolleri testte uyariya doner
(shared/config._test_run) — yayin surecinde pytest yoktur.
"""
import os

os.environ.setdefault("EKIPTAKIP_AUTH", "sahte")
# Sahte kimlik yalnizca acikca "gelistirme" denince kabul edilir.
os.environ.setdefault("EKIPTAKIP_ENV", "gelistirme")
os.environ.setdefault("EKIPTAKIP_SECRET_KEY", "test-" + "y" * 40)
# Olumcul yapilandirma kontrolleri testte uyariya doner. Bu bayrak YAYINDA
# yok sayilir (shared/config._test_run) — arka kapi degil.
os.environ["EKIPTAKIP_TEST_CONFIG"] = "1"


import re  # noqa: E402

import pytest  # noqa: E402

TOKEN_PATTERN = re.compile(r'X-CSRF-Token": "([^"]+)"')


@pytest.fixture
def csrf(client):
    """Istemciye CSRF token'ini varsayilan baslik olarak takar.

    Token oturumda durur; sayfadan okunur (tarayicinin yaptigi da bu).
    """
    return csrf_attach(client)


def csrf_attach(client, path: str = "/") -> str:
    m = TOKEN_PATTERN.search(client.get(path).text)
    assert m, f"{path} sayfasinda CSRF token'i yok"
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


def _admin_dsn(dsn: str) -> str:
    return _re.sub(r"/[^/?]+(\?|$)", r"/postgres\1", dsn)


def setup_database(name: str):
    """`ekiptakip_test_<name>` veritabanini sifirdan kurar ve baglanir."""
    import psycopg

    from shared import db, seed

    base = os.getenv("DATABASE_URL") or db.DSN
    new_name = f"ekiptakip_test_{name}"
    try:
        with psycopg.connect(_admin_dsn(base), autocommit=True) as c:
            c.execute(f'drop database if exists "{new_name}" with (force)')
            c.execute(f'create database "{new_name}"')
    except psycopg.OperationalError as e:
        raise RuntimeError(
            "Testler icin PostgreSQL gerekiyor. `docker compose up -d` ile kaldir.\n"
            f"Denenen: {_admin_dsn(base)}\n{e}") from e

    db.connect(_re.sub(r"/[^/?]+(\?|$)", f"/{new_name}\\1", base))
    seed.run()
    return db
