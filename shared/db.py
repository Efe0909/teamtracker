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

    # ONCE eksik tablolar: schema.sql'in tamami 'create ... if not exists' (tek
    # insert'ler tetikleyicilerin ICINDE), yani betigi bastan calistirmak varolan
    # veriye dokunmaz. Tek tek ifade kesmiyoruz: teams'in hemen ardinda index
    # yok, metin kesimi komsu tablolari da yutuyordu.
    # Sutun eklemeler bundan SONRA gelir; yoksa hic tablosu olmayan bir
    # veritabaninda `alter table` bulunmayan tabloya carpar.
    tablolar = {r["name"] for r in conn.execute(
        "select name from sqlite_master where type='table'")}
    eksik = {"guvenlik_olaylari", "teams", "team_members", "actions"} - tablolar
    if eksik:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        yapildi.extend(sorted(eksik))

    var = {r["name"] for r in conn.execute("pragma table_info(users)")}
    for sutun, tanim in (("google_sub", "text"),
                         ("is_active", "integer not null default 1"),
                         ("last_login_at", "text")):
        if sutun not in var:
            conn.execute(f"alter table users add column {sutun} {tanim}")
            yapildi.append(f"users.{sutun}")
    conn.execute("create unique index if not exists users_google_sub_idx"
                 " on users(google_sub) where google_sub is not null")
    # Eski veritabaninda email sutunu 'collate nocase' DEGIL ve SQLite bunu
    # sonradan degistirmeye izin vermez. Tekilligi ifade uzerinden garanti et:
    # 'Efe@x' ile 'efe@x' iki satir olamasin.
    conn.execute("create unique index if not exists users_email_nocase_idx"
                 " on users(lower(email))")

    # items.team_id: takim ekrani ile geldi, eski items tablosunda yok.
    icols = {r["name"] for r in conn.execute("pragma table_info(items)")}
    if icols and "team_id" not in icols:
        conn.execute("alter table items add column team_id text references teams(id)")
        yapildi.append("items.team_id")

    conn.commit()
    return yapildi


def q(sql: str, args: tuple = ()) -> list[sqlite3.Row]:
    return connect().execute(sql, args).fetchall()


def q1(sql: str, args: tuple = ()) -> sqlite3.Row | None:
    return connect().execute(sql, args).fetchone()


def x(sql: str, args: tuple = ()) -> None:
    conn = connect()
    conn.execute(sql, args)
    conn.commit()
