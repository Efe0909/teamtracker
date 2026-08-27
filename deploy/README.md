# deploy/ — cloudflared + nginx ile yayına alma

Zincir:

```
telefon ──https──> Cloudflare ──tünel──> cloudflared ──> nginx 127.0.0.1:8080 ──> uvicorn 127.0.0.1:8000
                    (TLS burada biter)                    (kapı + statik)          (--workers 1)
```

Uygulama **hiçbir zaman** 0.0.0.0'a bağlanmaz; dışarıya çıkan tek şey tünel.

## Önce: kapı meselesi

alpha-0.1'in kendi kimlik doğrulaması **yok** (README "Bilgi güvenliği"). `uid` çerezi
imzasız, CSRF koruması yok. Tünelden verirken önüne bir kapı koymazsan adresi bilen herkes
her kaydı düzenler. İki seçenek:

**A) Cloudflare Access (önerilen).** Zero Trust → Access → Applications → Self-hosted,
hostname `ekiptakip.efeatcali.com`, policy: `Emails` = ekibin adresleri. Tünelin önünde
durur, uygulamaya hiç dokunmazsın; kişi bazlı, log tutar, parola paylaşmazsın.
Kurduysan `nginx-ekiptakip.conf` içindeki `auth_basic` iki satırını yorum yap.

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

`deploy/olusan/cloudflared-ornek.yml` içindeki ingress bloğunu kendi
`~/.cloudflared/config.yml` dosyana ekle — **`service: http_status:404` en altta kalsın**,
altına kural yazarsan çalışmaz. Sonra:

```bash
cloudflared tunnel route dns <tunel-adi> ekiptakip.efeatcali.com
sudo systemctl restart cloudflared
curl -su efe -o /dev/null -w '%{http_code}\n' https://ekiptakip.efeatcali.com/m   # 200
```

Telefonda `https://ekiptakip.efeatcali.com/m` → Safari → **Paylaş → Ana Ekrana Ekle**.

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
