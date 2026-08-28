# 60 — Kaynak panolar: çözümleme ve uyarlama planı

Kaynak sistem, bir fabrikanın IWS (Integrated Work System) tarzı saha aracının web
arayüzü. Ekran görüntüleri `spec/gorseller/` altında (git'e girmez). Bu rapor
görüntüleri **yapıya** çevirir: UX akışı + veri hattı olarak ne gördük, bizim
bağlamda ne kuracağız, neyi bilerek almıyoruz.

**Bağlam farkı — her kararın süzgeci:**

| Kaynak | Biz |
|---|---|
| Yüzlerce kullanıcı, 3 vardiya, 7/24 saha | 20–25 kişi, uzaktan, çoğu yönetici rolünde |
| Günlük yön belirleme (DDS), vardiya devri | **Haftalık** yön belirleme (WDS); günlük iş kişinin kendi sorumluluğu, takibi `pillar` ile |
| Operatör kitlesi sürekli veri girer | Az sayıda aktif üye; kalanı ancak kendine dokunanı görürse gelir |
| 26k+ kapalı kayıt ölçeği | Birkaç yüz kayıt; ama sorgu disiplini (`spec/10-kararlar.md`) yine geçerli |

---

## 1. Kaynaktaki veri hattı (büyük resim)

```
prosedür (form tanımı, versiyonlu)
   └─> KAYIT (rapor) ── bir BİRİME açılır (Department > Cell > Machine > Equipment)
          ├─ sınıflandırma: tip, öncelik, kaynak departman, "tekrar eden mi"
          ├─ EYLEMLER (0..n) ── TAKIMA atanır; ayrı son tarih, ayrı durum
          ├─ aktivite akışı: sistem olayları + yorumlar tek kronolojide
          └─ kapanış ──> analiz/istatistik (birim × tip × vardiya × zaman kırılımı)
```

Taşıyıcı gözlemler:

1. **Kayıt ve eylem ayrı varlıklar.** Rapor "ne oldu"yu, eylem "kim ne yapacak"ı
   tutar. Bir rapora birden çok eylem bağlanır; rapor açık kalırken eylemler tek
   tek kapanır. Bildiren ile yapan ayrışır — bizim de istediğimiz bu.
2. **Eylem takıma atanır**, kişiye değil. Takım içinden biri (ilk gören ya da
   lider/mentor) üstlenir veya kişiye dağıtır.
3. **Her kayıt bir birime bağlı.** Birim hiyerarşisi (Veri Yönetimi) tüm
   filtrelerin ve analizlerin omurgası. Bizde karşılığı zaten var: `nodes`.
4. **Arayüzdeki her filtre bir şema sütunu.** Tablo üstündeki açılır kutular
   (tip, öncelik, atanan, birim…) doğrudan sorgu boyutları; UI'a filtre eklemek =
   şemaya sütun/indeks eklemek demek. Boyut envanterini küçük tutan kazanıyor.
5. **Sayaçlar en üstte:** öncelik çipleri (sayılı) + açık/kapalı/tümü. Tek bakışta
   "durum ne" sorusuna cevap; tabloya inmeden.
6. **Kayıt numarası her yerde** (ilk kolon, link, başlıkta `#124629`). İnsanlar
   konuşurken numara kullanıyor. `spec/20-sema.md` açık nokta 4 (okunabilir kod,
   `BÜT-1042`) bu gözlemle **öne çekildi**.

---

## 2. Ekran ekran çözümleme

### 2.1 Panolar ana sayfası → bizde: dashboard ana sayfa (var)

Sadece applet kartlarından oluşan bir grid; süs yok. Bizim `MODULES` grid'i zaten
bu kalıpta — **değişiklik yok**. Alınan ders: modül sayısı ihtiyaçla artar,
iskelet kartlar (`ready: False`) şimdiden doğru yaklaşım.

### 2.2 Görev Yöneticisi (tablo) → `gorevler` yeniden düzenlenir

Kaynaktaki bölgeler, bizim karşılıklarıyla:

| Bölge (`data-fragment`) | Kaynakta | Bizde |
|---|---|---|
| `ozet-cipleri` | öncelik başına sayılı renkli çip | `items` açık kayıtların öncelik kırılımı; tek `SUM(CASE…)` sorgusu |
| `sayaclar` | Open / Closed / All | var (home_stats benzeri), tabloya taşınır |
| `hizli-filtreler` | All / Last Shift / Last Op. Day / Open Actions / Overdue | **Hepsi / Bu hafta / Açık eylemim / Geciken** — vardiya yok, hafta var |
| `boyut-filtreleri` | Shift, Type, PMR, Assignee, Priority, Unit | tür (`kind`), öncelik, takım, atanan, düğüm (alt ağaç), pillar |
| `tablo` | ~18 kolon | **kolon bütçesi 8**: kod, başlık, düğüm, takım, öncelik, durum, son tarih, son hareket |
| `satir → kart` | satır tıkla → detay modalı | mevcut kart sayfası; modal değil sayfa (URL paylaşılabilir kalsın) |

Kaynağın kötü yanı — almıyoruz: kolon enflasyonu (DMS Found, PMR, Report Origin,
Action Resolver…), yatay kaydırma zorunluluğu, mobilde kullanılamazlık. Boyut
eklemek isteyen her istek önce "hangi soruyu cevaplıyor" testinden geçer.

### 2.3 Analysis sekmesi → `pivot` modülünün infografik yüzü

Kaynakta tablo sekmelerinin yanında hazır grafik panelleri var; filtre şeridi
tabloyla ortak. Bizde ayrı modül açılmaz: `pivot` modülü iki yüz kazanır —
çapraz sayım tablosu (mevcut plan) + açık kayıtların hazır kırılımları
(takım × öncelik, yaş dağılımı, pillar, haftalık açılış/kapanış). Aynı filtre
durumu iki yüz arasında taşınır; grafikten hücre tıklayınca aynı filtrelerle
görev tablosuna düşülür. Veri yolu tek: `items` + `actions` üstünde SQL
toplamları. Ayrı bir rapor deposu/ETL **yok**.

### 2.4 Kart detayı → mevcut karta üç ekleme

Kaynak kart modalı, soldan sağa: başlık + durum açılırı → **eylem listesi** →
"bu rapor hakkında" meta bloğu → yapılandırılmış form cevapları → sağ sütunda
aktivite akışı + yorum kutusu. Bizim kartta akış zaten var (`events`,
sistem+mesaj tek kronoloji — koruyoruz, kaynakla birebir aynı felsefe).

Eklenecekler:

1. **Eylem şeridi** — kartın üstünde, tablo halinde: eylem, atanan, son tarih,
   durum. Veri: yeni `actions` tablosu (`spec/20-sema.md §3a`). Eylem olayları
   (açıldı, atandı, kapandı) kartın `events` akışına sistem olayı olarak düşer;
   ayrı akış tutulmaz.
2. **Meta blok** — kod (`BÜT-1042`), tür, düğüm, açan, tarih. Var olan verinin
   sunumu; şema değişikliği yok.
3. **Sabit yapılandırılmış alanlar** — form-builder yok (bkz. §4 Alınmayacaklar);
   `items`'a az sayıda sabit alan: tekrar eden mi, kaynak takım. Öneri
   `spec/20-sema.md §3a`.

Ekler kutusu (WhatsApp medya sekmesi gibi): 🚧 — `attachments` kararına bağlı
(`spec/20-sema.md` açık nokta 1).

### 2.5 Ekipler → yeni modül `ekipler`

Kaynakta takım listesi (ad + üye sayısı) ve takım detayı. Bizim uyarlama daha
zengin: takım kartında tanım/görev alanı açıklaması, üyeler ve rolleri
(lider / mentor / üye), **takım sohbeti** (`events`'in `subject_type='team'`
genişlemesi — kart akışıyla aynı bileşen, skin kuralı sayesinde bedava) ve
**"bu takıma kayıt aç"** kısayolu (yeni kayıt formu `team_id` önceden seçili).

Veri: yeni `teams` + `team_members` (`spec/20-sema.md §2a`), `items.team_id`.

Pasif üyeler için giriş kapısı burası: kendi takımının duvarı + kendine düşen
eylem listesi. Genel tabloyu hiç açmayan biri bu iki yerden sistemde kalır.

### 2.6 Veri Yönetimi → bizde: kazanım ağacı (planı değişmez)

Kaynakta tipli birim kataloğu (Department / Cell / Machine / Equipment…) ve
tipler arası üst-alt ilişki tanımı. Bizde `nodes.node_type` serbest metin — bu
esneklik **korunur**; tip kataloğu ve tip-ilişki matrisi alınmaz (iki ekran ve
bir yönetim yükü eder, 25 kişide getirisi yok).

Kaynaktaki "machine" kavramının önemlisi yapı değil anlamı: ölçülebilir KPI'sı,
kaybı ve plandan sapması olan her şey makine (tasarım ekibi bir makinedir:
girdisi etkinlik detayı, çıktısı afiş). Bu, ilerde düğüme KPI bağlamak
istediğimizde ağacın zaten doğru soyutlama olduğu anlamına gelir. KPI alanları
🚧 — ihtiyaç netleşince (`spec/20-sema.md` açık nokta 6).

### 2.7 Kılavuzlar → 🚧 `dosyalar` modülünün altına

Etiket+filtre ile taranan eğitim/doküman kütüphanesi ("üyelere atılan mail nasıl
olmalı" vb.). Tamamen `attachments` kararına bağımlı; bağımsız bir modül olarak
**şimdi açılmaz**. Karar sonrası `dosyalar` modülünün bir görünümü olur
(düğüme/takıma bağlı dosya + etiket).

### 2.8 Prosedürler → uyarlanmaz; `tanimlar` modülü karşılar

Kaynakta adım adım, versiyonlu, tetikleyicili iş akışı editörü (form-builder).
**Almıyoruz** — gerekçe §4. İhtiyacın bizdeki karşılığı iki parça:

- "işin adımları yazılı dursun" → `tanimlar` modülü (mevcut plan): düğüme bağlı,
  sürümlü tanım metinleri. Adım adım algoritmik açıklama düz metin/markdown
  olarak buraya yazılır.
- "adımlar takip edilsin" → 🚧 haftalık rutin kontrol listeleri (bkz. 2.9).

### 2.9 CL panosu → 🚧 `wds` modülü (haftalık nabız)

Kaynakta: % tamamlanma göstergesi + rol × vardiya tamamlama matrisi (✓/✗) +
eksik kalanların listesi. "Her şey rayında mı"ya on saniyede cevap.

Uyarlama: vardiya ekseni → **hafta**; rol ekseni → kişi ya da takım. Haftalık
yön belirleme (WDS) toplantısının açılış ekranı: bu hafta kapanan/açılan,
geciken eylemler, kişi başına açık iş, rutinlerin tamamlanma durumu. Veri
çoğunlukla `items`/`actions`'tan türer; "rutin" (tekrarlayan görev tanımı)
ayrı tablo ister — şeması dahil 🚧 (`spec/20-sema.md` açık nokta 5). İlk
sürümde rutinsiz, sadece kayıt/eylem nabzıyla açılabilir.

---

## 3. Şemaya etkiler (özet — asıl metin `spec/20-sema.md`)

| Değişiklik | Ne | Durum |
|---|---|---|
| `actions` | kayda bağlı eylemler: atanan, son tarih, durum | **karar** — §3a |
| `teams`, `team_members` | takım, üyelik, rol (lider/mentor/üye) | **karar** — §2a |
| `items.team_id` | kayıt takıma tanımlanır | **karar** — §3a |
| `items.recurring`, `items.origin_team_id` | sabit sınıflandırma alanları | öneri — §3a |
| okunabilir kod | açık nokta 4, öne çekildi | Faz 2 başı |
| `attachments` | açık nokta 1; docker+NAS yönü, saklama süresi sorusu | 🚧 |
| rutinler / WDS | açık nokta 5 (yeni) | 🚧 |
| düğüm KPI'ları | açık nokta 6 (yeni) | 🚧 |

## 4. Alınmayacaklar

- **Form-builder / prosedür editörü.** Versiyonlu akış tanımı, tetikleyiciler,
  şablon adımlar: iki ekran + bir DSL + eğitim maliyeti. 25 kişide formu
  değiştirecek kişi sayısı 1–2; sabit alan + serbest metin aynı işi görür.
- **Vardiya ve DDS.** Uzak ekipte gün içi devir yok; kadans hafta.
- **Fabrika boyutları:** PMR, DMS Found/Solved, Report Origin, 5S alanları,
  Centerline OOL, Skill Matrix, Step Up Card. Karşılık gelen süreç bizde yok.
- **Ayrı "Action Manager" sekmesi.** Eylemler kartın içinde + görev tablosunda
  "Açık eylemim" hızlı filtresi olarak görünür; ikinci bir tablo ekranı açılmaz.
- **Tip kataloğu ekranları** (birim türü tanımlama/ilişkilendirme). `node_type`
  serbest metin kalır.
- **Modal kart.** Kaynakta detay modal; bizde sayfa (URL paylaşılabilir,
  mobilde geri tuşu doğru çalışır).
