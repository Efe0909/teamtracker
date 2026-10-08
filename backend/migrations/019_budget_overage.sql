-- Butce ve asim (spec/73 §5). Kalem basina tek butce tutari; asim ham degerle saklanir,
-- kademe ($, $$, $$$) saklanmaz: esik degisince veri yeniden yazilmaz.

alter table materials
  add column budget      numeric(12,2) check (budget is null or budget > 0),
  add column overage_ln  double precision;

-- Teklif ismi: telefon icin kisi/firma adi. Baglanti (link) icin bos kalir.
alter table material_providers
  add column name text check (name is null or char_length(name) between 1 and 200);

-- Kademe esigi zamanli: her degisiklik yeni satir, eski satir silinmez. Bir kalemin
-- asimi, kendi `updated_at` zamanindaki satirla (effective_from <= zaman) gosterilir.
-- yellow_max_ln: $$ ust siniri, ln(oran). Ilk deger ln(sqrt(2)) ≈ 0.347 (%41 asim).
create table overage_base (
  effective_from  timestamptz primary key default now(),
  yellow_max_ln   double precision not null check (yellow_max_ln > 0),
  note            text
);
insert into overage_base (yellow_max_ln, note)
values (0.5 * ln(2.0), 'ilk taban: $$ ust siniri sqrt(2) orani');

-- Butce yazmak ayri yetki: tedarik (`manage_purchases`) butce degistirmeye yetmez.
insert into scopes (name) values ('manage_budgets') on conflict (name) do nothing;
