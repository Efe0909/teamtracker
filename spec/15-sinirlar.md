# 15 — Sınırlar: Rust API ve ön yüz

Durum: **karar** (2026-09-22), alpha-0.2'de uygulandı.

## Karar

Rust **yalnızca JSON API**'dir (`/api/*`). HTML, CSS, JS ve PWA ön yüzündür: React +
TypeScript, statik derlenir, nginx verir (`frontend/`). Cümle olarak: Rust *ne doğru ve
kim değiştirebilir* sorusunun sahibi; ön yüz *nasıl görünür*.

Python uygulaması (`app.py`, `shared/`, `sites/`) başvuru olarak depoda durur; yeni
yığının parçası değil.

Neden:

1. Arayüz sık değişecek. Ön yüz, arka uca dokunmadan ve onu yeniden derlemeden yayınlanır.
2. Veritabanı ve arka uç arayüzden ayrılır: şema v2 gibi değişiklikler API'nin arkasında
   kalır, ekranlara sızmaz.
3. Ön yüz değiştirilebilir (bugün React, yarın başka bir çerçeve). Sözleşme aynı
   kaldıkça arka uç haberdar bile olmaz.

## Kim neyin sahibi

| Rust (JSON API) | Ön yüz (React, statik) |
|---|---|
| şema, göçler, `TreeIndex`, veritabanı | HTML, CSS, JS, bileşenler |
| kimlik: Google OAuth, oturum çerezi, CSRF, giriş hız sınırı, davetli listesi, `security_events` | `app.` / `dashboard.` / apex ayrımı (Host'un ilk etiketi) |
| yetki: `can_edit_item`'in beş yolu, scope, rol, admin | bütün ekran metinleri; hata kodunu Türkçe iletiye çevirmek |
| bütün yazmalar: kayıt, eylem, kart, mesaj, alan değişimi, node, takım, kullanıcı + `activity` | PWA (`manifest.json`, `sw.js`) — henüz yok |
| veri olarak okumalar: ağaç, süzülmüş görev listesi, tam metin arama, akış | |
| ek baytları ve küçük resimler, web push *gönderimi* | |

nginx (`~/nix` `modules/nginx/ekiptakip.nix`): statik dosyalar, SPA geri düşmesi, CSP ve
güvenlik başlıkları, `/api/` vekili.

Veri olup arayüzü olanlar (ray pinleri, push abonelikleri) Rust'ta saklanır, ön yüzde çizilir.

## Kimlik dikişi

- Tarayıcı Rust'la **aynı kökenden** konuşur: her host'ta (`polonyum.com`, `app.`,
  `dashboard.`) nginx `/api/`'yi Rust'a vekiller. CORS yok.
- Giriş apex'te: `GET /api/auth/google?next=app|dashboard` → Google → `/api/auth/callback`
  → oturum çerezi `Domain=.polonyum.com` (üç host'ta geçerli) → seçilen yüze yönlendirme.
  `next` iki değerli birlik; serbest adres yok (açık yönlendirme imkânsız).
- Oturum: imzalı çerez, içinde `uid.csrf`. JWT yok; kapsam/rol çereze gömülmez, her istekte
  DB'den (KNOW-97). CSRF token'ı `GET /api/me` ile ön yüze verilir, değiştiren her istekte
  `X-CSRF-Token` olarak döner; her girişte yenilenir.
- "İşlemi yapan kullanıcı" Rust'ta **tek bir yerde** çözülür (`auth.rs` `CurrentUser`).
  İleride dış istemci (jeton) gelirse yalnız bu işlev genişler, API değişmez.
- Rust yalnız `127.0.0.1` dinler (`EKIPTAKIP_BIND`); hız sınırı nginx'in yazdığı
  `X-Real-IP`'ye güvenir. (`KNOW-288`'i kapatır.)
- **Yetkilendirme Rust'ta.** Ön yüz düğme göstermek için API'nin döndürdüğü yetki bilgisini
  kullanır; kendi başına karar vermez.

## API kuralları

1. Yalnız JSON. Hiçbir uç HTML parçası dönmez.
2. Yanıtlar kullanım durumuna göre şekillenir, tabloyu aynalamaz. Şema değişince yanıt
   değişmemeli.
3. Sunum metni yok: yapılandırılmış olgular döner (`{field, from, to}`), cümleyi ön yüz kurar.
   Hata = kod + makine okunur alanlar; Türkçe ileti ön yüzde. (`TASK-221`'i çözer.)
4. Filtre sözleşmesi sorgu dizgisi olarak sunucuda kalır (`?node=&team=&quick=`); süzme ve
   arama SQL'de yapılır, ön yüz listeyi kendi süzmez.
5. Sözleşme **sınırda** sınanır: `check_api.sh` biçiminde, ama HTML metni yerine JSON
   alanlarını karşılaştırır. Bu testler sözleşmenin yazılı halidir.
6. Değişiklik geriye uyumlu eklemeyle yapılır; kırıcı değişiklik yeni yol açar.

## Yapma

- Alan kuralını (yetki, durum geçişi, kapatma koşulu) ön yüzde yineleme. Ön yüz ince
  kalır.
- API'den HTML dönme. "Sadece bir parça" istisnası yok.
- Rust'ı dışarıya açma.

## alpha-0.2'de ne yapıldı

- Rust HTML katmanı silindi (şablonlar, statikler, minijinja, `render.rs`, HTML
  handler/rotaları, host yönlendirme). `db/` + `models/` alan kodu duruyor; JSON uçları
  geldikçe kullanılacak.
- API: `/api/me`, `/api/auth/google`, `/api/auth/callback`, `/api/auth/logout`,
  `/api/auth/dev-login` (yalnız sahte kimlik). Sözleşme: `backend/tools/check_api.sh`.
- Ön yüz: apex kökü (`/`) yönlendirici — oturum varsa cihaza göre `app.`/`dashboard.`, yoksa herkese açık `/welcome` (giriş formu; giriş duvarı değil).

## Çekirdek ekranlar (alpha-0.2, 2026-09-23)

- İş uçları: `GET /api/meta` (kişiler, takımlar, ağaç, yetenekler — diğer yanıtlar yalnız
  kimlik taşır, ad/renk/yol buradan çözülür), `GET|POST /api/records` (filtre sözleşmesi
  `db/filters.rs`, `done`, `quick=mine`), `GET|PATCH /api/records/{id}` (tek alan, tipli
  `{field, value}`), `POST /api/records/{id}/actions`, `PATCH /api/actions/{id}`,
  `GET /api/actions/mine`, `GET /api/chats/{id}/feed`, `POST /api/chats/{id}/messages`
  (kayıt kartı ve takım duvarı aynı uç), `GET /api/home`, `POST|DELETE /api/pins/{slug}`,
  `GET /api/teams(/{id})`, `GET /api/notifications`, `GET|POST /api/nodes`,
  `PATCH|DELETE /api/nodes/{id}` (veri yönetimi — ağaç; okuma herkese açık, yazma
  `edit_nodes` + dal, kök işlemleri yalnız admin; `spec/90-geri-tasima.md` G5).
- Alan değişimi `activity`'ye olgu yazar: `verb=field_changed`, `target_label=<alan>`,
  `detail={"from","to"}`. Cümleyi ön yüz kurar (`frontend/src/lib/activity.ts`).
- Ön yüz: `dashboard.` panolar, görev tablosu, kayıt, takımlar, veri yönetimi (ağaç);
  `app.` yapılacaklar, ara, eylemlerim, bildirimler, kayıt, yeni kayıt. Yapı `16-on-yuz.md` §3.
- Sonraya: yönetim paneli, kartlar, ekler, etiketler, push, @anma, "beni dahil et"
  (`17-kayit-kesif.md` §5).

## Açık

- Yeni uç = önce `check_api.sh`'e iddia.
- Tipler şimdilik elle (`frontend/src/api.ts`); uç sayısı artınca OpenAPI'den üretilecek.
- PWA ve web push ön yüzü yeni yığında yok.
