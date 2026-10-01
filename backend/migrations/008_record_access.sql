-- Kayit erisim kipi:
--   public  : herkes gorur (salt okunur), tek tikla katilir
--   request : herkes gorur (salt okunur), katilmak icin sorumlunun onayi gerekir
--   private : yalniz uyeler sohbeti, kartlari, eylemleri ve katilimcilari gorur;
--             kayit satiri (baslik, aciklama, durum...) herkese acik kalir
alter table records
  add column access_mode text not null default 'public'
    check (access_mode in ('public','request','private'));

-- Bekleyen / reddedilen katilma istekleri. Onaylaninca satir silinir ve kisi
-- record_participants'a eklenir.
create table record_join_requests (
  record_id  uuid not null references records(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','denied')),
  created_at timestamptz not null default now(),
  decided_by uuid references users(id) on delete set null,
  primary key (record_id, user_id)
);
