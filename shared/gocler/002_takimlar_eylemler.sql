-- Takimlar ve eylemler (gorev tablosu v2 ile geldi, spec/60-kaynak-uyarlama.md).
-- SQLite surumunden cevrildi: text id -> uuid, text zaman -> timestamptz/date.

create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  node_id     uuid references nodes(id) on delete set null,
  color       text,
  created_at  timestamptz not null default now()
);

create table if not exists team_members (
  team_id  uuid not null references teams(id) on delete cascade,
  user_id  uuid not null references users(id) on delete cascade,
  role     text not null default 'uye' check (role in ('lider','mentor','uye')),
  added_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists actions (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references items(id) on delete cascade,
  title       text not null,
  assignee_id uuid references users(id) on delete set null,
  status      text not null default 'acik'
              check (status in ('acik','devam','kapandi','iptal')),
  due_date    date,
  created_by  uuid not null references users(id),
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists actions_item_idx on actions(item_id);
-- "acik eylemi olan kayitlar" sorgusu bunun uzerinden doner
create index if not exists actions_acik_idx on actions(item_id) where status in ('acik','devam');

alter table items add column if not exists team_id uuid references teams(id) on delete set null;
create index if not exists items_team_idx on items(team_id);
