"""Kullanici davet/durum islemleri — tools/user.py ve /admin paneli AYNI
fonksiyonlari cagirir, mantik kopyalanmaz (TODO.md madde 3,
spec/71-yonetim-paneli.md §5 'Ortak iş mantığı').

Kilitlenme koruması burada: panelin var oluş amacı sunucuya girmeyi
gereksiz kılmak, o yüzden kendi kendini kilitleyemez (aynı §5 'Kilitlenme').
"""
from __future__ import annotations

from . import db

COLORS = ["#5b8cff", "#e5484d", "#d99a2b", "#22a06b", "#7c5bff", "#b4501a"]


class UserError(ValueError):
    """Kullaniciya gosterilecek bir mesajla basarisiz olan islem — CLI
    sys.exit'e, rota 400/403'e cevirir."""


def find_by_email(email: str):
    # Tekillik lower(email) indeksinde (shared/migrations/001_schema.sql);
    # arama da oyle olmali, yoksa "Ayse@..." ile "ayse@..." ayri sanilir.
    return db.q1("select * from users where lower(email) = lower(%s)", (email,))


def list_all() -> list[dict]:
    return db.q("select u.*, n.name node from users u"
                " left join nodes n on n.id = u.scope_node_id order by u.name")


def count_active_admins() -> int:
    return db.q1("select count(*) c from users where is_admin and is_active")["c"]


def add_user(email: str, name: str, *, node_name: str | None = None,
             is_admin: bool = False, is_editor: bool = False) -> dict:
    email = email.strip().lower()
    name = name.strip()
    if not email or not name:
        raise UserError("e-posta ve ad zorunlu")
    if find_by_email(email):
        raise UserError(f"zaten var: {email}")
    node_id = None
    if node_name:
        n = db.q1("select id from nodes where name = %s", (node_name,))
        if n is None:
            raise UserError(f"dugum yok: {node_name!r}")
        node_id = n["id"]
    count = db.q1("select count(*) c from users")["c"]
    user_id = db.new_id()
    db.x("insert into users (id,email,name,color,is_admin,is_editor,scope_node_id,"
         "created_at,is_active) values (%s,%s,%s,%s,%s,%s,%s,%s,true)",
         (user_id, email, name, COLORS[count % len(COLORS)],
          bool(is_admin), bool(is_editor or is_admin), node_id, db.now()))
    return db.q1("select * from users where id = %s", (user_id,))


def set_active(user_id, active: bool, *, actor_id=None) -> None:
    """Ac/kapat. Kapatmak kullaniciyi SILMEZ — kayitlarindaki izleri kalir,
    oturumu bir sonraki istekte duser (shared/auth.py current_user).

    Kilitlenme: sistemdeki SON aktif admin kapatilamaz — yoksa paneli
    yeniden acacak kimse kalmaz."""
    u = db.q1("select * from users where id = %s", (db.uid(user_id),))
    if u is None:
        raise UserError("kullanici yok")
    if not active and db.as_bool(u["is_admin"]) and db.as_bool(u["is_active"]) \
            and count_active_admins() <= 1:
        raise UserError("son aktif admin kapatılamaz")
    db.x("update users set is_active = %s where id = %s", (bool(active), u["id"]))
    db.x("insert into security_events (id,created_at,event_type,actor_id,email,detail)"
         " values (%s,%s,'deactivation',%s,%s,%s)",
         (db.new_id(), db.now(), db.uid(actor_id) if actor_id else None, u["email"],
          "acildi" if active else "kapatildi"))


def set_admin(user_id, is_admin: bool, *, actor_id) -> None:
    """`is_admin` bayrağını çevirir. Kilitlenme: kendi bayrağını kapatamaz,
    sistemin SON adminini demote edemez (spec/71-yonetim-paneli.md §5)."""
    u = db.q1("select * from users where id = %s", (db.uid(user_id),))
    if u is None:
        raise UserError("kullanici yok")
    if not is_admin and db.as_bool(u["is_admin"]):
        if db.uid(actor_id) == u["id"]:
            raise UserError("kendi admin yetkini kapatamazsın")
        if count_active_admins() <= 1:
            raise UserError("son admin demote edilemez")
    db.x("update users set is_admin = %s where id = %s", (bool(is_admin), u["id"]))
    event_type = "admin_granted" if is_admin else "admin_revoked"
    db.x("insert into security_events (id,created_at,event_type,actor_id,email,detail)"
         " values (%s,%s,%s,%s,%s,%s)",
         (db.new_id(), db.now(), event_type, db.uid(actor_id), u["email"], None))
