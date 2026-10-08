-- Satin alimlar v2 (spec/73 §5). Kalemler etkinlikten BAGIMSIZ: ileride maliye
-- sayfasi dogrudan `materials`'ta arar ve toplar; etkinlik yalniz bir baglamdir.
-- Etkinlik silinince bag gider, kalem kalir (maliye gecmisi bozulmasin).

create table event_materials (
  material_id uuid primary key references materials(id) on delete cascade,
  event_id    uuid not null references events(id) on delete cascade
);
create index on event_materials(event_id);
insert into event_materials (material_id, event_id) select id, event_id from materials;
alter table materials drop column event_id;

-- Sponsor artik surec adimi degil, ayri bir ISTEK: `state` 0..3. Eski 4 adimli
-- sponsorlu satirlar tasinir (onay 4 -> 3, "sponsor tamam, onay yok" 3 -> 2).
-- "Zaten var" kalem sponsordan istenmez.
update materials set has_sponsor = false where owned;
update materials set state = case state when 4 then 3 when 3 then 2 else state end where has_sponsor;
alter table materials drop constraint materials_check;
alter table materials add check (state between 0 and 3);

-- Teklif secimi tek yerde: ya bir tedarikci ya sponsor. Bileske FK secilen teklifin
-- AYNI malzemeye ait olmasini zorlar; teklif silinirse secim kalkar.
alter table material_providers add unique (id, material_id);

alter table materials
  add column qty                 integer not null default 1 check (qty >= 1),
  add column chosen_provider_id  uuid,
  add column sponsor_chosen      boolean not null default false,
  add column sponsor_qty         integer check (sponsor_qty >= 1),
  add column sponsor_date        date,
  add column in_sponsor_record   boolean not null default false,
  -- Teslim alindi: sutun degil, detaydaki isaret; yalniz onayli kalem teslim edilir.
  add column delivered           boolean not null default false,
  add column created_by          uuid references users(id) on delete set null,
  -- Yalniz maliye incelemesiyle (`review_purchases`) yazilir; widget'taki onay
  -- (state = 3) satin alindi DEMEK DEGIL.
  add column purchased           boolean not null default false,
  add column purchased_at        timestamptz,
  add column purchased_by        uuid references users(id) on delete set null,
  add foreign key (chosen_provider_id, id) references material_providers(id, material_id)
    on delete set null (chosen_provider_id),
  add check (not (sponsor_chosen and chosen_provider_id is not null)),
  add check (has_sponsor or (not sponsor_chosen and sponsor_qty is null
                             and sponsor_date is null and not in_sponsor_record)),
  add check (not (owned and has_sponsor)),
  add check (not purchased or (state = 3 and not owned)),
  add check (not delivered or (state = 3 and not owned)),
  add check (purchased = (purchased_at is not null));

-- Etkinlik basina tek sponsorluk kaydi; kayit silinirse bag kalkar.
alter table events add column sponsor_record_id uuid references records(id) on delete set null;

insert into scopes (name) values ('review_purchases') on conflict (name) do nothing;
