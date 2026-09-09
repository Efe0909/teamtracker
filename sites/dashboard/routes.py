"""Masaustu site — gorev tablosu, kayit sayfasi, modul sayfalari.

Yerlesim sites/dashboard/templates altinda; is mantigi shared/service.py'de,
filtre altyapisi shared/filters.py'de (taban sinif + turevler — yeni boyut
eklemek rota ve sablonu degistirmez). Iki site birbirine baglanti VERMEZ
(tasarim karari, spec/50-yapi.md). Ekran kaliplari: spec/60-kaynak-uyarlama.md 2.1-2.4.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from shared import auth, db, filters, scope, service, users
from shared.config import site_address
from shared.render import is_htmx, site_templates
from shared.service import (ACTION_STATUS, PRIORITIES, STATUSES, add_action, add_message,
                            change_action, change_field, get_action, get_item, new_item,
                            short_time, users_by_id)

router = APIRouter()
_TPL = site_templates(Path(__file__).parent / "templates")


def render(request, name: str, ctx: dict) -> HTMLResponse:
    return _TPL.TemplateResponse(request, name, ctx)


# --- ana sayfa modul kaydi: tek dogruluk kaynagi (ana sayfa ve /{slug} ayni listeyi okur)

MODULES = [
    {"slug": "tasks", "icon": "📋", "name": "Görev Yöneticisi", "ready": True,
     "desc": "Tüm kayıtlar tek tabloda: özet çipleri, hızlı filtreler, boyut filtreleri. "
             "Satır kayıt sayfasına gider; eylemler orada.",
     "plan": []},
    {"slug": "teams", "icon": "👥", "name": "Ekipler", "ready": True,
     "desc": "Takımlar, roller (lider/mentor/üye), takım duvarı ve \"bu takıma kayıt aç\". "
             "Takım/üyelik yönetimi Yönetim Paneli'ne ait.",
     "plan": []},
    {"slug": "outcome-tree", "icon": "🌳", "name": "Veri Yönetimi", "ready": True,
     "desc": "Yapının düzenlendiği ekran: düğüm ekle, adlandır, açıklama yaz, taşı, sil.",
     "plan": []},
    {"slug": "pivot", "icon": "📊", "name": "Pivot & Veri Analizi", "ready": False,
     "desc": "Kayıtları düğüm, takım, pillar, sorumlu ve zaman kırılımında çapraz say.",
     "plan": ["Gruplama ve sayım SQL'de; Python'a dönen satır ekranda görünen satırdır (spec/10-kararlar.md 'Sorgular').",
              "Alt ağaç kırılımı tin/tout aralık taramasıyla — recursive CTE yok.",
              "İkinci yüz: açık kayıtların hazır kırılımları (spec/60-kaynak-uyarlama.md 2.3).",
              "Bir hücreden tıklayınca aynı filtrelerle görev tablosuna geçiş."]},
    {"slug": "wds", "icon": "🧭", "name": "WDS Panosu", "ready": False,
     "desc": "Haftalık yön belirleme: açılan/kapanan, geciken, aktiflik — her şey rayında mı?",
     "plan": ["Bu hafta açılan/kapanan, geciken eylemler, kişi başına açık iş (spec/60-kaynak-uyarlama.md 2.9).",
              "Aktiflik oranı: bu hafta en az bir hareket yapan / toplam üye (spec/61 §4).",
              "\"Bu hafta öne çıkanlar\" — kapanan işler isimlerle.",
              "Rutin tamamlama matrisi rutin şeması netleşince (spec/20-sema.md açık nokta 5)."]},
    {"slug": "calendar", "icon": "📅", "name": "Takvim", "ready": False,
     "desc": "Son tarihler, gecikmeler ve ekip yükü ay / hafta görünümünde.",
     "plan": ["items.due_date ve actions.due_date üzerinden ay ve hafta görünümü.",
              "Gecikmiş kayıtlar (due_date < bugün ve status <> 'closed') ayrı vurgulanır.",
              "Bir güne tıklayınca o günün kayıtları görev tablosunda süzülür."]},
    {"slug": "definitions", "icon": "📐", "name": "Görev Tanımları & Şemalar", "ready": False,
     "desc": "Rol tanımları, yönetim şemaları ve adım adım iş tanımları — kimin neyi yaptığı.",
     "plan": ["Şemalar hiyerarşinin kendisinden türer: düğüm → sorumlu → yedek.",
              "Adım adım iş tanımları düz metin olarak düğüme bağlı sürümlenir (form-builder yok — spec/60 §4).",
              "Salt okunur görünüm herkese açık, düzenleme is_editor kapsamına bağlı."]},
    {"slug": "archive", "icon": "🗂", "name": "Ekip Arşivi", "ready": False,
     "desc": "Kapanmış kayıtlar, alınan kararlar ve geçmiş dönemlerin kurumsal hafızası.",
     "plan": ["Kapanmış kayıtlar silinmez, arşive düşer (spec/20-sema.md açık nokta 3: deleted_at).",
              "Tam metin arama tsvector üzerinden — LIKE '%…%' yok.",
              "Karar kayıtları kartın olay akışından toplanır."]},
    {"slug": "files", "icon": "🗄", "name": "Dosyalar / NAS", "ready": False,
     "desc": "Karta ve düğüme bağlı dosyalar; kılavuz/eğitim kütüphanesi de buraya oturur.",
     "plan": ["spec/20-sema.md açık nokta 1 🚧: docker + NAS yönü; saklama süresi kararı bekliyor.",
              "Faz 1'de dosya yükleme bilerek yok; yükleme kaynaklı saldırı yüzeyi de yok (README).",
              "Erişim yetkisi kartın yetkisiyle aynı yerden gelir, ikinci bir model kurulmaz."]},
    {"slug": "admin", "icon": "🛡", "name": "Yönetim Paneli", "ready": True,
     "desc": "Kullanıcılar, kapsamlar ve roller — dar kapsam (TODO.md madde 3). "
             "Takım üyeliği ekipler'de, yapı ve düğüm izni outcome-tree'de.",
     "plan": []},
]
MODULE_BY_SLUG = {m["slug"]: m for m in MODULES}


def home_stats(user) -> dict:
    """Ana sayfa rozetleri — tek sorgu, sayfa basina yedi COUNT degil."""
    r = db.q1(
        "select"
        " sum(case when status <> 'closed' then 1 else 0 end) open,"
        " sum(case when status <> 'closed' and assignee_id is null then 1 else 0 end) unassigned,"
        " sum(case when status <> 'closed' and assignee_id = %s then 1 else 0 end) mine,"
        " count(*) all_ from items", (user["id"],))
    # items disindaki iki sayi tek sorguda: ayri ayri atmanin bir faydasi yok.
    e = db.q1("select (select count(*) from actions where assignee_id = %s"
              "         and status in ('open','in_progress')) actions,"
              " (select count(*) from teams) teams", (user["id"],))
    return {"open": r["open"] or 0, "unassigned": r["unassigned"] or 0,
            "mine": r["mine"] or 0, "all": r["all_"] or 0,
            "my_actions": e["actions"] or 0, "nodes": len(service.TREE.nodes),
            "teams": e["teams"] or 0}


# --- gorev tablosu (spec/60-kaynak-uyarlama.md 2.2) -------------------------


def record_row(r, users: dict, today) -> dict:
    """Bir kayit satirinin ekran bicimi.

    Gorev tablosu ve takim sayfasi ayni satiri cizer (fragments/tablo satirlari);
    bicim tek yerde dursun ki "geciken" tanimi iki ekranda ayrismasin.
    """
    return {
        "id": r["id"], "kind": r["kind"], "title": r["title"],
        "status": r["status"], "priority": r["priority"],
        "team": {"name": r["team_name"], "color": r["team_color"]} if r["team_name"] else None,
        "assignee": users.get(r["assignee_id"]),
        "path": " › ".join(service.TREE.name(n)
                           for n in service.TREE.ancestors(r["node_id"])[-2:]),
        "due": r["due_date"], "overdue": bool(r["due_date"]) and r["due_date"] < today
                and r["status"] != "closed",
        "open_action_count": r["open_action_count"], "time": short_time(r["updated_at"]),
    }


def table_ctx(request, user) -> dict:
    """Tablo + ozet cipleri. Suzme/siralama SQL'de; ozet ayni WHERE ile tek sorgu."""
    where, args, order, selected = filters.build_query(request.query_params, user)
    rows = db.q(
        "select i.*, t.name team_name, t.color team_color,"
        " (select count(*) from actions a where a.item_id = i.id"
        "  and a.status in ('open','in_progress')) open_action_count"
        f" from items i left join teams t on t.id = i.team_id where {where}"
        f" order by {order}", tuple(args))
    summary = db.q1(
        "select"
        " sum(case when i.status <> 'closed' then 1 else 0 end) open,"
        " sum(case when i.status = 'closed' then 1 else 0 end) closed,"
        " count(*) all_,"
        " sum(case when i.status <> 'closed' and i.priority = 'critical' then 1 else 0 end) critical,"
        " sum(case when i.status <> 'closed' and i.priority = 'high' then 1 else 0 end) high,"
        " sum(case when i.status <> 'closed' and i.priority = 'medium' then 1 else 0 end) medium,"
        " sum(case when i.status <> 'closed' and i.priority = 'low' then 1 else 0 end) low"
        f" from items i where {where}", tuple(args))
    users = users_by_id()
    today = datetime.now(timezone.utc).date()      # due_date artik date, metin degil
    out = [record_row(r, users, today) for r in rows]
    return {"rows": out, "summary": summary, "selected": selected,
            "filters": filters.active_filters(), "quick": filters.QUICK_FILTERS,
            "orderings": {"activity": "Son hareket", "date": "Son tarih",
                         "priority": "Öncelik", "newest": "En yeni"},
            "statuses": STATUSES, "priorities": PRIORITIES}


def node_options() -> list[dict]:
    """Yeni kayit formu icin dugum listesi (girintili)."""
    tree = service.TREE
    ordered = sorted(tree.nodes, key=lambda n: tree.tin[n])
    return [{"id": n, "name": tree.name(n), "depth": tree.depth[n]} for n in ordered]


def card_ctx(request, item, user) -> dict:
    users = users_by_id()
    teams = service.teams_by_id()
    feed = service.feed_of("item", item["id"], user)
    today = datetime.now(timezone.utc).date()      # due_date artik date, metin degil
    actions = []
    for a in service.actions_of(item["id"]):
        actions.append({
            "id": a["id"], "title": a["title"], "status": a["status"],
            "assignee": users.get(a["assignee_id"]), "due": a["due_date"],
            "overdue": bool(a["due_date"]) and a["due_date"] < today
                        and a["status"] in ("open", "in_progress"),
            "done": a["status"] in ("closed", "cancelled"),
        })
    return {
        "request": request, "user": user, "item": item,
        "assignee": users.get(item["assignee_id"]),
        "creator": users.get(item["created_by"]),
        "team": teams.get(item["team_id"]),
        "teams": list(teams.values()),
        "participants": [users[p] for p in auth.participant_ids(item["id"]) if p in users],
        "users": list(users.values()), "feed": feed, "actions": actions,
        "open_action_count": sum(1 for e in actions if not e["done"]),
        "crumbs": [{"id": n, "name": service.TREE.name(n)}
                   for n in service.TREE.ancestors(item["node_id"])],
        "can_edit": auth.can_edit_item(user, item, service.TREE),
        "statuses": STATUSES, "priorities": PRIORITIES, "action_status": ACTION_STATUS,
        "status_label": STATUSES[item["status"]], "priority_label": PRIORITIES[item["priority"]],
        "created": short_time(item["created_at"]),
    }


# --- uclar ---------------------------------------------------------------

# Kok rota BURADA KAYITLI DEGIL — bkz. app.py root(): '/' iki yuzde de var.
def home(request: Request):
    """Ana sayfa: modul secimi (panolar grid'i — spec/60-kaynak-uyarlama.md 2.1)."""
    user = auth.current_user(request)
    stats = home_stats(user)
    # Kart altindaki sayi: hazir modul kendi biriminde ne kadar veri tuttugunu
    # soyler. Yeni modul geldiginde buraya bir satir eklenir, sablon degismez.
    counts = {"tasks": (stats["all"], "kayıt"), "teams": (stats["teams"], "takım")}
    mods = [dict(m, href=("/" + m["slug"]),
                 count=counts.get(m["slug"], (None, ""))[0],
                 unit=counts.get(m["slug"], (None, ""))[1]) for m in MODULES]
    return render(request, "home.html", {
        "user": user, "all_users": auth.all_users(), "modules": mods, "stats": stats,
        "app_address": site_address(request, app_site=True),
        "scope_name": service.TREE.name(user["scope_node_id"]) if user["scope_node_id"] else "tüm ağaç",
    })


@router.get("/tasks", response_class=HTMLResponse)
def tasks(request: Request, item: str | None = None):
    if item:  # eski baglantilar: /tasks?item=... -> kayit sayfasi
        return RedirectResponse(f"/tasks/{item}", status_code=303)
    user = auth.current_user(request)
    ctx = {"user": user, "all_users": auth.all_users(), **table_ctx(request, user)}
    if is_htmx(request):
        return render(request, "fragments/tablo.html", ctx)
    ctx["nodes"] = node_options()
    ctx["app_address"] = site_address(request, app_site=True)
    return render(request, "gorevler.html", ctx)


@router.get("/tasks/{item_id}", response_class=HTMLResponse)
def task_page(request: Request, item_id: str):
    """Kayit sayfasi — URL paylasilabilir (modal degil, spec/60 2.4)."""
    user = auth.current_user(request)
    item = get_item(item_id)
    ctx = card_ctx(request, item, user)
    ctx["all_users"] = auth.all_users()
    ctx["app_address"] = site_address(request, app_site=True)
    return render(request, "kayit.html", ctx)


@router.get("/item/{item_id}")
def item_view(item_id: str):
    """Eski uc: kayit sayfasina yonlendirir."""
    get_item(item_id)
    return RedirectResponse(f"/tasks/{item_id}", status_code=303)


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


@router.post("/item/{item_id}/action", response_class=HTMLResponse)
def post_action(request: Request, item_id: str, title: str = Form(...),
                assignee_id: str = Form(""), due_date: str = Form("")):
    user = auth.current_user(request)
    item = get_item(item_id)
    if not auth.can_edit_item(user, item, service.TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    add_action(user, item, title, assignee_id or None, due_date or None)
    ctx = card_ctx(request, get_item(item_id), user)
    ctx["oob_feed"] = True
    return render(request, "fragments/card_actions.html", ctx)


@router.patch("/action/{action_id}", response_class=HTMLResponse)
async def patch_action(request: Request, action_id: str):
    user = auth.current_user(request)
    action = get_action(action_id)
    item = get_item(action["item_id"])
    if not auth.can_edit_item(user, item, service.TREE):
        raise HTTPException(403, "bu kartta yetkin yok")
    changed = change_action(user, item, action, await request.form())
    ctx = card_ctx(request, get_item(item["id"]), user)
    ctx["oob_feed"] = changed
    return render(request, "fragments/card_actions.html", ctx)


# --- ekipler (spec/60-kaynak-uyarlama.md 2.5, sema spec/20-sema.md §2a) -----


def team_ctx(request, team, user) -> dict:
    """Takim sayfasi: sol sutun uyeler + isler, sag sutun duvar (kayit sayfasiyla
    ayni iskelet — .kbody/.ksol/.ksag, spec/60 2.4 duzeni)."""
    users = users_by_id()
    today = datetime.now(timezone.utc).date()
    records = [record_row(r, users, today) for r in service.team_items(team["id"])]
    members = service.team_members(team["id"])
    return {
        "request": request, "user": user, "team": team, "members": members,
        "rows": records, "open": service.team_open_count(team["id"]),
        "open_action_count": sum(u["open_action_count"] for u in members),
        "feed": service.feed_of("team", team["id"], user),
        "can_post": auth.can_post_team(user, team["id"]),
        "roles": service.TEAM_ROLE,
        "statuses": STATUSES, "priorities": PRIORITIES,
        "node": service.TREE.name(team["node_id"]) if team["node_id"] else None,
    }


@router.get("/teams", response_class=HTMLResponse)
def teams(request: Request):
    """Takim listesi: tanim, uyeler, acik is sayilari (spec/60 2.5)."""
    user = auth.current_user(request)
    my_teams = auth.team_ids(user["id"])
    members = service.members_by_team()
    all_teams = [dict(t, members=members.get(t["id"], []), is_member=t["id"] in my_teams)
                for t in service.team_rows()]
    return render(request, "ekipler.html", {
        "user": user, "all_users": auth.all_users(), "teams": all_teams,
        "roles": service.TEAM_ROLE, "app_address": site_address(request, app_site=True),
    })


@router.get("/teams/{team_id}", response_class=HTMLResponse)
def team_page(request: Request, team_id: str):
    user = auth.current_user(request)
    team = service.get_team(team_id)
    ctx = team_ctx(request, team, user)
    ctx["all_users"] = auth.all_users()
    ctx["nodes"] = node_options()
    ctx["app_address"] = site_address(request, app_site=True)
    return render(request, "takim.html", ctx)


@router.post("/team/{team_id}/message", response_class=HTMLResponse)
def post_team_message(request: Request, team_id: str, body: str = Form("")):
    user = auth.current_user(request)
    team = service.get_team(team_id)
    if not auth.can_post_team(user, team["id"]):
        raise HTTPException(403, "bu takımın üyesi değilsin")
    m = service.add_team_message(user, team, body)
    if m is None:
        return HTMLResponse("")
    return render(request, "ortak/mesaj.html", {"m": m})


@router.post("/item")
def create_item(request: Request, node_id: str = Form(...), title: str = Form(...),
                kind: str = Form("issue"), description: str = Form(""),
                team_id: str = Form("")):
    user = auth.current_user(request)
    item_id = new_item(user, node_id, kind, title, description, team_id or None)
    return RedirectResponse(f"/tasks/{item_id}", status_code=303)


# --- iskele moduller: EN SONDA dursun, once tanimli rotalar eslessin --------


# --- veri yonetimi: yapinin duzenlendigi ekran ------------------------------
#
# Agac SUREC BELLEGINDE (shared/tree.py). Her degisiklikten sonra
# service.* islevleri rebuild_tree() cagiriyor — rota katmani bunu
# tekrarlamaz, yoksa iki kaynak olur.
#
# YETKI iki parcali (goc 007, shared/scope.py):
#   - "edit_nodes" KAPSAMI    -> ne yapabilir
#   - user_node_scopes izni    -> hangi dalda; alt agaca miras kalir
# Admin ikisini de atlar. Kok islemleri yalnizca admin: dugum izni bir DALI
# kapsar, kok hicbir dala girmez.
#
# is_editor bayragi GECIS DONEMI icin kabul ediliyor — eski kullanicilar
# kapsam satiri kazanana kadar kilitlenmesin. TODO.md'de bayraklarin kapsama
# cevrilmesi duruyor.


def _can_edit_structure(u) -> bool:
    """Ekranda form gosterilsin mi — kaba kontrol."""
    return bool(u) and (db.as_bool(u["is_admin"]) or db.as_bool(u["is_editor"])
                        or scope.has_scope(u, "edit_nodes"))


def _authorized_on_node(u, node_id) -> bool:
    """Belirli bir dugumde islem yetkisi — asil kontrol."""
    if u and db.as_bool(u["is_editor"]) and not scope.permitted_nodes(u):
        return True                       # gecis: kapsam satiri olmayan eski editor
    return scope.authorized_on_node(u, node_id)


def _tree_ctx(user) -> dict:
    """Duz liste: sablon girintiyi depth ile ciziyor, ic ice dongu yok."""
    tree = service.TREE
    counts = service.node_record_counts()
    descriptions = {r["id"]: r["description"]
                   for r in db.q("select id, description from nodes")}
    ordered = sorted(tree.nodes, key=lambda n: tree.tin[n])
    return {
        "nodes": [{"id": nid, "name": tree.nodes[nid].name,
                   "type": tree.nodes[nid].node_type,
                   "depth": tree.depth[nid],
                   "has_children": bool(tree.children.get(nid)),
                   "record_count": counts.get(nid, 0),
                   "description": descriptions.get(nid)}
                  for nid in ordered],
        "can_write": _can_edit_structure(user),
    }


@router.get("/outcome-tree", response_class=HTMLResponse)
def data_management(request: Request):
    user = auth.current_user(request)
    ctx = {"user": user, "m": MODULE_BY_SLUG["outcome-tree"], **_tree_ctx(user)}
    if is_htmx(request):
        return render(request, "fragments/agac.html", ctx)
    return render(request, "veri_yonetimi.html", ctx)


@router.post("/node", response_class=HTMLResponse)
def add_node(request: Request, name: str = Form(...), type: str = Form(...),
            parent: str = Form(""), description: str = Form("")):
    user = auth.current_user(request)
    if parent:
        if not _authorized_on_node(user, parent):
            raise HTTPException(403, "bu dalda düzenleme yetkisi yok")
    elif not (scope.can_do_root_operation(user) or _can_edit_structure(user)):
        raise HTTPException(403, "kök düğüm eklemek yönetici yetkisi ister")
    service.add_node(name, type, parent or None, description, created_by=user["id"])
    return render(request, "fragments/agac.html", {"user": user, **_tree_ctx(user)})


@router.patch("/node/{node_id}", response_class=HTMLResponse)
async def update_node(request: Request, node_id: str):
    user = auth.current_user(request)
    if not _authorized_on_node(user, node_id):
        raise HTTPException(403, "bu düğümde düzenleme yetkisi yok")
    form = await request.form()
    # Alan gonderilmediyse None: "dokunma" ile "bosalt" farkli seyler.
    service.update_node(
        node_id,
        name=form.get("name"), node_type=form.get("type"), description=form.get("description"),
        changed_by=user["id"])
    if "parent" in form:
        # Hedef dalda da yetki gerekir, yoksa yetkili oldugu dugumu
        # yetkisiz oldugu bir dala tasiyabilirdi.
        target = form.get("parent") or None
        if target is None:
            if scope.can_do_root_operation(user):
                service.move_node(node_id, None, moved_by=user["id"])
        elif _authorized_on_node(user, target):
            service.move_node(node_id, target, moved_by=user["id"])
    return render(request, "fragments/agac.html", {"user": user, **_tree_ctx(user)})


@router.delete("/node/{node_id}", response_class=HTMLResponse)
def delete_node(request: Request, node_id: str):
    user = auth.current_user(request)
    if not _authorized_on_node(user, node_id):
        raise HTTPException(403, "bu düğümde silme yetkisi yok")
    service.delete_node(node_id, deleted_by=user["id"])
    return render(request, "fragments/agac.html", {"user": user, **_tree_ctx(user)})


# --- yonetim paneli (spec/71-yonetim-paneli.md) --------------------------
#
# Yetki iki basamak: `manage_users` scope'u (ya da admin) gunluk isi yapar
# (kullanici ekle/kapat, scope/rol ver-al); rol OLUSTURMA/SILME ve is_admin
# bayragi YALNIZ admin — aksi halde manage_users'i olan biri "her seyi
# yapabilen" bir rol yaratip kendine verebilir (ayricalik yukseltme,
# spec §5 madde 3). Panel sadece gorunen yuz: her uc burada da ayrica
# kontrol eder (KNOW-99'daki kural).


def _can_manage_users(u) -> bool:
    return bool(u) and (db.as_bool(u["is_admin"]) or scope.has_scope(u, "manage_users"))


def _require_manage_users(u) -> None:
    if not _can_manage_users(u):
        raise HTTPException(403, "kullanıcı yönetimi yetkisi yok")


def _require_admin(u) -> None:
    if not (u and db.as_bool(u["is_admin"])):
        raise HTTPException(403, "yalnız admin")


def _admin_ctx(user) -> dict:
    all_roles = scope.list_roles()
    people = []
    for u in users.list_all():
        direct = scope.direct_scopes(u["id"])
        active = scope.active_scopes(u)
        my_roles = scope.user_roles(u["id"])
        my_role_ids = {r["id"] for r in my_roles}
        sources = scope.scope_sources(u)
        # scope_rows: her etkin kapsam icin ad + rolden mi geldigi (rolden
        # geldiyse burada silinmez, rolun kendisinden yapilir — spec §5 madde 1).
        scope_rows = [{"name": s, "direct": s in direct,
                       "via_roles": [o for o in sources.get(s, []) if o != "direct"]}
                      for s in sorted(active)]
        people.append(dict(
            u, scope_rows=scope_rows, roles=my_roles,
            grantable=[k for k in scope.SCOPES if k not in direct],
            assignable_roles=[r for r in all_roles if r["id"] not in my_role_ids],
            last_seen=short_time(u["last_seen_at"]) if u["last_seen_at"] else None))
    return {
        "people": people, "roles": all_roles, "all_scopes": scope.SCOPES,
        "can_manage": _can_manage_users(user), "is_admin": db.as_bool(user["is_admin"]),
    }


@router.get("/admin", response_class=HTMLResponse)
def admin_panel(request: Request):
    user = auth.current_user(request)
    _require_manage_users(user)
    ctx = {"user": user, "m": MODULE_BY_SLUG["admin"], **_admin_ctx(user)}
    if is_htmx(request):
        return render(request, "fragments/admin_main.html", ctx)
    return render(request, "admin.html", ctx)


@router.post("/users", response_class=HTMLResponse)
def create_user(request: Request, email: str = Form(...), name: str = Form(...)):
    user = auth.current_user(request)
    _require_manage_users(user)
    try:
        users.add_user(email, name)
    except users.UserError as e:
        raise HTTPException(400, str(e))
    return render(request, "fragments/admin_main.html", {"user": user, **_admin_ctx(user)})


@router.patch("/users/{user_id}/active", response_class=HTMLResponse)
def toggle_user_active(request: Request, user_id: str):
    user = auth.current_user(request)
    _require_manage_users(user)
    target = db.q1("select is_active from users where id = %s", (db.uid(user_id),))
    if target is None:
        raise HTTPException(404, "kullanıcı yok")
    try:
        users.set_active(user_id, not db.as_bool(target["is_active"]), actor_id=user["id"])
    except users.UserError as e:
        raise HTTPException(400, str(e))
    return render(request, "fragments/admin_main.html", {"user": user, **_admin_ctx(user)})


@router.patch("/users/{user_id}/admin", response_class=HTMLResponse)
def toggle_user_admin(request: Request, user_id: str):
    user = auth.current_user(request)
    _require_admin(user)
    target = db.q1("select is_admin from users where id = %s", (db.uid(user_id),))
    if target is None:
        raise HTTPException(404, "kullanıcı yok")
    try:
        users.set_admin(user_id, not db.as_bool(target["is_admin"]), actor_id=user["id"])
    except users.UserError as e:
        raise HTTPException(400, str(e))
    return render(request, "fragments/admin_main.html", {"user": user, **_admin_ctx(user)})


@router.post("/users/{user_id}/scopes", response_class=HTMLResponse)
def grant_user_scope(request: Request, user_id: str, scope_name: str = Form(..., alias="scope")):
    user = auth.current_user(request)
    _require_manage_users(user)
    if not scope.valid(scope_name):
        raise HTTPException(400, f"geçersiz kapsam: {scope_name}")
    scope.grant_scope(user_id, scope_name, granted_by=user["id"])
    db.x("insert into security_events (id,created_at,event_type,actor_id,email,detail)"
         " values (%s,%s,'scope_granted',%s,(select email from users where id=%s),%s)",
         (db.new_id(), db.now(), user["id"], db.uid(user_id), scope_name))
    return render(request, "fragments/admin_main.html", {"user": user, **_admin_ctx(user)})


@router.delete("/users/{user_id}/scopes/{scope_name}", response_class=HTMLResponse)
def revoke_user_scope(request: Request, user_id: str, scope_name: str):
    user = auth.current_user(request)
    _require_manage_users(user)
    scope.revoke_scope(user_id, scope_name)
    db.x("insert into security_events (id,created_at,event_type,actor_id,email,detail)"
         " values (%s,%s,'scope_revoked',%s,(select email from users where id=%s),%s)",
         (db.new_id(), db.now(), user["id"], db.uid(user_id), scope_name))
    return render(request, "fragments/admin_main.html", {"user": user, **_admin_ctx(user)})


@router.post("/users/{user_id}/roles", response_class=HTMLResponse)
def assign_user_role(request: Request, user_id: str, role_id: str = Form(...)):
    user = auth.current_user(request)
    _require_manage_users(user)
    if not scope.assign_role(user_id, role_id, granted_by=user["id"]):
        raise HTTPException(404, "rol yok")
    role = scope.get_role(role_id)
    db.x("insert into security_events (id,created_at,event_type,actor_id,email,detail)"
         " values (%s,%s,'role_granted',%s,(select email from users where id=%s),%s)",
         (db.new_id(), db.now(), user["id"], db.uid(user_id), role["name"] if role else role_id))
    return render(request, "fragments/admin_main.html", {"user": user, **_admin_ctx(user)})


@router.delete("/users/{user_id}/roles/{role_id}", response_class=HTMLResponse)
def unassign_user_role(request: Request, user_id: str, role_id: str):
    user = auth.current_user(request)
    _require_manage_users(user)
    role = scope.get_role(role_id)
    scope.unassign_role(user_id, role_id)
    db.x("insert into security_events (id,created_at,event_type,actor_id,email,detail)"
         " values (%s,%s,'role_revoked',%s,(select email from users where id=%s),%s)",
         (db.new_id(), db.now(), user["id"], db.uid(user_id), role["name"] if role else role_id))
    return render(request, "fragments/admin_main.html", {"user": user, **_admin_ctx(user)})


@router.post("/roles", response_class=HTMLResponse)
async def create_role(request: Request):
    user = auth.current_user(request)
    _require_admin(user)
    form = await request.form()
    name = form.get("name", "")
    scopes = set(form.getlist("scope"))
    try:
        scope.create_role(name, scopes, created_by=user["id"])
    except ValueError as e:
        raise HTTPException(400, str(e))
    db.x("insert into security_events (id,created_at,event_type,actor_id,email,detail)"
         " values (%s,%s,'role_created',%s,%s,%s)",
         (db.new_id(), db.now(), user["id"], user["email"], name))
    return render(request, "fragments/admin_main.html", {"user": user, **_admin_ctx(user)})


@router.patch("/roles/{role_id}", response_class=HTMLResponse)
async def update_role(request: Request, role_id: str):
    user = auth.current_user(request)
    _require_admin(user)
    form = await request.form()
    try:
        if "name" in form and form.get("name"):
            scope.rename_role(role_id, form.get("name"))
        scope.set_role_scopes(role_id, set(form.getlist("scope")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return render(request, "fragments/admin_main.html", {"user": user, **_admin_ctx(user)})


@router.delete("/roles/{role_id}", response_class=HTMLResponse)
def delete_role(request: Request, role_id: str):
    user = auth.current_user(request)
    _require_admin(user)
    role = scope.get_role(role_id)
    scope.delete_role(role_id)
    db.x("insert into security_events (id,created_at,event_type,actor_id,email,detail)"
         " values (%s,%s,'role_deleted',%s,%s,%s)",
         (db.new_id(), db.now(), user["id"], user["email"], role["name"] if role else role_id))
    return render(request, "fragments/admin_main.html", {"user": user, **_admin_ctx(user)})


@router.get("/{slug}", response_class=HTMLResponse)
def module_page(request: Request, slug: str):
    m = MODULE_BY_SLUG.get(slug)
    if m is None or m["ready"]:
        raise HTTPException(404, "sayfa yok")
    return render(request, "module.html", {"m": m})
