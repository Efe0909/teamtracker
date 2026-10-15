# 84 — Serbest metin, mükerrer ve birleştirme

**Durum: tasarım** (Efe ile 2026-10-14). Efe: *"Maliye sayfalarında çok fazla free text bilgi
var ve yazım yanlışları, büyük küçük harf gibi şeylerden çok fazla duplikasyon olacak; bunun
için merge kuralları ve merge'ün tanımına dair de karar verelim."* Karar: birleştirme
**yumuşak ve geri alınabilir**.

Eskizdeki tedarikçi uyarısı ("'Ekin Matbaa' ve 'Matbaa Ekin' aynı tedarikçi olabilir…
Eşleştir") bu belgenin ilk kullanıcısı; Efe onu "harika" buldu.

---

## 1. Tanımlar

| Terim | Anlamı |
|---|---|
| **Varlık** (entity) | Birleştirilebilen tablo satırı türü: bugün `vendors`; sonra §7'dekiler. |
| **Normalize anahtar** (`name_key`) | Adın yazım farklarından arındırılmış hali (§3). Aynı anahtar = aynı şey, kesin. |
| **Aday** (candidate) | Aynı şey **olabilecek** iki canlı satır (§4). Kendiliğinden birleşmez. |
| **Birleştirme** (merge) | İnsanın onayıyla bir satırın (**kaybeden**) diğerine (**kanonik**) katılması (§5). |
| **Takma ad** (alias) | Birleşmiş kaybeden satır: silinmez, `merged_into` ile kanoniği gösterir, aramada bulunur. |
| **Canlı satır** | `merged_into is null`. Listeler, seçiciler ve raporlar yalnız canlı satırları gösterir. |
| **Geri alma** (undo) | Birleştirmenin taşıdığı bağların geri taşınması ve kaybedenin yeniden canlanması (§5.3). |

## 2. Kurallar (özet)

| # | Kural |
|---|---|
| M1 | **Önce kaynağında önle**: serbest metin alanı, canlı satırları **ve takma adları** öneren otomatik tamamlamayla yazılır. Takma ad seçilirse kanonik bağlanır. |
| M2 | **Aynı anahtar = aynı satır**: yeni satır, canlı bir satırla aynı `name_key`'i taşıyamaz (kısmi tekil indeks). API bu durumda yeni satır açmaz, **var olanı döner** (`200`, `existing: true`); ön yüz "Bunu kullandık: Matbaa Ekin" der. |
| M3 | **Benzerlik yalnız öneri**: trigram ya da embedding ne kadar yüksek olursa olsun otomatik birleştirme **yok**. |
| M4 | **Birleştirme yumuşak**: kaybeden silinmez; bütün bağları kanoniğe taşınır; taşınan her bağ günlüğe yazılır. |
| M5 | **Geri alınabilir**: günlükteki bağlar geri taşınır; birleştirmeden **sonra** kanoniğe bağlanan satırlar kanonikte kalır. |
| M6 | **Zincir yok**: kanonik her zaman canlıdır. Takma ada birleştirmek, onun kanoniğine birleştirmektir; kanoniği birleşen satırın takma adları yeni kanoniğe yönlenir. |
| M7 | **Reddedilen aday bir daha önerilmez** (`merge_dismissals`), ta ki iki satırdan birinin adı değişene dek. |
| M8 | Birleştirmeyi **varlığın yazma yetkisi** olan yapar (tedarikçi: `manage_purchases`). |

## 3. Normalize anahtar (`text_key`)

Tek fonksiyon, Rust `normalize::key(kind, s)`; ön yüzde aynısı (`lib/normalize.ts`) yalnız
otomatik tamamlamanın anlık eşleşmesi için. Her ikisi aynı test tablosunu koşar.

1. Unicode NFKC; baştaki/sondaki boşluk atılır.
2. **Türkçe büyük/küçük katlama**: `İ, I, ı → i` (anma anahtarındaki kural, `mentions::handle`).
   Türkçe yazıda `I` hem "ı" hem "i" olabilir; anahtar ikisini birleştirir (yanlış pozitifi
   aday incelemesi yakalar, yanlış negatif mükerrer doğururdu).
3. Aksan katlama: `ç→c, ğ→g, ö→o, ş→s, ü→u, â→a, î→i, û→u` + yaygın Latin aksanları.
4. Noktalama ve sembol → boşluk; `&` → `ve`.
5. Boşluklar tek boşluğa.
6. Varlığa özgü **gürültü sözcükleri** atılır. Tedarikçi: `ltd`, `sti`, `şti`, `as`, `a s`,
   `tic`, `san`, `ve`, `limited`, `sirketi`, `ticaret`, `sanayi`. Liste kodda, test ile.
7. Sonuç: kalan sözcükler **sıralı** (`matbaa ekin` = `ekin matbaa`). Sözcük sırası adın
   kimliğini değiştirmez; bu kural eskizdeki örneği tek başına yakalar.

Örnek: `"MATBAA EKİN Ltd. Şti."`, `"Ekin Matbaa"`, `"ekin  matbaa"` → `ekin matbaa`.

- `name_key` göçte doldurulur, sonra **yalnız uygulama** yazar (ad değişince yeniden hesaplanır).
  DB'de generated column değil: katlama kuralları SQL'de aynı biçimde yazılamaz, kural tek
  yerde (Rust) kalmalı.

## 4. Aday bulma

`GET /api/merge/{entity}/candidates` (yetki: M8). Çiftler üç kaynaktan, birleşimi:

| Kaynak | Ölçü | Eşik |
|---|---|---|
| Sözcük kümesi | anahtarların Jaccard benzerliği | ≥ 0.5 ve ortak sözcük ≥ 1 |
| Trigram | `pg_trgm` `similarity(name_key, name_key)` | ≥ 0.45 |
| Anlam (spec/85) | embedding kosinüs | ≥ 0.90 (servis açıksa) |

- `pg_trgm` göçle açılır (`create extension if not exists pg_trgm`; Postgres contrib'i, hem
  `postgres:16-alpine` hem NixOS paketinde var).
- Her çift bir kez (küçük kimlik önce), en yüksek skorla, **kanıtlarıyla** döner: hangi
  ölçüden geldiği, iki satırın bağ sayısı (ör. 9 teklif / 2 fatura).
- Reddedilmiş çiftler (`merge_dismissals`) elenir.
- En fazla 50 çift; skor sırasıyla.

## 5. Birleştirme

### 5.1 Akış (ekran)
1. Aday kartı: iki satır yan yana, alan alan. Varsayılan **kanonik = daha çok bağı olan**
   (eşitse daha eski); kullanıcı yönü değiştirebilir.
2. **Alan seçimi**: kanoniğin boş, kaybedenin dolu alanları önceden işaretli "kaybedenden al";
   ikisi de doluysa kullanıcı seçer (ad, telefon, e-posta, not…). Ad da seçilebilir.
3. Önizleme: "9 teklif ve 2 fatura Matbaa Ekin'e taşınacak; 'Ekin Matbaa' takma ad olarak
   kalacak."
4. **Birleştir** → tek işlem (§5.2). Toast: "Birleştirildi · Geri al".

### 5.2 Sunucu (`POST /api/merge/{entity}` `{loser, canonical, fields}`)
Tek işlemde, iki satır `for update` kilitli:
1. `canonical` canlı değilse onun kanoniğine çözülür (M6); `loser == canonical` → `400`.
2. Seçilen alanlar kanoniğe yazılır; kanoniğin **eski** değerleri günlüğe.
3. Bağlar taşınır: varlığın bağ listesindeki her `(tablo, sütun)` için
   `update … set col = canonical where col = loser returning id`; dönen kimlikler günlüğe.
4. Kaybedenin takma adları: `update vendors set merged_into = canonical where merged_into = loser`
   (kimlikleri günlüğe).
5. `loser.merged_into = canonical`.
6. Günlük satırı.

Varlığın **bağ listesi** kodda tek sabit (`merge::Entity::refs()`); birim testi listeyi
şemadaki `references <tablo>(id)` yabancı anahtarlarıyla karşılaştırır. Yeni bir FK eklenip
listeye yazılmazsa test düşer; birleştirme o bağı yetim bırakmaz.

```sql
create table merge_log (
  id            uuid primary key default gen_random_uuid(),
  entity        text not null check (entity in ('vendors')),
  loser_id      uuid not null,
  canonical_id  uuid not null,
  moved         jsonb not null,          -- {"material_providers.vendor_id": [...], "invoices.vendor_id": [...], "vendors.merged_into": [...]}
  fields_before jsonb not null,          -- kanoniğin değişen alanlarının eski değerleri
  merged_by     uuid references users(id) on delete set null,
  merged_at     timestamptz not null default now(),
  undone_by     uuid references users(id) on delete set null,
  undone_at     timestamptz
);
create index on merge_log (entity, canonical_id) where undone_at is null;

create table merge_dismissals (
  entity    text not null,
  a_id      uuid not null,
  b_id      uuid not null,
  a_key     text not null,               -- reddedildiğindeki anahtarlar: ad değişince çift geri gelir
  b_key     text not null,
  by_user   uuid references users(id) on delete set null,
  at        timestamptz not null default now(),
  primary key (entity, a_id, b_id),
  check (a_id < b_id)
);
```

`merged_into` tetikleyicisi (DB, son savunma): hedef satırın kendisi canlı olmalı
(`merged_into is null`) ve kendine işaret edemez.

### 5.3 Geri alma (`POST /api/merge/log/{id}/undo`)
- Yalnız **en yeni, geri alınmamış** birleştirme o kanonikte geri alınabilir (LIFO). Daha eski
  bir birleştirmeyi geri almak için önce yenileri geri alınır (`merge_undo_order`).
- `moved`'daki kimlikler **hâlâ kanoniği gösteriyorsa** kaybedene döner (sonradan başka yere
  taşınmışsa dokunulmaz). `fields_before` kanoniğe geri yazılır — o alan birleştirmeden sonra
  elle değişmediyse (değiştiyse o alan atlanır, yanıtta listelenir).
- `loser.merged_into = null`; günlük satırına `undone_at`.
- Geri almanın süre sınırı yok.

## 6. Bugünkü serbest metnin dolgusu (tedarikçiler)

Göç 030 (029 eylem atananlarına gitti) + açılışta çalışan dolgu. Dolgu **uygulandı**:
`api::purchasing::backfill_vendors` (her açılışta, idempotent); aynı bul-ya-da-aç
(`purchasing::ensure_vendor`) tedarikçi/teklif yazarken de kullanılır. Telefon ya da e-posta
gibi görünen `contact` tedarikçi sayılmaz (harf yok, `@` var ya da çoğu rakam). Özgün tasarım:
1. `material_providers.name` (boş değilse) her farklı `name_key` için bir `vendors` satırı
   (ad: en sık yazılış), teklif `vendor_id` ile bağlanır.
2. `name` boş, `contact` telefon değil bağlantıysa: alan adı (ör. `canva.com`) anahtar olur
   ve ad "canva.com" — insan sonra düzeltir.
3. Aynı anahtar = aynı tedarikçi (M2); yakın olanlar aday listesine düşer, insan karar verir.

## 7. Kapsam: hangi serbest metin neye tabi

| Alan | Kural |
|---|---|
| `vendors.name` | M1–M8, tam birleştirme |
| `materials.name` | **birleştirilmez**: her kalem bir etkinliğin ayrı alımı, aynı adlı iki kalem meşru. Analizde `name_key` ile **gruplanır** ("Bardak" ve "bardak (200 adet)" aynı satır değil ama "Bardak" ile "BARDAK" aynı). Otomatik tamamlama geçmiş kalem adlarını önerir (M1). |
| `ledger_entries.description` | serbest; otomatik tamamlama geçmiş açıklamaları önerir. Kategori zaten kontrollü. |
| Etiketler (`tags`) | bugün slug ile tekil (`mentions::handle`); değişmez. |
| Referans düğümleri (yer, kazanım, kategori) | Veri Yönetimi'nde **birleştirme** sonraki adım: aynı kurallar, varlık `nodes`, bağ listesi düğümü gösteren FK'lar. Bu belgeyle gelmez. |
| Kişiler | e-posta tekil; birleştirme yok. |

## 8. Ön yüz

- `ui/Autocomplete` (alan bilmez): yazarken istemci `lib/normalize.ts` ile süzer, sunucudan
  canlı + takma ad listesi (`GET /api/finance/vendors?q=` takma adı kanoniğiyle döner:
  "Ekin Matbaa → Matbaa Ekin").
- Tedarikçiler sayfasında aday şeridi (eskiz), aday kartı ve birleştirme penceresi.
- Birleşmiş tedarikçinin eski bağlantısı (`/finance/vendors/{loser}`) kanoniğe yönlenir ve
  "Ekin Matbaa, Matbaa Ekin ile birleştirildi" şeridi gösterir (geri al bağlantısıyla).

## 9. Sınama

- `normalize::key` tablosu (Rust ve TS aynı JSON fikstürü): eskizdeki üç yazılış, `İ/I/ı`,
  aksan, `Ltd. Şti.`, `&`.
- Birleştir → geri al gidiş-dönüşü: bağlar ve alanlar ilk haline döner; arada eklenen bağ
  kanonikte kalır.
- Zincir: A→B, sonra B→C: A'nın `merged_into`'su C; LIFO geri alma sırası.
- `refs()` listesi ile şemadaki FK'lar.

## 10. Alınmayanlar

- **Otomatik birleştirme** (M3).
- **Sert birleştirme** (satır silme): Efe yumuşak + geri alınabiliri seçti.
- **Bulanık arama motoru** (Meilisearch vb.): `pg_trgm` + embedding Pi ölçeğinde yeter.
