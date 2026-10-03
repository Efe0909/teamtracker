# 31 — Mobil Arayüz Paritesi ve Geliştirme Planı (`app.<alan>`)

**Durum: taslak.** İlgili belgeler: `spec/30-mobil.md` (temel mobil yapı), `spec/16-on-yuz.md` (ön yüz kuralları), `spec/73-etkinlik.md` (etkinlikler modülü), `spec/75-yetki.md` (yetki kuralları).

---

## 1. Bağlam ve Sorun Tespiti

`alpha-0.2` geliştirme sürecinde `dashboard.` masaüstü yüzüne önemli özellikler ve ergonomi iyileştirmeleri eklendi:
- Etkinlikler modülü (`/events`, `/events/:id`, checkpoint'ler, ikiz kayıt dikişi — `spec/73`)
- Referans veri yönetimi ve `NodeTreePicker` hiyerarşik seçici (`spec/74`)
- Kullanıcı ve profil yönetimi (`ProfileDialog`, avatar/fotoğraf, biyografi, telefon, `profile_complete` kapısı)
- Tema seçimi (`açık`, `koyu`, `sistem`) ve bildirim tercihleri paneli (`NotifySettings`)
- Kayıt detayında `CollapsibleProps` (özellikleri tek satıra daraltma), `ChatBell` (sohbet bildirim zili), `EventSwitch` ve `@kisi` anma prefill'i

Buna karşılık mobil yüz (`app.` — `spec/30-mobil.md`):
1. **Profil & Tema Çıkmazı:** Üst çubuktaki avatar menüsünde sadece "Çıkış yap" var. Mobilden profil düzenlenemez, fotoğraf yüklenemez, tema seçilemez. `profile_complete: false` olan mobil kullanıcı uyarılmaz.
2. **Kayıt Detayı Yığılması:** `Properties` bileşeni mobilde her zaman açık; dikeyde çok yer kapladığı için eylemler, kartlar ve sohbet ekranın altına itilir.
3. **Sohbet Bildirim Zili Eksik:** `ChatSheet` içinde sohbeti sessize alma / bildirim açma zili (`ChatBell`) yok.
4. **Etkinlik Körü:** Etkinliklerin ikiz kayıtları mobilde sıradan kayıt gibi görünür. Etkinliğe ait olduğu, tarihi, checkpoint durumu mobilden anlaşılamaz. Sahadaki kişi checkpoint tamamlayamaz.
5. **Takım Sayfası Boş:** Takım sayfasında açık kayıtlar listelenmez; sadece açıklama ve üye listesi vardır.

---

## 2. Tasarım İlkeleri (Mobil Kısıtlar)

1. **İki Yüz Ayrımı Korunur (`KNOW-153`):** Masaüstü ile mobil birbirine doğrudan link vermez. Mobil `app.` alan adında köktedir.
2. **Varolanı Kullan (Ponytail):** Yeni form/diyalog yazma; `ProfileDialog`, `NotifySettings`, `CollapsibleProps`, `ChatBell` doğrudan bağlanır.
3. **Dokunma ve Alan Ergonomisi:** Dokunma alanları en az `44px` (`--tap`). Küçük ekranda meta alanlar katlanır; işe (eylem ve sohbete) öncelik verilir.
4. **Çevrim ve PWA:** Safari "Ana Ekrana Ekle" PWA deneyimi bozulmaz, viewport ve safe-area boşlukları gözetilir.

---

## 3. Önceliklendirilmiş Yol Haritası

### Faz 1: Temel Kullanıcı ve Kayıt Paritesi (Öncelik: P0 — Hemen)

Sahadaki kullanıcının masaüstüne ihtiyaç duymadan günlük akışını yönetebilmesi için gereken asgari ergonomi.

| # | Madde | Dosyalar | Açıklama |
|---|---|---|---|
| **1.1** | **Mobil Menü Paritesi** | `MobileApp.tsx`, `app.module.css` | Avatara tıklanınca açılan menüye `Profilim` (`ProfileDialog`), `Bildirim Ayarları` (`NotifySettings`) ve `Tema` (`açık`/`koyu`/`sistem`) eklenir. `profile_complete === false` ise açılışta `ProfileDialog` tetiklenir. |
| **1.2** | **Katlanır Özellikler (`CollapsibleProps`)** | `RecordPage.tsx` (app) | Kayıt detayında `Properties` alanı `CollapsibleProps` içine alınır. Mobilde küçük ekranda özellikler tek satır özet olarak daraltılabilir, eylemler ve sohbet öne çıkar. |
| **1.3** | **Sohbet Bildirim Zili (`ChatBell`)** | `RecordPage.tsx` (app) | `ChatSheet` başlığına (`sheetHead`) ilgili kaydın/takımın sohbet zili (`ChatBell`) eklenir. |
| **1.4** | **Anma (@kisi) Prefill Desteği** | `RecordPage.tsx` (app) | Adresteki `?mention=kisi` parametresi okunur; `ChatSheet` açıldığında sohbete `@kisi ` olarak aktarılır ve URL temizlenir. |

---

### Faz 2: Etkinlik (Event) Entegrasyonu & Sahada Checkpoint Takibi (Öncelik: P1 — Yüksek)

Etkinlikler sahada yürütülür; sahadaki personel checkpoint kontrolü yapabilmeli ve etkinlik kayıtlarını ayırt edebilmelidir.

| # | Madde | Dosyalar | Açıklama |
|---|---|---|---|
| **2.1** | **Kayıt Kartlarında Etkinlik Rozeti** | `pages.tsx` (`RecordCard`) | `r.event_id !== null` olan kayıtlarda başlık üstü etiketlerde `Etkinlik` rozeti gösterilir. |
| **2.2** | **İkiz Kayıtta Etkinlik Özeti & Checkpoint Şeridi** | `RecordPage.tsx` (app) | Kayıt bir etkinliğe bağlıysa (`d.event_id !== null`), başlık altında etkinliğin tarihi, yeri ve checkpoint ilerleme çubuğu gösterilir. |
| **2.3** | **Mobilde Checkpoint İşaretleme** | `RecordPage.tsx` (app) veya ortak bileşen | Yetkili kullanıcının mobilden checkpoint'leri tamamlandı/açık olarak işaretleyebilmesi (`toggleCheckpoint`). |

---

### Faz 3: Takım ve Arama Zenginleştirmesi (Öncelik: P2 — Orta)

| # | Madde | Dosyalar | Açıklama |
|---|---|---|---|
| **3.1** | **Takım Açık Kayıtları** | `RecordPage.tsx` (`TeamPage`) | Takım sayfasında "X açık kayıt" düz metni yerine, takıma ait açık kayıtların listesi (`RecordList`) gösterilir. |
| **3.2** | **Arama Kapsamını Genişletme** | `pages.tsx` (`SearchPage`) | Arama sayfası sadece kayıt başlığı değil, takımlar ve kişileri de arayıp gruplar halinde sunar. |

---

### Faz 4: Mobil Etkinlik Listesi Görünümü (Öncelik: P3 — İleri)

| # | Madde | Dosyalar | Açıklama |
|---|---|---|---|
| **4.1** | **Mobil Etkinlik Ajandası** | `pages.tsx`, `routes.ts` | Kullanıcının dahil olduğu veya yaklaşan etkinlikleri listeleyen mobil görünüm (isteğe bağlı yeni sekme veya Yapılacaklar altında filtre). |

---

## 4. Kabul Kriterleri ve Doğrulama

1. **Tip Güvenliği & Testler:** `npm run build` ve `npm test` sıfır hatayla geçer.
2. **Kullanıcı Akışı:**
   - Mobilde avatara basılınca profil düzenlenebilir, fotoğraf değiştirilebilir, tema geçişi çalışır.
   - `RecordPage` açıldığında özellikler katlanabilir; ekran kaydırmadan açık eylemler ve kartlar görünür.
   - `ChatSheet` başlığında zil ikonuyla bildirim durumu değiştirilebilir.
   - Etkinlik kayıtlarında `Etkinlik` rozeti görünür, checkpoint listesi izlenebilir.
