# EkipTakip — 0.10.4

Ekip için hata/görev takibi: hiyerarşi + kayıtlar + kart içi sohbet + alan değişiklikleri.
**Tek API, iki yüz, ortak veritabanı:**

| Yüz | Ne | Yayında |
|---|---|---|
| **Masaüstü** | ana sayfa (modül seçimi), görev yöneticisi (tablo + kart + sohbet), ekipler, yönetim paneli | `dashboard.<alan>` |
| **Mobil** | yapılacaklar, arama, eylemler, bildirimler | `app.<alan>` |
| **Karşılama** | Google ile giriş, yüz seçimi | apex (`<alan>`) |

Yığın: **Rust** (axum + sqlx, ham SQL, ORM yok) yalnız `/api/*` JSON verir;
**React + TypeScript** (strict, Vite) statik derlenir, nginx sunar. PostgreSQL.
Sınır ve gerekçe: `spec/15-sinirlar.md`.

## Faz durumu

- **Faz 1** — hiyerarşi, kayıtlar, kart içi sohbet, alan değişiklikleri, mobil yüz. Tamam.
- **Faz 2** — gerçek kimlik: Google OAuth (PKCE), davetli listesi, imzalı oturum, CSRF,
  giriş hız sınırı. **Geldi.** Sahte kimlik yalnız yerelde; yayında açılışı reddettirir.
- Üstüne: yönetim paneli, medya ekleri, kart blokları (medya/toplantı/havuz), etkinlikler
  (OTF formu dahil), erişim kipleri, bildirimler (web push + Resend davet postası),
  bilgi yoğunluğu kapısı (uzunluk + OpenRouter karar modeli, `spec/76`).
- Python'daki özelliklerin 0.2'ye taşınma envanteri: `spec/90-geri-tasima.md`.

alpha-0.1 (Python + FastAPI + HTMX) **arşivlendi**: `references/python/`. Çalışan
yığın değil, davranışın başvurusu — bkz. [Arşiv](#arşiv-alpha-01-python).

## Çalıştır

Tek komut: `make dev` — Postgres, API ve web; boş veritabanında tohumu yükler, tarayıcıyı açar.
Elle:

```bash
docker compose up -d                                    # Postgres (ekiptakip-db)
docker exec ekiptakip-db createdb -U ekiptakip ekiptakip_alpha02
(cd backend && DATABASE_URL=postgresql://ekiptakip:ekiptakip@127.0.0.1:5432/ekiptakip_alpha02 \
   EKIPTAKIP_AUTH=sahte cargo run)                      # API 127.0.0.1:8000, göçler açılışta
(cd frontend && npm install && npm run dev)             # http://localhost:5173
```

- Karşılama <http://localhost:5173>, yüzler <http://app.localhost:5173> ·
  <http://dashboard.localhost:5173>. Vite `/api`'yi Rust'a vekiller.
- Ayrım **Host'un ilk etiketine** bakar; yol öneki yok.
- Sahte kimlik: karşılamada kullanıcı seçilir, oturum hedef host'ta açılır
  (`localhost` çerezi alt alan adlarına paylaşılamıyor).
- Tohum (**varolan veriyi siler**):
  `docker exec -i ekiptakip-db psql -U ekiptakip -d ekiptakip_alpha02 < backend/seed.sql`.
  Ağaç indeksi açılışta kurulur — elle veri yazdıysan Rust'ı yeniden başlat.
- `nix develop` derleme araçlarını (cargo, zig, node) verir.

## Denetim

| Komut | Ne |
|---|---|
| `cargo clippy --all-targets` | `unwrap`/`expect`/`panic!`/`todo!`/`unsafe` derlemeyi düşürür |
| `cargo test` | birim: ağaç, filtre, hız sınırı, karar modeli yanıtı, manifest/sürüm tutarlılığı |
| `npm run build` | CSS Modules tipleri + ham renk denetimi + `tsc` strict + Vite |
| `npm test` | vitest + testing-library |
| `backend/tools/local_test.sh` | JSON sözleşmesi yerelde: atılıp yıkılan DB + iki süreç |

## Yayına alma

Hedef makine **derlemez**. `backend/tools/release.sh` Mac'te derler (statik musl ikili +
`frontend/dist`), GitHub release'e yükler, `deploy/release.nix`'i pinler; makine
yapılandırması `~/nix`'te (NixOS, `flake.nix` → `nixosModules.default`).

Ayar iki yerde: **sırlar** `~/nix`'teki agenix dosyasında, **gizli olmayanlar** (sürüm,
iletişim e-postası, kapalı dış servisler, karar modeli) [`backend/manifest.json`](backend/manifest.json)'da.
Adım adım yayın, Pi'ye uygulama, doğrulama ve geri dönüş: [`deploy/README.md`](deploy/README.md).

## Yapı

```
backend/     Rust JSON API — src/, migrations/, manifest.json, seed.sql, tools/ (test, release, import)
frontend/    React + TS — api/ (istemci, tipler), ui/, features/, surfaces/; renk yalnız tokens.css
deploy/      NixOS modülü, release pini, Cloudflare notları
spec/        kararlar, şema (v2: 21-sema-v2.md), ön yüz (16-on-yuz.md), güvenlik
reference/   kaynak ekranların uydurma verili HTML yeniden çizimleri
references/  python/ — arşivlenmiş alpha-0.1
```

## Nereye bakmalı

| Soru | Dosya |
|---|---|
| Rust ne yapar, ön yüz ne yapar? | `spec/15-sinirlar.md` |
| Ön yüz yapısı | `spec/16-on-yuz.md` |
| Veri modeli (v2) | `spec/21-sema-v2.md` |
| Neden böyle yazıldı? | `spec/10-kararlar.md` |
| Kimlik, yetki, tehdit modeli | `spec/70-guvenlik.md` |
| Python'dan ne taşındı, ne bırakıldı | `spec/90-geri-tasima.md` |
| Yayına alma, ayarlar, Cloudflare | `deploy/README.md` |
| Bilgi yoğunluğu kapısı, kalite kararı, KVKK | `spec/76-bilgi-yogunlugu.md` |

## Bilgi güvenliği

Bu depo **public**.

- Depoda sır **yok**: parola, API anahtarı, token, VAPID anahtarı tutulmuyor. Sırlar
  `~/nix`'te agenix ile.
- Tohum verisine **gerçek müşteri/ekip verisi koyma**.

### Kimlik ve yetki (Faz 2)

- Giriş apex'te: Google OAuth + PKCE → imzalı oturum çerezi (`Domain=.<alan>`, üç
  host'ta geçerli). JWT yok; kapsam/rol her istekte veritabanından okunur.
- Yalnız `users` tablosundaki **etkin** e-postalar girer; bilinmeyen adres için kullanıcı
  oluşmaz. Pasifleştirilen kişi bir sonraki istekte düşer.
- İlk yönetici `~/nix`'teki agenix sırrından (`EKIPTAKIP_BOOTSTRAP_ADMINS_FILE`) açılışta
  garanti edilir; sonrası yönetim panelinden.
- Yanlış yapılandırma **açılışta** yakalanır: yayında sahte kimlik, eksik/kısa
  `EKIPTAKIP_SECRET_KEY`, eksik Google anahtarı → süreç açılmaz.
- CSRF: token `GET /api/me` ile gelir, değiştiren her istekte `X-CSRF-Token`.
- Giriş uçlarında IP başına hız sınırı; giriş, ret, çıkış, 403 `security_events`'e yazılır.
- **Yetki sunucuda.** Ön yüz düğme göstermek için API'nin döndürdüğü yetkiyi kullanır,
  kendi karar vermez.
- SQL parametreli (`sqlx`), metin birleştirme yok.
- Ekler: tür magic byte'tan, 10 MB tavan, piksel tavanı, yeniden kodlama (EXIF/GPS düşer).
- Rust yalnız `127.0.0.1`'e bağlanır; önünde nginx (CSP ve güvenlik başlıkları) ve
  Cloudflare tüneli. Cloudflare Access şu an kapalı — ek katman, tek kapı değil
  (`deploy/README.md`).

### Açık bildirimi

Bir açık bulursan issue açma; doğrudan bakımcıya yaz (`Efe0909` GitHub profili).

## Arşiv: alpha-0.1 (Python)

`references/python/` — FastAPI + Jinja2 + HTMX sürümü, olduğu gibi. Rust/TS
karşılıkları yorumlarda bu yollara atıf yapar; `backend/tools/gen_seed.py` tohumu
`references/python/shared/seed.py`'den üretir. Hâlâ çalışır:

```bash
cd references/python && make up     # Postgres kökteki docker-compose.yml'den
```

Yeni özellik buraya yazılmaz.
