"""Gorev tablosu filtreleri — taban sinif + turevler (spec/60-kaynak-uyarlama.md 2.2).

Yeni bir boyut eklemek = buraya bir Filtre ornegi eklemek; rota ve sablon degismez
(sablon filtreleri genel dongueyle cizer). Abartma: ORM/DSL yok, her filtre tek
WHERE parcasi dondurur. Kurallar spec/10-kararlar.md 'Sorgular':
  - suzme/siralama SQL'de, Python'a donen satir ekranda gorunen satirdir
  - siralama sabit sozlukten (SIRALAMA), kullanici girdisiyle birlestirilmez
  - alt agac tin/tout uzerinden bellekteki agactan, recursive CTE yok
  - metin aramasi FTS5, LIKE '%..%' yok
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import db, search, service

# Sorgular items'i "i" takma adiyla kullanir; tum clause'lar buna gore yazilir.

SIRALAMA = {  # anahtar disaridan gelir ama SQL sabit buradan okunur
    "hareket": "i.updated_at desc",
    "tarih":   "i.due_date is null, i.due_date",
    "oncelik": ("case i.priority when 'kritik' then 0 when 'yuksek' then 1"
                " when 'orta' then 2 else 3 end"),
    "yeni":    "i.created_at desc",
}
VARSAYILAN_SIRA = "hareket"

ACIK_EYLEM = "select item_id from actions where status in ('acik','devam')"


class Filtre:
    """Taban sinif. options() sablondaki select'i besler, clause() SQL uretir."""

    def __init__(self, param: str, label: str):
        self.param, self.label = param, label

    def options(self) -> list[tuple[str, str, str | None]]:
        """[(deger, etiket, grup)] — grup None ise optgroup acilmaz."""
        return []

    def clause(self, value: str, user) -> tuple[str, list] | None:
        raise NotImplementedError


class SecimFiltre(Filtre):
    """Sabit sozluklu sutun esitligi: tur, durum, oncelik, pillar."""

    def __init__(self, param: str, label: str, column: str, choices: dict[str, str]):
        super().__init__(param, label)
        self.column, self.choices = column, choices

    def options(self):
        return [(k, v, None) for k, v in self.choices.items()]

    def clause(self, value, user):
        if value not in self.choices:
            return None
        return f"i.{self.column} = ?", [value]


class KisiFiltre(Filtre):
    """Kullanici sutunu; 'ben' ve 'yok' ozel degerleri."""

    def __init__(self, param: str, label: str, column: str):
        super().__init__(param, label)
        self.column = column

    def options(self):
        ozel = [("ben", "Ben", None), ("yok", "Atanmamış", None)]
        return ozel + [(u["id"], u["name"], None) for u in db.q("select id,name from users order by name")]

    def clause(self, value, user):
        if value == "ben":
            return f"i.{self.column} = ?", [user["id"]]
        if value == "yok":
            return f"i.{self.column} is null", []
        if db.q1("select 1 from users where id = ?", (value,)) is None:
            return None
        return f"i.{self.column} = ?", [value]


class TakimFiltre(Filtre):
    def options(self):
        return [(t["id"], t["name"], None) for t in db.q("select id,name from teams order by name")]

    def clause(self, value, user):
        if db.q1("select 1 from teams where id = ?", (value,)) is None:
            return None
        return "i.team_id = ?", [value]


class DugumFiltre(Filtre):
    """Alt agac suzmesi. Secenekler bellekteki agactan, veri yonetiminde tanimlanan
    turlere (node_type) gore gruplanir — sema degisince filtre kendiliginden uyar."""

    def options(self):
        tree = service.TREE
        sirali = sorted(tree.nodes, key=lambda n: tree.tin[n])
        return [(nid, "· " * tree.depth[nid] + tree.name(nid), tree.nodes[nid].node_type)
                for nid in sirali]

    def clause(self, value, user):
        ids = service.TREE.subtree(value)
        if not ids:
            return None
        return f"i.node_id in ({','.join('?' * len(ids))})", list(ids)


class AramaFiltre(Filtre):
    """FTS5 — MATCH ifadesi kullanici metniyle birlestirilmez (shared/search.py)."""

    def options(self):
        return []          # select degil metin girisi; sablon bunu options() bos diye anlar

    def clause(self, value, user):
        match = search.fts_query(value)
        if match is None:
            return None
        return "i.rowid in (select rowid from items_fts where items_fts match ?)", [match]


def _pillar_secenekleri() -> dict[str, str]:
    return {r["pillar"]: r["pillar"] for r in
            db.q("select distinct pillar from items where pillar is not null order by pillar")}


def aktif_filtreler() -> list[Filtre]:
    """Her istekte kurulur: pillar secenekleri veriden, dugumler agactan gelir."""
    return [
        SecimFiltre("tur", "Tür", "kind", {"hata": "Hata", "gorev": "Görev"}),
        SecimFiltre("durum", "Durum", "status", dict(service.STATUSES)),
        SecimFiltre("oncelik", "Öncelik", "priority", dict(service.PRIORITIES)),
        TakimFiltre("takim", "Takım"),
        KisiFiltre("kisi", "Sorumlu", "assignee_id"),
        DugumFiltre("dugum", "Düğüm"),
        SecimFiltre("pillar", "Pillar", "pillar", _pillar_secenekleri()),
        AramaFiltre("ara", "Ara"),
    ]


# --- hizli filtreler: kadans hafta (spec/10-kararlar.md 'Kadans hafta') ------

def _hafta():
    bugun = datetime.now(timezone.utc).date()
    return (bugun - timedelta(days=7)).isoformat(), (bugun + timedelta(days=7)).isoformat()


def hizli_clause(key: str, user) -> tuple[str, list] | None:
    once, sonra = _hafta()
    bugun = datetime.now(timezone.utc).date().isoformat()
    H = {
        # bu haftanin gundemi: son 7 gunde hareket VEYA son tarihi 7 gun icinde
        "hafta": ("(i.updated_at >= ? or (i.due_date is not null and i.due_date <= ?"
                  " and i.status <> 'kapandi'))", [once, sonra]),
        # acik eylemim: actions tablosundan (spec/20-sema.md §3a)
        "eylemim": (f"i.id in (select item_id from actions where assignee_id = ?"
                    " and status in ('acik','devam'))", [user["id"]]),
        # geciken: kaydin ya da acik bir eyleminin son tarihi gecmis
        "geciken": ("((i.due_date < ? and i.status <> 'kapandi') or i.id in"
                    " (select item_id from actions where due_date < ?"
                    "  and status in ('acik','devam')))", [bugun, bugun]),
        "atanmamis": ("i.assignee_id is null and i.status <> 'kapandi'", []),
    }
    return H.get(key)


HIZLI = [("hepsi", "Hepsi"), ("hafta", "Bu hafta"), ("eylemim", "Açık eylemim"),
         ("geciken", "Geciken"), ("atanmamis", "Atanmamış")]


def sorgu_kur(params, user) -> tuple[str, list, str, dict]:
    """Istek parametrelerinden (where, args, order by, secili) uretir.

    secili: sablonun select'leri isaretlemesi icin {param: deger} — yalnizca
    gecerli clause ureten degerler girer, yansitilan ham girdi degil.
    """
    where, args, secili = ["1=1"], [], {}
    for f in aktif_filtreler():
        v = (params.get(f.param) or "").strip()
        if not v:
            continue
        c = f.clause(v, user)
        if c is None:
            continue
        where.append(c[0])
        args.extend(c[1])
        secili[f.param] = v

    hizli = params.get("hizli") or "hepsi"
    c = hizli_clause(hizli, user)
    if c is not None:
        where.append(c[0])
        args.extend(c[1])
    else:
        hizli = "hepsi"
    secili["hizli"] = hizli

    sirala = params.get("sirala") if params.get("sirala") in SIRALAMA else VARSAYILAN_SIRA
    secili["sirala"] = sirala
    # deterministik kuyruk: (secilen sutun, id) — spec/10-kararlar.md
    return " and ".join(where), args, f"{SIRALAMA[sirala]}, i.id", secili
