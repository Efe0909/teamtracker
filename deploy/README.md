# deploy/ — üç ortam

Bu dizin artık **elle kurulum** anlatmıyor. Makine yapılandırması ayrı bir depoda
(`~/nix`, github:Efe0909/nix) ve **reproducible**: nginx, systemd birimi, sırlar,
tünel — hepsi orada Nix ifadesi olarak duruyor. Buradaki dosyalar yalnızca
uygulamanın kendi sözleşmesini (konteyner yığını, medya dizini, tünel/Access
ayarları) tarif eder.

| Ortam | Nerede | Ne çalıştırır |
|---|---|---|
| **Yerel geliştirme** | bu depo | Docker'da Postgres + `cargo run` + `npm run dev` (sahte kimlik) |
| **VM testi** | `~/nix` → `.#vmtest` | gerçek NixOS, gerçek nginx/cloudflared/Google girişi |
| **Üretim** | `~/nix` → `.#evsunucu` | Raspberry Pi, aynı yapılandırma |

VM testi ile üretim **aynı** `configuration.nix`'i paylaşır; fark yalnızca
Pi'ye özgü donanım modülü (device tree, bootloader) ve hangi modüllerin import
edildiği. Yani VM'de geçen bir şey Pi'de de büyük ölçüde geçer — kasıtlı.

---

## 1. Yerel geliştirme (ajan oturumları dahil)

Kökteki `README.md` → "Çalıştır" (Rust API + Vite). Arşivdeki Python (alpha-0.1)
`references/python/` içinden `make up` ile kalkar.

---

## 2. VM testi (NixOS)

> Bu bölüm ve §3 alpha-0.1'in Docker yığınını anlatır (`~/nix` `.#teamtracker0.1`,
> `e02d71d`'ye pinli). 0.2 yayın akışı: kökteki `README.md` → "Yayına alma".

Yapılandırma `~/nix`'te. Uygulamanın sürümü **flake input** olarak pinli, yani
VM'de shell açıp `git pull` yapılmaz:

```bash
cd ~/nix
nix flake update teamtracker          # teamtracker'ı main'in ucuna al
git commit -am "teamtracker: <sha>"   # kilit dosyası commit edilir
nixos-rebuild switch --flake .#vmtest # VM'de (ya da --target-host ile uzaktan)
```

`~/nix`'te bu iş için duran modüller:

| modül | ne yapar |
|---|---|
| `modules/ekiptakip-app.nix` | agenix sırrı + `docker compose` yığınını koşan systemd birimi |
| `modules/ekiptakip-media.nix` | medya dizini (uid 10001), `EKIPTAKIP_MEDIA_DIR`, `RequiresMountsFor` |
| `modules/nginx/ekiptakip.nix` | iki vhost, `127.0.0.1:8000`'e proxy, `real_ip` |
| `modules/cloudflared.nix` | tünel |

`modules/ekiptakip-media.nix`'in **kaynağı bu depodadır**:
[`nix-ekiptakip-media.nix`](../references/python/deploy/nix-ekiptakip-media.nix). Depolar ayrı olduğu için
kopyalanarak taşınıyor — burada değiştirirsen `~/nix`'e de taşımayı unutma
(iki kopya sessizce ayrışırsa belirti üretimde çıkar).

---

## 3. Üretim (Raspberry Pi)

Aynı akış, farklı hedef:

```bash
nixos-rebuild switch --flake .#evsunucu --target-host efe@evsunucu --use-remote-sudo
```

Pi'de shell açmak gerekmiyor; gerekiyorsa bir yerde declarative olmayan bir şey
var demektir.

Zincir her iki hedefte de aynı:

```
telefon ──https──> Cloudflare ──tünel──> cloudflared ──> nginx :80 ──> uvicorn 127.0.0.1:8000
                    (TLS burada biter)                   (server_name)   (--workers 1)
```

`--workers 1` **şart**: ağaç indeksi (`TreeIndex`) süreç belleğinde tutuluyor.
İkinci bir işçi kendi bayat ağacıyla kalır.

---

## Dış servisler

Rust API yapılandırması NixOS secrets/env üzerinden sağlanır; anahtarlar loglanmaz.

| Değişken | Kullanım | Varsayılan / kapalı davranış |
|---|---|---|
| `OPENROUTER_API_KEY` | Kalite denetimi | Yoksa karar servisi kapalı; uzunluk kuralları sürer |
Gizli olmayan ayarlar şifreli ortam dosyasında DEĞİL, `backend/manifest.json`'da:

| Alan | Kullanım |
|---|---|
| `version` | Uygulama sürümü (`/api/meta.version`); `Cargo.toml` ve `frontend/package.json` ile aynı olmak zorunda, test denetler |
| `contact_email` | Geliştirici e-postası (`/api/meta.contact_email`, web push `sub` varsayılanı) |
| `external_off` | `decision`, `resend`, `push` listesi ya da `["all"]`; bilinmeyen ad açılışı durdurur |
| `decision_model` | OpenRouter model adı |

Varsayılan, ikiliye gömülü kopya. Yeniden derlemeden değiştirmek için `services.ekiptakip.manifest = ./manifest.json;` (aynı biçimde dosya, `~/nix`'te) — `EKIPTAKIP_MANIFEST` olarak verilir. Kapalı servisler `/api/meta.external_off` ile istemciye bildirilir. Kayıt metinlerinin OpenRouter'a gönderilmesi KVKK aktarım değerlendirmesi gerektirir; kalite denetimini kapatmak için manifestte `"external_off": ["decision"]` yaz. Bkz. `spec/76-bilgi-yogunlugu.md`.

## Devamı

- [`DOCKER.md`](../references/python/deploy/DOCKER.md) — (0.1) konteyner yığını, agenix sırları, medya dizini,
  günlük işler (`docker compose` komutları).
- [`cloudflare-dashboard.md`](cloudflare-dashboard.md) — tünel panelden
  yönetiliyorsa public hostname + Access politikası.
- `spec/70-guvenlik.md` — tehdit modeli, kimlik, CSRF, denetim izi.

## Bu kurulumun kapatmadıkları

- **Medya yedeklenmiyor.** `services.restic.backups` `/home/efe/sata`'yı hariç
  tutuyor, ekler de orada. Disk arızası her görseli götürür ve Postgres yedeği
  var olmayan dosyalara işaret eden satırları sağlam tutar.
- **Cloudflare Access AÇIK DEĞİL** (2026-09-10'da doğrulandı: public hostname'e
  giden istek Access'e değil, doğrudan uygulamaya düşüyor — `curl` ile bakınca
  401 gövdesi `giriş gerekli`, yani `LoginGate`; `cf-access-*` başlığı yok).

  Bu bir zamanlar **bloke edici** bir eksikti: uygulamanın kendi kimliği yokken
  (`uid` çerezi imzasız, CSRF yok) Access dışarısıyla açık uygulama arasındaki
  tek şeydi. Artık öyle değil — Google girişi, davetli listesi, imzalı oturum,
  CSRF kapısı ve giriş hız sınırı var. Access bugün **ek katman**, tek kapı değil.

  Yine de kapalı olmasının bedeli var: kimliksiz trafik origin'e ulaşıyor, yani
  herkes `/login`'i yoklayabiliyor, hız sınırı bütçesini yiyebiliyor, ve
  uygulamada ileride çıkacak bir kimlik hatası doğrudan internete açık oluyor.
  Açmaya karar verirsen: [`cloudflare-dashboard.md`](cloudflare-dashboard.md) §3.
