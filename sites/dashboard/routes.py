"""Masaustu site — tablo, kart, sohbet, modul sayfalari.

Yerlesim sites/dashboard/templates altinda; is mantigi shared/service.py'de.
Iki site birbirine baglanti VERMEZ (tasarim karari, spec/50-yapi.md).
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from shared import auth, db, service
from shared.config import site_adresi
from shared.render import is_htmx, site_templates
from shared.service import (EDITABLE, PRIORITIES, STATUSES, add_message, change_field,
                            get_item, group_of, last_line, log, new_item, short_time,
                            users_by_id)

router = APIRouter()
_TPL = site_templates(Path(__file__).parent / "templates")


def render(request, name: str, ctx: dict) -> HTMLResponse:
    return _TPL.TemplateResponse(request, name, ctx)


# --- ana sayfa modul kaydi: tek dogruluk kaynagi (ana sayfa ve /{slug} ayni listeyi okur)

MODULES = [
    {"slug": "gorevler", "icon": "📋", "name": "Görev Yöneticisi", "ready": True,
     "desc": "Kayıt tablosu, kart içi sohbet, atama ve alan değişiklikleri. Faz 1'in çalışan dilimi.",
     "plan": []},
    {"slug": "kazanim-agaci", "icon": "🌳", "name": "Kazanım Ağacı", "ready": False,
     "desc": "Cell / makine kırılımını düzenlediğin ekran: düğüm ekle, adlandır, taşı, sil.",
     "plan": ["Ağaç düzenleme nodes üzerinde çalışır; değişiklik anında uygulanır.",
              "is_editor olmayanın değişikliği change_requests'e düşer, prev_state ile geri alınabilir (spec/20-sema.md §4).",
              "Yapı her değiştiğinde TreeIndex komple yeniden kurulur ve nodes.tin/tout tek UPDATE ile yazılır.",
              "Taşımada döngü koruması: hedef, taşınan düğümün alt ağacında olamaz."]},
    {"slug": "pivot", "icon": "📊", "name": "Pivot & Veri Analizi", "ready": False,
     "desc": "Kayıtları düğüm, DMS, pillar, sorumlu ve zaman kırılımında çapraz say.",
     "plan": ["Gruplama ve sayım SQL'de; Python'a dönen satır ekranda görünen satırdır (spec/10-kararlar.md 'Sorgular').",
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
     "plan": ["Kapanmış kayıtlar silinmez, arşive düşer (spec/20-sema.md açık nokta 3: deleted_at).",
              "Tam metin arama FTS5 üzerinden — LIKE '%…%' yok.",
              "Karar kayıtları kartın olay akışından toplanır."]},
    {"slug": "dosyalar", "icon": "🗄", "name": "Dosyalar / NAS", "ready": False,
     "desc": "Karta ve düğüme bağlı dosyalar; NAS klasörleriyle tek yerden erişim.",
     "plan": ["spec/20-sema.md açık nokta 1: attachments tablosu mu, düğüme bağlı NAS yolu mu — karar bekliyor.",
              "Faz 1'de dosya yükleme bilerek yok; yükleme kaynaklı saldırı yüzeyi de yok (README).",
              "Erişim yetkisi kartın yetkisiyle aynı yerden gelir, ikinci bir model kurulmaz."]},
    {"slug": "admin", "icon": "🛡", "name": "Yönetim Paneli", "ready": False,
     "desc": "Kullanıcılar, kapsamlar, yetkiler ve bekleyen değişiklik talepleri.",
     "plan": ["Kullanıcı kapsamı (scope_node_id), is_admin / is_editor bayrakları buradan yönetilir.",
              "Açık change_requests kuyruğu: onayla / reddet — ret prev_state'ten geri yazar.",
              "Bildirim tercihleri ve susturmalar (spec/20-sema.md §6).",
              "Yetki her uçta sunucuda kontrol edilir; panel sadece görünen yüzü."]},
]
MODULE_BY_SLUG = {m["slug"]: m for m in MODULES}


def home_stats(user) -> dict:
    """Ana sayfa rozetleri — tek sorgu, sayfa basina yedi COUNT degil."""
    r = db.q1(
        "select"
        " sum(case when status <> 'kapandi' then 1 else 0 end) acik,"
        " sum(case when status <> 'kapandi' and assignee_id is null then 1 else 0 end) atanmamis,"
        " sum(case when status <> 'kapandi' and assignee_id = %s then 1 else 0 end) bana,"
        " count(*) hepsi from items", (user["id"],))
    return {"open": r["acik"] or 0, "unassigned": r["atanmamis"] or 0,
            "mine": r["bana"] or 0, "all": r["hepsi"] or 0, "nodes": len(service.TREE.nodes)}


def open_counts() -> dict[str, int]:
    """Dugum basina acik kayit sayisi, alt agac dahil (agac rozetleri)."""
    direct: dict[str, int] = {}
    for r in db.q("select node_id, count(*) c from items where status <> 'kapandi' group by node_id"):
        direct[r["node_id"]] = r["c"]
    return {nid: sum(direct.get(k, 0) for k in service.TREE.subtree(nid)) for nid in service.TREE.nodes}


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
            "assignee": a, "path": " › ".join(service.TREE.name(n) for n in service.TREE.ancestors(r["node_id"])[-2:]),
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
        "assignee_id = %s or id in (select item_id from item_participants where user_id = %s)",
        (user["id"], user["id"]))


def tree_rows() -> list[dict]:
    counts = open_counts()
    out = []
    for root in service.TREE.roots:
        for nid in service.TREE.subtree(root):
            out.append({"id": nid, "name": service.TREE.name(nid), "depth": service.TREE.depth[nid],
                        "count": counts.get(nid, 0), "leaf": not service.TREE.children.get(nid)})
    out.sort(key=lambda n: service.TREE.tin[n["id"]])
    return out


def card_ctx(request, item, user) -> dict:
    users = users_by_id()
    feed = []
    for e in db.q("select * from events where subject_type='item' and subject_id=%s"
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
        "crumbs": [{"id": n, "name": service.TREE.name(n)} for n in service.TREE.ancestors(item["node_id"])],
        "can_edit": auth.can_edit_item(user, item, service.TREE),
        "tree": tree_rows(), "statuses": STATUSES, "priorities": PRIORITIES,
        "status_label": STATUSES[item["status"]], "priority_label": PRIORITIES[item["priority"]],
    }



# --- uclar ---------------------------------------------------------------

@router.get("/", response_class=HTMLResponse)
def home(request: Request):
    """Ana sayfa: modul secimi. Ekranlar buradan dallanir."""
    user = auth.current_user(request)
    stats = home_stats(user)
    mods = [dict(m, href=("/" + m["slug"]),
                 count=stats["all"] if m["slug"] == "gorevler" else None) for m in MODULES]
    return render(request, "home.html", {
        "user": user, "all_users": auth.all_users(), "modules": mods, "stats": stats,
        "app_adres": site_adresi(request, app_site=True),
        "scope_name": service.TREE.name(user["scope_node_id"]) if user["scope_node_id"] else "tüm ağaç",
    })


@router.get("/gorevler", response_class=HTMLResponse)
def tasks(request: Request, item: str | None = None):
    user = auth.current_user(request)
    rows = inbox_rows(user)
    current = get_item(item) if item else (
        db.q1("select * from items where id = %s", (rows[0]["id"],)) if rows else None)
    ctx = {
        "user": user, "all_users": auth.all_users(), "panel_title": "Bana ait",
        "panel": "inbox", "groups": grouped(rows), "selected": current["id"] if current else None,
        "tree": tree_rows(), "item": None,
    }
    if current is not None:
        ctx.update(card_ctx(request, current, user))
    return render(request, "base.html", ctx)


@router.get("/panel/inbox", response_class=HTMLResponse)
def panel_inbox(request: Request):
    user = auth.current_user(request)
    return render(request, "fragments/panel_inbox.html",
                  {"user": user, "groups": grouped(inbox_rows(user)), "selected": None,
                   "panel_title": "Bana ait", "oob_head": True})


@router.get("/panel/tree", response_class=HTMLResponse)
def panel_tree(request: Request):
    return render(request, "fragments/panel_tree.html",
                  {"tree": tree_rows(), "selected_node": None,
                   "panel_title": "Hiyerarşi", "oob_head": True})


@router.get("/node/{node_id}/items", response_class=HTMLResponse)
def node_items(request: Request, node_id: str):
    node_id = db.uid(node_id)
    if node_id not in service.TREE.nodes:
        raise HTTPException(404, "düğüm yok")
    user = auth.current_user(request)
    ids = service.TREE.subtree(node_id)
    # Postgres'te dizi daha temiz: tek parametre, uzunluk sinirina takilmaz.
    rows = item_rows("node_id = any(%s)", (ids,))
    return render(request, "fragments/panel_inbox.html",
                  {"user": user, "groups": grouped(rows), "selected": None,
                   "panel_title": service.TREE.name(node_id), "oob_head": True})


@router.get("/item/{item_id}", response_class=HTMLResponse)
def item_view(request: Request, item_id: str):
    user = auth.current_user(request)
    item = get_item(item_id)
    ctx = card_ctx(request, item, user)
    if not is_htmx(request):
        return RedirectResponse(f"/gorevler?item={item_id}", status_code=303)
    return render(request, "fragments/card.html", ctx)


@router.post("/item/{item_id}/message", response_class=HTMLResponse)
def post_message(request: Request, item_id: str, body: str = Form("")):
    user = auth.current_user(request)
    item = get_item(item_id)
    if not auth.can_edit_item(user, item, service.TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    m = add_message(user, item, body)
    if m is None:
        return HTMLResponse("")
    return render(request, "ortak/mesaj.html", {"m": m})


@router.patch("/item/{item_id}/field", response_class=HTMLResponse)
async def patch_field(request: Request, item_id: str):
    user = auth.current_user(request)
    item = get_item(item_id)
    if not auth.can_edit_item(user, item, service.TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    if not change_field(user, item, await request.form()):
        return render(request, "fragments/card_fields.html", card_ctx(request, item, user))

    ctx = card_ctx(request, get_item(item_id), user)
    ctx["oob_feed"] = True  # card_fields + card_feed birlikte tazelenir (hx-swap-oob)
    return render(request, "fragments/card_fields.html", ctx)


@router.post("/item", response_class=HTMLResponse)
def create_item(request: Request, node_id: str = Form(...), title: str = Form(...),
                kind: str = Form("hata"), description: str = Form("")):
    user = auth.current_user(request)
    item_id = new_item(user, node_id, kind, title, description)
    return render(request, "fragments/card.html", card_ctx(request, get_item(item_id), user))



# --- iskele moduller: EN SONDA dursun, once tanimli rotalar eslessin --------


@router.get("/{slug}", response_class=HTMLResponse)
def module_page(request: Request, slug: str):
    m = MODULE_BY_SLUG.get(slug)
    if m is None or m["ready"]:
        raise HTTPException(404, "sayfa yok")
    return render(request, "module.html", {"m": m})
