# Yapılacaklar

alpha-0.1 yayında (NixOS VM, Docker yığını, Google girişi çalışıyor). Sıradaki
üç iş. Öncelik sırası yukarıdan aşağı: **3 → 2 → 1**, gerekçesi her maddede.

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
- [ ] `POST /abone` — abonelik kaydı, `endpoint`'e göre upsert. CSRF kapısından
      geçer (güvensiz metot).
- [ ] Gönderim tarafı: hangi olay bildirim doğurur? En dar başlangıç — sana
      atanan eylem. Bildirim üretimi olay akışına bağlanmalı, ayrı bir "bildirim
      motoru" kurulmamalı.
- [ ] **Ölü abonelik temizliği.** Push servisi `404`/`410` dönerse satırı **sil**;
      başka hatada `fail_count` artır, eşiği geçince sil. `spec/40-push.md` bunu
      "en sık atlanan şey" diye işaretliyor.
- [ ] `tag` alanını kullan — aynı tag'li bildirimler üst üste yığılmaz,
      birbirini günceller.

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
- [ ] **Pillar yönetimi.** `items.pillar` bugün serbest `text` — bir kayıt
      listesi yok, yazım hatası yeni pillar yaratıyor. Karar gerekiyor:
      ayrı tablo mu, `node_type` gibi serbest metin mi? IWS'i tek pillar'la
      başlatacaksan bu ekranın ilk gerçek işi o tek pillar'ı tanımlamak.
- [ ] Üye ataması: `users.scope_node_id` (kimin hangi dalda yetkisi var) ve
      `team_members` (takım + rol) buradan düzenlenir.

### Karar bekleyen

- **Pillar bir sütun mu, bir tablo mu?** Bugün `items.pillar text`. Tek pillar'la
  başlanacaksa serbest metin yeterli görünür, ama pivot ekranı pillar'ı bir
  boyut olarak sayacak — yazım varyasyonu orada bozuk kırılım demek.
- **Bu ekran ile Yönetim Paneli'nin sınırı ne?** Üye ataması ikisinde de
  geçiyor. Yetki bayrakları (`is_admin`/`is_editor`) panelde, kapsam ve takım
  üyeliği burada olabilir — ya da hepsi tek yerde. Bölmeden önce netleştir,
  yoksa iki ekran aynı işi iki farklı akışla yapar.

---

## 3. Yönetim Paneli — önce sadece üye/admin ekleme

**Durum:** `ready: False`. Kullanıcı eklemenin tek yolu bugün
`tools/kullanici.py`, o da sunucuda kabuk açmayı gerektiriyor:

```bash
sudo docker exec ekiptakip-app python tools/kullanici.py ekle biri@ornek.com "Ad" --admin
```

**Bu yüzden önce bu geliyor.** Diğer iki iş güzelleştirme; bu, kullanılabilirlik
eşiği: kulübe birini almak için sunucuya girmek gerekmemeli.

### Yapılacak (dar kapsam — sadece kullanıcılar)

- [ ] Kullanıcı listesi: e-posta, ad, yetki, durum, kapsam. Zaten
      `tools/kullanici.py listele`'nin bastığı bilgi.
- [ ] Kullanıcı ekleme formu — betiğin `ekle` komutuyla **aynı iş mantığını**
      çağırsın, mantık kopyalanmasın. Bugün mantık betiğin içinde;
      `shared/`'a taşımak gerekebilir (`shared/` veri modelinin tek sahibi).
- [ ] Kapatma / açma — `is_active` çevirir ve `guvenlik_olaylari`'na
      `tur='pasiflestirme'` satırı yazar. Kapatmak kullanıcıyı **silmez**;
      kayıtlarındaki izleri kalır, oturumu bir sonraki istekte düşer.
- [ ] `is_admin` / `is_editor` bayrakları.
- [ ] **Yetki sunucuda kontrol edilir.** Panelin kendisini gizlemek yetmez; her
      uç ayrıca `is_admin` bakmalı. Panel sadece görünen yüz.

### Sonraya bırakılanlar

Takım üyelikleri, `change_requests` kuyruğu (onayla/reddet), kapsam düzenleme.
Bunlar madde 2 ile çakışıyor — sınır kararı verilmeden ikisini birden yazma.

### Yetki kapsamları ve roller (Discord modeli)

Bugün yetki üç kaba bayrakta: `is_admin`, `is_editor`, `scope_node_id`. İstenen
model daha ince:

- **Kapsam (scope)** = tek tek yetkiler. "Kayıt açabilir", "düğüm ekleyebilir",
  "kullanıcı ekleyebilir", "takım yönetebilir" gibi adlandırılmış izinler.
- **Rol** = bir kapsam demeti. Yönetim panelinden oluşturulur, adlandırılır,
  içine istenen kapsamlar konur — Discord'un rol oluşturma ekranındaki gibi.
- Kullanıcıya **rol** verilebilir; ayrıca **rolden bağımsız tek tek kapsam** da
  verilebilir. İkisi birleşir.
- Yeni rol tanımlamak yönetim panelinden yapılır, kod değişikliği gerektirmez.

Şema tarafı (henüz yok): `roles`, `role_scopes`, `user_roles`, `user_scopes`.
Kapsam adları koda gömülü bir liste olur (uydurma kapsam kabul edilmesin),
roller ve atamalar veritabanında.

**Karar bekleyen:** mevcut `is_admin` / `is_editor` bayrakları kalsın mı, yoksa
birer kapsama mı dönüşsün? İkisini birden tutmak "yetki nereden geliyor"
sorusunu iki kaynağa böler — `shared/auth.py`'deki `can_edit_item` zaten beş
yolu tek fonksiyonda topluyor, oraya altıncı bir kaynak eklemek pahalı.
Geçişte en güvenli yol: bayrakları kapsamlara çeviren tek yönlü bir göç.

---

## Kural: mobil arayüz `/m` değil, alt alan adı

Mobil yüz **`app.<alan>` alt alan adında, kökte** duruyor —
`MobileHostPrefix` gelen `/ara` isteğini iç yolda `/m/ara`'ya çeviriyor ama
adres çubuğunda `/m` görünmüyor. `/m` yalnızca **tek alan adı modunun**
(alan adı değişkenleri tanımsızken) yedeği.

Bu yüzden:

- Bildirim adresi, e-posta bağlantısı, paylaşılan URL — hiçbirine `/m`
  **gömme**. `config.mobil_yol()` kullan (istek gerektirmez, yapılandırmadan
  modu bilir); şablonlarda `config.mp(request)` zaten var.
- Yeni bir mobil rota eklerken yolu `/m/...` diye yazmak doğru (iç yol öyle),
  ama kullanıcıya **gösterilen** adres asla `/m` içermemeli.
- Önek ileride tamamen kaldırılabilir; sabit yazılmış her `/m` o gün 404 olur.

Bir kez ısırdı: push bildiriminin varsayılan hedefi `/m` yazılmıştı, alt alan
adında adres çubuğuna sızıyordu. `shared/push.py` artık `mobil_yol()`
kullanıyor, iki mod da testle sabitlendi.

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
