"""Yetki kapsamlari — adlandirilmis izinler (goc 007).

Yetki IKI parcadan olusur:

  1. SCOPE        — ne yapabilir ("edit_nodes").
  2. NODE PERMISSION — hangi dalda yapabilir (user_node_scopes).

Ikisi birlikte gerekir. Kapsami olmayan hicbir dalda duzenleyemez; kapsami
olup izinli dugumu olmayan da duzenleyemez. Admin ikisini de atlar.

Kapsam adlari BURADA tanimli. Veritabani serbest metin kabul ediyor ama
active_scopes() tanimsiz olani eler: yonetim panelinde yapilan bir yazim
hatasi sessizce yetki vermesin.
"""
from __future__ import annotations

from . import db, service

# Kapsam anahtari -> ekranda gorunecek aciklama. Yonetim paneli bu sozlugu
# listeleyecek; yeni kapsam eklemek = buraya bir satir.
SCOPES: dict[str, str] = {
    "edit_nodes": "Yapıyı düzenle — düğüm ekle, adlandır, taşı, sil",
    "manage_users": "Kullanıcı ekle, kapat, yetki ver",
    "manage_teams": "Takım kur, üye ekle ve çıkar",
}

# Dugum bazli izin ISTEYEN kapsamlar. Bunlar icin kapsam tek basina yetmez;
# ayrica hangi dalda gecerli oldugu user_node_scopes'ta yazili olmali.
NODE_DEPENDENT = frozenset({"edit_nodes"})


def valid(name: str) -> bool:
    return name in SCOPES


# --- okuma ----------------------------------------------------------------


def active_scopes(user) -> set[str]:
    """Kullanicinin gecerli kapsamlari.

    Admin HEPSINE sahiptir — yetkilendirmenin tepesi tek yerde kalsin, her
    kontrol ayrica "ya da admin mi" diye sormasin.
    """
    if user is None:
        return set()
    if db.as_bool(user["is_admin"]):
        return set(SCOPES)
    return {r["scope"] for r in
            db.q("select scope from user_scopes where user_id = %s", (db.uid(user["id"]),))
            if valid(r["scope"])}


def has_scope(user, scope: str) -> bool:
    return scope in active_scopes(user)


def permitted_nodes(user) -> list:
    """Dogrudan izin verilmis dugumler (alt agaclari DAHIL DEGIL — o hesap
    authorized_on_node icinde yapiliyor)."""
    if user is None:
        return []
    return [r["node_id"] for r in
            db.q("select node_id from user_node_scopes where user_id = %s",
                 (db.uid(user["id"]),))]


def authorized_on_node(user, node_id, scope: str = "edit_nodes") -> bool:
    """Bu kullanici, bu dugumde bu kapsami kullanabilir mi?

    Izin ALT AGACA MIRAS KALIR: "Maliye"ye izni olan altindaki her seyi
    duzenler. Kontrol TreeIndex uzerinden O(1) (tin/tout araligi), her ata
    icin ayri sorgu yok.
    """
    if user is None:
        return False
    if db.as_bool(user["is_admin"]):
        return True
    if not has_scope(user, scope):
        return False
    if scope not in NODE_DEPENDENT:
        return True

    target = db.uid(node_id)
    if target is None:
        return False
    return any(service.TREE.is_descendant(target, permitted)
               for permitted in permitted_nodes(user))


def can_do_root_operation(user, scope: str = "edit_nodes") -> bool:
    """Kok dugum eklemek/silmek — hicbir ustun altinda degil.

    Dugum izni bir DALI kapsar; kok islemi hicbir dala girmez, o yuzden
    yalnizca admin. Aksi halde bir dala izin verilen kisi agacin yanina
    kendi agacini kurabilirdi.
    """
    return user is not None and db.as_bool(user["is_admin"])


# --- yazma ----------------------------------------------------------------


def grant_scope(user_id, scope: str, granted_by=None) -> bool:
    if not valid(scope):
        return False
    db.x("insert into user_scopes (user_id, scope, granted_by) values (%s,%s,%s)"
         " on conflict (user_id, scope) do nothing",
         (db.uid(user_id), scope, db.uid(granted_by) if granted_by else None))
    return True


def revoke_scope(user_id, scope: str) -> None:
    db.x("delete from user_scopes where user_id = %s and scope = %s",
         (db.uid(user_id), scope))


def grant_node_permission(user_id, node_id, granted_by=None) -> bool:
    target = db.uid(node_id)
    if target is None or target not in service.TREE.nodes:
        return False
    db.x("insert into user_node_scopes (user_id, node_id, granted_by) values (%s,%s,%s)"
         " on conflict (user_id, node_id) do nothing",
         (db.uid(user_id), target, db.uid(granted_by) if granted_by else None))
    return True


def revoke_node_permission(user_id, node_id) -> None:
    db.x("delete from user_node_scopes where user_id = %s and node_id = %s",
         (db.uid(user_id), db.uid(node_id)))
