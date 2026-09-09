"""Davetli listesi yonetimi (spec/70-guvenlik.md §2.3).

Giris yalnizca `users` tablosunda kayitli e-postalara acik. Bu betik o listeyi
yonetir — yonetim ekrani gelene kadar tek yol budur.

  .venv/bin/python tools/user.py list
  .venv/bin/python tools/user.py add ayse@ornek.com "Ayşe" --scope "Malzeme Temini"
  .venv/bin/python tools/user.py add admin@ornek.com "Efe" --admin
  .venv/bin/python tools/user.py deactivate ayse@ornek.com
  .venv/bin/python tools/user.py activate ayse@ornek.com

Kapatmak kullaniciyi SILMEZ: kayitlarindaki izleri kalir, ama varolan oturumu
bir sonraki istekte duser ve bir daha giremez.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared import db  # noqa: E402

COLORS = ["#5b8cff", "#e5484d", "#d99a2b", "#22a06b", "#7c5bff", "#b4501a"]


def _user(email: str):
    # Tekillik lower(email) indeksinde (shared/migrations/001_schema.sql); arama da
    # oyle olmali, yoksa "Ayse@..." ile "ayse@..." ayri kullanici sanilir.
    return db.q1("select * from users where lower(email) = lower(%s)", (email,))


def list_users() -> None:
    rows = db.q("select u.*, n.name node from users u"
                " left join nodes n on n.id = u.scope_node_id order by u.name")
    if not rows:
        print("Liste boş. `add` ile ilk kullanıcıyı yaz.")
        return
    print(f"{'e-posta':32} {'ad':14} {'yetki':8} {'durum':6} kapsam")
    for u in rows:
        role = "admin" if db.as_bool(u["is_admin"]) else (
            "editor" if db.as_bool(u["is_editor"]) else "-")
        status = "aktif" if db.as_bool(u["is_active"]) else "KAPALI"
        print(f"{u['email']:32} {u['name']:14} {role:8} {status:6} {u['node'] or '-'}")


def add(email: str, name: str, scope: str | None, admin: bool, editor: bool) -> None:
    email = email.strip().lower()
    if _user(email):
        sys.exit(f"zaten var: {email}  (yetki degistirmek icin dogrudan SQL)")
    node_id = None
    if scope:
        n = db.q1("select id from nodes where name = %s", (scope,))
        if n is None:
            sys.exit(f"dugum yok: {scope!r}")
        node_id = n["id"]
    count = db.q1("select count(*) c from users")["c"]
    db.x("insert into users (id,email,name,color,is_admin,is_editor,scope_node_id,"
         "created_at,is_active) values (%s,%s,%s,%s,%s,%s,%s,%s,true)",
         (db.new_id(), email, name, COLORS[count % len(COLORS)],
          bool(admin), bool(editor or admin), node_id, db.now()))
    print(f"eklendi: {email} ({name})"
          f"{' · admin' if admin else ''}{' · kapsam: ' + scope if scope else ''}")
    print("Not: kişi Google ile ilk girdiğinde hesabı bu satıra bağlanır.")


def set_active(email: str, active: bool) -> None:
    u = _user(email.strip().lower())
    if u is None:
        sys.exit(f"kullanici yok: {email}")
    db.x("update users set is_active = %s where id = %s", (bool(active), u["id"]))
    db.x("insert into security_events (id,created_at,event_type,actor_id,email,detail)"
         " values (%s,%s,'deactivation',null,%s,%s)",
         (db.new_id(), db.now(), u["email"], "acildi" if active else "kapatildi"))
    print(f"{u['email']}: {'açıldı' if active else 'KAPATILDI (oturumu bir sonraki istekte düşer)'}")


def main() -> None:
    ap = argparse.ArgumentParser(description="EkipTakip davetli listesi")
    sub = ap.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    a = sub.add_parser("add")
    a.add_argument("email"); a.add_argument("name")
    a.add_argument("--scope", help="düğüm adı (ör. 'Malzeme Temini')")
    a.add_argument("--admin", action="store_true")
    a.add_argument("--editor", action="store_true")
    for name in ("deactivate", "activate"):
        k = sub.add_parser(name); k.add_argument("email")
    args = ap.parse_args()

    db.pool()
    db.migrate()
    if args.command == "list":
        list_users()
    elif args.command == "add":
        add(args.email, args.name, args.scope, args.admin, args.editor)
    else:
        set_active(args.email, args.command == "activate")


if __name__ == "__main__":
    main()
