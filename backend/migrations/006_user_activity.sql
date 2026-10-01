-- Gunluk kullanim ozeti (Yonetim > Aktivite). Satir = kisi x gun.
--   requests : o gun kimlikli HTTP istegi sayisi
--   minutes  : istek atilan dakika sayisi (oturum suresinin yaklasigi)
-- Sunucu istekleri bellekte biriktirir, dakikada bir yazar (auth.rs).
create table user_activity (
  user_id  uuid not null references users(id) on delete cascade,
  day      date not null,
  requests integer not null default 0,
  minutes  integer not null default 0,
  primary key (user_id, day)
);
