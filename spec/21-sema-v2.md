# 21 — Veri şeması v2 (Rust yeniden yazımı)

`20-sema.md` **bugünkü** Python şemasını anlatır ve yürürlükte kalır. Bu dosya
onun yerine geçmez: Rust yeniden yazımıyla (`axum + askama + HTMX`, faz 0.2)
birlikte devreye girecek **hedefi** tarif eder.

Yalnız **değişen** tablolar burada. Geçmeyenler — `users`, `nodes`, `teams`,
`team_members`, `record_participants`, `tags`, `attachment_tags`,
`storage_volumes`, scope/rol tabloları, `push_subscriptions`, `user_pins`,
`security_events` — için `20-sema.md` geçerli.

Göç dosyaları bu portta **tek dosyaya sıkıştırılır** (`001_schema.sql`).
CLAUDE.md'deki "göç dosya adları donuk" kuralı kurulu bir veritabanı olduğu
için yazılmıştı; alpha'da veritabanı atılıp yeniden kuruluyor, o yüzden bu
geçişte serbest. İlk gerçek kurulumdan sonra tekrar donarlar.

---

## Neden v2

Test şu: **ürünü bilen yeni bir mühendis, ekrandaki bir şeye parmak basıp
hangi tabloda durduğunu tahmin edebiliyor mu?**

Bugün edemiyor. Sohbet mesajları `events` tablosunda duruyor — bir mesajı
elle izlemeden bulunamıyor. Sebep isim değil, **sınır**: `events` iki ayrı
şeyi taşıyordu. Konuşma (düzenlenir, yanıtlanır, ek alır, silinince kaybolur)
ile denetim kaydı (ölü satır, kayıt silinse de yaşamalı). Farklı yaşam
döngüsü, tek tablo.

### Kural: tür sütununu sil, satır ne olduğunu hâlâ söylüyor mu?

| sütun | silinince | karar |
|---|---|---|
| `events.event_type` | konuşma mı denetim mi — **belli değil** | **böl** |
| `attachments.owner_type` | neye asılı — **belli değil**, üstelik FK yok | **böl** |
| `records.kind` | başlıklı, durumlu, sahipli kayıt — belli | tek tablo |
| `nodes.node_type` | ebeveynli, adlı, sıralı ağaç node'u — belli | tek tablo |
| `activity.verb` | günlük satırı — belli | tek tablo |
| `cards.card_type` | bir bloğun sunum verisi — belli | tek tablo |

Ayrımı yapan şey: `card_type` **şablon** seçer, `event_type` **yaşam döngüsü**
ayırıyordu. Tür sütunu tek başına suç değil; iki farklı ömrü tek tabloya
tıkması suç.

---

## 1. `records` — kayıt (soyut iş)

Ürün dilinde: "duyuru paylaş" gibi kapsayıcı iş. Altındaki ısırık büyüklüğünde
işler `actions`'ta durur.

```sql
create table records (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references nodes(id) on delete cascade,
  pillar_id   uuid          references nodes(id) on delete set null,
  team_id     uuid          references teams(id) on delete set null,
  chat_id     uuid not null unique references chats(id) on delete restrict,
  kind        text not null check (kind in ('issue','task')),
  title       text not null,
  description text,
  status      text not null default 'open'
              check (status in ('open','in_progress','pending','closed','cancelled')),
  priority    text not null default 'medium'
              check (priority in ('critical','high','medium','low')),
  owner_id    uuid          references users(id) on delete set null,
  created_by  uuid not null references users(id) on delete restrict,
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  search_vector tsvector generated always as
    (to_tsvector('tr', coalesce(title,'') || ' ' || coalesce(description,''))) stored
);
```

v1'den farklar:

| v1 | v2 | neden |
|---|---|---|
| `node_id` | `unit_id` | rol adı — kayıt bu birimde *durur* |
| `pillar_node_id` | `pillar_id` | aynı, kısaltıldı |
| `assignee_id` | `owner_id` | sorumlu kişi; `created_by` satırı *açan* kişi, ikisi ayrı |
| `dms` | **düştü** | ölü sütun — yalnız `seed.py` yazıyordu, hiçbir yer okumuyordu |
| `escalated` | **düştü** | aynı |
| — | `chat_id` | sohbet artık ayrı varlık (§5) |
| `status` 4 değer | + `cancelled` | `actions` ile simetri |

### `kind` bir ETİKET, boyut değil — karara bağlandı

Kod tarandı: `kind` üzerinden dallanan tek şey **görünüm**. Şablonlarda
"Hata"/"Görev" rozeti ve CSS sınıfı (`card_head.html`, `takim_kayitlar.html`),
`filters.py`'de bir açılır liste, `service.py`'de değerin geçerliliği. **Hiçbir
alan farklı değil, hiçbir davranış farklı değil.**

Tür sütununu silme testi: `kind` gitse satır hâlâ başlıklı, durumlu, öncelikli,
sahipli bir kayıt. Kategorize ediyor, kimliklendirmiyor → **tek tablo, sütun
kalır.**

`created_by` artık **açıkça** `on delete restrict`. v1'de bu bir kaza idi
(varsayılan `NO ACTION`); kullanıcı silmeyi fiilen imkânsız kılıyordu ve
`users.is_active` bu yüzden var. Karar olarak yazıldı, miras olarak değil.

## 2. `actions` — ısırık büyüklüğünde iş

Ürün dilinde: "post'ta hangi fotoğraflar öne çıkacak, karar ver". **Kişiye
atanır** — yukarıdan aşağı. Mobilde "Eylemler" sekmesi bunu gösterir.

```sql
create table actions (
  id          uuid primary key default gen_random_uuid(),
  record_id     uuid not null references records(id) on delete cascade,
  title       text not null,
  owner_id    uuid          references users(id) on delete set null,
  created_by  uuid not null references users(id) on delete restrict,
  status      text not null default 'open'
              check (status in ('open','in_progress','closed','cancelled')),
  due_date    date,
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index actions_record_idx on actions(record_id);
create index actions_open_idx on actions(record_id) where status in ('open','in_progress');
create index actions_owner_idx on actions(owner_id) where status in ('open','in_progress');
```

Tek fark: `assignee_id` → `owner_id`.

**Havuz kartı buraya taşınmadı.** Tartışıldı ve reddedildi: havuz bir *karttır*
(§4) — küçük bir bilgi kutusu, sorgulanacak bir varlık değil. "Müsait olan
alsın, kampüse afiş asılacak" bir şablonla çizilir, `actions` satırı olmaz.

### Mobil ekranların karşılığı

```sql
-- "Yapılacaklar" — katılımcısı olduğum kayıtlar, yalnız sahibi olduklarım değil
select i.* from records i
  join record_participants p on p.record_id = i.id
 where p.user_id = $me and i.status <> 'closed';

-- "Eylemler" sekmesi — bana atanmış işler
select * from actions where owner_id = $me and status in ('open','in_progress');
```

## 3. `cards` — sunum blokları

Kart = **arayüzde önceden tanımlı bir HTML şablonu** + onu dolduran JSON.
Sorgulanacak varlık değil; kayıt gövdesine yapıştırılan bilgi kutusu.
Türler bugün: `media`, `meeting`, `pool`.

```sql
create table cards (
  id         uuid primary key default gen_random_uuid(),
  record_id    uuid not null references records(id) on delete cascade,
  card_type  text not null,
  data       jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index cards_record_idx on cards(record_id, sort_order, created_at);
```

v1'den iki fark:

- **`title` sütunu düştü** — şablon içeriği, `data` içine girer.
- **`card_type` CHECK'i düştü.** Tür listesi zaten kodda tek kaynak
  (`CARD_TYPES`); CHECK her yeni tür için bir göç isterken hiçbir şey
  garanti etmiyordu. Dahası: kodda kaldırılan bir tür CHECK'te kalırsa
  tam da §6'daki "sahipsiz tür" durumu doğuyordu. Render tarafı bilinmeyen
  türü zaten karşılıyor.

Yetki **asla blob okumaz**: silme/düzenleme hakkı `created_by` ve kaydın
scope'undan çıkar. Bozuk bir kart bu yüzden silinebilir kalır (§6).

## 4. Karta katılım — `card_signups` tablosu düştü, blob'a girdi

Toplantı yoklaması ("Katılıyorum / Belki / Katılamıyorum") ve havuz kartına
yazılma ("Bu işi alıyorum") artık kartın kendi `data` blob'unda:

```json
{ "title": "…", "starts_at": "…",
  "signups": { "<user_uuid>": {"answer":"yes","note":"","at":"…"} } }
```

Kullanıcı kimliğiyle anahtarlı — `(card_id, user_id)` birincil anahtarının
yaptığı işi sözlük yapısı yapıyor, çift cevap imkânsız.

**Yazma TEK ifadeyle olur, uygulamada okuyup-değiştirip-yazma yok:**

```sql
-- cevap ver / değiştir
update cards set data = jsonb_set(data, array['signups', $2], $3::jsonb, true)
 where id = $1;
-- geri çek
update cards set data = data #- array['signups', $2] where id = $1;
```

Postgres ifade boyunca satır kilidi tutar, iki eşzamanlı yazım sıraya girer.
Kaybolan yazım yok. **Blob'u `SELECT` edip Rust'ta değiştirip geri yazmak
yasak** — yarış tam olarak orada doğar, `jsonb_set`'te değil.

Ayrı tablo tutma gerekçesi tartışıldı ve düştü:

- *"Katılım farklı yetkiye tabi"* — doğru ama tabloyla ilgisiz. Yetkiyi uç
  uygular, tablo değil; `attachment_tags`'in `can_tag` kapısı da düzenleme
  yetkisinden ayrıdır. Katılım ucu (`POST /card/{id}/signup`) kendi kapısını
  tutar; kaydı düzenleyemeyen biri yine kendi adına cevap verir.
- *"Eşzamanlı yazım kaybolur"* — yalnız okuyup-değiştirip-yazarsan. Yukarıdaki
  atomik yazımla sorun yok.

**Dikkat edilecek tek şey:** kartlar arası sorgu. "Katıldığım toplantılar"
ekranı bir gün gelirse `data->'signups'` üzerinden GIN indeksi gerekir; tabloda
bu `where user_id = $me` kadar ucuzdu. Bugün böyle bir ekran yok — geldiğinde
indeks eklenir, şema değişmez.

## 5. `chats` + `messages` — konuşma

`events` bölündü. Konuşma tarafı:

```sql
create table chats (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references chats(id) on delete cascade,
  author_id   uuid references users(id) on delete set null,
  body        text not null,
  reply_to_id uuid,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  unique (chat_id, id),
  foreign key (chat_id, reply_to_id) references messages(chat_id, id) on delete set null
);
create index messages_chat_idx on messages(chat_id, created_at);
```

`chats` **kendi başına bir varlık**: içinde `record_id`/`node_id` taşımaz.
Bağ ters yönde kurulur — `records.chat_id` ve `teams.chat_id`, ikisi de
`not null unique`. Sohbet kayıtla aynı işlemde doğar; "bu kaydın sohbeti
var mı" diye bir dal hiçbir yerde olmaz.

`(chat_id, reply_to_id)` bileşik FK'si **yanıtın sohbet dışına
taşmasını veritabanında engeller** — v1'deki `valid_reply_target()`
uygulama kontrolü tamamen düşer.

### Yetim sohbet: tetikleyici şart

FK `records → chats` yönünde olduğu için cascade ters akıyor. Kayıt silinince
sohbet satırı, mesajları ve o `messages` satırlarının `attachments`'ları arkada kalırdı:

```sql
create function drop_chat() returns trigger as $$
begin delete from chats where id = old.chat_id; return null; end $$ language plpgsql;

create trigger items_chat_gc after delete on records
  for each row execute function drop_chat();
-- teams için aynısı
```

`records.chat_id`'deki `on delete restrict` sırayı güvenli kılar: kayıt
satırı gittikten sonra tetikleyici sohbeti siler.

> **Neyi takas ettik.** Sohbeti `chats.record_id` olarak tutsaydık cascade
> doğal yönde akar, tetikleyici gerekmezdi. Varlık ayrımını seçtik;
> tetikleyici onun bedeli, tercih değil.

### Aynı sohbetin iki yere bağlanması — *ertelendi*

`unique` aynı tablo içinde paylaşımı engelliyor. Bir sohbetin hem `records`
hem `teams` tarafından gösterilmesini engellemek `chats.host` + bileşik FK
ister; alpha'da alınmadı, çünkü bunun olması için hatayı bilerek yazmak
gerekir. Eklenmesi katkısal, veri göçü istemez.

## 6. `activity` — denetim günlüğü

`events`'in sistem tarafı. **Günlük bir ilişki değildir**: kayıt silinse
de satır yaşamalı, o yüzden FK'lar zayıf ve etiket denormalize.

```sql
create table activity (
  id            uuid primary key default gen_random_uuid(),
  chat_id       uuid references chats(id) on delete set null,
  actor_id      uuid references users(id) on delete set null,
  verb          text not null,   -- 'action_added' — anahtar İngilizce
  subject_label text not null,   -- "filament alınması"
  target_label  text,            -- "ardac"
  detail        text,
  created_at    timestamptz not null default now()
);
create index activity_chat_idx on activity(chat_id, created_at) where chat_id is not null;
```

**TEK FK.** Önceki taslakta `record_id` ve `node_id` diye iki nullable sütun
vardı — "konusu ya bir `records` ya bir `nodes` satırı" demek, yani polimorfizmin
sütun kılığına girmiş hâli. Düştü.

Yerine `chat_id`: `records` ve `teams`'in zaten birer `chats` satırı var (§5) ve
activity **sohbet kutusunda** çiziliyor, başka yerde değil.

`nodes` olayları `chat_id = null` ile yazılır ve hiçbir yerde çizilmez — bu
bugünkü davranışın aynısı: `_node_event()` altı çeşit olay yazıyor ama
`feed_of()` yalnız `"item"` ve `"team"` ile çağrılıyor, `nodes` olaylarını
gösteren ekran **yok**. Denetim kaydı olarak kalırlar.

`verb` kodda İngilizce anahtar, ekranda Türkçe metin — `SCOPES` ile aynı
kalıp. `subject_label` ve `target_label` denormalize çünkü satır kaynağını
kaybettikten sonra da okunabilir olmalı: v1'de satır kalıyordu ama **adı**
kaybolduğu için geçmiş "bir şey silindi" demekten öteye gidemiyordu
(`service.delete_node` docstring'i bunu zaten itiraf ediyor).

`activity.verb`'in genel olması sorun değil — bir günlük gerçekten **tek**
kavramdır. `events`'in hatası genellik değil, konuşmayı günlüğe karıştırmaktı.

## 7. `attachments`

Polimorfizm düştü. `attachments` artık **saf blob meta verisi** — neye asılı
olduğunu bilmez; bağ ayrı tablolarda durur.

```sql
create table attachments (
  id          uuid primary key default gen_random_uuid(),
  volume_id   uuid not null references storage_volumes(id) on delete restrict,
  uploader_id uuid references users(id) on delete set null,
  mime        text not null
              check (mime in ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size   bigint not null check (byte_size > 0),
  checksum    text,
  width       integer,
  height      integer,
  original_name text,
  storage_key text not null,
  thumb_key   text,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references users(id) on delete set null
);

create table card_attachments (
  card_id       uuid not null references cards(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  sort_order    integer not null default 0,
  primary key (card_id, attachment_id)
);
create index card_attachments_attachment_idx on card_attachments(attachment_id);

create table message_attachments (
  message_id    uuid not null references messages(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  primary key (message_id, attachment_id)
);
create index message_attachments_attachment_idx on message_attachments(attachment_id);
```

Ters yöndeki iki indeks **`KNOW-283` gereği**: birincil anahtarlar `card_id` /
`message_id` ile başlıyor, `attachment_id` üzerinden arama (bir blob'un nereye
asılı olduğu) onlardan yararlanamaz.

v1'in `(owner_type, owner_id)` çifti ve `OWNER_TYPES` frozenset'i düşer.
Ara taslakta `card_id` XOR `message_id` vardı — tip etiketi yoktu ama "ebeveyn
şu iki türden biri" anlamı duruyordu; junction'larda o da kalmıyor.

**Bedeli, dürüstçe:** ebeveyni bulmak artık bir join, ve junction satırı
cascade ile gidince `attachments` satırı öksüz kalır. İkincisi yeni bir iş
değil — blob süpürmesi zaten gerekiyordu, aynı geçişte öksüz satırlar da
toplanır.

**Blob toplama hâlâ gerekli.** Cascade satırı siler, diskteki dosyayı
silmez. v1'de bu sessiz bir sızıntıydı: bir `nodes` satırı silinince kayıtlar cascade
ile gidiyor, `attachments` FK'sız olduğu için `deleted_at is null` hâlde kalıyor ve
dosyalar diskte öksüz kalıyordu. Tek süpürme yeter — diskteki anahtarlar
eksi tablodaki anahtarlar. Yetim sohbet süpürmesi gerekirse aynı işte koşar.

## 8. `chat_feed` view'i — sohbet kutusunun tek sorgusu

Sohbet kutusu hem mesajları hem sistem bildirimlerini kronolojik tek akışta
çizer (gri bildirim hapı + renkli mesaj balonu). Bölme yapıldıktan sonra
bunları geri birleştiren şey bu view:

```sql
create view chat_feed as
select 'message'::text as kind,
       m.id, m.chat_id, m.created_at,
       m.author_id  as actor_id,
       null::text   as verb,
       null::text   as subject_label,
       null::text   as target_label,
       m.body,
       m.reply_to_id,
       m.edited_at
  from messages m

union all

select 'activity'::text,
       a.id, a.chat_id, a.created_at,
       a.actor_id, a.verb, a.subject_label, a.target_label,
       a.detail,
       null::uuid, null::timestamptz
  from activity a
 where a.chat_id is not null;
```

**Hiç join yok.** Önceki taslak üç daldı ve ikisi `records`/`teams` üzerinden
`chat_id`'yi bulmak için join yapıyordu; `activity.chat_id` gelince ikisi de
gereksizleşti.

Çizicinin tüm sorgusu:

```sql
select * from chat_feed where chat_id = $1 order by created_at;
```

Şablon `kind` üzerinden dallanır. **`users` join'i yok** — view `actor_id`
döner, ad ve renk uygulamadaki kullanıcı sözlüğünden çözülür (satır başına
üçüncü bir join olmaz).

Silinen kaydın denetim satırları view'den **düşer** ama `activity`'de
kalır: `record_id` null'a düştüğü için join tutmaz. Kayıt yoksa sohbet kutusu
da yok; genel denetim ekranı ise satırı etiketleriyle görmeye devam eder.

## 9. Bozuk kart blobu

`jsonb` sütunu sözdizimsel bozuk JSON'u zaten yazdırmaz — Postgres garanti
eder. Dolayısıyla "bozuk" tek bir şey demek: **geçerli JSON, yanlış şekil** —
eksik zorunlu alan, yanlış tip, ya da kodun artık tanımadığı bir `card_type`.

Tespit serde'nin kendisidir; ayrı doğrulama katmanı yok:

```rust
enum CardBody { Media(MediaCard), Meeting(MeetingCard), Pool(PoolCard),
                Broken { reason: String } }

fn parse_card(row: &CardRow) -> CardBody {
    let parsed = match row.card_type.as_str() {
        "media"   => serde_json::from_value(row.data.clone()).map(CardBody::Media),
        "meeting" => serde_json::from_value(row.data.clone()).map(CardBody::Meeting),
        "pool"    => serde_json::from_value(row.data.clone()).map(CardBody::Pool),
        t => return CardBody::Broken { reason: format!("bilinmeyen kart türü: {t}") },
    };
    parsed.unwrap_or_else(|e| CardBody::Broken { reason: e.to_string() })
}
```

Kurallar:

- **`Broken` saklanmaz**, her çizimde hesaplanır. Sonraki bir kod değişikliği
  türü geri tanırsa kart kendiliğinden iyileşir.
- Aynı struct'lar **yazma yolunu da** doğrular (`from_value` → 400). Tek tanım,
  iki yön.
- İsteğe bağlı alanların hepsi `#[serde(default)]`. Gündemi eksik bir toplantı
  boş gündemle çizilmeli, bozulmamalı. `Broken` gerçekten çizilemeyen karta
  saklanır — silme düğmesi yıkıcıdır, eksik bir kartın önüne konmaz.
- Bozuk kart şablonunda ham blob `|safe` ile **basılmaz**. Askama varsayılan
  olarak kaçırır; `reason` göstermek güvenli, ham içeriği dökmek değil.
- Silme yetkisi `created_by` ve `records`'ın scope'undan gelir — blob okunmaz. Zaten
  ayrıştırılamayan bir kartın silinebilir kalması buna bağlı.

---

## 10. `nodes` — ağaç, ve `unit` kuralı

Şema olarak neredeyse hiç değişmiyor. İki ölü sütun düşüyor:

- `pending_cr_id`, `pending_delete` — yalnız `001_schema.sql`'de varlar. Kod,
  şablon, test, tohum: sıfır referans. `change_requests` için konmuşlardı, o
  tablo hiç yazılmadı. `records.dms`/`escalated` ile aynı kader.

Gelen altı FK aynen kalıyor — `records.unit_id`, `records.pillar_id`,
`nodes.parent_id`, `teams.node_id`, `user_node_scopes.node_id`,
`users.scope_node_id`. `nodes` şemanın omurgası; `delete_node`'un patlama
yarıçapı buradan geliyor.

### `unit`, `node_type`'ın bir ALT KÜMESİDİR

`records.unit_id` adı bilinçli: ekranda "Birim" yazıyor, "Düğüm" değil —
kullanıcılar mühendis değil. Ve ad doğru, çünkü **`team` ve `pillar` tipli `nodes` satırları
unit olamaz**:

```python
UNIT_TYPES = NODE_TYPES - {"team", "pillar"}   # ROOT_ONLY'nin yanına (shared/nodes.py)
```

Neden: kayıt pillar'a `records.pillar_id` ile, takıma `records.team_id` ile
bağlanır — ikisi de ayrı alan. Birim listesinde görünmeleri kullanıcıya
"buraya da atayabilirim" dedirtir; atayamaz.

`team` ve `pillar` tipli `nodes` satırları ağaçta **yerleşim işareti** olarak durur: `teams` satırının hiyerarşide nereye düştüğü, kime hesap verdiği. Gerçek kayıt `teams` tablosundadır (`KNOW-129`, `KNOW-262`) ve genişleyecek. Pillar'ın henüz kendi
sayfası yok — `node_type` yalnız büyük resme dahil olsun diye var. Bunun
getirdiği bookkeeping bilerek kabul edildi.

### Nerede uygulanır

| yer | ne |
|---|---|
| `NodeFilter.options()` | `UNIT_TYPES` dışını ele |
| birim atama listesi (`node_options`) | aynı |
| alan yazma yolu | `unit_id` bir unit türü mü — tek `if` |

Yazma yolundaki kontrol **şart**: dropdown'ı süzmek istemciyi düzeltir, ucu
değil — `change_field` serbest değer alıyor. DB kısıtı gerekmiyor; etkisi veri
düzeni, güvenlik değil.

`NodeFilter.clause()` etkilenmez: `subtree()` seçilen node'un altındaki her
şeyi alır, altta bir `pillar` tipli node varsa yine süpürülür — yalnız *seçilemez*
olur.

> **Bugünkü kodda hata var, v2'yi beklemesi gerekmiyor.** `pillar_options()`
> zaten `node_type='pillar'` süzüyor, ama `NodeFilter.options()` hiç tür
> süzmüyor — aktif olan her node'u döküyor. `team` ve `pillar` satırları bu
> yüzden birim listesinde görünüyor.

### Reddedilen öneriler

- **`unit_id` → `node_id`'ye dönsün.** Reddedildi: ekran dili "Birim", ve unit
  gerçekten bir alt küme — ad hedefi doğru tarif ediyor.
- **`node_type='task'` ile `records.kind='task'` çakışması çözülsün.**
  Reddedildi: ikisi hiçbir ekranda yan yana görünmüyor, biri kart tablosunda
  biri ağaçta, ikisi de kendi bağlamında enum. Leksik endişe, gerçek değil.
- **`teams` tablosu `nodes`'a katlansın.** Reddedildi: `teams` source of truth
  ve genişleyecek; node yalnız yerleşim işareti.

---

## 11. Yetki — dört katman, iki enkaz düşüyor

Bugün **iki ayrı yetki modeli var ve hiç birleşmemişler**:

| | Model 1 (eski) | Model 2 (göç 007/008) |
|---|---|---|
| nerede | `users.is_admin` · `is_editor` · `scope_node_id` | `scopes` · `user_scopes` · `roles` · `role_scopes` · `user_roles` · `user_node_scopes` |
| neyi korur | `records` düzenleme | `nodes` işlemleri |
| giriş | `auth.can_edit_item` | `scope.authorized_on_node` |

`can_edit_item` scope sistemine hiç bakmıyor — beş yolu var (admin,
atanan/açan, katılımcı, takım üyesi, `scope_node_id`) ve `has_scope` çağrısı
yok. Model 2 kendi içinde temiz; sorun sayı değil, iki modelin yan yana
yaşaması.

### v2 katmanları

```
yetenek  → scopes + roles                    ne yapabilirsin
dal      → user_node_scopes                  nerede              ← scope_node_id buraya katlanır
ilişki   → atanan / açan / katılımcı / takım üyesi   bu senin işin
süper    → users.is_admin                    tek kalan bayrak
```

**Yetenek ile ilişki bilerek birleştirilmedi.** "Scope'un var, o dalda
düzenlersin" ile "bu kayıt senin, düzenlersin" farklı sorular (`KNOW-64`).

### `edit_nodes` anlamı değişiyor

| | v1 | v2 |
|---|---|---|
| `edit_nodes` | `node` başına kontrol (`authorized_on_node`) | **veri ağacı sayfasının kapısı** |
| `user_node_scopes` | `NODE_DEPENDENT` scope'ların dal koşulu | **düzenlenebilen alt ağaçlar** |

Scope sayfayı açar, dal satırları içeride neye dokunabileceğini söyler.

**Bu ayrım `is_editor` bypass'ının sebebini ortadan kaldırıyor.** v1'de
"scope var, `user_node_scopes` satırı yok" kırık bir durumdu — kullanıcı hiçbir şey
düzenleyemiyordu, o yüzden `routes.py` içine kaçış kapısı konmuştu:

```python
if u and db.as_bool(u["is_editor"]) and not scope.permitted_nodes(u):
    return True     # her node'da yetkili
```

v2'de aynı durum geçerli bir hâl: sayfayı görürsün, hiçbir şeyi
değiştiremezsin. Kaçış kapısı gereksiz, `is_editor` sütunuyla birlikte düşer.

### Düşenler

- **`users.is_editor`** — sütun ve iki kaçış kapısı (`_can_edit_structure`,
  `_authorized_on_node`). Sahipleri `edit_nodes` scope'u + `user_node_scopes`
  satırı kazanır.
- **`users.scope_node_id`** — ikinci dal mekanizmasıydı (kullanıcı başına TEK
  node), `user_node_scopes`'a (çok satır + alt ağaç mirası) katlanır.
  `can_edit_item`'ın son maddesi tek sütun yerine `permitted_nodes(user)` okur.

> **Sessiz genişleme — kabul edildi.** `scope_node_id` tek node'du. Katlandıktan
> sonra kayıt düzenleme yetkisi *izinli her daldan* miras alınır, yalnız
> birinden değil.

### Şimdilik: yalnız admin

`user_node_scopes` izni verme arayüzü **yazılmayacak**. Bugünkü durum zaten bu:
`scope.grant_node_permission()` var ama hiçbir route'tan çağrılmıyor — yalnız
testlerden. Yani `user_node_scopes` satırı üretimde hiç doğmuyor.

Admin bütün kök `nodes` satırlarından tüm ağacı kontrol eder; `active_scopes()` admin'e
`SCOPES`'un tamamını, `authorized_on_node()` doğrudan `True` döndürüyor —
kod tarafında yapılacak bir şey yok. Grant arayüzü ihtiyaç netleşince gelir.

> **KARAR — bilinçli davranış değişikliği.** `/outcome-tree` bugün **hiç korunmuyor**:
> giriş yapan herkes açabiliyor, `_can_edit_structure` yalnız şablona
> `can_write` basıyor. Sayfayı `edit_nodes`'a bağlamak `KNOW-47`'deki
> "görülme genel, değiştirme kapsamlı" ilkesini **ters çeviriyor** ve bu kabul
> edildi: veri ağacı sayfası scope ister. `KNOW-47` bundan sonra kartlar için
> geçerli, ağaç sayfası için değil.

---

## 12. Kalan tablolar — düz, iki ölü sütun daha

`users`, `teams`, `team_members`, `record_participants`, `tags`,
`attachment_tags`, `storage_volumes`, `push_subscriptions`, `user_pins`,
`security_events` tarandı. Yapısal sorun yok; §"Kural" testinden hepsi geçiyor.

### Ölü sütunların tam listesi

Bu oturumda bulunan, v2'de düşecek sütunlar:

| sütun | durum |
|---|---|
| `records.dms` | yalnız `seed.py` yazıyor, hiçbir yer okumuyor |
| `records.escalated` | aynı |
| `nodes.pending_cr_id` | yalnız `001_schema.sql`'de — `change_requests` hiç yazılmadı |
| `nodes.pending_delete` | aynı |
| `tags.color` | SELECT ediliyor ama `add_tag`'in INSERT'inde yok — üretimde hep NULL |
| `storage_volumes.note` | hiçbir INSERT/UPDATE'te geçmiyor |

`tags.color` ilginç bir vaka: şablon onu çiziyor (`tag_strip.html`), sorgu
seçiyor, ama yazan kod yok. Yani özellik yarım kalmış — sütun ölü *değil*,
**doğmamış**. Etiket rengi isteniyorsa `add_tag`'e bir parametre, istenmiyorsa
sütun düşer. Karar verilmeden taşınmamalı.

### İki günlük tablosu, ikisi de kalıyor

`security_events` (giriş, yetki reddi, rol verme) ile `activity` (§6: alan
değişti, node silindi) ayrı kalır. Tür sütununu silme testi ikisini de
geçiriyor: `event_type` olmadan satır hâlâ bir güvenlik denetim kaydı,
`verb` olmadan hâlâ bir alan günlüğü. Farklı izleyici, farklı ekran, örtüşen
değer yok.

### Bakılıp geçilen

- **`team_members.role`** (`lead`/`mentor`/`member`) ile `roles` tablosu aynı
  kelimeyi kullanıyor, farklı kavram. §10'da `node_type='task'` için verilen
  kararın aynı sınıfı: ikisi hiçbir ekranda yan yana görünmüyor, biri takım
  sayfasında enum, diğeri yönetim panelinde tablo. Değişiklik yok.
- **`user_pins.slug`** FK değil — modül listesi kodda (`MODULES`), tablosu yok.
  Bilinçli, göç 012'de gerekçeli.

---

## 13. İndeks kokuları — bileşik PK'nın ikinci sütunu

Üçü de aynı kalıptan: **sorgu bileşik PK'nın ikinci sütununa vuruyor.**
Postgres bileşik indeksi yalnız baştan kullanabilir, o yüzden PK işe yaramaz.

| sorgu | nerede | bugün |
|---|---|---|
| `record_participants where user_id = ?` | mobil "Yapılacaklar" | PK `(record_id, user_id)` — baş sütun yanlış |
| `team_members where user_id = ?` | `auth.team_ids()` | PK `(team_id, user_id)` — aynı |
| `actions where owner_id = ?` | "Eylemler" sekmesi | indeks yok |

İkincisi en pahalısı: `team_ids()` **her `can_edit_item` çağrısında** koşuyor,
yani her yetki kontrolünde.

```sql
create index record_participants_user_idx on record_participants(user_id);
create index team_members_user_idx      on team_members(user_id);
create index actions_owner_idx          on actions(owner_id)
       where status in ('open','in_progress');
```

### Ters yönde: iki gereksiz indeks

```sql
drop index user_node_scopes_user_idx;   -- PK zaten (user_id, node_id)
drop index user_roles_user_idx;         -- PK zaten (user_id, role_id)
```

Baş sütun aynı; PK bu sorguları zaten karşılıyor. Her insert'te boşuna bakım.
Yani şema bir yerde fazladan indeks tutuyor, tam ihtiyaç olan yerde tutmuyor.

### `updated_at` elle sürülüyor

`service.py` içinde beş ayrı yerde `update records set updated_at = ...`. Unutulan
bir yazma yolu `filters.py`'deki `activity` sıralamasını (`i.updated_at desc`)
sessizce bozar — hata vermez, sadece kayıt listede yanlış yere düşer.

```sql
create function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

create trigger items_touch before update on records
  for each row execute function touch_updated_at();
```

Dört satır, sınıfı komple kapatıyor. Dikkat: tetikleyici **her** sütun
değişiminde damgayı günceller — toplu bir veri düzeltmesi de "hareket" sayılır.

### Ölçek uyarısı

5-10 kullanıcıda bunların hiçbiri ölçülmez. Önemli olmasının sebebi hız değil:
bunlar **yetki yolundaki** sorgular, her istekte koşuyorlar ve ilk bozulacak
olanlar onlar. Şemayı sıfırdan yazarken düzeltmek bedava, sonra sıkıcı.

### Temiz bulunanlar

`tr` arama yapılandırması göçte düzgün kuruluyor (`001_schema.sql`, `simple` +
`unaccent`) · `storage_volumes_single_active` tek aktif diski kısıtla
garantiliyor · `users_email_nocase_idx` büyük/küçük harf tekilliğini tutuyor
(`KNOW-167`'deki hatanın yaması) · `records_open_idx` kısmi indeks, doğru kullanım.

---

## Açık noktalar

1. **`db-scheme-export.sql` üç göç geride** (`card_signups`, `notify_level`,
   `reply_to_id` yok). Yeniden üretmek çalışan bir Postgres istiyor.
2. **`10-kararlar.md` "Taşınabilirlik kuralları"** SQLite döneminden kalma ve
   kendi dosyasıyla çelişiyor: aynı bölüm PostgreSQL'in `jsonb`'sini sayıyor,
   birkaç satır sonra "jsonb yok" diyor. `id TEXT` / zaman `TEXT` / `0/1`
   boolean kuralları da yürürlükte değil. Bağlayıcı kararlar dosyası olduğu
   için dokunulmadı — silinsin mi, yoksa "SQLite dönemi, geçersiz" notuyla mı
   kalsın?

### Kapananlar

| soru | cevap |
|---|---|
| `records.kind` gerçek boyut mu? | **Hayır, etiket** — §1. Kod tarandı, dallanan tek şey rozet ve filtre. |
| `node`/`team` attachment'larının yolu? | **Gerek yok** — §7. v1'de de üreten yol yoktu, ölü kapıydı. |
| Ekip bir kayda ne diyor? | **"kayıt"** → tablo `records`, şablon `record.html`. Bkz. §14. |
| Veri ağacı sayfası kapılı mı? | **Kapılı** — §11. `KNOW-47` ilkesi bilinçli olarak ağaç sayfası için terk edildi. |

---

## 14. Adlandırma: tek UI kelimesi → tek tablo

Ekip bir kayda **"kayıt"** diyor. Zincir buradan türüyor:

| ekranda | tablo | şablon | rota |
|---|---|---|---|
| Kayıt | `records` | `record.html` | `/record/{id}` |
| Kart | `cards` | `card.html`, `cards.html` | `/record/{id}/card` |

Bu, oturumun başındaki "yeni mühendis parmak basıp tabloyu bilebiliyor mu"
testini geçiren son parça. Eskiden **"kart" iki tabloyu birden** gösteriyordu:
`kart.html`/`kartlar.html` `item_cards`'ı çiziyordu, `kayit.html` ise `items`'ı
çiziyordu ve ilk satırında konusuna "kart" diyordu. `items` → `records` olunca
`cards` adı serbest kaldı ve çakışma kendiliğinden düştü.

### `/item` değil `/record`

Mobil zaten doğru adlandırmıştı: `/record/{id}`, `/record/{id}/message`.
Masaüstü `/item/{id}` diyordu — aynı işe iki ad. `record` kazanıyor, `/item`
yolları düşüyor.

### Etkilenen adlar

```
items              -> records
item_cards         -> cards
item_participants  -> record_participants
*.item_id          -> record_id
/item/*            -> /record/*
kayit.html         -> record.html
kart.html          -> card.html
kartlar.html       -> cards.html
```

`kind`, `status`, `priority` gibi sütunlar değişmiyor — tablo adı değişti,
alanlar değil.
