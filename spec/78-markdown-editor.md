# 78 — Markdown editörü (açıklama ve kapanış notları)

Durum: uygulandı (PR #62). Bu belge **yapılanı** anlatır; sonradan değişirse kod doğru kabul edilir.
Önceki taslak/handoff'taki `spec/77-markdown-editor.md` ayrı tutuldu (çakışma olmasın diye).

## Ürün ilkesi
Notion gibi hissettirir, Obsidian gibi **kaynak-backed** çalışır. Kanonik değer Markdown string'idir;
HTML veya zengin metin JSON'u saklanmaz, kaynak normalize edilmez. Toolbar ile elle Markdown yazmak
**aynı belgeyi** üretir: Markdown bilmeyen toolbar'dan, bilen klavyeden çalışır, biri diğerinin
bedelini ödemez. Tarafların anlaması şart değil; toolbar eylemi, ortaya çıkan işaret ve biçimli
sonuç arasındaki ilişki fark edilebilir olmalı.

## Katmanlar
```
source (React value)
  └─ Lezer ağacı (@lezer/markdown: Autolink, Setext kapalı, `===` kuralı)   ui/markdown.ts
       └─ analyze() → Construct[]   (saf, DOM yok)
            ├─ editör: reveal(odak, seçim) → CM dekorasyonları               ui/MarkdownEditor.ts
            └─ salt okunur: renderLines() → React                             ui/markdownLines.ts + MarkdownField.tsx
toolbar/klavye eylemleri = EditorState → TransactionSpec (saf)                ui/markdownCommands.ts
```
- Dil: `lang-markdown`'ın `markdown()` sarmalayıcısı yerine yalın `Language` (o, HTML/CSS/JS dillerini
  de çekip paketi ~+90kB gzip büyütüyordu; şimdi ~+18kB). Veri facet'i lang-markdown'ınki: Enter/Backspace
  komutları buna bakarak etkin.
- Politika (kodda): yalnız tamamlanmış `[ad](hedef)` link sayılır; `###` boş/yarım başlık literal; 4+ düzey
  başlık literal; kapanmamış çit literal; raw URL yalnız `http(s)://`; `www.x` ve e-posta link değil;
  `===` kendi satırında yatay çizgi (Setext başlık yok); ham HTML inert; `safeHref` allowlist'i
  (http/https/mailto/göreli) ve `fileProvider` host eşleşmesi (spoof reddi) aynen korunur; ağ isteği yok.

## Aktif-source (reveal) kuralı
Bir yapının ayraçları (`**`, `*`, `` ` ``, `[` ve `](hedef)`, başlık/alıntı `#`/`>`, madde `-`, kural satırı)
**yalnız editör odaktayken ve imleç/seçim ayraca BİTİŞİKKEN** (kapalı aralık) görünür; o yapının çifti birlikte
silik açılır, içerik biçimli kalır. Aksi hâlde `Decoration.replace({})` ile gizlidir.
- **Değişmez I1:** gizli hiçbir aralığa imleç değmez/içermez ⇒ `atomicRanges`, seçim filtresi, özel
  Backspace/Delete gerekmedi; yerel ok/Home/End/Shift+ok çalışır, her ok tam 1 kaynak karakter ilerler.
- **I2:** widget kaynakta olmayan metin göstermez. Boş adlı `[](url)` hedefi gerçek kaynak olarak silik görünür
  (hiç gizlenmez). Tek widget: sıfır genişlikli ad-ver noktası ve madde simgesi.
- **I3:** açılıp kapanma yalnız yatay genişliği değiştirir; satır yüksekliği sabit (her satır sınıfı kendi
  `line-height`'ını taşır; satır içi kod `line-height:1`).
- Fare sürüklerken reveal dondurulur, bırakınca hesaplanır.
- **Tradeoff:** "ilk karakterde işaretler kaybolsun" ile "bitişikken görünsün" birlikte sağlanamaz; son
  istek öncelikli. `**a|**` yazarken kapanış `**` silik görünür kalır, imleç uzaklaşınca gizlenir.
- Açılırken sağdaki metin yatayda kayar (kaçınılmaz). Satır duvar noktasındaysa yatay kayma sarmayı
  değiştirip satır yüksekliğini oynatabilir (bkz. sınırlar).

## Toolbar ve klavye
Aç-kapa, idempotent, `aria-pressed` (ağaçtan türeyen aktif durum), seçim/odak korunur (`mousedown`
`preventDefault`). Kalın/italik/satır içi kod: seçimde sar/kaldır (kısmi kaldırma bölünür, kısmen biçimliyi
tamamen biçimli yapar); seçimsizde `**|**` yazım modu, tekrar basınca kapanışın dışına çıkar/boş çifti siler.
Başlık 1–3, alıntı, madde/numaralı liste: seçili tüm satırlar, yığılmaz, tür değiştirir, tekrar basınca çıkar.
Kod bloğu (çit) ve satır içi kod ayrı düğme; yatay çizgi ekler. Kısayollar: Ctrl/Cmd+B/I/K, +Alt+1/2/3,
undo/redo yerel. `**` pairing yalnız sınırdan önce (boşluk/son/kapanış noktalama), kapanış üzerinden geçilir
(elle de), IME composition'da yok. Enter: `lang-markdown` komutu (liste devam/çıkış, numara artışı); boş
alıntı satırından da çıkar; Shift+Enter aynı maddede yeni satır. Link: toolbar/⌘K açık Ad+Adres; çift tık
düzenler; "Aç" yalnız izinli şemalarda; düz tık imleç koyar, ⌘/Ctrl+tık açar. Ad-ver noktası aksan
renginde, hover/odakta ve imleç URL içindeyken görünür; tek yol değil (toolbar bağlantı düğmesi aynı işi yapar).

## Kabul matrisi (bu PR, Chromium/Linux)
Birim+jsdom: `npm test` (27 dosya, 164 test). Gerçek tarayıcı: `frontend/tools/md-browser/` (elle koşulur).

| Madde | Sonuç |
|---|---|
| Dikey kayma yok (ok ile tüm belge); rastgele 60 belgede ArrowRight/Left taraması | geçti |
| Her ok = 1 kaynak karakter, takılma yok; Shift+ok | geçti |
| Yatay çizgi satır genişliğinde (`---`, `===`), editör ve salt okunur | geçti |
| H1>H2>H3>gövde boyutu | geçti |
| `https://a`→`.`→`com`: imleç glif sonunda, nokta genişliği 0, hover metrik/kaynak değiştirmez, tık→`[|](URL)` | geçti |
| Placeholder/imleç hizası: açık/koyu, 100/125/150/200/300%, gerçek Radix Dialog içinde | geçti |
| Toolbar B/liste/başlık/bağlantı aç-kapa, seçim/odak korunur | geçti |
| Elle `**kalın**`, `# Başlık`, `[ad](url)`, `> ` `---` yazımı; liste Enter/çıkış | geçti |
| Fare tıklama/sürükleme | geçti |
| Salt okunur ↔ editör görünür metin tutarlılığı | geçti |
| Provider pill, spoof host, ham HTML/`javascript:` inert, uzun bozuk link | geçti (birim/jsdom) |
| IME composition: pairing yok | geçti (jsdom; gerçek IME **sınanmadı**) |
| Mobil dokunmatik seçim, iOS Safari, gerçek Türkçe klavye/IME | **bu platformda sınanmadı** |
| Kullanıcının bildirdiği büyük placeholder kayması | **yeniden üretilemedi**; ölçülen hizada fark yok, "düzeldi" denemez |

## Bilinen sınırlar
- Madde işaretli listede asılı girinti `ch` ile yaklaşık; iç içe girintili maddelerde sarılan satır tam hizalanmaz.
- Çit satırları (` ``` `) hep silik görünür (gizlemek satır yüksekliğini oynatırdı); dil etiketi/syntax renklendirme yok.
- Bir satır duvar noktasındayken işaret açılışı sarmayı değiştirebilir (0,4px'lik alt-piksel kaymalar giderildi,
  sarma kaynaklı satır sayısı değişimi kaldı).
- Satır sonu `\n` olduğu gibi gösterilir (pre-wrap); CommonMark HTML çıktısı üretilmez.
- Referans linkleri, görsel, tablo, görev kutusu desteklenmez (literal).
