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
  0. METİN     (betik, model yok)   Python şablon metinlerini React'te arar; aralığa düşen adaylar
                                    çıkarıma kontrol listesi olarak gider
  1a. ETİKET   (haiku, salt okur)   commit başına: kullanıcıya görünür mü, hangi alan/dosyalar.
                                    Altyapı (güvenlik altyapısı, göç, deploy) derin incelemeye gitmez
  1b. ÇIKARIM  (sonnet, salt okur)  YALNIZ görünür commit'ler: commit mesajı > Stele > kod (e02d71d)
                                    + Python testleri → ledger: davranış, gerekçe, 0.2'deki durumu,
                                    boyut, şüpheler
  ── ara nokta 1 (orkestratör → kullanıcı): hangileri taşınsın, bilinmeyen gerekçeler,
                                              bayat ya da saçma kurallar, gerilemeler
  2. UYGULAMA  (opus)               onaylı özellik başına bir küçük commit (Rust + React birlikte);
                                    commit öncesi clippy + npm run build
  3. TEST      (sonnet)             özellik commit'lerine karşı test (check_api.sh iddiası, vitest);
                                    davranış başına BİR iddia, tekrar yok (ponytail ultra);
                                    yakaladığını DÜZELTMEZ, orkestratöre raporlar;
                                    doğruluk kaynaklarını günceller (bu belge, spec/15, Stele)
  ── ara nokta 2 (orkestratör → kullanıcı): testin yakaladıkları, kaynak ile uygulama farkları;
                                              düzeltmeyi orkestratör uygulama ajanına verir
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
| R2 ekip + yapı | `54be778..2fc1259` (14) | Ekipler, filtre düzeltmesi, push + varlık, veri yönetimi, kapsam, ağaç geçmişi | `claude/backport-r2` (taban `main` — R1 PR #37 birleşti) |
| R3 yönetim + ekler | `0af0ed7..b9fc03c` (10) | İngilizce, yönetim paneli, ekler, giriş döngüsü, node türleri | `claude/backport-r3` |
| R4 kartlar + UI paketi | `3dcc4e5..fa55815` (5) | kart blokları, pillar, takım projeksiyonu, anma, pin, 20 maddelik UI paketi, alıntı | `claude/backport-r4` |

## Gerilemeler (0.2'nin kaynaktan saptığı yerler)

| # | Ne | Bulan | Düzeltme |
|---|---|---|---|
| G1 | ~~Kayıt açmak dal izni istemiyordu~~ → **gerileme değil, bilinçli sapma.** Python dal izni istiyordu (`service.new_item` 403). Kullanıcı kararı: herkes her birime kayıt açar (KNOW-316). | orkestratör, R1 öncesi | `c717987` zorladı, `f35ed16` geri aldı, `b1c3324` gerekçeyi düzeltti |
| G2 | ~~403'ler `security_events`'e yazılmıyor~~ → **kapandı.** `75cf938` tek ara katmandan (`backend/src/audit.rs`) yazıyor; sözleşme testi `check_api.sh` `csrf_gate` + `record_permissions` (98/98). | R1 çıkarımı | R1 uygulaması, test ajanı doğruladı |
| G3 | "Son görülme" her istekte yazılıyor (Python: kullanıcı başına dakikada bir, `_mark_presence`). PR #35'ten kalma. | R2 çıkarımı | R2 uygulaması |
| G4 | Çevrimiçi eşiği 5 dk (Python `ONLINE_THRESHOLD` 2 dk). PR #36'da kanıtsız seçilmiş. | R2 çıkarımı | R2 uygulaması |
| G5 | spec/21-sema-v2.md §11 "veri ağacı sayfası `edit_nodes` ister" diyordu → **gerileme değil, bilinçli sapma.** Okuma herkese açık kaldı: yapı zaten `/api/meta`'da herkese gidiyor, okumada 403 `KNOW-47`'yi ("görülme genel, değiştirme kapsamlı") ters çevirir ve `security_events`'i taşırırdı. Yazma yine `edit_nodes` + dal ister; değişen yalnız okuma. | R2 testi, spec/21 §11 ile karşılaştırma | kabul edildi — spec/21 §11'e bu satıra pointer eklendi |

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
| R2-F03 | Varlık: damga kullanıcı başına dakikada en fazla bir kez, çevrimiçi eşiği 2 dk tek yerde (G3, G4) | 32f58b9 | taşındı | `adfc203` | `backend/src/auth.rs` (`presence_written_at_most_once_per_interval_per_user`), `backend/tools/check_api.sh` (`node_presence`) |
| R2-F05 | Veri Yönetimi: ağaç düzenleme (ekle/adlandır/açıkla/taşı/pasifleştir/kalıcı sil) + arama + katlama — **son hal** (e02d71d); R3 node türleri ve R4 arama/katlama da bunun içinde. Okuma bilerek herkese açık kaldı (G5). | b436cbc, 9ce17ad (+1b91828, e74ca50) | taşındı | `088375d`, `cc01dfb`, `2e9a9ea`, `f81756a` | `backend/tools/check_api.sh` (`node_read_open_to_all`, `node_root_only_admin`, `node_branch_scope_iki_yonlu`, `node_move_cycle`, `node_root_only_type`, `node_inactive_parent`, `node_invalid_name`, `node_invalid_parent`, `node_team_projection`, `node_hard_delete`), `backend/src/db/scope.rs` (`yetenek_ve_dal_birlikte_gerekir`), `frontend/src/surfaces/dashboard/DataTree.test.tsx` |
| R2-F07 | Ağaç değişiklik geçmişi | 4fe7a9b | taşındı | `2b81130` | `backend/tools/check_api.sh` (`node_activity_olgu`) |
| R2-F04 | Web push sunucu tarafı + service worker | 32f58b9 | ertelendi — kullanıcı seçmedi; ayrı PR (KNOW-89, TASK-197) | — | — |
| R2-F08 | `/test/bildirim` curl ucu | 3533299 | ertelendi — push'a bağlı | — | — |
| R2-F01, F02, F06 (denetim), F09 | Ekipler; filtre davranışı (KNOW-234 uygulanmış); kapsam denetimi; `/m` kaldırıldı | — | 0.2'de var | PR #36 | check_api |

Açık iş (sonraki aralık):

- **İlk yönetici nasıl eklenir?** 0.2'de yolu yok (Python'da `tools/user.py`). Kullanıcı kararı: yönetim
  panelini bekle (R3). Panelin kendisi de ilk yöneticiye ihtiyaç duyar; R3 bu tavuk-yumurta sorununu
  çözmek zorunda.

Öneriler (taşıma değil, yeni):

- **"Doğrulandı" rozeti** (KNOW-317): başka takıma açılan kaydı takım lideri doğrular ya da düşürür.
  Tasarımdan önce soruları var.
