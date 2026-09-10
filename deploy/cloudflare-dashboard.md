# Tünel dashboard'dan yönetiliyorsa

Cloudflare tünelini panelden yönetiyorsan (kurulum `cloudflared ... --token ...` ile
yapıldıysa) **yerel `config.yml` yok sayılır** — ingress kurallarını Cloudflare
tutar; aşağıdaki adımları izle.

NixOS kurulumunda tünel `~/nix/modules/cloudflared.nix` ile tanımlı
(`services.cloudflared`, kimlik bilgisi agenix sırrında). Hangi moddasın:

```bash
systemctl cat cloudflared | grep ExecStart
#   ... --token ey...        -> UZAKTAN yönetiliyor (bu dosya)
#   ... run <tunel-adi>      -> YEREL ingress (modules/cloudflared.nix içinde)
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

**Durum (2026-09-10): Access AÇIK DEĞİL.** Public hostname'e giden istek Access'e
takılmıyor, doğrudan uygulamaya düşüyor (`curl -I https://dashboard.polonyum.com/`
→ 401 `giriş gerekli`, yani uygulamanın `LoginGate`'i; `cf-access-*` başlığı yok).

Bu bölüm bir zamanlar **zorunluydu**: uygulamanın kendi kimliği yokken kapı
gerçekten tek kapıydı. Artık Google girişi + davetli listesi + CSRF + imzalı
oturum var, yani Access **ek katman**. Açmanın getirisi: kimliksiz trafik
origin'e hiç ulaşmaz (hız sınırı yoklanamaz, ileride çıkacak bir kimlik hatası
internete açık olmaz).

## 4. Doğrulama

Access açıkken `curl` giriş sayfasına yönlenir — bu **beklenen** davranış, hata değil.
Tarayıcıdan doğrula:

- `https://app.polonyum.com` → Access girişi → yapılacaklar listesi
- `https://dashboard.polonyum.com` → Access girişi → ana sayfa

Zincirin alt katmanlarını yine yerelden bakabilirsin (tünelden bağımsız):

```bash
curl -s -H "Host: app.polonyum.com"       http://127.0.0.1:8080/         -o /dev/null -w '%{http_code}\n'
curl -s -H "Host: dashboard.polonyum.com" http://127.0.0.1:8080/tasks -o /dev/null -w '%{http_code}\n'
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
