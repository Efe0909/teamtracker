# 79 — LLM yükü: kişisel ve kurumsal veriden arındırılmış etkinlik verisi

**Durum: uygulandı** (`GET …/llm-context`, `POST …/llm-restore`, `/api/admin/llm`,
`src/redact.rs`, göç 022; malzeme önerisi §9; Yönetim › Veri işleme ve LLM §11, göç 024).
Vektör indeksi **bekliyor** (§6).

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
   **Değişecek (§9):** üretken yapay zekâ özellikleri `use_generative_ai` kapsamı ister;
   `llm-context` ve `llm-restore` da (yalnız bu özellikler için anlamlılar) görünürlüğe
   ek olarak bu kapsamı arayacak.
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
| `GET/PUT/DELETE /api/admin/llm` | admin ya da `manage_llm` | `{free_text_allowed, rules{patterns, known_names, capitalized}}`; bilinmeyen alan reddedilir |
| `POST /api/admin/llm/redact-try` `{text, config?}` | admin ya da `manage_llm` | temizleyici denemesi; metin modele gitmez, ≤ 4000 karakter |

**Yönetim ekranı (yapıldı, §11).** Yönetim › Veri işleme ve LLM › Temizleme: kuralların
aç/kapa anahtarları, yoğunluk ön ayarı (düşük = `patterns`, orta = + `known_names`, yüksek =
+ `capitalized`; ön ayar arayüz kısayoludur, DB üç anahtarı tutar), `free_text_allowed` ana
anahtarı ve "Dene" kutusu (metin yaz, taslak kurallarla temizlenmiş halini gör).

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
- Model çağrısı, anahtar, kill switch, limit ve kayıt: §11 (tek çağrı yolu `llm::run`).

## 8. Açık sorular

- Temizleyici gerçek veride ölçülmedi. TASK-370'teki gibi örnek kümesiyle (serbest
  metinlerden 30-50 tanesi) kaçak/fazla-maskeleme oranına bakılmalı; ölçülmeden "yüksek"
  önayarı varsayılan yapılmaz.
- Görev başına daraltma (madde 9): malzeme önerisi için ayrı, tipli bir özet (`MaterialBrief`,
  `Context`'ten alan alan seçilir) kuruldu; mail taslağı da kendi özetini alacak. Ortak bir
  süzgeç yok. Mail özetinin alanları yazılırken §3'e "hangi görevde" sütunu eklenir.
- Parti büyüklüğü (varsayılan 9, yönetimden 3-15, §11) ve sayfa boyu (3) ölçümle ayarlanır:
  reddedilme oranı yüksekse parti küçülür. Kullanıcının kabul/ret sayısı bugün hiçbir yere
  yazılmıyor (ret istemcide kalır); `llm_calls.asked/kept` yalnız sunucu süzgecini anlatır.

## 9. Malzeme önerisi akışı

**Durum: tasarım** (2026-10-09, Efe). Satın alımlar panosunda, malzeme ekleme alanında
silik "öneri kartları". Üretken yapay zekâ ilk kez kullanıcıya görünür.

1. **Kapsam.** `use_generative_ai` (tüm üretken özellikler için tek kapsam; mail taslağı da
   bunu kullanacak). Kapsamı olmayan kullanıcıya **pasif öneri bile gösterilmez**: ön yüz
   `L.can("use_generative_ai")` yoksa hiçbir şey çizmez, uç 403 döner. Öneriyi kabul
   edebilmek için `manage_purchases` de gerekir (ikisi birden); kabul edemeyen kişiye
   gösterilmez. Admin diğer kapsamlar gibi geçer.
2. **Model.** `deepseek/deepseek-v4.1-flash`, OpenRouter sohbet tamamlama
   (`/api/v1/chat/completions`) üzerinden. Düşünme kapalı (`reasoning.enabled = false`),
   yapılandırılmış çıktı (`response_format = json_schema`, `strict`) ve
   `provider.require_parameters` (şemayı desteklemeyen sağlayıcıya yönlenmesin).
   Model adı ve parametreler **yönetimden** (`llm_features`, §11); manifestteki `suggest_model`
   yalnız satır yokken varsayılan. Kill switch `external_off: ["suggest"]`; **anahtar
   `decision` ile aynı `OPENROUTER_API_KEY`**. İstem ve cevap gövdesi loglanmaz; isteğe bağlı
   7 günlük gövde saklama §11.6.
3. **Çıktı.** Modelden yalnız `{items: [{name, description}]}` istenir; arayüz yalnız listeyi
   kullanır. `notes`/`metadata` modele yazdırılmaz (kullanılmayan jeton); metadata
   (model adı, süre, parti kimliği) sunucuda üretilir, kayıt tutulur. `name` →
   `materials.name`, `description` → `materials.notes`.
4. **Sayı yok.** Model adet, tür, öncelik, fiyat ya da "N kişiye şu kadar" kuralı üretmez;
   sayıları her zaman insan belirler. Bu yüzden `attendees` özetten çıkar, şemada `qty`/`type`
   yok. Kabulde kart varsayılanlarla doğar (`qty = 1`, varsayılan tür, öncelik orta).
5. **Tekrar yok.** `existing` (etkinliğin `event_materials` kalemleri) özette gider; ayrıca
   sunucu son süzgeci uygular: önerinin adı (`redact::fold` ile katlanmış) mevcut
   kalemlerle ve `rejected` ile eşleşirse atılır. Model "yok sayarım" demekle yetinilmez.
6. **Parti.** Bir istek tek model çağrısıyla N öneri üretir (varsayılan **9**, yapılandırılır);
   arayüz **3'erli** gösterir. Üçlünün hepsi kabul ya da retle bitmeden sonraki üçlü
   gelmez. Saklanan parti tükenince yeni istek atılır. Aynı çağrıda üretmek, öneriler
   arasındaki tekrarı da azaltır.
7. **Durum istemcide.** Bekleyen parti ve reddedilenler `sessionStorage`'da (etkinlik
   başına anahtar); sekme kapanınca gider. Sunucu **durumsuz**: JWT ya da çerez yok.
   Gerekçe: öneri güvenilmeyen gösterim verisidir, kabul normal malzeme ekleme ucundan
   (yetki ve doğrulama orada) geçer; imzalamak bir şey korumaz. Başka gün reddedilen bir
   öneri geri gelebilir, bu kabul edilen davranıştır.
8. **Uç.** `POST /api/events/{id}/material-suggestions` `{rejected: string[]}` →
   `{items: [{name, description}], batch_id}`. Görünürlük + `use_generative_ai` +
   `manage_purchases`. İstemciden gelen `rejected` güvenilmez metindir: en çok 50 öğe, öğe
   başına ≤ 80 karakter, modele gitmeden `redact`'tan geçer (§2 madde 5).
9. **Çıktı doğrulaması (sunucu).** Boş ad, ≤ 200 sınırını aşan ad, `TEXT_MAX`'ı aşan açıklama
   atılır; `{{…}}` yer tutucusu içeren öneri atılır (maskeler `materials`'a sızmasın);
   liste en çok N öğe. Serbest metin açıkken kullanıcı metni modele gidebildiğinden
   (prompt injection) çıktı yalnız **öneri** sayılır: kabul eden insandır, model hiçbir şeyi
   kendisi yazmaz.
10. **Kabul / ret.** Kabul = mevcut `POST …/materials` (kart silikten gerçeğe döner).
    Ret = istemci listesine eklenir, sunucuya yazılmaz.
11. **Kötüye kullanım.** "3'ü bitmeden yenisi yok" **yalnız arayüz kuralı**; sunucu
    zorlamaz (durumsuz). Maliyeti sınırlayan model başına dolar limiti (§11.3; kullanıcı
    başına sayı limiti bilinçli yok), yönetimden kapatma ve kill switch.
12. **Arayüz.** Silik kart; üzerine gelince ✓ / ✕ (dokunmatikte hep görünür). Düşünme
    göstergesi yok: istek yükleniyor durumunda iskelet kart.

**Sistem istemi bu spec'te yok.** Gerçek istem, model denenerek ayrıca yazılır. Kodda şimdilik
**deneysel** kısa bir istem duruyor (`materials.rs` `SYSTEM`): spec'teki kuralları söyler
(sayı yok, tekrar yok, üniversitenin sağladığı önerilmez, maske kopyalanmaz). Denemeden
çıkan sonuçla değiştirilecek; önceki taslağın istemi (adet ölçekleme, tür tarifi) kaldırıldı.

**İlk deneme (2026-10-10, `deepseek/deepseek-v4.1-flash`, deneysel istem v1).** "Robotik
atölyesi" örneği (18 kişi, OTF'te Arduino/robot kolu amacı; projeksiyon, mikrofon, sınıf
düzeni, çay-kahve; 6 mevcut kalem). Sonuç:
- Parametreler kabul edildi (400 yok): `reasoning.enabled=false`, `json_schema strict`,
  `require_parameters`. Süre 3,4-6 sn, parti 7-8 öneri (9'a ulaşmıyor). Cevap hep şemaya uydu;
  sunucu süzgeci hiçbir şey atmadı (`asked == kept`), model mevcut kalemleri kendi tekrar etmedi.
- `rejected` işe yaradı: ilk 3 öneri ikinci partide gelmedi.
- Serbest metin açıkken (amaç: "robot kolu") öneriler belirgin biçimde daha ilgili (servo motor,
  havya istasyonu); kapalıyken genel elektronik atölyesi listesi.
- Sorunlar (istem v2'nin hedefi): (1) dolgu öneriler (not defteri, masa örtüsü, atölye tepsisi,
  sergi standı); (2) üniversitenin sağladığını önerme (OTF'te sınıf düzeni varken "çalışma
  masası", notta priz isteniyorken "uzatmalı priz"); (3) mevcut Arduino setinin içindekini
  önerme (breadboard, jumper kablo); (4) Türkçe hatası ("Yan keski — eleştirme ve kesme işleri").
  v2 bunlara kural ekledi; yeniden denenmedi.

**Durum (kod).** Yapıldı: `MaterialBrief` sayısız, şema `{items:[{name, description}]}`;
`rejected` girişi; sunucu süzgeci (`sanitize`: tekrar, maske, boş/uzun, en çok 9);
`use_generative_ai` kapsamı (göç 023, `labels.ts`, 75) ve `llm-context`/`llm-restore`/öneri
ucunda kontrolü; `POST /api/events/{id}/material-suggestions` ve OpenRouter çağrısı
(`openrouter.rs`); sözleşme testleri (kapsam, anahtarsız 503). Model **gerçek anahtarla
denenmedi** (`deploy/suggest_try.sh` ile denenir). Ön yüz yapıldı (`SuggestCards.tsx`,
`lib/suggestions.ts`): silik kartlar, ✓/✕, 3'erli gösterim, `sessionStorage`; yeni parti
**yalnız düğmeyle** çekilir (her parti para harcar, hız sınırı henüz yok); kabul edilen
önerinin açıklaması `POST …/materials` `notes` alanıyla kalemin notu olur. Kapsamı olmayana,
`manage_purchases`'ı olmayana ya da `external_off: ["suggest"]` iken (yönetimden kapatılınca
da) hiçbir şey çizilmez. Limit dolunca 429 `suggest_limit`. Yapılacak: istemin gerçek
anahtarla denenmesi (artık yönetimden sürümlü, §11.5). Çağrı geçmişi, maliyet, model ayarı
ve limit §11'de yapıldı.

## 10. Sınama

`redact.rs` birim testleri (kalıplar, tarih/adet dokunulmaz, ek alan adlar, büyük harf,
kapalı kural, geri doldurma); `backend/tools/check_api.sh` `llm_context` bölümü
(yer tutucu, serbest metin kapalı, firma/iletişim/kimlik alanı yok, açınca temizlik,
ana anahtar, admin yetkisi, bilinmeyen alan, geri doldurma).

## 11. Yönetim › "Veri işleme ve LLM"

**Durum: uygulandı** (tasarım 2026-10-10 Efe ile görüşme, görev istemi
`spec/llm-yonetim-prompt.md`; kod göç 024, `src/llm.rs`, `api/llm.rs`, `api/llm_usage.rs`,
`AdminLlm*.tsx`). Önceden model adı manifestte, temizleme kuralları `llm_config`'te, çağrı
sayısı ve maliyet yalnız log satırındaydı. Bu sayfa hepsinin tek yeri: model değiştirmek,
limit koymak, maliyete bakmak kod değişikliği ve dağıtım istemez.

### 11.1 İlke: sözleşme kodda, model veride

- **Özellik (feature) = kod sözleşmesi.** Adı (`material_suggestions`, `quality_gate`), uç türü
  (`chat` = `/api/v1/chat/completions` + `json_schema`; `decisions` = `/api/alpha/decisions` +
  `noul`), cevap şeması, çözücü, sunucu süzgeci (`sanitize`) ve varsayılan istem kodda. Özellik
  yönetimden eklenip silinmez (kalite sorularının adları gibi). Yeni özellik (mail taslağı) = kodda
  yeni sözleşme; aynı çağrı yolu, aynı kayıt, aynı limit.
- **Model ve parametre veridir.** Model adı, parametreler, açık/kapalı, istem, gövde saklama
  DB'de. Her model "takılıp çıkarılır": kod model adı bilmez, uyumluluğu "Dene" kanıtlar (§11.4).
- **Manifest yalnız varsayılan.** `suggest_model`/`decision_model` DB'de satır yokken geçerli.
  `external_off` kill switch olarak kalır: DB'de "açık" olan özellik manifestte kapalıysa kapalıdır.
- **Tek çağrı yolu.** Her LLM çağrısı (iki uç türü de) tek bir sarmalayıcıdan geçer: limit
  denetimi → çağrı → `llm_calls` satırı (başarısız ve ücret doğan dahil) → (açıksa) gövde.
  Bu `llm::run`; malzeme önerisi ve `decision::assess_with` onu çağırır. `openrouter.rs` yalnız
  HTTP'yi bilir (gövde, gönderme, kullanım, kısa hata izi); doğrudan `st.http` yok.
- Özellik "açık/kapalı" (`enabled`) yönetimden; kapalı özellik `/api/meta.external_off`'ta da
  kapalı görünür (ön yüz çizmez).
- Anahtar (`OPENROUTER_API_KEY`) hiçbir cevaba, loga, hata izine, test fikstürüne girmez.

### 11.2 Tablolar (göç 024)

Para `double precision` (sqlx'te `numeric` için ek özellik yok; gösterim ve tavan için yeterli),
pencere `window_minutes int`.

| Tablo | Sütunlar | Not |
|---|---|---|
| `llm_features` | `feature text pk`, `model text`, `params jsonb`, `enabled bool`, `store_bodies bool default false`, `prompt_version int null`, `tested_at timestamptz null`, `updated_by`, `updated_at` | Satır yoksa kod varsayılanı. `params` sözleşmeye göre doğrulanır: `chat` → `max_tokens` (1–8000), `temperature` (0–2, yoksa gönderilmez), `timeout_ms` (1000–60000), `reasoning_off` (bool, varsayılan true), `batch` (yalnız öneri, 3–15); `decisions` → yalnız `timeout_ms`. Bilinmeyen alan reddedilir. |
| `llm_calls` | `id uuid pk`, `created_at`, `feature`, `model`, `user_id null` (users, `on delete set null`), `event_id null` (`on delete set null`), `is_try bool`, `prompt_version int null`, `status text` (check), `http_status int null`, `error text null` (≤ 500), `ms int`, `prompt_tokens int null`, `completion_tokens int null`, `cost_usd double precision null`, `or_gen_id text null`, `batch_id uuid null`, `asked int null`, `kept int null`, `outcome text null` | `status`: `ok`, `limit`, `http`, `timeout`, `network`, `parse`, `schema`. `off` (servis kapalı) **yazılmaz**: çağrı yok, ücret yok; kapı kapalıyken her kayıtta satır doğmasın. `outcome`: kapı için `pass`/`low`. İndeks `(model, created_at)`, `(created_at)`. |
| `llm_call_bodies` | `call_id pk` (→ `llm_calls`, `on delete cascade`), `request jsonb`, `response text null`, `created_at` | Yalnız `store_bodies` açık özellikte. **7 gün** sonra silinir. |
| `llm_usage_daily` | `day date`, `feature`, `model`, `calls`, `errors`, `prompt_tokens`, `completion_tokens`, `cost_usd`, `unpriced` (maliyeti NULL çağrı sayısı), `ms_total`; pk `(day, feature, model)` | **Kişi yok**, kalıcı. Maliyet geçmişi 180 günden eskiye buradan. `limit` satırları girmez. |
| `llm_limits` | `id`, `model text`, `window_minutes int` (check 15 – 44 640), `usd double precision` (> 0), `created_by`, `created_at`; unique `(model, window_minutes)` | Model başına istenen kadar satır. Yoksa sınırsız (varsayılan). |
| `llm_prompts` | `feature`, `version int`, `body text` (≤ 8000), `created_by`, `created_at`; pk `(feature, version)` | Yalnız ekleme. Etkin sürüm `llm_features.prompt_version`; NULL = koddaki istem (sürüm 0). |

**Saklama (gece süpürmesi, `main.rs`'teki günlük `sweep` yanına, `llm::sweep`):** `llm_calls`'ta
duran her kapalı günü (Türkiye saatiyle) `llm_usage_daily`'ye yeniden yazar (upsert, tekrar
koşması güvenli; sunucu günlerce kapalı kalsa da gün kaybolmaz), sonra 180 günden eski
`llm_calls`'u **gün sınırında** ve 7 günden eski `llm_call_bodies`'i siler. Bir gün ya tamamen
`llm_calls`'ta ya tamamen özette: kullanım ucu sınırdan (`llm::boundary`) önceyi özetten,
sonrasını satırlardan okur, çift sayım yok. Kullanıcı ya da sonuç süzgeci özette olmadığından
en çok 180 gün geriye gider. Elle doğrulandı (2026-10-10): 200 günlük satırlar özete yazılıp
silindi, 3 günlük kaldı, `limit` özete girmedi, 8 günlük gövde silindi.

Göç 024 ayrıca `security_events` tür kısıtını genişletir (spec/70 §8): eski liste
`quality_config_*`/`llm_config_*` olaylarını tanımıyordu, o denetim yazmaları düşüyordu.

### 11.3 Limitler: model başına dolar, esnek pencere

- Limit = `{model, pencere, USD}`. Pencere **kayan**: "1 ay" = son 30 gün, takvim ayı değil.
  Arayüz hazır seçenek sunar (15 dk, 30 dk, 1 sa, 2 sa, 8 sa, 1 gün, 1 hafta, 1 ay) ve elle
  dakika/saat/gün girişi; bir modele istenen kadar satır. Kullanıcı başına çağrı sayısı limiti
  **yok** (karar: yalnız dolar).
- Denetim çağrıdan önce, DB'den: modelin her limiti için
  `sum(cost_usd) where model = $1 and created_at > now() - window` ≥ `usd` ise çağrı yapılmaz.
  Süreç içi bellek yok: çok süreçli çalışmada da doğru (`ratelimit.rs` kullanılmaz).
- Aşılınca: öneri → **429 `suggest_limit`** ("Yapay zekâ harcama limiti doldu…"; ön yüz
  bildirim olarak gösterir). Kalite kapısı → kullanıcı **engellenmez**: karar `skipped` (bugünkü
  "hatada geçer" davranışı), uzunluk kuralı sürer. İkisinde de `status = limit` satırı yazılır.
- "Dene" limite takılmaz ama harcamaya sayılır.
- Tavan okunamazsa (DB hatası) çağrı yapılmaz: harcamaya izin vermek yerine kapanır.
- Bilinçli kabul: eşzamanlı çağrılar tavanı en çok uçuştaki çağrıların maliyeti kadar aşabilir.
  Maliyeti NULL çağrı (§11.11) toplamda 0 sayılır; o modelde dolar tavanı işlemez, sayfa
  "maliyet bilinmiyor" der.

### 11.4 Model seçimi, "Dene" ve kayıt kuralı

- **Model listesi:** `GET https://openrouter.ai/api/v1/models` (anahtarsız, açık; 2026-10-10'da
  458 model, `pricing.prompt/completion` jeton başına USD metin, `supported_parameters`,
  `context_length` döndüğü doğrulandı). Sunucuda 1 saat bellekte tutulur; "Fiyatları yenile"
  önbelleği atar. Liste alınamazsa sayfa çökmez, "liste alınamadı" der, elle model adı girilir.
- **Uyumluluk uyarısı (`chat`):** `supported_parameters`'ta `structured_outputs` ya da
  `response_format` yoksa kırmızı; `reasoning` yoksa ve `reasoning_off` açıksa sarı ("bu model
  düşünmeyi kapatma parametresini desteklemiyor; `require_parameters` yüzünden çağrı düşer —
  `reasoning_off`'u kapat"). Fiyatı negatif (`-1`, yönlendirici modeller ör. `typesafe/jev-router`)
  ise "maliyet önceden bilinmiyor".
- **Dene:** sözleşmenin gerçek ucuna gerçek çağrı; kaydetmez. Girdi: öneri için koddaki örnek
  özet (düzenlenebilir JSON) ya da bir etkinlik kimliği (o zaman gerçek, temizlenmiş `llm_context`
  yolu, `llm_config`'in serbest metin kuralıyla); kapı için `{kind, state}` (kalite sayfasındaki
  gibi). Cevap: çözülmüş çıktı, sunucu süzgecinden geçen hali (`asked`/`kept`), süre, jeton,
  maliyet, `or_gen_id` ve **tam iz** (gönderilen istek, sağlayıcının ham cevabı ya da hata
  gövdesi ≤ 16 KB). Tam iz yalnız Dene cevabında döner, **saklanmaz**; `llm_calls`'e
  `is_try = true` satırı (gövdesiz) yazılır. Dene kapalı özellikte de çalışır, zaman aşımı en
  az 20 sn; istem sürümü seçilebilir (`prompt_version`, 0 = koddaki). Servis kapalıysa 503
  `llm_service_off`.
- **Model adı biçimi:** `sağlayıcı/model[:varyant]`, `[A-Za-z0-9/._:-]`, ≤ 200; değilse 400
  `llm_model_invalid`.
- **Kayıt kuralı:** model **değişikliği**, aynı özellik + model için son 30 dk içinde `status = ok`
  bir Dene yoksa reddedilir (400 `llm_model_untested`). Servis kapalıysa (anahtar yok ya da
  `external_off`) Dene yapılamaz: kayıt uyarıyla kabul edilir, `tested_at` NULL kalır, sayfada
  "denenmedi" etiketi. Yalnız parametre değişikliği (aynı model) Dene istemez; sınırlar yeterli.
- **Canlı hata izi kısa:** `llm_calls.status` + `http_status` + `error` (sağlayıcı hata
  kodu/mesajı, ≤ 500 karakter). Sağlayıcı mesajı istemden parça yankılayabilir; bu yüzden ham
  gövde canlıda yalnız `store_bodies` açıkken (`llm_call_bodies`, 7 gün).

### 11.5 İstem DB'de, sürümlü

- Yalnız `chat` özelliklerinin istemi (`material_suggestions` `SYSTEM`). Kapının "istemi" kalite
  soruları; onlar Kalite kapısı alt sekmesinde, yalnız admin (spec/76).
- Yeni sürüm = yeni satır; etkinleştirmek `prompt_version`'ı değiştirir; geri almak eski sürümü
  etkinleştirmek. Etkinleştirme de model gibi son 30 dk'da etkin model + o sürümle geçen bir
  Dene ister (400 `llm_prompt_untested`; servis kapalıysa uyarıyla kabul). Koddaki istem
  `llm::SUGGEST_PROMPT`; özet `max_items` (parti) taşır, istem "en çok `max_items`" der.
- Her etkinleştirme `security_events`'e `llm_prompt_changed` (gövde değil, özellik + sürüm).
- **İstem güvence değildir.** §2'nin yapısal kuralları (kişi alanları yükte yok, serbest metin
  kapısı, temizleyici) ve sunucu süzgeci (`{{…}}` atılır, tekrar atılır, en çok N) istemden
  bağımsız çalışır; kötü bir istem en çok kötü öneri üretir, kişisel veri sızdıramaz.

### 11.6 Gövde saklama (özellik başına anahtar)

- `store_bodies` varsayılan kapalı. Açıkken `llm_call_bodies`'e giden istek (temizlenmiş haliyle,
  modele gittiği gibi) ve cevap yazılır; **7 gün** sonra silinir. Yalnız bu sayfayı görebilen okur.
- Açma/kapama `security_events`'e (`llm_bodies_on`/`llm_bodies_off`).
- **Kalite kapısında dikkat:** kapıya giden `state` kaydın ham başlık + açıklamasıdır (spec/76;
  temizleyiciden geçmez). Gövde saklama orada kayıt metninin 7 günlük kopyası demektir.
- KVKK: spec/70 §8 "LLM çağrı kaydı" maddesi (isteğe bağlı, 7 gün, amaç hata ayıklama).

### 11.7 Erişim: `manage_llm` kapsamı

- Yeni kapsam `manage_llm` (göç + `labels.ts` + spec/75): "Veri işleme ve LLM" sekmesinin
  **tamamı** — modeller, limitler, istemler, çağrı geçmişi, maliyet, gövde anahtarı ve temizleme
  kuralları (karar: temizleme dahil). Admin her şeyi yapar.
- Yönetim menüsü: `is_admin || manage_users || manage_llm`; üçü de yoksa modül hiç görünmez.
  Sekmeler kilitli görünür: `manage_llm` sahibi kişiler/aktivite sekmelerini, `manage_users`
  sahibi LLM sekmesini kilit simgesiyle görür (tıklanmaz).
- **Kalite kapısı LLM sekmesinin içinde** (alt sekme, Efe 2026-10-11): ayrı üst sekme yok. Soru
  metinleri ve eşikler kayıt kararlarını değiştirdiği için **yalnız admin** düzenler
  (`/api/admin/quality` admin'e özel kaldı); admin olmayan `manage_llm` sahibi alt sekmeyi
  kilitli görür. Kapının modeli ve zaman aşımı ise Modeller'de, `manage_llm` ile değişir.
- `GET/PUT/DELETE /api/admin/llm` (temizleme) `admin_only` → `admin || manage_llm`; sözleşme aynı.
- Kontrol her ucun ilk satırında (KNOW-99).

### 11.8 Sayfa

Ekran görüntülerindeki kullanım panosundan alınanlar: üstte durum hapı, ortak süzgeç çubuğu,
KPI kartları, model başına çubuk liste, sonuç dağılımı + "en çok hata veren modeller", sayfalı
çağrı tablosu, fiyat tablosu. Alınmayanlar: CSV dışa aktarma, sütun seçici, önbellek/TPS/
reasoning jetonu kartları (bizde yok), boyut sınırıyla silme (saklama süreyle).

- **Üst:** alt sekmeler (Segmented) Genel · Analiz · Çağrılar · Modeller · Limitler · İstemler ·
  Kalite kapısı (yalnız admin) · Temizleme · Veri. Sağda durum hapı ("Servis açık · 1 234 kayıt" / "Kapalı: anahtar yok" /
  "Kapalı: external_off") ve yenile düğmesi.
- **Ortak süzgeç** (Genel, Analiz, Çağrılar): zaman (bugün, 7 gün, 30 gün, bu ay, tümü; gün
  sınırı Türkiye saati), özellik, model, kullanıcı, sonuç (başarılı / hatalı / limite takılan).
  Sekme değişince korunur. "Tümü" 92 günden uzun aralıkta grafik aylığa döner.
- **Genel:** kartlar — çağrı, başarı oranı, jeton (giriş/çıkış), maliyet, ortalama süre,
  maliyeti bilinmeyen çağrı. OpenRouter anahtar kartı (`GET /api/v1/key`, mevcut anahtarla;
  `usage_daily/weekly/monthly`, `limit_remaining`; 5 dk önbellek). Günlük maliyet, modele göre
  yığılmış çubuk. Limiti en dolu 3 model (ilerleme çubuğu).
- **Analiz:** model tüketimi (maliyet / çağrı geçişi), özellik ve kullanıcı kırılımı, sonuç
  dağılımı, en çok hata veren modeller (hata / toplam).
- **Çağrılar:** tablo (`SortTh`, `lib/sort`) — zaman, özellik, kullanıcı, model, sonuç (durum +
  HTTP), süre, jeton g/ç, maliyet; 50/sayfa, imleçli. Satır açılınca: hata izi, `or_gen_id`,
  `batch_id`, `asked`/`kept`, Dene mi, gövde (varsa).
- **Modeller:** özellik başına kart (uç türü, model, parametreler, açık/kapalı, gövde saklama,
  "denenmeden kaydedildi" etiketi, OpenRouter listesine göre uyumluluk notu) + Dene kutusu. Altında OpenRouter fiyat tablosu: arama, $/1M giriş/çıkış,
  bağlam, uyumluluk işaretleri, bizdeki çağrı ve maliyet; "Fiyatları yenile".
- **Limitler:** model başına satırlar `{pencere, USD, şu anki harcama / tavan}`; ekle, sil.
- **İstemler:** özellik başına etkin sürüm, düzenleyici, sürüm listesi (kim, ne zaman), Dene,
  etkinleştir.
- **Temizleme:** §5'teki tasarım (kural anahtarları, yoğunluk ön ayarı, `free_text_allowed`,
  temizleyici Dene kutusu).
- **Veri:** saklama süreleri (salt okunur: 180 gün satır, 7 gün gövde, özet kalıcı), satır
  sayısı, tablo boyutu, en eski satır; özellik başına gövde saklama anahtarı.
- **Para biçimi:** `$` + Türkçe ondalık; 0,01'in altı 4 anlamlı haneye kadar (`$0,0042`), üstü 2
  hane (`$12,34`). Maliyet NULL ise "—" ve ipucu "bilinmiyor".
- Grafikler CSS ile; yeni bağımlılık yok. Renk yalnız `tokens.css` (`--chart-1..6` eklendi).
- Kod: `surfaces/dashboard/AdminLlm.tsx` (kabuk, Genel, Analiz, Çağrılar),
  `AdminLlmSettings.tsx` (Modeller, Limitler, İstemler, Temizleme, Veri), hesaplar
  `lib/llm.ts` (test: `lib/llm.test.ts`). Kilitli sekme `ui/Segmented`'ın `locked` seçeneği.

### 11.9 Uçlar

Hepsi `admin || manage_llm`, ilk satırda.

| Uç | Ne |
|---|---|
| `GET /api/admin/llm/status` | servis durumu, kayıt/gövde/özet sayıları, boyut, saklama süreleri |
| `GET /api/admin/llm/usage?from&to&feature&model&user&status` | gün × özellik × model satırları (sınırdan önce `llm_usage_daily`, sonra `llm_calls`) + kişi kırılımı; kartlar/grafik/kırılımlar istemcide (`lib/llm.ts`). Varsayılan son 30 gün |
| `GET /api/admin/llm/calls?…&cursor` | çağrı tablosu, 50'şer, `(created_at, id)` imleci + toplam |
| `GET /api/admin/llm/calls/{id}` | ayrıntı + gövde (varsa) |
| `GET /api/admin/llm/key` | OpenRouter anahtar kullanımı (önbellekli); kapalıysa `{off: true}` |
| `GET /api/admin/llm/models[?refresh=1]` | OpenRouter model listesi (önbellekli) + bizdeki kullanım |
| `GET /api/admin/llm/features` · `PUT /api/admin/llm/features/{feature}` | özellik ayarı (model, params, enabled, store_bodies) |
| `POST /api/admin/llm/features/{feature}/try` | Dene (§11.4) |
| `GET /api/admin/llm/prompts/{feature}` · `POST …` (yeni sürüm) · `PUT …/active` | istem sürümleri |
| `GET /api/admin/llm/limits` · `POST` · `DELETE /api/admin/llm/limits/{id}` | limitler |
| `GET/PUT/DELETE /api/admin/llm` | temizleme kuralları (sözleşme aynı, kapı `admin || manage_llm`) |
| `POST /api/admin/llm/redact-try` | temizleyici denemesi (§5) |

Bilinmeyen özellik 404 `not_found`. Yeni hata kodları (`frontend/src/api/errors.ts`'te Türkçe
metinle): `suggest_limit` (429), `llm_service_off` (503), `llm_model_invalid`,
`llm_model_untested`, `llm_params_invalid`, `llm_limit_invalid`, `llm_prompt_invalid`,
`llm_prompt_untested`, `invalid_date`, `invalid_filter`. Ayar değişiklikleri `security_events`'e:
`llm_feature_changed`, `llm_limit_changed`, `llm_prompt_changed`, `llm_bodies_on/off` (gövde
yok, yalnız olay).

### 11.10 Teslimat ve sınama

Üç dilim (kayıt → ayar + limit → istem + gövde + kapsam) planlandı; Efe'nin isteğiyle tek PR'da
birlikte geldi.

- Rust birim: parametre sınırları, model adı biçimi, varsayılanlar, istek gövdesi (düşünme/sıcaklık
  isteğe bağlı), kullanım ve kısa hata izi, cevap çözme hata türleri (`parse`/`schema`), süzgeç
  parti sınırı, süzgeç/imleç/model listesi ayrıştırma, limit doğrulaması.
- Sözleşme (`backend/tools/local_test.sh` → `check_api.sh`): `llm_admin` bölümü anahtarsız
  süreçte (yetki, `manage_llm`, kayıt kuralının servis kapalıyken hali, parametre/model/limit
  doğrulaması, istem sürümleri, kullanım + özet birleşimi, kişi süzgeci, imleçli sayfalama, gövde
  ayrıntısı, denetim izi). `llm_live` bölümü üçüncü süreçte: anahtar `stub-key`, adres
  `tools/openrouter_stub.py` (yalnız geliştirmede okunan `EKIPTAKIP_OPENROUTER_URL`). Öneri
  çağrısı kaydı ve maliyeti, dolar tavanı 429, kapı kaydı (kim, karar, maliyet bilinmiyor),
  Dene hata izi (HTTP 400, `parse`), denenmemiş model 400, denenmiş model kaydı, gövde saklama
  (istekte anahtar yok), istem etkinleştirme kuralı, kapatılan özelliğin `/api/meta`'da kapalı
  görünmesi, anahtar ve model listesi uçları.
- Ön yüz: `lib/llm.test.ts` (para biçimi, pencere, toplama, kovalar, uyumluluk),
  `AdminLlm.test.tsx` (kapsamlara göre kilitli sekmeler, `/api/admin`'in istenmemesi, limit
  formunun özel pencereyi dakikaya çevirmesi), `AdminQuality.test.tsx` (kilitli sekme).
- Tarayıcıda sahte OpenRouter ile elle: sekmelerin hepsi, denenmemiş model reddi, Dene → kaydet,
  limit ekleme, temizleyici denemesi.
- **Gerçek anahtarla denenmedi.** Efe `deploy/suggest_try.sh` ile ya da yayında Dene kutusuyla
  koşar; özellikle kapının (`/api/alpha/decisions`) cevabında maliyet olup olmadığı (§11.11).

### 11.11 Açık sorular

- **Kapının maliyeti.** `/api/alpha/decisions` cevabında `usage`/`id` olup olmadığı bilinmiyor
  (kodda okunmuyor; liste fiyatı `-1`). Gerçek anahtarla bir çağrı gerek (Efe). Yoksa: maliyet
  NULL, kapıda dolar tavanı işlemez; `id` varsa `GET /api/v1/generation?id=` ile gece mutabakatı
  eklenebilir (bu tasarımda yok).
- **Kayan pencere** mi takvim mi: varsayılan kayan ("1 ay" = 30 gün). Takvim ayı istenirse
  pencere türü sütunu eklenir.
- **Model tek, yedek yok.** Etkin model düşerse (sağlayıcı kesintisi) çağrı hata döner; ikinci
  model (fallback) bu tasarımda yok, OpenRouter'ın `models: [...]` dizisiyle sonra eklenebilir.
- Kullanıcı kabul/ret sayıları hâlâ istemcide (§8); `kept` yalnız sunucu süzgecini anlatır.
