-- Kart bloklari, ortogonal pillar, modul pinleri ve son tarih kapsami.
--
-- Dort ayri ihtiyac tek dosyada: hicbiri digerini beklemiyor ve hepsi ayni
-- turda istendi. Bolunseydi dort dosya adi donardi (CLAUDE.md "goc dosya
-- adlari artik donuk") ve hicbir sey kazandirmazdi.

-- --- 1. pillar: ORTOGONAL boyut ------------------------------------------
--
-- items.pillar (serbest metin) goc 011'de dusuruldu — hic set edilmiyordu.
-- Geri gelen sey AYNI SEY DEGIL: pillar'in TANIMI agacta kalir
-- (node_type='pillar', tek kaynak), kayitla bagi bir FK ile kurulur.
--
-- Neden ortogonal: pillar kaydin ATASI olmak zorunda degil. "Butce Onayi"
-- kaydi hiyerarside Malzeme Temini altinda durur ama SN pillar'ina sayilir.
-- Agac "nerede", pillar "hangi cerceveye sayiliyor" sorusunun cevabi
-- (spec/72 §8'deki acik nokta).
--
-- on delete set null: pillar node'u silinirse kayit kalir, yalniz baglanti
-- kopar — gecmis kaybi yok (spec/72 §6).
alter table items add column if not exists pillar_node_id uuid
  references nodes(id) on delete set null;
create index if not exists items_pillar_idx on items(pillar_node_id)
  where pillar_node_id is not null;

-- --- 2. kart bloklari (item_cards) ---------------------------------------
--
-- Kayit govdesine yapistirilan yeniden kullanilabilir bloklar. Tur KODDA
-- (shared/cards.py CARD_TYPES) — NODE_TYPES ve SCOPES ile ayni kalip: tur
-- davranis tasir, kod adini bilmedigi bir seye davranis baglayamaz.
--
-- data jsonb: her turun kendi alanlari burada. AYRI TABLO ACILMADI cunku
-- turler arasindaki tek ortak sey kimlik ve sira; "toplanti" ile "medya"nin
-- ortak sutunu yok. Sorgulanacak bir alan cikarsa o zaman sutuna terfi eder.
create table if not exists item_cards (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references items(id) on delete cascade,
  card_type  text not null check (card_type in ('media','meeting')),
  title      text,
  data       jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index if not exists item_cards_item_idx on item_cards(item_id, sort_order, created_at);

-- Medya karti eklerini KENDI uzerinde tasir: owner_type='item' olsaydi ayni
-- karttaki iki medya blogu ayirt edilemezdi (owner_id ikisinde de kayit
-- kimligi olurdu). 009'un genis sahiplik tablosuna besinci tur:
--   card -> item_cards.id
alter table attachments drop constraint if exists attachments_owner_type_check;
alter table attachments add constraint attachments_owner_type_check
  check (owner_type in ('event','item','node','team','card'));

-- --- 3. modul pinleri (user_pins) ----------------------------------------
--
-- Ray bugun uc sabit baglanti tasiyor; MODULES'e eklenen ekran oraya girmiyor.
-- Hangi ekranin rayda duracagi KISIYE ait bir tercih, kuruluma degil.
-- slug FK DEGIL: modul listesi kodda (MODULES), veritabaninda bir tablosu yok.
create table if not exists user_pins (
  user_id   uuid not null references users(id) on delete cascade,
  slug      text not null,
  pinned_at timestamptz not null default now(),
  primary key (user_id, slug)
);

-- --- 4. takim projeksiyonu: node basina TEK takim ------------------------
--
-- spec/72 §5: teams bir node projeksiyonu. Bagi SIKILASTIRMIYORUZ (node_id
-- hala nullable) cunku tohumdaki ve bugun kurulu takimlarin node'u yok;
-- zorunlu kilmak onlari kirar. Ama bir node'a IKI takim asilmasi projeksiyon
-- fikrini bozar — kismi tekil indeks tam da onu engeller.
create unique index if not exists teams_node_uniq on teams(node_id)
  where node_id is not null;

-- --- 5. kapsam katalogu: edit_deadline -----------------------------------
--
-- 008_roles.sql'in user_scopes.scope -> scopes.name FK'si yuzunden ZORUNLU:
-- katalogda olmayan kapsam kimseye verilemez.
insert into scopes (name) values ('edit_deadline') on conflict (name) do nothing;
