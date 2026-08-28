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
shared/      ortak çekirdek: db, şema, tohum, ağaç, yetki, iş mantığı, arama, palet
sites/       dashboard/ ve mobil/ — her biri kendi rotaları, şablonları, CSS'i
spec/        kararlar, şema, ekran çözümlemeleri
deploy/      cloudflared + nginx + systemd
tools/       yardımcı betikler (PWA ikonları)
tests/       43 test: yetki (403), FTS eşleşmesi, iki alan adı ayrımı, PWA dosyaları
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
| Yayına alma | `deploy/README.md` |
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

### Bilerek eksik olanlar

| Konu | Durum | Ne zaman kapanır |
|---|---|---|
| Kimlik doğrulama | **Yok.** `uid` çerezi imzasız — çerezi elle yazan herkes istediği kullanıcı olur | Faz 2 (Google OAuth + imzalı çerez) |
| CSRF koruması | Yok | Faz 2, kimlikle birlikte |
| TLS | Yok. `uvicorn` düz HTTP | Dağıtımda cloudflared + nginx (`deploy/`) |
| Hız sınırlama | Yok | İhtiyaç doğunca |

**Bu yüzden alpha-0.1 yalnızca `127.0.0.1`'e bağlanmalı.** Tünelden dışarı vereceksen
**önüne kapı koymadan verme** (Cloudflare Access ya da basic auth) — `deploy/README.md`.

### Bilerek doğru yapılanlar

- **Yetki sunucuda uygulanır.** `can_edit_item` her yazma ucunda çalışır; şablon sadece
  görsel olarak kilitler. Kapsam dışı istek **403** döner — masaüstünde de mobilde de test edilir.
- **Yetki kapsamı sızmaz.** Karta dahil edilen kişi yalnızca o kartta yetkilidir.
- **SQL enjeksiyonu yok.** Değerler parametreyle geçer; SQL'e giren tek metin
  interpolasyonu alan adıdır ve beyaz listeden gelir. FTS sorgusu kullanıcı metniyle
  birleştirilmez, kelimeler ayıklanıp önek eşleşmesine çevrilir.
- **XSS'e karşı kaçış açık.** Jinja `select_autoescape`; hiçbir yerde `|safe` yok.
- **CSP `unsafe-eval` istemiyor.** Şablonlarda `hx-on=` kullanılmıyor.
- **Dosya yükleme yok**, dolayısıyla yükleme kaynaklı saldırı yüzeyi de yok.

### Açık bildirimi

Bir açık bulursan issue açma; doğrudan bakımcıya yaz (`Efe0909` GitHub profili).
