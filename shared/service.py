"""Iki sitenin paylastigi durum ve is mantigi.

Yetki cagiran ucta kontrol edilir; YAZMA islerinin govdesi burada tek yerde
durur ki masaustu ve mobil ayni davranissin (spec/10-kararlar.md).

TREE modul niteligi olarak okunur (service.TREE): yapi degisince yeniden kurulur.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from . import attachments, auth, db, media
from .tree import TreeIndex

STATUSES = {"open": "Açık", "in_progress": "Devam", "pending": "Beklemede", "closed": "Kapandı"}
PRIORITIES = {"critical": "Kritik", "high": "Yüksek", "medium": "Orta", "low": "Düşük"}
EDITABLE = {"status": STATUSES, "priority": PRIORITIES, "assignee_id": None, "due_date": None,
            "team_id": None}
ACTION_STATUS = {"open": "Açık", "in_progress": "Devam", "closed": "Kapandı", "cancelled": "İptal"}
TEAM_ROLE = {"lead": "Lider", "mentor": "Mentor", "member": "Üye"}
MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"]

PRIO_SQL = ("case priority when 'critical' then 0 when 'high' then 1"
            " when 'medium' then 2 else 3 end")
PRIO_SQL_I = ("case i.priority when 'critical' then 0 when 'high' then 1"
              " when 'medium' then 2 else 3 end")                      # join'li sorgular
# Rol sirasi ekranda da SQL'de de ayni: once lead, sonra mentor, sonra member.
# ("m" = team_members takma adi; iki takim sorgusu da bu adi kullanir.)
ROLE_ORDER = "case m.role when 'lead' then 0 when 'mentor' then 1 else 2 end"
MINE_SQL = ("(assignee_id = %s or id in"
            " (select item_id from item_participants where user_id = %s))")
MINE_SQL_I = ("(i.assignee_id = %s or i.id in"
              " (select item_id from item_participants where user_id = %s))")   # join'li sorgular

# --- agac indeksi: tek surec, yapi degisince komple yeniden kurulur --------

TREE: TreeIndex = TreeIndex()


def rebuild_tree() -> TreeIndex:
    global TREE
    TREE = TreeIndex.build(db.q("select id,parent_id,name,node_type,sort_order,is_active from nodes"))
    return TREE


# --- dugum duzenleme (veri yonetimi ekrani) ------------------------------
#
# Her degisiklikten sonra TreeIndex KOMPLE yeniden kurulur — kismi guncelleme
# yok (shared/tree.py). Agac surec bellegindedir, yani bu islevler yalnizca
# --workers 1 varsayimiyla dogru; ikinci bir isci kendi bayat agaciyla kalir.


def _node_event(node_id, author_id, text: str) -> None:
    """Agac gecmisi events'e yazilir — AYRI TABLO YOK.

    003'te takim duvari icin ayni sey yapilmisti: subject_type'a yeni bir
    deger eklenir, tablo ve indeks paylasilir. Boylece "ne oldu" sorusunun
    tek kaynagi kalir ve mevcut akis bileseni dugum gecmisini de cizebilir.
    """
    log(node_id, "system", db.uid(author_id) if author_id else None, text,
        subject_type="node")


def add_node(name: str, node_type: str, parent_id=None, description: str | None = None,
             created_by=None) -> dict | None:
    """Yeni dugum. parent_id None ise kok."""
    from shared import nodes
    name = (name or "").strip()
    node_type = (node_type or "").strip()
    if not name or not node_type or not nodes.valid(node_type):
        return None

    parent = db.uid(parent_id) if parent_id else None
    if parent is not None:
        if parent not in TREE.nodes:
            return None                       # olmayan ustun altina yazma
        if not TREE.nodes[parent].is_active:
            return None                       # pasif dugum altina eklenmez
        if node_type in nodes.ROOT_ONLY:
            return None                       # kok-ozel turler alt dugum olamaz
    
    # Kardeslerin sonuna: sira numarasi elle verilmiyor, ekleme sirasi korunuyor.
    siblings = TREE.children.get(parent, []) if parent else TREE.roots
    order = max((TREE.nodes[k].sort_order for k in siblings), default=-1) + 1

    row = db.q1(
        "insert into nodes (id,parent_id,name,node_type,sort_order,description,created_by,created_at)"
        " values (%s,%s,%s,%s,%s,%s,%s,%s) returning *",
        (db.new_id(), parent, name, node_type, order, (description or "").strip() or None,
         db.uid(created_by) if created_by else None, db.now()))
    rebuild_tree()
    _node_event(row["id"], created_by, f"{name} eklendi ({node_type})")
    return row


def update_node(node_id, name: str | None = None, node_type: str | None = None,
                description: str | None = None, changed_by=None) -> bool:
    """Ad / tur / aciklama. Verilmeyen alan DEGISMEZ (None = dokunma)."""
    from shared import nodes
    id_ = db.uid(node_id)
    if id_ is None or id_ not in TREE.nodes:
        return False

    fields, values = [], []
    if name is not None:
        if not name.strip():
            return False                  # adsiz dugum agacta okunmaz olur
        fields.append("name = %s"); values.append(name.strip())
    if node_type is not None:
        if not node_type.strip() or not nodes.valid(node_type):
            return False
            
        current_type = TREE.nodes[id_].node_type
        if node_type != current_type:
            if nodes.has_projection(id_):
                return False              # takim/projeksiyon varsa tur degisemez
            if node_type in nodes.ROOT_ONLY and TREE.parent[id_] is not None:
                return False              # kok-ozel tur, alt dugum olamaz
                
        fields.append("node_type = %s"); values.append(node_type.strip())
    if description is not None:
        # Bos metin "aciklamayi sil" demek; None ile karistirma.
        fields.append("description = %s"); values.append(description.strip() or None)
    if not fields:
        return False

    previous_name = TREE.name(id_)
    db.x(f"update nodes set {', '.join(fields)} where id = %s", (*values, id_))
    rebuild_tree()                        # ad degistiyse agactaki etiket de degisti
    new_name = TREE.name(id_)
    _node_event(id_, changed_by,
                f"{previous_name} -> {new_name} olarak adlandirildi" if previous_name != new_name
                else f"{new_name} güncellendi")
    return True


def move_node(node_id, new_parent_id, moved_by=None) -> bool:
    """Dugumu baska bir ustun altina alir. new_parent_id None ise koke cikarir."""
    from shared import nodes
    id_ = db.uid(node_id)
    if id_ is None or id_ not in TREE.nodes:
        return False

    parent = db.uid(new_parent_id) if new_parent_id else None
    
    if parent is not None:
        if parent not in TREE.nodes:
            return False
        if not TREE.nodes[parent].is_active:
            return False
        if TREE.nodes[id_].node_type in nodes.ROOT_ONLY:
            return False
        # DONGU KORUMASI: hedef, tasinan dugumun alt agacinda olamaz. Olsaydi
        # agac bir halkaya donerdi ve Euler turu sonsuz donerdi.
        if TREE.is_descendant(parent, id_):
            return False

    name = TREE.name(id_)
    destination = TREE.name(parent) if parent else "köke"
    db.x("update nodes set parent_id = %s where id = %s", (parent, id_))
    rebuild_tree()
    _node_event(id_, moved_by, f"{name} {destination} taşındı")
    return True


def set_node_active(node_id, active: bool, changed_by=None) -> bool:
    id_ = db.uid(node_id)
    if id_ is None or id_ not in TREE.nodes:
        return False
        
    db.x("update nodes set is_active = %s where id = %s", (active, id_))
    rebuild_tree()
    _node_event(id_, changed_by, "düğüm açıldı" if active else "düğüm kapatıldı")
    return True


def delete_node(node_id, deleted_by=None) -> bool:
    """Dugumu ve ALT AGACINI siler (nodes.parent_id on delete cascade).

    Kayitlar da gider: items.node_id -> nodes on delete cascade. Bu yuzden
    cagiran taraf once kac kayit etkilenecegini gostermeli.
    """
    id_ = db.uid(node_id)
    if id_ is None or id_ not in TREE.nodes:
        return False
    # Ad SILMEDEN ONCE okunur: satir gidince gecmis "bir sey silindi" demekten
    # oteye gitmezdi (events.subject_id FK degil, satir kaliyor ama ad kalmiyor).
    name = TREE.name(id_)
    child_count = len(TREE.subtree(id_)) - 1
    db.x("delete from nodes where id = %s", (id_,))
    rebuild_tree()
    _node_event(id_, deleted_by,
                f"{name} silindi" + (f" (+{child_count} alt düğüm)" if child_count else ""))
    return True


def users_by_id() -> dict:
    return {u["id"]: u for u in auth.all_users()}


def teams_by_id() -> dict:
    return {t["id"]: t for t in db.q("select * from teams order by name")}


# --- takimlar (spec/20-sema.md §2a; ekran spec/60-kaynak-uyarlama.md 2.5) ----
#
# Takim hiyerarsiden ayri bir varlik: nodes isin NEREDE oldugunu, teams isi
# KIMIN sahiplendigini tutar. Sayimlar iliskili alt sorgularda: takim basina ayri
# COUNT atmak N+1 olurdu (spec/10-kararlar.md 'Sorgular').


def get_team(team_id):
    id_ = db.uid(team_id)
    r = db.q1("select * from teams where id = %s", (id_,)) if id_ else None
    if r is None:
        raise HTTPException(404, "takım yok")
    return r


def team_rows() -> list[dict]:
    """Ekipler listesi: takim + uye/kayit/eylem sayilari, TEK sorgu."""
    return db.q(
        "select t.*,"
        " (select count(*) from team_members m join users u on u.id = m.user_id"
        "  where m.team_id = t.id and u.is_active) member_count,"
        " (select count(*) from items i where i.team_id = t.id"
        "  and i.status <> 'closed') open_count,"
        " (select count(*) from items i where i.team_id = t.id) all_count,"
        " (select count(*) from actions a join items i on i.id = a.item_id"
        "  where i.team_id = t.id and a.status in ('open','in_progress')) open_action_count"
        " from teams t order by t.name")


def members_by_team() -> dict:
    """Tum uyelikler tek sorguda — liste ekrani takim basina sorgu atmasin."""
    out: dict = {}
    for r in db.q("select m.team_id, m.role, u.id, u.name, u.color"
                  " from team_members m join users u on u.id = m.user_id"
                  f" where u.is_active order by {ROLE_ORDER}, u.name"):
        out.setdefault(r["team_id"], []).append(r)
    return out


def team_members(team_id) -> list[dict]:
    """Takim detayindaki uye listesi: rol + o takimin isindeki acik eylem sayisi.

    "Pasif uyenin giris kapisi" (spec/60 2.5): duvar + kendine dusen eylemler.
    """
    return db.q(
        "select u.id, u.name, u.email, u.color, m.role,"
        " (select count(*) from actions a join items i on i.id = a.item_id"
        "  where i.team_id = m.team_id and a.assignee_id = u.id"
        "  and a.status in ('open','in_progress')) open_action_count"
        " from team_members m join users u on u.id = m.user_id"
        f" where m.team_id = %s and u.is_active order by {ROLE_ORDER}, u.name",
        (db.uid(team_id),))


def team_open_count(team_id) -> int:
    """Takimin acik kayit sayisi — team_items kirpilmis olabilir, rozet tami soyler."""
    r = db.q1("select count(*) c from items where team_id = %s and status <> 'closed'",
              (db.uid(team_id),))
    return r["c"] or 0


def team_items(team_id, limit: int = 20) -> list[dict]:
    """Takimin acik kayitlari — oncelik sirasinda, ilk `limit` satir.

    Tamami gorev tablosunda: /tasks?team=<id> (ayni suzgec, ikinci tablo yok).
    """
    return db.q(
        "select i.*, t.name team_name, t.color team_color,"
        " (select count(*) from actions a where a.item_id = i.id"
        "  and a.status in ('open','in_progress')) open_action_count"
        " from items i left join teams t on t.id = i.team_id"
        " where i.team_id = %s and i.status <> 'closed'"
        f" order by {PRIO_SQL_I}, i.updated_at desc limit %s",
        (db.uid(team_id), limit))


def open_action_count(item_id: str) -> int:
    r = db.q1("select count(*) c from actions where item_id = %s"
              " and status in ('open','in_progress')", (item_id,))
    return r["c"] or 0


def actions_of(item_id: str) -> list:
    return db.q("select * from actions where item_id = %s"
                " order by case status when 'closed' then 1 when 'cancelled' then 1 else 0 end,"
                " due_date is null, due_date, created_at", (item_id,))



def last_line(item_id: str) -> str:
    r = db.q1(
        "select e.id, e.body, u.name"
        " from events e left join users u on u.id = e.author_id"
        " where e.subject_type='item' and e.subject_id=%s"
        " order by e.created_at desc limit 1", (item_id,))
    if not r:
        return ""
    # Ekin ownership'i attachments.py'nin isi (CONTRACT-V2 §9): buradan sadece
    # "bu olayin SILINMEMIS eki var mi" soruluyor, owner_type='event' varsayimi
    # burada degil for_owners'in sorgusunda kalir.
    row_media = attachments.for_owners("event", [r["id"]]).get(r["id"], [])
    has_media = any(m["deleted_at"] is None for m in row_media)
    # Govdesiz gorsel mesaj bos govde birakmaz — satir "Ad: " gibi yarim kalmasin.
    body = r["body"] if (r["body"] or not has_media) else "📷 görsel"
    return f"{r['name']}: {body}" if r["name"] else body


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



def log(subject_id: str, etype: str, author_id: str | None, body: str,
        subject_type: str = "item"):
    """Olay yaz, ID'sini dondurur.

    Donus degeri gerekli: bir eke sahip mesajda attachments.attach() owner_id
    olarak (owner_type='event') bu id'yi alir, o yuzden ek yazilmadan once
    olayin id'si elde olmali.
    """
    event_id = db.new_id()
    db.x("insert into events (id,subject_type,subject_id,event_type,author_id,body,created_at)"
         " values (%s,%s,%s,%s,%s,%s,%s)",
         (event_id, subject_type, subject_id, etype, author_id, body, db.now()))
    return event_id


# --- medya ekleri (sozlesme §7-8, genis sahiplik CONTRACT-V2.md §4) --------
#
# Depolama + goruntu isleme shared/media.py'de (HTTP'den, kullanicidan bihaber).
# Sahiplik/izin/etiket shared/attachments.py'de (CONTRACT-V2 §9: owner_type='event'
# varsayimi SADECE orada). Burasi ikisini bir araya getirir: bir mesajin ekini
# olaya (owner_type='event') baglar ve akis/balon sozlugune cevirir.


def reject_oversized_upload(request) -> None:
    """Content-Length COK BUYUKSE govde hic tamponlanmadan erken 413 doner.

    media.MAX_BYTES yalnizca dosyanin kendisini sinirlar; multipart govde
    ayrica sinir/diger alanlar tasidigindan burada makul bir pay birakiliyor.
    """
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > media.MAX_BYTES + 1_048_576:
        raise HTTPException(413, "dosya çok büyük")


def save_upload(image) -> dict | None:
    """UploadFile'i diske yazar; MediaError HTTP hatasina cevrilir.

    image None ise (form alaninda dosya yoksa) sessizce None doner — govde
    yoksa metin-yalnizca mesaj akisindan hicbir sey degismez.
    """
    if image is None:
        return None
    try:
        return media.save(image.file, image.filename)
    except media.MediaError as e:
        raise HTTPException(413 if e.code == "too_large" else 400, e.message) from e


def _media_view(rows: list[dict], user, tags_by_id: dict, can_tag: bool) -> list[dict]:
    """Ek satirlarini sablonun bekledigi ekran sozlugune cevirir.

    can_delete BURADA hesaplanir: attachments.for_owners() kullaniciyi bilmez
    (CONTRACT-V2 §4 imzasi geregi — ayni satirlar farkli kullanicilar icin
    farkli can_delete gorebilsin, ekstra sorgu gerekmez, attachments.can_delete
    saf bir hesap). storage_key sablona hic ulasmaz.

    tags_by_id ve can_tag DISARIDAN gelir, burada hesaplanmaz: ikisi de sorgu
    ister ve bu islev akistaki her olay icin bir kez cagriliyor — iceride
    hesaplansalardi 20 gorselli bir kart 40 sorgu ederdi (spec/10-kararlar.md
    N+1 yasagi).
    """
    return [{"id": r["id"], "mime": r["mime"], "width": r["width"], "height": r["height"],
             "original_name": r["original_name"], "deleted": r["deleted_at"] is not None,
             "can_delete": attachments.can_delete(user, r),
             "can_tag": can_tag, "tags": tags_by_id.get(r["id"], [])} for r in rows]


def _tag_context(rows: list[dict], user) -> tuple[dict, bool]:
    """Bir akisin TAMAMI icin etiketler + etiketleme yetkisi, sabit maliyetle.

    Yetki tek bir ek icin hesaplanip hepsine uygulaniyor: bir akistaki butun
    ekler AYNI konuya (ayni kart ya da ayni takim duvari) asili, dolayisiyla
    katilim sorusunun cevabi hepsinde ayni. Ek basina sormak ayni cevabi
    N kez satin almak olurdu.
    """
    if not rows:
        return {}, False
    return attachments.tags_for([r["id"] for r in rows]), attachments.can_tag(user, rows[0])


def feed_of(subject_type: str, subject_id, user) -> list[dict]:
    """Olay akisi (sistem + mesaj, tek kronoloji).

    Kart akisi ve takim duvari AYNI tablodan okur (spec/20-sema.md §5); sablon
    da ayni (fragments/card_feed.html) — akis nerede gosterildigini bilmez.
    """
    users = users_by_id()
    rows = db.q("select * from events where subject_type = %s and subject_id = %s"
                " order by created_at", (subject_type, db.uid(subject_id)))
    # TEK sorgu, tum akis icin (spec/10-kararlar.md N+1 yasagi) — owner_type='event'
    # varsayimi burada DEGIL, attachments.for_owners'in kendi sorgusunda kalir.
    media_by_event = attachments.for_owners("event", [e["id"] for e in rows])
    # Etiketler ve etiketleme yetkisi de TEK sefer, akisin tamami icin.
    flat = [r for rs in media_by_event.values() for r in rs]
    tags_by_id, can_tag = _tag_context(flat, user)
    out = []
    for e in rows:
        a = users.get(e["author_id"])
        out.append({"type": e["event_type"], "body": e["body"], "author": a,
                    "mine": a is not None and a["id"] == user["id"],
                    "time": short_time(e["created_at"]),
                    "media": _media_view(media_by_event.get(e["id"], []), user,
                                         tags_by_id, can_tag)})
    return out


def event_message(event_id, user) -> dict | None:
    """Tek olayin balon sozlugu — feed_of ile AYNI bicim, tek satir icin.

    Bir ek silindikten sonra o balonun kendisini yeniden cizmek icin
    (DELETE /media/{id} sozlesme §6): akisin tamamini yeniden yuklemeye gerek yok.
    """
    id_ = db.uid(event_id)
    e = db.q1("select * from events where id = %s", (id_,)) if id_ is not None else None
    if e is None:
        return None
    users = users_by_id()
    a = users.get(e["author_id"])
    media_by_event = attachments.for_owners("event", [e["id"]])
    rows = media_by_event.get(e["id"], [])
    tags_by_id, can_tag = _tag_context(rows, user)
    return {"type": e["event_type"], "body": e["body"], "author": a,
            "mine": a is not None and a["id"] == user["id"],
            "time": short_time(e["created_at"]),
            "media": _media_view(rows, user, tags_by_id, can_tag)}


def add_message(user, item, body: str, attachment: dict | None = None) -> dict | None:
    """Mesaj yaz, istege bagli TEK ekle. Yetki cagiran ucta kontrol edilir.

    attachment, media.save()'in ciktisidir — olay ve ek satiri ayni mantiksal
    islemde yazilir: once olay (id gerekli), sonra attachments.attach() ile
    ona bagli ek (owner_type='event').
    """
    body = body.strip()
    if not body and not attachment:
        return None
    event_id = log(item["id"], "message", user["id"], body)
    saved = attachments.attach("event", event_id, user["id"], attachment) if attachment else None
    db.x("update items set updated_at = %s where id = %s", (db.now(), item["id"]))
    return {"type": "message", "body": body, "author": user, "mine": True,
            "time": short_time(db.now()), "media": _media_view([saved], user, *_tag_context([saved], user))
            if saved else []}


def add_team_message(user, team, body: str, attachment: dict | None = None) -> dict | None:
    """Takim duvarina mesaj, istege bagli TEK ekle. Yetki cagiran ucta (auth.can_post_team).

    Kartin aksine `updated_at` dokunulmaz: takimin "son hareket"i diye bir
    siralama yok, duvar kendi kronolojisinde akar.
    """
    body = body.strip()
    if not body and not attachment:
        return None
    event_id = log(team["id"], "message", user["id"], body, subject_type="team")
    saved = attachments.attach("event", event_id, user["id"], attachment) if attachment else None
    return {"type": "message", "body": body, "author": user, "mine": True,
            "time": short_time(db.now()), "media": _media_view([saved], user, *_tag_context([saved], user))
            if saved else []}


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
    if field == "status" and value == "closed":
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
    log(item["id"], "system", user["id"], f"{user['name']} {names[field]} {old} → {new} yaptı")
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
    if kind not in ("issue", "task"):
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
         "assignee_id,created_by,created_at,updated_at) values (%s,%s,%s,%s,%s,'open','medium',%s,%s,%s,%s,%s)",
         (item_id, node_id, kind, title.strip(), description.strip() or None,
          team_id, user["id"], user["id"], now, now))
    db.x("insert into item_participants (item_id,user_id,added_by,added_at) values (%s,%s,%s,%s)",
         (item_id, user["id"], user["id"], now))
    extra = f", takım: {teams_by_id()[team_id]['name']}" if team_id else ""
    log(item_id, "system", user["id"], f"{user['name']} bu kaydı açtı ({TREE.name(node_id)}{extra})")
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
         " values (%s,%s,%s,%s,'open',%s,%s,%s)",
         (action_id, item["id"], title.strip(), assignee_id, due_date or None, user["id"], now))
    db.x("update items set updated_at = %s where id = %s", (now, item["id"]))
    to_whom = f" → {users[assignee_id]['name']}" if assignee_id else " (havuzda, üstlenen bekliyor)"
    log(item["id"], "system", user["id"], f"{user['name']} eylem ekledi: {title.strip()}{to_whom}")
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
    if field == "status" and value not in ACTION_STATUS:
        raise HTTPException(400, "geçersiz değer")
    if field == "assignee_id":
        value = db.uid(value) if value else None     # form metni -> uuid
        if value is not None and value not in users:
            raise HTTPException(400, "kullanıcı yok")
    if value == action[field]:
        return False

    now = db.now()
    if field == "status":
        done = value in ("closed", "cancelled")
        db.x("update actions set status = %s, resolved_by = %s, resolved_at = %s where id = %s",
             (value, user["id"] if done else None, now if done else None, action["id"]))
        log(item["id"], "system", user["id"],
            f"{user['name']} \"{action['title']}\" eylemini {ACTION_STATUS[value]} yaptı")
    else:
        db.x(f"update actions set {field} = %s where id = %s", (value, action["id"]))
        if field == "assignee_id":
            who = users[value]["name"] if value else "—"
            log(item["id"], "system", user["id"],
                f"{user['name']} \"{action['title']}\" eylemini {who} kişisine atadı")
        else:
            log(item["id"], "system", user["id"],
                f"{user['name']} \"{action['title']}\" eyleminin son tarihini {value or '—'} yaptı")
    db.x("update items set updated_at = %s where id = %s", (now, item["id"]))
    return True
