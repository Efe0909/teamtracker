# 16 — Ön yüz: Python arayüzünün eleştirisi, React yapısı, ucuz yetenekler

Durum: bölüm 3 **uygulandı** (2026-09-23, `frontend/src/`): tek paket + lazy yüzler,
tipli rota birliği, `tokens.css` + CSS Modules (sınıf adları `scripts/css-modules.mjs` ile
tipli üretilir, modül CSS'te ham renk derlemeyi düşürür), TanStack Query, `ERRORS`
sözlüğü. Bölüm 4'ten Y3, Y4 (geri al ile), Y6, Y8, Y15 geldi.
Sınır `15-sinirlar.md`'de: Rust yalnız JSON, ön yüz ince. Bu belge ön yüzün *içini* anlatır.

Kanıt: Python başvurusu (`app.py`, `sites/`, `shared/static/`) tohum verisiyle yerelde
açıldı; masaüstü 1440×900 ve 800×600, mobil 375×812. Kontrast oranları WCAG formülüyle
token değerlerinden hesaplandı. Ekran görüntüleri git dışı.

---

## 1. Python arayüzünün eleştirisi

Amaç: React'e taşırken kusurları **kopyalamamak**. Her madde: sorun · boyut · React'teki
karşılığı. Boyutlar: Hiyerarşi / Marka / Kompozisyon / Tipografi / Renk / Affordans / Yoğunluk.

### P1 — Kritik (React'e bu hâliyle girmez)

| # | Sorun | Boyut | Düzeltme |
|---|---|---|---|
| 1 | Mobil ana ekrandaki "Yapılacak / Tamamlandı" segmenti **biçimsiz**: tarayıcının mavi bağlantısı olarak çiziliyor, seçili sekme görünmüyor. `.seg` için yalnız dolgu var (`mobil.css:28-30`), taban biçimi hiç yazılmamış. | Affordans | `ui/Segmented` — `role="tablist"`, seçili `aria-selected` + dolu zemin. |
| 2 | `--dim` `#7d75a0` metin olarak her yerde (tablo başlıkları, etiketler, iz, meta): beyazda **4.26:1**, `--bg`'de **3.82:1** — 11–12px metinde AA (4.5) altı. `--warn` `#c98a10` metin olarak **2.95:1** ("Beklemede", "Yüksek"), `--ok` 3.33, `--err` 4.06. Birincil düğme (beyaz / `#7c5bff`) 4.38. | Renk | React token'ları zaten koyu `--dim` `#6f6792` (5.21:1) kullanıyor — onu tut. Durum renkleri için ayrı **metin** token'ı (`--warn-text` ≈ `#8a5d00`, `--ok-text` ≈ `#177a50`); açık tonlar yalnız zemin/nokta. Birincil düğme zemini `--acc-strong`. |
| 3 | Odak görünmüyor: `button` için hiç `:focus` / `:focus-visible` kuralı yok; `input:focus` çerçeveyi kaldırıp %13 saydam gölge koyuyor, alan hapları ve eylem satırında gölge de sıfırlanmış (`base.css:255`, `dashboard.css:120`). Klavyeyle gezilemiyor. | Affordans | Tek global `:focus-visible` halkası (React `styles.css`'te var); bileşen içinde `outline:none` **yasak**. |
| 4 | Hata sayfaları ham JSON: yetkisiz `/admin` → `{"detail":"kullanıcı yönetimi yetkisi yok"}`, bilinmeyen yol → `{"detail":"sayfa yok"}`. Kullanıcı geri dönüş yolu bulamıyor. | Affordans · Marka | React'te `NotFound` / `Forbidden` / `Offline` ekranları; API hata kodu → Türkçe ileti tek sözlükte (bkz. 3.6). |
| 5 | Tip ölçeği dağınık: **21 farklı** `font-size` (8.5–26px), 9–9.5px çip, rozet sayısı ve **mobil sekme etiketi** (`.tab` 9.5px). Telefonda okunmuyor. | Tipografi | 6 basamaklı ölçek (bkz. 3.4), alt sınır 11px masaüstü / 12px mobil. |

### P2 — Önemli (ilk React ekranlarıyla birlikte)

| # | Sorun | Boyut | Düzeltme |
|---|---|---|---|
| 6 | Mobil kayıt kartındaki ▶ "Devam et" **ayrı bir düğme gibi** duruyor ama kartın tamamı tek bağlantı; basınca durum değişmiyor, sadece kayıt açılıyor. Sahte affordans. | Affordans | Ya gerçek hızlı eylem yap (durumu ilerlet — bkz. yetenek Y5) ya kaldır, yerine `›`. |
| 7 | Görev tablosunda **11 filtre** iki satır, hepsi "Hepsi" diyen eşit ağırlıkta select; üstünde ayrıca hızlı çipler. Asıl içerik (tablo) ekranın üçte birinden aşağıda başlıyor. | Yoğunluk · Hiyerarşi | 3 birincil filtre (Düğüm, Sorumlu, Durum) + "Filtre ekle"; etkin filtreler kaldırılabilir çip olarak tek satırda. |
| 8 | Kayıt ekranında 7 alan hapı eşit ağırlıkta (Durum, Öncelik, Takım, Pillar, Sorumlu, Son tarih, DMS); boş "Pillar —" da aynı yeri kaplıyor. | Hiyerarşi | Durum + Sorumlu + Son tarih öne, büyük; kalanı ikincil satır; boş alan "+ Pillar" hayalet düğmesi. |
| 9 | Gecikme yalnız **renkle**: masaüstünde son tarih kırmızı, başka işaret yok (mobilde ⚠ var — tutarsız). | Renk | Tarih + "3 gün gecikti" metni (`Intl.RelativeTimeFormat`), ikon. |
| 10 | İkonlar emoji (📋 👥 ⚡ 🔔 🗃️ 📅 ◆): işletim sistemine göre farklı çiziliyor, ağırlıkları uyumsuz, markanın mor/çizgi diliyle çelişiyor. | Marka | ~15 ikonluk satır içi SVG seti (`ui/icons.tsx`), `currentColor`, 1.8 çizgi — karşılama ekranındaki ikonlarla aynı dil. |
| 11 | Ray etiketleri yalnız `:hover`'da (`.rbtn:hover .lbl`): dokunmatikte ve klavyede görünmüyor, ikonlar tek başına anlamsız. | Affordans | `aria-label` + `:focus-visible`'da da etiket; ya da genişleyebilen ray. |
| 12 | Panolar ana sayfasında 12 modül kartının 9'u "Yakında" ve **aynı boyutta** — çalışan üç ekran kalabalığın içinde. | Hiyerarşi · Yoğunluk | Hazır olanlar kart; yakında olanlar altta tek satırlık soluk liste (ya da hiç). |
| 13 | İki yüz iki ayrı görsel dil: mobilde koyu gradyan kartlar (`#382e55→#262039`), masaüstünde açık tablo; köşe yarıçapı 5'ten 16'ya **12 farklı** değer; CSS'te **50 ham hex** ("ham renk yazma" kuralına rağmen). | Marka · Kompozisyon | Tek token seti iki yüzde; yarıçap 3 basamak (8 / 12 / 18); ham renk yalnız `tokens.css`'te. |
| 14 | Açıklayıcı ipuçları BÜYÜK HARF + harf aralıklı ("— KAYIT, AÇIK EYLEM VARKEN KAPANMAZ"): uzun cümle büyük harfte zor okunur, başlıkla yarışıyor. | Tipografi | Büyük harf yalnız ≤2 kelimelik bölüm etiketi; ipucu normal küçük metin. |
| 15 | Mobil "Ana ekrana ekle" kutusu her açılışta listenin tepesinde, kapatılamıyor. | Yoğunluk | Kapatılabilir; kapatma `localStorage`'da (kişisel kolaylık). |

### P3 — Cila

| # | Sorun | Boyut | Düzeltme |
|---|---|---|---|
| 16 | Takımlar ekranı: 3 kart geniş boş tuvalde, açıklama sağ üstte küçük puntoda. | Kompozisyon | Açıklama başlık altına; boş durumda "takım nasıl eklenir" yönlendirmesi. |
| 17 | Tabloda "Düğüm" yolu (Malzeme Temini › Bütçe Onayı) dar ekranda 3 satıra kırılıp satır yüksekliğini üçe katlıyor. | Yoğunluk | Yalnız yaprak adı + `title`'da tam yol; ya da ortadan `…` ile kısalt. |
| 18 | Yinelenen kurallar (`.strip` iki kez `dashboard.css`, `.av`/`.stack` iki kez `base.css`) ve "mobilde renksiz kalmasın diye ortağa taşındı" notları — global kaskadın bedeli. | Marka (bakım) | CSS Modules (bkz. 3.3) bu sınıf hatayı ortadan kaldırır. |
| 19 | Karanlık tema yok (React karşılamasında var). | Renk | Token'lar üzerinden `prefers-color-scheme`; bileşen ham renk yazmadığı sürece bedava. |
| 20 | Mobil üst çubukta sol üstteki ◆ tıklanabilir görünüyor ama bir şey yapmıyor. | Affordans | Kaldır ya da panoya dönüş yap. |

### Genel değerlendirme

En güçlü boyut **kompozisyon ve yoğunluğun iskeleti**: ray + içerik + sağ sohbet sütunu,
kayıt ekranında 2/3 içerik – 1/3 sohbet bölünmesi ve mobildeki büyük başlık / yapışkan
arama / alt sekme kalıbı doğru kurulmuş; alan değişiminin dialogla iki adıma bölünmesi,
40px dokunma hedefi düzeltmesi gibi kararlar gerçek kullanımdan öğrenilmiş ve React'e
aynen geçmeli. En zayıf boyut **renk ve erişilebilirlik**: ikincil metin token'ı AA'nın
altında, durum renkleri metin olarak okunmuyor, odak halkası yok, gecikme yalnız renkle
anlatılıyor. Bunların hepsi token ve tek bir global kuralla çözülüyor — yani React'e
geçiş, ekran ekran uğraşmadan bu sınıfı toptan kapatmanın en ucuz anı.

---

## 2. Taşınacak olanlar (iyi kararlar)

Kopyalanacaklar — yeniden tartışma:

- Alan değişimi **dialogla** (native `<dialog>`), dropdown değil: yanlışlıkla atama yok.
- Kayıt ekranı: sol içerik + sağ sohbet; mobilde sohbet sağ alt balondan açılan tam sayfa.
- Mobil: yapışkan arama, alt sekme + ortada ＋, `font-size:16px` girdiler (iOS yakınlaştırma).
- Silme yerine pasifleştirme; kalıcı silme düzenleme panelinin içinde, yıkıcı görünümde.
- Veri yönetimi ağacında arama = eşleşenler + bütün ataları; "hepsini aç/kapat".
- Alıntılı yanıt, @anma tamamlama, ek + etiket şeridi, lightbox (ctrl/cmd-tık yeni sekme).
- Filtre değişimi **gezinme değil** (`KNOW-234`): Python'da `hx-push-url` beş filtreyi beş
  geri adımına çeviriyordu, kaldırıldı. React'te filtre URL'e `history.replaceState` ile
  yazılır — geçmişe kayıt bırakmaz, ama yenilemede kalır ve bağlantı paylaşılabilir
  (Python'daki "filtre yalnız arama varken URL'e giriyor" pürüzü de kapanır). Kayıt
  açmak gerçek gezinme, `pushState`.
- Yazma başarısızsa kullanıcı görür; ağ koptuysa ayrıca söylenir (iki ayrı ileti).

---

## 3. React yapısı — seçenekler ve öneri

Çerçeve: kullanıcı kodu çoğunlukla okumuyor, **derleyici gözden geçirici**
(`KNOW-294`). Her eksende soru: "hatayı `tsc` mi yakalar, yoksa kullanıcı mı?"
İkinci ölçüt bağımlılık sayısı.

### 3.1 Yüzler: tek paket mi, iki paket mi

| | A. Tek uygulama, Host'a göre dal (bugünkü) | B. Vite çok sayfalı: `app.html` + `dashboard.html` |
|---|---|---|
| Kod paylaşımı | doğal | doğal (aynı `src/`) |
| Paket boyutu | `React.lazy` ile yüz başına bölünür | ayrık |
| nginx | tek `index.html` geri düşmesi | Host başına ayrı geri düşme |

**Öneri: A.** `App.tsx` zaten Host'un ilk etiketine bakıyor; her yüzü `lazy()` ile yükle.
nginx değişmez.

### 3.2 Yönlendirme

| | A. `react-router` | B. Tipli rota birliği, elle (~50 satır) |
|---|---|---|
| Bağımlılık | +1 | 0 |
| Yanlış bağlantı | çalışma zamanında 404 | **derleme hatası** |
| Parametre tipi | `string` | alan bazında tipli |

**Öneri: B.** Rotalar az (yüz başına 5–8) ve sabit. Rota bir *veri tipi*:

```ts
// routes.ts
export type Route =
  | { name: "tasks"; query: TaskQuery }
  | { name: "record"; id: string }
  | { name: "teams" }
  | { name: "team"; id: string }
  | { name: "notFound" };

export function parse(url: URL): Route { /* pathname + searchParams → Route */ }
export function href(r: Route): string { /* Route → "/tasks?team=…" */ }
```

`switch (route.name)` kapsamlılık denetimiyle (`never`) — yeni rota eklenip çizilmezse
derleme düşer. `<Link to={{ name: "record", id }}>` dışında `href` yazılmaz. Tavan:
iç içe yerleşim ve veri yükleyicileri gerekirse router'a geçilir; bugün gerekmiyor.

### 3.3 Biçim

| | A. Tek global CSS + token (bugünkü React, Python'daki) | B. `tokens.css` global + bileşen başına **CSS Modules** | C. Tailwind |
|---|---|---|---|
| Bağımlılık | 0 | 0 (Vite yerleşik) | +1, derleme adımı |
| Sınıf çakışması | var (Python'da yaşandı — P3 #18) | yok | yok |
| Ham renk sızması | disiplinle | disiplinle | sınıf adında |

**Öneri: B.** Python'daki "ortak dosyaya taşındı ki mobilde renksiz kalmasın" notları tam
olarak global kaskadın sorunu. Kural: `tokens.css` dışında hex yok — `npm run build`'e
tek satırlık `grep` denetimi (`! grep -rE '#[0-9a-f]{3,6}\b' src --include=*.module.css`).

### 3.4 Token sözleşmesi

`frontend/src/tokens.css` — iki yüzün tek kaynağı, açık + koyu:

- **Metin:** `--txt`, `--dim` (≥4.5:1 her iki zeminde), durum metinleri `--err-text`,
  `--warn-text`, `--ok-text` (≥4.5:1); zemin tonları `--err-bg`, `--warn-bg`, `--ok-bg`.
- **Tip ölçeği:** `--fs-xs 11px` · `--fs-sm 12.5px` · `--fs-md 14px` · `--fs-lg 16px` ·
  `--fs-xl 20px` · `--fs-2xl 28px`. Mobilde gövde `--fs-lg`. Başka boyut yazılmaz.
- **Yarıçap:** `--r-sm 8px` · `--r-md 12px` · `--r-lg 18px`, çip için `999px`.
- **Aralık:** 4'ün katları (`--s-1 4px` … `--s-6 24px`).
- **Yoğunluk:** `--row-h` tek değişken (bkz. yetenek Y9).

### 3.5 Veri katmanı

| | A. Elle `useApi` kancası + global geçersizleştirme | B. TanStack Query |
|---|---|---|
| Bağımlılık | 0 | +1 (~13 kB gz) |
| Önbellek / geçersizleştirme | elle, ince hata alanı | hazır, anahtar bazlı |
| Odakta tazeleme, sohbet için yoklama, iyimser güncelleme | elle | seçenek |

**Öneri: B.** Kuralın istisnası bilerek: önbellek geçersizleştirme hataları `tsc`'nin
yakalayamadığı türden (eski veri gösterir, derleme geçer). Sohbet yoklaması
(`refetchInterval`) ve iyimser alan değişimi (Y4) de buradan bedava gelir. Tek izinli
çalışma zamanı bağımlılığı bu olsun.

API istemcisi `api/` altında uç başına bir işlev; bileşen `fetch` çağırmaz. Tipler bugün
elle (`api.ts`); ~10 uçtan sonra Rust'tan OpenAPI (`utoipa`) → `openapi-typescript`
(yalnız geliştirme bağımlılığı) — `15-sinirlar.md` "Açık" maddesiyle aynı.

### 3.6 Hata iletileri

API hata = kod (`15-sinirlar.md` kural 3). Ön yüzde tek sözlük, derleyiciyle kilitli:

```ts
export const ERRORS = { not_found: "…", forbidden: "…", conflict: "…", /* … */ }
  satisfies Record<ApiErrorCode, string>;
```

API'ye yeni kod eklenip çevirisi yazılmazsa derleme düşer. `LOGIN_ERRORS` bu kalıba katılır.

### 3.7 Formlar, dialoglar, ikonlar

- Form kütüphanesi yok: native `<form>` + `FormData` + tarayıcı doğrulaması; sunucu
  reddi alan adıyla döner, alanın altına yazılır.
- Dialog: native `<dialog>` + `showModal()` (odak tuzağı ve Esc bedava). Python'da
  kanıtlandı.
- İkon: `ui/icons.tsx`, satır içi SVG, ikon kütüphanesi yok.

### 3.8 Klasör yapısı

```
frontend/src/
  main.tsx  App.tsx            Host → yüz (lazy)
  tokens.css  base.css         token + reset + :focus-visible
  routes.ts                    tipli rota birliği, parse/href
  api/                         uç başına işlev + tipler + ERRORS
    client.ts                  fetch sarmalayıcı: CSRF başlığı, JSON, hata kodu
    me.ts  tasks.ts  records.ts  teams.ts  nodes.ts  search.ts
  ui/                          yüzden bağımsız yapı taşları (+ .module.css)
    Button  Dialog  FieldPill  Chip  Avatar  Segmented  Empty  Toast  icons
  features/                    iki yüzün paylaştığı alan bileşenleri
    record/   FieldStrip  ActionList  CardBlocks
    chat/     Feed  Message  Composer  (mention, quote, attach)
    tree/     NodeTree  NodePicker
  surfaces/
    welcome/  Welcome  Entry
    dashboard/  Shell(Rail)  Tasks  Record  Teams  Team  DataTree  Admin
    app/        Shell(Tabs)  Todo  Search  Actions  Notifications  Record  New
    errors/     NotFound  Forbidden  Offline
```

Kural: `ui/` alan bilmez; `features/` API kancalarını çağırabilir ama yerleşim bilmez
(Python'daki "parça nerede gösterildiğini bilmez" — `10-kararlar.md` skin kuralı);
`surfaces/` yerleşim + rota. Yüzler arası tek fark `surfaces/`'ta.

### 3.9 Taşıma sırası

Her adım önce uç (`check_api.sh`'e iddia), sonra ekran.

1. `tokens.css` + `ui/` çekirdeği + hata ekranları (P1 #1–#5 burada kapanır).
2. Mobil `Todo` + `Record` (günlük en sık ekran).
3. Masaüstü `Tasks` (filtre sadeleştirmesi P2 #7) + `Record`.
4. Sohbet (`features/chat`), yoklamayla.
5. Takımlar, Veri Yönetimi, Yönetim Paneli.
6. PWA (`manifest`, `sw.js`) + push ön yüzü.

---

## 4. Ucuz yeni yetenekler

Ölçüt: yarım–bir günlük iş, yeni tablo ya da yeni servis gerektirmez. Maliyet: **S** ≤ ½ gün,
**M** ≈ 1 gün. "Uç" sütunu Rust'ta ne gerektiğini söyler.

| # | Yetenek | Neden | Uç | Maliyet |
|---|---|---|---|---|
| Y1 | **⌘K komut paleti**: kayıt ara, ekrana git, "yeni kayıt" | Masaüstünde her şeye iki tuş; tam metin arama zaten var | mevcut arama | M |
| Y2 | **Klavye kısayolları**: `/` ara, `c` yeni, `j/k` satır, `Enter` aç, `?` liste | Tablo yoğun kullanım ekranı | yok | S |
| Y3 | **Göreli tarih**: "yarın", "3 gün gecikti" (`Intl.RelativeTimeFormat`) | P2 #9'u da kapatır | yok | S |
| Y4 | **İyimser alan değişimi** + hata olursa geri al ve bildir | Dialog kapanır kapanmaz değer görünür | mevcut | S (TanStack ile) |
| Y5 | **Mobil kartta gerçek hızlı eylem**: ▶ durumu bir adım ilerletir (açık → devam → kapat onayı) | P2 #6'yı yeteneğe çevirir | mevcut durum yazma | S |
| Y6 | **Geri alınabilir bildirim (toast)**: "Kapatıldı · Geri al" 5 sn | Silme/kapatma korkusu azalır; geri al = ters yazma | mevcut | S |
| Y7 | **Kayıtlı görünüm**: filtre sorgu dizgisini ada bağlayıp raya pinle | Filtre URL'de (replace, bkz. §2); ray pinleri Rust'ta saklanıyor | pin'e `query` alanı | M |
| Y8 | **Taslak koruma**: kompozer metni `sessionStorage`'da, gönderince silinir | Yanlışlıkla sayfa değişiminde mesaj kaybolmuyor | yok | S |
| Y9 | **Yoğunluk anahtarı** (sıkı / rahat) tabloda | Tek CSS değişkeni, `localStorage` | yok | S |
| Y10 | **Görülmemiş işareti**: kayıt son açılış zamanı `localStorage`'da, sonrası mesaj varsa nokta | Okundu tablosu olmadan "yeni ne var" | akışta `created_at` (var) | S |
| Y11 | **Filtrelenmiş tabloyu CSV indir** | Toplantıya çıktı; liste zaten sunucudan süzülmüş geliyor | yok | S |
| Y12 | **Panodan görsel yapıştırma** kompozere (`paste` olayı → mevcut ek akışı) | Ekran görüntüsü paylaşımı tek adım | mevcut ek | S |
| Y13 | **Paylaş**: mobilde `navigator.share`, masaüstünde "bağlantıyı kopyala" | Kayıt WhatsApp'a tek dokunuşla | yok | S |
| Y14 | **Uygulama rozeti**: PWA'da `navigator.setAppBadge(n)`, sekme başlığında `(n)` | Ana ekran ikonunda bekleyen iş sayısı | mevcut sayaç | S |
| Y15 | **Karanlık tema** | Token'lar hazır; ham renk yasağı tutarsa bedava | yok | S |
| Y16 | **Yazdırma biçimi** kayıt ekranı için (`@media print`) | Toplantıya kâğıt; ray/kompozer gizlenir | yok | S |

Önerilen ilk paket (bir gün): Y3 + Y4 + Y6 + Y8 + Y15 — hepsi taşıma sırasındaki ilk
ekranlarla birlikte gelir, ayrı iş değil.

---

## 5. Alınmayacaklar

- **HTMX parça mantığı**: React'te sunucudan HTML parçası yok (`15-sinirlar.md`).
- **Mobilde koyu gradyan kart**: iki yüz tek görsel dil (P2 #13).
- **Emoji ikon**, **büyük harf ipucu cümlesi**, **yalnız-hover etiket**.
- **Ön yüzde süzme**: filtre sunucuda kalır; CSV (Y11) yalnız dönen listeyi yazar.
- **Bileşen kütüphanesi** (MUI, Chakra…): token + ~10 `ui/` bileşeni yetiyor;
  kütüphane kendi görsel dilini dayatır.
