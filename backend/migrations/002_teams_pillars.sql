--
-- Takim ve pillar agactan ayrildi — spec/22-takim-pillar.md.
--
-- Kurulu veritabaninda veri kaybetmeden: pillar dugumleri AYNI uuid ile
-- pillars satiri olur (records.pillar_id gecerli kalir), team dugumlerinin
-- ustu team_nodes baglantisina doner, sonra bu dugumler silinir.

-- 1. yeni tablolar (db-scheme-export.sql ile birebir)
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

create table team_nodes (
  team_id   uuid not null references teams(id) on delete cascade,
  node_id   uuid not null references nodes(id) on delete cascade,
  linked_by uuid references users(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (team_id, node_id)
);
create index team_nodes_node_idx on team_nodes (node_id);

-- 2. team/pillar dugumlerinin cocuklarini dugumun ustune tasi. Zincir
-- (team icinde pillar ...) icin degisiklik kalmayana kadar tekrarlanir;
-- boylece team_nodes'a yazilacak "ust" de yasayan en yakin ata olur.
do $$
declare n integer;
begin
  loop
    update nodes c set parent_id = p.parent_id
      from nodes p
     where c.parent_id = p.id and p.node_type in ('team','pillar');
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;
end $$;

-- 3. team dugumu -> takimin calistigi birim
insert into team_nodes (team_id, node_id)
select t.id, n.parent_id
  from teams t
  join nodes n on n.id = t.node_id
 where n.node_type = 'team' and n.parent_id is not null
on conflict do nothing;

-- 4. pillar dugumu -> sohbet + ozel takim + pillar (ayni uuid)
do $$
declare
  r record;
  v_chat uuid;
  v_team uuid;
  v_name text;
begin
  for r in select * from nodes where node_type = 'pillar' order by created_at, id loop
    v_name := r.name;
    if exists (select 1 from teams where name = v_name)
       or exists (select 1 from pillars where name = v_name) then
      v_name := r.name || ' (pillar)';
    end if;
    if exists (select 1 from teams where name = v_name)
       or exists (select 1 from pillars where name = v_name) then
      v_name := r.name || ' (pillar ' || left(r.id::text, 8) || ')';
    end if;
    insert into chats default values returning id into v_chat;
    insert into teams (name, description, chat_id)
      values (v_name, r.description, v_chat) returning id into v_team;
    insert into pillars (id, name, description, team_id, is_active, sort_order, created_by, created_at)
      values (r.id, v_name, r.description, v_team, r.is_active, r.sort_order, r.created_by, r.created_at);
  end loop;
end $$;

-- 5. records.pillar_id: nodes -> pillars (dugumler silinmeden ONCE, yoksa
-- eski FK'nin on delete set null'i degerleri siler)
alter table records drop constraint records_pillar_id_fkey;
alter table records add constraint records_pillar_id_fkey
  foreign key (pillar_id) references pillars(id) on delete set null;

-- 6. dugumleri sil (user_node_scopes cascade ile gider)
delete from nodes where node_type in ('team','pillar');

-- 7. takimlarin dugum referansi
drop index teams_node_uniq;
alter table teams drop column node_id;

-- 8. yeni tur kumesi
alter table nodes drop constraint nodes_node_type_check;
alter table nodes add constraint nodes_node_type_check
  check (node_type in ('cell','machine','task','step','operational','generic'));
