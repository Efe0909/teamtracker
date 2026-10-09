# 74 — Referans veri: operational kökler, shape, slot şemaları

**Durum: uygulanıyor** (Efe onayladı, 2026-10-03). Görüşme İngilizce yapıldı;
terimler bilerek çevrilmedi. Göç `backend/migrations/011_reference_data.sql`,
şemalar `backend/src/refdata.rs`, uçlar `backend/src/api/nodes.rs`, seçiciler
`frontend/src/features/nodes/NodePicker.tsx`.

`72-node-turleri.md` bu konuda **eski**: `ROOT_ONLY = {cell}` ve "kök serbest"
varsayımları burada geçersiz. 72 ile çelişen her yerde bu belge kazanır;
çelişki fark edilirse önce Efe'ye sorulur.

---

## 1. Neden

Veri Yönetimi sayfasının amacı: maintainer (Efe) kulüpte olmasa da düğümler,
seçenek listeleri, etkinlik türleri gibi şeyler **stale kalmasın**. Bugün iki
tür veri aynı yerde karışık:

- **Business logic verisi**: kodun davranışı ona bağlı (node türleri, scope'lar,
  widget türleri, şablonun *mekaniği*). Kod değişmeden değişemez.
- **Referans veri**: "type-safe ama typeless" seçenekler. Kod yalnız *seçenek*
  olarak okur: birimler, etkinlik türleri, ileride diğer dropdown'lar
  (malzeme türü vb.). Varsayımla ya da elle verilmiş adlarla yazılmış ama
  davranışı belirlemeyen her şey zamanla buraya taşınır.

Sınırı **kök düğümler** çizer: kökler ve yapı iskeleti koddan, içleri admin'den.
Her şey için ayrı form yazmak yerine tek bir tree view kullanılır; verinin
%90'ı managed / auto-filled / auto-generated olabilir.

## 2. Kavramlar

| Terim | Anlamı |
|---|---|
| **root** | `parent_id is null` olan düğüm. Yalnız göçle doğar, sabit bir `key` taşır. |
| **operational** | Kod şemasının tanımladığı **slot**. Yalnız sunucu yaratır (kökler ve otomatik çocuklar); UI yaratamaz, türünü değiştiremez. |
| **slot** | Bir operational düğüm; içine hangi türün, hangi şekilde gireceği şemada yazılı. |
| **shape** | Düğümün *çocuklarına* izin: `leaf` (çocuk yok), `list` (bütün çocuklar **aynı türde** — homojen; çocukların kendi alt ağacı olabilir), `tree` (karışık türler, her derinlik). Hangi tür olduğunu şema söyler, shape aynılığı zorlar. |
| **attrs** | `jsonb`; türe göre sunucunun doğruladığı ek alanlar (ör. `offset_days`, `widget`). |
| **schema** | Rust'ta kök başına tanım: izinli türler, otomatik slotlar, shape, attrs kuralları, düzenleme scope'u. |

## 3. Şema değişikliği (göç)

```sql
alter table nodes
  add column key   text unique,                 -- yalnız köklerde dolu
  add column shape text not null default 'tree' check (shape in ('leaf','list','tree')),
  add column attrs jsonb not null default '{}'::jsonb;
alter table nodes add constraint nodes_root_has_key
  check ((parent_id is null) = (key is not null));
-- node_type check'ine: 'option', 'checkpoint', 'widget', 'location'

create table node_favorites (
  user_id uuid not null references users(id) on delete cascade,
  node_id uuid not null references nodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, node_id)
);
```

- **Shape tetikleyicisi** (API'ye ek, el yazısı SQL'e karşı): insert/move/tür
  değişiminde ebeveyn `leaf` ise reddeder; ebeveyn `list` ise çocuğun türü
  kardeşlerinin türüyle aynı olmalı.
- **Taşıma (göç)**:
  1. `Birimler` kökü (`key = 'units'`, `operational`, `tree`) yaratılır.
  2. Bugünkü bütün kökler Birimler'in altına taşınır. `cell` artık kök-yalnız değil.
  3. Kök olmayan bütün `operational` düğümler `generic` olur (elle yaratılmışlardı;
     tohumdaki "Yıllık Bayi Toplantısı 2026" hiç operational olmamalıydı).
  4. `Etkinlik Türleri` kökü (`key = 'event_types'`) ve bugünkü 5 tür, mevcut
     şablonlarıyla (§5) düğüm olarak yaratılır; `events.kind` → `events.kind_id`.
  5. `Etkinlik Yerleri` kökü (`key = 'event_locations'`), `events.place`
     değerlerinden tohumlanır; `events.location_id` eklenir (§5b).
- Ağaç indeksi (`TreeIndex`) açılışta kurulur; göçten sonra yeniden başlatma yeter.

## 3b. Etkinlik Yönetimi kökü (2026-10-09, Efe)

Etkinlikle ilgili referans veri tek kökün altında toplandı (göç `020_event_management_root.sql`):

```
Birimler                  [kök, key=units, tree]
Etkinlik Yönetimi         [kök, key=event_management, list]
├─ Etkinlik Türleri       [bölüm, key=event_types, list → option]
├─ Etkinlik Yerleri       [bölüm, key=event_locations, list → location]
└─ Etkinlik Kazanımları   [bölüm, key=event_outcomes, list → outcome]
```

- **`key` artık yalnız kökte değil**: kök mutlaka key taşır (`parent_id is null` ⇒ key),
  ama key'li düğüm kök olmak zorunda değil. Bölümler operational kalır; kilit
  etiketi "Bölüm" (`locked = operational`), yalnız gerçek kök "Kök" (`root`).
- **`TreeIndex::root_key(id)` = en yakın key'li ata** (kendisi dahil). Seçiciler,
  şemalar (`child_rule`, `editor`) ve `under()` bölüm key'iyle çalışmaya devam
  eder; Etkinlik Yönetimi'nin kendisi `event_management` döner. Bölümler arası
  taşıma `type_not_allowed`.
- **Etkinlik Yönetimi** kökünü yalnız admin düzenler (`Editor::Admin`); altına
  düğüm eklenmez, bölümleri göç yaratır.
- **Etkinlik Kazanımları**: yer listesi gibi düz liste (`outcome`, leaf), `manage_event_outcomes`
  scope'u. Görünen ad kısa, **açıklama** ayırt edici: LLM'lerin ve insanların
  benzer kazanımları birbirinden ayırması için. Henüz etkinliğe bağlanmadı
  (`events` tablosunda kazanım alanı yok) — liste önce dolsun, bağlama ayrı iş.
- **Sabit adlar**: adı koddan belli düğümlerin adı değişmez (`409 name_locked`),
  açıklaması değişir: şablon slotları ("Adımlar", "Widget'lar") ve widget'lar
  (ad `attrs.widget`'ın katalog adı: "Etkinlik talep formu (OTF)", "Satın alımlar").
  Widget eklerken ad sorulmaz; türü değişirse ad yeni kataloğu izler. Göç mevcut
  adları kataloğa çeker.

## 4. Kurallar

### 4.1 Kökler
- Yalnız göçle; UI'da **"Kök düğüm" düğmesi kalkar**.
- Kod kökü **`key`** ile bulur (`units`, `event_types`, `event_locations`), adla değil.
- Veri Yönetimi'nde kökte yalnız **ad ve açıklama** değişir; taşıma,
  pasifleştirme, silme `409`.

### 4.2 Operational
- Kök ya da şemanın otomatik yarattığı slot. Admin operational yaratamaz,
  silemez, türünü değiştiremez; adını değiştirebilir (görünen ad, kod `key`'e
  ya da şemadaki slot adına bakar).
- Operational olmayan düğüm asla kök olamaz.

### 4.3 Shape
- `leaf` / `list` / `tree` çocuklara izni anlatır; API **ve** tetikleyici zorlar.
  `list` = **homojen**: bütün çocuklar aynı türde (ör. Etkinlik Türleri'nin
  bütün çocukları `option`). Çocuğu leaf yapmaz; `option`'ın kendi slotları olur.
- Yeni düğümün shape'i: şema türe bağlıysa şemadan (ör. `checkpoint` = `leaf`);
  Birimler gibi serbest ağaçta varsayılan `tree`, admin değiştirebilir.
- Shape değiştirmek, mevcut çocuklar yeni shape'e uymuyorsa `409`.
- Kökün shape'i şemada sabit.

### 4.4 Türler — kök başına şema (Rust)
Tek `node_type` enum'u kalır; **hangi türün nerede olabileceğini kök şeması
söyler**, API zorlar.

| Kök (`key`) | İçinde | Türü kim atar | Düzenleme yetkisi |
|---|---|---|---|
| Birimler (`units`, `tree`) | `cell`, `machine`, `step`, `task`, `generic` | admin seçer | `edit_nodes` + dal izni; sert silme `hard_delete_nodes` |
| Etkinlik Türleri (`event_types`, `list`) | tür = `option`; altında otomatik slotlar `steps` ve `widgets` (operational); `steps` içinde `checkpoint`, `widgets` içinde `widget` | **sunucu** | yeni scope **`manage_event_types`** (dal izni yok) |
| Etkinlik Yerleri (`event_locations`, `list`) | `location` (leaf) | **sunucu** | yeni scope **`manage_event_locations`** |

- Gelecekteki kökler kendi şemasını ve scope'unu bildirir.
- Birimler'deki `step` (süreç adımı) ile şablondaki `checkpoint` ayrı türler.

### 4.5 attrs
- Sunucu türe göre doğrular; bilinmeyen anahtar `400`.
- `checkpoint`: `{"offset_days": -7}` (etkinlik tarihine göre gün farkı).
- `widget`: `{"widget": "otf" | "supplies"}` — **koddaki listeden seçilir**,
  serbest metin değil (widget türleri business logic: her birinin tablosu ve
  bileşeni kodda). `record` widget'ı şablonda yok (spec/73 §3).

### 4.6 Uyarılar (reddetmek yerine işaret)
Tree view'da uyarı işareti, kayıt reddedilmez:
- eksik ya da bozuk slot (ör. bir `option`'ın `steps` slotu yok),
- koddan kalkmış bir widget türü,
- `offset_days > -7` olan checkpoint (7 gün kuralı, spec/73 §4 — artık uyarı).

### 4.7 Referanslar
- `records.unit_id` ve `team_nodes.node_id` **Birimler alt ağacında** olmalı (API).
- `user_node_scopes` (dal izni) Birimler için geçerli; Etkinlik Türleri scope ile yönetilir.
- Takımlar ve pillar'lar düğüm değil, ayrı tablolar (KNOW-329) — değişmez.

## 5. Etkinlik türleri veri olarak

```
Etkinlik Türleri              [operational, key=event_types, list → option]
└─ Atölye                     [option, list → operational] ← admin ekler
   ├─ steps                   [operational, list] ← sunucu otomatik yaratır
   │  ├─ Eğitmen kesinleşti   [checkpoint, attrs.offset_days = -21]
   │  └─ OTF gönderildi       [checkpoint, attrs.offset_days = -7]
   └─ widgets                 [operational, list] ← sunucu otomatik yaratır
      └─ OTF                  [widget, attrs.widget = "otf"]
```

- Admin bir `option` eklediğinde sunucu `steps` ve `widgets` slotlarını aynı
  işlemde yaratır.
- `events.kind_id uuid not null references nodes(id) on delete restrict` —
  `option` düğümüne. Göç bugünkü 5 türü (toplantı, eğitim, sosyal, saha ziyareti,
  konferans) bugünkü şablonlarıyla düğüm yapar ve mevcut etkinlikleri eşler.
- **Şablon oluşturma anında kopyalanır** (spec/73 §4, değişmez): türü sonradan
  düzenlemek eski etkinlikleri değiştirmez.
- Türü emekliye ayırmak = **pasifleştirme**: seçicilerden kalkar, eski
  etkinlikler göstermeye devam eder. Sert silme yok.
- Rust'taki `EventKind` enum'u ve `template()` kalkar; ön yüzdeki
  `EVENT_KIND` / `EVENT_TEMPLATE` düğümlerden okunur.

## 5b. Etkinlik yerleri

OTF'de de olan alan ("TOPLANTININ YERİ"). Kampüs yerleri düz liste
(`event_locations`, `list` → `location` leaf); bina → oda gruplaması yok.

- `events.location_id uuid references nodes(id) on delete restrict` (bir
  `location`) **ve** mevcut `events.place` metni yedek olarak kalır: kampüs
  dışı / tek seferlik yer için. Seçicide "Diğer… (yaz)" satırı metne yazar.
- Ekranda ve OTF'de: konum seçiliyse adı, yoksa `place` metni.
- Göç listeyi `events.place`'in farklı, boş olmayan değerlerinden tohumlar ve
  o etkinlikleri bağlar.
- Pasifleştirilen yer seçicide çıkmaz; eski etkinlikler göstermeye devam eder.

## 6. Paylaşılan seçiciler

Referans veri seçicileri tek bileşen ailesi: arama + **Favoriler** + yıldız
(`node_favorites`, kişi başına sunucuda), pasif düğümler gizli.

- **Liste seçici** (kökü `list`: etkinlik türü, etkinlik yeri): aranabilir düz
  açılır liste, üstte Favoriler. Alanın metin yedeği varsa (yer) sonda
  "Diğer… (yaz)" satırı.
- **Tree seçici** (kökü `tree`: birimler) — liste seçicinin üstüne katlama:

Kökü `tree` olan her seçici aynı bileşeni kullanır; ilki birim seçici
(kayıt formu, etkinlik formu, filtreler, birim alanı).

- **Açılış**: üstte **Favoriler** grubu; ağaç ilk seviyeye katlı, seçili
  düğümün yolu açık.
- **Arama**: süzer ve eşleşen dalları kendiliğinden açar (Veri Yönetimi gibi).
- **Katlama durumu** cihazda hatırlanır (`localStorage`).
- **Favori**: her satırda yıldız; sunucuda kişi başına (`node_favorites`),
  cihazlar ve mobil arasında taşınır.
- Pasif düğümler gizli; ebeveyn düğümler de seçilebilir.

## 7. Uçlar (taslak)

- `GET /api/nodes` cevabına `key`, `shape`, `attrs`, `warnings[]` eklenir.
- `POST /api/nodes`: tür ve shape şemaya göre doğrulanır; `option` eklemek
  slotları yaratır. Kök yaratma ucu yok.
- `PATCH /api/nodes/{id}`: `attrs` ve `shape` alanları; kök ve operational için
  yalnız ad/açıklama.
- `PUT/DELETE /api/nodes/{id}/favorite`.
- Yeni hata kodları: `root_locked`, `operational_locked`, `shape_violation`,
  `type_not_allowed`, `invalid_attrs`, `unit_outside_units`.

## 7b. Uygulama notları

- Slotları kod adla değil `attrs.slot` (`steps` / `widgets`) ile tanır; slotun
  adı değiştirilebilir.
- Rust'ta `option` türü `NodeType::Choice` (`Option` adı std `Option`'u gölgeler);
  veritabanında ve API'de `option`.
- Tohum (`seed.sql`) kökleri silmez: `users` TRUNCATE edilmez (cascade
  `nodes`'u boşaltırdı), yalnız Birimler'in içi yeniden kurulur.
- `PATCH /api/nodes/{id}` `parent_id: null` kabul etmez (kök yaratılmaz);
  kökler arası taşıma `type_not_allowed`.
- Kullanımda olan tür/yer silinmek istenirse FK `node_in_use` döner; emekliye
  ayırmak pasifleştirmektir.

## 8. Yayın sırası

1. Etkinlik modülü PR'ı (spec/73) **kodda tanımlı türlerle** önce çıkar.
2. Bu belge onaylanınca ayrı PR: kökler + shape + attrs + şemalar, Birimler
   göçü, Etkinlik Türleri (`EventKind` yerine), tree seçici, Veri Yönetimi.

## 9. Açık noktalar

- `option` düğümünün kendi `attrs`'ı (renk, "kampüs içi mi" bayrağı) — **şimdilik
  yok** (Efe).
- Diğer dropdown'lar (malzeme türü, OTF kataloğu…) — kodda kalan varsayımları
  bir explore ajanıyla tarayıp sonra karar verilecek; her biri kendi kökü ve
  şemasıyla, ayrı iş.
- JSON export / cache (shape'in bir gerekçesi) — şimdi gerek yok.
