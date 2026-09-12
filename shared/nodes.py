"""Node turleri ve dugum bagimlilik sayimi (spec/72-node-turleri.md).

Tur DAVRANIS TASIR, o yuzden adi kodda durur: kod adini bilmedigi bir seye
davranis baglayamaz. Ornek (hangi node hangi turde) veritabaninda, kullanici
yonetiminde. Ayni kalip shared/scope.py'deki SCOPES ile birebir.

Yeni tur eklemek = buraya bir satir + goc (CHECK kisiti guncellenir).

Bu modul YALNIZ db'yi import eder. service zaten nodes'u import ediyor;
tersi bir import donguye girerdi. Tur dilimi (nodes_of_type) bu yuzden
TreeIndex'in metodu olarak yasiyor.
"""
from __future__ import annotations

from . import db

# Anahtar Ingilizce, etiket Turkce (CLAUDE.md "Kod dili").
NODE_TYPES: dict[str, str] = {
    "cell":        "Cell",          # IWS hucresi / operasyonel birim
    "machine":     "Makine",        # atomik fonksiyonel birim: girdisi + ciktisi var
    "pillar":      "Pillar",        # IWS pillar'i — sayfasi sonra
    "team":        "Takım",         # Takimlar sayfasinda kart uretir (projeksiyon)
    "task":        "Görev",
    "step":        "Adım",
    "operational": "Operational",   # davranis YOK — IWS kabi
    "generic":     "Genel",         # davranis YOK — notr yer tutucu
}

# Yerlesim kurali. TEK KAYNAK burasi: sablon bunu baglamdan okur, yeniden
# yazmaz. spec/72 §7 — cell disinda hicbir tur icin kural YOK; ozellikle
# machine hicbir yere dayatilmaz (bir cell'in altinda da, bir machine'in
# altinda da durabilir).
ROOT_ONLY = frozenset({"cell"})

# counts_by_node()'un dondurdugu bagimlilik adlari — sifir sayimi icin kalip.
_ZERO = {"children": 0, "records": 0, "teams": 0, "permissions": 0, "user_scopes": 0}


def valid(node_type: str) -> bool:
    return node_type in NODE_TYPES


def label(node_type: str) -> str:
    """Bilinmeyen tur ekranda ham haliyle gorunur — goc oncesi veriyi gizleme."""
    return NODE_TYPES.get(node_type, node_type)


def root_only(node_type: str) -> bool:
    return node_type in ROOT_ONLY


# --- bagimlilik sayimi ----------------------------------------------------


def counts_by_node() -> dict:
    """Dugum basina bagimlilik sayilari — TEK sorgu, uc tuketici.

    Bakilan yerler spec/72 §6.1'deki tablodan (semadan cikarildi, tahmin
    degil). EVENTS BILEREK YOK: events.subject_id FK degil (goc 001) ve
    add_node her dugum icin bir olusturma olayi yaziyor — sayilsaydi hicbir
    dugum virgin olamaz, ozellik hic calismazdi.
    """
    rows = db.q(
        "  select parent_id as nid, 'children' as dep from nodes where parent_id is not null"
        " union all select node_id, 'records' from items"
        " union all select node_id, 'teams' from teams where node_id is not null"
        " union all select node_id, 'permissions' from user_node_scopes"
        " union all select scope_node_id, 'user_scopes' from users where scope_node_id is not null")
    out: dict = {}
    for r in rows:
        out.setdefault(r["nid"], dict(_ZERO))[r["dep"]] += 1
    return out


def counts_of(node_id, counts: dict | None = None) -> dict:
    """Tek dugumun sayilari; bagimlilik yoksa sifirlar."""
    if counts is None:
        counts = counts_by_node()
    return counts.get(db.uid(node_id)) or dict(_ZERO)


def is_virgin(node_id, counts: dict | None = None) -> bool:
    """Hicbir bagimlilik yok mu? Sert silme yuklemi (spec/72 §6.1-6.2):
    True ise silmek hicbir gecmisi goturmez, ayri kapsam istemez."""
    return not any(counts_of(node_id, counts).values())


def has_projection(node_id, counts: dict | None = None) -> bool:
    """Bu dugumun turune ozel verisi var mi? Tur kilidi yuklemi (spec/72 §6.3).

    is_virgin'den AYRI ve daha dar: cocuk, ustunun turu degisince sahipsiz
    kalmaz — sahipsiz kalan, o dugume PK'siyle bagli projeksiyon satiridir
    (bugun yalniz teams; yarin pillar sayfasinin tablosu).
    """
    return counts_of(node_id, counts)["teams"] > 0


def subtree_counts(ids, counts: dict | None = None) -> dict:
    """Alt agacin toplam bagimliliklari — silme onayinin sayacagi sayilar.

    children TOPLAMI degil, alt agac boyutundan turetilir: silinecek dugum
    sayisi = len(ids) - 1 (kokun kendisi haric).
    """
    if counts is None:
        counts = counts_by_node()
    total = dict(_ZERO)
    for nid in ids:
        for k, v in counts_of(nid, counts).items():
            total[k] += v
    total["children"] = max(len(list(ids)) - 1, 0)
    return total
