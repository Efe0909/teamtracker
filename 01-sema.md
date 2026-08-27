# EkipTakip — Veri Şeması

Dilden bağımsız. Postgres varsayıyor; başka bir ilişkisel veritabanında da aynı yapı kurulur.

Prototipteki davranışın birebir karşılığı. Önce şemayı gözünle onayla, uçları sonra yazarız.

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
  assignee_id uuid references users(id) on delete set null,
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

Kartın da talebin de içinde aynı yapıda bir akış var — tek tabloda topla:

```sql
create table events (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('item','change_request')),
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

## Onayına açık noktalar

1. **Karta dosya eklenmesi** için `attachments` tablosu koymadım — Drive linki kart açıklamasında mı dursun, ayrı tablo mu olsun?
2. **Hata ilişkileri:** "Sevkiyat gecikmesi, bütçe onayından kaynaklanıyor" bağını tutan bir `item_links` tablosu ekleyeyim mi? Kök neden analizini zincir halinde göstermeyi sağlar.
3. **Silme politikası:** şu an `on delete cascade` — bir düğüm silinince kartları da gidiyor. Bunun yerine arşivleme (`deleted_at`) ister misin?
