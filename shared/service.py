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
TAKIM_ROL = {"lider": "Lider", "mentor": "Mentor", "uye": "Üye"}
AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"]

PRIO_SQL = ("case priority when 'kritik' then 0 when 'yuksek' then 1"
            " when 'orta' then 2 else 3 end")
PRIO_SQL_I = ("case i.priority when 'kritik' then 0 when 'yuksek' then 1"
              " when 'orta' then 2 else 3 end")                      # join'li sorgular
# Rol sirasi ekranda da SQL'de de ayni: once lider, sonra mentor, sonra uye.
# ("m" = team_members takma adi; iki takim sorgusu da bu adi kullanir.)
ROL_SIRA = "case m.role when 'lider' then 0 when 'mentor' then 1 else 2 end"
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


# --- dugum duzenleme (veri yonetimi ekrani) ------------------------------
#
# Her degisiklikten sonra TreeIndex KOMPLE yeniden kurulur — kismi guncelleme
# yok (shared/tree.py). Agac surec bellegindedir, yani bu islevler yalnizca
# --workers 1 varsayimiyla dogru; ikinci bir isci kendi bayat agaciyla kalir.


def _dugum_olayi(node_id, author_id, metin: str) -> None:
    """Agac gecmisi events'e yazilir — AYRI TABLO YOK.

    003'te takim duvari icin ayni sey yapilmisti: subject_type'a yeni bir
    deger eklenir, tablo ve indeks paylasilir. Boylece "ne oldu" sorusunun
    tek kaynagi kalir ve mevcut akis bileseni dugum gecmisini de cizebilir.
    """
    log(node_id, "sistem", db.uid(author_id) if author_id else None, metin,
        subject_type="node")


def dugum_ekle(ad: str, node_type: str, parent_id=None, aciklama: str | None = None,
               created_by=None) -> dict | None:
    """Yeni dugum. parent_id None ise kok."""
    ad = (ad or "").strip()
    node_type = (node_type or "").strip()
    if not ad or not node_type:
        return None

    ust = db.uid(parent_id) if parent_id else None
    if ust is not None and ust not in TREE.nodes:
        return None                       # olmayan ustun altina yazma

    # Kardeslerin sonuna: sira numarasi elle verilmiyor, ekleme sirasi korunuyor.
    kardesler = TREE.children.get(ust, []) if ust else TREE.roots
    sira = max((TREE.nodes[k].sort_order for k in kardesler), default=-1) + 1

    satir = db.q1(
        "insert into nodes (id,parent_id,name,node_type,sort_order,description,created_by,created_at)"
        " values (%s,%s,%s,%s,%s,%s,%s,%s) returning *",
        (db.new_id(), ust, ad, node_type, sira, (aciklama or "").strip() or None,
         db.uid(created_by) if created_by else None, db.now()))
    rebuild_tree()
    _dugum_olayi(satir["id"], created_by, f"{ad} eklendi ({node_type})")
    return satir


def dugum_guncelle(node_id, ad: str | None = None, node_type: str | None = None,
                   aciklama: str | None = None, degistiren=None) -> bool:
    """Ad / tur / aciklama. Verilmeyen alan DEGISMEZ (None = dokunma)."""
    kimlik = db.uid(node_id)
    if kimlik is None or kimlik not in TREE.nodes:
        return False

    alanlar, degerler = [], []
    if ad is not None:
        if not ad.strip():
            return False                  # adsiz dugum agacta okunmaz olur
        alanlar.append("name = %s"); degerler.append(ad.strip())
    if node_type is not None:
        if not node_type.strip():
            return False
        alanlar.append("node_type = %s"); degerler.append(node_type.strip())
    if aciklama is not None:
        # Bos metin "aciklamayi sil" demek; None ile karistirma.
        alanlar.append("description = %s"); degerler.append(aciklama.strip() or None)
    if not alanlar:
        return False

    onceki_ad = TREE.name(kimlik)
    db.x(f"update nodes set {', '.join(alanlar)} where id = %s", (*degerler, kimlik))
    rebuild_tree()                        # ad degistiyse agactaki etiket de degisti
    yeni_ad = TREE.name(kimlik)
    _dugum_olayi(kimlik, degistiren,
                 f"{onceki_ad} -> {yeni_ad} olarak adlandirildi" if onceki_ad != yeni_ad
                 else f"{yeni_ad} guncellendi")
    return True


def dugum_tasi(node_id, yeni_ust_id, tasiyan=None) -> bool:
    """Dugumu baska bir ustun altina alir. yeni_ust_id None ise koke cikarir."""
    kimlik = db.uid(node_id)
    if kimlik is None or kimlik not in TREE.nodes:
        return False

    ust = db.uid(yeni_ust_id) if yeni_ust_id else None
    if ust is not None:
        if ust not in TREE.nodes:
            return False
        # DONGU KORUMASI: hedef, tasinan dugumun alt agacinda olamaz. Olsaydi
        # agac bir halkaya donerdi ve Euler turu sonsuz donerdi.
        if TREE.is_descendant(ust, kimlik):
            return False

    ad = TREE.name(kimlik)
    nereye = TREE.name(ust) if ust else "köke"
    db.x("update nodes set parent_id = %s where id = %s", (ust, kimlik))
    rebuild_tree()
    _dugum_olayi(kimlik, tasiyan, f"{ad} {nereye} taşındı")
    return True


def dugum_sil(node_id, silen=None) -> bool:
    """Dugumu ve ALT AGACINI siler (nodes.parent_id on delete cascade).

    Kayitlar da gider: items.node_id -> nodes on delete cascade. Bu yuzden
    cagiran taraf once kac kayit etkilenecegini gostermeli.
    """
    kimlik = db.uid(node_id)
    if kimlik is None or kimlik not in TREE.nodes:
        return False
    # Ad SILMEDEN ONCE okunur: satir gidince gecmis "bir sey silindi" demekten
    # oteye gitmezdi (events.subject_id FK degil, satir kaliyor ama ad kalmiyor).
    ad = TREE.name(kimlik)
    alt_sayi = len(TREE.subtree(kimlik)) - 1
    db.x("delete from nodes where id = %s", (kimlik,))
    rebuild_tree()
    _dugum_olayi(kimlik, silen,
                 f"{ad} silindi" + (f" (+{alt_sayi} alt düğüm)" if alt_sayi else ""))
    return True


def dugum_kayit_sayilari() -> dict:
    """Dugum basina kayit sayisi — silmeden once ne kaybedilecegi gorunsun."""
    return {r["node_id"]: r["c"]
            for r in db.q("select node_id, count(*) c from items group by node_id")}


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
    kimlik = db.uid(team_id)
    r = db.q1("select * from teams where id = %s", (kimlik,)) if kimlik else None
    if r is None:
        raise HTTPException(404, "takım yok")
    return r


def team_rows() -> list[dict]:
    """Ekipler listesi: takim + uye/kayit/eylem sayilari, TEK sorgu."""
    return db.q(
        "select t.*,"
        " (select count(*) from team_members m join users u on u.id = m.user_id"
        "  where m.team_id = t.id and u.is_active) uye,"
        " (select count(*) from items i where i.team_id = t.id"
        "  and i.status <> 'kapandi') acik,"
        " (select count(*) from items i where i.team_id = t.id) hepsi,"
        " (select count(*) from actions a join items i on i.id = a.item_id"
        "  where i.team_id = t.id and a.status in ('acik','devam')) acik_eylem"
        " from teams t order by t.name")


def members_by_team() -> dict:
    """Tum uyelikler tek sorguda — liste ekrani takim basina sorgu atmasin."""
    out: dict = {}
    for r in db.q("select m.team_id, m.role, u.id, u.name, u.color"
                  " from team_members m join users u on u.id = m.user_id"
                  f" where u.is_active order by {ROL_SIRA}, u.name"):
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
        "  and a.status in ('acik','devam')) acik_eylem"
        " from team_members m join users u on u.id = m.user_id"
        f" where m.team_id = %s and u.is_active order by {ROL_SIRA}, u.name",
        (db.uid(team_id),))


def team_open_count(team_id) -> int:
    """Takimin acik kayit sayisi — team_items kirpilmis olabilir, rozet tami soyler."""
    r = db.q1("select count(*) c from items where team_id = %s and status <> 'kapandi'",
              (db.uid(team_id),))
    return r["c"] or 0


def team_items(team_id, limit: int = 20) -> list[dict]:
    """Takimin acik kayitlari — oncelik sirasinda, ilk `limit` satir.

    Tamami gorev tablosunda: /gorevler?takim=<id> (ayni suzgec, ikinci tablo yok).
    """
    return db.q(
        "select i.*, t.name team_name, t.color team_color,"
        " (select count(*) from actions a where a.item_id = i.id"
        "  and a.status in ('acik','devam')) acik_eylem"
        " from items i left join teams t on t.id = i.team_id"
        " where i.team_id = %s and i.status <> 'kapandi'"
        f" order by {PRIO_SQL_I}, i.updated_at desc limit %s",
        (db.uid(team_id), limit))


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



def log(subject_id: str, etype: str, author_id: str | None, body: str,
        subject_type: str = "item") -> None:
    db.x("insert into events (id,subject_type,subject_id,event_type,author_id,body,created_at)"
         " values (%s,%s,%s,%s,%s,%s,%s)",
         (db.new_id(), subject_type, subject_id, etype, author_id, body, db.now()))


def feed_of(subject_type: str, subject_id, user) -> list[dict]:
    """Olay akisi (sistem + mesaj, tek kronoloji).

    Kart akisi ve takim duvari AYNI tablodan okur (spec/20-sema.md §5); sablon
    da ayni (fragments/card_feed.html) — akis nerede gosterildigini bilmez.
    """
    users = users_by_id()
    out = []
    for e in db.q("select * from events where subject_type = %s and subject_id = %s"
                  " order by created_at", (subject_type, db.uid(subject_id))):
        a = users.get(e["author_id"])
        out.append({"type": e["event_type"], "body": e["body"], "author": a,
                    "mine": a is not None and a["id"] == user["id"],
                    "time": short_time(e["created_at"])})
    return out


def add_message(user, item, body: str) -> dict | None:
    """Mesaj yaz. Yetki cagiran ucta kontrol edilir; is mantigi tek yerde."""
    body = body.strip()
    if not body:
        return None
    log(item["id"], "mesaj", user["id"], body)
    db.x("update items set updated_at = %s where id = %s", (db.now(), item["id"]))
    return {"type": "mesaj", "body": body, "author": user, "mine": True,
            "time": short_time(db.now())}


def add_team_message(user, team, body: str) -> dict | None:
    """Takim duvarina mesaj. Yetki cagiran ucta (auth.can_post_team).

    Kartin aksine `updated_at` dokunulmaz: takimin "son hareket"i diye bir
    siralama yok, duvar kendi kronolojisinde akar.
    """
    body = body.strip()
    if not body:
        return None
    log(team["id"], "mesaj", user["id"], body, subject_type="team")
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

