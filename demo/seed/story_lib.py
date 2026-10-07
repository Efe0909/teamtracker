"""Hikaye yazimi icin kucuk sozluk: kayit/etkinlik akisindaki olaylar.

Her olayin ilk iki alani SANAL ZAMAN: (kac gun once, "SS:DD") — UTC saati. Ayni kaydin
olaylari kronolojik yazilmali; kosucu bunu dogrular (yanlis sira = yazim hatasi).
"""

from __future__ import annotations

from dataclasses import dataclass, field


def msg(d, t, who, text, key=None, reply=None, img=()):
    return dict(d=d, t=t, k="msg", who=who, text=text, key=key, reply=reply, img=list(img))


def act(d, t, who, title, owner=None, due=None, key=None):
    """Eylem ekle. `due`: bugunden gun farki (eksi = gecikmis)."""
    return dict(d=d, t=t, k="act", who=who, title=title, owner=owner, due=due, key=key)


def done(d, t, who, key, note):
    return dict(d=d, t=t, k="act_status", who=who, key=key, status="closed", note=note)


def prog(d, t, who, key, status="in_progress"):
    return dict(d=d, t=t, k="act_status", who=who, key=key, status=status, note=None)


def rec(d, t, who, field_, value, note=None):
    """Kayit alani degistir (status, priority, owner_id, due_date...)."""
    return dict(d=d, t=t, k="rec", who=who, field=field_, value=value, note=note)


def card(d, t, who, kind, title, data=None, key=None, **extra):
    return dict(d=d, t=t, k="card", who=who, kind=kind, title=title, data=data or {}, key=key, extra=extra)


def attach(d, t, who, key, imgs):
    return dict(d=d, t=t, k="attach", who=who, key=key, imgs=list(imgs))


def signup(d, t, who, key, answer, note=None):
    return dict(d=d, t=t, k="signup", who=who, key=key, answer=answer, note=note)


def vote(d, t, who, key, options=(), other=None):
    return dict(d=d, t=t, k="vote", who=who, key=key, options=list(options), other=other)


def part(d, t, who, user):
    return dict(d=d, t=t, k="part", who=who, user=user)


def pin(d, t, who):
    return dict(d=d, t=t, k="pin", who=who)


def join(d, t, who):
    return dict(d=d, t=t, k="join", who=who)


@dataclass
class Rec:
    key: str
    unit: str
    kind: str                   # issue | task
    title: str
    desc: str
    owner: str | None
    creator: str
    priority: str
    at: tuple                   # (gun_once, "SS:DD")
    due: int | None = None      # bugunden gun farki
    team: str | None = None
    pillar: str | None = None
    access: str = "public"
    items: list = field(default_factory=list)


@dataclass
class Material:
    name: str
    type: str                   # consumable | equipment | service
    priority: str
    state: int
    notes: str | None = None
    sponsor: bool = False
    owned: bool = False
    # (iletisim, fiyat, varis: bugunden gun farki ya da None)
    providers: list = field(default_factory=list)


@dataclass
class Event:
    key: str
    title: str
    kind: str                   # Etkinlik Turleri'ndeki ad
    unit: str
    desc: str
    owner: str
    at: tuple
    date: int | None = None     # bugunden gun farki; None = havuz
    start: str | None = None
    place: str | None = None    # Etkinlik Yerleri'nden ad
    place_text: str | None = None   # kampus disi serbest metin
    attendees: int | None = None
    priority: str = "medium"
    status: str | None = None   # None = sunucunun varsayilani (tarih varsa planning)
    people: list = field(default_factory=list)      # (kisi, rol)
    teams: list = field(default_factory=list)
    records: list = field(default_factory=list)     # kayit widget'lari (Rec.key)
    done: list = field(default_factory=list)        # (etiket, d, t, kim): tamamlanan adimlar
    materials: list = field(default_factory=list)
    chat: list = field(default_factory=list)        # msg(...) olaylari (ikiz kaydin sohbeti)
    otf: dict | None = None
    widgets_drop: list = field(default_factory=list)
    drop_cp: list = field(default_factory=list)     # silinen adimlar (etiket)
    requests: list = field(default_factory=list)    # (etiket, d, t, kim, eylem): bekleyen onay istegi
    status_at: tuple | None = None                  # (d, t): durum degisiminin zamani
