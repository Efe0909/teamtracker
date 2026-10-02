-- Etkinlik planlama (spec/73). Widget'lar kart blob'u DEGIL: her turun verisi
-- kendi iliskisel tablosunda, etkinlige bagli.

create table events (
  id          uuid primary key default gen_random_uuid(),
  -- etkinligin kendi kaydi (ikiz): sohbet + arsiv. Ters yon kayitta TUTULMAZ.
  record_id   uuid not null unique references records(id) on delete restrict,
  title       text not null check (length(title) between 1 and 200),
  kind        text not null check (kind in ('meeting','training','social','visit','conference')),
  status      text not null default 'idea'
              check (status in ('idea','planning','confirmed','done','cancelled')),
  priority    text not null default 'medium'
              check (priority in ('critical','high','medium','low')),
  owner_id    uuid references users(id) on delete set null,
  date        date,                 -- null = havuz
  start_time  time,
  place       text,
  attendees   integer check (attendees >= 0),
  description text,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (status not in ('confirmed','done') or date is not null),
  check (start_time is null or date is not null)
);
create index on events(date);

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

-- Satin alimlar (spec/73 §5).
create table materials (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  name        text not null check (length(name) between 1 and 200),
  notes       text,
  type        text not null default 'consumable' check (type in ('consumable','equipment','service')),
  priority    text not null default 'medium'
              check (priority in ('critical','high','medium','low')),
  state       smallint not null default 0,
  has_sponsor boolean not null default false,
  owned       boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (state between 0 and case when has_sponsor then 4 else 3 end)
);
create index on materials(event_id);

create table material_providers (
  id           uuid primary key default gen_random_uuid(),
  material_id  uuid not null references materials(id) on delete cascade,
  contact      text not null check (length(contact) between 1 and 300),
  price        numeric(12,2) check (price >= 0),
  arrival_date date
);
create index on material_providers(material_id);

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

insert into scopes (name) values ('manage_events'), ('manage_event_widgets'), ('manage_purchases')
on conflict (name) do nothing;
