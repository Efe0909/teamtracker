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
    """Kullanicinin gecerli kapsamlari: dogrudan verilenler ILE rollerden
    gelenlerin BIRLESIMI (union, tek sorgu).

    Flatten YOK — rol duzenlemesi (scope ekle/cikar) burada okuma aninda
    hesaplandigi icin mevcut sahiplerine otomatik yansir, ayri bir "yayinla"
    adimi gerekmez (spec/71-yonetim-paneli.md §5).

    Admin HEPSINE sahiptir — yetkilendirmenin tepesi tek yerde kalsin, her
    kontrol ayrica "ya da admin mi" diye sormasin.
    """
    if user is None:
        return set()
    if db.as_bool(user["is_admin"]):
        return set(SCOPES)
    uid = db.uid(user["id"])
    rows = db.q(
        "select scope from user_scopes where user_id = %s"
        " union"
        " select rs.scope from user_roles ur"
        "   join role_scopes rs on rs.role_id = ur.role_id"
        "  where ur.user_id = %s",
        (uid, uid))
    return {r["scope"] for r in rows if valid(r["scope"])}


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


# --- roller -----------------------------------------------------------
#
# Rol = scope demeti, sığ (goc 008). user_roles TEK BASINA hicbir zaman
# yetki kontrolunde okunmaz — daima role_scopes ile join edilir
# (active_scopes()). "Rolun tum scope'larina sahip olmak" ile "rolu
# tutmak" ayri gerceklerdir; birini kontrol eden diger fonksiyon degil.


def direct_scopes(user_id) -> set[str]:
    """Rolden BAGIMSIZ, dogrudan verilmis kapsamlar — panelde 'kaynak'
    ayrimi icin (rolden mi geliyor, yoksa tek tek mi verilmis)."""
    return {r["scope"] for r in db.q(
        "select scope from user_scopes where user_id = %s", (db.uid(user_id),))
        if valid(r["scope"])}


def user_roles(user_id) -> list[dict]:
    return db.q(
        "select r.id, r.name from user_roles ur"
        " join roles r on r.id = ur.role_id"
        " where ur.user_id = %s order by r.name", (db.uid(user_id),))


def scope_sources(user) -> dict[str, list[str]]:
    """Her etkin kapsamin nereden geldigi: 'direct' ve/veya rol adlari.
    Panelin 'Kaynak' sutunu bunu okur (spec/71-yonetim-paneli.md §3)."""
    sources: dict[str, list[str]] = {}
    for s in direct_scopes(user["id"]):
        sources.setdefault(s, []).append("direct")
    for role in user_roles(user["id"]):
        for s in role_scopes_of(role["id"]):
            sources.setdefault(s, []).append(role["name"])
    return sources


def role_scopes_of(role_id) -> set[str]:
    return {r["scope"] for r in db.q(
        "select scope from role_scopes where role_id = %s", (db.uid(role_id),))}


def get_role(role_id) -> dict | None:
    return db.q1("select * from roles where id = %s", (db.uid(role_id),))


def list_roles() -> list[dict]:
    """Rol + scope'lari + üye sayısı, tek gezinti (N+1 yok — rol sayısı
    kücük, ama yine de tek sorguda toplanır)."""
    roles = db.q("select * from roles order by name")
    scopes_by_role: dict = {}
    for r in db.q("select role_id, scope from role_scopes"):
        scopes_by_role.setdefault(r["role_id"], set()).add(r["scope"])
    members_by_role: dict = {}
    for r in db.q("select role_id, count(*) c from user_roles group by role_id"):
        members_by_role[r["role_id"]] = r["c"]
    return [dict(r, scopes=scopes_by_role.get(r["id"], set()),
                 member_count=members_by_role.get(r["id"], 0)) for r in roles]


def create_role(name: str, scopes: set[str], created_by=None):
    name = name.strip()
    if not name:
        raise ValueError("rol adı boş olamaz")
    bad = {s for s in scopes if not valid(s)}
    if bad:
        raise ValueError(f"geçersiz kapsam: {', '.join(sorted(bad))}")
    role_id = db.new_id()
    db.x("insert into roles (id, name, created_by) values (%s,%s,%s)",
         (role_id, name, db.uid(created_by) if created_by else None))
    for s in scopes:
        db.x("insert into role_scopes (role_id, scope) values (%s,%s)"
             " on conflict do nothing", (role_id, s))
    return role_id


def set_role_scopes(role_id, scopes: set[str]) -> None:
    """Rolun scope kumesini TAMAMEN degistirir (duzenleme formu — node
    edit'teki 'tum alanlari kaydet' desenine benziyor).

    Bir scope cikarilinca mevcut sahiplerine otomatik yansir — hicbir yerde
    materialize edilmedigi icin (active_scopes okuma aninda birlestirir),
    ayri bir yayin adimi yok."""
    bad = {s for s in scopes if not valid(s)}
    if bad:
        raise ValueError(f"geçersiz kapsam: {', '.join(sorted(bad))}")
    rid = db.uid(role_id)
    db.x("delete from role_scopes where role_id = %s", (rid,))
    for s in scopes:
        db.x("insert into role_scopes (role_id, scope) values (%s,%s)", (rid, s))


def rename_role(role_id, name: str) -> None:
    name = name.strip()
    if not name:
        raise ValueError("rol adı boş olamaz")
    db.x("update roles set name = %s where id = %s", (name, db.uid(role_id)))


def delete_role(role_id) -> None:
    """Rolu ve tuttugu her seyi siler (role_scopes, user_roles cascade).

    Bir scope AYRICA tek tek verilmisse (user_scopes) o satir etkilenmez —
    iki kaynak birbirinden bagimsiz (spec/71-yonetim-paneli.md §5 madde 1)."""
    db.x("delete from roles where id = %s", (db.uid(role_id),))


def assign_role(user_id, role_id, granted_by=None) -> bool:
    rid = db.uid(role_id)
    if rid is None or get_role(rid) is None:
        return False
    db.x("insert into user_roles (user_id, role_id, granted_by) values (%s,%s,%s)"
         " on conflict (user_id, role_id) do nothing",
         (db.uid(user_id), rid, db.uid(granted_by) if granted_by else None))
    return True


def unassign_role(user_id, role_id) -> None:
    db.x("delete from user_roles where user_id = %s and role_id = %s",
         (db.uid(user_id), db.uid(role_id)))
