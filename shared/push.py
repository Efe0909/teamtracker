"""Web push gonderimi (spec/40-push.md, Faz 3).

Abonelikler `push_subscriptions` tablosunda (goc 005). Bir kullanicinin
birden fazla aboneligi olur — telefon, dizustu — hepsine gonderilir.

VAPID anahtarlari .env'den gelir, koda GOMULMEZ (spec/40-push.md "Yapma").
Anahtarsiz kurulumda modul sessizce devre disi kalir: `acik()` False doner,
`gonder()` hicbir sey yapmaz. Push olmadan uygulama calismaya devam etmeli.

Olu abonelik temizligi burada, gonderim yolunun ICINDE. Ayri bir bakim isi
degil: spec/40-push.md bunu "en sik atlanan sey" diye isaretliyor, cunku ayri
yazilan temizlik hic yazilmiyor.
"""
from __future__ import annotations

import json

from . import config, db

# Kac ard arda hatadan sonra abonelik silinir. 404/410 zaten aninda siler;
# bu sayac gecici olmayan ama kalici da denemeyen hatalar icin.
HATA_ESIGI = 5

# Bildirim TTL'i: push servisi telefonu bu sure boyunca dener. Uzun tutmanin
# anlami yok — iki gun sonra ulasan "yeni eylem" bildirimi gurultudur.
TTL = 6 * 3600


def acik() -> bool:
    """VAPID anahtarlari tanimli mi — push kurulmus mu?"""
    return bool(config.VAPID_PRIVATE and config.VAPID_PUBLIC)


# --- abonelik ------------------------------------------------------------


def abone_ol(user_id, abonelik: dict, user_agent: str | None = None) -> bool:
    """Tarayicidan gelen PushSubscription'i kaydeder.

    Tekillik endpoint'te: ayni tarayici tekrar abone olursa push servisi ayni
    endpoint'i verir. O yuzden upsert — yoksa benzersizlik hatasi alinir ve
    kullanici "abone olamiyorum" der.

    Sahibi de guncellenir: ortak bir cihazda baska biri giris yaparsa
    bildirimler yeni kullaniciya gitmeli, eskisine degil.
    """
    uc = (abonelik or {}).get("endpoint")
    anahtarlar = (abonelik or {}).get("keys") or {}
    p256dh, auth_ = anahtarlar.get("p256dh"), anahtarlar.get("auth")
    if not uc or not p256dh or not auth_:
        return False

    db.x("insert into push_subscriptions (id,user_id,endpoint,p256dh,auth,user_agent,created_at)"
         " values (%s,%s,%s,%s,%s,%s,%s)"
         " on conflict (endpoint) do update set"
         "   user_id = excluded.user_id, p256dh = excluded.p256dh,"
         "   auth = excluded.auth, user_agent = excluded.user_agent,"
         "   fail_count = 0",
         (db.new_id(), db.uid(user_id), uc, p256dh, auth_, user_agent, db.now()))
    return True


def abone_sil(endpoint: str) -> None:
    db.x("delete from push_subscriptions where endpoint = %s", (endpoint,))


def abonelikler(user_ids) -> list[dict]:
    kimlikler = [db.uid(k) for k in user_ids if db.uid(k) is not None]
    if not kimlikler:
        return []
    return db.q("select * from push_subscriptions where user_id = any(%s)", (kimlikler,))


# --- gonderim ------------------------------------------------------------


def gonder(user_ids, baslik: str, govde: str, url: str | None = None,
           tag: str | None = None) -> dict:
    """Verilen kullanicilarin TUM cihazlarina bildirim yollar.

    `tag`: ayni tag'li bildirimler telefonda ust uste yigilmaz, birbirini
    gunceller (spec/40-push.md). Kart bildirimlerinde kart kimligi verilirse
    bir kart icin tek satir gorunur.

    Doner: {"gonderildi": n, "silinen": n, "hata": n}
    """
    if not acik():
        return {"gonderildi": 0, "silinen": 0, "hata": 0}

    # '/m' SABIT YAZILMAZ: alt alan adinda mobil yuz kokte duruyor
    # (config.mobil_yol, KNOW-49). Gomulseydi adres cubuguna sizar ve onek
    # kaldirildigi gun bildirimler 404'e goturuyor olurdu.
    if url is None:
        url = config.mobil_yol("/")

    from pywebpush import WebPushException, webpush   # ic import: push kapaliyken

    veri = json.dumps({"title": baslik, "body": govde, "url": url, "tag": tag})
    gonderildi = silinen = hata = 0

    for satir in abonelikler(user_ids):
        bilgi = {"endpoint": satir["endpoint"],
                 "keys": {"p256dh": satir["p256dh"], "auth": satir["auth"]}}
        try:
            webpush(subscription_info=bilgi, data=veri,
                    vapid_private_key=config.VAPID_PRIVATE,
                    vapid_claims={"sub": config.VAPID_SUB}, ttl=TTL)
        except WebPushException as e:
            kod = getattr(e.response, "status_code", None)
            # 404/410: push servisi bu aboneligi KALICI olarak dusurdu, bir
            # daha calismayacak — sil.
            #
            # 401/403 ile karistirma: o VAPID imzasinin gecersiz oldugu
            # anlamina gelir, yani abonelik degil KURULUM bozuktur ve satiri
            # silmek hatayi gizler. (PoC raporundaki en pahali ders: FCM olu
            # endpoint icin 404 donuyor, 401 degil.)
            if kod in (404, 410):
                abone_sil(satir["endpoint"])
                silinen += 1
            else:
                hata += 1
                db.x("update push_subscriptions set fail_count = fail_count + 1"
                     " where endpoint = %s", (satir["endpoint"],))
                if satir["fail_count"] + 1 >= HATA_ESIGI:
                    abone_sil(satir["endpoint"])
                    silinen += 1
        except Exception:
            # Ag hatasi, DNS, zaman asimi: abonelik saglam olabilir, dokunma.
            hata += 1
        else:
            gonderildi += 1
            db.x("update push_subscriptions set last_ok_at = %s, fail_count = 0"
                 " where endpoint = %s", (db.now(), satir["endpoint"]))

    return {"gonderildi": gonderildi, "silinen": silinen, "hata": hata}
