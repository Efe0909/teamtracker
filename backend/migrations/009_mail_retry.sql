-- Gonderici (Resend) icin yeniden deneme: gecici hatada us ustu bekleyerek tekrar,
-- kalici hatada (4xx) ya da 5 denemeden sonra vazgec (error dolu, sent_at bos kalir).
alter table mail_outbox
  add column attempts    integer not null default 0,
  add column next_try_at timestamptz not null default now();
drop index mail_outbox_pending_idx;
create index mail_outbox_pending_idx on mail_outbox (next_try_at) where sent_at is null and attempts < 5;
