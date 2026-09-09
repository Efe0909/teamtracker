-- Web push abonelikleri (spec/20-sema.md §7, spec/40-push.md).
--
-- Bir kullanicinin BIRDEN FAZLA aboneligi olur (telefon + dizustu); tekillik
-- kullanicida degil, endpoint'te. Ayni tarayici yeniden abone olursa push
-- servisi ayni endpoint'i verir, o yuzden ekleme upsert olarak yazilir.
--
-- fail_count / last_ok_at olu abonelik temizligi icin: push servisi 404/410
-- donerse satir SILINIR, baska hatada sayac artar, esigi gecince silinir.
-- Bu adim atlanirsa sunucu olu adreslere gonderim yapmaya devam eder
-- (spec/40-push.md bunu "en sik atlanan sey" diye isaretliyor).

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fail_count  int not null default 0
);

-- "Bu kullaniciya gonder" en sik sorgu.
create index if not exists push_user_idx on push_subscriptions(user_id);
