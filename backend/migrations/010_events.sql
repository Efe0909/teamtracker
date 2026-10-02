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

-- Widget = sayfadaki YUVA. Veri turun tablosunda; istisna `record`: yuva bagin kendisi.
create table event_widgets (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  widget_type text not null check (widget_type in ('supplies','record')),
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

insert into scopes (name) values ('manage_event_widgets'), ('manage_purchases')
on conflict (name) do nothing;
