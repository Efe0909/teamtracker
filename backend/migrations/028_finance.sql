-- Maliye (spec/81): iki para. SEB parasi bakiyesiz, alacak olarak izlenir
-- (kalem -> fatura -> iade dosyasi); kulup kasasi bakiyeli, degismez defter.
-- Para her yerde numeric(12,2), kur numeric(12,6).
--
-- Yabanci anahtarlar dongusel (fatura -> dosya -> defter -> fatura): tablolar
-- once dongu disi anahtarlarla yaratilir, dongu sonda `alter table` ile kapanir.

insert into scopes (name) values ('manage_ledger') on conflict (name) do nothing;

-- Fatura ayrintisinda tam IBAN gosterimi denetim izine yazilir (spec/82 §4.3).
-- Liste kisitta olmazsa olay SESSIZCE duser (KNOW-383).
alter table security_events drop constraint security_events_event_type_check;
alter table security_events add constraint security_events_event_type_check
  check (event_type in ('login','login_denied','logout','permission_denied',
                        'deactivation','scope_granted','scope_revoked',
                        'role_granted','role_revoked','role_created',
                        'role_deleted','admin_granted','admin_revoked',
                        'quality_config_changed','quality_config_reset',
                        'llm_config_changed','llm_config_reset',
                        'llm_profile_changed','llm_task_changed',
                        'llm_prompt_changed','llm_limit_changed',
                        'llm_bodies_on','llm_bodies_off',
                        'iban_viewed'));

-- --- Maliye koku ve butce kategorileri (spec/81 §3.1, spec/74 kalibi) --------
alter table nodes drop constraint nodes_node_type_check;
alter table nodes add constraint nodes_node_type_check check (node_type in
  ('cell','machine','task','step','operational','generic','option','checkpoint','widget','location','outcome',
   'category'));

do $$
declare
  fin uuid;
  cats uuid;
begin
  insert into nodes (name, node_type, key, shape, sort_order, description, attrs)
    values ('Maliye', 'operational', 'finance', 'list', 2,
            'Maliye sayfasının dayandığı referans veri: bütçe kategorileri ve satın alım duvarının varsayılan tarih aralıkları.',
            '{"wall_ahead_days": 30, "wall_back_days": 30}'::jsonb)
    returning id into fin;
  insert into nodes (parent_id, name, node_type, key, shape, sort_order, description)
    values (fin, 'Bütçe Kategorileri', 'operational', 'budget_categories', 'list', 0,
            'Her kategori ya SEB bütçesinden (SEB iade eder) ya kulüp kasasından (genel) karşılanır.')
    returning id into cats;
  insert into nodes (parent_id, name, node_type, shape, sort_order, description, attrs) values
    (cats, 'Sponsorluk destekleri', 'category', 'leaf', 0, 'Sponsora yapılan geri dönüşler, stant ve baskılar.', '{"ledger": "seb"}'),
    (cats, 'Demirbaş', 'category', 'leaf', 1, 'Kulübün kalıcı eşyası: ses sistemi, masa, ekipman.', '{"ledger": "seb"}'),
    (cats, 'Promosyonel giderler', 'category', 'leaf', 2, 'Tişört, rozet, sticker gibi tanıtım malzemesi.', '{"ledger": "seb"}'),
    (cats, 'Etkinlik giderleri', 'category', 'leaf', 3, 'Kulüp kasasından karşılanan etkinlik harcamaları.', '{"ledger": "general"}'),
    (cats, 'Ofis ve sarf', 'category', 'leaf', 4, 'Kâğıt, toner, kırtasiye.', '{"ledger": "general"}');
end $$;

-- --- donemler (D-14: akademik takvim, elle) -----------------------------------
create table finance_periods (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 60),
  span daterange not null check (not isempty(span) and lower_inc(span) and not lower_inf(span) and not upper_inf(span)),
  exclude using gist (span with &&)
);

-- --- malzemeler (bagimsiz kalem: kategori + ne zamana lazim) ------------------
alter table materials
  add column category_id uuid references nodes(id) on delete restrict,
  add column needed_by   date;
create index on materials (category_id);

-- --- tedarikciler --------------------------------------------------------------
create table vendors (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(btrim(name)) between 1 and 200),
  name_key       text not null,
  contact        text check (char_length(contact) <= 200),
  phone          text check (char_length(phone) <= 30),
  email          text check (char_length(email) <= 200),
  url            text check (char_length(url) <= 500),
  issues_invoice boolean,
  note           text check (char_length(note) <= 2000),
  merged_into    uuid references vendors(id) on delete restrict,
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now(),
  check (merged_into is distinct from id)
);
create unique index vendors_live_key on vendors (name_key) where merged_into is null;
alter table material_providers add column vendor_id uuid references vendors(id) on delete set null;
create index on material_providers (vendor_id);

-- --- faturalar -----------------------------------------------------------------
create table invoices (
  id               uuid primary key default gen_random_uuid(),
  submitted_by     uuid not null references users(id) on delete restrict,
  purchased_on     date not null,
  currency         char(3) not null default 'TRY' check (currency ~ '^[A-Z]{3}$'),
  total            numeric(12,2) not null check (total > 0),
  fx_rate          numeric(12,6) check (fx_rate > 0),
  fx_on            date,
  fx_source        text check (fx_source in ('tcmb','manual')),
  total_try        numeric(12,2) not null generated always as (round(total * coalesce(fx_rate, 1), 2)) stored,
  paid_by          text not null check (paid_by in ('member','club')),
  payee_account_id uuid references bank_accounts(id) on delete restrict,
  vendor_id        uuid references vendors(id) on delete set null,
  note             text check (char_length(note) <= 2000),
  status           text not null default 'pending'
                     check (status in ('pending','changes_requested','approved','rejected','withdrawn','cancelled')),
  claim_id         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((currency = 'TRY') = (fx_rate is null)),
  check ((fx_rate is null) = (fx_on is null) and (fx_rate is null) = (fx_source is null)),
  check ((paid_by = 'member') = (payee_account_id is not null)),
  check (claim_id is null or status = 'approved')
);
create index on invoices (status, created_at);
create index on invoices (submitted_by, created_at);

create table invoice_items (
  invoice_id  uuid not null references invoices(id) on delete cascade,
  material_id uuid not null references materials(id) on delete restrict,
  amount      numeric(12,2) not null check (amount > 0),
  -- Onayda yazilir ve donar: kategori sonradan degisse de iade dosyasi bozulmaz.
  funding     text check (funding in ('seb','general')),
  primary key (invoice_id, material_id)
);
create index on invoice_items (material_id);

create table invoice_reviews (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  action     text not null check (action in ('submit','resubmit','approve','changes','reject','withdraw','cancel')),
  note       text check (char_length(note) <= 2000),
  by_user    uuid references users(id) on delete set null,
  at         timestamptz not null default now(),
  check (action not in ('changes','reject','cancel') or char_length(btrim(coalesce(note, ''))) > 0)
);
create index on invoice_reviews (invoice_id, at);

create table invoice_attachments (
  invoice_id    uuid not null references invoices(id) on delete cascade,
  attachment_id uuid not null unique references attachments(id) on delete restrict,
  primary key (invoice_id, attachment_id)
);

-- Toplam esitligi ISLEM SONUNDA (ertelenmis): kalem tutarlarinin toplami
-- faturanin toplamina esit ve en az bir kalem. Uygulama ayni kurali once
-- `invoice_split_mismatch` ile soyler; bu son savunma.
create function invoice_split_check() returns trigger language plpgsql as $$
declare
  inv uuid;
  t numeric;
  s numeric;
  n int;
begin
  if tg_table_name = 'invoices' then inv := new.id;
  elsif tg_op = 'DELETE' then inv := old.invoice_id;
  else inv := new.invoice_id;
  end if;
  select total into t from invoices where id = inv;
  if not found then return null; end if;
  select coalesce(sum(amount), 0), count(*) into s, n from invoice_items where invoice_id = inv;
  if n = 0 or s <> t then
    raise exception 'invoice_split_mismatch' using errcode = 'check_violation';
  end if;
  return null;
end $$;
create constraint trigger invoice_items_split after insert or update or delete on invoice_items
  deferrable initially deferred for each row execute function invoice_split_check();
create constraint trigger invoices_split after insert or update of total on invoices
  deferrable initially deferred for each row execute function invoice_split_check();

-- --- kasa defteri (degismez, D-13) ---------------------------------------------
create table ledger_entries (
  id            uuid primary key default gen_random_uuid(),
  occurred_on   date not null,
  amount        numeric(12,2) not null check (amount <> 0),
  kind          text not null check (kind in
                  ('income','expense','purchase','seb_refund','member_payout','reversal','opening')),
  description   text not null check (char_length(btrim(description)) between 1 and 300),
  category_id   uuid references nodes(id) on delete restrict,
  event_id      uuid references events(id) on delete set null,
  invoice_id    uuid references invoices(id) on delete restrict,
  payee_user_id uuid references users(id) on delete restrict,
  reverses_id   uuid unique references ledger_entries(id) on delete restrict,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  check ((kind = 'reversal') = (reverses_id is not null)),
  check ((kind = 'member_payout') = (payee_user_id is not null)),
  check (kind <> 'purchase' or invoice_id is not null),
  check (kind not in ('income','seb_refund') or amount > 0),
  check (kind not in ('expense','purchase','member_payout') or amount < 0)
);
create index on ledger_entries (occurred_on, created_at);
create unique index ledger_one_opening on ledger_entries ((true)) where kind = 'opening';

create function ledger_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'ledger_immutable' using errcode = 'restrict_violation';
end $$;
create trigger ledger_entries_immutable before update or delete on ledger_entries
  for each row execute function ledger_immutable();

-- Ters kayit: asil satirin tam tersi tutar; ters kaydin ters kaydi yok.
create function ledger_reversal_check() returns trigger language plpgsql as $$
declare
  a numeric;
  k text;
begin
  if new.kind <> 'reversal' then return new; end if;
  select amount, kind into a, k from ledger_entries where id = new.reverses_id;
  if not found or k = 'reversal' or new.amount <> -a then
    raise exception 'invalid_reversal' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger ledger_entries_reversal before insert on ledger_entries
  for each row execute function ledger_reversal_check();

create table ledger_attachments (
  entry_id      uuid not null references ledger_entries(id) on delete restrict,
  attachment_id uuid not null unique references attachments(id) on delete restrict,
  primary key (entry_id, attachment_id)
);

create table ledger_checks (
  id           uuid primary key default gen_random_uuid(),
  checked_on   date not null,
  bank_balance numeric(12,2) not null,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- --- SEB iade dosyalari ----------------------------------------------------------
create table reimbursement_claims (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('monthly','event')),
  month           date check (month = date_trunc('month', month)::date),
  event_id        uuid references events(id) on delete restrict,
  status          text not null default 'draft' check (status in ('draft','sent','office_approved','paid')),
  sent_at         timestamptz,
  approved_at     timestamptz,
  paid_at         timestamptz,
  received_amount numeric(12,2) check (received_amount >= 0),
  ledger_entry_id uuid unique references ledger_entries(id) on delete restrict,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  check ((kind = 'monthly') = (month is not null)),
  check ((kind = 'event') = (event_id is not null)),
  check ((status = 'paid') = (paid_at is not null and received_amount is not null)),
  check (status <> 'paid' or received_amount = 0 or ledger_entry_id is not null)
);
create unique index on reimbursement_claims (month) where kind = 'monthly';
create unique index on reimbursement_claims (event_id) where kind = 'event';

-- Donguyu kapat: fatura -> dosya.
alter table invoices add constraint invoices_claim_fk
  foreign key (claim_id) references reimbursement_claims(id) on delete set null;

-- --- tekrarlayan giderler, kur onbellegi, butce, sablonlar ------------------------
create table recurring_expenses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  amount      numeric(12,2) not null check (amount > 0),
  currency    char(3) not null default 'TRY' check (currency ~ '^[A-Z]{3}$'),
  every       text not null check (every in ('month','year')),
  next_on     date not null,
  category_id uuid references nodes(id) on delete restrict,
  is_active   boolean not null default true
);

create table fx_rates (
  day      date not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  rate     numeric(12,6) not null check (rate > 0),
  primary key (day, currency)
);

create table budget_lines (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references finance_periods(id) on delete cascade,
  category_id uuid not null references nodes(id) on delete restrict,
  event_id    uuid references events(id) on delete cascade,
  amount      numeric(12,2) not null check (amount >= 0),
  note        text check (char_length(note) <= 500),
  unique nulls not distinct (period_id, category_id, event_id)
);

create table mail_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(btrim(name)) between 1 and 120),
  format     text not null check (format in ('html','md')),
  body       text not null check (octet_length(body) between 1 and 262144),
  created_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
