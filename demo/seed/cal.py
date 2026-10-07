"""Hikayenin takvimi: "bugun"e gore hesaplanan tarihler ve metin yer tutuculari.

Hikaye her gun kosulabilsin diye etkinlik tarihleri sabit degil, BUGUNE gore bir hafta
gunune oturtulur (atolye hep Cumartesi, Maker Fest hep Cuma...). Metinlerdeki tarihler de
buradan gelir; boylece afis, sohbet, checkpoint ve OTF son gunu hep ayni gunu soyler.

Yer tutucular (`fmt`):
    {D+3}  {D-20}   bugunden N gun sonrasi/oncesi: "9 Ekim"
    {W+2}           haftanin gunu: "Persembe"
    {DW+2}          ikisi: "8 Ekim Persembe"
    {D:e1} {W:e1} {DW:e1}   capa (anchor) etkinligin tarihi; `{D:e2+7}` bir hafta sonrasi
    {OTF:e1}        etkinlikten en gec 3 is gunu once (hafta sonu sayilmaz): "14 Ekim Carsamba"
    {OTFp:e1}       ondan bir is gunu once (pay birakilan gun)
    {WEEK:e2}       etkinligin haftasi, Pazartesi-Cuma: "2-6 Kasim"
"""

from __future__ import annotations

import datetime as dt
import re

from client import TZ

MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]


def today() -> dt.date:
    return dt.datetime.now(TZ).date()


def day(n: int) -> dt.date:
    return today() + dt.timedelta(days=n)


def on_or_after(n: int, weekday: int) -> int:
    """`n`. gunden sonra gelen ilk `weekday` (0=Pazartesi) gununun bugunden farki."""
    return n + (weekday - day(n).weekday()) % 7


class A:
    """Capa etkinliklerin bugunden gun farki."""
    e1 = on_or_after(9, 5)    # Arduino atolyesi: en erken 9 gun sonra, Cumartesi
    e2 = on_or_after(28, 4)   # Maker Fest: en erken 4 hafta sonra, Cuma
    e3 = on_or_after(19, 1)   # Gebze gezisi: Sali
    e4 = on_or_after(1, 3)    # Haftalik koordinasyon: Persembe


def _dm(d: dt.date) -> str:
    return f"{d.day} {MONTHS[d.month - 1]}"


def _dw(d: dt.date) -> str:
    return f"{_dm(d)} {DAYS[d.weekday()]}"


def _otf(d: dt.date, extra: int = 0) -> dt.date:
    """Etkinlikten 3 is gunu once (+ `extra` is gunu daha once)."""
    n = 0
    while n < 3 + extra:
        d -= dt.timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return d


_PAT = re.compile(r"\{(D|W|DW|OTF|OTFp|WEEK)(?::([a-z0-9]+))?([+-]\d+)?\}")


def _resolve(kind: str, anchor: str | None, delta: str | None) -> str:
    base = getattr(A, anchor) if anchor else 0
    d = day(base + (int(delta) if delta else 0))
    if kind == "D":
        return _dm(d)
    if kind == "W":
        return DAYS[d.weekday()]
    if kind == "DW":
        return _dw(d)
    if kind == "OTF":
        return _dw(_otf(d))
    if kind == "OTFp":
        return _dw(_otf(d, 1))
    mon = d - dt.timedelta(days=d.weekday())
    fri = mon + dt.timedelta(days=4)
    if mon.month == fri.month:
        return f"{mon.day}-{fri.day} {MONTHS[fri.month - 1]}"
    return f"{_dm(mon)} - {_dm(fri)}"


def fmt(value):
    """Metin, liste ya da sozlukteki butun yer tutuculari doldurur."""
    if isinstance(value, str):
        return _PAT.sub(lambda m: _resolve(m.group(1), m.group(2), m.group(3)), value) if "{" in value else value
    if isinstance(value, list):
        return [fmt(v) for v in value]
    if isinstance(value, dict):
        return {k: fmt(v) for k, v in value.items()}
    return value
