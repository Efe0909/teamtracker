# deploy/ — üç ortam

Bu dizin artık **elle kurulum** anlatmıyor. Makine yapılandırması ayrı bir depoda
(`~/nix`, github:Efe0909/nix) ve **reproducible**: nginx, systemd birimi, sırlar,
tünel — hepsi orada Nix ifadesi olarak duruyor. Buradaki dosyalar yalnızca
uygulamanın kendi sözleşmesini (konteyner yığını, medya dizini, tünel/Access
ayarları) tarif eder.

| Ortam | Nerede | Ne çalıştırır |
|---|---|---|
| **Yerel geliştirme** | bu depo | `make up` — Docker'da Postgres + uvicorn (sahte kimlik) |
| **VM testi** | `~/nix` → `.#vmtest` | gerçek NixOS, gerçek nginx/cloudflared/Google girişi |
| **Üretim** | `~/nix` → `.#evsunucu` | Raspberry Pi, aynı yapılandırma |

VM testi ile üretim **aynı** `configuration.nix`'i paylaşır; fark yalnızca
Pi'ye özgü donanım modülü (device tree, bootloader) ve hangi modüllerin import
edildiği. Yani VM'de geçen bir şey Pi'de de büyük ölçüde geçer — kasıtlı.

---

## 1. Yerel geliştirme (ajan oturumları dahil)

Tek komut yeter; Postgres Docker'da kalkar, şema göçleri açılışta kendiliğinden
koşar, tohum verisi yazılır ve sunucu `--reload` ile başlar:

```bash
make up
```

Sonra: <http://localhost:8000> (masaüstü) ve <http://app.localhost:8000> (mobil).
Ayrım **Host başlığının ilk etiketine** bakar — yol öneki yoktur, `/m` diye bir
şey yoktur.

Kimlik **sahte**: `EKIPTAKIP_AUTH=sahte`, giriş ekranı yok, ilk kullanıcı olarak
çalışırsın. Ray'deki avatardan kullanıcı değiştirebilirsin (yalnız geliştirmede).

Parça parça çalıştırmak istersen:

```bash
make setup      # .venv + bağımlılıklar (idempotent)
make db-ac      # yalnız Postgres (veri kalır)
make seed       # tohum — VAROLAN VERİYİ SİLER
make dev        # sunucu, --reload
make test       # pytest (gerçek Postgres'e karşı, kendi test veritabanları)
make db-kapat   # Postgres'i durdur (veri kalır)
```

Veritabanını komple silmek: `docker compose down -v`.

**Ajan oturumları için notlar**

- `make test` gerçek Postgres ister — `make db-ac` çalışmıyorsa testler toplanma
  aşamasında patlar. Docker açık mı, önce ona bak.
- Testler `ekiptakip_test_<modul>` adında **kendi** veritabanlarını kurar; ana
  `ekiptakip` veritabanına dokunmazlar. Yani `make seed` testleri etkilemez.
- Gerçek Google girişini yerelde denemek genelde **gereksiz**: `EKIPTAKIP_AUTH=sahte`
  ile bütün yetki yolları (admin, scope, rol) zaten sınanabiliyor. Gerçekten
  gerekiyorsa `tests/test_real_identity.py` kalıbına bak — imzalı oturum çerezini
  taklit ediyor, OAuth'a hiç çıkmıyor.
- Yeni bağımlılık `requirements.txt`'e girer (tek kaynak; Makefile ve Dockerfile
  ikisi de onu okur). Kurmak: `uv pip install --python .venv/bin/python -r requirements-dev.txt`.
- Yeni göç `shared/migrations/` altına numaralı dosya olarak; açılışta kendiliğinden
  koşar, elle `alter table` yok.

---

## 2. VM testi (NixOS)

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
[`nix-ekiptakip-media.nix`](nix-ekiptakip-media.nix). Depolar ayrı olduğu için
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

## Devamı

- [`DOCKER.md`](DOCKER.md) — konteyner yığını, agenix sırları, medya dizini,
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
