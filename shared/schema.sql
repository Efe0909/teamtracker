-- EkipTakip Faz 1 semasi (SQLite).
-- Tasinabilirlik kurallari (00-BASLA.md Karar 1):
--   id -> TEXT (uuid4().hex, Python'da uretilir)
--   zaman -> TEXT, ISO-8601 UTC ("2026-08-20T14:03:11Z"), Python'da uretilir
--   boolean -> INTEGER 0/1
--   jsonb/ltree/pencere fonksiyonu yok

pragma foreign_keys = on;

create table if not exists users (
  id            text primary key,
  -- collate nocase: 'Efe@x.com' ile 'efe@x.com' AYNI satirdir; yoksa ayni kisi
  -- icin iki kayit olusabilir ve davetli listesi eslesmesi kacar.
  email         text not null collate nocase unique,
  name          text not null,
  color         text,
  is_admin      integer not null default 0,
  is_editor     integer not null default 0,
  scope_node_id text,
  created_at    text not null,
  -- kimlik (spec/70-guvenlik.md §2.3)
  google_sub    text unique,               -- Google'in degismeyen kullanici kimligi
  is_active     integer not null default 1,-- 0 => giris yok VE varolan oturum aninda olur
  last_login_at text
);

-- Guvenlik olaylari: kim girdi, kim reddedildi, nerede 403 yedi.
-- Kart olaylari events'te; bunlar ayri tabloda cunku kayda degil SISTEME ait.
create table if not exists guvenlik_olaylari (
  id         text primary key,
  created_at text not null,
  tur        text not null check (tur in
             ('giris','giris_reddi','cikis','yetki_reddi','pasiflestirme')),
  actor_id   text references users(id) on delete set null,
  email      text,                          -- reddedilen girisde kullanici satiri yok
  ip         text,
  detay      text
);
create index if not exists guvenlik_zaman_idx on guvenlik_olaylari(created_at desc);
create index if not exists guvenlik_tur_idx on guvenlik_olaylari(tur, created_at desc);

create table if not exists nodes (
  id             text primary key,
  parent_id      text references nodes(id) on delete cascade,
  name           text not null,
  node_type      text not null,
  sort_order     integer not null default 0,
  pending_cr_id  text,
  pending_delete integer not null default 0,
  created_by     text references users(id),
  created_at     text not null
);
create index if not exists nodes_parent_idx on nodes(parent_id);

-- Takimlar (spec/20-sema.md §2a): nodes isin NEREDE oldugunu, teams KIMIN
-- sahiplendigini tutar. Kayit takima tanimlanir, eylem kisiye atanir.
create table if not exists teams (
  id          text primary key,
  name        text unique not null,
  description text,
  node_id     text references nodes(id) on delete set null,
  color       text,
  created_at  text not null
);

create table if not exists team_members (
  team_id  text not null references teams(id) on delete cascade,
  user_id  text not null references users(id) on delete cascade,
  role     text not null default 'uye' check (role in ('lider','mentor','uye')),
  added_at text not null,
  primary key (team_id, user_id)
);

create table if not exists items (
  id          text primary key,
  node_id     text not null references nodes(id) on delete cascade,
  kind        text not null check (kind in ('hata','gorev')),
  title       text not null,
  description text,
  status      text not null default 'acik'
              check (status in ('acik','devam','beklemede','kapandi')),
  priority    text not null default 'orta'
              check (priority in ('kritik','yuksek','orta','dusuk')),
  team_id     text references teams(id) on delete set null,
  assignee_id text references users(id) on delete set null,
  created_by  text not null references users(id),
  due_date    text,
  dms         text,
  pillar      text,
  escalated   integer not null default 0,
  created_at  text not null,
  updated_at  text not null
);
create index if not exists items_node_idx on items(node_id);
create index if not exists items_assignee_idx on items(assignee_id);

-- Eylemler (spec/20-sema.md §3a): kayit "ne oldu", eylem "kim ne yapacak".
-- Kayit acik eylemi varken kapanamaz (kontrol shared/service.py'de).
create table if not exists actions (
  id          text primary key,
  item_id     text not null references items(id) on delete cascade,
  title       text not null,
  assignee_id text references users(id) on delete set null,
  status      text not null default 'acik'
              check (status in ('acik','devam','kapandi','iptal')),
  due_date    text,
  created_by  text not null references users(id),
  resolved_by text references users(id),
  resolved_at text,
  created_at  text not null
);
create index if not exists actions_item_idx on actions(item_id);
create index if not exists actions_assignee_idx on actions(assignee_id);

create table if not exists item_participants (
  item_id  text not null references items(id) on delete cascade,
  user_id  text not null references users(id) on delete cascade,
  added_by text references users(id),
  added_at text not null,
  primary key (item_id, user_id)
);

-- subject_type 'team' = takim duvari (spec/20-sema.md §2a). Eski veritabanlarinda
-- CHECK hala iki degerli; ekipler ekrani gelirken tablo yeniden kurulacak.
create table if not exists events (
  id           text primary key,
  subject_type text not null check (subject_type in ('item','change_request','team')),
  subject_id   text not null,
  event_type   text not null check (event_type in ('mesaj','sistem')),
  author_id    text references users(id),
  body         text not null,
  created_at   text not null
);
create index if not exists events_subject_idx on events(subject_type, subject_id, created_at);

-- tam metin arama: FTS5 (00-BASLA.md Karar 4 — "LIKE '%kelime%' kullanma").
-- content='items' ile golge tablo tutulmaz, satirlar items'tan okunur.
create virtual table if not exists items_fts using fts5(
  title, description, content='items', content_rowid='rowid',
  tokenize="unicode61 remove_diacritics 2"          -- Türkçe: şğıöçü -> sgioçu katlanir
);

create trigger if not exists items_fts_ai after insert on items begin
  insert into items_fts(rowid, title, description) values (new.rowid, new.title, new.description);
end;
create trigger if not exists items_fts_ad after delete on items begin
  insert into items_fts(items_fts, rowid, title, description)
    values ('delete', old.rowid, old.title, old.description);
end;
create trigger if not exists items_fts_au after update on items begin
  insert into items_fts(items_fts, rowid, title, description)
    values ('delete', old.rowid, old.title, old.description);
  insert into items_fts(rowid, title, description) values (new.rowid, new.title, new.description);
end;
