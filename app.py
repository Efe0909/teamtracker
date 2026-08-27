"""EkipTakip — Faz 1 (alpha-0.1).

FastAPI + Jinja2 + HTMX + SQLite, ham SQL. JavaScript yazilmaz.
Calistir: .venv/bin/uvicorn app:app --workers 1 --reload
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from contextlib import asynccontextmanager

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import (FileResponse, HTMLResponse, JSONResponse,
                               RedirectResponse)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import auth
import db
from tree import TreeIndex

BASE = Path(__file__).parent


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.connect()
    rebuild_tree()
    yield


app = FastAPI(title="EkipTakip", version="0.1.0-alpha", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
templates = Jinja2Templates(directory=BASE / "templates")

STATUSES = {"acik": "Açık", "devam": "Devam", "beklemede": "Beklemede", "kapandi": "Kapandı"}
PRIORITIES = {"kritik": "Kritik", "yuksek": "Yüksek", "orta": "Orta", "dusuk": "Düşük"}
EDITABLE = {"status": STATUSES, "priority": PRIORITIES, "assignee_id": None, "due_date": None}

# --- ana sayfa modul kaydi: tek dogruluk kaynagi (ana sayfa ve /{slug} ayni listeyi okur)

MODULES = [
    {"slug": "gorevler", "icon": "📋", "name": "Görev Yöneticisi", "ready": True,
     "desc": "Kayıt tablosu, kart içi sohbet, atama ve alan değişiklikleri. Faz 1'in çalışan dilimi.",
     "plan": []},
    {"slug": "kazanim-agaci", "icon": "🌳", "name": "Kazanım Ağacı", "ready": False,
     "desc": "Cell / makine kırılımını düzenlediğin ekran: düğüm ekle, adlandır, taşı, sil.",
     "plan": ["Ağaç düzenleme nodes üzerinde çalışır; değişiklik anında uygulanır.",
              "is_editor olmayanın değişikliği change_requests'e düşer, prev_state ile geri alınabilir (01-sema.md §4).",
              "Yapı her değiştiğinde TreeIndex komple yeniden kurulur ve nodes.tin/tout tek UPDATE ile yazılır.",
              "Taşımada döngü koruması: hedef, taşınan düğümün alt ağacında olamaz."]},
    {"slug": "pivot", "icon": "📊", "name": "Pivot & Veri Analizi", "ready": False,
     "desc": "Kayıtları düğüm, DMS, pillar, sorumlu ve zaman kırılımında çapraz say.",
     "plan": ["Gruplama ve sayım SQL'de; Python'a dönen satır ekranda görünen satırdır (00-BASLA.md Karar 4).",
              "Alt ağaç kırılımı tin/tout aralık taramasıyla — recursive CTE yok.",
              "Bir hücreden tıklayınca aynı filtrelerle görev tablosuna geçiş.",
              "Faz 2 kapsamı."]},
    {"slug": "takvim", "icon": "📅", "name": "Takvim", "ready": False,
     "desc": "Son tarihler, gecikmeler ve ekip yükü ay / hafta görünümünde.",
     "plan": ["items.due_date üzerinden ay ve hafta görünümü.",
              "Gecikmiş kayıtlar (due_date < bugün ve status <> 'kapandi') ayrı vurgulanır.",
              "Bir güne tıklayınca o günün kayıtları görev tablosunda süzülür."]},
    {"slug": "tanimlar", "icon": "📐", "name": "Görev Tanımları & Şemalar", "ready": False,
     "desc": "Rol tanımları, yönetim şemaları ve standart iş akışları — kimin neyi yaptığı.",
     "plan": ["Şemalar hiyerarşinin kendisinden türer: düğüm → sorumlu → yedek.",
              "Tanım metinleri düğüme bağlı sürümlenir; değişiklik akışa sistem olayı düşer.",
              "Salt okunur görünüm herkese açık, düzenleme is_editor kapsamına bağlı."]},
    {"slug": "arsiv", "icon": "🗂", "name": "Ekip Arşivi", "ready": False,
     "desc": "Kapanmış kayıtlar, alınan kararlar ve geçmiş dönemlerin kurumsal hafızası.",
     "plan": ["Kapanmış kayıtlar silinmez, arşive düşer (01-sema.md açık nokta 3: deleted_at).",
              "Tam metin arama FTS5 üzerinden — LIKE '%…%' yok.",
              "Karar kayıtları kartın olay akışından toplanır."]},
    {"slug": "dosyalar", "icon": "🗄", "name": "Dosyalar / NAS", "ready": False,
     "desc": "Karta ve düğüme bağlı dosyalar; NAS klasörleriyle tek yerden erişim.",
     "plan": ["01-sema.md açık nokta 1: attachments tablosu mu, düğüme bağlı NAS yolu mu — karar bekliyor.",
              "Faz 1'de dosya yükleme bilerek yok; yükleme kaynaklı saldırı yüzeyi de yok (README).",
              "Erişim yetkisi kartın yetkisiyle aynı yerden gelir, ikinci bir model kurulmaz."]},
    {"slug": "admin", "icon": "🛡", "name": "Yönetim Paneli", "ready": False,
     "desc": "Kullanıcılar, kapsamlar, yetkiler ve bekleyen değişiklik talepleri.",
     "plan": ["Kullanıcı kapsamı (scope_node_id), is_admin / is_editor bayrakları buradan yönetilir.",
              "Açık change_requests kuyruğu: onayla / reddet — ret prev_state'ten geri yazar.",
              "Bildirim tercihleri ve susturmalar (01-sema.md §6).",
              "Yetki her uçta sunucuda kontrol edilir; panel sadece görünen yüzü."]},
]
MODULE_BY_SLUG = {m["slug"]: m for m in MODULES}


def home_stats(user) -> dict:
    """Ana sayfa rozetleri — tek sorgu, sayfa basina yedi COUNT degil."""
    r = db.q1(
        "select"
        " sum(case when status <> 'kapandi' then 1 else 0 end) acik,"
        " sum(case when status <> 'kapandi' and assignee_id is null then 1 else 0 end) atanmamis,"
        " sum(case when status <> 'kapandi' and assignee_id = ? then 1 else 0 end) bana,"
        " count(*) hepsi from items", (user["id"],))
    return {"open": r["acik"] or 0, "unassigned": r["atanmamis"] or 0,
            "mine": r["bana"] or 0, "all": r["hepsi"] or 0, "nodes": len(TREE.nodes)}

# --- agac indeksi: tek surec, yapi degisince komple yeniden kurulur --------

TREE: TreeIndex = TreeIndex()


def rebuild_tree() -> TreeIndex:
    global TREE
    TREE = TreeIndex.build(db.q("select id,parent_id,name,node_type,sort_order from nodes"))
    return TREE


# --- okuma yardimcilari (is mantigi Python'da, sablonda degil) -------------


def users_by_id() -> dict:
    return {u["id"]: u for u in auth.all_users()}


def open_counts() -> dict[str, int]:
    """Dugum basina acik kayit sayisi, alt agac dahil (agac rozetleri)."""
    direct: dict[str, int] = {}
    for r in db.q("select node_id, count(*) c from items where status <> 'kapandi' group by node_id"):
        direct[r["node_id"]] = r["c"]
    return {nid: sum(direct.get(k, 0) for k in TREE.subtree(nid)) for nid in TREE.nodes}


def last_line(item_id: str) -> str:
    r = db.q1("select e.body, u.name from events e left join users u on u.id = e.author_id"
              " where e.subject_type='item' and e.subject_id=? order by e.created_at desc limit 1",
              (item_id,))
    if not r:
        return ""
    return f"{r['name']}: {r['body']}" if r["name"] else r["body"]


def group_of(ts: str) -> str:
    when = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    today = datetime.now(timezone.utc).date()
    if when.date() == today:
        return "Bugün"
    if when.date() > today - timedelta(days=7):
        return "Bu hafta"
    return "Daha eski"


def short_time(ts: str) -> str:
    when = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    today = datetime.now(timezone.utc).date()
    if when.date() == today:
        return when.strftime("%H:%M")
    if when.date() > today - timedelta(days=7):
        return ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"][when.weekday()]
    return f"{when.day} {['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'][when.month-1]}"


def item_rows(where: str, args: tuple) -> list[dict]:
    """Panel satirlari — gruplama ve siralama burada, sablonda degil."""
    rows = db.q(f"select * from items where {where} order by updated_at desc", args)
    users = users_by_id()
    out = []
    for r in rows:
        a = users.get(r["assignee_id"])
        out.append({
            "id": r["id"], "kind": r["kind"], "title": r["title"], "status": r["status"],
            "priority": r["priority"], "dms": r["dms"], "pillar": r["pillar"],
            "assignee": a, "path": " › ".join(TREE.name(n) for n in TREE.ancestors(r["node_id"])[-2:]),
            "last": last_line(r["id"]), "time": short_time(r["updated_at"]),
            "group": group_of(r["updated_at"]),
        })
    return out


def grouped(rows: list[dict]) -> list[tuple[str, list[dict]]]:
    order = ["Bugün", "Bu hafta", "Daha eski"]
    return [(g, [r for r in rows if r["group"] == g]) for g in order
            if any(r["group"] == g for r in rows)]


def inbox_rows(user) -> list[dict]:
    """Bana ait: sorumlusu ben ya da karta dahil edilmisim."""
    return item_rows(
        "assignee_id = ? or id in (select item_id from item_participants where user_id = ?)",
        (user["id"], user["id"]))


def tree_rows() -> list[dict]:
    counts = open_counts()
    out = []
    for root in TREE.roots:
        for nid in TREE.subtree(root):
            out.append({"id": nid, "name": TREE.name(nid), "depth": TREE.depth[nid],
                        "count": counts.get(nid, 0), "leaf": not TREE.children.get(nid)})
    out.sort(key=lambda n: TREE.tin[n["id"]])
    return out


def get_item(item_id: str):
    r = db.q1("select * from items where id = ?", (item_id,))
    if r is None:
        raise HTTPException(404, "kayıt yok")
    return r


def card_ctx(request, item, user) -> dict:
    users = users_by_id()
    feed = []
    for e in db.q("select * from events where subject_type='item' and subject_id=?"
                  " order by created_at", (item["id"],)):
        a = users.get(e["author_id"])
        feed.append({"type": e["event_type"], "body": e["body"], "author": a,
                     "mine": a is not None and a["id"] == user["id"],
                     "time": short_time(e["created_at"])})
    return {
        "request": request, "user": user, "item": item,
        "assignee": users.get(item["assignee_id"]),
        "participants": [users[p] for p in auth.participant_ids(item["id"]) if p in users],
        "users": list(users.values()), "feed": feed,
        "crumbs": [{"id": n, "name": TREE.name(n)} for n in TREE.ancestors(item["node_id"])],
        "can_edit": auth.can_edit_item(user, item, TREE),
        "tree": tree_rows(), "statuses": STATUSES, "priorities": PRIORITIES,
        "status_label": STATUSES[item["status"]], "priority_label": PRIORITIES[item["priority"]],
    }


def render(request, name: str, ctx: dict) -> HTMLResponse:
    return templates.TemplateResponse(request, name, ctx)


def is_htmx(request) -> bool:
    return request.headers.get("HX-Request") == "true"


def log(item_id: str, etype: str, author_id: str | None, body: str) -> None:
    db.x("insert into events (id,subject_type,subject_id,event_type,author_id,body,created_at)"
         " values (?,'item',?,?,?,?,?)",
         (db.new_id(), item_id, etype, author_id, body, db.now()))


# --- uclar ----------------------------------------------------------------


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    """Ana sayfa: modul secimi. Ekranlar buradan dallanir."""
    user = auth.current_user(request)
    stats = home_stats(user)
    mods = [dict(m, href=("/" + m["slug"]),
                 count=stats["all"] if m["slug"] == "gorevler" else None) for m in MODULES]
    return render(request, "home.html", {
        "user": user, "all_users": auth.all_users(), "modules": mods, "stats": stats,
        "scope_name": TREE.name(user["scope_node_id"]) if user["scope_node_id"] else "tüm ağaç",
    })


@app.get("/gorevler", response_class=HTMLResponse)
def tasks(request: Request, item: str | None = None):
    user = auth.current_user(request)
    rows = inbox_rows(user)
    current = get_item(item) if item else (
        db.q1("select * from items where id = ?", (rows[0]["id"],)) if rows else None)
    ctx = {
        "user": user, "all_users": auth.all_users(), "panel_title": "Bana ait",
        "panel": "inbox", "groups": grouped(rows), "selected": current["id"] if current else None,
        "tree": tree_rows(), "item": None,
    }
    if current is not None:
        ctx.update(card_ctx(request, current, user))
    return render(request, "base.html", ctx)


@app.get("/panel/inbox", response_class=HTMLResponse)
def panel_inbox(request: Request):
    user = auth.current_user(request)
    return render(request, "fragments/panel_inbox.html",
                  {"user": user, "groups": grouped(inbox_rows(user)), "selected": None,
                   "panel_title": "Bana ait", "oob_head": True})


@app.get("/panel/tree", response_class=HTMLResponse)
def panel_tree(request: Request):
    return render(request, "fragments/panel_tree.html",
                  {"tree": tree_rows(), "selected_node": None,
                   "panel_title": "Hiyerarşi", "oob_head": True})


@app.get("/node/{node_id}/items", response_class=HTMLResponse)
def node_items(request: Request, node_id: str):
    if node_id not in TREE.nodes:
        raise HTTPException(404, "düğüm yok")
    user = auth.current_user(request)
    ids = TREE.subtree(node_id)
    rows = item_rows(f"node_id in ({','.join('?' * len(ids))})", tuple(ids))
    return render(request, "fragments/panel_inbox.html",
                  {"user": user, "groups": grouped(rows), "selected": None,
                   "panel_title": TREE.name(node_id), "oob_head": True})


@app.get("/item/{item_id}", response_class=HTMLResponse)
def item_view(request: Request, item_id: str):
    user = auth.current_user(request)
    item = get_item(item_id)
    ctx = card_ctx(request, item, user)
    if not is_htmx(request):
        return RedirectResponse(f"/gorevler?item={item_id}", status_code=303)
    return render(request, "fragments/card.html", ctx)


def add_message(user, item, body: str) -> dict | None:
    """Mesaj yaz. Yetki cagiran ucta kontrol edilir; is mantigi tek yerde."""
    body = body.strip()
    if not body:
        return None
    log(item["id"], "mesaj", user["id"], body)
    db.x("update items set updated_at = ? where id = ?", (db.now(), item["id"]))
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

    db.x(f"update items set {field} = ?, updated_at = ? where id = ?",
         (value, db.now(), item["id"]))
    names = {"status": "durumu", "priority": "önceliği", "assignee_id": "sorumluyu",
             "due_date": "son tarihi"}
    log(item["id"], "sistem", user["id"], f"{user['name']} {names[field]} {old} → {new} yaptı")
    return True


@app.post("/item/{item_id}/message", response_class=HTMLResponse)
def post_message(request: Request, item_id: str, body: str = Form("")):
    user = auth.current_user(request)
    item = get_item(item_id)
    if not auth.can_edit_item(user, item, TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    m = add_message(user, item, body)
    if m is None:
        return HTMLResponse("")
    return render(request, "fragments/card_message.html", {"m": m})


@app.patch("/item/{item_id}/field", response_class=HTMLResponse)
async def patch_field(request: Request, item_id: str):
    user = auth.current_user(request)
    item = get_item(item_id)
    if not auth.can_edit_item(user, item, TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    if not change_field(user, item, await request.form()):
        return render(request, "fragments/card_fields.html", card_ctx(request, item, user))

    ctx = card_ctx(request, get_item(item_id), user)
    ctx["oob_feed"] = True  # card_fields + card_feed birlikte tazelenir (hx-swap-oob)
    return render(request, "fragments/card_fields.html", ctx)


def new_item(user, node_id: str, kind: str, title: str, description: str = "") -> str:
    """Yeni kayit. Yetki burada: kapsam disinda dal secilemez (masaustu ve mobil ayni yol)."""
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
         "created_by,created_at,updated_at) values (?,?,?,?,?,'acik','orta',?,?,?,?)",
         (item_id, node_id, kind, title.strip(), description.strip() or None,
          user["id"], user["id"], now, now))
    db.x("insert into item_participants (item_id,user_id,added_by,added_at) values (?,?,?,?)",
         (item_id, user["id"], user["id"], now))
    log(item_id, "sistem", user["id"], f"{user['name']} bu kaydı açtı ({TREE.name(node_id)})")
    return item_id


@app.post("/item", response_class=HTMLResponse)
def create_item(request: Request, node_id: str = Form(...), title: str = Form(...),
                kind: str = Form("hata"), description: str = Form("")):
    user = auth.current_user(request)
    item_id = new_item(user, node_id, kind, title, description)
    return render(request, "fragments/card.html", card_ctx(request, get_item(item_id), user))


@app.get("/whoami")
def whoami(request: Request):
    u = auth.current_user(request)
    return JSONResponse({"id": u["id"], "name": u["name"], "email": u["email"],
                         "is_admin": db.as_bool(u["is_admin"]),
                         "scope": TREE.name(u["scope_node_id"]) if u["scope_node_id"] else None})


@app.post("/switch/{user_id}")
def switch_user(request: Request, user_id: str):
    if auth.get_user(user_id) is None:
        raise HTTPException(404, "kullanıcı yok")
    back = urlparse(request.headers.get("referer") or "").path or "/"   # sadece yol: acik yonlendirme yok
    r = RedirectResponse(back, status_code=303)
    r.set_cookie(auth.COOKIE, user_id, httponly=True, samesite="lax")
    return r


# --- mobil site (/m): ayni veritabani, ayni yetki, ayri yerlesim ----------
#
# Safari'de "Ana Ekrana Ekle" ile applet gibi durur (manifest + service worker).
# Push Faz 3'te buraya baglanir (01-sema.md §7, 02-push-handoff.md).

MOBILE_TABS = [
    {"slug": "yapilacaklar", "href": "/m", "icon": "📋", "label": "Yapılacak"},
    {"slug": "ara", "href": "/m/ara", "icon": "🔎", "label": "Ara"},
    {"slug": "eylemler", "href": "/m/eylemler", "icon": "⚡", "label": "Eylemler"},
    {"slug": "bildirimler", "href": "/m/bildirimler", "icon": "🔔", "label": "Bildirim"},
]
AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"]
PRIO_SQL = ("case priority when 'kritik' then 0 when 'yuksek' then 1"
            " when 'orta' then 2 else 3 end")
MINE_SQL = ("(assignee_id = ? or id in"
            " (select item_id from item_participants where user_id = ?))")
MINE_SQL_I = ("(i.assignee_id = ? or i.id in"
              " (select item_id from item_participants where user_id = ?))")   # join'li sorgular


def rel_time(ts: str) -> str:
    """'19 saat önce' — bildirim akisinda mutlak saat degil, mesafe okunur."""
    when = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    sec = (datetime.now(timezone.utc) - when).total_seconds()
    if sec < 90:
        return "az önce"
    if sec < 3600:
        return f"{int(sec // 60)} dakika önce"
    if sec < 86400:
        return f"{int(sec // 3600)} saat önce"
    if sec < 7 * 86400:
        return f"{int(sec // 86400)} gün önce"
    return f"{when.day} {AYLAR[when.month - 1]}"


def due_info(due: str | None) -> dict | None:
    """Son tarih rozeti: metin + gecikti mi + kac gun kaldi."""
    if not due:
        return None
    try:
        d = datetime.strptime(due, "%Y-%m-%d").date()
    except ValueError:
        return None
    left = (d - datetime.now(timezone.utc).date()).days
    return {"label": f"{d.day} {AYLAR[d.month - 1]} {d.year}", "days": left, "late": left < 0}


def mobile_row(r, users: dict) -> dict:
    """Mobil kart sozlugu — sablon SQL satirini degil bunu gorur."""
    a = users.get(r["assignee_id"])
    return {
        "id": r["id"], "kind": r["kind"], "title": r["title"], "status": r["status"],
        "status_label": STATUSES[r["status"]], "priority": r["priority"],
        "priority_label": PRIORITIES[r["priority"]], "dms": r["dms"], "pillar": r["pillar"],
        "assignee": a,
        "node": TREE.name(r["node_id"]),
        "path": " › ".join(TREE.name(n) for n in TREE.ancestors(r["node_id"])[-2:]),
        "due": due_info(r["due_date"]), "time": rel_time(r["updated_at"]),
        "msgs": db.q1("select count(*) c from events where subject_type='item'"
                      " and subject_id=? and event_type='mesaj'", (r["id"],))["c"],
    }


def mobile_todo(user, done: bool = False) -> list[dict]:
    """Bana ait kayitlar. Siralama SQL'de: once oncelik, sonra son tarih."""
    op = "=" if done else "<>"
    rows = db.q(f"select * from items where status {op} 'kapandi' and {MINE_SQL}"
                f" order by {PRIO_SQL}, (due_date is null), due_date, updated_at desc limit 60",
                (user["id"], user["id"]))
    users = users_by_id()
    return [mobile_row(r, users) for r in rows]


def mobile_actions(user) -> list[tuple[str, list[dict]]]:
    """Son tarihi olan acik kayitlar — gecikmis olan basta."""
    rows = db.q(f"select * from items where status <> 'kapandi' and due_date is not null"
                f" and {MINE_SQL} order by due_date, {PRIO_SQL} limit 60",
                (user["id"], user["id"]))
    users = users_by_id()
    groups: dict[str, list[dict]] = {"Gecikmiş": [], "Bu hafta": [], "Sonra": []}
    for r in rows:
        m = mobile_row(r, users)
        left = m["due"]["days"] if m["due"] else 999
        groups["Gecikmiş" if left < 0 else "Bu hafta" if left <= 7 else "Sonra"].append(m)
    return [(g, rows_) for g, rows_ in groups.items() if rows_]


def mobile_notifs(user, limit: int = 40) -> list[dict]:
    """Bildirim akisi — Faz 1'de events'ten turetilir.

    Gercek bildirim tablosu (okundu bilgisi, yonlendirme, susturma) 01-sema.md §6'da;
    o gelene kadar 'bana ait kartlarda baskasinin yaptigi hareket' listesi yeterli.
    """
    rows = db.q(
        "select e.*, i.id item_id, i.title from events e join items i on i.id = e.subject_id"
        f" where e.subject_type='item' and {MINE_SQL_I}"
        " and (e.author_id is null or e.author_id <> ?)"
        " order by e.created_at desc limit ?",
        (user["id"], user["id"], user["id"], limit))
    users = users_by_id()
    return [{"item_id": r["item_id"], "title": r["title"], "type": r["event_type"],
             "body": r["body"], "author": users.get(r["author_id"]),
             "time": rel_time(r["created_at"])} for r in rows]


def notif_badge(user) -> int:
    """Son 24 saatteki hareket sayisi. Okundu bilgisi Faz 3'te gelir (01-sema.md §6)."""
    since = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return db.q1(
        "select count(*) c from events e join items i on i.id = e.subject_id"
        f" where e.subject_type='item' and {MINE_SQL_I}"
        " and (e.author_id is null or e.author_id <> ?) and e.created_at > ?",
        (user["id"], user["id"], user["id"], since))["c"]


def fts_query(q: str) -> str | None:
    """Kullanici metnini FTS5 sorgusuna cevirir: her kelime onek eslesmesi.

    Ozel karakterler ayiklanir — MATCH ifadesi kullanici metniyle birlestirilmez.
    """
    words = [w for w in "".join(c if c.isalnum() else " " for c in q).split() if len(w) > 1]
    return " ".join(f'"{w}"*' for w in words) or None


def search_items(q: str, limit: int = 25) -> list[dict]:
    match = fts_query(q)
    if match is None:
        return []
    rows = db.q("select i.* from items_fts f join items i on i.rowid = f.rowid"
                " where items_fts match ? order by rank limit ?", (match, limit))
    users = users_by_id()
    return [mobile_row(r, users) for r in rows]


def search_nodes(q: str, limit: int = 10) -> list[dict]:
    """Agac bellekte (00-BASLA.md Karar 2) — dugum aramasi SQL'e gitmez."""
    fold = str.maketrans("şğıöçüİ", "sgiocui")
    needle = q.lower().translate(fold)
    out = []
    for nid in TREE.nodes:
        if needle in TREE.name(nid).lower().translate(fold):
            out.append({"id": nid, "name": TREE.name(nid),
                        "path": " › ".join(TREE.name(n) for n in TREE.ancestors(nid)[:-1])})
        if len(out) == limit:
            break
    return out


def m_ctx(request, user, tab: str, title: str, **extra) -> dict:
    ctx = {"request": request, "user": user, "tabs": MOBILE_TABS, "tab": tab,
           "title": title, "badge": notif_badge(user)}
    ctx.update(extra)
    return ctx


def mobile_card_ctx(request, item, user) -> dict:
    users = users_by_id()
    feed = []
    for e in db.q("select * from events where subject_type='item' and subject_id=?"
                  " order by created_at", (item["id"],)):
        a = users.get(e["author_id"])
        feed.append({"type": e["event_type"], "body": e["body"], "author": a,
                     "mine": a is not None and a["id"] == user["id"],
                     "time": short_time(e["created_at"])})
    return {
        "request": request, "user": user, "item": item, "row": mobile_row(item, users),
        "assignee": users.get(item["assignee_id"]), "users": list(users.values()),
        "feed": feed, "can_edit": auth.can_edit_item(user, item, TREE),
        "statuses": STATUSES, "priorities": PRIORITIES,
        "status_label": STATUSES[item["status"]], "priority_label": PRIORITIES[item["priority"]],
        "tabs": MOBILE_TABS, "tab": None, "title": "Kayıt", "badge": notif_badge(user),
    }


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(BASE / "static" / "icon-192.png", media_type="image/png")


@app.get("/sw.js", include_in_schema=False)
def service_worker():
    """Kok kapsamdan servis edilir; /static altindan verilirse /m'yi kontrol edemez."""
    return FileResponse(BASE / "static" / "sw.js", media_type="text/javascript",
                        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"})


@app.get("/m", response_class=HTMLResponse)
def m_todo(request: Request, sekme: str = "acik"):
    user = auth.current_user(request)
    done = sekme == "kapali"
    return render(request, "mobile/todo.html",
                  m_ctx(request, user, "yapilacaklar", "Yapılacaklar",
                        rows=mobile_todo(user, done), done=done))


@app.get("/m/ara", response_class=HTMLResponse)
def m_search(request: Request, q: str = ""):
    user = auth.current_user(request)
    q = q.strip()
    ctx = m_ctx(request, user, "ara", "Ara", q=q,
                items=search_items(q) if q else [], nodes=search_nodes(q) if q else [])
    if is_htmx(request):
        return render(request, "mobile/list_search.html", ctx)
    return render(request, "mobile/ara.html", ctx)


@app.get("/m/eylemler", response_class=HTMLResponse)
def m_actions(request: Request):
    user = auth.current_user(request)
    return render(request, "mobile/eylemler.html",
                  m_ctx(request, user, "eylemler", "Eylemler", groups=mobile_actions(user)))


@app.get("/m/bildirimler", response_class=HTMLResponse)
def m_notifs(request: Request):
    user = auth.current_user(request)
    return render(request, "mobile/bildirimler.html",
                  m_ctx(request, user, "bildirimler", "Bildirimler", rows=mobile_notifs(user)))


@app.get("/m/yeni", response_class=HTMLResponse)
def m_new_form(request: Request):
    user = auth.current_user(request)
    scope = user["scope_node_id"]
    nodes = [{"id": nid, "name": ("— " * TREE.depth[nid]) + TREE.name(nid)}
             for nid in sorted(TREE.nodes, key=lambda n: TREE.tin[n])
             if db.as_bool(user["is_admin"]) or (scope and TREE.is_descendant(nid, scope))]
    return render(request, "mobile/yeni.html",
                  m_ctx(request, user, None, "Yeni kayıt", nodes=nodes))


@app.post("/m/yeni")
def m_new(request: Request, node_id: str = Form(...), title: str = Form(...),
          kind: str = Form("hata"), description: str = Form("")):
    user = auth.current_user(request)
    item_id = new_item(user, node_id, kind, title, description)
    return RedirectResponse(f"/m/kayit/{item_id}", status_code=303)


@app.get("/m/kayit/{item_id}", response_class=HTMLResponse)
def m_item(request: Request, item_id: str):
    user = auth.current_user(request)
    return render(request, "mobile/kayit.html",
                  mobile_card_ctx(request, get_item(item_id), user))


@app.post("/m/kayit/{item_id}/mesaj", response_class=HTMLResponse)
def m_message(request: Request, item_id: str, body: str = Form("")):
    user = auth.current_user(request)
    item = get_item(item_id)
    if not auth.can_edit_item(user, item, TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    m = add_message(user, item, body)
    if m is None:
        return HTMLResponse("")
    return render(request, "fragments/card_message.html", {"m": m})


@app.patch("/m/kayit/{item_id}/alan", response_class=HTMLResponse)
async def m_field(request: Request, item_id: str):
    user = auth.current_user(request)
    item = get_item(item_id)
    if not auth.can_edit_item(user, item, TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    ctx = mobile_card_ctx(request, item, user)
    if change_field(user, item, await request.form()):
        ctx = mobile_card_ctx(request, get_item(item_id), user)
        ctx["oob_feed"] = True          # serit + akis birlikte tazelenir (hx-swap-oob)
    return render(request, "mobile/strip.html", ctx)


# --- iskele moduller: EN SONDA dursun, once tanimli rotalar eslessin --------


@app.get("/{slug}", response_class=HTMLResponse)
def module_page(request: Request, slug: str):
    m = MODULE_BY_SLUG.get(slug)
    if m is None or m["ready"]:
        raise HTTPException(404, "sayfa yok")
    return render(request, "module.html", {"m": m})
