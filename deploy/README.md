# deploy/ — üç ortam

Bu dizin artık **elle kurulum** anlatmıyor. Makine yapılandırması ayrı bir depoda
(`~/nix`, github:Efe0909/nix) ve **reproducible**: nginx, systemd birimi, sırlar,
tünel — hepsi orada Nix ifadesi olarak duruyor. Buradaki dosyalar yalnızca
uygulamanın kendi sözleşmesini (konteyner yığını, medya dizini, tünel/Access
ayarları) tarif eder.

| Ortam | Nerede | Ne çalıştırır |
|---|---|---|
| **Yerel geliştirme** | bu depo | `make up` — Docker'da Postgres + uvicorn (sahte kimlik) |
| **VM testi** | `~/nix` → `.#teamtracker0.1` / `.#teamtracker0.2` | aynı VM (192.168.64.8), iki sürüm; gerçek nginx/cloudflared/Google girişi |
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

## 2. VM testi (NixOS) — iki sürüm, bir VM

`~/nix` aynı VM için **iki** yapılandırma tanımlar; ortak taban (`vmSystem`:
configuration, cli, vm-test, cloudflared, cloudflare-dns) aynı, fark yalnız
EkipTakip sürümü:

| hedef | ne | girdi | pin |
|---|---|---|---|
| `.#teamtracker0.1` | Python + Docker compose | `teamtracker-alpha01` (`flake = false`) | commit URL'de: `e02d71d` (PR #32, Rust'tan önceki son main). `nix flake update` oynatmaz |
| `.#teamtracker0.2` | Rust API + React (statik) | `teamtracker-alpha02` (flake, `main`) | `flake.lock` + depodaki `deploy/release.nix` (GitHub release) |

VM'de (`~/nix` GitHub'dan https ile klonlu, giriş yok, yalnız pull):

```bash
cd ~/nix && git pull
sudo nixos-rebuild switch --flake .#teamtracker0.2   # ya da .#teamtracker0.1
systemctl show ekiptakip -p Description              # hangisi çalışıyor
sudo nixos-rebuild switch --rollback                 # son geçişi geri al
```

Geçiş saniyeler sürer: **VM derleme yapmaz.** 0.2'nin ikilisi + ön yüzü Mac'te
derlenip GitHub release'e yüklenir (`backend/tools/release.sh`); VM yalnız
yapılandırma dosyalarını kurar, paketi release'ten indirir. 0.1'in Docker imajı
önbellekte; ilk açılışta sağlık yoklaması ~30 sn.

Yeni 0.2 sürümü:

```bash
backend/tools/release.sh                           # Mac, temiz ağaç: derle + yükle + deploy/release.nix
git commit -am "release: <tag>" && git push        # PR → main
cd ~/nix && nix flake update teamtracker-alpha02 && git commit -am "alpha02: <tag>" && git push
# VM: git pull + switch
```

### Veri: iki ayrı veritabanı

- 0.1: Docker volume'deki Postgres (compose). 0.2: makinenin kendi Postgres'i
  (`services.postgresql`, `/var/lib/postgresql`, unix soketi + peer, parola yok).
- Geçiş hiçbirini silmez; eşitlenmezler. 0.2'ye kullanıcı/ağaç/takım/rol **bir kez**
  `backend/tools/import_v1.sh` ile taşındı (2026-09-22; iş kayıtları, sohbet, ek
  taşınmadı). Sonraki 0.1 değişiklikleri 0.2'ye geçmez.
- Oturumlar sürümler arası geçmez (çerez adı aynı, biçim farklı): geçişten sonra
  yeniden giriş.

### Sırlar ve DNS

- agenix alıcıları (`~/nix/secrets/secrets.nix`): `admin` (native age,
  `~/.config/age/keys.txt`), `adminSsh` (Mac `~/.ssh/id_ed25519`, `agenix -e` `-i`'siz
  çalışsın diye), `vmtest`. Alıcı eklenince: `agenix -r -i ~/.config/age/keys.txt`.
- `ekiptakip-env.age`: `GOOGLE_CLIENT_ID/SECRET`, `EKIPTAKIP_SECRET_KEY`, host adları,
  `EKIPTAKIP_COOKIE_DOMAIN=.polonyum.com`. İki sürüm aynı dosyayı okur; 0.2 fazlalığı
  (`POSTGRES_PASSWORD`, `APP_PORT`) yok sayar. **`DATABASE_URL` koyma**: systemd
  `EnvironmentFile` modülün değerini ezer.
- DNS **deklaratif**: `modules/cloudflare-dns.nix` tünel ingress listesindeki her
  host için kaydı `<tünel>.cfargotunnel.com` CNAME'ine getirir (her switch'te).
  Token: `secrets/cloudflare-dns-token.age` (Zone:DNS:Edit, yalnız `polonyum.com`).
  Yeni host = `modules/cloudflared.nix` ingress'ine bir satır; panelde tıklama yok.
- Google OAuth istemcisi (konsol, elle): yönlendirme adresleri
  `https://app.polonyum.com/login/callback`, `https://dashboard.polonyum.com/login/callback`
  (0.1) ve `https://polonyum.com/api/auth/callback` (0.2). Alt alan adı `/api/auth/callback`
  adresleri **eklenmez** — 0.2'de giriş yalnız apex'ten (TASK-297).

### Tuzaklar (hepsi yaşandı)

- `redirect_uri_mismatch` (Google 400): konsolda adres kayıtlı değil, **Kaydet'e
  basılmamış** ya da başka OAuth istemcisi düzenlenmiş. Uygulamanın gönderdiğini gör:
  `curl -s -o /dev/null -w '%{redirect_url}' 'https://polonyum.com/api/auth/google?next=app'`.
  Google'ın kabul ettiğini girişsiz sına: o adresi `curl -L` ile aç, `redirect_uri_mismatch` ara.
- `Configuration(EmptyHost)` (açılışta, 0.2): `postgresql://ekiptakip@/…` biçimi sqlx'te
  patlar; `postgresql:///ekiptakip?host=/run/postgresql&user=ekiptakip` kullan.
- Konsolda iki CSP hatası (`static.cloudflareinsights.com`, satır içi betik): Cloudflare
  Web Analytics sayfaya betik enjekte ediyor, CSP (`script-src 'self'`) engelliyor.
  İşlev etkilenmez; istenirse Cloudflare panelinden kapatılır.
- nginx `add_header` kalıtımı: bir location'da tek `add_header` sunucu seviyesindekileri
  siler. Bu yüzden CSP her location'da ayrı (`modules/nginx/ekiptakip-alpha02.nix`).
- `evsunucu` (Pi) bugün değerlendirilemiyor: `attribute 'buildDTBs' missing`
  (raspberry-pi-nix ↔ nixpkgs pini). Pi dağıtımı ayrı iş.

## 3. Üretim (Raspberry Pi)

Aynı akış, farklı hedef:

```bash
nixos-rebuild switch --flake .#evsunucu --target-host efe@evsunucu --use-remote-sudo
```

Pi'de shell açmak gerekmiyor; gerekiyorsa bir yerde declarative olmayan bir şey
var demektir.

Zincir her iki hedefte de aynı:

```
telefon ──https──> Cloudflare ──tünel──> cloudflared ──> nginx :80 ─┬─> statik ön yüz (0.2: React, webRoot)
                    (TLS burada biter)                   (server_name) └─> /api → Rust 127.0.0.1:8000 (0.2)
                                                                          (0.1: her şey uvicorn 127.0.0.1:8000)
```

Tek süreç **şart**: ağaç indeksi (`TreeIndex`) süreç belleğinde tutuluyor.
İkinci bir süreç/işçi kendi bayat ağacıyla kalır.

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
