-- Profil alanlari (kisi kendi girer) ve takim/pillar banner fotografi.
-- Gorseller `attachments`ta durur (yukleme hatti media.rs); burada yalniz kimlik.
alter table users
  add column nickname      text,
  add column phone         text,
  add column birth_day     smallint check (birth_day between 1 and 31),
  add column birth_month   smallint check (birth_month between 1 and 12),
  add column birth_year    smallint check (birth_year between 1900 and 2100),
  add column avatar_id     uuid references attachments(id) on delete set null;

-- Pillar'in banner'i OZEL takiminin banner'idir (pillars.team_id).
alter table teams
  add column banner_id uuid references attachments(id) on delete set null;
