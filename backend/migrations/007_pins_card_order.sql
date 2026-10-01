-- Kisiye ozel: sabitlenen kayitlar (Panolar widget'i) ve kayit icindeki kart sirasi.
create table record_pins (
  user_id   uuid not null references users(id) on delete cascade,
  record_id uuid not null references records(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (user_id, record_id)
);

-- Kart sirasi kayit basina, kisi basina; listede olmayan kart sona gider.
create table card_order (
  user_id   uuid not null references users(id) on delete cascade,
  record_id uuid not null references records(id) on delete cascade,
  card_ids  uuid[] not null,
  primary key (user_id, record_id)
);
