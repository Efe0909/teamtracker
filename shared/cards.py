"""Kart bloklari: kayit govdesine yapistirilan yeniden kullanilabilir kutular.

Kaynak fikir (figure3): staj yerindeki sistemde bir hata kaydi, onu doguran
formun kartlariyla birlikte geliyordu. Hedeflenen sey de o — ileride "google
forms gibi" kartlardan olusan bir kayit acma formu. Bu tur YALNIZCA blogu
kuruyor; form uretimi ayri bir is.

Tur DAVRANIS TASIR, o yuzden adi kodda durur — shared/nodes.py NODE_TYPES ve
shared/scope.py SCOPES ile birebir ayni kalip. Ornek (hangi kart hangi turde)
veritabaninda (item_cards), tur listesi burada.

Yeni tur eklemek = buraya bir satir + goc (CHECK kisiti guncellenir) + o turun
sablon parcasi (fragments/cards/<tur>.html).

Bu modul YALNIZ db ve attachments'i import eder: service zaten cards'i import
ediyor, tersi donguye girerdi.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException

from . import attachments, db

# Anahtar Ingilizce, etiket Turkce (CLAUDE.md "Kod dili").
CARD_TYPES: dict[str, dict] = {
    "media": {
        "label": "Medya eki",
        "icon": "🖼",
        # Blogun kendi ekleri var: owner_type='card' (goc 012). owner_type='item'
        # olsaydi ayni kayittaki iki medya blogu ayirt edilemezdi.
        "has_media": True,
        "hint": "Görseller bu kutuya asılır — sohbete dağılmaz, kayıtla kalır.",
    },
    "meeting": {
        "label": "Toplantı planı",
        "icon": "📅",
        "has_media": False,
        "hint": "Ne zaman, nerede, kim — konuşulacaklar tek yerde.",
    },
}

# Tur basina serbest alanlar: (anahtar, etiket, html input turu).
# Sablon bunu okur; alan eklemek sablonu degil bu sozlugu degistirir.
FIELDS: dict[str, list[tuple[str, str, str]]] = {
    "media": [],
    "meeting": [("when", "Tarih ve saat", "datetime-local"),
                ("place", "Yer", "text"),
                ("agenda", "Gündem", "textarea")],
}


def valid(card_type: str) -> bool:
    return card_type in CARD_TYPES


def label(card_type: str) -> str:
    """Bilinmeyen tur ekranda ham haliyle gorunur — goc oncesi veriyi gizleme."""
    info = CARD_TYPES.get(card_type)
    return info["label"] if info else card_type


def _clean(card_type: str, form) -> dict:
    """Formdan yalnizca O TURUN tanimli alanlari alinir.

    Beyaz liste: form ne gonderirse gondersin jsonb'ye tanimsiz anahtar
    girmez, yoksa sutun serbest bir cop kutusuna donerdi.
    """
    out = {}
    for key, _lbl, _kind in FIELDS.get(card_type, []):
        value = (form.get(key) or "").strip()
        if value:
            out[key] = value
    return out


# --- yazma ---------------------------------------------------------------


def add(item_id, card_type: str, title: str, form, created_by) -> dict:
    """Yeni kart blogu. Yetki cagiran ucta (can_edit_item)."""
    if not valid(card_type):
        raise HTTPException(400, "geçersiz kart türü")
    row = db.q1("select coalesce(max(sort_order), -1) + 1 as next from item_cards"
                " where item_id = %s", (db.uid(item_id),))
    return db.q1(
        "insert into item_cards (id,item_id,card_type,title,data,sort_order,created_by,created_at)"
        " values (%s,%s,%s,%s,%s,%s,%s,%s) returning *",
        (db.new_id(), db.uid(item_id), card_type, (title or "").strip() or label(card_type),
         db.Json(_clean(card_type, form)), row["next"], db.uid(created_by), db.now()))


def get(card_id) -> dict | None:
    id_ = db.uid(card_id)
    return db.q1("select * from item_cards where id = %s", (id_,)) if id_ else None


def update(card_id, title: str | None, form) -> bool:
    card = get(card_id)
    if card is None:
        return False
    data = dict(card["data"] or {})
    data.update(_clean(card["card_type"], form))
    db.x("update item_cards set title = %s, data = %s where id = %s",
         ((title or "").strip() or card["title"], db.Json(data), card["id"]))
    return True


def delete(card_id) -> None:
    """Blok gider; ekleri (owner_type='card') attachments'ta YETIM KALIR —
    009'un bilincli kabulu (FK yok, tools/media_gc.py temizler). Onceden
    yumusak silinirse balon/mezar tasi mantigi da korunur."""
    db.x("delete from item_cards where id = %s", (db.uid(card_id),))


# --- okuma ---------------------------------------------------------------


def _when_label(value: str | None) -> str | None:
    """'2026-09-20T14:30' -> '20.09.2026 14:30'. Ayristirilamayan deger ham
    haliyle gecer: kullanicinin yazdigini yutma."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).strftime("%d.%m.%Y %H:%M")
    except ValueError:
        return value


def of_item(item_id, user) -> list[dict]:
    """Kaydin kart bloklari — ekleriyle birlikte, TEK ek sorgusu.

    Ek sozlugu service._media_view ile AYNI sekli tasir (sablon ayni
    parcayi cizsin): id, mime, deleted, can_delete...
    """
    rows = db.q("select * from item_cards where item_id = %s"
                " order by sort_order, created_at", (db.uid(item_id),))
    if not rows:
        return []
    media_by_card = attachments.for_owners("card", [r["id"] for r in rows])
    out = []
    for r in rows:
        data = dict(r["data"] or {})
        media = [{"id": m["id"], "mime": m["mime"], "width": m["width"], "height": m["height"],
                  "original_name": m["original_name"], "deleted": m["deleted_at"] is not None,
                  "can_delete": attachments.can_delete(user, m), "can_tag": False, "tags": []}
                 for m in media_by_card.get(r["id"], [])]
        out.append({
            "id": r["id"], "type": r["card_type"], "title": r["title"],
            "label": label(r["card_type"]), "icon": CARD_TYPES.get(r["card_type"], {}).get("icon", "🗂"),
            "has_media": CARD_TYPES.get(r["card_type"], {}).get("has_media", False),
            "fields": FIELDS.get(r["card_type"], []),
            "data": data, "when_label": _when_label(data.get("when")),
            "media": [m for m in media if not m["deleted"]],
        })
    return out
