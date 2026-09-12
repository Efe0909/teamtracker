"""Sohbette anma: @kisi, @all, @here, @team.

AYRI BIR SOHBET TABLOSU YOK — mesaj bir `events` satiridir
(`event_type='message'`, `subject_type` ∈ item/team/node). Anma da ayri bir
tablo acmaz: govdedeki metinden okunur, kime gidecegi HER SEFERINDE kaynagindan
(katilimci kumesi) hesaplanir. Ikinci bir gercek olsaydi, biri kartan cikinca
eski anma satiri onu pinglemeye devam ederdi.

## Kime gider

Her sohbetin bir KATILIMCI KUMESI var:

    kart sohbeti   -> item_participants
    takim duvari   -> team_members

GRUP ANMALARI BU KUMENIN DISINA CIKMAZ. "@all" bir kartta 40 kisilik sirkete
degil, o kartin katilimcilarina gider; "@here" onlarin son 10 dakikada
gorulenlerine; "@team" kartin takiminin uyelerine (ve yine kume iceriyle
kesisir).

`@kisi` AYRI bir sey: acik niyet. Kart sohbetinde adi yazilan kisi kumenin
disindaysa KUMEYE ALINIR, sonra pinglenir — kumeye girmenin baska yolu yok
(katilimci ekleme arayuzu yok, KNOW-130'daki "mail forward" modeli). Takim
duvarinda ise uyelik baska yerden yonetilir; oraya kendiliginden uye
yazilmaz, uye olmayanin anmasi sessizce metinde kalir.

## Bildirim

Anma TEK olaydan dogar (KNOW-238): mesajin kendi `events` satiri hem uygulama
ici bildirimi (mobile_notifs katilimci uzerinden okur) hem push'u besler.
Ayri bir "bildirim motoru" kurulmadi.
"""
from __future__ import annotations

import re
from datetime import timedelta

from . import attachments, config, db, push

# Grup anahtarlari — kullanicinin yazdigi bicim Turkce degil, Ingilizce
# (CLAUDE.md "Kod dili": bunlar ekranda gorunen METIN degil, anahtar).
GROUPS = ("all", "here", "team")

# "@here" esigi: cevrimici esigi (auth.ONLINE_THRESHOLD, 2 dk) DEGIL. Nokta
# "su an ekranda mi", @here "bugun bu isin basinda mi" sorusunu soruyor.
HERE_WINDOW = timedelta(minutes=10)

# @ + harf/rakam/nokta/alt cizgi/tire. Unicode: "@Efe" kadar "@Ayşe" de
# yakalanmali; eslesme sonra slug'a katlanarak yapiliyor.
_TOKEN = re.compile(r"@([\w.\-]+)", re.UNICODE)


def handle(name: str) -> str:
    """Kullanici adindan anma anahtari: 'Ahmet Yılmaz' -> 'ahmet-yilmaz'.

    attachments.slugify ile AYNI katlama — Turkce I/i tuzagi orada bir kez
    cozuldu, ikinci bir kopyasi olmasin.
    """
    return attachments.slugify(name or "")


def tokens(body: str) -> list[str]:
    """Govdedeki anma anahtarlari, yazilis sirasinda, tekrarsiz."""
    seen, out = set(), []
    for raw in _TOKEN.findall(body or ""):
        key = raw.lower() if raw.lower() in GROUPS else handle(raw)
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return out


# --- katilimci kumesi ------------------------------------------------------


def audience(subject_type: str, subject_id) -> list[dict]:
    """Bu sohbetin katilimcilari (yalniz aktif kullanicilar), TEK sorgu."""
    id_ = db.uid(subject_id)
    if id_ is None:
        return []
    if subject_type == "item":
        return db.q("select u.* from item_participants p join users u on u.id = p.user_id"
                    " where p.item_id = %s and u.is_active order by u.name", (id_,))
    if subject_type == "team":
        return db.q("select u.* from team_members m join users u on u.id = m.user_id"
                    " where m.team_id = %s and u.is_active order by u.name", (id_,))
    return []


def join(item_id, user_id, added_by=None) -> None:
    """Kisiyi kart sohbetine katilimci yapar. Zaten varsa dokunmaz."""
    db.x("insert into item_participants (item_id,user_id,added_by,added_at)"
         " values (%s,%s,%s,%s) on conflict do nothing",
         (db.uid(item_id), db.uid(user_id), db.uid(added_by) if added_by else None, db.now()))


def _is_here(u) -> bool:
    seen = u.get("last_seen_at")
    return seen is not None and db.now() - seen < HERE_WINDOW


# --- cozumleme -------------------------------------------------------------


def resolve(subject_type: str, subject_id, body: str, author, *, item=None) -> set:
    """Anilan KULLANICI KIMLIKLERI. Yazanin kendisi daima elenir.

    item: kart sohbetinde `@team` icin gerekli (kaydin takimi). Takim
    duvarinda `@team` zaten `@all` ile ayni kumeyi verir.

    YAN ETKI (bilincli): kart sohbetinde `@kisi` ile anilan kisi katilimci
    kumesine yazilir. Cozumleme saf degil cunku "anmak" burada davet etmek
    demek; ayri bir "karta ekle" ucu yok.
    """
    keys = tokens(body)
    if not keys:
        return set()

    people = audience(subject_type, subject_id)
    by_handle = {handle(u["name"]): u for u in people}
    targets: dict = {}

    for key in keys:
        if key == "all":
            targets.update({u["id"]: u for u in people})
        elif key == "here":
            targets.update({u["id"]: u for u in people if _is_here(u)})
        elif key == "team":
            team_id = item["team_id"] if item else (subject_id if subject_type == "team" else None)
            if team_id is None:
                continue
            in_team = {r["user_id"] for r in db.q(
                "select user_id from team_members where team_id = %s", (db.uid(team_id),))}
            targets.update({u["id"]: u for u in people if u["id"] in in_team})
        elif key in by_handle:
            targets[by_handle[key]["id"]] = by_handle[key]
        elif subject_type == "item":
            # Kume disindan bir kisi: ACIK niyet, davet sayilir (bkz. modul
            # basligi). Bulunamayan ad sessizce metinde kalir.
            row = _by_handle(key)
            if row is not None:
                join(subject_id, row["id"], author["id"] if author else None)
                targets[row["id"]] = row

    targets.pop(author["id"] if author else None, None)
    return set(targets)


def _by_handle(key: str) -> dict | None:
    """Anahtari tum aktif kullanicilar icinde arar. Slug hesabi Python'da:
    SQL tarafinda Turkce katlamasinin ayni sonucu verecegi garanti degil
    (attachments.slugify'daki I/i tuzagi)."""
    for u in db.q("select * from users where is_active"):
        if handle(u["name"]) == key:
            return u
    return None


# --- bildirim --------------------------------------------------------------


def notify(user_ids, author, body: str, *, title: str, url: str, tag: str) -> dict:
    """Anilanlara push. Uygulama ici bildirim AYRICA uretilmez: mesajin kendi
    events satiri onu zaten besliyor (KNOW-238)."""
    ids = [i for i in user_ids if i is not None]
    if not ids or not push.enabled():
        return {"sent": 0, "removed": 0, "failed": 0}
    text = (body or "").strip().replace("\n", " ")
    if len(text) > 120:
        text = text[:117] + "…"
    who = author["name"] if author else "Biri"
    return push.send(ids, title, f"{who}: {text}", url, tag)


def mention_url(subject_type: str, subject_id) -> str:
    """Bildirime tiklayinca gidilecek yer — mobil yuzun KOKU (config.mobile_path):
    yol oneki koda gomulmez (TODO.md 'Kural: mobil arayuz kendi alan adinda')."""
    if subject_type == "item":
        return config.mobile_path(f"/record/{subject_id}")
    return config.mobile_path("/")
