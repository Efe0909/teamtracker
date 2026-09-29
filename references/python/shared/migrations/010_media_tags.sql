-- Etiketler: kullanicilarin ekleri isimlendirmesi (CONTRACT-V2.md §2).
--
-- Tekillik SLUG uzerinde kurulu, name uzerinde degil: name kullanicinin
-- yazdigi bicimi (buyuk/kucuk harf, aksan) oldugu gibi tasir, ekranda o
-- gosterilir; slug Python tarafinda unaccent-esdegeri katlama + kucultme +
-- bosluklarin '-' ile birlestirilmesiyle hesaplanir (shared/attachments.py,
-- baska bir ajanin alani). Turkce harfler burada onemli: 'İ'/'ı' Python'un
-- str.lower()'inin varsaydigi gibi katlanmiyor, o yuzden 'I', 'İ', 'ı', 'i'
-- acikca ele alinip test edilmeli — slug uretimi bu goc dosyasinda degil,
-- onu cagiran modulde.
create table if not exists tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,          -- ekranda görünen hâli, kullanıcı nasıl yazdıysa
  slug       text not null unique,   -- unaccent(lower(name)); tekillik BURADA
  color      text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists attachment_tags (
  attachment_id uuid not null references attachments(id) on delete cascade,
  tag_id        uuid not null references tags(id) on delete cascade,
  added_by      uuid references users(id) on delete set null,
  added_at      timestamptz not null default now(),
  primary key (attachment_id, tag_id)
);
create index if not exists attachment_tags_tag_idx on attachment_tags(tag_id);

-- Kapsam kataloguna kayit ZORUNLU: 008_roles.sql, user_scopes.scope'tan
-- scopes.name'e bir FK koydu (user_scopes_scope_fk). Kayitli olmayan bir
-- kapsam hicbir kullaniciya verilemez -- once burada, sonra shared/scope.py'de.
insert into scopes (name) values ('create_tags'), ('tag_media')
  on conflict (name) do nothing;
