# 90 — Python'dan geri taşıma: döngü ve özellik envanteri

Durum: **yürüyor** (2026-09-23'te başladı).

## Neden

alpha-0.2 (PR #36) çekirdek iş akışını taşıdı. Python sürümünde ise commit commit eklenmiş çok
sayıda küçük özellik var: kullanım kolaylığı, akış ayrıntıları, doğrulama ve boş durumlar. Bunların
çoğu **spec'e hiç yazılmadı**; ya commit mesajlarında ya Stele'de ya da yalnız kodda duruyor.

Bu belge iki şeyi tutuyor:

1. Onları geri taşıyan döngünün tanımı.
2. Özellik envanteri. Taşıma bittikçe tek doğruluk kaynağı bu olacak; spec/60 ve spec/72
   yalnız niyet anlatıyor.

## Döngü

```
her aralık için:
  1. ÇIKARIM   (sonnet, salt okur)  commit mesajı > Stele > kod (e02d71d) + Python testleri
                                    → ledger: davranış, gerekçe, 0.2'deki durumu, boyut, şüpheler
  ── ara nokta 1 (orkestratör → kullanıcı): hangileri taşınsın, bilinmeyen gerekçeler,
                                              bayat ya da saçma kurallar, gerilemeler
  2. UYGULAMA  (opus)               onaylı özellik başına bir küçük commit (Rust + React birlikte);
                                    commit öncesi clippy + npm run build
  3. TEST      (sonnet)             özellik commit'lerine karşı test (check_api.sh iddiası, Rust birim
                                    testi); yakaladığını düzeltir (ayrı fix commit'i);
                                    doğruluk kaynaklarını günceller (bu belge, spec/15, Stele)
  ── ara nokta 2 (orkestratör → kullanıcı): testin yakaladıkları, kaynak ile uygulama farkları
  4. PR        aralık başına bir dal (claude/backport-rN), bir PR
```

Kurallar:

- **Davranış taşınır, HTMX geçici çözümü taşınmaz.** "Dialog tazelenen parçanın içinde dursun",
  "datalist bir kez dolsun", `hx-on` yasağı gibi şeyler çözümdür, özellik değil. Çıkarım
  bunları ayrı listeler.
- **Son hal esastır.** Erken bir commit'teki özelliği sonraki bir commit değiştirmiş olabilir;
  taşınan şey `e02d71d`'deki davranıştır.
- **Gerekçe bulunamazsa "GEREKÇE BİLİNMİYOR" yazılır, uydurulmaz.** Karar kullanıcıya gider.
- **Yeşil test yetmez** (KNOW-241). Test ajanı Python'daki davranışla karşılaştırır: kaynakta
  olmayan kural uydurulmuşsa bu da bir hatadır.
- **Stele ve spec bayatlamış olabilir.** Çelişkide kod ve commit geçmişi kazanır; bayat düğüm ya da
  belge o adımda düzeltilir.
- **Kod da bayatlamış olabilir.** Python'daki bir kural kullanıcının bugünkü amacıyla çelişebilir
  (bkz. G1). "Python'da böyleydi" tek başına gerekçe değildir.
- **Çıkarım ajanı büyük commit'lerde küçük arayüz ayrıntılarını kaçırır.** R1'de "Açan · tarih"
  satırını atladı. Karşı önlem: orkestratör Python şablonlarındaki görünür metinleri React
  kaynağında arar (R1'de 157 aday çıktı) ve aralığa düşenleri çıkarım ajanına kontrol listesi
  olarak verir.

## Aralıklar

| Aralık | Commit'ler | İçerik | Dal |
|---|---|---|---|
| R1 temel | `5813368..cd6e478` (13) | Faz 1, ana sayfa, mobil, iki alan adı, güvenlik 1–5, PostgreSQL, görev tablosu v2, kayıt 2 sütun | `claude/backport-r1` |
| R2 ekip + yapı | `54be778..2fc1259` (12) | Ekipler, filtre düzeltmesi, push + varlık, veri yönetimi, kapsam, ağaç geçmişi | `claude/backport-r2` |
| R3 yönetim + ekler | `0af0ed7..b9fc03c` (10) | İngilizce, yönetim paneli, ekler, giriş döngüsü, node türleri | `claude/backport-r3` |
| R4 kartlar + UI paketi | `3dcc4e5..fa55815` (5) | kart blokları, pillar, takım projeksiyonu, anma, pin, 20 maddelik UI paketi, alıntı | `claude/backport-r4` |

## Gerilemeler (0.2'nin kaynaktan saptığı yerler)

| # | Ne | Bulan | Düzeltme |
|---|---|---|---|
| G1 | ~~Kayıt açmak dal izni istemiyordu~~ → **gerileme değil, bilinçli sapma.** Python dal izni istiyordu (`service.new_item` 403). Kullanıcı kararı: herkes her birime kayıt açar (KNOW-316). | orkestratör, R1 öncesi | `c717987` zorladı, `f35ed16` geri aldı, `b1c3324` gerekçeyi düzeltti |
| G2 | ~~403'ler `security_events`'e yazılmıyor~~ → **kapandı.** `75cf938` tek ara katmandan (`backend/src/audit.rs`) yazıyor; sözleşme testi `check_api.sh` `csrf_gate` + `record_permissions` (98/98). | R1 çıkarımı | R1 uygulaması, test ajanı doğruladı |

## Özellik envanteri

Satırlar ara nokta 1'den sonra eklenir. Durum: `taşındı` (commit), `bırakıldı` (gerekçe),
`bekliyor`.

| Kimlik | Özellik | Kaynak commit | Durum | 0.2 commit | Test |
|---|---|---|---|---|---|
| R1-F01 | PWA kurulumu: `manifest.json` (standalone, ikonlar) + iOS meta. Service worker push'la birlikte (Faz 3). | 552700b, 8fceb4d | taşındı | `003d86a`, düzeltme `cb1bbb0` (eksik `mobile-web-app-capable` meta) | `frontend/src/pwa.test.ts`, `frontend/src/surfaces/app/pages.test.tsx` |
| R1-F02 | 403 → `security_events` `permission_denied` (G2) | bda6531 | taşındı | `75cf938` | `backend/tools/check_api.sh` (`csrf_gate`, `record_permissions`) |
| R1-F08 | Kayıt başlığında "Açan: X · tarih" — **iki yüzde** (Python yalnız masaüstündeydi; mobilde de kalması kullanıcı onayı, 2026-09-23) | 5cb100b | taşındı | `d0c1cf9` | `frontend/src/features/record/parts.test.tsx` |
| R1-F03 | Masaüstü sitesi telefonda "bu ekran masaüstü için" şeridi | 5cb100b | bırakıldı — kullanıcı seçmedi; kayıt sayfası zaten dar ekrana uyuyor | — | — |
| R1-F07 | Toplu seçim kutuları | 5cb100b | bırakıldı — Python'da da hiçbir işleme bağlı değildi (ölü iskelet) | — | — |
| R1-F09 | Mobil "Eylemler" = son tarihli kayıtlarım | 0599b89 | bırakıldı — eylem tablosundan önce yazılmış, hiç güncellenmemiş; 0.2 "açık eylemlerim" gösterir (kullanıcı kararı) | — | — |
| R1-F04 | Alan adı ayrımı sunucuda 404 | 8fceb4d | bırakıldı — Python'da da "yetki sınırı değil, arayüz ayrımı" diye geri çekilmişti (02c9eef I8); 0.2'de istemcide | — | — |

Öneriler (taşıma değil, yeni):

- **"Doğrulandı" rozeti** (KNOW-317): başka takıma açılan kaydı takım lideri doğrular ya da düşürür.
  Tasarımdan önce soruları var.
