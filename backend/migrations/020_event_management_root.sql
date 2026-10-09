-- Etkinlik Yonetimi koku: Etkinlik Turleri ve Etkinlik Yerleri onun altina
-- tasinir, yanina Etkinlik Kazanimlari eklenir (spec/74 §3b).
--
-- `key` artik yalniz kokte degil: kod bolumu (`event_types` ...) key ile
-- bulur, bolum kokun altinda durabilir. Kural: kok MUTLAKA key tasir
-- (kok = parent_id null); key'li dugum kok olmak zorunda degil.

alter table nodes drop constraint nodes_root_has_key;
alter table nodes add constraint nodes_root_has_key check (parent_id is not null or key is not null);

alter table nodes drop constraint nodes_node_type_check;
alter table nodes add constraint nodes_node_type_check check (node_type in
  ('cell','machine','task','step','operational','generic','option','checkpoint','widget','location','outcome'));

insert into scopes (name) values ('manage_event_outcomes') on conflict (name) do nothing;

do $$
declare
  mgmt uuid;
begin
  -- Kokler: Birimler (0), Etkinlik Yonetimi (1). Bolumler list: butun
  -- cocuklari operational (ayni tur), shape tetikleyicisi kabul eder.
  insert into nodes (name, node_type, key, shape, sort_order, description)
    values ('Etkinlik Yönetimi', 'operational', 'event_management', 'list', 1,
            'Etkinliklerin dayandığı referans veri: etkinlik türleri, yerler ve kazanımlar.')
    returning id into mgmt;

  update nodes set parent_id = mgmt, sort_order = 0 where key = 'event_types';
  update nodes set parent_id = mgmt, sort_order = 1 where key = 'event_locations';

  insert into nodes (parent_id, name, node_type, key, shape, sort_order, description)
    values (mgmt, 'Etkinlik Kazanımları', 'operational', 'event_outcomes', 'list', 2,
            'Bir etkinliğin ekibe ya da kulübe kazandırmayı hedeflediği somut sonuçlar. Her kazanımın ad''ı kısa, açıklaması ayırt edici olmalı.');
end $$;

-- Adi koddan belli dugumlerin adi sabit (spec/74 §4.2): sablon slotlari ve
-- widget'lar. Elle degistirilmis adlar kataloga dondurulur.
update nodes set name = case attrs->>'slot' when 'steps' then 'Adımlar' else 'Widget''lar' end
 where node_type = 'operational' and attrs->>'slot' in ('steps', 'widgets');
update nodes set name = case attrs->>'widget'
                          when 'otf' then 'Etkinlik talep formu (OTF)'
                          when 'supplies' then 'Satın alımlar'
                          else name end
 where node_type = 'widget';
