# 20 — Veri şeması

Postgres söz dizimiyle yazılmış **hedef** şema; bugün SQLite'ta karşılığı
`shared/schema.sql` (taşınabilirlik kuralları: `spec/10-kararlar.md`).

## Bugün ne var, ne yok

| Tablo | Durum |
|---|---|
| `users`, `nodes`, `items`, `item_participants`, `events` | **kurulu** |
| `items_fts` (FTS5 + trigger'lar) | **kurulu** — şemada aşağıda yok, SQLite'a özel |
| `teams`, `team_members` (§2a) | yok — ekipler ekranıyla gelecek (`spec/60-kaynak-uyarlama.md` 2.5) |
| `actions` (§3a) | yok — kart eylem şeridiyle gelecek (`spec/60-kaynak-uyarlama.md` 2.4) |
| `change_requests` | yok — kazanım ağacı ekranıyla gelecek |
| `notifications`, `notification_prefs`, `mutes` | yok — mobil bildirimler bugün `events`'ten türetiliyor |
| `push_subscriptions` | yok — `spec/40-push.md` |

Kurulu tablolardaki farklar: `items`'a `dms` ve `pillar` (TEXT) eklendi; okunabilir kısa
kod sütunu (`BUT-1042`) **henüz yok** — arama bugün başlık/açıklama üzerinden çalışıyor.

---

## 1. Kullanıcılar ve yetki

```sql
create table users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique not null,          -- Google girişinden gelir
  name         text not null,
  avatar_url   text,
  color        text,                          -- arayüzdeki renk rozeti
  is_admin     boolean not null default false,-- tüm hiyerarşide yetkili
  is_editor    boolean not null default false,-- kendi kapsamında yapıyı DEĞİŞTİREBİLİR
  scope_node_id uuid references nodes(id) on delete set null,
  created_at   timestamptz not null default now()
);
```

**Yetki modeli iki katmanlı — karıştırma:**

| Katman | Ne verir | Nereden gelir |
|---|---|---|
| Kart yetkisi | durum/atama/öncelik değiştirme, yorum | `scope_node_id` alt ağacında olmak **veya** karta dahil edilmiş olmak |
| Yapısal yetki | düğüm ekle/adlandır/taşı/sil, talep onaylama | `is_admin`, ya da `is_editor` + düğüm kapsam alt ağacında |

`is_editor` olmayan biri yine de değişiklik yapar — ama değişiklik "beklemede" damgası alır (bkz. §4).

---

## 2. Hiyerarşi

```sql
create table nodes (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references nodes(id) on delete cascade,
  name         text not null,
  node_type    text not null,                 -- serbest metin: "Kazanım", "Makine/Kol", ...
  sort_order   int  not null default 0,
  pending_cr_id uuid,                         -- onay bekleyen değişiklik (§4)
  pending_delete boolean not null default false,
  created_by   uuid references users(id),
  created_at   timestamptz not null default now()
);
create index on nodes(parent_id);
```

Derinlik sınırsız, tür alanı serbest metin — bir kulüpte "Kazanım / Makine / Adım", başka yerde başka bir şey olabilir.

**Alt ağaç sorgusu** (yetki kontrolü ve hata sayımı bunun üstünde döner):

```sql
with recursive alt as (
  select id from nodes where id = $1
  union all
  select n.id from nodes n join alt a on n.parent_id = a.id
)
select id from alt;
```

> **Performans notu:** ağaç birkaç yüz düğümü geçerse her istekte recursive CTE pahalıya gelir.
> O noktada `path ltree` sütunu ekleyip `path <@ 'kok.dal'` ile sorgula. Şimdilik gerek yok,
> ama sütunu baştan koymak sonradan migration'dan ucuz.

**Döngü koruması:** taşıma işleminde hedef, taşınan düğümün alt ağacında olamaz. Uygulama katmanında kontrol et; istersen trigger ile de garantiye al.

---

## 2a. Ekipler

Kaynak uyarlamasıyla geldi (`spec/60-kaynak-uyarlama.md` 2.5). Takım, hiyerarşiden
ayrı bir varlık: `nodes` işin *nerede* olduğunu, `teams` işi *kimin sahiplendiğini*
tutar. Bir takım istenirse ağaçtaki bir düğüme bağlanır (`node_id`), zorunlu değil.

```sql
create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,                              -- takımın görev alanı, ekipler ekranında görünür
  node_id     uuid references nodes(id) on delete set null,
  color       text,
  created_at  timestamptz not null default now()
);

create table team_members (
  team_id  uuid references teams(id) on delete cascade,
  user_id  uuid references users(id) on delete cascade,
  role     text not null default 'uye' check (role in ('lider','mentor','uye')),
  added_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
```

**Atama modeli (bağlayıcı, bkz. `spec/10-kararlar.md`):** kayıt **takıma**
tanımlanır (`items.team_id`), eylem **kişiye** atanır (`actions.assignee_id`).
Eylemi ilk gören üstlenir ya da lider/mentor dağıtır. "Ekibe atanan görev kimin
sorunu" belirsizliği eylem seviyesinde çözülür; kayıt seviyesinde sahip takımdır.

**Takım sohbeti:** `events.subject_type` `'team'` değerini kazanır (§5) — kart
akışıyla aynı tablo, aynı bileşen. Ayrı mesajlaşma altyapısı kurulmaz.

**Yetkiye etkisi:** kart yetkisinin üçüncü yolu — kartın `team_id`'si kullanıcının
üyesi olduğu bir takımsa kart yetkisi vardır (kapsam ve katılımcılığa ek).
`can_edit_item` bu kontrolle genişler; yapıya (`nodes`) sızmaz.

---

## 3. Kartlar (hata / görev)

```sql
create table items (
  id          uuid primary key default gen_random_uuid(),
  node_id     uuid not null references nodes(id) on delete cascade,
  kind        text not null check (kind in ('hata','gorev')),
  title       text not null,
  description text,
  status      text not null default 'acik'
              check (status in ('acik','devam','beklemede','kapandi')),
  priority    text not null default 'orta'
              check (priority in ('kritik','yuksek','orta','dusuk')),
  team_id     uuid references teams(id) on delete set null,  -- kaydın sahibi takım (§2a)
  assignee_id uuid references users(id) on delete set null,  -- kaydı üstlenen kişi; kişi ataması asıl eylemde (§3a)
  created_by  uuid not null references users(id),
  due_date    date,
  escalated   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on items(node_id);
create index on items(assignee_id) where status <> 'kapandi';

-- karta dahil olanlar: mail forward mantığı
create table item_participants (
  item_id  uuid references items(id) on delete cascade,
  user_id  uuid references users(id) on delete cascade,
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
```

**Kritik kural:** `item_participants`'ta olan kişi, kartın düğümü kendi kapsamı dışında olsa bile o kartta tam yetkilidir. Yetki karta özeldir, kapsama sızmaz — diğer kartlarda hâlâ salt okunur.

**Sabit sınıflandırma alanları (öneri):** kaynak sistemdeki form cevaplarının
bizde karşılığı form-builder değil (`spec/60-kaynak-uyarlama.md` §4), az sayıda
sabit sütundur: `recurring boolean not null default false` (tekrar eden mi) ve
`origin_team_id uuid references teams(id)` (sorun hangi takımdan kaynaklanıyor —
kök neden kırılımının en ucuz hali). Ekran ihtiyacı netleşince eklenir.

---

## 3a. Eylemler

Kaynak uyarlamasının en önemli şema kararı (`spec/60-kaynak-uyarlama.md` §1):
kayıt "ne oldu"yu, eylem "kim ne yapacak"ı tutar. Bir kayda 0..n eylem bağlanır.

```sql
create table actions (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references items(id) on delete cascade,
  title       text not null,
  assignee_id uuid references users(id) on delete set null,  -- null = takım havuzunda, üstlenen bekliyor
  status      text not null default 'acik'
              check (status in ('acik','devam','kapandi','iptal')),
  due_date    date,
  created_by  uuid not null references users(id),
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index on actions(item_id);
create index on actions(assignee_id) where status in ('acik','devam');
```

Kurallar:

- **Kayıt, açık eylemi varken kapanamaz.** Uygulama katmanında kontrol; kapanış
  denemesi açık eylemleri listeleyen bir hata döndürür.
- Eylem olayları (açıldı, atandı, üstlenildi, kapandı) **kartın** `events`
  akışına sistem olayı olarak düşer; eylemin ayrı akışı yoktur. Eylem üstünde
  konuşma gerekiyorsa kartta konuşulur.
- Eylem yetkisi kart yetkisinden türer: kartı düzenleyebilen eylem açar/kapar;
  atanan kişi kendi eylemini her durumda güncelleyebilir (katılımcı sayılır).
- `beklemede` durumu bilerek yok: bekleyen iş kartın durumudur, eylemin değil.
- Görev tablosundaki "Açık eylemim" hızlı filtresi ve mobil `/eylemler` bu
  tablodan okur; `items.due_date` kayıt-seviyesi son tarih olarak kalır.

---

## 4. Değişiklik talepleri

Değişiklik **anında uygulanır**, talep sadece "kesinleşti mi" sorusunu tutar.

```sql
create table change_requests (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('ekle','adlandir','tasi','sil')),
  node_id    uuid references nodes(id) on delete cascade,  -- etkilenen düğüm (ekle'de yeni düğüm)
  parent_id  uuid references nodes(id) on delete set null, -- ekle: hangi düğümün altına
  payload    jsonb not null default '{}',   -- yeni ad/tür/hedef üst
  prev_state jsonb,                          -- RET DURUMUNDA GERİ DÖNÜLECEK HAL
  status     text not null default 'acik'
             check (status in ('acik','onaylandi','reddedildi','geri_cekildi','iptal')),
  opened_by  uuid not null references users(id),
  decided_by uuid references users(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index on change_requests(status) where status = 'acik';
```

`prev_state` bu tasarımın kalbi. Ret geldiğinde:

| kind | Ret ne yapar |
|---|---|
| ekle | düğümü sil — **ama üzerine yazılmış kartları üst düğüme taşı**, silme. Alt düğümleri de üste bağla. |
| adlandir | `prev_state`'ten ad ve türü geri yaz |
| tasi | `prev_state.parent_id`'ye geri taşı |
| sil | `pending_delete = false` yap, veri zaten duruyor |

Onay geldiğinde: `ekle/adlandir/tasi` için sadece `pending_cr_id`'yi temizle (değişiklik zaten yerinde). `sil` için gerçekten sil.

**Tekillik:** bir düğümde aynı anda tek açık talep. `create unique index on change_requests(node_id) where status='acik';`

---

## 5. Olay akışı (kart içi sohbet)

Kartın da talebin de içinde aynı yapıda bir akış var — tek tabloda topla.
Takım sohbeti (§2a) da aynı tabloda: `subject_type='team'`, `subject_id=teams.id`.

```sql
create table events (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('item','change_request','team')),
  subject_id   uuid not null,
  event_type   text not null check (event_type in ('mesaj','sistem')),
  author_id    uuid references users(id),   -- sistem olaylarında da kim tetikledi
  body         text not null,
  created_at   timestamptz not null default now()
);
create index on events(subject_type, subject_id, created_at);
```

Sistem olayları ("Selin durumu Kapandı yaptı", "Barış escale etti") ve insan mesajları aynı akışta, kronolojik. Kartın tarihçesi ile konuşması ayrılmıyor — prototipteki en sevdiğim davranış buydu.

---

## 6. Bildirimler

```sql
create table notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  kind         text not null,   -- atama|escale|ekleme|devir|mesaj|degisim|onay|karar
  body         text not null,
  item_id      uuid references items(id) on delete cascade,
  cr_id        uuid references change_requests(id) on delete cascade,
  actor_id     uuid references users(id),
  route        text not null check (route in ('aninda','ozet')),
  read_at      timestamptz,
  delivered_at timestamptz,     -- push/mail çıktığı an; null = henüz gitmedi
  created_at   timestamptz not null default now()
);
create index on notifications(user_id, read_at, created_at desc);
```

**Yönlendirme kuralı** (`route` yazılırken hesaplanır):

- `aninda` sayılan türler: `atama, escale, ekleme, devir, onay, karar` — sana doğrudan yönelik olanlar
- geri kalanı (`mesaj, degisim`) → `ozet`
- kullanıcının modu `hepsi_aninda` ise hepsi anında, `sadece_ozet` ise hepsi özet

`delivered_at` alanı ayrı duruyor çünkü **bildirim merkezi tek gerçek kaynak**. Push düşse, mail gitmese bile kayıt burada. Kullanıcı uygulamayı açınca hiçbir şey kaçırmıyor.

```sql
create table notification_prefs (
  user_id     uuid primary key references users(id) on delete cascade,
  mode        text not null default 'akilli'
              check (mode in ('akilli','hepsi_aninda','sadece_ozet')),
  quiet_start time,     -- ör. 22:00
  quiet_end   time,     -- ör. 08:00
  push_on     boolean not null default true,
  email_on    boolean not null default true,
  digest_hour int not null default 9
);

create table mutes (
  user_id     uuid references users(id) on delete cascade,
  target_type text not null check (target_type in ('item','node')),
  target_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);
```

Susturma kontrolü: kart susturulmuş mu, **ya da** kartın düğümünün atalarından biri susturulmuş mu. Ata kontrolü §2'deki recursive sorgunun tersi yönde.

Sessiz saatlerde `aninda` bildirimler yazılır ama gönderilmez; sabah özete katılır.

---

## 7. Push abonelikleri

```sql
create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fail_count  int not null default 0
);
```

Bir kullanıcının birden fazla aboneliği olur (telefon + dizüstü) — hepsine gönder.

**Ölü abonelik:** push servisi `404`/`410` dönerse satırı sil. Başka hatalarda `fail_count` artır, belli sayıyı geçince sil. Bu adım atlanırsa sunucu ölü adreslere gönderim yapmaya devam eder.

---

## 8. Kimlik

Google girişi `users.email` üzerinden eşleşir. Ayrı bir `identities` tablosu şimdilik gereksiz — tek sağlayıcı var. İkinci bir giriş yöntemi eklenirse o zaman ayrılır.

Oturumları veritabanında tutmak yerine imzalı çerez kullan; bu ölçekte tablo gereksiz.

---

## Açık noktalar (karar bekliyor)

1. **Karta dosya eklenmesi:** 🚧 yön belli, karar değil. Kalıcı evde dockerize +
   NAS bağlama düşünülüyor; `attachments` tablosu dosya meta'sını tutar, dosya
   diske/NAS'a yazılır. Açık soru — saklama süresi: ekler kalıcı mı, yoksa kayıt
   kapandıktan sonra arşivlenmemişse 30 günde silinsin mi? Kılavuzlar görünümü ve
   kart ek kutusu (`spec/60-kaynak-uyarlama.md` 2.4, 2.7) bu karara bağlı.
   Not: dosya yükleme açıldığı an README'deki "yükleme yok = o saldırı yüzeyi yok"
   satırı düşer; kapı (Access) şartı burada da geçerli.
2. **Hata ilişkileri:** "Sevkiyat gecikmesi, bütçe onayından kaynaklanıyor" bağını tutan
   `item_links` tablosu — kök neden analizini zincir halinde göstermeyi sağlar.
   (`items.origin_team_id` bunun ucuz ön hali — §3.)
3. **Silme politikası:** şu an `on delete cascade`; düğüm silinince kartları da gidiyor.
   Arşivleme (`deleted_at`) tercih edilirse ekip arşivi ekranı da bunun üstüne oturur.
4. **Okunabilir kayıt kodu** (`BUT-1042`): insanlar konuşmada ve e-postada kullanıyor.
   Önek ilk düğümden türer, sayı global artar, kayıt taşınsa bile kod değişmez.
   Kaynak çözümlemesiyle **öne çekildi** (`spec/60-kaynak-uyarlama.md` §1 madde 6):
   kaynakta numara tablonun ilk kolonu ve tüm konuşmaların ortak dili.
5. **Rutinler / WDS panosu:** 🚧 tekrarlayan görev tanımı (`routines`: başlık,
   sorumlu takım/kişi, periyot) + haftalık tamamlama işareti. WDS panosunun
   matris görünümü buna oturur; ilk sürüm rutinsiz açılabilir
   (`spec/60-kaynak-uyarlama.md` 2.9).
6. **Düğüm KPI'ları:** 🚧 "ölçülebilir çıktısı olan her şey makinedir" soyutlaması
   (`spec/60-kaynak-uyarlama.md` 2.6). Düğüme hedef/gerçekleşen KPI bağlamak
   istenirse ayrı tablo; ihtiyaç netleşmeden açılmaz.
