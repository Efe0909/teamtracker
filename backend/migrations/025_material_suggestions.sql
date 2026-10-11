-- Malzeme onerileri kaydi (spec/79 §9.1): her model onerisi bir satir, karar (kabul/ret)
-- ve kabulde dogan kalem. Amac zamanla olcmek: hangi oneri kabul ediliyor, model
-- onermese de elle ne ekleniyor, benzer etkinliklerde ne tekrar tekrar aliniyor.
--
-- Satin alindi durumu BURADA TUTULMAZ: `material_id` uzerinden `materials.purchased`
-- (ve `state`, `delivered`) okunur; tek kaynak kalir. Model, maliyet, sure `batch_id`
-- ile `llm_calls.batch_id`'den gelir (o satirlar 180 gunde silinir, bu tablo kalir).

create table material_suggestions (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  batch_id    uuid not null,
  name        text not null check (char_length(name) between 1 and 200),
  description text not null default '',
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  -- Kabulde dogan kalem; kalem silinirse bag kalkar, "kabul edildi" kalir.
  material_id uuid unique references materials(id) on delete set null,
  decided_by  uuid references users(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  check (material_id is null or status = 'accepted')
);
create index on material_suggestions(event_id);
create index on material_suggestions(batch_id);

-- Kalem nereden geldi. Var olan satirlar NULL (izleme oncesi, bilinmiyor); yeni satirlar
-- varsayilan 'manual', yalniz oneri kabulu 'ai' yazar.
alter table materials add column origin text check (origin in ('manual', 'ai'));
alter table materials alter column origin set default 'manual';
