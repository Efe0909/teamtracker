#!/usr/bin/env python3
"""Demo tohumu: bos bir `*demo*` veritabanini gercekci bir kulup gecmisiyle doldurur.

    PSQL='PGPASSWORD=ekiptakip psql -h 127.0.0.1 -U ekiptakip -d ekiptakip_demo' \
    API=http://127.0.0.1:8000  python3 demo/seed/run.py

Onkosul: `demo/stack.sh reset` (bos veritabani + calisan API, sahte kimlik).
Mevcut `backend/seed.sql` KULLANILMAZ; burada her sey gercek uclardan gecer.
"""

from __future__ import annotations

import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from client import Api, Psql, TZ, guard, q  # noqa: E402
import structure as S  # noqa: E402


def log(msg: str) -> None:
    print(f"  {msg}", flush=True)


# --- yardimcilar ---------------------------------------------------------------

def nodes_of(api: Api) -> list[dict]:
    return api.as_("defne").get("/api/nodes")["nodes"]


def node_id(api: Api, name: str, parent: str | None = None) -> str:
    """Ada gore dugum kimligi (kok adlari dahil). `parent`: ust dugumun adi."""
    ns = nodes_of(api)
    by_id = {n["id"]: n for n in ns}
    hits = [n for n in ns if n["name"] == name
            and (parent is None or by_id.get(n["parent_id"], {}).get("name") == parent)]
    if len(hits) != 1:
        raise RuntimeError(f"dugum bulunamadi/belirsiz: {name!r} ({len(hits)})")
    return hits[0]["id"]


def root_id(api: Api, key: str) -> str:
    return next(n["id"] for n in nodes_of(api) if n["key"] == key)


# --- 1. calisma alani -------------------------------------------------------------

def phase_workspace(api: Api) -> None:
    """Ilk yonetici + davetler + kok hucre + roller + yetkiler + birim agaci."""
    c, psql = api.clock, api.psql
    log("ilk yonetici ve davetler")
    c.at(45, "09:30")
    d = S.PEOPLE[0]
    uid = psql.run(
        "insert into users (email, name, color, is_admin, created_at) values "
        f"({q(d['email'])}, {q(d['name'])}, '#5b8cff', true, '{c.virtual.isoformat()}') returning id")
    api.users["defne"] = uid
    defne = api.as_("defne")
    c.at(45, "09:45")
    for p in S.PEOPLE[1:]:
        defne.post("/api/admin/users", {"email": p["email"], "name": p["name"]})
    by_email = {p["email"]: p["id"] for p in defne.get("/api/admin")["people"]}
    for p in S.PEOPLE:
        api.users[p["key"]] = by_email[p["email"]]
    # Ayrilan uye: hesap kapali (Yonetim'de "Pasif" gorunur), kayitlara karismaz.
    c.at(12, "11:10")
    defne.patch(f"/api/admin/users/{api.users['ece']}", {"op": "active", "value": False})

    log("kok hucre, roller, yetkiler")
    c.at(44, "10:00")
    units_root = root_id(api, "units")
    name, kind, desc, kids = S.UNITS
    defne.post("/api/nodes", {"name": name, "node_type": kind, "parent_id": units_root, "description": desc})
    cell = node_id(api, name)
    c.at(44, "10:20")
    role_ids: dict[str, str] = {}
    for r in S.ROLES:
        branch_ids = [node_id(api, b) for b in r["branches"]]
        view = defne.post("/api/admin/roles", {"name": r["name"], "color": r["color"],
                                               "scopes": r["scopes"], "node_ids": branch_ids})
        role_ids = {x["name"]: x["id"] for x in view["roles"]}
    role_id = {r["key"]: role_ids[r["name"]] for r in S.ROLES}
    c.at(44, "11:00", step_min=1)
    for key, g in S.GRANTS.items():
        uid = api.users[key]
        for r in g.get("roles", []):
            defne.patch(f"/api/admin/users/{uid}", {"op": "grant_role", "value": role_id[r]})
        for sc in g.get("scopes", []):
            defne.patch(f"/api/admin/users/{uid}", {"op": "grant_scope", "value": sc})

    log("birim agaci (Kaan, Birim Editoru)")
    kaan = api.as_("kaan")
    c.at(43, "10:00")
    _build_units(api, kaan, cell, kids)
    # Dogrudan dal izni (rolden degil): SEB irtibati kendi dalindaki kayitlari duzenler.
    c.at(43, "15:30")
    for key, g in S.GRANTS.items():
        for b in g.get("branches", []):
            defne.patch(f"/api/admin/users/{api.users[key]}", {"op": "grant_node", "value": node_id(api, b)})


def _build_units(api: Api, who, parent_id: str, kids: list) -> None:
    for item in kids:
        name, kind, desc, children = item[:4]
        short = len(item) == 5 and item[4]
        if short:
            # API ad >= 5 karakter ister; "ETF"/"OTF" kullanicinin istedigi ad. Eski kisa veri
            # gibi dogrudan yazilir (sira: kardeslerin sonuna, API ile ayni kural).
            api.clock.stamp()
            api.psql.run(
                "insert into nodes (parent_id, name, node_type, description, created_by, sort_order) values "
                f"('{parent_id}', {q(name)}, '{kind}', {q(desc)}, '{api.users['kaan']}', "
                f"coalesce((select max(sort_order) from nodes where parent_id = '{parent_id}'), -1) + 1)")
            api.clock.wait(3)
            continue
        who.post("/api/nodes", {"name": name, "node_type": kind, "parent_id": parent_id, "description": desc})
        nid = node_id(api, name)
        if children:
            _build_units(api, who, nid, children)


# --- 2. yer ve tur listeleri ---------------------------------------------------------

def phase_lists(api: Api) -> None:
    c = api.clock
    log("etkinlik yerleri (Ayse) ve turleri (Kaan)")
    ayse, kaan = api.as_("ayse"), api.as_("kaan")
    c.at(42, "13:00")
    places = root_id(api, "event_locations")
    for name, desc in S.LOCATIONS:
        ayse.post("/api/nodes", {"name": name, "parent_id": places, "description": desc})
    c.at(42, "15:00")
    types_root = root_id(api, "event_types")
    for t in S.EVENT_TYPES:
        kaan.post("/api/nodes", {"name": t["name"], "parent_id": types_root, "description": t["desc"]})
        opt = node_id(api, t["name"])
        steps = next(n["id"] for n in nodes_of(api) if n["parent_id"] == opt and n["attrs"].get("slot") == "steps")
        wid = next(n["id"] for n in nodes_of(api) if n["parent_id"] == opt and n["attrs"].get("slot") == "widgets")
        for label, off in t["steps"]:
            kaan.post("/api/nodes", {"name": label, "parent_id": steps, "attrs": {"offset_days": off}})
        for w in t["widgets"]:
            label = "Etkinlik talep formu (OTF)" if w == "otf" else "Satın alımlar"
            kaan.post("/api/nodes", {"name": label, "parent_id": wid, "attrs": {"widget": w}})


# --- 3. takimlar ---------------------------------------------------------------------

def phase_teams(api: Api) -> None:
    c = api.clock
    log("takimlar ve pillar'lar (Ayse)")
    ayse = api.as_("ayse")
    c.at(41, "11:00")
    team_ids: dict[str, str] = {}
    for t in S.TEAMS:
        out = ayse.post("/api/teams", {"name": t["name"], "description": t["desc"], "color": t["color"]})
        team_ids[t["name"]] = out["id"]
        for who, role in t["members"]:
            ayse.post(f"/api/teams/{out['id']}/members", {"user_id": api.users[who], "role": role})
        for unit in t["links"]:
            ayse.put(f"/api/teams/{out['id']}/nodes/{node_id(api, unit)}")
    c.at(41, "15:00")
    for p in S.PILLARS:
        out = ayse.post("/api/pillars", {"name": p["name"], "description": p["desc"], "color": p["color"]})
        for who, role in p["members"]:
            ayse.post(f"/api/teams/{out['team_id']}/members", {"user_id": api.users[who], "role": role})


def phase_profiles(api: Api) -> None:
    log("profiller")
    today = dt.datetime.now(TZ).date()
    for i, p in enumerate(S.PEOPLE):
        if p.get("left"):
            continue
        api.clock.at(40 - i // 3, f"{10 + i % 5}:{(i * 7) % 60:02d}")
        day, month, year = (today.day, today.month, 2003) if p["birth"] == "today" else p["birth"]
        api.as_(p["key"]).patch("/api/me/profile", {
            "nickname": p["nick"], "phone": p["phone"],
            "birth_day": day, "birth_month": month, "birth_year": year})


def main() -> None:
    api_url = os.environ.get("API", "http://127.0.0.1:8000")
    psql = Psql(os.environ["PSQL"])
    guard(api_url, psql)
    if psql.run("select count(*) from users") != "0":
        raise SystemExit("red: veritabani bos degil (demo/stack.sh reset)")
    api = Api(api_url, psql)
    only = set(sys.argv[1:])

    def run(name, fn):
        if not only or name in only:
            fn(api)

    run("workspace", phase_workspace)
    run("lists", phase_lists)
    run("teams", phase_teams)
    run("profiles", phase_profiles)
    api.shift()
    log("tamam")


if __name__ == "__main__":
    main()
