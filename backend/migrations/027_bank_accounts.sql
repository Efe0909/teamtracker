-- Hesap numaralarim (spec/82 §4): fatura iadesinin gidecegi IBAN'lar, kisinin
-- kendi profilinde. Satir SILINMEZ: fatura bagi (spec/81) kalir, IBAN bosaltilir,
-- son dort hane gecmis iade kayitlarinda gorunsun diye tutulur.

create table bank_accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 60),
  holder_name text not null check (char_length(btrim(holder_name)) between 1 and 200),
  -- Bosluksuz, buyuk harf; mod-97 saglamasi API'de (api/bank_accounts.rs `iban`).
  iban        text check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  iban_last4  text not null check (iban_last4 ~ '^[A-Z0-9]{4}$'),
  is_default  boolean not null default false,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  check ((deleted_at is null) = (iban is not null)),
  check (not (is_default and deleted_at is not null))
);
create unique index bank_accounts_one_default on bank_accounts (user_id) where is_default;
create index bank_accounts_live on bank_accounts (user_id) where deleted_at is null;
