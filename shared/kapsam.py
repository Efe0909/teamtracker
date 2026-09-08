"""Yetki kapsamlari — adlandirilmis izinler (goc 007).

Yetki IKI parcadan olusur:

  1. KAPSAM      — ne yapabilir ("dugum_duzenle").
  2. DUGUM IZNI  — hangi dalda yapabilir (user_node_scopes).

Ikisi birlikte gerekir. Kapsami olmayan hicbir dalda duzenleyemez; kapsami
olup izinli dugumu olmayan da duzenleyemez. Admin ikisini de atlar.

Kapsam adlari BURADA tanimli. Veritabani serbest metin kabul ediyor ama
etkin_kapsamlar() tanimsiz olani eler: yonetim panelinde yapilan bir yazim
hatasi sessizce yetki vermesin.
"""
from __future__ import annotations

from . import db, service

# Kapsam anahtari -> ekranda gorunecek aciklama. Yonetim paneli bu sozlugu
# listeleyecek; yeni kapsam eklemek = buraya bir satir.
KAPSAMLAR: dict[str, str] = {
    "dugum_duzenle": "Yapıyı düzenle — düğüm ekle, adlandır, taşı, sil",
    "kullanici_yonet": "Kullanıcı ekle, kapat, yetki ver",
    "takim_yonet": "Takım kur, üye ekle ve çıkar",
}

# Dugum bazli izin ISTEYEN kapsamlar. Bunlar icin kapsam tek basina yetmez;
# ayrica hangi dalda gecerli oldugu user_node_scopes'ta yazili olmali.
DUGUM_BAGIMLI = frozenset({"dugum_duzenle"})


def gecerli(ad: str) -> bool:
    return ad in KAPSAMLAR


# --- okuma ----------------------------------------------------------------


def etkin_kapsamlar(user) -> set[str]:
    """Kullanicinin gecerli kapsamlari.

    Admin HEPSINE sahiptir — yetkilendirmenin tepesi tek yerde kalsin, her
    kontrol ayrica "ya da admin mi" diye sormasin.
    """
    if user is None:
        return set()
    if db.as_bool(user["is_admin"]):
        return set(KAPSAMLAR)
    return {r["scope"] for r in
            db.q("select scope from user_scopes where user_id = %s", (db.uid(user["id"]),))
            if gecerli(r["scope"])}


def var_mi(user, kapsam: str) -> bool:
    return kapsam in etkin_kapsamlar(user)


def izinli_dugumler(user) -> list:
    """Dogrudan izin verilmis dugumler (alt agaclari DAHIL DEGIL — o hesap
    dugumde_yetkili icinde yapiliyor)."""
    if user is None:
        return []
    return [r["node_id"] for r in
            db.q("select node_id from user_node_scopes where user_id = %s",
                 (db.uid(user["id"]),))]


def dugumde_yetkili(user, node_id, kapsam: str = "dugum_duzenle") -> bool:
    """Bu kullanici, bu dugumde bu kapsami kullanabilir mi?

    Izin ALT AGACA MIRAS KALIR: "Maliye"ye izni olan altindaki her seyi
    duzenler. Kontrol TreeIndex uzerinden O(1) (tin/tout araligi), her ata
    icin ayri sorgu yok.
    """
    if user is None:
        return False
    if db.as_bool(user["is_admin"]):
        return True
    if not var_mi(user, kapsam):
        return False
    if kapsam not in DUGUM_BAGIMLI:
        return True

    hedef = db.uid(node_id)
    if hedef is None:
        return False
    return any(service.TREE.is_descendant(hedef, izin)
               for izin in izinli_dugumler(user))


def kok_islemi_yapabilir(user, kapsam: str = "dugum_duzenle") -> bool:
    """Kok dugum eklemek/silmek — hicbir ustun altinda degil.

    Dugum izni bir DALI kapsar; kok islemi hicbir dala girmez, o yuzden
    yalnizca admin. Aksi halde bir dala izin verilen kisi agacin yanina
    kendi agacini kurabilirdi.
    """
    return user is not None and db.as_bool(user["is_admin"])


# --- yazma ----------------------------------------------------------------


def kapsam_ver(user_id, kapsam: str, veren_id=None) -> bool:
    if not gecerli(kapsam):
        return False
    db.x("insert into user_scopes (user_id, scope, granted_by) values (%s,%s,%s)"
         " on conflict (user_id, scope) do nothing",
         (db.uid(user_id), kapsam, db.uid(veren_id) if veren_id else None))
    return True


def kapsam_al(user_id, kapsam: str) -> None:
    db.x("delete from user_scopes where user_id = %s and scope = %s",
         (db.uid(user_id), kapsam))


def dugum_izni_ver(user_id, node_id, veren_id=None) -> bool:
    hedef = db.uid(node_id)
    if hedef is None or hedef not in service.TREE.nodes:
        return False
    db.x("insert into user_node_scopes (user_id, node_id, granted_by) values (%s,%s,%s)"
         " on conflict (user_id, node_id) do nothing",
         (db.uid(user_id), hedef, db.uid(veren_id) if veren_id else None))
    return True


def dugum_izni_al(user_id, node_id) -> None:
    db.x("delete from user_node_scopes where user_id = %s and node_id = %s",
         (db.uid(user_id), db.uid(node_id)))
