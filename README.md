# EkipTakip — alpha-0.1

Ekip için hata/görev takibi: hiyerarşi + kayıtlar + kart içi sohbet + alan değişiklikleri.
**İki site, tek süreç, ortak veritabanı:**

| Site | Ne | Yayında |
|---|---|---|
| **Masaüstü** | ana sayfa (modül seçimi), görev yöneticisi (tablo + kart + sohbet) | `dashboard.<alan>` |
| **Mobil** | yapılacaklar, arama, eylemler, bildirimler — ana ekrana eklenebilir (PWA) | `app.<alan>` |

Yığın: Python 3.12 + FastAPI + Jinja2 + HTMX + SQLite, ham SQL. ORM yok, JS framework yok.

## Çalıştır

```bash
make up          # kurulum + tohum + sunucu → http://127.0.0.1:8000
```

Sonraki günler `make dev` yeter. `make` yazınca komut listesi çıkar:

| Komut | Ne yapar |
|---|---|
| `make up` | sıfırdan kaldırır: kurulum + tohum (veritabanı yoksa) + sunucu |
| `make dev` / `make run` | sunucu, `--reload` açık / kapalı (`make dev PORT=9000`) |
| `make seed` / `make reseed` | tohumlar / sıfırlayıp tohumlar — **varolan `ekiptakip.db` silinir** |
| `make test` | `pytest tests -q` |
| `make check` | sunucu ayaktayken uçların durum kodlarını basar |
| `make clean` / `make distclean` | veritabanı + önbellek / üstüne sanal ortam |

Tek alan adı modunda masaüstü `/`, mobil `/m` altındadır. İki alan adına ayırmak ve
yayına almak: `deploy/README.md`.

`--workers 1` şart: ağaç indeksi süreç belleğinde (`spec/10-kararlar.md`).

## Yapı

```
app.py       giriş noktası
shared/      ortak çekirdek: db, şema, tohum, ağaç, kimlik, yetki, CSRF,
             sertleştirme, iş mantığı, arama, palet
sites/       dashboard/ ve mobil/ — her biri kendi rotaları, şablonları, CSS'i
spec/        kararlar, şema, ekran çözümlemeleri
deploy/      cloudflared + nginx + systemd
tools/       yardımcı betikler: PWA ikonları, davetli listesi yönetimi
tests/       69 test: kimlik, oturum, CSRF, yetki (403), FTS, iki alan adı, PWA
```

Ayrıntı ve gerekçeler: **`spec/50-yapi.md`**.

## Nereye bakmalı

| Soru | Dosya |
|---|---|
| Neden böyle yazıldı? | `spec/10-kararlar.md` |
| Veri modeli ne, ne eksik? | `spec/20-sema.md` |
| Mobil ekranlar nereden uyarlandı? | `spec/30-mobil.md` |
| Push ne durumda? | `spec/40-push.md` |
| Klasör yapısı, ayrık veritabanı | `spec/50-yapi.md` |
| Kimlik, yetki, tehdit modeli | `spec/70-guvenlik.md` |
| Yayına alma, Google OAuth kurulumu | `deploy/README.md` |
| Yeni ekran çözümlemesi nasıl yazılır | `spec/README.md` |

## Sahte kullanıcılar (Faz 1)

| Kişi | Yetki | Kapsam |
|---|---|---|
| Efe (varsayılan) | editor | Malzeme Temini |
| Selin | admin | tüm ağaç |
| Deniz | — | Üretim Hattı A |

Masaüstünde rayın altındaki avatardan değiştirilir (`POST /switch/{user_id}`, çerez `uid`).

## Bilgi güvenliği

Bu depo **public**. alpha-0.1 bir prototip; aşağıdaki durum bilerek böyledir.

- Depoda sır **yok**: parola, API anahtarı, token, VAPID anahtarı tutulmuyor.
- `.gitignore` veritabanını, `.env`'i, sanal ortamı ve ham ekran görüntülerini dışarıda
  tutar. `ekiptakip.db` içinde gerçek kart içeriği birikir — **commit etme**.
- Tohum verisine **gerçek müşteri/ekip verisi koyma**.

### Kimlik ve yetki

Google ile giriş, imzalı oturum, davetli listesi. Tasarım ve tehdit modeli:
**`spec/70-guvenlik.md`**. Kurulum: `deploy/README.md`.

- Giriş yalnızca `users` tablosunda kayıtlı e-postalara açık; bilinmeyen adres
  giremez ve **kullanıcı oluşmaz**. Listeyi `tools/kullanici.py` yönetir.
- `is_active = 0` yapılan kişi **bir sonraki istekte** düşer (kullanıcı satırı her
  istekte okunuyor; ayrı oturum tablosu yok).
- Yanlış yapılandırma çalışma anında değil **açılışta** yakalanır: yayında sahte
  kimlik, eksik/kısa `SECRET_KEY`, eksik Google anahtarı → süreç açılmaz.
- Geliştirmede `make dev` sahte kimlikle çalışır (`EKIPTAKIP_AUTH=sahte`); bu
  değişken yayın kurulumunda açılışı **reddettirir**.

| Konu | Durum |
|---|---|
| TLS | `uvicorn` düz HTTP; dağıtımda cloudflared + nginx (`deploy/`) |
| Tek oturum iptali | Yok — hesap kapatma ya da anahtar rotasyonu (gerekçe: spec §2.4) |
| İki faktör, oturum yönetim ekranı, WAF | Kapsam dışı (spec §1) |

**Uygulama yalnızca `127.0.0.1`'e bağlanır.** Tünelden dışarı verirken önüne
ikinci bir kapı (Cloudflare Access) koymak tavsiye edilir — `deploy/README.md`.

### Bilerek doğru yapılanlar

- **Yetki sunucuda uygulanır.** `can_edit_item` her yazma ucunda çalışır; şablon sadece
  görsel olarak kilitler. Kapsam dışı istek **403** döner — masaüstünde de mobilde de test edilir.
- **Yetki kapsamı sızmaz.** Karta dahil edilen kişi yalnızca o kartta yetkilidir.
- **SQL enjeksiyonu yok.** Değerler parametreyle geçer; SQL'e giren tek metin
  interpolasyonu alan adıdır ve beyaz listeden gelir. FTS sorgusu kullanıcı metniyle
  birleştirilmez, kelimeler ayıklanıp önek eşleşmesine çevrilir.
- **XSS'e karşı kaçış açık.** Jinja `select_autoescape`; hiçbir yerde `|safe` yok.
- **CSP `unsafe-eval` de `unsafe-inline` de istemiyor** (script tarafında):
  şablonlarda satır içi `<script>` ve `hx-on=` yok, davranış `.js` dosyalarında.
  Başlıkları uygulama üretir, nginx değil — vekilsiz çalıştırmada da geçerli.
- **CSRF:** imzalı oturuma bağlı token; HTMX başlıkla, düz formlar gizli alanla
  taşır. Karşılaştırma `hmac.compare_digest`.
- **Denetim izi:** giriş, giriş reddi, çıkış, 403 ve pasifleştirme
  `guvenlik_olaylari` tablosuna yazılır (gövde tutulmaz).
- **Dosya yükleme yok**, dolayısıyla yükleme kaynaklı saldırı yüzeyi de yok.

### Açık bildirimi

Bir açık bulursan issue açma; doğrudan bakımcıya yaz (`Efe0909` GitHub profili).
