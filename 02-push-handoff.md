# Handoff: Web Push denemesi (Python)

**Amaç:** Efe'nin telefonuna gerçek bir push bildirimi düşürmek. Uygulama yok, mağaza yok, üçüncü parti servis yok — bildirim doğrudan bizim sunucudan çıkacak.

Bu bir deneme/ispat işi. Kalıcı ürün değil, "çalışıyor" görmek için.

---

## Kısıtlar

- **Python** kullan. Makinede Go tooling olmayabilir.
- **HTTPS zorunlu.** Web Push, `localhost` dışında HTTPS olmadan çalışmaz. Telefon `localhost` olmadığı için tünel ya da gerçek sunucu şart.
- Domain var: **efeatcali.com** — ama A kaydı muhtemelen tanımlı değil. Önce `dig +short efeatcali.com` ile kontrol et.

---

## Yapı

```
push-demo/
  app.py            # Flask sunucu: sayfa + abonelik kaydı + gönderim
  static/
    index.html      # izin iste, abone ol
    sw.js           # service worker — bildirimi gösteren kısım
    manifest.json   # PWA manifesti (iOS için şart)
  subs.json         # abonelikler (gitignore)
  .env              # VAPID anahtarları (gitignore)
```

## Bağımlılıklar

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install flask pywebpush
```

> **Uyarı:** `pywebpush`, `http-ece` paketine bağlı ve bazı ortamlarda wheel derlemesi patlıyor
> (bende patladı). Patlarsa sırayla dene:
> 1. `pip install --upgrade pip setuptools wheel` sonra tekrar
> 2. `apt install python3-dev build-essential` (derleme araçları eksikse)
> 3. Son çare: `pywebpush` yerine `webpush` (saf Python alternatifi) ya da Node'un `web-push` CLI'ı
>
> Bu adımda takılırsan devam etme, hangi hatayı aldığını raporla.

## VAPID anahtarları

```bash
python3 -c "
from py_vapid import Vapid01
v=Vapid01(); v.generate_keys()
open('.env','w').write(f'VAPID_PRIVATE={v.private_pem().decode()}\nVAPID_PUBLIC={v.public_key_urlsafe()}\n')
print('ok')
"
```

Public key tarayıcıya gider, private key **asla**. `.env` ve `subs.json` dosyalarını `.gitignore`'a ekle.

---

## Uçlar (endpoint)

| Uç | İş |
|---|---|
| `GET /` | sayfayı ver |
| `GET /vapid` | public key'i JSON döndür |
| `POST /subscribe` | tarayıcıdan gelen subscription objesini `subs.json`'a ekle (endpoint'e göre tekilleştir) |
| `POST /send` | kayıtlı tüm aboneliklere push gönder, body: `{"title":"...","body":"..."}` |

`/send` içinde `pywebpush.webpush(...)` çağrısı; `vapid_claims` içine `{"sub": "mailto:kadirefeatcali@gmail.com"}` koy — bu alan zorunlu.

**Ölü abonelik temizliği:** push servisi `404` veya `410` dönerse o aboneliği `subs.json`'dan sil. Bu gerçek hayatta en sık atlanan şey.

---

## Service worker

`sw.js` iki olayı dinlemeli:

- `push` → `self.registration.showNotification(title, {body, icon, tag, data})`
- `notificationclick` → bildirimi kapat, ilgili sayfayı aç/odakla

`tag` alanını kullan: aynı tag'li bildirimler üst üste yığılmaz, birbirini günceller. Bizim "spam etme" derdimizin tarayıcı tarafındaki karşılığı bu.

---

## HTTPS — iki yol

**A) Hızlı yol, domain gerekmez (bunu öner):**
```bash
cloudflared tunnel --url http://localhost:5000
```
Rastgele bir `*.trycloudflare.com` adresi verir. Anında HTTPS. Adres geçici, kapatınca gider — deneme için yeterli.

**B) Kalıcı yol, efeatcali.com ile:**
Sunucu bir VPS'te olacaksa A kaydını o IP'ye yönlendir, önüne Caddy koy — sertifikayı kendi alır:
```
push.efeatcali.com {
    reverse_proxy localhost:5000
}
```
DNS yayılması birkaç dakika sürebilir. Bilgisayar kendi makinesiyse B yolu zaten uygun değil, A'yı kullan.

---

## Telefonda test

**Android (Chrome):** adresi aç → "İzin ver" → bitti. Tarayıcıdan doğrudan çalışır.

**iPhone (Safari):** izin isteme butonu tarayıcıda çalışmaz. Sırası:
1. Safari'de adresi aç
2. Paylaş → **Ana Ekrana Ekle**
3. Uygulamayı **ana ekrandan** aç
4. İzin ver

Bu yüzden `manifest.json` şart: `name`, `short_name`, `start_url`, `display: "standalone"`, en az bir 192x192 ikon.

---

## Kabul kriteri

Telefon ekranı kilitliyken, terminalden:

```bash
curl -X POST https://<adres>/send \
  -H 'Content-Type: application/json' \
  -d '{"title":"EkipTakip","body":"Bütçe onayı 6 gündür bekliyor"}'
```

Bildirim kilit ekranında görünüyorsa iş bitti. Bildirime dokununca sayfa açılmalı.

---

## Raporla

Bittiğinde şunları söyle:
- Hangi HTTPS yolunu kullandın, adres ne
- `pywebpush` kurulumunda sorun çıktı mı
- Android mı iPhone mu test edildi, bildirim kilit ekranında göründü mü
- Ölü abonelik temizliği test edildi mi (aboneliği iptal edip tekrar gönder)

## Yapma

- Anahtarları koda gömme, repoya koyma
- Abonelikleri veritabanına taşımaya çalışma — `subs.json` bu deneme için yeterli
- Bildirim içeriğine kişisel/hassas veri koyma; push içeriği cihaz kilitliyken ekranda görünür
