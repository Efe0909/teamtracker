"""Kimlik + yetki (spec/70-guvenlik.md).

Kimlik artik gercek: imzali oturum cerezinden gelir, kullanici satiri HER ISTEKTE
veritabanindan okunur — bu yuzden `is_active = 0` yapilan kisi bir sonraki istekte
disaridadir, ayri bir oturum tablosu tutmaya gerek kalmaz.

Yetki modeli degismedi (spec/10-kararlar.md 'Yetki').
"""
from __future__ import annotations

from datetime import timedelta

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


# --- varlik (presence) ----------------------------------------------------
#
# "Cevrimici" ayri bir durum degil, turetilmis bir soru: son gorulme
# yeterince yakin mi? Bu yuzden oturum tablosu yok, tek sutun var
# (users.last_seen_at, goc 004).

CEVRIMICI_ESIGI = timedelta(minutes=2)     # bundan yeniyse cevrimici sayilir
_ISARET_ARALIGI = timedelta(seconds=60)    # ayni kullanici icin en sik yazma

# Kullanici basina son YAZMA ani. Surec bellegi yeterli: agac indeksi de oyle
# tutuluyor ve --workers 1 zaten sart (spec/10-kararlar.md). Ikinci bir isci
# olsaydi en kotu ihtimalle biraz fazla UPDATE olurdu, veri bozulmazdi.
_son_isaret: dict = {}


def _varligi_isaretle(u) -> None:
    """last_seen_at'i gunceller — ama her istekte DEGIL.

    current_user her istekte cagriliyor; her seferinde UPDATE atmak sayfa
    basina birkac gereksiz yazma demekti. Kullanici basina dakikada bir
    yeterli: esik iki dakika, yani gecikme goruntuyu bozmuyor.
    """
    simdi = db.now()
    kimlik = u["id"]
    onceki = _son_isaret.get(kimlik)
    if onceki is not None and simdi - onceki < _ISARET_ARALIGI:
        return
    _son_isaret[kimlik] = simdi
    db.x("update users set last_seen_at = %s where id = %s", (simdi, kimlik))


def cevrimici(u) -> bool:
    """Satirdaki last_seen_at'e gore: su an cevrimici mi?"""
    an = u.get("last_seen_at") if hasattr(u, "get") else None
    return an is not None and db.now() - an < CEVRIMICI_ESIGI


def current_user(request):
    """Oturumdaki kullanici, yoksa None.

    Sahte kimlik modunda (EKIPTAKIP_AUTH=sahte, yayinda acilmaz) oturum yoksa
    `uid` cerezine, o da yoksa ilk kullaniciya duser — gelistirme kolayligi.
    """
    u = _aktif(get_user(request.session.get("uid") if hasattr(request, "session") else None))
    if u is None and config.sahte_kimlik():
        u = _aktif(get_user(request.cookies.get(COOKIE))) or db.q1(
            # created_at esit olabilir; email ikinci olcut olmadan hangi satirin
            # gelecegi Postgres'te GARANTI DEGIL (SQLite'ta insert sirasi geliyordu).
            "select * from users where is_active order by created_at, email limit 1")
    if u is not None:
        # Varlik damgasi TAM BURADA: kimlik cozulen her istek bir hayat
        # belirtisidir. Ayri bir "ben buradayim" ucu yok — o hem fazladan
        # istek hem de kapatilabilir bir yol olurdu.
        _varligi_isaretle(u)
    return u


def participant_ids(item_id) -> set:
    return {r["user_id"] for r in db.q(
        "select user_id from item_participants where item_id = %s", (db.uid(item_id),))}


def team_ids(user_id: str) -> set[str]:
    return {r["team_id"] for r in db.q(
        "select team_id from team_members where user_id = %s", (db.uid(user_id),))}


def can_post_team(user, team_id) -> bool:
    """Takim duvarina YAZMA: uyeler ve admin.

    Okuma herkese acik — kim ne konusuyor ekip icinde saydam kalsin; yazan
    takimin uyesi olsun (spec/20-sema.md §2a). Kart yetkisiyle karistirma:
    duvar kartin degil takimin akisi, kapsam (scope_node_id) buraya karismaz.
    """
    if user is None:
        return False
    if db.as_bool(user["is_admin"]):
        return True
    return db.uid(team_id) in team_ids(user["id"])


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
