# İçindekiler

| Dosya | Ne |
|---|---|
| `README.md` | spec yazım kalıbı (rapor + iskelet kuralları) |
| `10-kararlar.md` | mimari kararlar ve gerekçeleri — bağlayıcı |
| `20-sema.md` | veri şeması; bugün ne kurulu, ne bekliyor |
| `30-mobil.md` | mobil site çözümlemesi (kaynak ekranlardan uyarlama) |
| `40-push.md` | web push: hazır olan, eksik olan, denemeden çıkan dersler |
| `50-yapi.md` | repo yapısı, iki site ayrımı, ayrık veritabanı yolu |
| `60-kaynak-uyarlama.md` | kaynak panoların çözümlemesi |
| `61-arastirma-sentezi.md` | araştırma sentezi |
| `70-guvenlik.md` | tehdit modeli, kimlik, yetki, CSRF, sırlar, denetim izi |
| `60-kaynak-uyarlama.md` | kaynak panoların çözümlemesi: veri hattı, ekran ekran uyarlama, alınmayacaklar |
| `61-arastirma-sentezi.md` | IWS ve ekip araçları kaynak taraması — bizim ölçeğe uyan/uymayan pratikler |
| `referans/` | kaynak arayüz dosyaları (`spec/referans/layout-a.html`) |
| `../reference/` | kaynak ekranların temizlenmiş HTML taslakları (ham fotoğraflar git dışı) |
| `iskelet/` | ekran iskeletleri (statik HTML taslak) |
| `gorseller/` | ham ekran görüntüleri — git'e girmez |

# Ekran listesi

Kaynak sistemden uyarlanacak ekranlar. Sıra, `app.py` içindeki `MODULES` kaydıyla aynı.

| # | Ekran | Modül (slug) | Görsel | Rapor | İskelet | Durum |
|---|---|---|---|---|---|---|
| — | Görev Yöneticisi | `gorevler` | var (git'te değil) | `referans/layout-a.html`, `60` 2.2 | — | **yazıldı** — v2 düzeni `60` 2.2 |
| 30 | Mobil site (cep) | `app.<alan>` | var (git'te değil) | `spec/30-mobil.md` | — | **yazıldı** |
| 60 | Kart eylem şeridi | (`gorevler` kartı) | var (git'te değil) | `60-kaynak-uyarlama.md` 2.4 | — | **yazıldı** — sıradaki iş |
| 60 | Ekipler | `ekipler` | var (git'te değil) | `60-kaynak-uyarlama.md` 2.5 | — | **yazıldı** |
| | Kazanım Ağacı | `kazanim-agaci` | var (git'te değil) | `60-kaynak-uyarlama.md` 2.6 | | bekliyor |
| | Pivot & Veri Analizi | `pivot` | var (git'te değil) | `60-kaynak-uyarlama.md` 2.3 | | bekliyor |
| | Takvim | `takvim` | | | | bekliyor |
| | Görev Tanımları & Şemalar | `tanimlar` | | `60-kaynak-uyarlama.md` 2.8 | | bekliyor |
| | Ekip Arşivi | `arsiv` | | | | bekliyor |
| | Dosyalar / NAS | `dosyalar` | var (git'te değil) | `60-kaynak-uyarlama.md` 2.7 | | 🚧 ek kararına bağlı |
| | WDS panosu | `wds` | var (git'te değil) | `60-kaynak-uyarlama.md` 2.9 | | 🚧 rutin kararına bağlı |
| | Yönetim Paneli | `admin` | | | | bekliyor |

## Akış haritası

İki site birbirine bağlantı vermez (`spec/50-yapi.md`).

```
dashboard.<alan>/            ana sayfa (modül seçimi)
├─ /gorevler                 tablo + kart + sohbet
└─ /{modül}                  iskele sayfa (kazanım ağacı, pivot, takvim, …)

app.<alan>/                  yapılacaklar   ← ana ekrana eklenen uygulama
├─ /ara                      tam metin arama (tsvector)
├─ /eylemler                 son tarihli açık kayıtlar
├─ /bildirimler              kartlarımdaki hareketler
├─ /kayit/{id}               sohbet + alan şeridi
└─ /yeni                     yeni kayıt

(tek alan adı modunda mobil site /m altındadır)
```

Kalan ekranlar geldikçe doldurulur.
