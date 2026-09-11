-- Node türleri: serbest metin → enum (plan.md §1).
--
-- Sıra önemli: ÖNCE eşle, SONRA kısıtla — CHECK'i önce koyarsak göç patlar.

-- 1. is_active sütunu (users.is_active kalıbı, 001_schema.sql:34)
alter table nodes add column if not exists is_active boolean not null default true;

-- 2. Bilinen türleri eşle (zaten enum olanlar korunur)
update nodes set node_type = case node_type
  when 'Departman'  then 'cell'
  when 'Hat'        then 'cell'
  when 'Makine/Kol' then 'machine'
  when 'Ünite'      then 'machine'
  when 'Pillar'     then 'pillar'
  when 'Takım'      then 'team'
  when 'Görev'      then 'task'
  when 'Adım'       then 'step'
  when 'Operational' then 'operational'
  when 'Etkinlik'   then 'operational'
  when 'Kazanım'    then 'generic'
  else node_type
end
where node_type not in ('cell','machine','pillar','team','task','step','operational','generic');

-- 3. Tanınmayanları bildir ve generic'e düşür
do $$
declare r record;
begin
  for r in select distinct node_type from nodes
    where node_type not in ('cell','machine','pillar','team','task','step','operational','generic')
  loop
    raise warning 'bilinmeyen node_type: %, generic''e düşürülüyor', r.node_type;
  end loop;
end $$;

update nodes set node_type = 'generic'
where node_type not in ('cell','machine','pillar','team','task','step','operational','generic');

-- 4. CHECK kısıtı, idempotent düşür-koy (007_scopes.sql:51-53 ve 008_roles.sql:61-66)
alter table nodes drop constraint if exists nodes_node_type_check;
alter table nodes add constraint nodes_node_type_check
  check (node_type in ('cell','machine','pillar','team','task','step','operational','generic'));

-- 5. ROOT_ONLY ihlallerini bildir (düzeltmez — veri kararı)
do $$
declare r record;
begin
  for r in select id, name, node_type from nodes
    where node_type = 'cell' and parent_id is not null
  loop
    raise warning 'ROOT_ONLY ihlali: % (%) kök değil ama türü cell', r.name, r.id;
  end loop;
end $$;

-- 6. Pillar sütununu düşür (ölü sütun — TASK-220)
alter table items drop column if exists pillar;

-- 7. Kapsam kataloğuna hard_delete_nodes ekle (008_roles.sql FK'si zorunlu kılıyor)
insert into scopes (name) values ('hard_delete_nodes') on conflict do nothing;
