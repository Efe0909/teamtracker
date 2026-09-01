"""Mobil site — yapilacaklar, arama, eylemler, bildirimler, kayit.

Ayni veritabani, ayni yetki, ayri yerlesim. app.<alan> altinda kokte durur
(shared/config.mp); tek alan adi modunda /m onekiyle.
Iki site birbirine baglanti VERMEZ (tasarim karari, spec/50-yapi.md).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse

from shared import auth, db, search, service
from shared.config import mp
from shared.render import is_htmx, site_templates
from shared.service import (AYLAR, MINE_SQL, MINE_SQL_I, PRIO_SQL, PRIORITIES, STATUSES,
                            add_message, change_field, get_item, new_item, short_time,
                            users_by_id)

router = APIRouter()
STATIK = Path(__file__).parent / "static"
_TPL = site_templates(Path(__file__).parent / "templates")


def render(request, name: str, ctx: dict) -> HTMLResponse:
    return _TPL.TemplateResponse(request, name, ctx)


MOBILE_TABS = [
    {"slug": "yapilacaklar", "path": "", "icon": "📋", "label": "Yapılacak"},
    {"slug": "ara", "path": "/ara", "icon": "🔎", "label": "Ara"},
    {"slug": "eylemler", "path": "/eylemler", "icon": "⚡", "label": "Eylemler"},
    {"slug": "bildirimler", "path": "/bildirimler", "icon": "🔔", "label": "Bildirim"},
]


def rel_time(when: datetime) -> str:
    """'19 saat önce' — bildirim akisinda mutlak saat degil, mesafe okunur."""
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


def due_info(d) -> dict | None:
    """Son tarih rozeti: metin + gecikti mi + kac gun kaldi.

    Sutun tipi `date`; psycopg date nesnesi doner, ayristirma gerekmez.
    """
    if not d:
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
        "node": service.TREE.name(r["node_id"]),
        "path": " › ".join(service.TREE.name(n) for n in service.TREE.ancestors(r["node_id"])[-2:]),
        "due": due_info(r["due_date"]), "time": rel_time(r["updated_at"]),
        "msgs": db.q1("select count(*) c from events where subject_type='item'"
                      " and subject_id=%s and event_type='mesaj'", (r["id"],))["c"],
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

    Gercek bildirim tablosu (okundu bilgisi, yonlendirme, susturma) spec/20-sema.md §6'da;
    o gelene kadar 'bana ait kartlarda baskasinin yaptigi hareket' listesi yeterli.
    """
    rows = db.q(
        "select e.*, i.id item_id, i.title from events e join items i on i.id = e.subject_id"
        f" where e.subject_type='item' and {MINE_SQL_I}"
        " and (e.author_id is null or e.author_id <> %s)"
        " order by e.created_at desc limit %s",
        (user["id"], user["id"], user["id"], limit))
    users = users_by_id()
    return [{"item_id": r["item_id"], "title": r["title"], "type": r["event_type"],
             "body": r["body"], "author": users.get(r["author_id"]),
             "time": rel_time(r["created_at"])} for r in rows]


def notif_badge(user) -> int:
    """Son 24 saatteki hareket sayisi. Okundu bilgisi Faz 3'te gelir (spec/20-sema.md §6)."""
    since = datetime.now(timezone.utc) - timedelta(days=1)
    return db.q1(
        "select count(*) c from events e join items i on i.id = e.subject_id"
        f" where e.subject_type='item' and {MINE_SQL_I}"
        " and (e.author_id is null or e.author_id <> %s) and e.created_at > %s",
        (user["id"], user["id"], user["id"], since))["c"]



def m_ctx(request, user, tab: str | None, title: str, **extra) -> dict:
    prefix = mp(request)
    ctx = {"request": request, "user": user, "tab": tab, "title": title,
           "badge": notif_badge(user), "mp": prefix, "mroot": prefix or "/",
           "tabs": [dict(t, href=(prefix + t["path"]) or "/") for t in MOBILE_TABS]}
    ctx.update(extra)
    return ctx


def mobile_card_ctx(request, item, user) -> dict:
    users = users_by_id()
    feed = []
    for e in db.q("select * from events where subject_type='item' and subject_id=%s"
                  " order by created_at", (item["id"],)):
        a = users.get(e["author_id"])
        feed.append({"type": e["event_type"], "body": e["body"], "author": a,
                     "mine": a is not None and a["id"] == user["id"],
                     "time": short_time(e["created_at"])})
    return {
        "request": request, "user": user, "item": item, "row": mobile_row(item, users),
        "assignee": users.get(item["assignee_id"]), "users": list(users.values()),
        "feed": feed, "can_edit": auth.can_edit_item(user, item, service.TREE),
        "statuses": STATUSES, "priorities": PRIORITIES,
        "status_label": STATUSES[item["status"]], "priority_label": PRIORITIES[item["priority"]],
        "tab": None, "title": "Kayıt", "badge": notif_badge(user),
        "mp": mp(request), "mroot": mp(request) or "/",
    }



# --- uclar ---------------------------------------------------------------

@router.get("/manifest.json", include_in_schema=False)
def manifest(request: Request):
    """Statik degil: start_url/scope alan adina gore degisir.

    app.<alan> altinda mobil site kokte durur -> start_url "/". Tek alan adi
    modunda "/m". Yanlis start_url ana ekrandaki uygulamayi bos sayfaya acar.
    """
    root = mp(request) or "/"          # app alan adinda "/", tek alan adinda "/m"
    return JSONResponse({
        "name": "EkipTakip", "short_name": "EkipTakip",
        "description": "Ekibin kayıtları, eylemleri ve bildirimleri — cepte.",
        "start_url": root, "scope": "/",
        "display": "standalone", "orientation": "portrait",
        "background_color": "#f4f1fb", "theme_color": "#7c5bff", "lang": "tr",
        "icons": [
            {"src": "/static/icon-192.png", "sizes": "192x192", "type": "image/png",
             "purpose": "any"},
            {"src": "/static/icon-512.png", "sizes": "512x512", "type": "image/png",
             "purpose": "any"},
            {"src": "/static/icon-512.png", "sizes": "512x512", "type": "image/png",
             "purpose": "maskable"},
        ],
    }, media_type="application/manifest+json")



@router.get("/sw.js", include_in_schema=False)
def service_worker():
    """Kok kapsamdan servis edilir; /static altindan verilirse /m'yi kontrol edemez."""
    return FileResponse(STATIK / "sw.js", media_type="text/javascript",
                        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"})



@router.get("/m", response_class=HTMLResponse)
def m_todo(request: Request, sekme: str = "acik"):
    user = auth.current_user(request)
    done = sekme == "kapali"
    return render(request, "todo.html",
                  m_ctx(request, user, "yapilacaklar", "Yapılacaklar",
                        rows=mobile_todo(user, done), done=done))


@router.get("/m/ara", response_class=HTMLResponse)
def m_search(request: Request, q: str = ""):
    user = auth.current_user(request)
    q = q.strip()
    ctx = m_ctx(request, user, "ara", "Ara", q=q,
                items=[mobile_row(r, users_by_id()) for r in search.search_items(q)] if q else [],
                nodes=search.search_nodes(q) if q else [])
    if is_htmx(request):
        return render(request, "list_search.html", ctx)
    return render(request, "ara.html", ctx)


@router.get("/m/eylemler", response_class=HTMLResponse)
def m_actions(request: Request):
    user = auth.current_user(request)
    return render(request, "eylemler.html",
                  m_ctx(request, user, "eylemler", "Eylemler", groups=mobile_actions(user)))


@router.get("/m/bildirimler", response_class=HTMLResponse)
def m_notifs(request: Request):
    user = auth.current_user(request)
    return render(request, "bildirimler.html",
                  m_ctx(request, user, "bildirimler", "Bildirimler", rows=mobile_notifs(user)))


@router.get("/m/yeni", response_class=HTMLResponse)
def m_new_form(request: Request):
    user = auth.current_user(request)
    scope = user["scope_node_id"]
    nodes = [{"id": nid, "name": ("— " * service.TREE.depth[nid]) + service.TREE.name(nid)}
             for nid in sorted(service.TREE.nodes, key=lambda n: service.TREE.tin[n])
             if db.as_bool(user["is_admin"]) or (scope and service.TREE.is_descendant(nid, scope))]
    return render(request, "yeni.html",
                  m_ctx(request, user, None, "Yeni kayıt", nodes=nodes))


@router.post("/m/yeni")
def m_new(request: Request, node_id: str = Form(...), title: str = Form(...),
          kind: str = Form("hata"), description: str = Form("")):
    user = auth.current_user(request)
    item_id = new_item(user, node_id, kind, title, description)
    return RedirectResponse(f"{mp(request)}/kayit/{item_id}", status_code=303)


@router.get("/m/kayit/{item_id}", response_class=HTMLResponse)
def m_item(request: Request, item_id: str):
    user = auth.current_user(request)
    return render(request, "kayit.html",
                  mobile_card_ctx(request, get_item(item_id), user))


@router.post("/m/kayit/{item_id}/mesaj", response_class=HTMLResponse)
def m_message(request: Request, item_id: str, body: str = Form("")):
    user = auth.current_user(request)
    item = get_item(item_id)
    if not auth.can_edit_item(user, item, service.TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    m = add_message(user, item, body)
    if m is None:
        return HTMLResponse("")
    return render(request, "ortak/mesaj.html", {"m": m})


@router.patch("/m/kayit/{item_id}/alan", response_class=HTMLResponse)
async def m_field(request: Request, item_id: str):
    user = auth.current_user(request)
    item = get_item(item_id)
    if not auth.can_edit_item(user, item, service.TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    ctx = mobile_card_ctx(request, item, user)
    if change_field(user, item, await request.form()):
        ctx = mobile_card_ctx(request, get_item(item_id), user)
        ctx["oob_feed"] = True          # serit + akis birlikte tazelenir (hx-swap-oob)
    return render(request, "strip.html", ctx)

