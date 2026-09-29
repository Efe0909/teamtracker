# Yapılacaklar

alpha-0.1 yayında (NixOS VM, Docker yığını, Google girişi çalışıyor). Öncelik
sırası buydu: **3 → 2 → 1**, gerekçesi her maddede. Madde 3 (Yönetim Paneli)
yazıldı — sıradaki **2 → 1**.

Modül planları `sites/dashboard/routes.py` içindeki `MODULES` kaydında duruyor
(`ready` bayrağı + `plan` listesi). Bir ekran bitince orada `ready: True`
yapılır — ana sayfa ve `/{slug}` aynı listeyi okuyor, ikinci bir yerde
güncelleme yok.

---

## 1. Web push bildirimleri

**Durum:** Faz 3. İstemci tarafı hazır, sunucu tarafı yok.

Bugün çalışan: HTTPS (cloudflared), `GET /manifest.json`, `/sw.js` kök
kapsamdan, ve `sites/mobil/static/sw.js` içinde `push` + `notificationclick`
dinleyicileri yazılı — sunucu bağlanınca çalışacaklar.

PoC `~/projects/push` altında (Flask + pywebpush, `subs.json`'a yazıyor).
**Kodu taşıma, dersleri taşı** — orası Flask, burası FastAPI ve abonelikler
dosyaya değil tabloya girecek.

### Yapılacak

- [ ] `push_subscriptions` tablosu — yeni göç dosyası (`shared/gocler/003_*.sql`).
      Alanlar `spec/20-sema.md` §7: `endpoint` **tekil**, `p256dh`, `auth`,
      `fail_count`, `last_ok_at`. Kullanıcı başına birden fazla abonelik olur
      (telefon + masaüstü), tekillik `endpoint` üzerinde.
- [ ] VAPID anahtarları → `.env`, oradan agenix'e. Koda gömme, repoya koyma.
      Üretimi `spec/40-push.md`'de yazılı. Anahtar değişirse **tüm abonelikler
      geçersizleşir**, tabloyu temizlemek gerekir.
- [ ] `GET /vapid` — public key. Kimlik gerektirmez, `config.SHARED_PATHS`
      mantığına girer.
- [ ] `POST /subscribe` — abonelik kaydı, `endpoint`'e göre upsert. CSRF kapısından
      geçer (güvensiz metot).
- [ ] Gönderim tarafı: hangi olay bildirim doğurur? En dar başlangıç — sana
      atanan eylem. Bildirim üretimi olay akışına bağlanmalı, ayrı bir "bildirim
      motoru" kurulmamalı.
- [ ] **Ölü abonelik temizliği.** Push servisi `404`/`410` dönerse satırı **sil**;
      başka hatada `fail_count` artır, eşiği geçince sil. `spec/40-push.md` bunu
      "en sık atlanan şey" diye işaretliyor.
- [ ] `tag` alanını kullan — aynı tag'li bildirimler üst üste yığılmaz,
      birbirini günceller.

### Bildirim = push + uygulama içi, TEK olaydan

Bugün ikisi ayrı boru ve birbirine bağlı değil:

```
gerçek olay  →  events satırı  →  /bildirimler sayfası
                              ↘   push gönderimi        ← BU BAĞLANTI YOK
/test/bildirim ──────────────────→ push gönderimi
```

`/bildirimler` sayfası `events`'ten türetiliyor (`mobile_notifs`), deneme ucu
ise hiçbir şey yazmadan doğrudan push servisine gidiyor. O yüzden deneme
bildirimi telefona düşüyor ama uygulama içinde görünmüyor — beklenen, ama
gerçek bildirimlerde **olmaması gereken** davranış.

**Kural:** gönderim bağlanırken bildirim TEK olaydan doğsun — aynı olay hem
`events` satırını yazsın hem push'u tetiklesin. İki ayrı üretim yolu olursa
telefona düşen ile uygulamada görünen kaçınılmaz olarak ayrışır.

```
biri sana eylem atar
  → service.log(...)      events'e yazar     (zaten var)
  → push.gonder(...)      telefona yollar    (eksik)
```

Bunun yan etkisi: `tag` alanı doğal olarak kart kimliği olur
(`tag=kart-<id>`), telefonda aynı karta ait bildirimler üst üste yığılmaz.

Not: `notif_badge()` bugün "son 24 saat" sayıyor, okundu bilgisi yok
(`spec/20-sema.md` §6'daki gerçek bildirim tablosu Faz 3'e bırakılmış). Push
bağlanınca "okundu" derdi de gündeme gelir.

### Tuzaklar

- **iOS'ta izin tarayıcıdan istenemez.** Sıra: Safari → Paylaş → Ana Ekrana Ekle
  → uygulamayı ana ekrandan aç → izin ver. Android/Chrome doğrudan çalışır.
  Test ederken bu sırayı atlarsan "çalışmıyor" sanırsın.
- `pywebpush` → `http-ece` bağımlılığı bazı ortamlarda wheel derlemesinde
  patlıyor. Konteynerde `python:3.12-slim` kullanıyoruz; `requirements.txt`'e
  eklerken imajın kurulduğunu doğrula, gerekirse saf Python `webpush`'a geç.
- Bildirim içeriği hassas olabilir — kart başlığı bildirim olarak kilit
  ekranında görünür. Ne yazılacağına baştan karar ver.

---

## 2. Kazanım Ağacı → veri yönetimi sayfası

**Durum:** `ready: False`, sayfa "YAKINDA" placeholder'ı gösteriyor.

Mevcut plan sadece ağaç düzenlemeyi kapsıyor (düğüm ekle/adlandır/taşı/sil).
İstenen daha geniş: **tek ekrandan yapı + pillar + üye ataması**. Yani modülün
adı ve kapsamı değişiyor, `MODULES` kaydındaki `desc` ve `plan` güncellenmeli.

### Yapılacak

- [ ] Ağaç düzenleme: düğüm ekle, adlandır, taşı, sil. Değişiklik `nodes`
      üzerinde anında uygulanır.
- [ ] **Taşımada döngü koruması:** hedef, taşınan düğümün alt ağacında olamaz.
- [ ] Yapı her değiştiğinde `TreeIndex` komple yeniden kurulur ve
      `nodes.tin/tout` tek `UPDATE` ile yazılır. Ağaç süreç belleğinde tutuluyor
      — bu yüzden `--workers 1` şart, konteynerde de öyle.
- [ ] `is_editor` olmayanın değişikliği `change_requests`'e düşer, `prev_state`
      ile geri alınabilir (`spec/20-sema.md` §4).
- [x] **Pillar yönetimi — KARARA BAĞLANDI** (göç `012_cards_pillar_pins.sql`).
      Ne ayrı tablo ne serbest metin: pillar'ın *tanımı* ağaçta
      (`node_type='pillar'`), kayıtla bağı **ortogonal bir FK**
      (`items.pillar_node_id`). Kayıt hiyerarşide bir yerde durur, ayrıca bir
      pillar'a sayılır — ikisi birbirinin atası olmak zorunda değil.
      Süzme `filters.PillarFilter`, kart alanı `card_fields.html`.
- [ ] Üye ataması: `users.scope_node_id` (kimin hangi dalda yetkisi var) ve
      `team_members` (takım + rol) buradan düzenlenir.

### Karar bekleyen

- ~~**Pillar bir sütun mu, bir tablo mu?**~~ **Kapandı**: `items.pillar_node_id`
  → `nodes(id)`, `node_type='pillar'` olanlara. Yazım varyasyonu yok (FK), pivot
  ekranı pillar'ı gerçek bir boyut olarak sayabilir. Pillar node'unun kendi
  sayfası (ortak dökümanlar, eğitim içerikleri) hâlâ yazılmadı — bu karar onu
  engellemiyor, besliyor.
- **Bu ekran ile Yönetim Paneli'nin sınırı ne?** Üye ataması ikisinde de
  geçiyor. Yetki bayrakları (`is_admin`/`is_editor`) panelde, kapsam ve takım
  üyeliği burada olabilir — ya da hepsi tek yerde. Bölmeden önce netleştir,
  yoksa iki ekran aynı işi iki farklı akışla yapar.

---

## 3. Yönetim Paneli — önce sadece üye/admin ekleme

**Durum: YAZILDI** (`ready: True`, `/admin`, spec/71-yonetim-paneli.md).
Kullanıcı eklemenin tek yolu `tools/user.py` olmaktan çıktı — panel aynı
mantığı çağırıyor (`shared/users.py`), script ince bir CLI'a düştü.

### Yapılan (dar kapsam — sadece kullanıcılar)

- [x] Kullanıcı listesi: e-posta, ad, yetki, durum, son görülme.
- [x] Kullanıcı ekleme formu — `shared/users.add_user`, `tools/user.py add`
      ile AYNI fonksiyon.
- [x] Kapatma / açma — `is_active` çevirir, `security_events`'e
      `event_type='deactivation'` satırı yazar. Kullanıcıyı silmez.
- [x] `is_admin` bayrağı (panelden). `is_editor` hâlâ geçiş bayrağı,
      dokunulmadı — ayrı bir göç ister (aşağı bkz.).
- [x] Yetki sunucuda: her uç `_require_manage_users` / `_require_admin`
      kendi başına kontrol ediyor, panel sadece görünen yüz.
- [x] **Kilitlenme koruması**: kendi `is_admin`'ini kapatamaz, son aktif
      admin kapatılamaz/demote edilemez (`shared/users.py`, `tests/test_roles.py`).

### Sonraya bırakılanlar (değişmedi)

Takım üyelikleri, `change_requests` kuyruğu (onayla/reddet), kapsam düğüm
ataması. Bunlar madde 2 ile çakışıyor — sınır kararı verilmeden ikisini
birden yazma.

### Yetki kapsamları ve roller (Discord modeli) — YAZILDI

Model uygulandı (göç 008, `shared/scope.py`, spec/71-yonetim-paneli.md §5):

- **Scope** = kod tarafında sabit liste (`shared/scope.py SCOPES`), veritabanı
  `scopes` tablosuyla FK'lenmiş — uydurma scope yazılamaz. Yeni scope eklemek
  kod değişikliği + DML göçü.
- **Rol** = bir scope demeti, sığ. `roles`/`role_scopes`/`user_roles`.
  **Flatten yok**: `active_scopes()` `user_scopes ∪ (user_roles ⋈ role_scopes)`
  birleşimini OKUMA ANINDA hesaplıyor — rol düzenlemesi mevcut sahiplerine
  otomatik yansır, rol silmek yalnız o rolden gelen scope'ları alır (tek tek
  verilmiş olan kalır).
- Rol oluşturma/silme **yalnız admin** — `manage_users` yalnız var olan rolü
  atayabilir/alabilir (ayrıcalık yükseltmeyi kapatmak için).
- Düğüm izni (`edit_nodes`) kod seviyesinde korunur (`shared/scope.py`), FK ile
  değil — rolden gelen scope'un `user_scopes`'ta karşılığı olmayabilir.

**Karar verildi:** `is_admin` kalıyor (tepe, tek kaynak). `is_editor` henüz
kapsama çevrilmedi — geçiş şimi (`_can_edit_structure`, `routes.py`) duruyor,
tek yönlü göç hâlâ TODO.

---

## 4. Medya ekleri (kart sohbeti + takım duvarı) — YAZILDI

**Durum: YAZILDI** (`spec/20-sema.md` §3b, göç `009_attachments.sql`).
Kaynak uyarlamasındaki açık nokta 1 (`spec/60-kaynak-uyarlama.md` 2.4, 2.7)
karara bağlandı ve o karar uygulandı: kalıcı saklama, mesaj başına tek
görsel, 10 MB, yalnızca JPEG/PNG/WebP/GIF, dosyalar Pi'nin SATA diskinde
(bind mount, `deploy/nix-ekiptakip-media.nix`).

### Yapılan

- [x] `attachments` tablosu, `shared/media.py` (doğrula, EXIF-uyumlu
      döndür, yeniden kodla, küçük resim üret).
- [x] Kart sohbeti ve takım duvarı — `image: UploadFile` mevcut mesaj
      uçlarına eklendi, yeni uç açılmadı.
- [x] Servis uçları `/media/{id}` ve `/media/{id}/thumb` — kimlik
      doğrulamalı, `Content-Type` veritabanından sabit, `nosniff`.
- [x] Yumuşak silme: yazar veya admin siler, olay akışında
      "(görsel silindi)" damgası kalır, blob gerçekten silinir.
- [x] Dockerfile + `docker-compose.prod.yml`: `/data/media` (uid 10001),
      host'tan bind mount (`EKIPTAKIP_MEDIA_DIR`), nginx şablonları 10 MB'a
      açıldı (`client_max_body_size 12m`).

### Bilerek dışarıda bırakılanlar (kapsam bu turda genişlemedi)

- **Lightbox yok.** Küçük resme tıklayınca tam görsel yeni sekmede açılır;
  sayfa içi büyütme/gezinme ayrı bir JS işi (`spec/` sözleşmesi, "no
  lightbox — that needs JS we are not writing yet").
- **Mesaj başına tam bir dosya.** Şema birden çoğu destekler
  (`event_id` FK tekil değil) ama arayüz ve rotalar tek dosyayla sınırlı;
  çoklu ek ayrı bir iş.
- **Çöp toplama / saklama aracı yok.** Saklama kararı **kalıcı** —
  otomatik silme yok, elle silinen dosyaların blob'u anında gider ama
  "şu tarihten eski, hiç açılmamış ekleri temizle" gibi bir araç yazılmadı;
  gerekirse ayrı bir iş.
- **`dosyalar` modülü hâlâ yazılmadı** (`spec/00-index.md`,
  `spec/60-kaynak-uyarlama.md` 2.7). Kılavuz/etiket kütüphanesi ayrı bir
  ekran — artık belirsiz bir karara değil, yapılmamış bir işe bağlı
  bekliyor.
- **SATA diskindeki medya HİÇBİR ŞEY TARAFINDAN YEDEKLENMİYOR.**
  `services.restic.backups.yerel` (`~/nix` `modules/configuration.nix`)
  `/home/efe/sata`'yı kendini yedeklememek için **bilerek** hariç tutuyor —
  ama bu, o diskteki `ekiptakip/media` alt dizininin de yedek dışı kaldığı
  anlamına geliyor. Disk arızası = tüm ekler gider. Üçüncü bir yedek hedefi
  (ayrı disk/uzak sunucu) `~/nix`'in kendi TODO'su, bu depodan çözülmez —
  bkz. `deploy/DOCKER.md` "Yedek".

---

## Kural: mobil arayüz kendi alan adında, kökte

`/m` diye bir yol **yoktur** — ne dışarıda ne kodda. Mobil rotalar kökte
tanımlıdır (`/`, `/search`, `/actions`…), masaüstü rotaları da öyle; ayrım
**Host'a göre** yapılır (`app.py`: `sadece_mobil` / `sadece_masaustu`).

- Yayında: `app.<alan>` mobil, `dashboard.<alan>` masaüstü.
- Yerelde yapılandırma olmadan: Host'un ilk etiketi `app` ise mobil —
  yani `app.localhost:8000` mobil, `localhost:8000` masaüstü.
- Çakışan tek yol `/`; onu `app.py`'deki `kok()` Host'a göre dağıtır.
- Ortak yollar (`/login`, `/manifest.json`, `/sw.js`, `/static/…`, `/vapid`,
  `/subscribe`) Host kapısından muaftır — olmasalardı mobil alan adından giriş
  yapılamazdı.

Yeni bir mobil rota eklerken yolu **kökten** yaz. Kullanıcıya gösterilen
adreste de, rota tanımında da önek yoktur.

---

## Notlar

- Yeni bağımlılık `requirements.txt`'e girer (tek kaynak; Makefile ve Dockerfile
  ikisi de onu okuyor).
- Yeni göç `shared/gocler/` altına numaralı dosya olarak; açılışta kendiliğinden
  koşar, elle `alter table` yok.
- Deploy akışı: depoya push → `nix flake update teamtracker --flake ~/nix` →
  `nixos-rebuild switch`. Ayrıntı `deploy/DOCKER.md`.
- `make seed` / `shared.seed` **yıkıcıdır** — `users` dahil dokuz tabloyu
  truncate eder. Kurulu sistemde çalıştırma.
