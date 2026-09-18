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
    "pool": {
        "label": "Havuz kartı",
        "icon": "🫱",
        "has_media": False,
        "hint": "İş burada durur, isteyen üstüne alır — atama yok, gönüllülük var.",
    },
}

# Katilim kabul eden turler ve o turde hangi cevaplar anlamli (goc 013).
# Sozluk kart turunun YANINDA degil AYRI: her turun katilimi yok, olan turde de
# cevap kumesi farkli — CARD_TYPES'a gomulseydi "katilimi yok" bir None ile
# anlatilirdi ve sablon her yerde onu elemek zorunda kalirdi.
SIGNUP: dict[str, dict[str, str]] = {
    "meeting": {"yes": "Katılıyorum", "maybe": "Belki", "no": "Katılamıyorum"},
    # Havuzda "belki" yok: is ya alinir ya alinmaz. "no" da cizilmez — yazilmamak
    # zaten cevaptir; ucta kabul edilir ki kayitli biri geri cekilebilsin.
    "pool": {"yes": "Bu işi alıyorum"},
}

# Tur basina serbest alanlar: (anahtar, etiket, html input turu).
# Sablon bunu okur; alan eklemek sablonu degil bu sozlugu degistirir.
# Aciklama EKTE DEGIL KARTTA (goc 015). Ekin kendi anlatimi zaten ETIKET
# (goc 010); her gorselin altina ikinci bir serbest metin kutusu koymak "bu ne
# hakkinda" sorusunu iki yerden cevaplatiyordu. Kart bir blok, icindeki
# gorseller o blogun parcasi — aciklama bloga ait ve buraya bir satir eklemek
# hem jsonb'yi hem duzenleme dialogunu kendiliginden halleder.
FIELDS: dict[str, list[tuple[str, str, str]]] = {
    "media": [("description", "Açıklama", "textarea")],
    "meeting": [("when", "Tarih ve saat", "datetime-local"),
                ("place", "Yer", "text"),
                # Toplanti artik cogu zaman uzaktan: baglanti yeri "Yer"in
                # icinde serbest metin olarak kayboluyordu, tiklanabilir degildi.
                ("link", "Bağlantı (Meet/Zoom)", "url"),
                ("agenda", "Gündem", "textarea")],
    "pool": [("need", "Kaç kişi lazım", "number"),
             ("detail", "Ne yapılacak", "textarea")],
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


# --- katilim (goc 013) ----------------------------------------------------
#
# "Toplantiya kim geliyor" ile "havuza kim yazildi" AYNI sorunun iki adi: bir
# karta bagli, kisi basina TEK cevap. O yuzden tek tablo, tek uc, tek serit
# sablonu; ayrim yalnizca hangi cevaplarin cizildiginde (SIGNUP).


def signup_answers(card_type: str) -> dict[str, str]:
    """Bu turde anlamli cevaplar; katilim kabul etmeyen turde bos sozluk."""
    return SIGNUP.get(card_type, {})


def sign(card_id, user_id, answer: str, note: str | None = None) -> bool:
    """Katilim yaz ya da degistir. Doner: yazildi mi.

    UPSERT: "fikrimi degistirdim" ikinci bir satir degil ayni satirin yeni
    hali — yoksa kartta iki cevap gorunur, hangisi gecerli belirsiz kalirdi.
    Bos answer KAYDI SILER: geri cekilmenin yolu ayri bir uc degil.
    """
    card = get(card_id)
    if card is None:
        return False
    cid, uid = card["id"], db.uid(user_id)
    if not answer:
        db.x("delete from card_signups where card_id = %s and user_id = %s", (cid, uid))
        return True
    # Beyaz liste TURDEN gelir: havuz kartina "belki" yazilamaz, cunku o turde
    # "belki" diye bir cevap yok (SIGNUP). Serbest metin girerse 400.
    if answer not in signup_answers(card["card_type"]):
        raise HTTPException(400, "bu kart türünde geçersiz katılım")
    db.x("insert into card_signups (card_id,user_id,answer,note,signed_at)"
         " values (%s,%s,%s,%s,%s)"
         " on conflict (card_id,user_id) do update"
         " set answer = excluded.answer, note = excluded.note, signed_at = excluded.signed_at",
         (cid, uid, answer, (note or "").strip() or None, db.now()))
    return True


def signups_for(card_ids: list) -> dict:
    """Kart basina katilim satirlari — TEK sorgu (spec/10-kararlar.md N+1 yasagi)."""
    if not card_ids:
        return {}
    ids = [i for i in (db.uid(c) for c in card_ids) if i is not None]
    if not ids:
        return {}
    rows = db.q("select s.*, u.name, u.color from card_signups s"
                " join users u on u.id = s.user_id"
                " where s.card_id = any(%s) order by s.signed_at", (ids,))
    out: dict = {}
    for r in rows:
        out.setdefault(r["card_id"], []).append(r)
    return out


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
    signups_by_card = signups_for([r["id"] for r in rows])
    out = []
    for r in rows:
        data = dict(r["data"] or {})
        media = [{"id": m["id"], "mime": m["mime"], "width": m["width"], "height": m["height"],
                  "original_name": m["original_name"], "deleted": m["deleted_at"] is not None,
                  "can_delete": attachments.can_delete(user, m), "can_tag": False, "tags": []}
                 for m in media_by_card.get(r["id"], [])]
        # Katilim seridi sablona HAZIR gelir: "ben ne dedim" ve "kimler var"
        # sorularinin ikisi de burada cevaplanir, sablon satir suzmez.
        answers = signup_answers(r["card_type"])
        signups = [{"user_id": s["user_id"], "name": s["name"], "color": s["color"],
                    "answer": s["answer"], "answer_label": answers.get(s["answer"], s["answer"]),
                    "note": s["note"]} for s in signups_by_card.get(r["id"], [])]
        mine = next((s for s in signups if s["user_id"] == user["id"]), None) if user else None
        out.append({
            "id": r["id"], "type": r["card_type"], "title": r["title"],
            "label": label(r["card_type"]), "icon": CARD_TYPES.get(r["card_type"], {}).get("icon", "🗂"),
            "has_media": CARD_TYPES.get(r["card_type"], {}).get("has_media", False),
            "fields": FIELDS.get(r["card_type"], []),
            "data": data, "when_label": _when_label(data.get("when")),
            "media": [m for m in media if not m["deleted"]],
            "answers": answers, "signups": signups,
            "my_answer": mine["answer"] if mine else "",
            "yes_count": sum(1 for s in signups if s["answer"] == "yes"),
        })
    return out
