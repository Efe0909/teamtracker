"""Davetli listesi yonetimi (spec/70-guvenlik.md §2.3).

Giris yalnizca `users` tablosunda kayitli e-postalara acik. Bu betik o listeyi
yonetir — yonetim ekrani gelene kadar tek yol budur.

  .venv/bin/python tools/kullanici.py listele
  .venv/bin/python tools/kullanici.py ekle ayse@ornek.com "Ayşe" --kapsam "Malzeme Temini"
  .venv/bin/python tools/kullanici.py ekle admin@ornek.com "Efe" --admin
  .venv/bin/python tools/kullanici.py kapat ayse@ornek.com
  .venv/bin/python tools/kullanici.py ac ayse@ornek.com

Kapatmak kullaniciyi SILMEZ: kayitlarindaki izleri kalir, ama varolan oturumu
bir sonraki istekte duser ve bir daha giremez.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared import db  # noqa: E402

RENKLER = ["#5b8cff", "#e5484d", "#d99a2b", "#22a06b", "#7c5bff", "#b4501a"]


def _kullanici(email: str):
    return db.q1("select * from users where email = %s", (email,))


def listele() -> None:
    satirlar = db.q("select u.*, n.name node from users u"
                    " left join nodes n on n.id = u.scope_node_id order by u.name")
    if not satirlar:
        print("Liste boş. `ekle` ile ilk kullanıcıyı yaz.")
        return
    print(f"{'e-posta':32} {'ad':14} {'yetki':8} {'durum':6} kapsam")
    for u in satirlar:
        yetki = "admin" if db.as_bool(u["is_admin"]) else (
            "editor" if db.as_bool(u["is_editor"]) else "-")
        durum = "aktif" if db.as_bool(u["is_active"]) else "KAPALI"
        print(f"{u['email']:32} {u['name']:14} {yetki:8} {durum:6} {u['node'] or '-'}")


def ekle(email: str, ad: str, kapsam: str | None, admin: bool, editor: bool) -> None:
    email = email.strip().lower()
    if _kullanici(email):
        sys.exit(f"zaten var: {email}  (yetki degistirmek icin dogrudan SQL)")
    node_id = None
    if kapsam:
        n = db.q1("select id from nodes where name = %s", (kapsam,))
        if n is None:
            sys.exit(f"dugum yok: {kapsam!r}")
        node_id = n["id"]
    sayi = db.q1("select count(*) c from users")["c"]
    db.x("insert into users (id,email,name,color,is_admin,is_editor,scope_node_id,"
         "created_at,is_active) values (%s,%s,%s,%s,%s,%s,%s,%s,1)",
         (db.new_id(), email, ad, RENKLER[sayi % len(RENKLER)],
          int(admin), int(editor or admin), node_id, db.now()))
    print(f"eklendi: {email} ({ad})"
          f"{' · admin' if admin else ''}{' · kapsam: ' + kapsam if kapsam else ''}")
    print("Not: kişi Google ile ilk girdiğinde hesabı bu satıra bağlanır.")


def durum(email: str, aktif: bool) -> None:
    u = _kullanici(email.strip().lower())
    if u is None:
        sys.exit(f"kullanici yok: {email}")
    db.x("update users set is_active = %s where id = %s", (int(aktif), u["id"]))
    db.x("insert into guvenlik_olaylari (id,created_at,tur,actor_id,email,detay)"
         " values (%s,%s,'pasiflestirme',null,%s,%s)",
         (db.new_id(), db.now(), u["email"], "acildi" if aktif else "kapatildi"))
    print(f"{u['email']}: {'açıldı' if aktif else 'KAPATILDI (oturumu bir sonraki istekte düşer)'}")


def main() -> None:
    ap = argparse.ArgumentParser(description="EkipTakip davetli listesi")
    alt = ap.add_subparsers(dest="komut", required=True)
    alt.add_parser("listele")
    e = alt.add_parser("ekle")
    e.add_argument("email"); e.add_argument("ad")
    e.add_argument("--kapsam", help="düğüm adı (ör. 'Malzeme Temini')")
    e.add_argument("--admin", action="store_true")
    e.add_argument("--editor", action="store_true")
    for ad_ in ("kapat", "ac"):
        k = alt.add_parser(ad_); k.add_argument("email")
    a = ap.parse_args()

    db.havuz()
    db.gocler()
    if a.komut == "listele":
        listele()
    elif a.komut == "ekle":
        ekle(a.email, a.ad, a.kapsam, a.admin, a.editor)
    else:
        durum(a.email, a.komut == "ac")


if __name__ == "__main__":
    main()
