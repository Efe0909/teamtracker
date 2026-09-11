"""Gorev tablosu filtreleri — taban sinif + turevler (spec/60-kaynak-uyarlama.md 2.2).

Yeni bir boyut eklemek = buraya bir Filter ornegi eklemek; rota ve sablon degismez
(sablon filtreleri genel dongueyle cizer). Abartma: ORM/DSL yok, her filtre tek
WHERE parcasi dondurur. Kurallar spec/10-kararlar.md 'Sorgular':
  - suzme/siralama SQL'de, Python'a donen satir ekranda gorunen satirdir
  - siralama sabit sozlukten (ORDERINGS), kullanici girdisiyle birlestirilmez
  - alt agac tin/tout uzerinden bellekteki agactan, recursive CTE yok
  - metin aramasi tsvector/GIN, LIKE '%..%' yok
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import db, search, service

# Sorgular items'i "i" takma adiyla kullanir; tum clause'lar buna gore yazilir.

ORDERINGS = {  # anahtar disaridan gelir ama SQL sabit buradan okunur
    "activity": "i.updated_at desc",
    "date":     "i.due_date is null, i.due_date",
    "priority": ("case i.priority when 'critical' then 0 when 'high' then 1"
                 " when 'medium' then 2 else 3 end"),
    "newest":   "i.created_at desc",
}
DEFAULT_ORDER = "activity"

OPEN_ACTION = "select item_id from actions where status in ('open','in_progress')"


class Filter:
    """Taban sinif. options() sablondaki select'i besler, clause() SQL uretir."""

    def __init__(self, param: str, label: str):
        self.param, self.label = param, label

    def options(self) -> list[tuple[str, str, str | None]]:
        """[(deger, etiket, grup)] — grup None ise optgroup acilmaz."""
        return []

    def clause(self, value: str, user) -> tuple[str, list] | None:
        raise NotImplementedError


class SelectFilter(Filter):
    """Sabit sozluklu sutun esitligi: tur, durum, oncelik."""

    def __init__(self, param: str, label: str, column: str, choices: dict[str, str]):
        super().__init__(param, label)
        self.column, self.choices = column, choices

    def options(self):
        return [(k, v, None) for k, v in self.choices.items()]

    def clause(self, value, user):
        if value not in self.choices:
            return None
        return f"i.{self.column} = %s", [value]


class PersonFilter(Filter):
    """Kullanici sutunu; 'ben' ve 'yok' ozel degerleri."""

    def __init__(self, param: str, label: str, column: str):
        super().__init__(param, label)
        self.column = column

    def options(self):
        special = [("me", "Ben", None), ("none", "Atanmamış", None)]
        return special + [(u["id"], u["name"], None) for u in db.q("select id,name from users order by name")]

    def clause(self, value, user):
        if value == "me":
            return f"i.{self.column} = %s", [user["id"]]
        if value == "none":
            return f"i.{self.column} is null", []
        # Sutun uuid: gecersiz metin dogrudan sorguya girerse veritabani hata
        # verir. Once cevir, olmuyorsa filtreyi yok say (bozuk girdi filtreyi
        # dusurur, istegi dusurmez).
        id_ = db.uid(value)
        if id_ is None or db.q1("select 1 from users where id = %s", (id_,)) is None:
            return None
        return f"i.{self.column} = %s", [id_]


class TeamFilter(Filter):
    def options(self):
        return [(t["id"], t["name"], None) for t in db.q("select id,name from teams order by name")]

    def clause(self, value, user):
        id_ = db.uid(value)
        if id_ is None or db.q1("select 1 from teams where id = %s", (id_,)) is None:
            return None
        return "i.team_id = %s", [id_]


class NodeFilter(Filter):
    """Alt agac suzmesi. Secenekler bellekteki agactan, veri yonetiminde tanimlanan
    turlere (node_type) gore gruplanir — sema degisince filtre kendiliginden uyar."""

    def options(self):
        tree = service.TREE
        ordered = sorted(tree.nodes, key=lambda n: tree.tin[n])
        return [(nid, "· " * tree.depth[nid] + tree.name(nid), tree.nodes[nid].node_type)
                for nid in ordered]

    def clause(self, value, user):
        # subtree() bellekteki agactan; anahtar uuid, gelen deger metin.
        ids = service.TREE.subtree(db.uid(value)) if db.uid(value) else []
        if not ids:
            return None
        return "i.node_id = any(%s)", [list(ids)]


class SearchFilter(Filter):
    """tsvector/GIN — sorgu ifadesi kullanici metniyle birlestirilmez (shared/search.py)."""

    def options(self):
        return []          # select degil metin girisi; sablon bunu options() bos diye anlar

    def clause(self, value, user):
        match = search.fts_query(value)
        if match is None:
            return None
        return "i.search_vector @@ to_tsquery('tr', %s)", [match]


def active_filters() -> list[Filter]:
    """Her istekte kurulur: dugumler agactan gelir."""
    return [
        SelectFilter("kind", "Tür", "kind", {"issue": "Hata", "task": "Görev"}),
        SelectFilter("status", "Durum", "status", dict(service.STATUSES)),
        SelectFilter("priority", "Öncelik", "priority", dict(service.PRIORITIES)),
        TeamFilter("team", "Takım"),
        PersonFilter("person", "Sorumlu", "assignee_id"),
        NodeFilter("node", "Düğüm"),
        SearchFilter("search", "Ara"),
    ]


# --- hizli filtreler: kadans hafta (spec/10-kararlar.md 'Kadans hafta') ------

def _week_range():
    """Tarihler ARTIK METIN DEGIL: sutunlar date/timestamptz, karsilastirma
    icin gercek nesne gonderilir (isoformat() SQLite doneminden kalmaydi)."""
    today = datetime.now(timezone.utc).date()
    return today - timedelta(days=7), today + timedelta(days=7)


def quick_clause(key: str, user) -> tuple[str, list] | None:
    before, after = _week_range()
    today = datetime.now(timezone.utc).date()
    Q = {
        # bu haftanin gundemi: son 7 gunde hareket VEYA son tarihi 7 gun icinde
        "week": ("(i.updated_at >= %s::date or (i.due_date is not null and i.due_date <= %s"
                 " and i.status <> 'closed'))", [before, after]),
        # acik eylemim: actions tablosundan (spec/20-sema.md §3a)
        "my_actions": (f"i.id in (select item_id from actions where assignee_id = %s"
                       " and status in ('open','in_progress'))", [user["id"]]),
        # geciken: kaydin ya da acik bir eyleminin son tarihi gecmis
        "overdue": ("((i.due_date < %s and i.status <> 'closed') or i.id in"
                    " (select item_id from actions where due_date < %s"
                    "  and status in ('open','in_progress')))", [today, today]),
        "unassigned": ("i.assignee_id is null and i.status <> 'closed'", []),
    }
    return Q.get(key)


QUICK_FILTERS = [("all", "Hepsi"), ("week", "Bu hafta"), ("my_actions", "Açık eylemim"),
                 ("overdue", "Geciken"), ("unassigned", "Atanmamış")]


def build_query(params, user) -> tuple[str, list, str, dict]:
    """Istek parametrelerinden (where, args, order by, secili) uretir.

    selected: sablonun select'leri isaretlemesi icin {param: deger} — yalnizca
    gecerli clause ureten degerler girer, yansitilan ham girdi degil.
    """
    where, args, selected = ["1=1"], [], {}
    for f in active_filters():
        v = (params.get(f.param) or "").strip()
        if not v:
            continue
        c = f.clause(v, user)
        if c is None:
            continue
        where.append(c[0])
        args.extend(c[1])
        selected[f.param] = v

    quick = params.get("quick") or "all"
    c = quick_clause(quick, user)
    if c is not None:
        where.append(c[0])
        args.extend(c[1])
    else:
        quick = "all"
    selected["quick"] = quick

    sort = params.get("sort") if params.get("sort") in ORDERINGS else DEFAULT_ORDER
    selected["sort"] = sort
    # deterministik kuyruk: (secilen sutun, id) — spec/10-kararlar.md
    return " and ".join(where), args, f"{ORDERINGS[sort]}, i.id", selected
