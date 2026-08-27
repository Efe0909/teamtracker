"""Ham SQL katmani. ORM yok (00-BASLA.md 'Yapma')."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

DB_PATH = Path(__file__).parent / "ekiptakip.db"
SCHEMA_PATH = Path(__file__).parent / "schema.sql"

_conn: sqlite3.Connection | None = None


def new_id() -> str:
    """TEXT id — Postgres'e tasindiginda uuid sutununa bire bir oturur."""
    return uuid4().hex


def now() -> str:
    """ISO-8601 UTC. CURRENT_TIMESTAMP kullanilmaz, deger Python'da uretilir."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def as_bool(v) -> bool:
    """INTEGER 0/1 -> bool cevirimi tek yerde."""
    return bool(v)


def connect(path: Path | None = None) -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(path or DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("pragma foreign_keys = on")
    return _conn


def init(path: Path | None = None) -> sqlite3.Connection:
    conn = connect(path)
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.commit()
    return conn


def q(sql: str, args: tuple = ()) -> list[sqlite3.Row]:
    return connect().execute(sql, args).fetchall()


def q1(sql: str, args: tuple = ()) -> sqlite3.Row | None:
    return connect().execute(sql, args).fetchone()


def x(sql: str, args: tuple = ()) -> None:
    conn = connect()
    conn.execute(sql, args)
    conn.commit()
