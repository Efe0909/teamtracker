"""Mobil site — yapilacaklar, arama, eylemler, bildirimler, kayit.

Ayni veritabani, ayni yetki, ayri yerlesim. Mobil yuz KENDI ALAN ADINDA,
KOKTE durur — yol oneki YOKTUR. Ayrim Host'a gore, app.py'deki mobile_only
bagimliligiyla yapilir.
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
from shared.service import (MINE_SQL, MINE_SQL_I, MONTHS, PRIO_SQL, PRIORITIES, STATUSES,
                            add_message, change_field, get_item, new_item, short_time,
                            users_by_id)

router = APIRouter()
STATIC = Path(__file__).parent / "static"
_TPL = site_templates(Path(__file__).parent / "templates")


def render(request, name: str, ctx: dict) -> HTMLResponse:
    return _TPL.TemplateResponse(request, name, ctx)


MOBILE_TABS = [
    {"slug": "todo", "path": "", "icon": "📋", "label": "Yapılacak"},
    {"slug": "search", "path": "/search", "icon": "🔎", "label": "Ara"},
    {"slug": "actions", "path": "/actions", "icon": "⚡", "label": "Eylemler"},
    {"slug": "notifications", "path": "/notifications", "icon": "🔔", "label": "Bildirim"},
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
    return f"{when.day} {MONTHS[when.month - 1]}"


def due_info(d) -> dict | None:
    """Son tarih rozeti: metin + gecikti mi + kac gun kaldi.

    Sutun tipi `date`; psycopg date nesnesi doner, ayristirma gerekmez.
    """
    if not d:
        return None
    left = (d - datetime.now(timezone.utc).date()).days
    return {"label": f"{d.day} {MONTHS[d.month - 1]} {d.year}", "days": left, "late": left < 0}


def mobile_row(r, users: dict) -> dict:
    """Mobil kart sozlugu — sablon SQL satirini degil bunu gorur."""
    a = users.get(r["assignee_id"])
    return {
        "id": r["id"], "kind": r["kind"], "title": r["title"], "status": r["status"],
        "status_label": STATUSES[r["status"]], "priority": r["priority"],
        "priority_label": PRIORITIES[r["priority"]], "dms": r["dms"],
        "assignee": a,
        "node": service.TREE.name(r["node_id"]),
        "path": " › ".join(service.TREE.name(n) for n in service.TREE.ancestors(r["node_id"])[-2:]),
        "due": due_info(r["due_date"]), "time": rel_time(r["updated_at"]),
        "msgs": db.q1("select count(*) c from events where subject_type='item'"
                      " and subject_id=%s and event_type='message'", (r["id"],))["c"],
    }


def mobile_todo(user, done: bool = False) -> list[dict]:
    """Bana ait kayitlar. Siralama SQL'de: once oncelik, sonra son tarih."""
    op = "=" if done else "<>"
    rows = db.q(f"select * from items where status {op} 'closed' and {MINE_SQL}"
                f" order by {PRIO_SQL}, (due_date is null), due_date, updated_at desc limit 60",
                (user["id"], user["id"]))
    users = users_by_id()
    return [mobile_row(r, users) for r in rows]


def mobile_actions(user) -> list[tuple[str, list[dict]]]:
    """Son tarihi olan acik kayitlar — gecikmis olan basta."""
    rows = db.q(f"select * from items where status <> 'closed' and due_date is not null"
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



def mobile_ctx(request, user, tab: str | None, title: str, **extra) -> dict:
    prefix = mp(request)
    ctx = {"request": request, "user": user, "tab": tab, "title": title,
           "badge": notif_badge(user), "mp": prefix, "mroot": prefix or "/",
           "tabs": [dict(t, href=(prefix + t["path"]) or "/") for t in MOBILE_TABS]}
    ctx.update(extra)
    return ctx


def mobile_card_ctx(request, item, user) -> dict:
    users = users_by_id()
    # feed_of ile ayni sorgu-ve-gruplama: burada tekrar yazmak ekleri IKI yerde
    # ayrica baglamak demekti (sozlesme §8). service.feed_of TEK dogruluk kaynagi.
    feed = service.feed_of("item", item["id"], user)
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
    """Statik degil ama start_url her zaman KOK.

    Mobil yuz app.<alan> altinda kokte durur. Eskiden burada mp(request)
    Eskiden mp(request) okunuyordu ve bir yol oneki donebiliyordu; o zaman
    ana ekrana eklenen uygulama yanlis adrese aciliyordu.

    "/" her durumda dogru: manifest hangi alan adindan istendiyse o alan
    adinin kokune isaret eder.
    """
    root = "/"
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
    """Kok kapsamdan servis edilir.

    /static altindan verilseydi service worker'in kapsami oraya daralir ve
    sayfalari kontrol edemezdi (Service-Worker-Allowed basligi bunun icin).
    """
    return FileResponse(STATIC / "sw.js", media_type="text/javascript",
                        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"})



# Kok rota BURADA KAYITLI DEGIL: '/' iki yuzde de var, ayrim Host'a gore
# app.py'deki dagiticida yapiliyor (root()). Islev disaridan cagriliyor.
def todo_page(request: Request, tab: str = "open"):
    user = auth.current_user(request)
    done = tab == "closed"
    return render(request, "todo.html",
                  mobile_ctx(request, user, "todo", "Yapılacaklar",
                        rows=mobile_todo(user, done), done=done))


@router.get("/search", response_class=HTMLResponse)
def search_page(request: Request, q: str = ""):
    user = auth.current_user(request)
    q = q.strip()
    ctx = mobile_ctx(request, user, "search", "Ara", q=q,
                items=[mobile_row(r, users_by_id()) for r in search.search_items(q)] if q else [],
                nodes=search.search_nodes(q) if q else [])
    if is_htmx(request):
        return render(request, "list_search.html", ctx)
    return render(request, "ara.html", ctx)


@router.get("/actions", response_class=HTMLResponse)
def actions_page(request: Request):
    user = auth.current_user(request)
    return render(request, "eylemler.html",
                  mobile_ctx(request, user, "actions", "Eylemler", groups=mobile_actions(user)))


@router.get("/notifications", response_class=HTMLResponse)
def notifications_page(request: Request):
    user = auth.current_user(request)
    return render(request, "bildirimler.html",
                  mobile_ctx(request, user, "notifications", "Bildirimler", rows=mobile_notifs(user)))


@router.get("/new", response_class=HTMLResponse)
def new_item_form(request: Request):
    user = auth.current_user(request)
    scope_id = user["scope_node_id"]
    nodes = [{"id": nid, "name": ("— " * service.TREE.depth[nid]) + service.TREE.name(nid)}
             for nid in sorted(service.TREE.nodes, key=lambda n: service.TREE.tin[n])
             if db.as_bool(user["is_admin"]) or (scope_id and service.TREE.is_descendant(nid, scope_id))]
    return render(request, "yeni.html",
                  mobile_ctx(request, user, None, "Yeni kayıt", nodes=nodes))


@router.post("/new")
def create_item(request: Request, node_id: str = Form(...), title: str = Form(...),
                kind: str = Form("issue"), description: str = Form("")):
    user = auth.current_user(request)
    item_id = new_item(user, node_id, kind, title, description)
    return RedirectResponse(f"{mp(request)}/record/{item_id}", status_code=303)


@router.get("/record/{item_id}", response_class=HTMLResponse)
def record_page(request: Request, item_id: str):
    user = auth.current_user(request)
    return render(request, "kayit.html",
                  mobile_card_ctx(request, get_item(item_id), user))


@router.post("/record/{item_id}/message", response_class=HTMLResponse)
async def post_message(request: Request, item_id: str):
    service.reject_oversized_upload(request)
    form = await request.form()
    body = str(form.get("body") or "")
    image = form.get("image")
    image = image if getattr(image, "filename", None) else None
    user = auth.current_user(request)
    item = get_item(item_id)
    if not auth.can_edit_item(user, item, service.TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    attachment = service.save_upload(image)
    m = add_message(user, item, body, attachment)
    if m is None:
        return HTMLResponse("")
    return render(request, "ortak/mesaj.html", {"m": m})


@router.patch("/record/{item_id}/field", response_class=HTMLResponse)
async def patch_field(request: Request, item_id: str):
    user = auth.current_user(request)
    item = get_item(item_id)
    if not auth.can_edit_item(user, item, service.TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    ctx = mobile_card_ctx(request, item, user)
    if change_field(user, item, await request.form()):
        ctx = mobile_card_ctx(request, get_item(item_id), user)
        ctx["oob_feed"] = True          # serit + akis birlikte tazelenir (hx-swap-oob)
    return render(request, "strip.html", ctx)
