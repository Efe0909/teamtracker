# 79 — LLM yükü: kişisel ve kurumsal veriden arındırılmış etkinlik verisi

**Durum: ilk dilim uygulandı** (`GET …/llm-context`, `POST …/llm-restore`, `/api/admin/llm`,
`src/redact.rs`, göç 022). Yönetim ekranı ve vektör indeksi **bekliyor** (§6).

## 1. İş

Etkinlik verisiyle LLM'e basit işler yaptırmak: **satın alma önerisi** ("bu etkinlik için
şunlar da gerekir") ve **üye maili taslağı**. Model, etkinliğin kendi alanlarından, OTF
alanlarından ve etkinlik kazanımlarından kurulmuş bir JSON okur. Bu JSON'da **kişisel ve
kurumsal bilgi kesinlikle olmaz**. Bu belge neyin gidip neyin gitmediğini, kuralları ve
kural değişikliğinin nereden yapıldığını tanımlar; model çağrısı (anahtar, istemci,
zaman aşımı) bu belgenin dışındadır.

## 2. Değişmezler

Kod incelemesi bu listeye karşı yapılır. Biri bozuluyorsa değişiklik spec'i de değiştirmek
zorundadır.

1. **Yapısal güvence.** Yük, elle seçilmiş alanlardan kurulan structlardır. `EventRow`,
   `Material`, `users` gibi bir satır ya da `sqlx::FromRow` struct'ı olduğu gibi
   serileşmez. Yeni bir sütun eklenince yüke **kendiliğinden girmez**; girmesi bu belgenin
   §3 tablosuna satır eklemekle olur.
2. **Hiçbir koşulda yükte olmayanlar:** sorumlu, oluşturan, katılımcı ve OTF sorumlusu
   (ad, id, e-posta, telefon), danışman adı, kayıt/ikiz/sohbet kimlikleri, tedarikçi ve
   sponsor adı, teklifin iletişimi (telefon, bağlantı), kulüp adı ve kodu, yerin gerçek
   adı, kişiye ait her kimlik. Katılımcı ve takım **yalnız sayı** olarak gider; teklifler
   firmasız, "Teklif A/B" olarak.
3. **Yer tutucu.** Kulüp `{{KULUP}}`, yer `{{YER}}` olarak gider. Gerçek değer yalnız
   sunucuda, model cevabına `llm-restore` ile konur; modele hiç gitmez.
4. **Serbest metin varsayılan KAPALI.** Başlık, açıklama, yer açıklaması, malzeme notu,
   elle eklenmiş adım etiketi ve OTF metinleri (amaç, yaş grubu, serbest kazanım,
   bölüm notları) yalnız `?free_text=true` ile gider. Tek kapı budur; başka bir yoldan
   serbest metin yüke giremez.
5. **Giden her metin temizleyiciden geçer.** Serbest metin açıkken de, her zaman giden
   kısa etiketler (malzeme adı, kazanım adı/açıklaması, şablon adım etiketi) de. Kural
   kapatılabilir (§4), kapı kapatılamaz.
6. **Yetki.** Yükü etkinliği görebilen herkes alır (gizli ikiz → 403, ikizin sohbeti gibi).
   Temizleme ayarını yalnız admin okur ve yazar. Kontrol her ucun ilk satırında.
7. **Ayar veridir.** Temizleme kuralları DB'de (`llm_config`, tek satır), yeniden derleme
   gerekmez; değişiklik `security_events`'e yazılır (`llm_config_changed`/`_reset`), ayar
   gövdesi yazılmaz.
8. **Tarih mutlak.** `date` ISO gider, yanında `weekday`. Göreli süre (`days_until`) yok;
   modelin "bugün"ü bilmesi çağıranın işidir.
9. **Görev başına daraltma yalnız ÇIKARIR.** Satın alma önerisi yer ve kulüp istemez; mail
   yer tutucu ister. Bir göreve özel yük, tam yükten alan çıkararak kurulur; tam yükte
   olmayan bir alan ekleyemez ve 2-5. maddeler olduğu gibi geçerlidir.
10. **Kapalı ana anahtar.** `free_text_allowed` kapalıyken `?free_text=true` →
    400 `free_text_disabled`.

## 3. Yük şeması

Anahtarlar İngilizce, değerler Türkçe (kullanıcıya gösterilen ad/etiket). "Serbest" =
yalnız `free_text`; "temiz" = her zaman gider ama §4'ten geçer.

| Alan | Kaynak | Gider mi |
|---|---|---|
| `club` | sabit `{{KULUP}}` | her zaman |
| `free_text` | istek bayrağı | her zaman |
| `event.kind` | etkinlik türü düğümünün adı | temiz |
| `event.status`, `priority` | `events` | her zaman |
| `event.date`, `weekday`, `start_time` | `events` | her zaman |
| `event.attendees` | `events` | her zaman |
| `event.participant_count`, `team_count` | sayım | her zaman (liste yok) |
| `event.place` | var ise `{{YER}}` | her zaman |
| `event.title`, `description` | `events` | serbest |
| `event.place_description` | yer düğümünün açıklaması | serbest |
| `outcomes[]` | seçilen Etkinlik Kazanımları (ad, açıklama) | temiz |
| `otf.end_time`, `otf.items[]` | OTF bitiş saati; işaretli kutu + adet (sabit katalog) | her zaman |
| `otf.age_group`, `purpose`, `free_outcomes`, `notes[]` | `event_otf` | serbest |
| `checkpoints[]` | etiket (şablondan geleni), tarih, `done` | şablon adı temiz; elle eklenenin etiketi serbest |
| `materials[]` | ad (temiz), tür, öncelik, aşama, adet, `owned`, `delivered`, `purchased`, bütçe, aşım kademesi | her zaman |
| `materials[].sponsor` | istendi/seçildi, adet, tarih (firma yok) | her zaman |
| `materials[].offers[]` | "Teklif A/B", fiyat, birim fiyat, varış tarihi, seçili mi, kademe | her zaman (firma/iletişim yok) |
| `materials[].notes` | `materials.notes` | serbest |

## 4. Temizleyici (`src/redact.rs`)

Üç kural, ayrı ayrı açılıp kapanır:

- **`patterns`**: e-posta → `{{EPOSTA}}`, bağlantı (`http`, `www.`, `…com/tr/net/…`) → `{{BAGLANTI}}`,
  10+ rakamlı dizi (bosluk/tire/parantezle bölünmüş olabilir: telefon, TC no, IBAN) → `{{NO}}`.
  Nokta ile yazılan tarih (`25.10.2026`) ve `A4`, `M12` gibi kelime içi rakamlar maskelenmez.
- **`known_names`**: veritabanındaki kullanıcı adları → `{{KISI}}`; takım, tedarikçi ve
  kulüp adları → `{{KURUM}}`. Kelime kelime, Türkçe harf katlamalı (`AYŞE`, `ayse`),
  4+ harfli adlarda ek alan biçimler de (`Ahmet'e`, `Ahmetin`); 3 harfli ad yalnız tam eşleşir.
- **`capitalized`**: cümle başında olmayan her büyük harfli, kısaltma olmayan kelime →
  `{{ISIM}}`. Kaba ("Lehim Teli" → "Lehim {{ISIM}}"); kayıtlı olmayan adları yakalamanın tek yolu.

Önayar (kod varsayılanı, "orta"): `patterns` + `known_names`. `{{…}}` yer tutucuları
sonraki geçişlerde yeniden maskelenmez.

**Garanti değildir.** Kayıtsız tek bir ad `capitalized` kapalıyken geçer; metin içindeki
`2026-10-25 14` gibi dizi 10 rakama ulaşıp `{{NO}}` olur (fazla maskeleme kabul). Asıl
güvence 2. ve 4. maddelerdir: kişi alanları yapısal olarak yok, serbest metin varsayılan kapalı.

## 5. Uçlar ve yönetim

| Uç | Kim | Ne |
|---|---|---|
| `GET /api/events/{id}/llm-context[?free_text=true]` | etkinliği görebilen | tam yük (§3) |
| `POST /api/events/{id}/llm-restore` `{text}` | etkinliği görebilen | yer tutucuları doldurur, ≤ 20 000 karakter |
| `GET/PUT/DELETE /api/admin/llm` | admin | `{free_text_allowed, rules{patterns, known_names, capitalized}}`; bilinmeyen alan reddedilir |

**Yönetim ekranı (tasarım, yapılmadı).** Yönetim'deki "Kalite kapısı" yanına "Veri işleme ve
LLM" sayfası: kuralların aç/kapa anahtarları, yoğunluk ön ayarı (düşük = `patterns`,
orta = + `known_names`, yüksek = + `capitalized`; ön ayar arayüz kısayoludur, DB üç
anahtarı tutar), `free_text_allowed` ana anahtarı ve kalite sayfasındaki gibi "Dene" kutusu
(metin yaz, temizlenmiş halini gör). `AdminQuality.tsx` kalıbı.

## 6. Kararlar (2026-10-09, Efe ile)

- Serbest metin varsayılan kapalı, `?free_text=true` ile açık; kurallar ve yoğunluk
  yönetimden ayarlanır, kod değişikliği gerekmez.
- Yer adı yüke girmez: satın alma önerisi için ilgisiz, mail için yer tutucu yeter. Yer
  açıklaması serbest metin sayılır.
- Tarih mutlak.
- **Geçmiş etkinlik/kalem özeti bu yüke konmadı.** Malzeme ve etkinlik listesine vektör
  indeksi (embedding) planlanıyor; benzer geçmiş kalem/fiyat önerisi oradan, daha ilgili
  biçimde gelir. O zaman da §2 geçerli: indekse giren metin aynı temizleyiciden geçer.

## 7. Bilinçli alınmayanlar

- Modele üye listesi, alıcı e-postası ya da herhangi bir kişi verisi. Mail gövdesi
  yer tutucuyla yazılır, kişiselleştirme sunucuda.
- Tedarikçi adı takma adla bile (her çağrıda tutarlı bir takma ad bir eşleme tablosu
  gerektirir; "Teklif A/B" yetiyor).
- Model çağrısı, anahtar, kill switch: yapılırsa 76'daki `decision` kalıbı (dış servis
  kapısı, zaman aşımı, hatada kapalı) örnek alınır; bu belgeye ayrı bölüm olarak eklenir.

## 8. Açık sorular

- Temizleyici gerçek veride ölçülmedi. TASK-370'teki gibi örnek kümesiyle (serbest
  metinlerden 30-50 tanesi) kaçak/fazla-maskeleme oranına bakılmalı; ölçülmeden "yüksek"
  önayarı varsayılan yapılmaz.
- Görev başına daraltma (madde 9) ayrı yük tipleri olarak mı, tam yükü süzen tek bir
  filtre olarak mı kurulacak; hangisi seçilirse §3 tablosuna "hangi görevde" sütunu eklenir.

## 9. Sınama

`redact.rs` birim testleri (kalıplar, tarih/adet dokunulmaz, ek alan adlar, büyük harf,
kapalı kural, geri doldurma); `backend/tools/check_api.sh` `llm_context` bölümü
(yer tutucu, serbest metin kapalı, firma/iletişim/kimlik alanı yok, açınca temizlik,
ana anahtar, admin yetkisi, bilinmeyen alan, geri doldurma).
