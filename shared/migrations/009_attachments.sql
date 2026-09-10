-- Medya ekleri: karta/duvara asilan gorseller (spec/ ekler, sozlesme §2-3).
--
-- Bir event en fazla bir ek tasir bugun (rota/UI tek dosya gonderiyor) ama
-- semada COKLUK sinirlanmadi: event_id'ye birden fazla satir eklenebilir,
-- sadece bugunku uc bunu yapmiyor.
--
-- storage_key/thumb_key GORECELI yol ("2026/09/<uuid>.jpg") — mutlak yol ne
-- veritabaninda ne sablonda gorunur (shared/media.py path_of()).
create table if not exists attachments (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  uploader_id   uuid references users(id) on delete set null,
  mime          text not null
                check (mime in ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size     bigint not null check (byte_size > 0),
  width         integer,
  height        integer,
  original_name text,
  storage_key   text not null unique,
  thumb_key     text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid references users(id) on delete set null
);
create index if not exists attachments_event_idx on attachments(event_id);
