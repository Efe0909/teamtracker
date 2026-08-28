# İçindekiler

| Dosya | Ne |
|---|---|
| `README.md` | spec yazım kalıbı (rapor + iskelet kuralları) |
| `10-kararlar.md` | mimari kararlar ve gerekçeleri — bağlayıcı |
| `20-sema.md` | veri şeması; bugün ne kurulu, ne bekliyor |
| `30-mobil.md` | mobil site çözümlemesi (kaynak ekranlardan uyarlama) |
| `40-push.md` | web push: hazır olan, eksik olan, denemeden çıkan dersler |
| `50-yapi.md` | repo yapısı, iki site ayrımı, ayrık veritabanı yolu |
| `referans/` | kaynak arayüz dosyaları (`spec/referans/layout-a.html`) |
| `iskelet/` | ekran iskeletleri (statik HTML taslak) |
| `gorseller/` | ham ekran görüntüleri — git'e girmez |

# Ekran listesi

Kaynak sistemden uyarlanacak ekranlar. Sıra, `app.py` içindeki `MODULES` kaydıyla aynı.

| # | Ekran | Modül (slug) | Görsel | Rapor | İskelet | Durum |
|---|---|---|---|---|---|---|
| — | Görev Yöneticisi | `gorevler` | — | `referans/layout-a.html` | — | **yazıldı** |
| 30 | Mobil site (cep) | `app.<alan>` | var (git'te değil) | `spec/30-mobil.md` | — | **yazıldı** |
| | Kazanım Ağacı | `kazanim-agaci` | | | | bekliyor |
| | Pivot & Veri Analizi | `pivot` | | | | bekliyor |
| | Takvim | `takvim` | | | | bekliyor |
| | Görev Tanımları & Şemalar | `tanimlar` | | | | bekliyor |
| | Ekip Arşivi | `arsiv` | | | | bekliyor |
| | Dosyalar / NAS | `dosyalar` | | | | bekliyor |
| | Yönetim Paneli | `admin` | | | | bekliyor |

## Akış haritası

İki site birbirine bağlantı vermez (`spec/50-yapi.md`).

```
dashboard.<alan>/            ana sayfa (modül seçimi)
├─ /gorevler                 tablo + kart + sohbet
└─ /{modül}                  iskele sayfa (kazanım ağacı, pivot, takvim, …)

app.<alan>/                  yapılacaklar   ← ana ekrana eklenen uygulama
├─ /ara                      FTS5 arama
├─ /eylemler                 son tarihli açık kayıtlar
├─ /bildirimler              kartlarımdaki hareketler
├─ /kayit/{id}               sohbet + alan şeridi
└─ /yeni                     yeni kayıt

(tek alan adı modunda mobil site /m altındadır)
```

Kalan ekranlar geldikçe doldurulur.
