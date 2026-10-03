-- spec/75 K1: eylemin sorumlusu kayda katilimci olur. Uygulama bunu atamada
-- yapiyor (records.rs `add_action_owner`); bu goc eski satirlari esitler.
-- Pasif kullanici da eklenir: zararsiz, hesap acilirsa iliski dogru olur.
insert into record_participants (record_id, user_id, added_by)
select distinct record_id, owner_id, null::uuid from actions where owner_id is not null
on conflict do nothing;
