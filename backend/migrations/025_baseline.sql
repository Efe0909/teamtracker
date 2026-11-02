-- Taban sema: eski 001..025 gocunun TEK dosyada, son halinde.
--
-- Bu dosya gecmisi (ALTER/DROP/geri doldurma) tasimaz; yalniz son sema ve
-- referans veri tohumu vardir. 025 gocunden SONRAKI gocler (026..) olduklari
-- gibi kosar. Eski gocleri koşmus veritabani bu dosyayi YENIDEN KOSMAZ:
-- db::collapse_legacy 001..025 satirlarini tek satira (bu dosyanin saglama toplami) indirir.
--
-- Sema dogrulamasi: eski 001..025 ile bu dosyanin pg_dump -s ciktilari ayni,
-- tohum satirlari (scopes, nodes, overage_base) ayni.

create extension if not exists pgcrypto;
create extension if not exists unaccent;

-- Turkce arama: 'turkish' snowball sozlugu KULLANILMIYOR, asiri koke iniyor
-- ("gündür" -> "g"). simple + unaccent, aksan katlamayi verir, koke inmez.
create text search configuration tr (copy = simple);
alter text search configuration tr
  alter mapping for hword, hword_part, word with unaccent, simple;


-- === kimlik ve yetki =======================================================

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text not null,
  color         text,
  is_admin      boolean not null default false,
  google_sub    text,
  is_active     boolean not null default true,
  notify_level  text not null default 'all'
                check (notify_level in ('all','mentions','none')),
  last_login_at timestamptz,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  -- Profil: kisi kendi girer.
  nickname      text,
  phone         text,
  birth_day     smallint check (birth_day between 1 and 31),
  birth_month   smallint check (birth_month between 1 and 12),
  birth_year    smallint check (birth_year between 1900 and 2100),
  avatar_id     uuid,  -- FK attachments'tan sonra (users <-> attachments dongusu)
  -- Bildirim: varsayilan notify_level + sessiz saat; sohbet basina ozel secim chat_prefs'te.
  quiet_start   smallint check (quiet_start between 0 and 23),
  quiet_end     smallint check (quiet_end between 0 and 23),
  notifications_seen_at timestamptz not null default now()
);
-- Buyuk/kucuk harf duyarsiz tekillik: 'Ali@x' ile 'ali@x' AYNI kisi.
create unique index users_email_nocase_idx on users (lower(email));
create index users_last_seen_idx on users (last_seen_at desc);

create table scopes (
  name       text primary key,
  created_at timestamptz not null default now()
);

create table roles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  color      text not null default '#5b8cff' check (color ~ '^#[0-9A-Fa-f]{6}$')
);

create table role_scopes (
  role_id uuid not null references roles(id) on delete cascade,
  scope   text not null references scopes(name) on delete restrict,
  primary key (role_id, scope)
);

create table user_scopes (
  user_id    uuid not null references users(id) on delete cascade,
  scope      text not null references scopes(name) on delete restrict,
  granted_by uuid references users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, scope)
);

create table user_roles (
  user_id    uuid not null references users(id) on delete cascade,
  role_id    uuid not null references roles(id) on delete cascade,
  granted_by uuid references users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);


-- === agac ==================================================================

-- Referans veri (spec/74): `key` kodun buldugu sabit ad; kok (parent_id null)
-- MUTLAKA key tasir, key'li dugum kok olmak zorunda degil. `operational` =
-- kod semasinin slotu (yalniz sunucu yaratir). shape cocuklara izni anlatir:
-- leaf (cocuk yok), list (butun cocuklar ayni turde), tree (serbest); tur
-- kurallari Rust'ta (src/refdata.rs), shape burada tetikleyiciyle de zorlanir.
-- Takim ve pillar agacta DEGIL (spec/22): teams / pillars tablolari.
create table nodes (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references nodes(id) on delete cascade,
  name       text not null,
  node_type  text not null
             check (node_type in ('cell','machine','task','step','operational','generic',
                                  'option','checkpoint','widget','location','outcome')),
  description text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  key        text unique,
  shape      text not null default 'tree' check (shape in ('leaf','list','tree')),
  attrs      jsonb not null default '{}'::jsonb check (jsonb_typeof(attrs) = 'object'),
  constraint nodes_root_has_key check (parent_id is not null or key is not null)
);
create index nodes_parent_idx on nodes (parent_id);

-- Dal izni: KAPSAM tek basina yetmez, hangi dalda gecerli oldugu burada.
-- Izin alt agaca MIRAS KALIR (TreeIndex uzerinden O(1)).
create table user_node_scopes (
  user_id    uuid not null references users(id) on delete cascade,
  node_id    uuid not null references nodes(id) on delete cascade,
  granted_by uuid references users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, node_id)
);

create table role_node_scopes (
  role_id    uuid not null references roles(id) on delete cascade,
  node_id    uuid not null references nodes(id) on delete cascade,
  granted_by uuid references users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (role_id, node_id)
);

-- Seciciler: kisi basina favori dugumler (kayit sabitlemeleri gibi).
create table node_favorites (
  user_id    uuid not null references users(id) on delete cascade,
  node_id    uuid not null references nodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, node_id)
);


-- === sohbet (events'in konusma tarafi) =====================================

-- chats KENDI BASINA bir varlik: icinde item_id/node_id TASIMAZ. Bag ters
-- yonde kurulur (records.chat_id, teams.chat_id), ikisi de not null unique.
create table chats (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table chat_prefs (
  user_id uuid not null references users(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  mode    text not null check (mode in ('all','mentions','none')),
  primary key (user_id, chat_id)
);


-- === ekler =================================================================

create table storage_volumes (
  id           uuid primary key default gen_random_uuid(),
  label        text not null unique,
  kind         text not null check (kind in ('local','removable','nas')),
  mount_path   text not null,
  media_prefix text not null default '',
  device       text,
  fs_uuid      text,
  fs_type      text,
  is_active    boolean not null default false,
  is_online    boolean not null default false,
  checked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create unique index storage_volumes_single_active on storage_volumes (is_active) where is_active;

-- Bloblar DOSYA SISTEMINDE (Postgres bytea reddedildi). Bu tablo yalniz meta.
-- attachments NEYE ASILI OLDUGUNU BILMEZ — bag junction tablolarinda.
create table attachments (
  id            uuid primary key default gen_random_uuid(),
  volume_id     uuid not null references storage_volumes(id) on delete restrict,
  uploader_id   uuid references users(id) on delete set null,
  mime          text not null
                check (mime in ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size     bigint not null check (byte_size > 0),
  checksum      text,
  width         integer,
  height        integer,
  original_name text,
  storage_key   text not null,
  thumb_key     text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid references users(id) on delete set null
);

alter table users add foreign key (avatar_id) references attachments(id) on delete set null;

create table tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- Tekillik BURADA: 'İstanbul' ve 'istanbul' ayni etiket.
  slug       text not null unique,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table attachment_tags (
  attachment_id uuid not null references attachments(id) on delete cascade,
  tag_id        uuid not null references tags(id) on delete cascade,
  added_by      uuid references users(id) on delete set null,
  added_at      timestamptz not null default now(),
  primary key (attachment_id, tag_id)
);
create index attachment_tags_tag_idx on attachment_tags (tag_id);


-- === takimlar ve pillar'lar ================================================

create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  chat_id     uuid not null unique references chats(id) on delete restrict,
  color       text,
  created_at  timestamptz not null default now(),
  -- Pillar'in banner'i OZEL takiminin banner'idir (pillars.team_id).
  banner_id   uuid references attachments(id) on delete set null
);

create table team_members (
  team_id  uuid not null references teams(id) on delete cascade,
  user_id  uuid not null references users(id) on delete cascade,
  -- `roles` tablosuyla ayni kelime, FARKLI kavram: bu takim ICINDEKI konum.
  role     text not null default 'member' check (role in ('lead','mentor','member')),
  added_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
-- PK team_id ile basliyor; "bu kisi hangi takimlarda" onu kullanamaz (KNOW-283).
-- auth.team_ids() HER yetki kontrolunde kosuyor.
create index team_members_user_idx on team_members (user_id);

create table pillars (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  color       text,
  -- Pillar'in OZEL takimi; pillar duruyorken takim silinemez.
  team_id     uuid not null unique references teams(id) on delete restrict,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Takimin calistigi birimler (agactaki yeri).
create table team_nodes (
  team_id   uuid not null references teams(id) on delete cascade,
  node_id   uuid not null references nodes(id) on delete cascade,
  linked_by uuid references users(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (team_id, node_id)
);
create index team_nodes_node_idx on team_nodes (node_id);


-- === kayitlar ==============================================================

create table records (
  id          uuid primary key default gen_random_uuid(),
  -- "Birim": agac dugumu. Kural kodda (UNIT_TYPES) ve yazma yolunda; CHECK alt sorgu yapamaz.
  unit_id     uuid not null references nodes(id) on delete cascade,
  -- ORTOGONAL: pillar kaydin atasi olmak zorunda degil.
  pillar_id   uuid references pillars(id) on delete set null,
  team_id     uuid references teams(id) on delete set null,
  chat_id     uuid not null unique references chats(id) on delete restrict,
  kind        text not null check (kind in ('issue','task')),
  title       text not null,
  description text,
  status      text not null default 'open'
              check (status in ('open','in_progress','pending','closed','cancelled')),
  priority    text not null default 'medium'
              check (priority in ('critical','high','medium','low')),
  owner_id    uuid references users(id) on delete set null,
  created_by  uuid not null references users(id) on delete restrict,
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  search_vector tsvector generated always as
    (to_tsvector('tr', coalesce(title,'') || ' ' || coalesce(description,''))) stored,
  -- Erisim kipi: public (herkes gorur, tek tikla katilir), request (katilmak
  -- icin sorumlunun onayi), private (yalniz uyeler sohbeti/kartlari/eylemleri
  -- gorur; kayit satiri herkese acik).
  access_mode text not null default 'public'
              check (access_mode in ('public','request','private')),
  -- `closed`'a geciste kapanis notu (iptal degil), spec/76. Yeniden acmak notu siler.
  closing_note text
);
create index records_unit_idx   on records (unit_id);
create index records_owner_idx  on records (owner_id);
create index records_team_idx   on records (team_id) where team_id is not null;
create index records_pillar_idx on records (pillar_id) where pillar_id is not null;
create index records_open_idx   on records (updated_at desc) where status <> 'closed';
create index records_search_idx on records using gin (search_vector);

-- "Mail forward" modeli: karta dahil edilen kisi duzenleyebilir.
create table record_participants (
  record_id uuid not null references records(id) on delete cascade,
  user_id   uuid not null references users(id) on delete cascade,
  added_by  uuid references users(id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (record_id, user_id)
);
-- PK record_id ile basliyor; mobil "Yapilacaklar" user_id ile ariyor (KNOW-283).
create index record_participants_user_idx on record_participants (user_id);

-- Bekleyen / reddedilen katilma istekleri. Onaylaninca satir silinir ve kisi
-- record_participants'a eklenir.
create table record_join_requests (
  record_id  uuid not null references records(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','denied')),
  created_at timestamptz not null default now(),
  decided_by uuid references users(id) on delete set null,
  primary key (record_id, user_id)
);

-- Kisiye ozel: sabitlenen kayitlar (Panolar widget'i) ve kayit icindeki kart
-- sirasi (listede olmayan kart sona gider).
create table record_pins (
  user_id   uuid not null references users(id) on delete cascade,
  record_id uuid not null references records(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (user_id, record_id)
);

create table card_order (
  user_id   uuid not null references users(id) on delete cascade,
  record_id uuid not null references records(id) on delete cascade,
  card_ids  uuid[] not null,
  primary key (user_id, record_id)
);

create table actions (
  id          uuid primary key default gen_random_uuid(),
  record_id   uuid not null references records(id) on delete cascade,
  title       text not null,
  owner_id    uuid references users(id) on delete set null,
  created_by  uuid not null references users(id) on delete restrict,
  status      text not null default 'open'
              check (status in ('open','in_progress','closed','cancelled')),
  due_date    date,
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  closing_note text
);
create index actions_record_idx on actions (record_id);
create index actions_open_idx   on actions (record_id) where status in ('open','in_progress');
create index actions_owner_idx  on actions (owner_id)  where status in ('open','in_progress');


-- === kartlar ===============================================================

-- Kart = arayuzde onceden tanimli bir HTML sablonu + onu dolduran JSON.
-- card_type'ta CHECK YOK: tur listesi kodda tek kaynak, taninmayan tur
-- derleme/goc hatasi degil BROKEN olarak cizilmeli.
-- Karta katilim da `data` icinde ("signups"), ayri tablo yok; yazim jsonb_set
-- ile TEK ifade — SELECT-degistir-UPDATE deseni yaris yaratir.
create table cards (
  id         uuid primary key default gen_random_uuid(),
  record_id  uuid not null references records(id) on delete cascade,
  card_type  text not null,
  data       jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index cards_record_idx on cards (record_id, sort_order, created_at);


-- === mesajlar ve gunluk ====================================================

create table messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references chats(id) on delete cascade,
  author_id   uuid references users(id) on delete set null,
  body        text not null,
  reply_to_id uuid,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  unique (chat_id, id),
  -- Yanit sohbet DISINA tasamaz — uygulama kontrolu degil, veritabani.
  foreign key (chat_id, reply_to_id) references messages (chat_id, id)
    on delete set null
);
create index messages_chat_idx on messages (chat_id, created_at);

-- Gunluk bir ILISKI DEGILDIR: kaynak silinse de satir yasamali, o yuzden FK
-- zayif ve etiketler denormalize. Label olmadan gecmis "bir sey silindi"
-- demekten oteye gidemezdi.
create table activity (
  id            uuid primary key default gen_random_uuid(),
  chat_id       uuid references chats(id) on delete set null,
  actor_id      uuid references users(id) on delete set null,
  verb          text not null,
  subject_label text not null,
  target_label  text,
  detail        text,
  created_at    timestamptz not null default now()
);
create index activity_chat_idx on activity (chat_id, created_at) where chat_id is not null;

create table card_attachments (
  card_id       uuid not null references cards(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  sort_order    integer not null default 0,
  primary key (card_id, attachment_id)
);
create index card_attachments_attachment_idx on card_attachments (attachment_id);

create table message_attachments (
  message_id    uuid not null references messages(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  primary key (message_id, attachment_id)
);
create index message_attachments_attachment_idx on message_attachments (attachment_id);


-- === bildirim, tercih, denetim =============================================

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  last_ok_at timestamptz,
  fail_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index push_user_idx on push_subscriptions (user_id);

-- slug FK DEGIL: modul listesi kodda (MODULES), veritabaninda tablosu yok.
create table user_pins (
  user_id   uuid not null references users(id) on delete cascade,
  slug      text not null,
  pinned_at timestamptz not null default now(),
  primary key (user_id, slug)
);

-- Guvenlik denetimi `activity`'den AYRI: farkli izleyici, farkli ekran,
-- ortusen deger yok. Tur listesi kodda kullanilan her turu kapsamali: listede
-- olmayan tur kisitta DUSER (audit::log_event hatayi yalniz loga yazar).
create table security_events (
  id         uuid primary key default gen_random_uuid(),
  event_type text not null
             check (event_type in ('login','login_denied','logout','permission_denied',
                                   'deactivation','scope_granted','scope_revoked',
                                   'role_granted','role_revoked','role_created',
                                   'role_deleted','admin_granted','admin_revoked',
                                   'quality_config_changed','quality_config_reset',
                                   'llm_config_changed','llm_config_reset',
                                   'llm_profile_changed','llm_task_changed',
                                   'llm_prompt_changed','llm_limit_changed',
                                   'llm_bodies_on','llm_bodies_off')),
  actor_id   uuid references users(id) on delete set null,
  email      text,
  ip         inet,
  detail     text,
  created_at timestamptz not null default now()
);
create index security_events_time_idx on security_events (created_at desc);
create index security_events_type_idx on security_events (event_type, created_at desc);

-- Gunluk kullanim ozeti (Yonetim > Aktivite). Satir = kisi x gun.
--   requests : o gun kimlikli HTTP istegi sayisi
--   minutes  : istek atilan dakika sayisi (oturum suresinin yaklasigi)
-- Sunucu istekleri bellekte biriktirir, dakikada bir yazar (auth.rs).
create table user_activity (
  user_id  uuid not null references users(id) on delete cascade,
  day      date not null,
  requests integer not null default 0,
  minutes  integer not null default 0,
  primary key (user_id, day)
);

-- Giden posta kuyrugu. Gecici hatada us ustu bekleyerek tekrar, kalici hatada
-- (4xx) ya da 5 denemeden sonra vazgec (error dolu, sent_at bos kalir).
create table mail_outbox (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  to_email   text not null,
  subject    text not null,
  body_html  text not null,
  body_text  text not null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  error      text,
  attempts    integer not null default 0,
  next_try_at timestamptz not null default now()
);
create index mail_outbox_pending_idx on mail_outbox (next_try_at) where sent_at is null and attempts < 5;

-- Yonetim sayfasindan degisen ayarlar: yeniden derleme gerekmez. TEK satir;
-- satir yoksa kodun varsayilanlari gecerli.
-- quality_config: kalite kapisi sorulari ve esikleri (spec/76).
create table quality_config (
    id         boolean primary key default true check (id),
    config     jsonb not null,
    updated_by uuid references users(id) on delete set null,
    updated_at timestamptz not null default now()
);

-- llm_config: LLM'e giden etkinlik verisinin temizleme kurallari.
create table llm_config (
    id         boolean primary key default true check (id),
    config     jsonb not null,
    updated_by uuid references users(id) on delete set null,
    updated_at timestamptz not null default now()
);


-- === tetikleyiciler ========================================================

-- updated_at ELLE surulmuyor. Python'da bes ayri yerde yaziliyordu; unutulan
-- bir yol "activity" siralamasini SESSIZCE bozardi.
create function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

create trigger records_touch before update on records
  for each row execute function touch_updated_at();

-- FK records->chats yonunde oldugu icin cascade TERS akiyor: kayit silinince
-- chats satiri, mesajlari ve o mesajlarin ekleri arkada kalirdi.
create function drop_chat() returns trigger as $$
begin delete from chats where id = old.chat_id; return null; end $$ language plpgsql;

create trigger records_chat_gc after delete on records
  for each row execute function drop_chat();
create trigger teams_chat_gc after delete on teams
  for each row execute function drop_chat();

create function nodes_shape_guard() returns trigger language plpgsql as $$
declare
  pshape text;
begin
  -- Bu dugum bir cocuk olarak: ebeveynin shape'ine uymali.
  if new.parent_id is not null then
    select shape into pshape from nodes where id = new.parent_id;
    if pshape = 'leaf' then
      raise exception 'shape_violation: leaf dugumun cocugu olamaz' using errcode = 'check_violation';
    end if;
    if pshape = 'list' and exists (
      select 1 from nodes s where s.parent_id = new.parent_id and s.id <> new.id
         and s.node_type <> new.node_type) then
      raise exception 'shape_violation: list dugumun cocuklari ayni turde olmali' using errcode = 'check_violation';
    end if;
  end if;
  -- Bu dugum bir ebeveyn olarak: kendi shape'i mevcut cocuklarina uymali.
  if new.shape = 'leaf' and exists (select 1 from nodes c where c.parent_id = new.id) then
    raise exception 'shape_violation: cocugu olan dugum leaf olamaz' using errcode = 'check_violation';
  end if;
  if new.shape = 'list' and (select count(distinct node_type) from nodes c where c.parent_id = new.id) > 1 then
    raise exception 'shape_violation: karisik turde cocuklar list olamaz' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger nodes_shape_guard before insert or update of parent_id, node_type, shape on nodes
  for each row execute function nodes_shape_guard();


-- === sohbet kutusunun tek sorgusu ==========================================

-- Mesaj + sistem bildirimi, tek kronolojik akis. HIC JOIN YOK: activity.chat_id
-- geldikten sonra iki dal da dogrudan chat_id uzerinde.
create view chat_feed as
select 'message'::text as kind,
       m.id, m.chat_id, m.created_at,
       m.author_id as actor_id,
       null::text  as verb,
       null::text  as subject_label,
       null::text  as target_label,
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


-- === etkinlikler (spec/73) =================================================
-- Widget'lar kart blob'u DEGIL: her turun verisi kendi iliskisel tablosunda,
-- etkinlige bagli.

create table events (
  id          uuid primary key default gen_random_uuid(),
  -- etkinligin kendi kaydi (ikiz): sohbet + arsiv. Ters yon kayitta TUTULMAZ.
  record_id   uuid not null unique references records(id) on delete restrict,
  title       text not null check (length(title) between 1 and 200),
  status      text not null default 'idea'
              check (status in ('idea','planning','confirmed','done','cancelled')),
  priority    text not null default 'medium'
              check (priority in ('critical','high','medium','low')),
  owner_id    uuid references users(id) on delete set null,
  date        date,                 -- null = havuz
  start_time  time,
  place       text,                 -- kampus disi / tek seferlik yer; yoksa location_id
  attendees   integer check (attendees >= 0),
  description text,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Tur ve yer referans veriden (nodes: event_types / event_locations).
  kind_id     uuid not null references nodes(id) on delete restrict,
  location_id uuid references nodes(id) on delete restrict,
  -- Etkinlik basina tek sponsorluk kaydi; kayit silinirse bag kalkar.
  sponsor_record_id uuid references records(id) on delete set null,
  check (status not in ('confirmed','done') or date is not null),
  check (start_time is null or date is not null)
);
create index on events(date);
create index on events(kind_id);

-- Ikiz bir kez baglanir, sonra donar (spec/73 §3a).
create function events_record_id_frozen() returns trigger language plpgsql as $$
begin
  raise exception 'events.record_id değiştirilemez' using errcode = 'check_violation';
end $$;
create trigger events_record_id_frozen before update of record_id on events
  for each row when (old.record_id is distinct from new.record_id)
  execute function events_record_id_frozen();

create table event_participants (
  event_id uuid not null references events(id) on delete cascade,
  user_id  uuid not null references users(id) on delete cascade,
  role     text check (length(role) <= 60),
  added_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table event_teams (
  event_id uuid not null references events(id) on delete cascade,
  team_id  uuid not null references teams(id) on delete cascade,
  primary key (event_id, team_id)
);

create table event_checkpoints (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references events(id) on delete cascade,
  label     text not null check (length(label) between 1 and 120),
  -- Sablondan gelen: etkinlik tarihine GORE (gun farki). Tarih okunurken
  -- `events.date + offset_days`; havuzdaki etkinlikte tarihsiz, tarih gelince
  -- kendiliginden dolar, tarih kayinca kayar. Elle eklenen: mutlak `due_date`.
  offset_days smallint,
  due_date  date,
  done_at   timestamptz,
  position  smallint not null,
  check (offset_days is null or due_date is null)
);
create index on event_checkpoints(event_id, position);

-- Onay istegi: etkinligi duzenleyen ama onaylayici olmayan (sorumlu ya da
-- manage_events degil) kisi adimi isaretleyemez/kaldiramaz, ister. Ayni kisi
-- ayni adim icin ayni eylemi iki kez isteyemez (idempotent).
create table event_checkpoint_requests (
  id            uuid primary key default gen_random_uuid(),
  checkpoint_id uuid not null references event_checkpoints(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  action        text not null check (action in ('done','undone','delete')),
  created_at    timestamptz not null default now(),
  unique (checkpoint_id, user_id, action)
);

-- Widget = sayfadaki YUVA. Veri turun tablosunda; istisna `record`: yuva bagin kendisi.
create table event_widgets (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  widget_type text not null check (widget_type in ('supplies','record','otf')),
  record_id   uuid references records(id) on delete cascade,
  position    smallint not null,
  check ((widget_type = 'record') = (record_id is not null))
);
create unique index on event_widgets(event_id, widget_type) where widget_type <> 'record';
create unique index on event_widgets(event_id, record_id) where record_id is not null;
create index on event_widgets(record_id) where record_id is not null;

-- Satin alim kalemleri (spec/73 §5) etkinlikten BAGIMSIZ: maliye sayfasi
-- dogrudan `materials`'ta arar ve toplar; etkinlik yalniz bir baglamdir
-- (event_materials). Etkinlik silinince bag gider, kalem kalir.
create table materials (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 200),
  notes       text,
  type        text not null default 'consumable' check (type in ('consumable','equipment','service')),
  priority    text not null default 'medium'
              check (priority in ('critical','high','medium','low')),
  state       smallint not null default 0 check (state between 0 and 3),
  has_sponsor boolean not null default false,
  owned       boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  qty                 integer not null default 1 check (qty >= 1),
  -- Teklif secimi tek yerde: ya bir tedarikci ya sponsor. Bileske FK (asagida)
  -- secilen teklifin AYNI malzemeye ait olmasini zorlar; teklif silinirse secim kalkar.
  chosen_provider_id  uuid,
  -- Sponsor surec adimi degil, ayri bir ISTEK. "Zaten var" kalem sponsordan istenmez.
  sponsor_chosen      boolean not null default false,
  sponsor_qty         integer check (sponsor_qty >= 1),
  sponsor_date        date,
  in_sponsor_record   boolean not null default false,
  -- Teslim alindi: sutun degil, detaydaki isaret; yalniz onayli kalem teslim edilir.
  delivered           boolean not null default false,
  created_by          uuid references users(id) on delete set null,
  -- Yalniz maliye incelemesiyle (`review_purchases`) yazilir; widget'taki onay
  -- (state = 3) satin alindi DEMEK DEGIL.
  purchased           boolean not null default false,
  purchased_at        timestamptz,
  purchased_by        uuid references users(id) on delete set null,
  -- Kalem basina tek butce tutari; asim ham degerle saklanir, kademe ($, $$, $$$)
  -- saklanmaz: esik degisince veri yeniden yazilmaz.
  budget              numeric(12,2) check (budget is null or budget > 0),
  overage_ln          double precision,
  -- Kalem nereden geldi: 'manual' (varsayilan) ya da oneri kabulunden 'ai'.
  -- NULL = izleme oncesi, bilinmiyor.
  origin              text default 'manual' check (origin in ('manual', 'ai')),
  check (not (sponsor_chosen and chosen_provider_id is not null)),
  check (has_sponsor or (not sponsor_chosen and sponsor_qty is null
                         and sponsor_date is null and not in_sponsor_record)),
  check (not (owned and has_sponsor)),
  check (not purchased or (state = 3 and not owned)),
  check (not delivered or (state = 3 and not owned)),
  check (purchased = (purchased_at is not null))
);

create table material_providers (
  id           uuid primary key default gen_random_uuid(),
  material_id  uuid not null references materials(id) on delete cascade,
  contact      text not null check (length(contact) between 1 and 300),
  price        numeric(12,2) check (price >= 0),
  arrival_date date,
  -- Telefon icin kisi/firma adi. Baglanti (link) icin bos kalir.
  name         text check (name is null or char_length(name) between 1 and 200),
  unique (id, material_id)
);
create index on material_providers(material_id);

alter table materials add foreign key (chosen_provider_id, id)
  references material_providers(id, material_id) on delete set null (chosen_provider_id);

create table event_materials (
  material_id uuid primary key references materials(id) on delete cascade,
  event_id    uuid not null references events(id) on delete cascade
);
create index on event_materials(event_id);

-- Malzeme onerileri kaydi (spec/79 §9.1): her model onerisi bir satir, karar
-- (kabul/ret) ve kabulde dogan kalem. Satin alindi durumu BURADA TUTULMAZ:
-- `material_id` uzerinden `materials.purchased` okunur; tek kaynak kalir.
-- Model, maliyet, sure `batch_id` ile `llm_calls.batch_id`'den gelir (o satirlar
-- 180 gunde silinir, bu tablo kalir).
create table material_suggestions (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  batch_id    uuid not null,
  name        text not null check (char_length(name) between 1 and 200),
  description text not null default '',
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  -- Kabulde dogan kalem; kalem silinirse bag kalkar, "kabul edildi" kalir.
  material_id uuid unique references materials(id) on delete set null,
  decided_by  uuid references users(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  check (material_id is null or status = 'accepted')
);
create index on material_suggestions(event_id);
create index on material_suggestions(batch_id);

-- Kademe esigi zamanli: her degisiklik yeni satir, eski satir silinmez. Bir kalemin
-- asimi, kendi `updated_at` zamanindaki satirla (effective_from <= zaman) gosterilir.
-- yellow_max_ln: $$ ust siniri, ln(oran).
create table overage_base (
  effective_from  timestamptz primary key default now(),
  yellow_max_ln   double precision not null check (yellow_max_ln > 0),
  note            text
);

-- OTF (FORM.GN.05) talep formu widget'i. Etkinlikten gelenler (ad, tarih,
-- saat, yer, katilimci sayisi) burada TEKRAR TUTULMAZ; dosya uretilirken okunur.
create table event_otf (
  event_id     uuid primary key references events(id) on delete cascade,
  purpose      text,                 -- "adi, amaci, icerigi"nin ad disi kismi
  end_time     time,
  advisor      text,
  age_group    text,
  outcomes     text,
  -- bolum aciklamalari (adetler buraya da yazilir)
  layout_notes text,
  av_notes     text,
  tech_notes   text,
  host_notes   text,
  care_notes   text,
  other_notes  text,
  -- Otomatik doldurma: baska etkinligin formundan kopyalandiysa kaynak ve
  -- gozden gecirme durumu. needs_review iken .docx verilmez; "gozden gecirdim"
  -- ancak kopyadan sonra en az bir alan degistiyse (edited) isaretlenir.
  copied_from  uuid references events(id) on delete set null,
  needs_review boolean not null default false,
  edited       boolean not null default false,
  updated_at   timestamptz not null default now()
);

-- Isaretli kutular. Anahtar listesi Rust `otf::SECTIONS`'ta (sablonla birlikte
-- degisir); sema metni kabul eder, uc dogrular.
create table event_otf_items (
  event_id uuid not null references events(id) on delete cascade,
  item     text not null check (item ~ '^[a-z_]+$'),
  quantity integer check (quantity between 1 and 10000),
  primary key (event_id, item)
);

-- Etkinlik sorumlulari (en cok 3, formdaki sira). Telefon kisinin profilinden.
create table event_otf_contacts (
  event_id uuid not null references events(id) on delete cascade,
  user_id  uuid not null references users(id) on delete cascade,
  position smallint not null check (position between 0 and 2),
  primary key (event_id, user_id),
  unique (event_id, position)
);

-- OTF kazanimlari: Etkinlik Kazanimlari listesinden secilenler (n:m). Serbest
-- metin `event_otf.outcomes`'ta kalir. Kazanim dugumu silinmek istenirse FK
-- `node_in_use` doner; emekliye ayirmak pasiflestirmektir.
create table event_otf_outcomes (
  event_id   uuid not null references events(id) on delete cascade,
  outcome_id uuid not null references nodes(id) on delete restrict,
  primary key (event_id, outcome_id)
);
create index on event_otf_outcomes (outcome_id);


-- === Yonetim > Veri isleme ve LLM (spec/79 §11) ============================
-- Gorev (task) KODDA sabittir (sozlesme: uc turu, sema, suzgec); burada yalniz
-- verisi durur. Acilista her uc turu icin bir profil ve her gorev icin bir satir
-- yoksa olusturulur (llm::ensure_defaults; modeller manifestten).

-- Profil: hangi model, hangi parametrelerle, ne kadar parayla. Gorevler profile baglanir;
-- profilin modeli degisince ona bagli butun gorevler degisir.
create table llm_profiles (
    id         uuid primary key default gen_random_uuid(),
    name       text not null unique check (char_length(btrim(name)) between 1 and 60),
    -- Sozlesme turu: yalniz ayni turdeki gorev bu profili secebilir.
    endpoint   text not null check (endpoint in ('chat', 'decisions')),
    model      text not null,
    -- Uc turune gore dogrulanir (llm.rs `Params`); bilinmeyen alan reddedilir.
    params     jsonb not null default '{}',
    -- Modelin son basarili "Dene"si kayitta kullanildiysa zamani; NULL = denenmeden kaydedildi.
    tested_at  timestamptz,
    created_at timestamptz not null default now(),
    updated_by uuid references users(id) on delete set null,
    updated_at timestamptz not null default now()
);

create table llm_tasks (
    feature        text primary key,
    -- Kullanilan profil silinemez (restrict).
    profile_id     uuid not null references llm_profiles(id) on delete restrict,
    -- Goreve ozgu parametre (malzeme onerisi: parti buyuklugu). NULL = varsayilan.
    batch          int check (batch between 3 and 15),
    enabled        boolean not null default true,
    store_bodies   boolean not null default false,
    -- NULL = koddaki istem (surum 0).
    prompt_version int,
    updated_by     uuid references users(id) on delete set null,
    updated_at     timestamptz not null default now()
);

-- Her model cagrisi bir satir: basarili, basarisiz (ucret dogmus olabilir) ve limite
-- takilan. Servis kapaliyken (anahtar yok / external_off) satir YAZILMAZ: cagri yok.
-- Istem ve cevap GOVDESI burada yok (llm_call_bodies, istege bagli, 7 gun).
create table llm_calls (
    id                uuid primary key default gen_random_uuid(),
    created_at        timestamptz not null default now(),
    feature           text not null,
    model             text not null,
    -- Limit profile gore toplanir; profil silinirse satir kalir (model adi yeter).
    profile_id        uuid references llm_profiles(id) on delete set null,
    user_id           uuid references users(id) on delete set null,
    event_id          uuid references events(id) on delete set null,
    is_try            boolean not null default false,
    prompt_version    int,
    status            text not null
        check (status in ('ok', 'limit', 'http', 'timeout', 'network', 'parse', 'schema')),
    http_status       int,
    -- Kisa hata izi (asama + saglayici mesaji); istem/cevap icerigi degil.
    error             text check (char_length(error) <= 500),
    ms                int not null default 0,
    prompt_tokens     int,
    completion_tokens int,
    -- USD; saglayici vermediyse NULL ("maliyet bilinmiyor").
    cost_usd          double precision,
    or_gen_id         text,
    batch_id          uuid,
    asked             int,
    kept              int,
    -- Kalite kapisi karari: pass | low.
    outcome           text
);
create index llm_calls_profile_time on llm_calls (profile_id, created_at);
create index llm_calls_time on llm_calls (created_at);

create table llm_call_bodies (
    call_id    uuid primary key references llm_calls(id) on delete cascade,
    request    jsonb not null,
    response   text,
    created_at timestamptz not null default now()
);
create index llm_call_bodies_time on llm_call_bodies (created_at);

-- Gunluk ozet: KISI YOK, kalici. llm_calls 180 gun sonra silinir; maliyet gecmisi buradan.
create table llm_usage_daily (
    day               date not null,
    feature           text not null,
    model             text not null,
    calls             int not null,
    errors            int not null,
    prompt_tokens     bigint not null,
    completion_tokens bigint not null,
    cost_usd          double precision not null,
    unpriced          int not null,
    ms_total          bigint not null,
    primary key (day, feature, model)
);

-- Profil basina dolar tavani; pencere kayan (son N dakika). Profil basina istenen kadar.
-- Profil silinince limitleri de gider.
create table llm_limits (
    id             uuid primary key default gen_random_uuid(),
    profile_id     uuid not null references llm_profiles(id) on delete cascade,
    window_minutes int not null check (window_minutes between 15 and 44640),
    usd            double precision not null check (usd > 0 and usd < 100000),
    created_by     uuid references users(id) on delete set null,
    created_at     timestamptz not null default now(),
    unique (profile_id, window_minutes)
);

-- Istem surumleri: yalniz ekleme. Etkin olan llm_tasks.prompt_version.
create table llm_prompts (
    feature    text not null,
    version    int not null check (version > 0),
    body       text not null check (char_length(btrim(body)) between 1 and 8000),
    created_by uuid references users(id) on delete set null,
    created_at timestamptz not null default now(),
    primary key (feature, version)
);


-- === tohum: kapsam katalogu ================================================
-- user_scopes.scope -> scopes.name FK'si yuzunden ZORUNLU: katalogda olmayan
-- kapsam kimseye verilemez.
insert into scopes (name) values
  ('edit_nodes'), ('hard_delete_nodes'), ('manage_users'), ('manage_teams'),
  ('create_tags'), ('edit_deadline'), ('tag_media'),
  ('manage_events'), ('manage_event_widgets'), ('manage_purchases'),
  ('manage_event_types'), ('manage_event_locations'), ('manage_event_outcomes'),
  ('bypass_text_quality'), ('edit_user_names'),
  ('review_purchases'), ('manage_budgets'),
  ('use_generative_ai'), ('manage_llm');


-- === tohum: referans veri agaci (spec/74) ==================================
-- Kokler yalniz bu tohumla dogar ve sabit `key` tasir; kod koku adla degil key
-- ile bulur. Bolumler (Etkinlik Turleri / Yerleri / Kazanimlari) list: butun
-- cocuklari ayni turde, shape tetikleyicisi kabul eder.

insert into nodes (name, node_type, key, shape, sort_order, description) values
  ('Birimler', 'operational', 'units', 'tree', 0, null),
  ('Etkinlik Yönetimi', 'operational', 'event_management', 'list', 1,
   'Etkinliklerin dayandığı referans veri: etkinlik türleri, yerler ve kazanımlar.');

insert into nodes (parent_id, name, node_type, key, shape, sort_order, description)
select m.id, v.name, 'operational', v.key, 'list', v.pos, v.description
  from nodes m,
       (values ('Etkinlik Türleri',    'event_types',     0, null),
               ('Etkinlik Yerleri',    'event_locations', 1, null),
               ('Etkinlik Kazanımları', 'event_outcomes',  2,
                'Bir etkinliğin ekibe ya da kulübe kazandırmayı hedeflediği somut sonuçlar. Her kazanımın ad''ı kısa, açıklaması ayırt edici olmalı.')
       ) as v(name, key, pos, description)
 where m.key = 'event_management';

-- Etkinlik turleri (bugunku 5 tur).
insert into nodes (parent_id, name, node_type, shape, sort_order)
select t.id, v.label, 'option', 'list', v.pos
  from nodes t,
       (values (0, 'Toplantı'), (1, 'Eğitim'), (2, 'Sosyal'), (3, 'Saha ziyareti'), (4, 'Konferans')
       ) as v(pos, label)
 where t.key = 'event_types';

-- Her turun iki slotu. Kod bunlari adla degil attrs.slot ile tanir (ad sabit,
-- spec/74 §4.2).
insert into nodes (parent_id, name, node_type, shape, attrs, sort_order)
select o.id, v.name, 'operational', 'list', v.attrs, v.pos
  from nodes o
  join nodes t on t.id = o.parent_id and t.key = 'event_types',
       (values ('Adımlar',    '{"slot":"steps"}'::jsonb,   0),
               ('Widget''lar', '{"slot":"widgets"}'::jsonb, 1)) as v(name, attrs, pos);

-- Adimlar: etkinlik tarihine gore gun farkiyla.
insert into nodes (parent_id, name, node_type, shape, attrs, sort_order)
select s.id, v.name, 'checkpoint', 'leaf', jsonb_build_object('offset_days', v.offset_days), v.pos
  from (values
         ('Toplantı',      0, 'Gündem toplandı',     -10),
         ('Toplantı',      1, 'OTF gönderildi',       -7),
         ('Toplantı',      2, 'Davet gönderildi',     -7),
         ('Eğitim',        0, 'Eğitmen kesinleşti',  -21),
         ('Eğitim',        1, 'Mekan ayarlandı',     -14),
         ('Eğitim',        2, 'OTF gönderildi',       -7),
         ('Eğitim',        3, 'Malzeme hazır',        -7),
         ('Sosyal',        0, 'Bütçe onayı',         -21),
         ('Sosyal',        1, 'Mekan ayarlandı',     -14),
         ('Sosyal',        2, 'OTF gönderildi',       -7),
         ('Sosyal',        3, 'Duyuru',               -7),
         ('Saha ziyareti', 0, 'Ziyaret onayı',       -21),
         ('Saha ziyareti', 1, 'Ulaşım ayarlandı',     -7),
         ('Konferans',     0, 'Başvuru',             -45),
         ('Konferans',     1, 'Stand kesinleşti',    -30),
         ('Konferans',     2, 'Tanıtım',             -10),
         ('Konferans',     3, 'Malzeme hazır',        -7)
       ) as v(option_name, pos, name, offset_days)
  join nodes o on o.node_type = 'option' and o.name = v.option_name
  join nodes s on s.parent_id = o.id and s.attrs->>'slot' = 'steps';

-- Widget'lar: hangi tur hangi widget'i tasir.
insert into nodes (parent_id, name, node_type, shape, attrs, sort_order)
select s.id,
       case v.widget when 'otf' then 'Etkinlik talep formu (OTF)' else 'Satın alımlar' end,
       'widget', 'leaf', jsonb_build_object('widget', v.widget), v.pos
  from (values
         ('Toplantı',  0, 'otf'),
         ('Eğitim',    0, 'otf'),
         ('Eğitim',    1, 'supplies'),
         ('Sosyal',    0, 'otf'),
         ('Konferans', 0, 'supplies')
       ) as v(option_name, pos, widget)
  join nodes o on o.node_type = 'option' and o.name = v.option_name
  join nodes s on s.parent_id = o.id and s.attrs->>'slot' = 'widgets';


-- === tohum: butce asim tabani ==============================================
-- Ilk deger ln(sqrt(2)) ≈ 0.347 (%41 asim).
insert into overage_base (yellow_max_ln, note)
values (0.5 * ln(2.0), 'ilk taban: $$ ust siniri sqrt(2) orani');
