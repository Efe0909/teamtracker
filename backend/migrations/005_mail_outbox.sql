-- Giden posta kuyrugu. Gonderici (SMTP/HTTP API) henuz secilmedi: uygulama
-- yalniz kuyruga yazar ve gunluge dusurur; gonderici baglandiginda sent_at
-- bos olanlari tuketir. Davet gibi olaylar bu tabloya yazar, aga cikmaz.
create table mail_outbox (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  to_email   text not null,
  subject    text not null,
  body_html  text not null,
  body_text  text not null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  error      text
);
create index mail_outbox_pending_idx on mail_outbox (created_at) where sent_at is null;
