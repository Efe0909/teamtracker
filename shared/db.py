"""Ham SQL katmani — PostgreSQL. ORM yok (spec/10-kararlar.md 'Yapma').

Baglanti havuzu psycopg_pool'dan; satirlar dict olarak doner (r["sutun"]).
Yer tutucu %s'dir — SQLite'in ? isareti degil (spec/80-veritabani.md §2).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# Baglanti bilgisi tek yerden. Parola .env'de durur, koda gomulmez.
DSN = os.getenv("DATABASE_URL") or "postgresql://ekiptakip:ekiptakip@127.0.0.1:5432/ekiptakip"
MIGRATIONS_DIR = Path(__file__).parent / "migrations"

_pool: ConnectionPool | None = None


def new_id() -> UUID:
    """Kimlikler sunucuda da uretilebilir (gen_random_uuid) ama tohum ve
    ekleme yollarinda deger Python'da uretiliyor — iliskileri kurarken elde
    id'ye ihtiyac var."""
    return uuid4()


def uid(x) -> UUID | None:
    """HTTP'den gelen metni uuid'e cevirir; gecersizse None.

    Yol parametreleri ve form alanlari metindir, sutunlar uuid. Cevrim tek
    yerde olsun ki bozuk bir deger 500 degil "bulunamadi" versin.
    """
    if isinstance(x, UUID):
        return x
    try:
        return UUID(str(x))
    except (ValueError, AttributeError, TypeError):
        return None


def now() -> datetime:
    """Zamanlar artik metin degil: timestamptz. Diliminden emin ol, UTC yaz."""
    return datetime.now(timezone.utc)


def as_bool(v) -> bool:
    """Postgres zaten boolean donuyor; cagri yerleri degismesin diye duruyor."""
    return bool(v)


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(DSN, min_size=1, max_size=8, kwargs={"row_factory": dict_row},
                               open=True, timeout=10)
        _pool.wait(timeout=15)
    return _pool


def connect(dsn: str | None = None) -> ConnectionPool:
    """Testler ve betikler baska bir veritabanina gecebilsin diye."""
    global DSN, _pool
    if dsn:
        close()
        DSN = dsn
    return pool()


def close() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


# --- sorgular -------------------------------------------------------------


def q(sql: str, args: tuple = ()) -> list[dict]:
    with pool().connection() as c:
        return c.execute(sql, args).fetchall()


def q1(sql: str, args: tuple = ()) -> dict | None:
    with pool().connection() as c:
        return c.execute(sql, args).fetchone()


def x(sql: str, args: tuple = ()) -> None:
    """Yazma. Baglam yoneticisi cikista commit eder, hatada geri alir."""
    with pool().connection() as c:
        c.execute(sql, args)


def execute_script(sql: str) -> None:
    """Cok ifadeli betik (goc dosyalari)."""
    with pool().connection() as c:
        c.execute(sql)


# --- migrations -------------------------------------------------------------


def migrate() -> list[str]:
    """shared/migrations/*.sql dosyalarini sirayla uygular. Idempotent.

    Elle yazilmis alter table'lar yerine numarali dosyalar: hangi surumun
    uygulandigi veritabaninda yazili durur (spec/80-veritabani.md §4).
    Her dosya KENDI isleminde kosar; yarim kalan goc kaydedilmez.
    """
    with pool().connection() as c:
        c.execute("create table if not exists schema_migrations ("
                  " name text primary key, applied_at timestamptz not null default now())")
        applied = {r["name"] for r in c.execute("select name from schema_migrations").fetchall()}

    done: list[str] = []
    for file in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if file.name in applied:
            continue
        with pool().connection() as c:
            c.execute(file.read_text(encoding="utf-8"))
            c.execute("insert into schema_migrations (name) values (%s)", (file.name,))
        done.append(file.name)
    return done
