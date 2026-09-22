# 17 — Kayıt ekranı keşfi: admin ve ekip üyesi

Durum: **keşif** (2026-09-23). React'te kayıt ekranı (`16-on-yuz.md` §3.9 adım 2–3)
yazılmadan önce kimin, neden, hangi durumda bu ekrana geldiğini sabitlemek için.

## Kanıt ve sınırı

Gerçek kullanıcı görüşmesi **yok**. Personalar *proto-persona*: aşağıdaki üç kaynaktan
çıkarıldı, her iddianın yanında kaynağı yazılı. Doğrulanmadan karar değil.

| Kaynak | Ne verdi |
|---|---|
| Koddaki **14 "kullanıcı isteği" izi** (`shared/templates/ortak/alan.html`, `sites/mobil/templates/strip.html`, `sites/mobil/static/mobil.css:198`, `shared/service.py:878` …) | Gerçek sürtünmeler: yanlışlıkla atama, küçük dokunma hedefi, telefonda görünmeyen alanlar, takım rengini hatırlayamama |
| `spec/61-arastirma-sentezi.md` | Ölçek: 20–25 kişi, çoğu yönetici, haftalık kadans, düşük aktiflik riski, atanmamış havuz |
| `shared/auth.py` `can_edit_item`, `shared/scope.py` `SCOPES`, `spec/71-yonetim-paneli.md` | Kim ne yapabilir: 5 yetki yolu, `edit_deadline` gibi ayrı kapsamlar, admin 1–3 kişi |

Etiketler: **[iz]** koddaki kullanıcı isteği · **[spec]** yazılı karar/araştırma ·
**[kod]** davranış koddan okundu · **[varsayım]** doğrulanacak.

---

## 1. Personalar

### P1 — Deniz, takım üyesi (birincil)

> "Benden ne bekleniyor, onu yapayım, kapatayım."

- **Kim:** Bir-iki takımın üyesi, kendi birimini yöneten biri; sistemde uzmanlaşmak
  istemiyor. [spec 61: "çoğu yönetici", "birden fazla takımda olabilir"]
- **Nereden gelir:** Mobilde bildirim ya da "Yapılacaklar" listesi; masaüstünde nadiren.
  [spec 30, `list_todo.html`]
- **Ekranda ne yapar:** sohbete yazar, eylemi üstlenir/kapatır, durumu ilerletir, görsel ekler.
- **Yetkisi:** atanan/açan/dahil/takım üyesi yolundan düzenler [kod]; son tarihi
  değiştiremeyebilir (`edit_deadline` ayrı kapsam) [kod].
- **Sürtünmeler:** tek dokunuşla yanlış kişiye atadı [iz: `alan.html` "yanlışlıkla atama
  bedava"]; alan hapına parmakla isabet edemedi [iz: `mobil.css:198` "kart silme tuşu
  çalışmıyor"]; telefonda sağdaki alanları göremedi [iz: `strip.html` figure1].
- **Hedef:** en az dokunuşla "benim payım bitti" demek.

### P2 — Selin, admin (birincil)

> "Neden durdu, kimde takıldı — onu bulup çözeyim."

- **Kim:** 1–3 kişiden biri; aynı zamanda bir takım üyesi ve yönetici. [spec 71]
- **Nereden gelir:** Masaüstü görev tablosu → "Geciken" / "Atanmamış" hızlı filtresi,
  ana sayfa sayaçları (`1 açık eylemim`, `0 atanmamış`). [kod: `home.html`, `gorevler.html`]
- **Ekranda ne yapar:** yeniden atar, son tarihi kaydırır, yanlış düğüm/takımdaki kaydı
  düzeltir, kaydı eylemlere böler, eskimiş kaydı kapatır.
- **Yetkisi:** her kayıtta her şey (`is_admin` ilk yol) [kod]. Ekran bunu ona
  **göstermiyor** — üye ile aynı görünüm.
- **Sürtünmeler:** her alan düzenlenebilir olduğu için dikkatsiz değişim riski en yüksek
  onda (dialog iki adımı bu yüzden var) [iz: `alan.html`]; müdahalenin gerekçesini yazacak
  yer yok, ayrı mesaj atmak zorunda [kod: `change_field` yalnız `{field, from, to}` yazar].
- **Hedef:** bir kaydı 1 dakikada teşhis edip doğru kişiye doğru tarihle bırakmak, iz
  bırakarak.

### P3 — Ara sıra giren üye (ikincil)

> "Haftada bir bakıyorum; neyin değiştiğini anlamam zaman alıyor."

- **Kim:** Sisteme WDS öncesi ya da bildirimle giren, çoğu kayıtta yetkisi olmayan kişi.
  [spec 61: "3 ay sonra yarısı girmiyor" riski]
- **Ekranda ne görür:** kapsamı dışındaki kayıtta soluk alanlar, `🔒 salt okunur —
  kapsamın dışında`, **kapalı kompozer**: "Bu kartta yazma yetkin yok". [kod:
  `card_fields.html:54`, `composer.html:21`]
- **Sürtünme:** bir şey bildiği halde söyleyemiyor; "beni dahil et" diyecek yol yok.
  [kod + varsayım]
- **Neden önemli:** spec 61'in "pasif üyeyi içeri çek" hedefiyle doğrudan çelişen tek
  ekran davranışı bu.

---

## 2. Empati haritaları

### Deniz (üye)

| Söyler | Düşünür |
|---|---|
| "Bu bende mi, yoksa havuzda mı?" · "Kapatamıyorum, neden?" | Yanlış bir şeye basarsam herkese bildirim gider. · Bu kaydı son kim ellemiş? |
| **Yapar** | **Hisseder** |
| Bildirimden gelir, sohbete yazar, çıkar. Alanlara nadiren dokunur. Görsel ekler. [kod: mobilde sohbet balonda, alanlar üstte] | Telefonda acele; küçük hedeflerde hata korkusu [iz]. Açık eylem engelinde takılmışlık. |

**Acılar:** kapatma engelini kapatmaya çalışınca öğrenmek (ipucu büyük harf gri metin,
`16` P2 #14); kendisine düşen eylem ile kaydın geneli aynı ağırlıkta.
**Kazançlar:** "üstlendim" / "bitti" tek dokunuş; kendi payının bittiğini görmek.

### Selin (admin)

| Söyler | Düşünür |
|---|---|
| "Bu neden 6 gündür bekliyor?" · "Kim bu eylemin sahibi?" | Değiştirirsem ekip neden değiştiğini bilecek mi? · Bu kayıt doğru düğümde mi? |
| **Yapar** | **Hisseder** |
| Tabloda gecikeni bulur, açar, akışı yukarı kaydırıp son hareketi arar, sorumluyu değiştirir, sonra ayrıca "şundan dolayı değiştirdim" yazar. [kod + varsayım] | Sorumluluk: yanlış müdahale güveni sarsar. Zaman baskısı: çok kayıt, az vakit. |

**Acılar:** "neden durdu" sorusunun cevabı akışın içinde dağınık; gerekçe ile değişim iki
ayrı adım; yetkisinin genişliği görünmez.
**Kazançlar:** tek bakışta teşhis; müdahale + gerekçe tek hareket.

---

## 3. Yolculuk haritaları

### Deniz — "Bana bir eylem atandı"

| Aşama | Yapar | Temas noktası | Duygu | Fırsat |
|---|---|---|---|---|
| 1. Haber alır | Bildirime / listedeki karta dokunur | push, `list_todo` | nötr | Bildirim doğrudan **kendi eylemine** kaydırsın (`#action-<id>`) |
| 2. Bağlam | Başlık + açıklama + son mesajları okur | `dhead`, sohbet balonu kapalı | **düşük** — sohbet gizli, son söz ne bilinmiyor | Başlık altında "son hareket: Selin, 2 saat önce — …" tek satır |
| 3. Üstlenir | Havuzdaki eylemi kendine alır | eylem satırı → dialog | nötr | Havuzdaki eylemde tek dokunuş **"Üstlen"** (spec 61 atanmamış havuz) |
| 4. Çalışır | Sohbete yazar, görsel ekler | kompozer, ek | olumlu | — (iyi çalışıyor) |
| 5. Biter | Eylemi kapatır | eylem dialogu | olumlu | Kapatınca "kayıtta kalan açık eylem: 1 (Efe)" geri bildirimi |
| 6. Kaydı kapatmayı dener | Durum → Kapalı | alan dialogu | **olumsuz** — açık eylem varsa reddedilir | Dialog açılırken engeli önceden söyle: kalan eylemler + sahipleri |

### Selin — "Geciken kaydı çöz"

| Aşama | Yapar | Temas noktası | Duygu | Fırsat |
|---|---|---|---|---|
| 1. Sinyal | Tabloda "Geciken" çipi | `gorevler` hızlı filtre | nötr | — |
| 2. Açar | Kaydı açar | `kayit.html` | nötr | — |
| 3. Teşhis | Son hareketi, eylem sahiplerini, gecikmeyi arar | akış (sağ), eylemler (sol), şerit | **düşük** — cevap üç yere dağılmış | Başlıkta **"top kimde"** satırı: açık eylem sahipleri + her birinin son hareketi + gecikme günü |
| 4. Müdahale | Sorumluyu / son tarihi değiştirir | alan dialogu | gergin | Dialogda **isteğe bağlı gerekçe** — aynı sistem olayının yanına mesaj olarak düşer |
| 5. Bildirir | Ayrıca sohbete "şundan dolayı" yazar | kompozer | angarya | (4 ile birleşir, adım kalkar) |
| 6. Yapıyı düzeltir | Yanlış düğüm/takım | alan dialogu; düğüm değişimi ayrı ekranda | belirsiz | Düğüm de şeritte bir hap (admin/`edit_nodes`) |
| 7. İzler | Sonra geri döner | — | unutma riski | "Takip et" → Y10 görülmemiş işareti yeter |

---

## 4. Sentez

### İçgörüler

| # | İçgörü | Kanıt | Güven |
|---|---|---|---|
| I1 | Ekran **"ne"** sorusunu iyi, **"neden durdu / top kimde"** sorusunu kötü cevaplıyor; admin'in ana işi tam bu. | [kod] cevap şerit + eylemler + akışa dağılmış | orta |
| I2 | **Salt okunur = sessiz.** Kapsam dışındaki kişi yorum bile yazamıyor; bu, pasif üyeyi içeri çekme hedefini ekranın kendisi bozuyor. | [kod] `composer.html:21`, [spec] 61 | yüksek (davranış), orta (etki) |
| I3 | Kullanıcı isteklerinin ortak paydası **yanlışlıkla değişim korkusu** (dialog, büyük hedef, renk). İyimser/hızlı eylem eklerken bu korku unutulmamalı: hız + geri al, onay değil. | [iz] ×5 | yüksek |
| I4 | Değişim **gerekçesiz** kaydediliyor; admin gerekçeyi ayrı mesajla yazıyor. İki hareket, çoğu zaman biri atlanır. | [kod] `change_field` | orta |
| I5 | Kapatma kuralı (açık eylem varken kapanmaz) doğru ama **geç öğretiliyor** — reddedilince. | [kod] `service.py:812` | orta |
| I6 | İki persona ekranı **farklı sırayla** okuyor: üye sohbet → eylem, admin şerit → eylem → akış. Aynı ekran ikisine de yetiyor; fark vurguda, yetkide değil. | [kod] mobilde sohbet balonda [varsayım] okuma sırası | düşük — doğrulanacak |
| I7 | Admin'in gücü **görünmez**: aynı görünüm, her şey açık. Kendi kaydında üye gibi, başkasınınkinde müdahaleci — hangisinde olduğunu ekran söylemiyor. | [kod] `can_edit_item` ilk yol | orta |

### Tasarım etkileri (React kayıt ekranı için)

1. **Tek ekran, rol dalı yok.** Admin ile üye için iki ayrı kayıt ekranı yazılmaz (skin
   kuralı, `KNOW-40`); fark API'nin döndürdüğü yetki bilgisinden gelir (`15` "Yetkilendirme
   Rust'ta").
2. **"Top kimde" satırı** başlığın altında (I1): açık eylem sahipleri, son hareket, gecikme.
   Veri: mevcut eylemler + akışın son olayı; yeni tablo yok.
3. **Salt okunur ≠ susturulmuş** (I2): yazma yetkisi değişmez; yerine büyük **"Beni dahil
   et"** bandı. Karar ve akış §5'te.
4. **Neden düzenleyemiyorum** tek cümle (I7, I2): `🔒` yerine hangi yolun eksik olduğu
   ("takımda değilsin · sorumlu: Deniz"). API yetki *nedenini* kod olarak döndürür, metin
   ön yüzde (`15` kural 3).
5. **Admin müdahale görünümü** (I7): admin *kendi yolu dışında* bir kayıtta düzenlerken
   hapların yanında küçük "admin olarak" işareti — kendisi için farkındalık.
6. **Gerekçe alanı** alan dialoglarında, isteğe bağlı (I4); olaya iliştirilir.
7. **Kapatma engelini önden göster** (I5): durum dialogu açık eylemleri sahipleriyle listeler.
8. **"Üstlen"** havuzdaki eylemde tek dokunuş; geri al bildirimiyle (I3, `16` Y6).
9. **Derin bağlantı** bildirimden eyleme/mesaja. Mesaj çıpası Python'da var ama Türkçe
   (`id="olay-<id>"`, alıntı atlama bunu kullanıyor); eylemin çıpası yok. React'te
   `#event-<id>` ve `#action-<id>`.

`16-on-yuz.md` §4 ile kesişim: Y3 (göreli tarih → gecikme günü), Y4 (iyimser), Y6 (geri al),
Y10 (görülmemiş) bu ekranda ilk kez gerçek ihtiyaca bağlanıyor.

### Açık sorular (doğrulanacak)

1. ~~Kapsam dışındaki kişi yazabilmeli mi?~~ **Karar verildi** (§5): yazamaz, dahil olmayı
   ister.
2. Admin gerçekten tablodan mı geliyor, yoksa bildirimden mi? (P2 giriş noktası — varsayım.)
3. Üyeler mobilde sohbet balonunu açıyor mu, yoksa alanlardan mı çıkıyorlar? (I6)
4. Gerekçe alanı isteğe bağlıyken kullanılır mı, yoksa zorunlu mu olmalı (yalnız admin
   müdahalesinde)? (I4)
5. "Top kimde" satırı eylem sahibini mi, kaydın sorumlusunu mu öne almalı — ikisi farklı
   kişiyse?

---

## 5. Karar: "Beni dahil et" (2026-09-23)

**Karar (kullanıcı):** Yetkisi olmayan kayıtta yazamamak **doğru** — yazma yolu herkese
verilen olağan kapsamlardan (takım üyeliği, düğüm kapsamı, katılım) geçiyor; o yolların
dışında kalmak bilinçli. Sessizliği yetki gevşeterek değil, **istek akışıyla** çözüyoruz:
kayıtta büyük bir "Beni dahil et" bandı; istek adminlerin gelen kutusuna **ve** push'a düşer.

Neden bu şekil: onay mevcut beşinci yetki yolunu açar — **katılımcı** (`item_participants`,
`can_edit_item` üçüncü yol). Yeni yetki kavramı yok; `@anma` ile dahil etmenin
(`shared/mentions.py` `join`) admin onaylı kardeşi.

### Akış

```
Deniz (yetkisiz) kayıtta  ──[Beni dahil et]──▶  access_requests: pending
                                                 │  bildirim: tüm aktif adminler
                                                 │  (gelen kutusu + push, kind=access_request)
Selin (admin)  gelen kutusu / push  ──[Onayla]──▶ item_participants += Deniz
                                                 │  events: "Selin, Deniz'i dahil etti" (sistem olayı)
                                                 │  push → Deniz: "Artık yazabilirsin" → kayda derin bağlantı
                                   ──[Reddet]───▶ push → Deniz: "İsteğin reddedildi" (gerekçe isteğe bağlı)
```

### Ekran

| Durum (API'den) | Bant |
|---|---|
| `can_edit=false`, istek yok | Tam genişlik bant, kompozerin yerinde: "Bu kayıtta yazma yetkin yok. Dahil olursan yazabilir, eylem üstlenebilirsin." **[Beni dahil et]** + neden satırı (etki 4) |
| istek `pending` | Bant soluk: "İstek gönderildi · Selin ya da başka bir admin onaylayınca yazabileceksin" · [Geri çek] |
| istek `rejected` | "İsteğin reddedildi" + varsa gerekçe; 24 saat sonra yeniden istenebilir |
| onaylandı | Bant kalkar, kompozer açılır (sorgu geçersizleştirmesi, sayfa yenilemesi yok) |

Mobilde bant sohbet balonunun **üstünde**, ekranın altına yapışık — kompozerin olacağı yer.
Admin gelen kutusunda istek satırı **satır içi** [Onayla] [Reddet] taşır; kayda gitmeden karar
verilebilir. Push'a basınca aynı satıra gelir.

### Veri ve API (Rust)

```sql
create table access_requests (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references items(id) on delete cascade,
  user_id     uuid not null references users(id),
  created_at  timestamptz not null default now(),
  decided_by  uuid references users(id),
  decided_at  timestamptz,
  approved    boolean,
  reason      text,
  check ((decided_at is null) = (approved is null)),
  check ((decided_at is null) = (decided_by is null))
);
-- Kayıt başına kişi başına TEK bekleyen istek: tekrar basmak spam üretemez.
create unique index access_requests_one_pending
  on access_requests (item_id, user_id) where decided_at is null;
```

| Uç | Kim | Ne yapar |
|---|---|---|
| `POST /api/items/{id}/access-requests` | `can_edit_item` **false** olan aktif kullanıcı | bekleyen istek (varsa aynısını döner, 409 değil); adminlere bildirim |
| `DELETE /api/access-requests/{id}` | isteği açan | bekleyeni geri çeker |
| `GET /api/access-requests?pending` | admin | gelen kutusu listesi: kişi, kayıt başlığı + yolu, zaman |
| `POST /api/access-requests/{id}/approve` | admin | tek işlemde: karar + `item_participants` + sistem olayı + requester'a push |
| `POST /api/access-requests/{id}/reject` | admin | karar (+ `reason`) + requester'a push |

Kayıt yanıtına `access: { can_edit, reason_code, request: null | {id, status, reason} }`
eklenir (`15` kural 2–3: ön yüz yetki kararı vermez, gösterir).

**Kurallar:**
- Bildirim TEK olaydan (`KNOW-238`): isteğin yazıldığı işlem hem gelen kutusu satırını hem
  push'u doğurur; ayrı bir "bildirim motoru" yok.
- Push `kind=access_request`, `aninda` sınıfı (doğrudan kullanıcıya yönelik — `KNOW-135`);
  `tag=access-<item_id>` — aynı kayda gelen istekler telefonda üst üste yığılmaz.
- Onay **ilk kazanır**: iki admin aynı anda basarsa `update … where decided_at is null`
  tek satır günceller, ikinciye "zaten karara bağlandı" döner.
- İstek açan onaylanmadan önce yetki kazanırsa (başka yoldan takıma eklendi) istek
  kendiliğinden anlamsızlaşır: onay adımı `can_edit_item` true ise sadece kapatır.
- Kapalı (`is_active=false`) kullanıcı istek açamaz; kapanan kullanıcının bekleyenleri
  gelen kutusunda "kapalı hesap" diye soluk görünür.

### Kasten yapılmayan

- Onaylayıcı olarak kaydın sorumlusu/takım lideri: **bugün yalnız adminler** (kullanıcı
  kararı). Sorumlu zaten `@anma` ile dahil edebiliyor; gerekirse ikinci adım.
- Kapsam (scope) isteme: istek yalnız **bu kayda** katılım; takım üyeliği ya da düğüm
  kapsamı istemek yönetim panelinin işi (`spec/71`).
- Otomatik onay kuralları, istek sayısı sınırı: tek bekleyen indeksi yeterli fren.
