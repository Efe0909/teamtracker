# Konteynerle dağıtım

Uygulama ve veritabanı **konteynerde**, önlerinde nginx. Yayında bu yığını
elle kurmuyorsun: `~/nix`'teki `modules/ekiptakip-app.nix` systemd birimi
`docker compose up -d --build` koşuyor, nginx de `modules/nginx/ekiptakip.nix`
ile geliyor (bkz. [`README.md`](README.md)). Bu dosya o yığının **içini**
anlatır — imaj, sırlar, medya dizini, günlük komutlar.

```
cloudflared ──> nginx :80 ──> 127.0.0.1:8000 ──> ekiptakip-app:8000
                                                        │
                                                        └──> ekiptakip-db:5432
```

Dosyalar:

| dosya | ne yapar |
|---|---|
| `Dockerfile` | uygulama imajı (python:3.12-slim, root değil, `--workers 1`) |
| `docker-compose.prod.yml` | uygulama + Postgres + isteğe bağlı `tohum` profili |
| `~/nix` `modules/nginx/ekiptakip.nix` | ön yüz (ayrı depo, Nix ifadesi) |
| `requirements.txt` | bağımlılıkların tek kaynağı (Makefile de bunu okur) |

## Kurulum

Sunucuda Docker Engine + compose eklentisi ve nginx kurulu olsun.

**1. Depoyu al ve sırları yaz**

```bash
git clone <depo> ekiptakip && cd ekiptakip
cp .env.ornek .env
```

`.env` içinde en az şunlar dolmalı:

```
POSTGRES_PASSWORD=<uret>            # zorunlu; verilmezse yığın açılmaz
EKIPTAKIP_SECRET_KEY=<uret>         # değişirse herkesin oturumu düşer
```

Değer üretmek için:

```bash
python3 -c "import secrets;print(secrets.token_urlsafe(32))"
```

**Ayrıca kimlik kipini seçmen şart** — ikisinden biri olmadan uygulama
açılmayı reddeder ve `restart: unless-stopped` yüzünden konteyner döngüye
girer (`docker compose ... ps` çıktısında `Restarting`). Günlükteki karşılığı:

```
SystemExit: GUVENLIK yapilandirmasi eksik:
  - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET tanimli degil.
```

- **Gerçek giriş (Faz 2):** `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`.
  Yetkili redirect URI'lar `.env.ornek`'te yazılı.
- **Sahte kimlik (yalnızca deneme):** `EKIPTAKIP_AUTH=sahte` ve
  `EKIPTAKIP_ENV=gelistirme`. Giriş ekranı olmaz, gelen herkes ilk aktif
  kullanıcı olur — dışarı açılan bir kurulumda kullanma.

Alan adı değişkenleri (`EKIPTAKIP_HOST_APP` vb.) verilirse uygulama **yayın
kipine** geçer: sahte kimliği ve kısa anahtarı tümden reddeder.

> `.env` yalnızca konteyneri değil, depodaki her şeyi etkiler — `shared/config.py`
> onu dosyadan okur. İçine `EKIPTAKIP_ENV=gelistirme` yazarsan
> `tests/test_guvenlik.py::test_sahte_kimlik_acik_bayrak_olmadan_acilmaz`
> düşer: test alt süreçten `EKIPTAKIP_*` değişkenlerini siliyor ama `.env`
> diskten yeniden okunuyor. Kimlik kipini `.env`'e yazacaksan bunu bil.

**2. Yığını kaldır**

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Şema göçleri açılışta kendiliğinden koşar (`app.py` lifespan → `db.gocler()`),
ayrı bir göç adımı yok.

**3. İlk admini ekle** — bu adım atlanırsa kimse giremez

Giriş yalnızca `users` tablosunda kayıtlı e-postalara açık
(`spec/70-guvenlik.md` §2.3):

```bash
docker compose -f docker-compose.prod.yml run --rm app \
  python tools/user.py add sen@ornek.com "Adın" --admin
```

Listelemek / kapatmak:

```bash
docker compose -f docker-compose.prod.yml run --rm app python tools/user.py list
docker compose -f docker-compose.prod.yml run --rm app python tools/user.py deactivate biri@ornek.com
```

**4. nginx**

Elle bağlanmıyor: `~/nix/modules/nginx/ekiptakip.nix` iki vhost'u
(`app.` / `dashboard.`) tanımlıyor ve `127.0.0.1:8000`'e proxy'liyor.
`nixos-rebuild switch` yeterli.

## Medya (ekler)

Kart sohbetine ve takım duvarına yüklenen görseller (`spec/20-sema.md` §3b)
`docker-compose.prod.yml` içinde `app` servisine bağlanan bir dizine yazılır:

```yaml
volumes:
  - ${EKIPTAKIP_MEDIA_DIR:-./var/media}:/data/media
```

**Bilerek bind mount, isimli Docker volume DEĞİL.** Medyanın gerçek diskte
durması gerekiyor (Pi'de: SATA); isimli bir volume Docker'ın kendi veri
dizinine (genelde sistem diski/SD kart) gömülür ve bu varsayımı **sessizce**
bozar — disk dolana kadar kimse fark etmez. `EKIPTAKIP_MEDIA_DIR` bu yüzden
her zaman gerçek bir host yoluna işaret etmeli; varsayılan `./var/media`
yalnızca bare `docker compose up` denemesi bozulmasın diyedir.

Konteyner içindeki yol sabit: `/data/media`, sahibi **uid 10001**
(Dockerfile'daki `ekiptakip` kullanıcısı). Host tarafındaki dizin de aynı
sayısal uid'e yazılabilir olmalı — isimle değil, çünkü konteynerin
`/etc/passwd`'inde host'un kullanıcı adları yok.

**Taşımak/yerleştirmek** (ör. ikinci bir diske):

```bash
EKIPTAKIP_MEDIA_DIR=/yeni/yol docker compose -f docker-compose.prod.yml up -d
```

Dizin önceden var olmalı ve uid 10001 tarafından yazılabilir olmalı. Değilse
`shared/config.py::validate()` yalnızca **uyarı** verir (metin sohbeti
çalışmaya devam eder, `in_production()` doğruysa uyarı loglanır) — ilk
görsel yükleme denemesi diskte yazma hatasıyla patlar.

Efe'nin NixOS kurulumunda bu adım elle yapılmaz:
`deploy/nix-ekiptakip-media.nix` dizini `systemd.tmpfiles.rules` ile
10001:10001 sahipli olarak SATA diskinde oluşturur ve değeri
`systemd.services.ekiptakip`'e geçirir — ayrıntı ve "disk yoksa ne olur"
sorusunun cevabı (`RequiresMountsFor`) modülün kendi yorumunda.

**Yedek — bilinen bir boşluk.** Yukarıdaki "Yedek" bölümündeki `pg_dump`
yalnızca veritabanını alır, medya dosyalarını **almaz**. Pi kurulumunda
medya SATA diskinde durur ve `~/nix`'teki `services.restic.backups.yerel`
o diski (`/home/efe/sata`) kendini sonsuz döngüyle yedeklememek için
**bilerek** `exclude` listesine koyuyor (`modules/configuration.nix`).
Sonuç: **bugün hiçbir mekanizma medya dosyalarını yedeklemiyor** — disk
arızası tüm ekleri götürür. Bu örtük olarak çözülmüş sayılmamalı; üçüncü
bir yedek hedefi (ayrı disk/uzak sunucu) `~/nix`'in kendi kararı, bu
depodan çözülmez.

## agenix ile sırlar (NixOS)

Sunucu NixOS'sa `.env`'i makinede elle tutmak yerine age ile şifreleyip depoda
saklayabilirsin.

Efe'nin kurulumunda modüller **bu depoda değil**, `~/nix` yapılandırma
deposunda duruyor — tek kaynak orası:

| dosya | ne yapar |
|---|---|
| `modules/ekiptakip-app.nix` | agenix sırrı + compose'u koşan systemd birimi |
| `modules/nginx/ekiptakip.nix` | iki vhost, `127.0.0.1:8000`'e proxy |
| `secrets/ekiptakip-env.age` | şifreli `.env` |

**Dosya adı önemli:** `.gitignore` içindeki `.env*` kuralı `.env.age`'i de
yakalar — dosyayı depo köküne o adla koyarsan git onu sessizce yok sayar,
`git add` bir şey yapmaz. `secrets/ekiptakip-env.age` gibi bir ad kullan;
o kurala takılmıyor.

**Alıcılar:** `secrets.nix` içinde hem senin kişisel anahtarın hem VM'in
**host** anahtarı (`/etc/ssh/ssh_host_ed25519_key.pub`) listelenmeli. Host
anahtarı unutulursa makine kendi sırrını açamaz ve servis açılışta patlar.

**İki bayrak birden gerekiyor.** Compose'da sırların iki ayrı yolu var ve
biri diğerini kapsamıyor:

| mekanizma | neyi besler | eksikse |
|---|---|---|
| `--env-file <yol>` | compose dosyasındaki `${...}` yerine koymaları (`POSTGRES_PASSWORD`, `DATABASE_URL`) | değişken **boş** kalır, yalnızca uyarı verilir |
| `env_file:` (servis alanı) | konteynerin ortam değişkenleri | uygulama sırsız açılmaya çalışır |

Bu yüzden ikisi aynı dosyayı göstermeli:

```bash
EKIPTAKIP_ENV_FILE=/run/agenix/ekiptakip-env \
docker compose --env-file /run/agenix/ekiptakip-env \
  -f docker-compose.prod.yml up -d
```

`docker-compose.prod.yml` içindeki `env_file: ${EKIPTAKIP_ENV_FILE:-.env}`
bunun içindir; değişken verilmezse eskisi gibi `.env` okunur.

Yalnızca `env_file:` verip `--env-file`'ı unutursan `POSTGRES_PASSWORD`
boşalır — ama compose'daki `:?` koruması bunu **hata olarak** keser, sessizce
boş parolayla veritabanı kurmaz.

**Her compose çağrısında ikisi de lazım** — sadece `up`'ta değil. `exec`,
`run`, `logs`, `down` hepsi aynı dosyayı görmeli, yoksa:

```
env file /srv/ekiptakip/.env not found
```

Elle uğraşmamak için kabuk tarafında sabitle:

```bash
export EKIPTAKIP_ENV_FILE=/run/agenix/ekiptakip-env
alias ekt='docker compose --env-file /run/agenix/ekiptakip-env -f /srv/ekiptakip/docker-compose.prod.yml'
ekt ps
ekt run --rm app python tools/user.py list
```

`~/nix/modules/ekiptakip-app.nix` bunu `compose` değişkeninde zaten tek yerde
tutuyor.

**İzinler:** agenix dosyayı `/run/agenix/<ad>` altına yazar. Compose'u root
çalıştırıyorsa `mode = "0400"; owner = "root"` yeterli. Docker'ı normal
kullanıcıyla çalıştıracaksan `owner` onu göstermeli, yoksa compose dosyayı
okuyamaz.

**Depo public:** age şifreli dosyayı public depoya koymak agenix'in normal
kullanımı, şifre metni güvenli. Yine de akılda tut: hangi sırların var olduğu
ve boyutları görünür olur, ve ileride bir anahtar ele geçerse geçmişteki tüm
sürümler açılabilir. Sır döndürürken eski değeri de iptal et
(`EKIPTAKIP_SECRET_KEY` değişirse herkesin oturumu düşer — bu kasıtlı bir
acil durum düğmesi).

## Kapı

Uygulamanın **kendi kimliği artık var**: Google girişi, davetli listesi
(`users` tablosunda olmayan e-posta giremez), imzalı oturum çerezi, CSRF
kapısı, giriş hız sınırı (`spec/70-guvenlik.md`). Bu paragraf eskiden
"kimlik yok, kapı şart" diyordu — o dönem kapandı.

Cloudflare Access bugün **kapalı** ve artık **ek katman**, tek kapı değil
(ayrıntı ve gerekçe: [`README.md`](README.md) "Bu kurulumun kapatmadıkları").

Yığın kendi başına yalnızca `127.0.0.1:8000`'e bağlanır; dışarıya açan tek
şey nginx + tüneldir.

## Günlük işler

```bash
docker compose -f docker-compose.prod.yml logs -f app     # günlük
docker compose -f docker-compose.prod.yml up -d --build   # yeni sürüm
docker compose -f docker-compose.prod.yml down            # durdur (veri kalır)
```

Makefile kısayolları: `make yayin-ac`, `make yayin-kapat`, `make yayin-log`,
`make yayin-tohum`.

## Bilinmesi gerekenler

- **`--workers 1` zorunlu.** Ağaç indeksi süreç belleğinde tutuluyor
  (`spec/10-kararlar.md`); ikinci işçi ikinci ağaç demek. `replicas` da 1
  kalmalı — bu yığın yatay ölçeklenmez.
- **`POSTGRES_PASSWORD` yalnızca ilk kurulumda işlenir.** Volume doluyken
  değiştirmek işe yaramaz; belirtisi şaşırtıcı olur:
  `password authentication failed for user "ekiptakip"`. Parolayı değiştirmek
  için ya `down -v` (VERİ GİDER) ya da elle `alter user ... with password`.
- **Yayın volume'ü geliştirmeninkinden ayrı** (`ekiptakip-pgdata-yayin`).
  Aynı isim verilseydi `docker-compose.yml` ile aynı veriyi paylaşırlardı.
- **Yedek:** veri yalnızca volume'de. **Bu, medya eklerini kapsamaz** —
  görseller ayrı bir bind mount'ta yaşar, ayrıntı ve bilinen boşluk yukarıda
  "Medya (ekler)" bölümünde.

  ```bash
  docker compose -f docker-compose.prod.yml exec -T db \
    pg_dump -U ekiptakip ekiptakip | gzip > ekiptakip-$(date +%F).sql.gz
  ```

- **`make yayin-tohum` yıkıcıdır** — `users` dahil dokuz tabloyu truncate eder.
  Örnek veri içindir, kurulu bir sistemde çalıştırma.
- **Sürümler sabitlenmedi** (`requirements.txt`). Aynı imajı aylar sonra birebir
  yeniden kurman gerekiyorsa `uv pip compile` çıktısına geç.
