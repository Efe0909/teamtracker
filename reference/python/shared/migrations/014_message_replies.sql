-- Mesaja yanit: alintili cevap (WhatsApp/Telegram kalibi).
--
-- Ilk uygulama YANLISTI: "yanitla" dugmesi govdeye `@ad ` yaziyordu, yani
-- anmanin kisayoluydu. Kullanicinin istedigi o degil — yanitlanan mesajin
-- KENDISI yeni balonun icinde alinti olarak gorunmeli, kime cevap verildigi
-- metinden degil yapidan okunmali.
--
-- Bu yuzden anmadan (KNOW-263) AYRI bir sey: anma "kime haber gitsin", yanit
-- "hangi mesaja cevap". Ikisi ayni mesajda birlikte de olabilir.

-- Kendine FK: yanit da bir events satiri, yanitladigi da.
--
-- on delete set null: bugun events satiri SILINMIYOR (ek silinse bile olay
-- kaliyor, mezar tasi ciziliyor) ama ileride arsivleme gelirse alinti
-- yanitin kendisini goturmesin — balon "silinmis mesaj" diye cizilir.
alter table events add column if not exists reply_to_id uuid
  references events(id) on delete set null;

-- Alinti cozumlemesi akisin TAMAMI icin tek sorguda yapiliyor (feed_of zaten
-- konunun butun olaylarini cekiyor), ama tek balon yeniden cizilirken
-- (event_message) bu indeks uzerinden gidiliyor.
create index if not exists events_reply_idx on events(reply_to_id)
  where reply_to_id is not null;
