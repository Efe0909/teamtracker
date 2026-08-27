# Tünel dashboard'dan yönetiliyorsa

Cloudflare tünelini panelden yönetiyorsan (kurulum `cloudflared ... --token ...` ile
yapıldıysa) **yerel `~/.cloudflared/config.yml` yok sayılır** — ingress kurallarını
Cloudflare tutar. Bu durumda `deploy/cloudflared-ornek.yml`'ye dokunma, aşağıdaki
adımları izle.

Hangi moddasın:

```bash
systemctl cat cloudflared | grep ExecStart
#   ... --token ey...        -> UZAKTAN yönetiliyor (bu dosya)
#   ... run <tunel-adi>      -> YEREL config.yml (deploy/cloudflared-ornek.yml)
```

## 1. İki public hostname ekle

Zero Trust paneli → **Networks → Tunnels** (bazı hesaplarda Access → Tunnels) → tünelini
seç → **Public Hostname** sekmesi → **Add a public hostname**. İkisini de ekle:

| Alan | Mobil | Masaüstü |
|---|---|---|
| Subdomain | `app` | `dashboard` |
| Domain | `polonyum.com` | `polonyum.com` |
| Path | *(boş)* | *(boş)* |
| Type | `HTTP` | `HTTP` |
| URL | `127.0.0.1:8080` | `127.0.0.1:8080` |

İkisi de **nginx'e** gider (uygulamanın 8000'ine değil); ayrımı nginx `server_name` yapar.

**DNS kaydını panel kendisi açar** — `cloudflared tunnel route dns` çalıştırmana gerek yok.

## 2. Host başlığını DEĞİŞTİRME

Her hostname'in altında **Additional application settings → HTTP Settings → HTTP Host
Header** alanı var. **Boş bırak.** Doldurursan Host başlığı sabitlenir, nginx iki alan
adını ayıramaz, ikisi de aynı bloğa düşer.

## 3. Kapı: Access (panelden, önerilen)

Zero Trust → **Access → Applications → Add an application → Self-hosted**:

- Application domain: `app.polonyum.com` — sonra aynısını `dashboard.polonyum.com` için tekrarla
- Policy: **Allow**, Include → **Emails** → ekibin adresleri
- **Session Duration**: uzun tut (ör. 1 ay). Kısa olursa telefondaki ana ekran
  uygulaması sürekli giriş ekranı gösterir.

İki alan adına **ayrı politika** yazabilirsin — dashboard'u yalnızca kendine açmak gibi.
Uygulamanın kendi kimliği yok, kapı gerçekten kapı.

Access'i kurduğunda nginx'teki basic auth'a gerek kalmaz:
`/etc/nginx/snippets/ekiptakip-ortak.conf` içindeki `auth_basic` iki satırını yorum yap,
`sudo nginx -t && sudo systemctl reload nginx`.

## 4. Doğrulama

Access açıkken `curl` giriş sayfasına yönlenir — bu **beklenen** davranış, hata değil.
Tarayıcıdan doğrula:

- `https://app.polonyum.com` → Access girişi → yapılacaklar listesi
- `https://dashboard.polonyum.com` → Access girişi → ana sayfa

Zincirin alt katmanlarını yine yerelden bakabilirsin (tünelden bağımsız):

```bash
curl -s -H "Host: app.polonyum.com"       http://127.0.0.1:8080/         -o /dev/null -w '%{http_code}\n'
curl -s -H "Host: dashboard.polonyum.com" http://127.0.0.1:8080/gorevler -o /dev/null -w '%{http_code}\n'
curl -s -H "Host: rastgele.host"          http://127.0.0.1:8080/         -o /dev/null -w '%{http_code}\n'   # 000 = 444, doğru
```

(basic auth hâlâ açıksa bunlar 401 döner — `-u kullanici:parola` ekle.)

## Sık takılınan yer

| Belirti | Sebep |
|---|---|
| İki alan adı da aynı sayfayı gösteriyor | HTTP Host Header dolu — boşalt |
| `502 Bad Gateway` | nginx ayakta ama uygulama değil: `systemctl status ekiptakip` |
| `530` / `1033` | tünel bağlı değil: `systemctl status cloudflared` |
| Panelde eklediğin hostname çalışmıyor | tünel token'ı başka bir tünele ait; `cloudflared tunnel list` |
| Telefonda sürekli giriş soruyor | Access Session Duration kısa — uzat |
| Ana ekran uygulaması boş açılıyor | `start_url` yanlış: `curl https://app.polonyum.com/manifest.json` → `"/"` olmalı |
