# 70 — Güvenlik ve yetkilendirme

Faz 2'nin çekirdeği: **kimlik gerçek olacak.** Bugün `uid` çerezi imzasız — çerezi elle
yazan herkes istediği kullanıcı olabiliyor. Yetki mantığı baştan doğru yerde durduğu için
(`shared/auth.py`) değişecek yer dar; bu belge neyin değişeceğini ve **neyin bilerek
yapılmayacağını** yazar.

Bağlam: öğrenci kulübü, 5–50 kişi, tek süreç, SQLite, cloudflared tüneli arkasında.
Depo **public**.

---

## 1. Tehdit modeli

Kime karşı savunuyoruz, sırayla:

| # | Tehdit | Bugün ne oluyor | Kapatan |
|---|---|---|---|
| T1 | Adresi bilen yabancı içeri giriyor | Kapı yok, herkes girer | §2 kimlik |
| T2 | İçerideki biri başkası gibi davranıyor | `uid` çerezini elle yaz, admin ol | §2 imzalı oturum |
| T3 | Kapsamı dışındaki kaydı değiştiriyor | **Kapalı** — `can_edit_item` sunucuda, 403 dönüyor | §3 |
| T4 | Başka sitedeki sayfa, tarayıcımdaki oturumla istek atıyor (CSRF) | Açık | §4 |
| T5 | Kayıt içeriğine script gömülüyor (XSS) | **Kapalı** — Jinja autoescape, `\|safe` yok | §5 |
| T6 | SQL enjeksiyonu | **Kapalı** — parametreli sorgu, alan adı beyaz listeden | §5 |
| T7 | Kaba kuvvet / oturum tahmini | Açık | §4, §6 |
| T8 | Sırlar depoya sızıyor | `.gitignore` var, sır yok | §7 |
| T9 | Kim ne yaptı bilinmiyor | Alan değişiklikleri `events`'te; giriş/yetki reddi kaydı yok | §8 |
| T10 | Ayrılan üye erişimini koruyor | Kullanıcı silinemiyor/pasifleştirilemiyor | §2.4 |

**Kapsam dışı (bilerek):** iki faktörlü kimlik, cihaz listesi/oturum yönetim ekranı, WAF,
alan bazlı şifreleme, sır rotasyonu otomasyonu. Kulüp ölçeğinde maliyeti faydasından fazla;
gerekirse ayrı bir spec.

---

## 2. Kimlik: Google ile giriş

### 2.1 Neden Google

Herkeste zaten hesap var, parola saklamıyoruz (saklamadığın sırdan sorumlu olmazsın),
ücretsiz. Kulübün Google Workspace hesabı varsa uygulama **Internal** kurulur: kullanıcı
sınırı yok, doğrulama gerekmez, yalnızca o organizasyonun hesapları girer.

Kapsam **yalnızca `openid email profile`**. Takvim/Drive/Gmail kapsamı isteme — hassas
kapsam Google doğrulama incelemesi getirir ve bize gereği yok.

### 2.2 Akış

```
/giris          → state üret, Google'a yönlendir
/giris/callback → state doğrula → kod ↔ token → id_token doğrula → e-posta
                → users tablosunda var mı? → oturum çerezi yaz → geldiği yere dön
/cikis          → çerezi sil (POST, GET değil)
```

- `state` imzalı oturumda tutulur, callback'te karşılaştırılır (CSRF'in OAuth ayağı).
- `id_token` **kütüphaneyle doğrulanır** (imza, `iss`, `aud`, `exp`). Elle JWT ayrıştırma yok.
- Dönüş adresi (`next`) **yalnızca yol** olarak kabul edilir (`/gorevler`), tam URL değil —
  açık yönlendirme kapanır. Bilinmeyen değer → `/`.
- Redirect URI'lar HTTPS ve iki site için ayrı ayrı kayıtlı olur; her site kendi
  callback'ini karşılar, siteler arası atlama olmaz.

### 2.3 Kim girebilir — davetli listesi

**Karar: `users.email` tablosunda kayıtlı olmayan giremez.** Bilinmeyen e-posta giriş
ekranında "yöneticine söyle" mesajı görür, kayıt oluşmaz.

Gerekçe: aksi hâlde kapsamsız kullanıcılar birikir ve "atanmamış havuzu herkese açık"
kuralı (spec/10) tanımadığımız kişilere de açılır. Yetki ve kapsam üyelik anında verilir.

Yeni sütunlar:

| Sütun | Ne için |
|---|---|
| `users.google_sub` | Google'ın değişmeyen kullanıcı kimliği. İlk girişte yazılır, sonra e-posta değişse de hesap aynı kalır |
| `users.is_active` | 0 ise giriş yok **ve varolan oturum anında geçersiz** |
| `users.last_login_at` | Ölü hesapları görmek için |

### 2.4 Oturum

**İmzalı çerez, sunucu tarafı oturum tablosu yok.** İçinde yalnızca `user_id` ve veriliş
zamanı durur; kullanıcı satırı her istekte veritabanından okunuyor (zaten öyleydi), bu
yüzden **iptal anında işler**: `is_active = 0` yapılan kişi bir sonraki istekte dışarıda.

| Nitelik | Değer | Neden |
|---|---|---|
| imza | `EKIPTAKIP_SECRET_KEY` (`.env`) | anahtar değişirse herkes düşer — acil durum düğmesi |
| `HttpOnly` | evet | JS okuyamaz |
| `Secure` | HTTPS'te evet | düz HTTP'de gitmez |
| `SameSite` | `Lax` | siteler arası POST/PATCH taşınmaz (T4'ün büyük kısmı) |
| `Domain` | `.<alan>` | bir giriş, iki site |
| ömür | 30 gün, her istekte yenilenmez | telefondaki uygulama sürekli giriş sormasın |

Çıkış `POST /cikis` — GET olsaydı `<img src="/cikis">` ile herkesi attırırdın.

### 2.5 Sahte kimlik (geliştirme)

`POST /switch/{user_id}` **kalkıyor.** Yerinde `EKIPTAKIP_AUTH=sahte` ortam değişkeni
varsa devreye giren geliştirme modu var: ilk kullanıcı olarak oturum açılır, `/switch`
çalışır. Bu değişken yoksa **gerçek kimlik zorunlu**.

Kurallar: açılışta uyarı basılır; `EKIPTAKIP_HOST_APP` tanımlıysa (yani yayın kurulumu)
sahte mod **açılmayı reddeder ve süreç durur**. Testler bu modu kullanır.

---

## 3. Yetkilendirme

Model değişmiyor, bugünkü doğru (spec/10-kararlar). Bu belge onu **sabitler**:

| Katman | Ne verir | Nereden gelir |
|---|---|---|
| Kart yetkisi | durum/öncelik/atama değiştirme, mesaj yazma | sorumlu, açan, karta dahil edilen, ya da kapsam alt ağacı |
| Yapısal yetki | düğüm ekle/adlandır/taşı/sil | `is_admin`, ya da `is_editor` + kapsam |
| Yönetim | kullanıcı ekle/pasifleştir, kapsam ata | `is_admin` |

Kurallar:

1. **Yetki her yazma ucunda, sunucuda kontrol edilir.** Şablon yalnızca görsel olarak kilitler.
2. Karta dahil edilen kişi **yalnızca o kartta** yetkilidir; yetki kapsama sızmaz.
3. Atanmamış kayıt kapsamı ne olursa olsun **görülebilir ve üstlenilebilir** — sahipsiz iş
   kaybolmasın diye. Bu, davetli listesi (§2.3) sayesinde güvenli.
4. Okuma yetkisi bugün ayrık değil: giriş yapan herkes bütün kayıtları **görür**.
   Bilinçli: kulüpte gizli kayıt kavramı yok. Değişirse ayrı karar gerekir.
5. Yeni bir yazma ucu eklendiğinde yetki kontrolü **ucun ilk satırında** olur.

---

## 4. CSRF

`SameSite=Lax` çoğu vektörü kapatıyor ama tek başına yeterli sayılmaz (eski tarayıcılar,
üst düzey `GET` navigasyonları, aynı site alt alan adları).

**Karar: imzalı oturuma bağlı çift gönderimli token.**

- Token oturumda üretilir, sayfada `<body hx-headers='{"X-CSRF-Token": "..."}'>` ile durur.
  HTMX'in bütün istekleri başlığı otomatik taşır; ayrıca form alanı da desteklenir.
- Ara katman `POST/PATCH/PUT/DELETE` isteklerinde token'ı oturumdakiyle karşılaştırır,
  eşleşmezse **403**.
- Muaf: `/giris`, `/giris/callback` (oturum yokken çalışır, kendi `state`'i var).
- Token oturum ömrü boyunca sabit; oturum yenilenince yenilenir.

---

## 5. Girdi, çıktı, enjeksiyon

Bugün doğru olanlar korunacak, teste bağlanacak:

- **SQL:** bütün değerler parametreyle. SQL'e giren tek metin interpolasyonu alan adıdır ve
  `EDITABLE` beyaz listesinden gelir. Sıralama sütunu sabit sözlükten.
- **FTS:** kullanıcı metni MATCH ifadesine birleştirilmez; kelimeler ayıklanıp `"kelime"*`
  biçimine çevrilir.
- **XSS:** Jinja `select_autoescape`, hiçbir yerde `|safe` yok. Yeni şablonda `|safe`
  kullanılacaksa gerekçesi yorumla yazılır.
- **CSP:** `script-src 'self'` hedef — bunun için satır içi `<script>` blokları
  `static/base.js`'e taşınır. `style-src` `'unsafe-inline'` kalır (şablonlarda
  `style="background:{{ user.color }}"` var); kaldırmak için renkleri veri
  özniteliğine taşımak gerekir, o ayrı iş.
- **Güvenlik başlıkları uygulamada** üretilir (yalnız nginx'te değil) ki tünelsiz/nginx'siz
  çalıştırıldığında da geçerli olsunlar. nginx yalnızca **statik dosyalar** için başlık
  ekler; vekil yolunda uygulamanınkini ezmez.

---

## 6. Hız sınırlama

Kulüp ölçeğinde tam bir sınırlayıcıya gerek yok. Yalnızca **giriş uçları**: IP başına
dakikada 10 deneme, aşılırsa 429. Süreç belleğinde sayaç yeterli (`--workers 1`).

Yazma uçları için sınır **koymuyoruz**: davetli listesi zaten kapıyı daraltıyor, yanlış
pozitif riski faydadan büyük.

---

## 7. Sırlar

`.env`, git'e girmez. Gerekenler:

| Değişken | Ne | Yoksa |
|---|---|---|
| `EKIPTAKIP_SECRET_KEY` | oturum imzası | yayında **açılmaz**; geliştirmede geçici üretilir ve uyarı basılır |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth istemcisi | gerçek kimlik açılmaz |
| `EKIPTAKIP_COOKIE_DOMAIN` | iki sitede tek oturum | çerez host'a özel kalır |

Kurallar: sır koda gömülmez, log'a yazılmaz, hata sayfasında görünmez. `.env.ornek`
depoda durur — **değerler değil, isimler**. Anahtar sızarsa `SECRET_KEY` değiştirilir,
bütün oturumlar düşer.

---

## 8. Denetim izi

Alan değişiklikleri zaten `events`'e `sistem` olayı olarak yazılıyor. Eksik olan **güvenlik
olayları**: yeni tablo `guvenlik_olaylari` (zaman, tür, aktör, e-posta, IP, ayrıntı).

Yazılacak türler: `giris`, `giris_reddi` (listede olmayan e-posta), `cikis`,
`yetki_reddi` (403 dönen yazma denemesi), `pasiflestirme`.

Kişisel veri: IP ve e-posta tutulur, gövde tutulmaz. Kayıtlar 90 gün sonra silinebilir
(temizlik işi ayrı, şimdilik elle).

---

## 9. Yayın katmanının payı

| Katman | Sorumluluğu |
|---|---|
| Cloudflare Access (varsa) | kapıda ikinci bir kimlik; uygulama **yine de** kendi kimliğini uygular |
| nginx | TLS sonlandırma sonrası başlıklar (statikte), `default_server` ile bilinmeyen host reddi |
| uygulama | kimlik, yetki, CSRF, oturum, denetim izi |

**Kural: uygulama, önündeki katmana güvenerek kontrolü atlamaz.** Access kalkarsa
uygulama savunmasız kalmamalı.

---

## 10. Kabul kriterleri

Bu maddeler teste bağlanır:

1. Oturumsuz istek korumalı sayfada giriş ekranına yönlenir; API ucunda **401/403**.
2. Çerez içeriği elle değiştirilirse (imza bozulur) oturum **geçersiz** olur.
3. `users` tablosunda olmayan e-posta ile giriş **reddedilir**, kullanıcı **oluşmaz**,
   `giris_reddi` kaydı düşer.
4. `is_active = 0` yapılan kullanıcının varolan oturumu **bir sonraki istekte** ölür.
5. CSRF token'ı olmayan/yanlış olan `POST/PATCH` **403** döner; doğru token geçer.
6. Kapsam dışı kartta yazma denemesi **403** döner (mevcut testler korunur) ve
   `yetki_reddi` kaydı düşer.
7. `state` uyuşmayan callback **reddedilir**; `next` parametresine tam URL verilirse
   yönlendirme **yapılmaz**.
8. `EKIPTAKIP_HOST_APP` tanımlıyken `EKIPTAKIP_AUTH=sahte` ile açılış **başarısız olur**.
9. Yanıt başlıklarında CSP, `X-Content-Type-Options`, `Referrer-Policy` bulunur ve
   `script-src` içinde `unsafe-inline` **yoktur**.
10. Giriş ucuna dakikada 10'dan fazla istek **429** döner.

---

## 11. Uygulama sırası

Her adım ayrı commit, her commit sonrası temiz context'li denetim:

1. **Şema + sırlar**: `google_sub`, `is_active`, `last_login_at`, `guvenlik_olaylari`;
   `.env.ornek`; `config` içinde sır okuma ve yayında zorunluluk kontrolü.
2. **Kimlik**: Google OIDC uçları, imzalı oturum, davetli listesi, `/switch` kaldırma,
   sahte mod bayrağı.
3. **CSRF**: token üretimi, HTMX başlığı, ara katman, muafiyetler.
4. **Sertleştirme**: satır içi script'lerin `base.js`'e taşınması, uygulamada güvenlik
   başlıkları, giriş hız sınırı, denetim izi yazımı.
5. **Testler + belge**: kabul kriterlerinin karşılığı, `deploy/` ve README güncellemesi.

Sıra önemli: kimlik olmadan CSRF token'ının tutunacağı oturum yok.
