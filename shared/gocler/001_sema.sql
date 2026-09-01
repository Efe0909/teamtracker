-- EkipTakip sema (PostgreSQL 16). spec/80-veritabani.md
--
-- Uzantilar kurulum isidir, goc isi degil: yayinda bir kez superuser ile
-- kurulur (deploy/README.md). Gelistirmede compose superuser verdigi icin
-- burada "if not exists" ile geciyoruz.
create extension if not exists pgcrypto;    -- gen_random_uuid()
create extension if not exists unaccent;    -- aksan katlama (arama)

-- --- Turkce arama yapilandirmasi -----------------------------------------
-- 'turkish' snowball sozlugu KULLANILMIYOR: asiri koke iniyor ("gündür" -> "g")
-- ve eslesmeyi bozuyor (olcum: spec/80-veritabani.md §3). Bugunku FTS5
-- davranisinin karsiligi: aksan katla, kok bulma yok, onek eslesmesi.
do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'tr') then
    create text search configuration tr (copy = simple);
    alter text search configuration tr
      alter mapping for hword, hword_part, word with unaccent, simple;
  end if;
end $$;

-- --- kullanicilar ---------------------------------------------------------
create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  -- citext yerine 'collate nocase' yok; tekillik lower(email) indeksiyle
  email          text not null,
  name           text not null,
  color          text,
  is_admin       boolean not null default false,
  is_editor      boolean not null default false,
  scope_node_id  uuid,
  created_at     timestamptz not null default now(),
  google_sub     text unique,                 -- Google'in degismeyen kimligi
  is_active      boolean not null default true,
  last_login_at  timestamptz
);
create unique index if not exists users_email_nocase_idx on users (lower(email));

-- --- hiyerarsi ------------------------------------------------------------
create table if not exists nodes (
  id             uuid primary key default gen_random_uuid(),
  parent_id      uuid references nodes(id) on delete cascade,
  name           text not null,
  node_type      text not null,
  sort_order     integer not null default 0,
  pending_cr_id  uuid,
  pending_delete boolean not null default false,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now()
);
create index if not exists nodes_parent_idx on nodes(parent_id);

alter table users drop constraint if exists users_scope_fk;
alter table users add constraint users_scope_fk
  foreign key (scope_node_id) references nodes(id) on delete set null;

-- --- kayitlar -------------------------------------------------------------
create table if not exists items (
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
  dms         text,
  pillar      text,
  escalated   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Arama sutunu: generated column, kendini gunceller. FTS5'teki uc trigger dustu.
  arama       tsvector generated always as (
                to_tsvector('tr', coalesce(title,'') || ' ' || coalesce(description,''))
              ) stored
);
create index if not exists items_node_idx     on items(node_id);
create index if not exists items_assignee_idx on items(assignee_id);
create index if not exists items_arama_idx    on items using gin (arama);
create index if not exists items_acik_idx     on items(updated_at desc) where status <> 'kapandi';

create table if not exists item_participants (
  item_id  uuid not null references items(id) on delete cascade,
  user_id  uuid not null references users(id) on delete cascade,
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

-- --- olay akisi -----------------------------------------------------------
create table if not exists events (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('item','change_request')),
  subject_id   uuid not null,
  event_type   text not null check (event_type in ('mesaj','sistem')),
  author_id    uuid references users(id),
  body         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists events_subject_idx on events(subject_type, subject_id, created_at);

-- --- guvenlik olaylari ----------------------------------------------------
create table if not exists guvenlik_olaylari (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tur        text not null check (tur in
             ('giris','giris_reddi','cikis','yetki_reddi','pasiflestirme')),
  actor_id   uuid references users(id) on delete set null,
  email      text,
  ip         inet,
  detay      text
);
create index if not exists guvenlik_zaman_idx on guvenlik_olaylari(created_at desc);
create index if not exists guvenlik_tur_idx   on guvenlik_olaylari(tur, created_at desc);
