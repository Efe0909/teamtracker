# 50 — Repo yapısı planı (yapılacak)

Bu dosya **henüz uygulanmadı**. Kararlar alındı, iş sıraya girdi; sonraki oturumda
bu plan uygulanacak. Bittiğinde bu dosya "plan" olmaktan çıkıp yapının tarifi olur.

## Kararlar

1. **İki ayrı site gibi dursun.** Masaüstü ve mobil ayrı klasörlerde; ortak olan
   (veritabanı, yetki, ağaç, iş mantığı, palet token'ları) `shared/` altında.
2. **Şimdilik tek SQLite dosyası**, kökte, ortak. Ama **ayrık veritabanı yolu açık
   kalsın**: bütün erişim `shared/db.py` üzerinden geçsin ki ileride iki ayrı dosyaya
   (ya da iki ayrı sürece) bölmek tek yerde değişiklik olsun.
3. **İki site birbirine hyperlink vermesin.** Gerekçe: biri masaüstü odaklı, biri mobil
   odaklı; aynı cihazda birinden diğerine geçmeyi kolaylaştırmak istemiyoruz.
   *Mevcut durum:* mobil başlıkta masaüstüne, ana sayfada mobile giden birer bağlantı
   var. Şimdilik duruyorlar (bilinçli erteleme), yapı işi biterken kaldırılacak.
4. **Eski handoff'lar spec'e damıtılacak**, kökte kalmayacak.

## Hedef yapı

```
app.py                     giriş noktası: FastAPI, host ara katmanı, iki siteyi bağlar
shared/                    iki sitenin ortak çekirdeği
  config.py                ortam değişkenleri (host'lar, çerez, DB yolu)
  db.py  auth.py  tree.py  seed.py  schema.sql
  service.py               ortak iş mantığı: mesaj, alan değişikliği, yeni kayıt
  search.py                FTS5 araması
  templates/ortak/         iki sitenin paylaştığı tek parça (mesaj balonu)
  static/base.css          palet token'ları + ortak bileşenler
  static/htmx.min.js
sites/
  dashboard/  routes.py  templates/  static/dashboard.css  static/home.css
  mobil/      routes.py  templates/  static/mobil.css  static/sw.js  static/icon-*.png
spec/  deploy/  tools/  tests/
```

Statik URL'ler: `/static/…` ortak, `/static/d/…` masaüstü, `/static/m/…` mobil.
`/sw.js` kök kapsamdan servis edilmeye devam eder (PWA şartı).

## Sıra

1. Dosyaları taşı (`git mv`), `app.py`'yi ince giriş noktasına indir, router'ları
   `sites/*/routes.py`'ye ayır.
2. `static/app.css`'i ikiye böl: `shared/static/base.css` (token, buton, girdi, chip,
   avatar, sohbet balonu, alan hapı, durum renkleri) + `sites/dashboard/static/dashboard.css`
   (ray, panel, tablo, kart, breadcrumb, açılır kutu).
3. Şablon yollarını ve `/static` bağlantılarını güncelle; nginx alias bloklarını üçe çıkar.
4. Kök dokümanları damıt ve sil:
   - `00-BASLA.md` → `spec/10-kararlar.md` (kalıcı mimari kararlar; Faz 1 iş listesi ve
     kabul kriterleri düşer)
   - `01-sema.md` → `spec/20-sema.md` (uygulanan hâle göre güncellenir: `dms`/`pillar`
     sütunları, `items_fts`, `code` sütunu henüz yok)
   - `02-push-handoff.md` → `spec/40-push.md` (kalıcı bulgular; deneme günlüğü düşer)
   - `spec/01-mobil.md` → `spec/30-mobil.md`
   - `layout-a.html` → `spec/referans/layout-a.html`
   - Kök `README.md` kısalır: ne olduğu, nasıl çalıştırıldığı, nereye bakılacağı.
5. `.gitignore` gözden geçir (SQLite yan dosyaları `*.db-wal`/`*.db-shm`,
   `.pytest_cache/`, `.DS_Store`).
6. İki site arasındaki bağlantıları kaldır (karar 3).
7. Testler yeşil + tarayıcıda iki site + nginx zinciri yeniden doğrulanır.

## Ayrık veritabanına geçmek gerekirse

Bugün tek dosya yeterli: iki site aynı kayıtları gösteriyor, mobil masaüstünün cep yüzü.
Ayrılması gereken gün şu olur: mobil tarafta sahaya özel, masaüstünde hiç görünmeyen
bir veri kütlesi birikirse (ör. vardiya formları, ölçüm kayıtları). O gün:

- `shared/db.py` içinde bağlantı üretimi tek yer — oraya isim alan bir fabrika konur.
- Ortak kalması gerekenler (`users`, `nodes`) tek veritabanında kalır; site verisi ayrılır.
- İki ayrı süreç + iki ayrı `--workers 1` gerekir; ağaç indeksi ikisinde de kurulur.

Bunu şimdi yapmıyoruz: iki kopya `nodes` senkronu, tek dosyanın verdiği ucuz JOIN'den
daha pahalı.
