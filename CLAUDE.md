# EkipTakip — ajanlar için proje notları

## Ortamlar: yerel / VM / Pi

Makine yapılandırması **bu depoda değil** — `~/nix` (github:Efe0909/nix), reproducible
NixOS. `deploy/` yalnız uygulamanın sözleşmesini anlatır (konteyner yığını, medya
dizini, tünel). Elle kurulum yok; macOS ve Debian şablonları kaldırıldı.

| Ortam | Nerede | Ne |
|---|---|---|
| Yerel geliştirme | bu depo | 0.2: `cargo run` + `npm run dev` (aşağıda); 0.1: `make up` |
| VM testi | `~/nix` `.#teamtracker0.1` / `.#teamtracker0.2` | aynı VM (192.168.64.8), iki sürüm: 0.1 Python+Docker (e02d71d'ye pinli), 0.2 Rust+React (release) |
| Üretim | `~/nix` `.#evsunucu` | Raspberry Pi, aynı `configuration.nix` |

### alpha-0.2: Rust API + React

Yeni yığın: `backend/` (Rust, yalnız `/api` JSON) + `frontend/` (React + TS strict,
statik). Python (`app.py`, `shared/`, `sites/`, `tests/`) **başvuru**: davranışın
kaynağı, çalışan yığın değil. Sınır: `spec/15-sinirlar.md`.

```bash
docker start ekiptakip-db && docker exec ekiptakip-db createdb -U ekiptakip ekiptakip_alpha02
(cd backend && DATABASE_URL=postgresql://ekiptakip:ekiptakip@127.0.0.1:5432/ekiptakip_alpha02 \
   EKIPTAKIP_AUTH=sahte cargo run)                     # API 127.0.0.1:8000
(cd frontend && npm install && npm run dev)            # http://localhost:5173
```

- Karşılama <http://localhost:5173>, yüzler <http://app.localhost:5173> ·
  <http://dashboard.localhost:5173>. Vite `/api`'yi Rust'a vekiller.
- Sahte kimlik: karşılamada kullanıcı seçilir, oturum **hedef host'ta** açılır
  (`localhost` çerezi alt alan adlarına paylaşılamıyor).
- Tohum: `docker exec -i ekiptakip-db psql -U ekiptakip -d ekiptakip_alpha02 < backend/seed.sql`.
- Denetim: `cargo clippy --all-targets` (panik/`todo!` derlemeyi düşürür),
  `npm run build` (tsc strict), `backend/tools/vm_test.sh` (VM'de JSON sözleşmesi).
- Yerel Postgres konteyneri (`ekiptakip-db`) ana checkout'un compose projesine ait;
  worktree'de `docker compose up` ad çakışması verir → `docker start ekiptakip-db`.
  Yerel `ekiptakip` veritabanı eski v1 şemasında (`notify_level` yok); güncel v1 için
  `ekiptakip_manual`.
- Tarayıcı önizlemesi (`preview_start`) ana checkout'un `.claude/launch.json`'unu
  okur (worktree'dekini değil): `alpha02-api`, `alpha02-web` orada, mutlak yollu.
- VM: `ssh efe@192.168.64.8`, parolasız sudo. Sürüm geçişi ve tuzaklar: `deploy/README.md` §2.
- **Hedef makine derlemez.** Yayın: `backend/tools/release.sh` Mac'te derler, GitHub
  release'e yükler, `deploy/release.nix`'i pinler; `~/nix` `packages.aarch64-linux.default`'u
  çeker.

### Yerel: siteyi ayağa kaldırmak (Python, başvuru)

```bash
make up          # bağımlılıklar + Postgres (Docker) + tohum + sunucu (--reload)
```

- Masaüstü: <http://localhost:8000> · Mobil: <http://app.localhost:8000>
- Ayrım **Host'un ilk etiketine** bakar. Yol öneki YOK, `/m` diye bir şey yok.
- Kimlik **sahte** (`EKIPTAKIP_AUTH=sahte`): giriş ekranı yok, ilk kullanıcı olarak
  açılır; ray'deki avatardan kullanıcı değiştirilir.

Parça parça: `make db-ac` (yalnız Postgres) · `make seed` (**varolan veriyi siler**)
· `make dev` · `make test` · `make db-kapat`. Veritabanını komple silmek:
`docker compose down -v`.

Ajan notları:

- `make test` **gerçek Postgres** ister; Docker kapalıysa testler toplanma
  aşamasında patlar. Testler `ekiptakip_test_<modul>` adlı kendi veritabanlarını
  kurar, ana `ekiptakip`'e dokunmaz — yani `make seed` testleri etkilemez.
- Gerçek Google girişini yerelde kurmaya çalışma; sahte kimlikle bütün yetki
  yolları (admin, scope, rol) sınanabiliyor. Gerçekten gerekiyorsa
  `tests/test_real_identity.py` kalıbı imzalı çerezi taklit ediyor, OAuth'a çıkmıyor.
- Yeni bağımlılık `requirements.txt`'e (tek kaynak — Makefile ve Dockerfile onu okur):
  `uv pip install --python .venv/bin/python -r requirements-dev.txt`.
- Yeni göç `shared/migrations/` altına numaralı dosya; açılışta kendiliğinden koşar.
- `--workers 1` şart: ağaç indeksi (`TreeIndex`) süreç belleğinde.

### Yayına alma

```bash
backend/tools/release.sh                          # Mac: derle + GitHub release + deploy/release.nix
git commit -am "release: <tag>" && git push
cd ~/nix && nix flake update teamtracker-alpha02  # 0.2'yi yeni pine çek
git commit -am "teamtracker-alpha02: <tag>"
# VM'de (yalnız yapılandırma dosyaları kurulur, uygulama release'ten iner):
sudo nixos-rebuild switch --flake .#teamtracker0.2   # geri: .#teamtracker0.1
```

Alan adları (zon `polonyum.com`): `app.` mobil kökte, `dashboard.` masaüstü,
bilinmeyen Host `444`. Ayrıntı: `deploy/README.md`.

## Kapı: Access kapalı, uygulama kendi kapısını tutuyor

Uygulamanın kendi kimliği **var**: Google girişi, davetli listesi (`users`'ta
olmayan e-posta giremez), imzalı oturum, CSRF kapısı, giriş hız sınırı
(`spec/70-guvenlik.md`). Bu bölüm eskiden "kimlik yok, Access şart" diyordu —
o dönem kapandı.

Cloudflare Access şu an **açık değil** (2026-09-10'da `curl` ile doğrulandı:
public hostname'e giden istek doğrudan uygulamaya düşüyor, 401 gövdesi
`giriş gerekli`). Access bugün ek katman; kapatmanın bedeli kimliksiz trafiğin
origin'e ulaşması. Gerekçe ve açma adımları: `deploy/README.md`,
`deploy/cloudflare-dashboard.md`.

## Faz durumu

**alpha-0.2 (2026-09-22, PR #35):** Rust JSON API + React ön yüz. `polonyum.com/`
yönlendirici (oturum → cihaza göre `app.`/`dashboard.`, yok → `/welcome` giriş formu);
`app.` ve `dashboard.` "yapım aşamasında". Kullanıcı/ağaç/takım/rol 0.1'den taşındı,
iş kayıtları taşınmadı. Sıradaki: TASK-297 (giriş yalnız apex'te + karşılama).
Aşağısı 0.1 dönemi.

alpha-0.1 = Faz 1 (hiyerarşi, kayıtlar, kart içi sohbet, alan değişiklikleri) + mobil yüz.
Faz 2 (Google OAuth) **geldi**: kimlik gerçek, `shared/identity.py`. Yerelde hâlâ
sahte kimlikle çalışılır (`EKIPTAKIP_AUTH=sahte`), yayında reddedilir.
Sonrası: yönetim paneli (`/admin`) ve medya ekleri de yazıldı; sıradaki iş
`TODO.md`'de (madde 2 → 1).

## Kod dili: İngilizce. İstisna yok.

Kaynak koddaki **her tanımlayıcı İngilizce**: değişken, fonksiyon, sınıf, modül
ve dosya adı, tablo ve sütun adı, kapsam/izin anahtarı, sözlük anahtarı, test adı,
**URL yolu ve query parametre adı**. Rota kayıtlarındaki (`@router.get(...)`),
form alanı `name=` özniteliklerindeki ve `hx-get`/`hx-post`/`hx-patch` hedeflerindeki
yol dizgeleri de bu kurala girer — `/gorevler` değil `/tasks`, `?takim=` değil
`?team=`.

Türkçe kalan tek şey **kullanıcının gördüğü metin**: şablonlardaki yazılar, hata
mesajları, etiketler, `SCOPES` sözlüğünün *değerleri*, tohum verisindeki (`shared/seed.py`)
takım/düğüm adları ve açıklamaları. Yorumlar, docstring'ler, `spec/` ve commit
mesajları da Türkçe kalır — onlar kod değil, anlatı.

```python
SCOPES = {
    "edit_nodes": "Yapıyı düzenle — düğüm ekle, adlandır, taşı, sil",
#    ^ anahtar İngilizce      ^ ekranda görünen metin Türkçe
}
```

**Neden:** iki ay sonra `kapsam` / `gocler` / `var_mi` açıldığında ne olduğu
okunmuyor. Terimi çevirme — `scope` scope'tur, `kapsam` değil.

### Depo bu kurala uyuyor (2026-09-09'da tamamlandı)

Kod tabanı baştan sona İngilizceye çevrildi: `shared/kapsam.py` → `shared/scope.py`,
`shared/kimlik.py` → `shared/identity.py`, `shared/sertlestirme.py` → `shared/hardening.py`,
`db.havuz()` → `db.pool()`, `db.gocler()` → `db.migrate()`, `service.dugum_ekle` →
`service.add_node`, Türkçe test adları da dahil tüm rotalar, form alanları, DB
tablo/sütun adları ve durum/öncelik/rol gibi sabit değerler (`acik`→`open`,
`kritik`→`critical`, `lider`→`lead`…) çevrildi. `spec/` belgeleri ve commit
geçmişi hâlâ eski (Türkçe) adları anabilir — kod referans alınmalı.

**Göç dosyası adları artık donuk.** `db.migrate()` uygulanan göçü *dosya
adıyla* `schema_migrations`'a yazıyor (`shared/db.py`); `shared/migrations/`
içindeki `001_schema.sql`…`011_node_types.sql` bir daha yeniden adlandırılmamalı —
kurulu bir veritabanında yeniden adlandırılırsa uygulanmamış sayılır ve
**yeniden koşar**. Rename bu geçişte serbestti çünkü henüz canlıya hiç
kurulmamıştı (veritabanı boştu); artık ilk gerçek kurulumdan sonra donarlar.
