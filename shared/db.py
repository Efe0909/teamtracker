"""Ham SQL katmani. ORM yok (spec/10-kararlar.md 'Yapma')."""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

# Veritabani depo kokunde, iki site icin ORTAK. Ayrik veritabanina gecis
# gerekirse (spec/50-yapi.md) degisecek tek yer burasi: EKIPTAKIP_DB.
DB_PATH = Path(os.getenv("EKIPTAKIP_DB") or Path(__file__).resolve().parents[1] / "ekiptakip.db")
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


def gocler() -> list[str]:
    """Kurulu veritabanini guncel semaya tasir. Acilista calisir, idempotent.

    `create table if not exists` varolan tabloya SUTUN EKLEMEZ; bu yuzden yeni
    sutunlar burada tek tek eklenir. Alternatifi `make seed` idi, o da butun
    gercek veriyi siler.
    """
    conn = connect()
    yapildi: list[str] = []

    var = {r["name"] for r in conn.execute("pragma table_info(users)")}
    for sutun, tanim in (("google_sub", "text"),
                         ("is_active", "integer not null default 1"),
                         ("last_login_at", "text")):
        if sutun not in var:
            conn.execute(f"alter table users add column {sutun} {tanim}")
            yapildi.append(f"users.{sutun}")
    if "google_sub" in yapildi[0:1] or "users.google_sub" in yapildi:
        conn.execute("create unique index if not exists users_google_sub_idx"
                     " on users(google_sub) where google_sub is not null")

    # Yeni tablolar/indeksler: semadaki create ... if not exists ifadeleri zaten
    # idempotent, tumunu calistirmak yerine yalnizca eksik olani kur.
    tablolar = {r["name"] for r in conn.execute(
        "select name from sqlite_master where type='table'")}
    if "guvenlik_olaylari" not in tablolar:
        conn.executescript(_govde("create table if not exists guvenlik_olaylari"))
        yapildi.append("guvenlik_olaylari")
    conn.commit()
    return yapildi


def _govde(baslangic: str) -> str:
    """schema.sql icinden tek bir ifadeyi ve ardindaki indeksleri ceker."""
    metin = SCHEMA_PATH.read_text(encoding="utf-8")
    i = metin.index(baslangic)
    j = metin.index(";", metin.index("create index", i)) + 1
    return metin[i:j]


def q(sql: str, args: tuple = ()) -> list[sqlite3.Row]:
    return connect().execute(sql, args).fetchall()


def q1(sql: str, args: tuple = ()) -> sqlite3.Row | None:
    return connect().execute(sql, args).fetchone()


def x(sql: str, args: tuple = ()) -> None:
    conn = connect()
    conn.execute(sql, args)
    conn.commit()
