"""Hikayeyi API uzerinden oynatir: kayitlar, etkinlikler, takim duvarlari, ince ayar.

`World` ad -> kimlik cozumlemesini tutar; `Player` olaylari sanal saatle sirayla uygular.
"""

from __future__ import annotations

import datetime as dt
import os
import re

from client import Api, ApiError, TZ, q
from story_lib import Event, Rec

# edit_deadline ve manage_events sahipleri (tarih yazabilenler); digerleri icin Kaan yazar.
DEADLINERS = {"kaan", "selin", "elif", "defne"}
ASSETS = os.environ.get("DEMO_ASSETS", os.path.join(os.path.dirname(__file__), "..", "out", "assets"))


def today() -> dt.date:
    return dt.datetime.now(TZ).date()


def iso(days: int) -> str:
    return (today() + dt.timedelta(days=days)).isoformat()


def expand(value):
    """`{d+N}` -> bugunden N gun sonrasinin tarihi (metin icinde)."""
    if isinstance(value, str):
        return re.sub(r"\{d([+-]\d+)\}", lambda m: iso(int(m.group(1))), value)
    if isinstance(value, list):
        return [expand(v) for v in value]
    if isinstance(value, dict):
        return {k: expand(v) for k, v in value.items()}
    return value


def order_key(d: int, t: str) -> tuple:
    h, m = map(int, t.split(":"))
    return (-d, h, m)


class World:
    """Ad -> kimlik (birimler, takimlar, pillar'lar, yerler, etkinlik turleri)."""

    def __init__(self, api: Api):
        self.api = api
        self.refresh()
        self.records: dict[str, dict] = {}   # anahtar -> {id, chat, owner, creator}
        self.cards: dict[tuple, str] = {}
        self.actions: dict[tuple, str] = {}
        self.msgs: dict[tuple, str] = {}

    def refresh(self) -> None:
        d = self.api.as_("defne")
        nodes = d.get("/api/nodes")["nodes"]
        by_id = {n["id"]: n for n in nodes}
        self.unit: dict[str, str] = {}
        self.loc: dict[str, str] = {}
        self.kind: dict[str, str] = {}
        for n in nodes:
            if n["root_key"] == "units" and n["key"] is None:
                self.unit[n["name"]] = n["id"]
            elif n["node_type"] == "location":
                self.loc[n["name"]] = n["id"]
            elif n["node_type"] == "option":
                self.kind[n["name"]] = n["id"]
        meta = d.get("/api/meta")
        self.team = {t["name"]: t for t in meta["teams"]}
        self.pillar = {p["name"]: p for p in meta["pillars"]}


class Player:
    def __init__(self, api: Api):
        self.api, self.c = api, api.clock
        self.w = World(api)
        self._editable: set[tuple] = set()

    # --- ortak -----------------------------------------------------------------
    def s(self, who: str):
        return self.api.as_(who)

    def at(self, d: int, t: str, step: int = 1) -> None:
        self.c.at(d, t, step_min=step)

    def ensure_editor(self, rid: str, who: str, adder: str) -> None:
        """`who` kayitta yazamiyorsa, kayit sahibi onu katilimci yapar (`@anma` gibi)."""
        key = (rid, who)
        if key in self._editable:
            return
        det = self.s(who).get(f"/api/records/{rid}")
        if not det["access"]["can_edit"]:
            self.s(adder).put(f"/api/records/{rid}/participants/{self.api.users[who]}")
        self._editable.add(key)

    def upload(self, who: str, name: str) -> str:
        return self.s(who).upload(os.path.join(ASSETS, name), name)

    # --- kayitlar --------------------------------------------------------------
    def create_record(self, r: Rec) -> None:
        w, c = self.w, self.c
        self.at(*r.at)
        s = self.s(r.creator)
        body = dict(kind=r.kind, title=r.title, description=r.desc, unit_id=w.unit[r.unit],
                    team_id=w.team[r.team]["id"] if r.team else None,
                    pillar_id=w.pillar[r.pillar]["id"] if r.pillar else None,
                    owner_id=self.api.users[r.owner] if r.owner else None,
                    priority=r.priority, card_types=[], access_mode=r.access)
        rid = s.post("/api/records", body)["id"]
        det = s.get(f"/api/records/{rid}")
        info = dict(id=rid, chat=det["record"]["chat_id"], owner=r.owner or r.creator, creator=r.creator)
        w.records[r.key] = info
        self._editable.update({(rid, r.creator)} | ({(rid, r.owner)} if r.owner else set()))
        if r.due is not None:
            setter = r.creator if r.creator in DEADLINERS else "kaan"
            self.s(setter).patch(f"/api/records/{rid}", {"field": "due_date", "value": iso(r.due)})
        # Kronoloji korumasi: olaylar kayit acilisindan sonra ve sirali olmali.
        prev = order_key(*r.at)
        for it in r.items:
            k = order_key(it["d"], it["t"])
            if k < prev:
                raise SystemExit(f"zaman sirasi bozuk: {r.key} -> {it['k']} {it['d']}g {it['t']}")
            prev = k
        for it in r.items:
            self.apply(r.key, it)

    def apply(self, key: str, it: dict) -> None:
        w, info = self.w, self.w.records[key]
        rid, k = info["id"], it["k"]
        self.at(it["d"], it["t"])
        who = it["who"]
        s = self.s(who)
        adder = info["owner"]
        if k in ("msg", "act", "act_status", "rec", "card", "attach", "part"):
            self.ensure_editor(rid, who, adder)
        if k == "msg":
            ids = [self.upload(who, n) for n in it["img"]]
            reply = w.msgs.get((key, it["reply"])) if it["reply"] else None
            out = s.post(f"/api/chats/{info['chat']}/messages",
                         {"body": it["text"], "reply_to_id": reply, "attachment_ids": ids})
            if it["key"]:
                w.msgs[(key, it["key"])] = out["id"]
        elif k == "act":
            body = {"title": it["title"], "owner_id": self.api.users[it["owner"]] if it["owner"] else None,
                    "due_date": iso(it["due"]) if it["due"] is not None else None}
            if it["due"] is not None and who not in DEADLINERS:
                s = self.s("kaan")
            det = s.post(f"/api/records/{rid}/actions", body)
            aid = next(a["id"] for a in reversed(det["actions"]) if a["title"] == it["title"])
            w.actions[(key, it["key"])] = aid
            if it["owner"]:
                self._editable.add((rid, it["owner"]))
        elif k == "act_status":
            body = {"field": "status", "value": it["status"]}
            if it["note"]:
                body["closing_note"] = it["note"]
            s.patch(f"/api/actions/{w.actions[(key, it['key'])]}", body)
        elif k == "rec":
            body = {"field": it["field"], "value": it["value"]}
            if it["note"]:
                body["closing_note"] = it["note"]
            s.patch(f"/api/records/{rid}", body)
        elif k == "card":
            data = expand({**it["extra"]})
            det = s.post(f"/api/records/{rid}/cards", {"card_type": it["kind"], "title": it["title"], "data": data})
            cid = next(c["id"] for c in reversed(det["cards"]) if c["data"].get("title") == it["title"])
            w.cards[(key, it["key"])] = cid
        elif k == "attach":
            ids = [self.upload(who, n) for n in it["imgs"]]
            s.post(f"/api/cards/{w.cards[(key, it['key'])]}/attachments", {"attachment_ids": ids})
        elif k == "signup":
            s.put(f"/api/cards/{w.cards[(key, it['key'])]}/signup", {"answer": it["answer"], "note": it["note"]})
        elif k == "vote":
            s.put(f"/api/cards/{w.cards[(key, it['key'])]}/vote", {"options": it["options"], "other": it["other"]})
        elif k == "part":
            s.put(f"/api/records/{rid}/participants/{self.api.users[it['user']]}")
            self._editable.add((rid, it["user"]))
        elif k == "pin":
            s.put(f"/api/records/{rid}/pin")
        elif k == "join":
            s.post(f"/api/records/{rid}/join")

    # --- etkinlikler -------------------------------------------------------------
    def create_event(self, e: Event) -> dict:
        w = self.w
        self.at(*e.at)
        s = self.s(e.owner)
        body = dict(title=e.title, kind_id=w.kind[e.kind], unit_id=w.unit[e.unit], priority=e.priority,
                    description=e.desc)
        if e.date is not None:
            body["date"] = iso(e.date)
        out = s.post("/api/events", body)
        eid, twin = out["id"], out["record_id"]
        det = s.get(f"/api/records/{twin}")
        info = dict(id=eid, twin=twin, chat=det["record"]["chat_id"], owner=e.owner)
        self._editable.add((twin, e.owner))
        w.records[f"event:{e.key}"] = dict(id=twin, chat=info["chat"], owner=e.owner, creator=e.owner)

        def patch(field, value):
            s.patch(f"/api/events/{eid}", {"field": field, "value": value})

        if e.start:
            patch("start_time", e.start)
        if e.place:
            patch("location_id", w.loc[e.place])
        if e.place_text:
            patch("place", e.place_text)
        if e.attendees is not None:
            patch("attendees", e.attendees)
        for who, role in e.people:
            s.put(f"/api/events/{eid}/participants/{self.api.users[who]}", {"role": role})
            self._editable.add((twin, who))
        for t in e.teams:
            s.put(f"/api/events/{eid}/teams/{w.team[t]['id']}")
        # Sablondan gelen ama bu etkinlikte gereksiz widget/adim.
        det = self.s("defne").get(f"/api/events/{eid}")
        for kind in e.widgets_drop:
            wid = next(x["id"] for x in det["widgets"] if x["type"] == kind)
            self.s("defne").delete(f"/api/event-widgets/{wid}")
        for label in e.drop_cp:
            cid = next(x["id"] for x in det["checkpoints"] if x["label"] == label)
            s.delete(f"/api/event-checkpoints/{cid}")
        return info

    def event_followups(self, e: Event, info: dict) -> None:
        """Kayit widget'lari, adimlar, istekler, malzemeler, OTF, durum, sohbet."""
        w, eid = self.w, info["id"]
        s = self.s(e.owner)

        def detail():
            return s.get(f"/api/events/{eid}")

        for rk in e.records:
            rec = w.records[rk]
            r = next((x for x in self._all_recs if x.key == rk), None)
            at = max(order_key(*e.at), order_key(*(r.at if r else e.at)))
            self.at(-at[0], f"{at[1]:02d}:{at[2]:02d}")
            self.c.wait(15)
            s.post(f"/api/events/{eid}/widgets", {"type": "record", "record_id": rec["id"]})
        label_id = lambda label: next(x["id"] for x in detail()["checkpoints"] if x["label"] == label)  # noqa: E731
        for label, d, t, who in sorted(e.done, key=lambda x: order_key(x[1], x[2])):
            self.at(d, t)
            self.s(who).patch(f"/api/event-checkpoints/{label_id(label)}", {"done": True})
        for label, d, t, who, action in e.requests:
            self.at(d, t)
            self.s(who).post(f"/api/event-checkpoints/{label_id(label)}/requests", {"action": action})
        if e.materials:
            self.materials(e, info)
        if e.otf:
            self.otf(e, info)
        if e.status:
            self.at(*(e.status_at or e.at))
            s.patch(f"/api/events/{eid}", {"field": "status", "value": e.status})
        for it in sorted(e.chat, key=lambda x: order_key(x["d"], x["t"])):
            self.at(it["d"], it["t"])
            who = it["who"]
            self.ensure_editor(info["twin"], who, e.owner)
            self.s(who).post(f"/api/chats/{info['chat']}/messages",
                             {"body": it["text"], "reply_to_id": None, "attachment_ids": []})

    def materials(self, e: Event, info: dict) -> None:
        eid = info["id"]
        buyer = self.s("elif")
        base_d = e.at[0]
        self.at(max(base_d - 1, 2), "11:00")
        ids = {}
        for m in e.materials:
            det = buyer.post(f"/api/events/{eid}/materials", {"name": m.name})
            ids[m.name] = next(x["id"] for x in det["materials"] if x["name"] == m.name)
        for i, m in enumerate(e.materials):
            self.at(max(base_d - 2 - i, 2 if e.date and e.date > 0 else 3), "15:00")
            mid = ids[m.name]
            patch = {"type": m.type, "priority": m.priority}
            if m.notes:
                patch["notes"] = m.notes
            if m.sponsor:
                buyer.patch(f"/api/materials/{mid}", {"has_sponsor": True})
            if m.owned:
                patch["owned"] = True
            patch["state"] = m.state
            buyer.patch(f"/api/materials/{mid}", patch)
            for contact, price, arrival in m.providers:
                buyer.post(f"/api/materials/{mid}/providers", {
                    "contact": contact, "price": price,
                    "arrival_date": iso(arrival) if arrival is not None else None})

    def otf(self, e: Event, info: dict) -> None:
        o = e.otf
        self.at(*o["at"])
        body = dict(o["fields"])
        body["items"] = [{"item": k, "quantity": n} for k, n in o["items"]]
        body["contacts"] = [self.api.users[u] for u in o["contacts"]]
        self.s(e.owner).put(f"/api/events/{info['id']}/otf", body)

    # --- takim duvarlari ---------------------------------------------------------
    def wall(self, team: str, d: int, t: str, who: str, text: str, pillar: bool = False) -> None:
        self.at(d, t)
        tid = (self.w.pillar[team]["team_id"] if pillar else self.w.team[team]["id"])
        team_obj = next(x for x in self.s("defne").get("/api/meta")["teams"] if x["id"] == tid)
        self.s(who).post(f"/api/chats/{team_obj['chat_id']}/messages",
                         {"body": text, "reply_to_id": None, "attachment_ids": []})
