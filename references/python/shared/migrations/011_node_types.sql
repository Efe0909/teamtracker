-- Node turleri: serbest metin -> enum (spec/72-node-turleri.md §3, §10).
--
-- Sira onemli: ONCE esle, SONRA kisitla — CHECK'i once koyarsak goc patlar.

-- 1. is_active sutunu (users.is_active kalibi, 001_schema.sql:34)
alter table nodes add column if not exists is_active boolean not null default true;

-- 2. Bilinen turleri esle. Zaten enum olanlara dokunma (where suzgeci).
update nodes set node_type = case node_type
  when 'Departman'   then 'cell'
  when 'Hat'         then 'cell'
  when 'Makine/Kol'  then 'machine'
  when 'Ünite'       then 'machine'
  when 'Pillar'      then 'pillar'
  when 'Takım'       then 'team'
  when 'Görev'       then 'task'
  when 'Adım'        then 'step'
  when 'Operational' then 'operational'
  when 'Etkinlik'    then 'operational'
  when 'Kazanım'     then 'generic'
  else node_type
end
where node_type not in ('cell','machine','pillar','team','task','step','operational','generic');

-- 3. Kalan taninmayanlari BILDIR, sonra generic'e dusur. Goc patlamaz: veri
--    kaybi yok, yalniz etiket kayboluyor ve log'da adiyla duruyor.
--    'warning' kasitli — 'notice' psycopg'nin varsayilan seviyesinde gorunmez.
do $$
declare r record;
begin
  for r in select node_type, count(*) c from nodes
    where node_type not in ('cell','machine','pillar','team','task','step','operational','generic')
    group by node_type
  loop
    raise warning 'bilinmeyen node_type: % (% dugum) -> generic', r.node_type, r.c;
  end loop;
end $$;

update nodes set node_type = 'generic'
where node_type not in ('cell','machine','pillar','team','task','step','operational','generic');

-- 4. CHECK kisiti, idempotent dusur-koy (007_scopes.sql:51-53 kalibi).
--    Tek sutunluk enum icin CHECK — security_events.event_type'in kalibi.
alter table nodes drop constraint if exists nodes_node_type_check;
alter table nodes add constraint nodes_node_type_check
  check (node_type in ('cell','machine','pillar','team','task','step','operational','generic'));

-- 5. ROOT_ONLY ihlallerini BILDIR, duzeltme — bu bir veri karari, goc karari
--    degil. Tasima kullanicinin isi (spec/72 §7).
do $$
declare r record;
begin
  for r in select id, name from nodes where node_type = 'cell' and parent_id is not null
  loop
    raise warning 'ROOT_ONLY ihlali: turu cell ama kok degil — % (%)', r.name, r.id;
  end loop;
end $$;

-- 6. Olu pillar sutunu (spec/72 §8, TASK-220). Hic set edilmedi: EDITABLE'da
--    yok, yani arayuzden erisilemiyordu.
alter table items drop column if exists pillar;

-- 7. Kapsam katalogu: 008_roles.sql'in user_scopes.scope -> scopes.name FK'si
--    yuzunden ZORUNLU — katalogda olmayan kapsam kimseye verilemez.
insert into scopes (name) values ('hard_delete_nodes') on conflict (name) do nothing;
