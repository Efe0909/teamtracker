"""Web push gonderimi (spec/40-push.md, Faz 3).

Abonelikler `push_subscriptions` tablosunda (goc 005). Bir kullanicinin
birden fazla aboneligi olur — telefon, dizustu — hepsine gonderilir.

VAPID anahtarlari .env'den gelir, koda GOMULMEZ (spec/40-push.md "Yapma").
Anahtarsiz kurulumda modul sessizce devre disi kalir: `enabled()` False doner,
`send()` hicbir sey yapmaz. Push olmadan uygulama calismaya devam etmeli.

Olu abonelik temizligi burada, gonderim yolunun ICINDE. Ayri bir bakim isi
degil: spec/40-push.md bunu "en sik atlanan sey" diye isaretliyor, cunku ayri
yazilan temizlik hic yazilmiyor.
"""
from __future__ import annotations

import json

from . import config, db

# Kac ard arda hatadan sonra abonelik silinir. 404/410 zaten aninda siler;
# bu sayac gecici olmayan ama kalici da denemeyen hatalar icin.
FAIL_THRESHOLD = 5

# Bildirim TTL'i: push servisi telefonu bu sure boyunca dener. Uzun tutmanin
# anlami yok — iki gun sonra ulasan "yeni eylem" bildirimi gurultudur.
TTL = 6 * 3600


def enabled() -> bool:
    """VAPID anahtarlari tanimli mi — push kurulmus mu?"""
    return bool(config.VAPID_PRIVATE and config.VAPID_PUBLIC)


# --- abonelik ------------------------------------------------------------


def subscribe(user_id, subscription: dict, user_agent: str | None = None) -> bool:
    """Tarayicidan gelen PushSubscription'i kaydeder.

    Tekillik endpoint'te: ayni tarayici tekrar abone olursa push servisi ayni
    endpoint'i verir. O yuzden upsert — yoksa benzersizlik hatasi alinir ve
    kullanici "abone olamiyorum" der.

    Sahibi de guncellenir: ortak bir cihazda baska biri giris yaparsa
    bildirimler yeni kullaniciya gitmeli, eskisine degil.
    """
    endpoint = (subscription or {}).get("endpoint")
    keys = (subscription or {}).get("keys") or {}
    p256dh, auth_ = keys.get("p256dh"), keys.get("auth")
    if not endpoint or not p256dh or not auth_:
        return False

    db.x("insert into push_subscriptions (id,user_id,endpoint,p256dh,auth,user_agent,created_at)"
         " values (%s,%s,%s,%s,%s,%s,%s)"
         " on conflict (endpoint) do update set"
         "   user_id = excluded.user_id, p256dh = excluded.p256dh,"
         "   auth = excluded.auth, user_agent = excluded.user_agent,"
         "   fail_count = 0",
         (db.new_id(), db.uid(user_id), endpoint, p256dh, auth_, user_agent, db.now()))
    return True


def unsubscribe(endpoint: str) -> None:
    db.x("delete from push_subscriptions where endpoint = %s", (endpoint,))


# --- bildirim tercihi (goc 013) -------------------------------------------
#
# Kademeler users.notify_level'da, kisi basina TEK deger. Suzme send()'in
# ICINDE: gonderim yolunun tek kapisi orasi, cagiranlarin her biri ayrica
# kontrol etseydi biri unuturdu ve "kapattim ama geliyor" olurdu.

NOTIFY_LEVELS: dict[str, str] = {
    "all": "Her hareket — kartlarımdaki her şey",
    "mentions": "Yalnızca anıldığımda (@adım, @all, @here, @team)",
    "none": "Hiçbiri — bildirim gönderme",
}
DEFAULT_LEVEL = "all"


def valid_level(level: str) -> bool:
    return level in NOTIFY_LEVELS


def set_notify_level(user_id, level: str) -> bool:
    """Kisinin varsayilan bildirim tercihi. Gecersiz deger YAZILMAZ."""
    if not valid_level(level):
        return False
    db.x("update users set notify_level = %s where id = %s", (level, db.uid(user_id)))
    return True


def notify_level(user) -> str:
    """Sozlukte olmayan (elle bozulmus) deger varsayilana duser — bilinmeyen bir
    kademe yuzunden kimse sessizce susturulmasin."""
    level = (user or {}).get("notify_level") or DEFAULT_LEVEL
    return level if valid_level(level) else DEFAULT_LEVEL


def _wants(user_ids, kind: str) -> list:
    """Bu bildirimi isteyen kullanicilar. TEK sorgu, gonderimden once."""
    ids = [db.uid(k) for k in user_ids if db.uid(k) is not None]
    if not ids:
        return []
    rows = db.q("select id, notify_level from users where id = any(%s)", (ids,))
    out = []
    for r in rows:
        level = notify_level(r)
        if level == "none":
            continue
        if level == "mentions" and kind != "mention":
            continue
        out.append(r["id"])
    return out


def subscriptions(user_ids) -> list[dict]:
    ids = [db.uid(k) for k in user_ids if db.uid(k) is not None]
    if not ids:
        return []
    return db.q("select * from push_subscriptions where user_id = any(%s)", (ids,))


# --- gonderim ------------------------------------------------------------


def send(user_ids, title: str, body: str, url: str | None = None,
         tag: str | None = None, kind: str = "mention") -> dict:
    """Verilen kullanicilarin TUM cihazlarina bildirim yollar.

    `tag`: ayni tag'li bildirimler telefonda ust uste yigilmaz, birbirini
    gunceller (spec/40-push.md). Kart bildirimlerinde kart kimligi verilirse
    bir kart icin tek satir gorunur.

    `kind`: bildirimin turu — kisinin tercihiyle (users.notify_level, goc 013)
    burada karsilastirilir. Varsayilan "mention" cunku bugun push'u ureten tek
    yol anma (mentions.notify); baska bir tur eklendiginde cagiran onu ACIKCA
    vermeli, yoksa "yalnizca anildigimda" diyen kisiye de gider.

    Doner: {"sent": n, "removed": n, "failed": n}
    """
    if not enabled():
        return {"sent": 0, "removed": 0, "failed": 0}

    user_ids = _wants(user_ids, kind)
    if not user_ids:
        return {"sent": 0, "removed": 0, "failed": 0}

    # Yol oneki SABIT YAZILMAZ: mobil yuz kendi alan adinda kokte duruyor
    # (config.mobile_path). Gomulseydi bildirimler yanlis adrese goturuyor olurdu.
    if url is None:
        url = config.mobile_path("/")

    from pywebpush import WebPushException, webpush   # ic import: push kapaliyken

    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    sent = removed = failed = 0

    for row in subscriptions(user_ids):
        info = {"endpoint": row["endpoint"],
                "keys": {"p256dh": row["p256dh"], "auth": row["auth"]}}
        try:
            webpush(subscription_info=info, data=payload,
                    vapid_private_key=config.VAPID_PRIVATE,
                    vapid_claims={"sub": config.VAPID_SUB}, ttl=TTL)
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            # 404/410: push servisi bu aboneligi KALICI olarak dusurdu, bir
            # daha calismayacak — sil.
            #
            # 401/403 ile karistirma: o VAPID imzasinin gecersiz oldugu
            # anlamina gelir, yani abonelik degil KURULUM bozuktur ve satiri
            # silmek hatayi gizler. (PoC raporundaki en pahali ders: FCM olu
            # endpoint icin 404 donuyor, 401 degil.)
            if code in (404, 410):
                unsubscribe(row["endpoint"])
                removed += 1
            else:
                failed += 1
                db.x("update push_subscriptions set fail_count = fail_count + 1"
                     " where endpoint = %s", (row["endpoint"],))
                if row["fail_count"] + 1 >= FAIL_THRESHOLD:
                    unsubscribe(row["endpoint"])
                    removed += 1
        except Exception:
            # Ag hatasi, DNS, zaman asimi: abonelik saglam olabilir, dokunma.
            failed += 1
        else:
            sent += 1
            db.x("update push_subscriptions set last_ok_at = %s, fail_count = 0"
                 " where endpoint = %s", (db.now(), row["endpoint"]))

    return {"sent": sent, "removed": removed, "failed": failed}
