-- Referans veri (spec/74): operational kokler, shape, attrs, kok semalari.
--
-- Kokler yalniz gocle dogar ve sabit `key` tasir; kod koku adla degil key ile
-- bulur. `operational` = kod semasinin slotu (yalniz sunucu yaratir).
-- shape cocuklara izni anlatir: leaf (cocuk yok), list (butun cocuklar ayni
-- turde), tree (serbest). Tur kurallari Rust'ta (src/refdata.rs), shape
-- burada tetikleyiciyle de zorlanir.

alter table nodes
  add column key   text unique,
  add column shape text not null default 'tree' check (shape in ('leaf','list','tree')),
  add column attrs jsonb not null default '{}'::jsonb check (jsonb_typeof(attrs) = 'object');

alter table nodes drop constraint nodes_node_type_check;
alter table nodes add constraint nodes_node_type_check check (node_type in
  ('cell','machine','task','step','operational','generic','option','checkpoint','widget','location'));

-- Elle yaratilmis operational dugumler generic olur: artik operational yalniz
-- kodun yarattigi slot (Efe: tohumdaki "Yillik Bayi Toplantisi" hic
-- operational olmamaliydi).
update nodes set node_type = 'generic' where node_type = 'operational';

do $$
declare
  units uuid;
  types uuid;
  places uuid;
  k record;
  opt uuid;
  steps uuid;
  widgets uuid;
  i int;
begin
  -- 1. Birimler: bugunku butun kokler altina tasinir; cell artik kok-yalniz degil.
  insert into nodes (name, node_type, key, shape, sort_order)
    values ('Birimler', 'operational', 'units', 'tree', 0) returning id into units;
  update nodes set parent_id = units where parent_id is null and id <> units;

  -- 2. Etkinlik Turleri: bugunku 5 tur, kodda duran sablonlariyla.
  insert into nodes (name, node_type, key, shape, sort_order)
    values ('Etkinlik Türleri', 'operational', 'event_types', 'list', 1) returning id into types;
  create temp table kind_map (kind text primary key, option_id uuid not null) on commit drop;
  for k in
    select * from (values
      (0, 'meeting',    'Toplantı',      array['otf'],
        array['Gündem toplandı|-10', 'OTF gönderildi|-7', 'Davet gönderildi|-7']),
      (1, 'training',   'Eğitim',        array['otf','supplies'],
        array['Eğitmen kesinleşti|-21', 'Mekan ayarlandı|-14', 'OTF gönderildi|-7', 'Malzeme hazır|-7']),
      (2, 'social',     'Sosyal',        array['otf'],
        array['Bütçe onayı|-21', 'Mekan ayarlandı|-14', 'OTF gönderildi|-7', 'Duyuru|-7']),
      (3, 'visit',      'Saha ziyareti', array[]::text[],
        array['Ziyaret onayı|-21', 'Ulaşım ayarlandı|-7']),
      (4, 'conference', 'Konferans',     array['supplies'],
        array['Başvuru|-45', 'Stand kesinleşti|-30', 'Tanıtım|-10', 'Malzeme hazır|-7'])
    ) as t(pos, kind, label, widget_list, checkpoint_list)
  loop
    insert into nodes (parent_id, name, node_type, shape, sort_order)
      values (types, k.label, 'option', 'list', k.pos) returning id into opt;
    insert into kind_map values (k.kind, opt);
    -- Slotlar: kod onlari adla degil attrs.slot ile tanir (ad degistirilebilir).
    insert into nodes (parent_id, name, node_type, shape, attrs, sort_order)
      values (opt, 'Adımlar', 'operational', 'list', '{"slot":"steps"}', 0) returning id into steps;
    insert into nodes (parent_id, name, node_type, shape, attrs, sort_order)
      values (opt, 'Widget''lar', 'operational', 'list', '{"slot":"widgets"}', 1) returning id into widgets;
    for i in 1 .. coalesce(array_length(k.checkpoint_list, 1), 0) loop
      insert into nodes (parent_id, name, node_type, shape, attrs, sort_order)
        values (steps, split_part(k.checkpoint_list[i], '|', 1), 'checkpoint', 'leaf',
                jsonb_build_object('offset_days', split_part(k.checkpoint_list[i], '|', 2)::int), i - 1);
    end loop;
    for i in 1 .. coalesce(array_length(k.widget_list, 1), 0) loop
      insert into nodes (parent_id, name, node_type, shape, attrs, sort_order)
        values (widgets, case k.widget_list[i] when 'otf' then 'Etkinlik talep formu (OTF)'
                                               when 'supplies' then 'Satın alımlar' end,
                'widget', 'leaf', jsonb_build_object('widget', k.widget_list[i]), i - 1);
    end loop;
  end loop;

  -- events.kind (metin) -> events.kind_id (option dugumu)
  alter table events add column kind_id uuid references nodes(id) on delete restrict;
  update events e set kind_id = m.option_id from kind_map m where m.kind = e.kind;
  alter table events alter column kind_id set not null;
  alter table events drop column kind;
  create index on events(kind_id);

  -- 3. Etkinlik Yerleri: duz liste, mevcut etkinlik yerlerinden tohumlanir;
  -- metin `place` kampus disi / tek seferlik yer icin yedek olarak kalir.
  insert into nodes (name, node_type, key, shape, sort_order)
    values ('Etkinlik Yerleri', 'operational', 'event_locations', 'list', 2) returning id into places;
  insert into nodes (parent_id, name, node_type, shape, sort_order)
    select places, p, 'location', 'leaf', (row_number() over (order by p))::int - 1
      from (select distinct trim(place) as p from events where nullif(trim(place), '') is not null) s;
  alter table events add column location_id uuid references nodes(id) on delete restrict;
  update events e set location_id = n.id
    from nodes n where n.parent_id = places and n.name = trim(e.place);
  update events set place = null where location_id is not null;
end $$;

-- Kok = key'i olan dugum; key yalniz kokte.
alter table nodes add constraint nodes_root_has_key check ((parent_id is null) = (key is not null));

-- Shape tetikleyicisi (API'ye ek; el yazisi SQL ve importa karsi).
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

-- Seciciler: kisi basina favori dugumler (kayit sabitlemeleri gibi).
create table node_favorites (
  user_id    uuid not null references users(id) on delete cascade,
  node_id    uuid not null references nodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, node_id)
);

insert into scopes (name) values ('manage_event_types'), ('manage_event_locations')
on conflict (name) do nothing;
