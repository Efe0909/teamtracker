"""Iki sitenin paylastigi durum ve is mantigi.

Yetki cagiran ucta kontrol edilir; YAZMA islerinin govdesi burada tek yerde
durur ki masaustu ve mobil ayni davranissin (spec/10-kararlar.md).

TREE modul niteligi olarak okunur (service.TREE): yapi degisince yeniden kurulur.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from . import auth, db
from .tree import TreeIndex

STATUSES = {"acik": "Açık", "devam": "Devam", "beklemede": "Beklemede", "kapandi": "Kapandı"}
PRIORITIES = {"kritik": "Kritik", "yuksek": "Yüksek", "orta": "Orta", "dusuk": "Düşük"}
EDITABLE = {"status": STATUSES, "priority": PRIORITIES, "assignee_id": None, "due_date": None}
AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"]

PRIO_SQL = ("case priority when 'kritik' then 0 when 'yuksek' then 1"
            " when 'orta' then 2 else 3 end")
MINE_SQL = ("(assignee_id = %s or id in"
            " (select item_id from item_participants where user_id = %s))")
MINE_SQL_I = ("(i.assignee_id = %s or i.id in"
              " (select item_id from item_participants where user_id = %s))")   # join'li sorgular

# --- agac indeksi: tek surec, yapi degisince komple yeniden kurulur --------

TREE: TreeIndex = TreeIndex()


def rebuild_tree() -> TreeIndex:
    global TREE
    TREE = TreeIndex.build(db.q("select id,parent_id,name,node_type,sort_order from nodes"))
    return TREE


def users_by_id() -> dict:
    return {u["id"]: u for u in auth.all_users()}



def last_line(item_id: str) -> str:
    r = db.q1("select e.body, u.name from events e left join users u on u.id = e.author_id"
              " where e.subject_type='item' and e.subject_id=%s order by e.created_at desc limit 1",
              (item_id,))
    if not r:
        return ""
    return f"{r['name']}: {r['body']}" if r["name"] else r["body"]


def group_of(when: datetime) -> str:
    """Zaman artik metin degil timestamptz; ayristirma gerekmiyor."""
    today = datetime.now(timezone.utc).date()
    if when.date() == today:
        return "Bugün"
    if when.date() > today - timedelta(days=7):
        return "Bu hafta"
    return "Daha eski"


def short_time(when: datetime) -> str:
    today = datetime.now(timezone.utc).date()
    if when.date() == today:
        return when.strftime("%H:%M")
    if when.date() > today - timedelta(days=7):
        return ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"][when.weekday()]
    return f"{when.day} {['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'][when.month-1]}"


def get_item(item_id):
    r = db.q1("select * from items where id = %s", (db.uid(item_id),))
    if r is None:
        raise HTTPException(404, "kayıt yok")
    return r



def log(item_id: str, etype: str, author_id: str | None, body: str) -> None:
    db.x("insert into events (id,subject_type,subject_id,event_type,author_id,body,created_at)"
         " values (%s,'item',%s,%s,%s,%s,%s)",
         (db.new_id(), item_id, etype, author_id, body, db.now()))



def add_message(user, item, body: str) -> dict | None:
    """Mesaj yaz. Yetki cagiran ucta kontrol edilir; is mantigi tek yerde."""
    body = body.strip()
    if not body:
        return None
    log(item["id"], "mesaj", user["id"], body)
    db.x("update items set updated_at = %s where id = %s", (db.now(), item["id"]))
    return {"type": "mesaj", "body": body, "author": user, "mine": True,
            "time": short_time(db.now())}


def change_field(user, item, form) -> bool:
    """Tek alan degistir + sistem olayi yaz. Dogrulama burada, uclarda degil.

    Doner: deger gercekten degisti mi.
    """
    field = next((k for k in form if k in EDITABLE), None)
    if field is None:
        raise HTTPException(400, "bilinmeyen alan")
    value = (form[field] or "").strip() or None

    labels = EDITABLE[field]
    if labels and value not in labels:
        raise HTTPException(400, "geçersiz değer")
    users = users_by_id()
    if field == "assignee_id" and value is not None and value not in users:
        raise HTTPException(400, "kullanıcı yok")

    def label(v):
        if v is None:
            return "—"
        if labels:
            return labels[v]
        return users[v]["name"] if field == "assignee_id" else v

    old, new = label(item[field]), label(value)
    if old == new:
        return False

    db.x(f"update items set {field} = %s, updated_at = %s where id = %s",
         (value, db.now(), item["id"]))
    names = {"status": "durumu", "priority": "önceliği", "assignee_id": "sorumluyu",
             "due_date": "son tarihi"}
    log(item["id"], "sistem", user["id"], f"{user['name']} {names[field]} {old} → {new} yaptı")
    return True



def new_item(user, node_id, kind: str, title: str, description: str = ""):
    """Yeni kayit. Yetki burada: kapsam disinda dal secilemez (masaustu ve mobil ayni yol)."""
    node_id = db.uid(node_id)
    if node_id not in TREE.nodes:
        raise HTTPException(400, "düğüm zorunlu")
    if kind not in ("hata", "gorev"):
        raise HTTPException(400, "geçersiz tür")
    if not title.strip():
        raise HTTPException(400, "başlık zorunlu")
    if not (db.as_bool(user["is_admin"]) or (
            user["scope_node_id"] and TREE.is_descendant(node_id, user["scope_node_id"]))):
        raise HTTPException(403, "bu dalda kayıt açma yetkin yok")
    now = db.now()
    item_id = db.new_id()
    db.x("insert into items (id,node_id,kind,title,description,status,priority,assignee_id,"
         "created_by,created_at,updated_at) values (%s,%s,%s,%s,%s,'acik','orta',%s,%s,%s,%s)",
         (item_id, node_id, kind, title.strip(), description.strip() or None,
          user["id"], user["id"], now, now))
    db.x("insert into item_participants (item_id,user_id,added_by,added_at) values (%s,%s,%s,%s)",
         (item_id, user["id"], user["id"], now))
    log(item_id, "sistem", user["id"], f"{user['name']} bu kaydı açtı ({TREE.name(node_id)})")
    return item_id

