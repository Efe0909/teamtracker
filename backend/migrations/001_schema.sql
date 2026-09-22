-- Sema v2 — spec/21-sema-v2.md.
--
-- Numarali goclerin (001..015) tek dosyaya sikistirilmis hali. Alpha'da
-- veritabani atilip yeniden kuruluyordu; ILK GERCEK KURULUMDAN SONRA bu dosya
-- adi DONAR — yeniden adlandirilirsa uygulanmamis sayilir ve yeniden kosar.

create extension if not exists pgcrypto;
create extension if not exists unaccent;

-- Turkce arama: 'turkish' snowball sozlugu KULLANILMIYOR, asiri koke iniyor
-- ("gündür" -> "g"). simple + unaccent, aksan katlamayi verir, koke inmez.
do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'tr') then
    create text search configuration tr (copy = simple);
    alter text search configuration tr
      alter mapping for hword, hword_part, word with unaccent, simple;
  end if;
end $$;


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
  created_at    timestamptz not null default now()
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
  created_at timestamptz not null default now()
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

create table nodes (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references nodes(id) on delete cascade,
  name       text not null,
  node_type  text not null
             check (node_type in ('cell','machine','pillar','team','task',
                                  'step','operational','generic')),
  description text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
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


-- === sohbet (events'in konusma tarafi) =====================================

-- chats KENDI BASINA bir varlik: icinde item_id/node_id TASIMAZ. Bag ters
-- yonde kurulur (records.chat_id, teams.chat_id), ikisi de not null unique.
create table chats (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);


-- === takimlar ==============================================================

create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  -- Takimin GERCEK kaydi burasi; node yalnizca hiyerarsideki yerini isaretler.
  node_id     uuid references nodes(id) on delete set null,
  chat_id     uuid not null unique references chats(id) on delete restrict,
  color       text,
  created_at  timestamptz not null default now()
);
-- Bir node'a IKI takim asilmasi projeksiyon fikrini bozar.
create unique index teams_node_uniq on teams (node_id) where node_id is not null;

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


-- === kayitlar ==============================================================

create table records (
  id          uuid primary key default gen_random_uuid(),
  -- "Birim": node'un bir ALT KUMESI — team ve pillar tipli node'lar olamaz.
  -- Kural kodda (UNIT_TYPES) ve yazma yolunda; CHECK alt sorgu yapamaz.
  unit_id     uuid not null references nodes(id) on delete cascade,
  -- ORTOGONAL: pillar kaydin atasi olmak zorunda degil.
  pillar_id   uuid references nodes(id) on delete set null,
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
    (to_tsvector('tr', coalesce(title,'') || ' ' || coalesce(description,''))) stored
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
  created_at  timestamptz not null default now()
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


-- === bildirim ve tercih ====================================================

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
-- ortusen deger yok.
create table security_events (
  id         uuid primary key default gen_random_uuid(),
  event_type text not null
             check (event_type in ('login','login_denied','logout','permission_denied',
                                   'deactivation','scope_granted','scope_revoked',
                                   'role_granted','role_revoked','role_created',
                                   'role_deleted','admin_granted','admin_revoked')),
  actor_id   uuid references users(id) on delete set null,
  email      text,
  ip         inet,
  detail     text,
  created_at timestamptz not null default now()
);
create index security_events_time_idx on security_events (created_at desc);
create index security_events_type_idx on security_events (event_type, created_at desc);


-- === tetikleyiciler ========================================================

-- updated_at ELLE surulmuyor. Python'da bes ayri yerde yaziliyordu; unutulan
-- bir yol "activity" siralamasini SESSIZCE bozardi.
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

create trigger records_touch before update on records
  for each row execute function touch_updated_at();

-- FK records->chats yonunde oldugu icin cascade TERS akiyor: kayit silinince
-- chats satiri, mesajlari ve o mesajlarin ekleri arkada kalirdi.
create or replace function drop_chat() returns trigger as $$
begin delete from chats where id = old.chat_id; return null; end $$ language plpgsql;

create trigger records_chat_gc after delete on records
  for each row execute function drop_chat();
create trigger teams_chat_gc after delete on teams
  for each row execute function drop_chat();


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


-- === kapsam katalogu =======================================================
-- user_scopes.scope -> scopes.name FK'si yuzunden ZORUNLU: katalogda olmayan
-- kapsam kimseye verilemez.
insert into scopes (name) values
  ('edit_nodes'), ('hard_delete_nodes'), ('manage_users'), ('manage_teams'),
  ('create_tags'), ('edit_deadline'), ('tag_media')
on conflict (name) do nothing;
