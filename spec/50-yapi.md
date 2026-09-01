# 50 — Repo yapısı

İki site, tek süreç, ortak çekirdek.

```
app.py                        giriş noktası: FastAPI, host ara katmanı, ortak uçlar
shared/                       iki sitenin ortak çekirdeği
  config.py                   ortam değişkenleri (alan adları, çerez alanı)
  db.py                       ham SQL + bağlantı havuzu (DATABASE_URL ile değiştirilebilir)
  gocler/*.sql  seed.py       numaralı şema göçleri ve tohum veri
  tree.py                     TreeIndex (Euler tour, is_descendant O(1))
  auth.py                     current_user, can_edit_item
  service.py                  durum + yazma işleri: mesaj, alan değişikliği, yeni kayıt
  search.py                   tsvector araması
  render.py                   şablon yükleme (site dizini + ortak parçalar)
  templates/ortak/mesaj.html  iki sitenin paylaştığı tek parça
  static/base.css             palet token'ları + ortak bileşenler
  static/htmx.min.js  icon-*.png
sites/
  dashboard/                  masaüstü: tablo, kart, sohbet, modül sayfaları
    routes.py  templates/  static/dashboard.css  static/home.css
  mobil/                      mobil: yapılacaklar, arama, eylemler, bildirimler
    routes.py  templates/  static/mobil.css  static/sw.js
spec/  deploy/  tools/  tests/
ekiptakip.db                  ORTAK veritabanı (git'e girmez)
```

Statik URL'ler: `/static/…` ortak, `/static/d/…` masaüstü, `/static/m/…` mobil —
nginx de aynı üç dizine ayırıyor (`deploy/nginx-ekiptakip-ortak.conf`).
`/sw.js` kök kapsamdan servis edilir (PWA şartı: `/static/…` altından verilirse `/m`'yi
kontrol edemez).

## Neden bu ayrım

- **Yazma işleri `shared/service.py`'de tek yerde.** Masaüstü ve mobil uçları yalnızca
  yetkiyi kontrol edip hangi parçayı döndüreceğini biliyor. Aynı davranışın iki kopyası olmaz.
- **Her site kendi şablonunu ve CSS'ini taşır.** Biri değişince diğeri etkilenmez;
  ortak olan yalnızca palet token'ları (`base.css`) ve mesaj balonu.
- **Ayrı deploy'a gitmek isterse kesim yeri hazır**: `sites/<site>/` klasörü kendi kendine
  yeter, `shared/` iki tarafa da lazım olan çekirdek.

## İki site birbirine bağlantı vermez

Tasarım kararı: biri masaüstü odaklı, biri mobil odaklı. Aynı cihazda birinden diğerine
geçmeyi kolaylaştırmak **istemiyoruz** — telefondaki kişi telefon işini, masasındaki kişi
masa işini yapsın.

Uygulanışı: hiçbir şablonda diğer siteye `href` yok. `config.other_site()` duruyor ama
yalnızca adresi **yazmak** için (masaüstü ana sayfasında "cepte: app.<alan>" satırı),
tıklanabilir bağlantı olarak değil.

## Veritabanı: bugün ortak, yarın ayrılabilir

Bugün tek PostgreSQL veritabanı. İki site aynı kayıtları gösteriyor; mobil, masaüstünün
cep yüzü. Ayırmak bugün iki kopya `nodes`/`users` senkronu demek — tek veritabanının
verdiği ucuz JOIN'den pahalı.

Ayrılması gereken gün şu olur: mobil tarafta sahaya özel, masaüstünde hiç görünmeyen bir
veri kütlesi birikirse (vardiya formları, ölçüm kayıtları gibi). O gün:

1. `shared/db.py` içinde havuz üretimi **tek yer** — `DATABASE_URL` zaten oradan okunuyor,
   isim alan bir fabrikaya çevrilir.
2. Ortak kalması gerekenler (`users`, `nodes`) tek veritabanında kalır; siteye özel tablolar
   ayrılır.
3. İki ayrı süreç + her birinde `--workers 1`; ağaç indeksi ikisinde de kurulur.
   (Aynı veritabanına bakan iki sürecin ağaç indeksi ayrı düşer; `nodes` değişince
   ikisini de yeniden kurmak gerekir — `LISTEN/NOTIFY` bunun için, `spec/80-veritabani.md`.)

Bu yüzden **tüm veritabanı erişimi `shared/db.py`'den geçer**; başka yerde `psycopg.connect`
çağrısı yok.
