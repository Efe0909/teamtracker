# EkipTakip — ajanlar için proje notları

## Şu anki dağıtım: GEÇİCİ, Efe'nin Mac'inde

Kalıcı ev Raspberry Pi. Bugün oraya kurulmadı; alpha-0.1 **geçici olarak macOS'ta**
ayakta. Bunu bilerek yaz/oku — `deploy/` altındaki Linux şablonları bu makinede
çalışmaz.

```
telefon ──https──> Cloudflare ──tünel "temp"──> cloudflared (root, --token)
         ──> nginx :8080 ──> uvicorn 127.0.0.1:8000
```

| Parça | Bu makinede | Şablonun varsaydığı |
|---|---|---|
| nginx | Homebrew, `Efe` kullanıcısı, config `/opt/homebrew/etc/nginx/servers/ekiptakip.conf` → repoya **symlink** | `/etc/nginx/sites-available`, `sudo` |
| Servis yöneticisi | **Yok.** uvicorn elle, arka planda bir kabuktan | systemd (`deploy/ekiptakip.service`) |
| Tünel | **Uzaktan yönetimli** — `~/.cloudflared/` içinde yalnızca `cert.pem`, `config.yml` yok; ingress panelde | yerel `config.yml` (`deploy/cloudflared-ornek.yml`) |
| Kullanılan conf | `deploy/nginx-ekiptakip.macos.conf` + `-ortak.macos.conf` | `deploy/nginx-ekiptakip.conf` |

Alan adları (zon `polonyum.com`, push demosuyla ortak):

- `app.polonyum.com` → mobil, kökte (`/`, `/ara`, `/eylemler`); `/gorevler` **404**, kasten
- `dashboard.polonyum.com` → masaüstü
- bilinmeyen Host → `444` (`default_server` bloğu)

Uvicorn bu üç değişken olmadan tek alan adı moduna düşer (`/m`):

```bash
EKIPTAKIP_HOST_APP=app.polonyum.com \
EKIPTAKIP_HOST_DASHBOARD=dashboard.polonyum.com \
EKIPTAKIP_COOKIE_DOMAIN=.polonyum.com \
  .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1
```

### Bu geçiciliğin sonuçları

- **Uvicorn kalıcı değil.** Oturum kapanınca/makine uyuyunca gider. launchd plist yok
  (systemd biriminin darwin karşılığı yazılmadı).
- **8080 push demosuyla paylaşılıyor** (`~/projects/push`, `push.polonyum.com` → 5001).
  O bloğa dokunma. `listen 8080` wildcard kalmalı — `listen 127.0.0.1:8080` yazılırsa
  nginx aynı portta ikinci socket'e açılmaz.
- `servers/` alfabetik yükleniyor (`ekiptakip.conf` < `push.polonyum.conf`), bu yüzden
  varsayılan sunucu **açıkça** tanımlı; kaldırma.
- Pi'ye taşınırken: `deploy/kur.sh` + Linux şablonları zaten hazır, `.macos.conf` ikilisi
  orada kullanılmaz.

### Ayakta mı, nasıl bakılır

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: app.polonyum.com'       http://127.0.0.1:8080/
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: dashboard.polonyum.com' http://127.0.0.1:8080/
nginx -t && ps aux | grep [u]vicorn
```

## Kapı — kapatılmadan yayına açma

Uygulamanın kendi kimlik doğrulaması **yok**: `uid` çerezi imzasız, CSRF yok
(README "Bilgi güvenliği"). Dışarı açılan hostname'in önünde Cloudflare Access
politikası olmalı; public hostname ile Access'i peş peşe kur, arada bırakma.
`auth_basic` satırları `-ortak.macos.conf` içinde yorumda duruyor — Access
kullanılmayacaksa onlar açılır.

## Faz durumu

alpha-0.1 = Faz 1 (hiyerarşi, kayıtlar, kart içi sohbet, alan değişiklikleri) + mobil yüz.
Faz 2 (Google OAuth) gelene kadar kimlik sahte; `auth.current_user` tek değişecek yer.
