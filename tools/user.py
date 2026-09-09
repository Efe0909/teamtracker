"""Davetli listesi yonetimi (spec/70-guvenlik.md §2.3).

Giris yalnizca `users` tablosunda kayitli e-postalara acik. /admin paneli
gelene kadar (spec/71-yonetim-paneli.md) sunucuda kabuk acmak tek yoldu; artik
break-glass — panel calismiyorsa ya da hic kullanici yoksa hala bu.

Mantik burada degil: shared/users.py'de. Bu betik ince bir CLI kabugu, panel
ile AYNI fonksiyonlari cagirir (TODO.md madde 3 'aynı iş mantığını çağırsın').

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

from shared import db, users  # noqa: E402


def list_users() -> None:
    rows = users.list_all()
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
    try:
        u = users.add_user(email, name, node_name=scope, is_admin=admin, is_editor=editor)
    except users.UserError as e:
        sys.exit(f"{e}  (yetki degistirmek icin dogrudan SQL)" if "zaten var" in str(e) else str(e))
    print(f"eklendi: {u['email']} ({u['name']})"
          f"{' · admin' if admin else ''}{' · kapsam: ' + scope if scope else ''}")
    print("Not: kişi Google ile ilk girdiğinde hesabı bu satıra bağlanır.")


def set_active(email: str, active: bool) -> None:
    u = users.find_by_email(email.strip().lower())
    if u is None:
        sys.exit(f"kullanici yok: {email}")
    try:
        users.set_active(u["id"], active)
    except users.UserError as e:
        sys.exit(str(e))
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
