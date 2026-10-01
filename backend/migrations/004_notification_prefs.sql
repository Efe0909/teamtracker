-- Bildirim tercihleri, iki katman (spec/20 §6'nin sadelesmisi):
--   1. varsayilan: users.notify_level (all | mentions | none) + sessiz saat
--   2. sohbet/kayit basina ozel secim (WhatsApp gibi): chat_prefs, varsa varsayilani ezer
-- Uygulama ici liste hala chat_feed'den turetilir; burada yalniz "kime, ne kadar".
alter table users
  add column quiet_start smallint check (quiet_start between 0 and 23),
  add column quiet_end   smallint check (quiet_end between 0 and 23),
  add column notifications_seen_at timestamptz not null default now();

create table chat_prefs (
  user_id uuid not null references users(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  mode    text not null check (mode in ('all','mentions','none')),
  primary key (user_id, chat_id)
);
-- Web push abonelikleri 001'de zaten var (push_subscriptions).
