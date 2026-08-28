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

from shared import auth, db, filters, service
from shared.config import site_adresi
from shared.render import is_htmx, site_templates
from shared.service import (EYLEM_DURUM, PRIORITIES, STATUSES, add_action, add_message,
                            change_action, change_field, get_action, get_item, new_item,
                            short_time, users_by_id)

router = APIRouter()
_TPL = site_templates(Path(__file__).parent / "templates")


def render(request, name: str, ctx: dict) -> HTMLResponse:
    return _TPL.TemplateResponse(request, name, ctx)


# --- ana sayfa modul kaydi: tek dogruluk kaynagi (ana sayfa ve /{slug} ayni listeyi okur)

MODULES = [
    {"slug": "gorevler", "icon": "📋", "name": "Görev Yöneticisi", "ready": True,
     "desc": "Tüm kayıtlar tek tabloda: özet çipleri, hızlı filtreler, boyut filtreleri. "
             "Satır kayıt sayfasına gider; eylemler orada.",
     "plan": []},
    {"slug": "ekipler", "icon": "👥", "name": "Ekipler", "ready": False,
     "desc": "Takımlar, roller (lider/mentor/üye), takım duvarı ve \"bu takıma kayıt aç\".",
     "plan": ["Takım kartı: tanım, üyeler, açık kayıt sayısı (spec/60-kaynak-uyarlama.md 2.5).",
              "Takım duvarı events.subject_type='team' üstünden — kart akışıyla aynı bileşen.",
              "Kayıt takıma tanımlanır, eylem kişiye atanır (spec/10-kararlar.md).",
              "Pasif üyenin giriş kapısı: duvar + kendine düşen eylemler."]},
    {"slug": "kazanim-agaci", "icon": "🌳", "name": "Kazanım Ağacı", "ready": False,
     "desc": "Cell / makine kırılımını düzenlediğin ekran: düğüm ekle, adlandır, taşı, sil.",
     "plan": ["Ağaç düzenleme nodes üzerinde çalışır; değişiklik anında uygulanır.",
              "is_editor olmayanın değişikliği change_requests'e düşer, prev_state ile geri alınabilir (spec/20-sema.md §4).",
              "Yapı her değiştiğinde TreeIndex komple yeniden kurulur ve nodes.tin/tout tek UPDATE ile yazılır.",
              "Taşımada döngü koruması: hedef, taşınan düğümün alt ağacında olamaz."]},
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
    {"slug": "takvim", "icon": "📅", "name": "Takvim", "ready": False,
     "desc": "Son tarihler, gecikmeler ve ekip yükü ay / hafta görünümünde.",
     "plan": ["items.due_date ve actions.due_date üzerinden ay ve hafta görünümü.",
              "Gecikmiş kayıtlar (due_date < bugün ve status <> 'kapandi') ayrı vurgulanır.",
              "Bir güne tıklayınca o günün kayıtları görev tablosunda süzülür."]},
    {"slug": "tanimlar", "icon": "📐", "name": "Görev Tanımları & Şemalar", "ready": False,
     "desc": "Rol tanımları, yönetim şemaları ve adım adım iş tanımları — kimin neyi yaptığı.",
     "plan": ["Şemalar hiyerarşinin kendisinden türer: düğüm → sorumlu → yedek.",
              "Adım adım iş tanımları düz metin olarak düğüme bağlı sürümlenir (form-builder yok — spec/60 §4).",
              "Salt okunur görünüm herkese açık, düzenleme is_editor kapsamına bağlı."]},
    {"slug": "arsiv", "icon": "🗂", "name": "Ekip Arşivi", "ready": False,
     "desc": "Kapanmış kayıtlar, alınan kararlar ve geçmiş dönemlerin kurumsal hafızası.",
     "plan": ["Kapanmış kayıtlar silinmez, arşive düşer (spec/20-sema.md açık nokta 3: deleted_at).",
              "Tam metin arama FTS5 üzerinden — LIKE '%…%' yok.",
              "Karar kayıtları kartın olay akışından toplanır."]},
    {"slug": "dosyalar", "icon": "🗄", "name": "Dosyalar / NAS", "ready": False,
     "desc": "Karta ve düğüme bağlı dosyalar; kılavuz/eğitim kütüphanesi de buraya oturur.",
     "plan": ["spec/20-sema.md açık nokta 1 🚧: docker + NAS yönü; saklama süresi kararı bekliyor.",
              "Faz 1'de dosya yükleme bilerek yok; yükleme kaynaklı saldırı yüzeyi de yok (README).",
              "Erişim yetkisi kartın yetkisiyle aynı yerden gelir, ikinci bir model kurulmaz."]},
    {"slug": "admin", "icon": "🛡", "name": "Yönetim Paneli", "ready": False,
     "desc": "Kullanıcılar, takımlar, kapsamlar, yetkiler ve bekleyen değişiklik talepleri.",
     "plan": ["Kullanıcı kapsamı (scope_node_id), is_admin / is_editor bayrakları buradan yönetilir.",
              "Takım üyelikleri ve roller (team_members) buradan düzenlenir.",
              "Açık change_requests kuyruğu: onayla / reddet — ret prev_state'ten geri yazar.",
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
    e = db.q1("select count(*) c from actions where assignee_id = ?"
              " and status in ('acik','devam')", (user["id"],))
    return {"open": r["acik"] or 0, "unassigned": r["atanmamis"] or 0,
            "mine": r["bana"] or 0, "all": r["hepsi"] or 0,
            "my_actions": e["c"] or 0, "nodes": len(service.TREE.nodes)}


# --- gorev tablosu (spec/60-kaynak-uyarlama.md 2.2) -------------------------


def tablo_ctx(request, user) -> dict:
    """Tablo + ozet cipleri. Suzme/siralama SQL'de; ozet ayni WHERE ile tek sorgu."""
    where, args, order, secili = filters.sorgu_kur(request.query_params, user)
    rows = db.q(
        "select i.*, t.name team_name, t.color team_color,"
        " (select count(*) from actions a where a.item_id = i.id"
        "  and a.status in ('acik','devam')) acik_eylem"
        f" from items i left join teams t on t.id = i.team_id where {where}"
        f" order by {order}", tuple(args))
    oz = db.q1(
        "select"
        " sum(case when i.status <> 'kapandi' then 1 else 0 end) acik,"
        " sum(case when i.status = 'kapandi' then 1 else 0 end) kapali,"
        " count(*) hepsi,"
        " sum(case when i.status <> 'kapandi' and i.priority = 'kritik' then 1 else 0 end) kritik,"
        " sum(case when i.status <> 'kapandi' and i.priority = 'yuksek' then 1 else 0 end) yuksek,"
        " sum(case when i.status <> 'kapandi' and i.priority = 'orta' then 1 else 0 end) orta,"
        " sum(case when i.status <> 'kapandi' and i.priority = 'dusuk' then 1 else 0 end) dusuk"
        f" from items i where {where}", tuple(args))
    users = users_by_id()
    bugun = datetime.now(timezone.utc).date().isoformat()
    out = []
    for r in rows:
        out.append({
            "id": r["id"], "kind": r["kind"], "title": r["title"],
            "status": r["status"], "priority": r["priority"],
            "team": {"name": r["team_name"], "color": r["team_color"]} if r["team_name"] else None,
            "assignee": users.get(r["assignee_id"]),
            "path": " › ".join(service.TREE.name(n)
                               for n in service.TREE.ancestors(r["node_id"])[-2:]),
            "due": r["due_date"], "overdue": bool(r["due_date"]) and r["due_date"] < bugun
                    and r["status"] != "kapandi",
            "acik_eylem": r["acik_eylem"], "time": short_time(r["updated_at"]),
        })
    return {"rows": out, "oz": oz, "secili": secili,
            "filtreler": filters.aktif_filtreler(), "hizli": filters.HIZLI,
            "siralama": {"hareket": "Son hareket", "tarih": "Son tarih",
                         "oncelik": "Öncelik", "yeni": "En yeni"},
            "statuses": STATUSES, "priorities": PRIORITIES}


def node_options() -> list[dict]:
    """Yeni kayit formu icin dugum listesi (girintili)."""
    tree = service.TREE
    sirali = sorted(tree.nodes, key=lambda n: tree.tin[n])
    return [{"id": n, "name": tree.name(n), "depth": tree.depth[n]} for n in sirali]


def card_ctx(request, item, user) -> dict:
    users = users_by_id()
    teams = service.teams_by_id()
    feed = []
    for e in db.q("select * from events where subject_type='item' and subject_id=?"
                  " order by created_at", (item["id"],)):
        a = users.get(e["author_id"])
        feed.append({"type": e["event_type"], "body": e["body"], "author": a,
                     "mine": a is not None and a["id"] == user["id"],
                     "time": short_time(e["created_at"])})
    bugun = datetime.now(timezone.utc).date().isoformat()
    eylemler = []
    for a in service.actions_of(item["id"]):
        eylemler.append({
            "id": a["id"], "title": a["title"], "status": a["status"],
            "assignee": users.get(a["assignee_id"]), "due": a["due_date"],
            "overdue": bool(a["due_date"]) and a["due_date"] < bugun
                        and a["status"] in ("acik", "devam"),
            "done": a["status"] in ("kapandi", "iptal"),
        })
    return {
        "request": request, "user": user, "item": item,
        "assignee": users.get(item["assignee_id"]),
        "creator": users.get(item["created_by"]),
        "team": teams.get(item["team_id"]),
        "teams": list(teams.values()),
        "participants": [users[p] for p in auth.participant_ids(item["id"]) if p in users],
        "users": list(users.values()), "feed": feed, "eylemler": eylemler,
        "acik_eylem": sum(1 for e in eylemler if not e["done"]),
        "crumbs": [{"id": n, "name": service.TREE.name(n)}
                   for n in service.TREE.ancestors(item["node_id"])],
        "can_edit": auth.can_edit_item(user, item, service.TREE),
        "statuses": STATUSES, "priorities": PRIORITIES, "eylem_durum": EYLEM_DURUM,
        "status_label": STATUSES[item["status"]], "priority_label": PRIORITIES[item["priority"]],
        "olusturma": short_time(item["created_at"]),
    }


# --- uclar ---------------------------------------------------------------

@router.get("/", response_class=HTMLResponse)
def home(request: Request):
    """Ana sayfa: modul secimi (panolar grid'i — spec/60-kaynak-uyarlama.md 2.1)."""
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
    if item:  # eski baglantilar: /gorevler?item=... -> kayit sayfasi
        return RedirectResponse(f"/gorevler/{item}", status_code=303)
    user = auth.current_user(request)
    ctx = {"user": user, "all_users": auth.all_users(), **tablo_ctx(request, user)}
    if is_htmx(request):
        return render(request, "fragments/tablo.html", ctx)
    ctx["nodes"] = node_options()
    ctx["app_adres"] = site_adresi(request, app_site=True)
    return render(request, "gorevler.html", ctx)


@router.get("/gorevler/{item_id}", response_class=HTMLResponse)
def task_page(request: Request, item_id: str):
    """Kayit sayfasi — URL paylasilabilir (modal degil, spec/60 2.4)."""
    user = auth.current_user(request)
    item = get_item(item_id)
    ctx = card_ctx(request, item, user)
    ctx["all_users"] = auth.all_users()
    ctx["app_adres"] = site_adresi(request, app_site=True)
    return render(request, "kayit.html", ctx)


@router.get("/item/{item_id}")
def item_view(item_id: str):
    """Eski uc: kayit sayfasina yonlendirir."""
    get_item(item_id)
    return RedirectResponse(f"/gorevler/{item_id}", status_code=303)


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


@router.post("/item/{item_id}/eylem", response_class=HTMLResponse)
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


@router.patch("/eylem/{action_id}", response_class=HTMLResponse)
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


@router.post("/item")
def create_item(request: Request, node_id: str = Form(...), title: str = Form(...),
                kind: str = Form("hata"), description: str = Form(""),
                team_id: str = Form("")):
    user = auth.current_user(request)
    item_id = new_item(user, node_id, kind, title, description, team_id or None)
    return RedirectResponse(f"/gorevler/{item_id}", status_code=303)


# --- iskele moduller: EN SONDA dursun, once tanimli rotalar eslessin --------


@router.get("/{slug}", response_class=HTMLResponse)
def module_page(request: Request, slug: str):
    m = MODULE_BY_SLUG.get(slug)
    if m is None or m["ready"]:
        raise HTTPException(404, "sayfa yok")
    return render(request, "module.html", {"m": m})
