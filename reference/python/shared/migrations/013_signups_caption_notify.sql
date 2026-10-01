-- Kart katilimi, ek aciklamasi ve bildirim tercihi.
--
-- Uc ayri ihtiyac tek dosyada, 012'deki gerekceyle: hicbiri digerini
-- beklemiyor ve hepsi ayni turda istendi. Bolunseydi uc dosya adi donardi
-- (CLAUDE.md "goc dosya adlari artik donuk") ve hicbir sey kazandirmazdi.

-- --- 1. kart katilimi (card_signups) -------------------------------------
--
-- IKI ozellik, TEK tablo: "toplantiya kim geliyor" ile "havuza kim yazildi"
-- ayni sorunun iki adi — bir karta bagli, kisi basina bir cevap. Ayri iki
-- tablo acmak ayni sorguyu, ayni ucu ve ayni serit sablonunu iki kez yazmak
-- olurdu; tur ayrimi zaten item_cards.card_type'ta duruyor.
--
-- answer kart turune gore okunur (shared/cards.py SIGNUP):
--   meeting -> yes/maybe/no = katiliyorum / belki / katilamiyorum
--   pool    -> yes          = bu isi aliyorum  (maybe/no anlamsiz, UI cizmez)
--
-- Tekil anahtar (card_id,user_id): "fikrimi degistirdim" UPSERT'tir, ikinci
-- satir degil — yoksa akista iki cevap gorunur, hangisi gecerli belirsiz olur.
create table if not exists card_signups (
  card_id   uuid not null references item_cards(id) on delete cascade,
  user_id   uuid not null references users(id) on delete cascade,
  answer    text not null check (answer in ('yes','maybe','no')),
  note      text,
  signed_at timestamptz not null default now(),
  primary key (card_id, user_id)
);

-- --- 2. havuz karti ------------------------------------------------------
--
-- "Kim alacak" karti: is yazilir, isteyen uzerine alir. Eylem seridinden
-- FARKLI — eylem atanir (yukaridan asagi), havuz alinir (asagidan yukari).
alter table item_cards drop constraint if exists item_cards_card_type_check;
alter table item_cards add constraint item_cards_card_type_check
  check (card_type in ('media','meeting','pool'));

-- --- 3. ek aciklamasi ----------------------------------------------------
--
-- Etiket (010) "bu ne hakkinda", aciklama "bu neyi gosteriyor". Etiketler
-- sozlukten gelir ve aranir; aciklama serbest metindir ve yalniz o eke aittir
-- — biri digerinin yerine gecmiyor.
alter table attachments add column if not exists caption text;

-- --- 4. varsayilan bildirim tercihi --------------------------------------
--
-- Sutun, ayri tablo DEGIL: kisi basina TEK deger ve her push kararinda
-- okunuyor. Ayri tabloya konsaydi her bildirimde bir join daha olurdu ve
-- satiri olmayan kullanici icin "varsayilan ne" sorusu koda kacardi.
--
-- Kademeler push.send()'de uygulanir (tek kapi):
--   all      -> her bildirim
--   mentions -> yalnizca anildiginda  (varsayilan degil: bugunku davranis 'all')
--   none     -> hicbiri (abonelik durur, gonderim durur)
alter table users add column if not exists notify_level text not null default 'all';
alter table users drop constraint if exists users_notify_level_check;
alter table users add constraint users_notify_level_check
  check (notify_level in ('all','mentions','none'));
