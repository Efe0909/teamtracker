# 40 — Web push

Faz 3. Push denemesi yapıldı; kalıcı bulgular burada, deneme günlüğü düştü.

## Bugün hazır olan

- **HTTPS**: cloudflared tüneli veriyor (`deploy/`). Push'un ön şartı.
- **PWA kabuğu**: `GET /manifest.json` (host'a göre `start_url`) + `/sw.js` kök kapsamdan.
- **Service worker girişleri**: `sites/mobil/static/sw.js` içinde `push` ve
  `notificationclick` dinleyicileri yazılı, sunucu tarafı bağlanınca çalışır.

## Eksik olan

1. `push_subscriptions` tablosu (`spec/20-sema.md` §7): `endpoint` tekil, `p256dh`, `auth`,
   `fail_count`, `last_ok_at`.
2. Uçlar: `GET /vapid` (public key), `POST /abone` (subscription kaydı, endpoint'e göre
   tekilleştir), gönderim tarafı.
3. VAPID anahtarları — **`.env`'de kalır, koda gömülmez, repoya girmez**:

```bash
python3 -c "
from py_vapid import Vapid01
v=Vapid01(); v.generate_keys()
open('.env','w').write(f'VAPID_PRIVATE={v.private_pem().decode()}\nVAPID_PUBLIC={v.public_key_urlsafe()}\n')"
```

`vapid_claims` içine `{"sub": "mailto:…"}` zorunlu.

## Denemeden çıkan dersler

- **iOS'ta izin tarayıcıda istenemez.** Sıra: Safari → Paylaş → **Ana Ekrana Ekle** →
  uygulamayı ana ekrandan aç → izin ver. `manifest.json` bu yüzden şart (`display:
  standalone` + en az 192×192 ikon). Android'de Chrome doğrudan çalışır.
- **Ölü abonelik temizliği en sık atlanan şey.** Push servisi `404`/`410` dönerse satırı
  **sil**; başka hatada `fail_count` artır, eşiği geçince sil. Yoksa sunucu ölü adreslere
  gönderim yapmaya devam eder.
- **`tag` alanını kullan.** Aynı tag'li bildirimler üst üste yığılmaz, birbirini günceller —
  "spam etme" derdinin tarayıcı tarafındaki karşılığı.
- `pywebpush`, `http-ece`'ye bağlı; bazı ortamlarda wheel derlemesi patlıyor. Sırayla:
  `pip install -U pip setuptools wheel` → `apt install python3-dev build-essential` →
  saf Python `webpush` ya da Node'un `web-push` CLI'ı.

## Yapma

- Anahtarları koda gömme, repoya koyma.
- Bildirim içeriğine kişisel/hassas veri koyma — push içeriği cihaz kilitliyken ekranda görünür.
- Bildirimi tek gerçek kaynak sanma: bildirim merkezi veritabanındadır, push düşse bile
  kullanıcı uygulamayı açınca hiçbir şey kaçırmaz (`spec/20-sema.md` §6).
