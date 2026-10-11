-- OTF kazanimlari: Etkinlik Kazanimlari listesinden secilenler (n:m). Serbest
-- metin `event_otf.outcomes`'ta kalir; Word uretilirken ikisi birlestirilir
-- (once secilen kazanim adlari, sonra serbest metin).
--
-- Kazanim dugumu silinmek istenirse FK `node_in_use` doner (etkinlik turu ve
-- yeri gibi); emekliye ayirmak pasifleştirmektir, eski formlar gostermeye devam eder.
create table event_otf_outcomes (
  event_id   uuid not null references events(id) on delete cascade,
  outcome_id uuid not null references nodes(id) on delete restrict,
  primary key (event_id, outcome_id)
);
create index on event_otf_outcomes (outcome_id);
