# reference/ — kaynak ekranların temizlenmiş taslakları

Uyarlanan kaynak sistemin ekran görüntüleri **git'e girmez** (gerçek kişi adı,
kurum adı ve iç adresler içeriyordu; orijinaller yerelde duruyor). Buradaki
dosyalar o görüntülerin elle çizilmiş, tamamen **uydurma verili** HTML
yeniden çizimleridir — yapı ve yerleşimi belgeler, ürünün kendisini değil.

Çözümleme raporu: `spec/60-kaynak-uyarlama.md` (bölüm numaraları oradaki
başlıklarla eşleşir). Bizim ekran iskeletlerimiz ayrı yerde: `spec/iskelet/`.

| Dosya | Kaynak ekran | Rapor bölümü |
|---|---|---|
| `panolar-ana.html` | applet grid'i (panolar ana sayfası) | 2.1 |
| `gorev-yoneticisi.html` | görev/hata tablosu | 2.2 |
| `analiz.html` | Analysis sekmesi (grafik panelleri) | 2.3 |
| `kart-detay.html` | kayıt detayı: eylemler, meta, form, akış | 2.4 |
| `ekipler.html` | takım listesi | 2.5 |
| `veri-yonetimi.html` | birim türü kataloğu | 2.6 |
| `birim-turu-detay.html` | tek birim türü (üst/alt ilişkiler + liste) | 2.6 |
| `kilavuzlar.html` | doküman/eğitim kütüphanesi | 2.7 |
| `prosedurler.html` | prosedür kartları | 2.8 |
| `prosedur-editor.html` | adım adım akış editörü | 2.8 |
| `cl-panosu.html` | centerlining tamamlanma panosu | 2.9 |

Taslaklar statik ve tıklanmaz; ortak görünüm `kaynak.css`. Kaynağın aldığımız
ve almadığımız yanları raporda — taslaklar kaynağı olduğu gibi (vardiya, PMR
gibi bizde olmayacak boyutlar dahil) belgeler.
