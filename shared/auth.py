"""Kimlik + yetki (spec/70-guvenlik.md).

Kimlik artik gercek: imzali oturum cerezinden gelir, kullanici satiri HER ISTEKTE
veritabanindan okunur — bu yuzden `is_active = 0` yapilan kisi bir sonraki istekte
disaridadir, ayri bir oturum tablosu tutmaya gerek kalmaz.

Yetki modeli degismedi (spec/10-kararlar.md 'Yetki').
"""
from __future__ import annotations

from . import config, db
from .tree import TreeIndex

COOKIE = "uid"          # yalnizca sahte kimlik modunda (gelistirme/test)


def get_user(user_id):
    kimlik = db.uid(user_id)
    if kimlik is None:
        return None
    return db.q1("select * from users where id = %s", (kimlik,))


def all_users():
    return db.q("select * from users where is_active order by name")


def _aktif(u):
    return u if u is not None and db.as_bool(u["is_active"]) else None


def current_user(request):
    """Oturumdaki kullanici, yoksa None.

    Sahte kimlik modunda (EKIPTAKIP_AUTH=sahte, yayinda acilmaz) oturum yoksa
    `uid` cerezine, o da yoksa ilk kullaniciya duser — gelistirme kolayligi.
    """
    u = _aktif(get_user(request.session.get("uid") if hasattr(request, "session") else None))
    if u is not None:
        return u
    if config.sahte_kimlik():
        return _aktif(get_user(request.cookies.get(COOKIE))) or db.q1(
            # created_at esit olabilir; email ikinci olcut olmadan hangi satirin
            # gelecegi Postgres'te GARANTI DEGIL (SQLite'ta insert sirasi geliyordu).
            "select * from users where is_active order by created_at, email limit 1")
    return None


def participant_ids(item_id) -> set:
    return {r["user_id"] for r in db.q(
        "select user_id from item_participants where item_id = %s", (db.uid(item_id),))}


def can_edit_item(user, item, tree: TreeIndex) -> bool:
    if user is None or item is None:
        return False
    if db.as_bool(user["is_admin"]):
        return True
    if user["id"] in (item["assignee_id"], item["created_by"]):
        return True
    if user["id"] in participant_ids(item["id"]):  # karta dahil edilenler
        return True
    scope = user["scope_node_id"]
    return bool(scope) and tree.is_descendant(item["node_id"], scope)
