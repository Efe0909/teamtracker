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
EDITABLE = {"status": STATUSES, "priority": PRIORITIES, "assignee_id": None, "due_date": None,
            "team_id": None}
EYLEM_DURUM = {"acik": "Açık", "devam": "Devam", "kapandi": "Kapandı", "iptal": "İptal"}
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


def teams_by_id() -> dict:
    return {t["id"]: t for t in db.q("select * from teams order by name")}


def open_action_count(item_id: str) -> int:
    r = db.q1("select count(*) c from actions where item_id = %s"
              " and status in ('acik','devam')", (item_id,))
    return r["c"] or 0


def actions_of(item_id: str) -> list:
    return db.q("select * from actions where item_id = %s"
                " order by case status when 'kapandi' then 1 when 'iptal' then 1 else 0 end,"
                " due_date is null, due_date, created_at", (item_id,))



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
    teams = teams_by_id()
    if field == "assignee_id" and value is not None and value not in users:
        raise HTTPException(400, "kullanıcı yok")
    if field == "team_id" and value is not None and value not in teams:
        raise HTTPException(400, "takım yok")
    # kayit acik eylemi varken kapanamaz (spec/20-sema.md §3a)
    if field == "status" and value == "kapandi":
        n = open_action_count(item["id"])
        if n:
            raise HTTPException(400, f"önce açık eylemleri kapat ({n} açık eylem var)")

    def label(v):
        if v is None:
            return "—"
        if labels:
            return labels[v]
        if field == "assignee_id":
            return users[v]["name"]
        if field == "team_id":
            return teams[v]["name"]
        return v

    old, new = label(item[field]), label(value)
    if old == new:
        return False

    db.x(f"update items set {field} = %s, updated_at = %s where id = %s",
         (value, db.now(), item["id"]))
    names = {"status": "durumu", "priority": "önceliği", "assignee_id": "sorumluyu",
             "due_date": "son tarihi", "team_id": "takımı"}
    log(item["id"], "sistem", user["id"], f"{user['name']} {names[field]} {old} → {new} yaptı")
    return True



def new_item(user, node_id: str, kind: str, title: str, description: str = "",
             team_id: str | None = None) -> str:
    """Yeni kayit. Yetki burada: kapsam disinda dal secilemez (masaustu ve mobil ayni yol).

    Kayit istege bagli bir takima tanimlanir (spec/10-kararlar.md 'Kayıt takıma');
    kisi atamasi kayit uzerinde degil eylem uzerinde yapilir.
    """
    node_id, team_id = db.uid(node_id), db.uid(team_id) if team_id else None
    if node_id not in TREE.nodes:
        raise HTTPException(400, "düğüm zorunlu")
    if kind not in ("hata", "gorev"):
        raise HTTPException(400, "geçersiz tür")
    if not title.strip():
        raise HTTPException(400, "başlık zorunlu")
    team_id = team_id or None
    if team_id and db.q1("select 1 from teams where id = %s", (team_id,)) is None:
        raise HTTPException(400, "takım yok")
    if not (db.as_bool(user["is_admin"]) or (
            user["scope_node_id"] and TREE.is_descendant(node_id, user["scope_node_id"]))):
        raise HTTPException(403, "bu dalda kayıt açma yetkin yok")
    now = db.now()
    item_id = db.new_id()
    db.x("insert into items (id,node_id,kind,title,description,status,priority,team_id,"
         "assignee_id,created_by,created_at,updated_at) values (%s,%s,%s,%s,%s,'acik','orta',%s,%s,%s,%s,%s)",
         (item_id, node_id, kind, title.strip(), description.strip() or None,
          team_id, user["id"], user["id"], now, now))
    db.x("insert into item_participants (item_id,user_id,added_by,added_at) values (%s,%s,%s,%s)",
         (item_id, user["id"], user["id"], now))
    ek = f", takım: {teams_by_id()[team_id]['name']}" if team_id else ""
    log(item_id, "sistem", user["id"], f"{user['name']} bu kaydı açtı ({TREE.name(node_id)}{ek})")
    return item_id


# --- eylemler: kayda bagli, kisiye atanan is (spec/20-sema.md §3a) ----------

def add_action(user, item, title: str, assignee_id: str | None = None,
               due_date: str | None = None) -> str:
    """Eylem ac. Yetki cagiran ucta (can_edit_item); olaylar kartin akisina duser."""
    if not title.strip():
        raise HTTPException(400, "eylem başlığı zorunlu")
    users = users_by_id()
    assignee_id = db.uid(assignee_id) if assignee_id else None
    if assignee_id and assignee_id not in users:
        raise HTTPException(400, "kullanıcı yok")
    now = db.now()
    action_id = db.new_id()
    db.x("insert into actions (id,item_id,title,assignee_id,status,due_date,created_by,created_at)"
         " values (%s,%s,%s,%s,'acik',%s,%s,%s)",
         (action_id, item["id"], title.strip(), assignee_id, due_date or None, user["id"], now))
    db.x("update items set updated_at = %s where id = %s", (now, item["id"]))
    kime = f" → {users[assignee_id]['name']}" if assignee_id else " (havuzda, üstlenen bekliyor)"
    log(item["id"], "sistem", user["id"], f"{user['name']} eylem ekledi: {title.strip()}{kime}")
    return action_id


def get_action(action_id):
    r = db.q1("select * from actions where id = %s", (db.uid(action_id),))
    if r is None:
        raise HTTPException(404, "eylem yok")
    return r


def change_action(user, item, action, form) -> bool:
    """Eylemde tek alan degistir (status/assignee_id/due_date) + kartta sistem olayi."""
    field = next((k for k in form if k in ("status", "assignee_id", "due_date")), None)
    if field is None:
        raise HTTPException(400, "bilinmeyen alan")
    value = (form[field] or "").strip() or None
    users = users_by_id()
    if field == "status" and value not in EYLEM_DURUM:
        raise HTTPException(400, "geçersiz değer")
    if field == "assignee_id":
        value = db.uid(value) if value else None     # form metni -> uuid
        if value is not None and value not in users:
            raise HTTPException(400, "kullanıcı yok")
    if value == action[field]:
        return False

    now = db.now()
    if field == "status":
        biten = value in ("kapandi", "iptal")
        db.x("update actions set status = %s, resolved_by = %s, resolved_at = %s where id = %s",
             (value, user["id"] if biten else None, now if biten else None, action["id"]))
        log(item["id"], "sistem", user["id"],
            f"{user['name']} \"{action['title']}\" eylemini {EYLEM_DURUM[value]} yaptı")
    else:
        db.x(f"update actions set {field} = %s where id = %s", (value, action["id"]))
        if field == "assignee_id":
            kim = users[value]["name"] if value else "—"
            log(item["id"], "sistem", user["id"],
                f"{user['name']} \"{action['title']}\" eylemini {kim} kişisine atadı")
        else:
            log(item["id"], "sistem", user["id"],
                f"{user['name']} \"{action['title']}\" eyleminin son tarihini {value or '—'} yaptı")
    db.x("update items set updated_at = %s where id = %s", (now, item["id"]))
    return True

