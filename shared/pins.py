"""Sol raya sabitlenen modüller — kişi başına (goc 012, user_pins).

Ray eskiden UC SABIT baglanti tasiyordu; MODULES'e eklenen ekran oraya hic
girmiyordu. Hangi ekranin elinin altinda duracagi kuruluma degil KISIYE ait
bir tercih, o yuzden tabloda ve kullanici basina.

slug FK DEGIL: modul listesi kodda (sites/dashboard/routes.MODULES), tablosu
yok. Gecersiz slug'a karsi koruma yazma tarafinda — cagiran gecerli slug
kumesini verir, burasi veritabanina uydurma satir yazmaz.
"""
from __future__ import annotations

from . import db

# Hic pini olmayan kullanici icin ray: bugunku davranis. Bos kume "hepsini
# kaldirdim" ile karistirilmasin diye ilk degisiklikte varsayilanlar
# MADDELESTIRILIR (toggle icinde) — ondan sonra bos gercekten bostur.
DEFAULTS = ("tasks", "teams")


def slugs(user_id) -> list[str]:
    uid = db.uid(user_id)
    if uid is None:
        return list(DEFAULTS)
    rows = db.q("select slug from user_pins where user_id = %s order by pinned_at", (uid,))
    return [r["slug"] for r in rows] if rows else list(DEFAULTS)


def _materialize(uid) -> None:
    """Ilk degisiklikte varsayilanlari satira cevirir.

    Olmasaydi "Gorev Yoneticisi'ni kaldir" istegi hicbir sey yapmazdi: silinecek
    satir yok, okuma da bos kumeyi varsayilana geri cevirirdi.
    """
    if db.q1("select 1 from user_pins where user_id = %s", (uid,)) is not None:
        return
    for slug in DEFAULTS:
        db.x("insert into user_pins (user_id, slug, pinned_at) values (%s,%s,%s)"
             " on conflict do nothing", (uid, slug, db.now()))


def toggle(user_id, slug: str, valid: set[str]) -> bool:
    """Pinliyse birakir, degilse sabitler. Doner: yeni durum (pinli mi)."""
    uid = db.uid(user_id)
    if uid is None or slug not in valid:
        return False
    _materialize(uid)
    if db.q1("select 1 from user_pins where user_id = %s and slug = %s", (uid, slug)):
        db.x("delete from user_pins where user_id = %s and slug = %s", (uid, slug))
        return False
    db.x("insert into user_pins (user_id, slug, pinned_at) values (%s,%s,%s)",
         (uid, slug, db.now()))
    return True
