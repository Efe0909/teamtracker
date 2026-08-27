# deploy/ — cloudflared + nginx ile yayına alma

Zincir:

```
telefon ──https──> Cloudflare ──tünel──> cloudflared ──> nginx 127.0.0.1:8080 ──> uvicorn 127.0.0.1:8000
                    (TLS burada biter)   (catch-all)      (server_name ile ayrım)   (--workers 1)
```

Uygulama **hiçbir zaman** 0.0.0.0'a bağlanmaz; dışarıya çıkan tek şey tünel.

## İki alan adı

| Alan adı | Ne servis eder | Yollar |
|---|---|---|
| `app.polonyum.com` | mobil site, **kökte** | `/`, `/ara`, `/eylemler`, `/bildirimler`, `/kayit/{id}`, `/yeni` |
| `dashboard.polonyum.com` | masaüstü | `/` (ana sayfa), `/gorevler`, modül sayfaları |

Ayrımı nginx `server_name` ile yapar; uygulama `Host` başlığına bakıp mobil siteyi kökte
servis eder. Bunun için systemd biriminde üç değişken var:

```ini
Environment=EKIPTAKIP_HOST_APP=app.polonyum.com
Environment=EKIPTAKIP_HOST_DASHBOARD=dashboard.polonyum.com
Environment=EKIPTAKIP_COOKIE_DOMAIN=.polonyum.com
```

Boş bırakırsan tek alan adı modunda çalışır (`/m` ve `/gorevler`) — yerelde `make dev`
böyle çalışıyor, testler ikisini de kapsıyor.

Üç ayrıntı, üçü de kasıtlı:

- **Masaüstü sayfaları `app` alan adından erişilemez** (`/gorevler` → 404). İki alan adına
  ayrı Cloudflare Access politikası yazabilesin diye; yoksa dashboard'a koyduğun sıkı
  politikayı `app` üzerinden dolanmak mümkün olurdu.
- **Çerez `.polonyum.com`'a yazılır**, yoksa kimlik iki alt alan adında ayrı ayrı seçilir.
- **`manifest.json` uygulamadan üretilir**, statik dosya değil: `start_url` `app` alan
  adında `/`, tek alan adı modunda `/m`. Yanlış `start_url` ana ekrandaki uygulamayı boş
  sayfaya açar.

## Önce: kapı meselesi

alpha-0.1'in kendi kimlik doğrulaması **yok** (README "Bilgi güvenliği"). `uid` çerezi
imzasız, CSRF koruması yok. Tünelden verirken önüne bir kapı koymazsan adresi bilen herkes
her kaydı düzenler. İki seçenek:

**A) Cloudflare Access (önerilen).** Zero Trust → Access → Applications → Self-hosted,
hostname `app.polonyum.com` (ve ayrıca `dashboard.polonyum.com`), policy: `Emails` =
ekibin adresleri. İki alan adına ayrı politika yazabilirsin — örneğin dashboard yalnızca
yöneticilere. Tünelin önünde
durur, uygulamaya hiç dokunmazsın; kişi bazlı, log tutar, parola paylaşmazsın.
Kurduysan `nginx-ekiptakip-ortak.conf` içindeki `auth_basic` iki satırını yorum yap.

**B) Basic auth (hızlı).** Tek parola, herkes aynı. `htpasswd` ile kurulur (aşağıda).
Perimetre kapanır ama **kimlik değildir**: içeri giren kişi rayın altındaki listeden
istediği kullanıcıya geçebilir. Faz 2'de Google OAuth gelince ikisi de kalkar.

## Adımlar

`deploy/kur.sh` şablonlardaki yolları bu makineye göre değiştirip `deploy/olusan/`
altına yazar — sistem dosyalarına dokunmaz, kopyalama komutlarını ekrana basar:

```bash
bash deploy/kur.sh                       # varsayılan: repo yolu, $USER, 8000/8080
HOSTNAME_=ekiptakip.efeatcali.com PORT_APP=8000 PORT_NGINX=8080 bash deploy/kur.sh
```

Sonra sırayla:

**1. Uygulama**

```bash
make setup && make seed                  # veritabanı yoksa (VAROLANI SİLER — bkz. aşağı)
sudo cp deploy/olusan/ekiptakip.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ekiptakip
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/m        # 200
```

`--workers 1` şart: ağaç indeksi süreç belleğinde (00-BASLA.md Karar 2). İkinci worker
açarsan iki farklı ağaç indeksi oluşur ve yetki kontrolü tutarsızlaşır.

**2. nginx + kapı**

```bash
sudo htpasswd -c /etc/nginx/.htpasswd-ekiptakip efe      # (B) seçtiysen
sudo cp deploy/olusan/nginx-ekiptakip.conf /etc/nginx/sites-available/ekiptakip
sudo ln -sf /etc/nginx/sites-available/ekiptakip /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
curl -s   -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/m       # 401
curl -su efe -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/m    # 200
```

**3. Tünel**

İki yol var, ikisi de çalışır:

- **Catch-all** (en son kural `- service: http://127.0.0.1:8080`, hostname'siz): tünele
  düşen her isim nginx'e gider, ayrımı `server_name` yapar. **Mevcut kuralların
  (push denemesi vb.) catch-all'ın ÜSTÜNDE kalsın**, altındaki her şeyi yutar.
- **Açık isim**: `app` ve `dashboard` için ayrı `hostname:` kuralları, en altta
  `- service: http_status:404`.

**`originRequest.httpHostHeader` KOYMA.** Host başlığını sabitlersen nginx alan adlarını
ayıramaz, ikisi de aynı bloğa düşer.

DNS'i iki isim için de ekle (proxy'li wildcard kayıt plana göre değişiyor, bu garanti):

```bash
cloudflared tunnel route dns <tunel-adi> app.polonyum.com
cloudflared tunnel route dns <tunel-adi> dashboard.polonyum.com
sudo systemctl restart cloudflared
curl -su efe -o /dev/null -w '%{http_code}\n' https://app.polonyum.com/         # 200
curl -su efe -o /dev/null -w '%{http_code}\n' https://dashboard.polonyum.com/   # 200
```

nginx'te `default_server` bloğu bilinmeyen host'u `444` ile kapatıyor — catch-all
kullanırken bu şart, yoksa tünele düşen rastgele bir isim uygulamayı açar.

Telefonda `https://app.polonyum.com` → Safari → **Paylaş → Ana Ekrana Ekle**.

## Güncelleme

```bash
git pull && make setup                   # bağımlılık değiştiyse
sudo systemctl restart ekiptakip
```

`sw.js` değiştiyse telefondaki uygulama bir sonraki açılışta yeni sürümü alır
(nginx onu `no-store` ile servis ediyor). Takılırsa: uygulamayı kapat-aç, olmadı
ana ekrandan silip yeniden ekle.

## Yedek

Veritabanı tek dosya: `ekiptakip.db`. Kopyalayan her şeyi alır — yedeği de erişimi de
buna göre ayarla. Çalışırken `cp` ile değil, `.backup` ile al:

```bash
sqlite3 ekiptakip.db ".backup '/yedek/ekiptakip-$(date +%F).db'"
```

Günlük yedek için crontab (`crontab -e`):

```
15 3 * * * cd /home/efe/projects/teamtracker && sqlite3 ekiptakip.db ".backup '/yedek/ekiptakip-$(date +\%F).db'"
```

**`make seed` / `make reseed` varolan veritabanını siler.** Yayındaki makinede
çalıştırma; `make dev` yerine `systemctl restart ekiptakip` kullan.

## Push (Faz 3)

Tünel HTTPS verdiği için web push'un ön şartı karşılandı: iOS'ta web push **yalnızca
ana ekrana eklenmiş** sitede çalışır, o yüzden önce `/m`'yi ekletmek gerekiyor.
`static/sw.js` içinde `push` ve `notificationclick` girişleri hazır. Eksik olan sunucu
tarafı: `push_subscriptions` tablosu (01-sema.md §7) + VAPID anahtarları. Anahtarlar
`.env`'de kalır, koda gömülmez (02-push-handoff.md).

## Bu kurulumun kapatmadıkları

| Konu | Durum |
|---|---|
| Kimlik | Kapıdan sonra hâlâ sahte: içeri giren istediği kullanıcıya geçebilir → Faz 2 OAuth |
| CSRF | Yok. Kapı olduğu sürece saldırı yüzeyi dar, ama açık kapanmadı → Faz 2 |
| Hız sınırlama | Yok. Gerekirse nginx `limit_req` |
| Denetim izi | Alan değişiklikleri `events`'e yazılır; okuma erişimi loglanmaz |

CSP `unsafe-eval` içermiyor; şablonlar da `hx-on=` kullanmıyor (htmx onu `new Function`
ile derler, CSP engeller). Şablonlara `hx-on=` eklersen bu kurulumda **sessizce çalışmaz** —
davranışı `templates/base.html` ve `templates/mobile/base.html` içindeki delege
dinleyicilere yaz.
