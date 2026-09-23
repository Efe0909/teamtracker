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
| R3 yönetim + ekler | `0af0ed7..b9fc03c` (10) | İngilizce, yönetim paneli, ekler, giriş döngüsü, node türleri | `claude/backport-r3` (panel + ilk yönetici), `claude/backport-r3b` (ekler) |
| R4 kartlar + UI paketi | `3dcc4e5..fa55815` (9; 5'i görünür) | kart blokları, pillar, takım projeksiyonu, anma, pin, 20 maddelik UI paketi, alıntı | `claude/backport-r4` |

## Gerilemeler (0.2'nin kaynaktan saptığı yerler)

| # | Ne | Bulan | Düzeltme |
|---|---|---|---|
| G1 | ~~Kayıt açmak dal izni istemiyordu~~ → **gerileme değil, bilinçli sapma.** Python dal izni istiyordu (`service.new_item` 403). Kullanıcı kararı: herkes her birime kayıt açar (KNOW-316). | orkestratör, R1 öncesi | `c717987` zorladı, `f35ed16` geri aldı, `b1c3324` gerekçeyi düzeltti |
| G2 | ~~403'ler `security_events`'e yazılmıyor~~ → **kapandı.** `75cf938` tek ara katmandan (`backend/src/audit.rs`) yazıyor; sözleşme testi `check_api.sh` `csrf_gate` + `record_permissions` (98/98). | R1 çıkarımı | R1 uygulaması, test ajanı doğruladı |
| G3 | ~~"Son görülme" her istekte yazılıyor~~ → **kapandı.** Python: kullanıcı başına dakikada bir (`_mark_presence`). | R2 çıkarımı | `adfc203` |
| G4 | ~~Çevrimiçi eşiği 5 dk~~ → **kapandı.** Python `ONLINE_THRESHOLD` 2 dk; PR #36'da kanıtsız seçilmişti. | R2 çıkarımı | `adfc203` |
| G5 | spec/21-sema-v2.md §11 "veri ağacı sayfası `edit_nodes` ister" diyordu → **gerileme değil, bilinçli sapma.** Okuma herkese açık kaldı: yapı zaten `/api/meta`'da herkese gidiyor, okumada 403 `KNOW-47`'yi ("görülme genel, değiştirme kapsamlı") ters çevirir ve `security_events`'i taşırırdı. Yazma yine `edit_nodes` + dal ister; değişen yalnız okuma. | R2 testi, spec/21 §11 ile karşılaştırma | kabul edildi — spec/21 §11'e bu satıra pointer eklendi |
| G6 | Geçersiz yanıt hedefi (başka sohbetin mesajı) → **gerileme değil, bilinçli sapma.** Python bağı sessizce düşürüp mesajı kaydediyordu (`valid_reply_target`); Rust 400 `invalid_reply` döner. Arayüzden varılamaz, yalnız el yapımı istekle; KNOW-322 ile aynı çizgi (sessiz yutma yok). | R4 çıkarımı | kabul edildi, `backend/src/api/chats.rs` |

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
| R3-F01…F06 | Yönetim paneli: kullanıcı ekle / aç-kapat, `is_admin` + kilitlenme koruması, scope ver/al, roller (yalnız admin), scope kaynağı, boş durumlar. **Sapmalar:** dal izni de panelden verilir (Python'da arayüzü yoktu, `edit_nodes` dalsız işe yaramıyordu); `manage_users` bir admini kapatamaz; son admin kontrolü kilitli okuma (iki admin yarışı) | d4cffbc | taşındı | `8c83e9e`, `f11fa37` | `check_api.sh` (`admin_gate`, `admin_users`, `admin_lockout`, `admin_roles`, `admin_branch_scope`), `Admin.test.tsx` |
| R3-F07 | İlk yönetici: `~/nix`'te agenix sırrı, Rust açılışta dosyadaki e-postaları aktif admin yapar; listeden çıkarmak geri almaz; CLI yok (KNOW-320). `deploy/module.nix` `bootstrapAdminsFile` → systemd `LoadCredential` | — | taşındı | `95e2965` | `backend/src/bootstrap.rs` (`satirlar`); SQL iki açılışla elle sınandı (idempotent) |
| R2 kontrol listesi | Son tarih kilitliyse pencere nedenini söyler ("edit_deadline kapsamı ister") | e02d71d `alan.html:74` | taşındı | `ffe39f2` | — |
| R3-F08…F13, F16 | Ekler: depolama çekirdeği, sohbette görsel, lightbox/mezar taşı, sahiplik (şema v2 ayrı tablolar, KNOW-277), depolama birimi takibi (çoklu birim, sadeleştirme seçilmedi), etiketler, yükleme hataları. Düğüm silinince öksüz dosya süpürmesi dahil (KNOW-278) | d4cffbc…b9fc03c | bekliyor — ayrı PR (R3b) | | |
| R3-F14 | X-Accel-Redirect | — | bırakıldı — kullanıcı kararı; Pi ölçeğinde doğrudan yanıt yeter | — | — |
| R3-F15 | Bayat oturum döngüsü | c37807b | gerek yok — 0.2'de oturum mimarisi farklı, sorun doğmuyor | — | — |
| R4-F01, F02, F12 | Kart blokları (medya / toplantı / havuz), kartta katılım (jsonb_set, KNOW-281), kayıt açarken kart seçici | b2069ef, e74ca50 | bekliyor — kullanıcı R4'te istedi | | |
| R4-F03 | Anma @kişi/@all/@here/@takım → uygulama içi bildirim (KNOW-263) | b2069ef | bekliyor — kullanıcı R4'te istedi | | |
| R4-F09 | Takım üyeliği yönetimi (ekle / rol / çıkar); bugün üye yalnız tohumdan gelir | e74ca50 | bekliyor | | |
| R4-F06, F07, F08, F14 | Pin ön yüzü (uç hazır), yeni kayıtta pillar, takım sayfasından ad/açıklama (düğüme yazar — KNOW-262, iki yönlü senkron DEĞİL), ⚡ hızlı eylem | b2069ef, e74ca50 | bekliyor | | |
| R4-F13 | Bildirim tercihi | e74ca50 | ertelendi — gönderim altyapısı yok, push'la birlikte (R2-F04) | — | — |
| R4-F15 | Toplu seçim kutuları | e74ca50 | bırakıldı — R1-F07 ile aynı ölü iskelet | — | — |
| R4-F04, F05, F10, F11 | Yanıt alıntısı; ek altında gövde (R3b'ye bağlı); alan diyaloğu + edit_deadline; ağaç katlama/arama | — | 0.2'de var | | |

Öneriler (taşıma değil, yeni):

- **"Doğrulandı" rozeti** (KNOW-317): başka takıma açılan kaydı takım lideri doğrular ya da düşürür.
  Tasarımdan önce soruları var.
