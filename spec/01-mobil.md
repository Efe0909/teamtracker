# 01 — Mobil site (`/m`)

Kaynak: sahada kullanılan mobil uygulamanın dört ekranı (yapılacaklar, arama, eylemler,
bildirimler). Görseller `spec/gorseller/` içinde, git'e girmez; buraya **yapı** yazıldı,
örnekler tohum verisinden.

## 1. İş

Sahadaki kişi masaüstüne oturmuyor. Telefondan üç şey yapıyor: **bana ne düştü**,
**şu kaydı bul**, **son tarihi gelen ne var**. Dördüncüsü pasif: biri kartıma bir şey
yaptığında haberim olsun.

Masaüstündeki görev yöneticisiyle aynı veritabanı, aynı yetki, aynı kayıtlar — ayrı yerleşim.
İkinci bir uygulama değil, aynı uygulamanın cep yüzü.

Safari'de **Paylaş → Ana Ekrana Ekle** ile applet gibi duruyor: tarayıcı çubuğu yok,
kendi ikonu var (`manifest.json` + `sw.js`). Push bildirimleri Faz 3'te buraya bağlanacak —
iOS'ta web push **yalnızca ana ekrana eklenmiş** sitede çalışır, bu yüzden PWA kabuğu
bildirimden önce gelmek zorundaydı.

## 2. Akış

```
/m  yapılacaklar ──tıkla──> /m/kayit/{id}  (sohbet + alanlar)
 │                              ▲
 ├─ /m/ara        ──sonuç──────┤
 ├─ /m/eylemler   ──kart───────┤
 ├─ /m/bildirimler──hareket────┘
 └─ +  /m/yeni    ──kaydet────> /m/kayit/{id}
```

Alt sekme çubuğu her ekranda sabit; kayıt detayında yerini mesaj kutusu alır (tek eylem
öndeyken ikinci bir gezinme çubuğu yer kaplıyor). Detaydan çıkış `‹` ile geri.

## 3. Ekrandaki bölgeler

| `data-fragment` | Ne gösterir | Nereden beslenir |
|---|---|---|
| `mobile_tabs` | 4 sekme + ortada `+` | `app.MOBILE_TABS`, rozet `notif_badge()` |
| `mobile_todo` | bana ait kayıt kartları | `items` + `item_participants`, sıralama SQL'de |
| `mobile_search` | kayıt ve düğüm sonuçları | `items_fts` (FTS5) + bellekteki `TreeIndex` |
| `mobile_actions` | son tarihli açık kayıtlar | `items.due_date`, gruplama Python'da |
| `mobile_notifs` | kartlarımdaki başkasının hareketi | `events` + `items` join |
| `mobile_strip` | durum/öncelik/sorumlu/son tarih | `items`, `PATCH /m/kayit/{id}/alan` |

Boş hâller yazılı: "Sana ait açık kayıt yok…", "Son tarihi olan açık kaydın yok…",
"Bildirim yok…" — boş liste sessiz kalmıyor, ne yapılacağını söylüyor.

## 4. Eylemler

| Eylem | Kim | Sunucuda ne olur | Ekranda ne tazelenir |
|---|---|---|---|
| Mesaj gönder | `can_edit_item` | `events`'e `mesaj` + `items.updated_at` | akışa tek balon (`beforeend`) |
| Alan değiştir | `can_edit_item` | alan + `events`'e `sistem` olayı | şerit **ve** akış (`hx-swap-oob`) |
| Yeni kayıt | kapsamındaki dal | `items` + `item_participants` + sistem olayı | karta yönlenir |
| Ara | herkes | okuma | sonuç listesi (300 ms gecikmeli) |

Yetki masaüstüyle **aynı fonksiyondan** geçiyor (`auth.can_edit_item`); mobil uçlar da
kapsam dışında **403** dönüyor (`tests/test_mobile.py::test_out_of_scope_is_403_on_mobile_too`).
Yeni kayıt formunda kapsam dışı dal hiç listelenmiyor — ama asıl kontrol yine sunucuda.

## 5. Veri ihtiyacı

Mevcut şema üçünü karşıladı, biri eksikti:

- **Arama** için `items_fts` (FTS5) eklendi — `schema.sql`. 00-BASLA.md Karar 4 zaten
  istiyordu ("`LIKE '%kelime%'` kullanma"), yazılmamıştı. Trigger'larla senkron;
  `tokenize="unicode61 remove_diacritics 2"` sayesinde `butce` → **Bütçe** buluyor.
  Kullanıcı metni MATCH ifadesine birleştirilmiyor: kelimeler ayıklanıp `"kelime"*`
  biçimine çevriliyor (`fts_query`).
- **Bildirimler** Faz 1'de `events`'ten türetiliyor: bana ait kartlarda başkasının yaptığı
  hareket, tarihe göre. Gerçek tablo 01-sema.md §6'da (okundu bilgisi, `route`, susturma) —
  o gelene kadar rozet "son 24 saatteki hareket sayısı", okunmamış sayısı **değil**.
- **Push** için 01-sema.md §7 `push_subscriptions` gerekiyor; `sw.js` içinde `push` ve
  `notificationclick` girişleri hazır duruyor, sunucu tarafı yok. VAPID anahtarları
  `.env`'de kalacak, koda gömülmeyecek (02-push-handoff.md).

## 6. Alınmayanlar

- **Koyu kart + tek yuvarlak eylem düğmesi** alındı (bir kartta tek iş var, o iş görünür
  olsun), ama kaynaktaki lacivert yerine paletin koyu moru: `#382e55 → #262039`.
- **"Prosedür / Konu" iki satırlık meta** alındı, bizde `Konum:` (düğüm yolu) ve
  `Durum / Son tarih / mesaj sayısı` oldu.
- **Kırmızı son tarih rozeti** alındı; gecikmiş olan ayrı grupta ve kaç gün geciktiği yazılı —
  kaynakta sadece tarih var, "geç kalmış mı" okuyucunun işi.
- **Arama sonucunda "0 gönderi"** gibi ölü sayaç **alınmadı**; mesajı olmayan kayıtta
  sayaç hiç basılmıyor.
- **Sekme çubuğunda 5. yuva ("Process Leads")** alınmadı — o kaynak sistemin kendi kavramı.
- **Serbest metinli eylem kayıtları** (kaynakta "fsf", "zcfgh" gibi çöp satırlar görünüyor)
  alınmadı: bizde eylem ayrı bir varlık değil, **son tarihi olan kayıt**. Böylece aynı iş
  iki yerde yaşamıyor.
