"""Kimlik + yetki. Faz 1'de kimlik sahte, YETKI GERCEK (spec/10-kararlar.md 'Kimlik').

current_user icerigi Faz 2'de OAuth'a baglanir; cagri yerleri degismez.
"""
from __future__ import annotations

from . import db
from .tree import TreeIndex

COOKIE = "uid"


def get_user(user_id: str | None):
    if not user_id:
        return None
    return db.q1("select * from users where id = ?", (user_id,))


def all_users():
    return db.q("select * from users order by name")


def current_user(request):
    """Faz 2'de burasi OAuth'a baglanir."""
    u = get_user(request.cookies.get(COOKIE))
    if u is None:
        u = db.q1("select * from users order by created_at limit 1")
    return u


def participant_ids(item_id: str) -> set[str]:
    return {r["user_id"] for r in db.q(
        "select user_id from item_participants where item_id = ?", (item_id,))}


def team_ids(user_id: str) -> set[str]:
    return {r["team_id"] for r in db.q(
        "select team_id from team_members where user_id = ?", (user_id,))}


def can_edit_item(user, item, tree: TreeIndex) -> bool:
    """Kart yetkisinin yollari: admin, atanan/açan, karta dahil, kartin takiminin
    uyesi (spec/20-sema.md §2a), ya da dugum kapsam alt agacinda."""
    if user is None or item is None:
        return False
    if db.as_bool(user["is_admin"]):
        return True
    if user["id"] in (item["assignee_id"], item["created_by"]):
        return True
    if user["id"] in participant_ids(item["id"]):  # karta dahil edilenler
        return True
    if item["team_id"] and item["team_id"] in team_ids(user["id"]):
        return True
    scope = user["scope_node_id"]
    return bool(scope) and tree.is_descendant(item["node_id"], scope)
