-- Etkinliğin ikiz kaydı kalktı: sohbet etkinliğin kendisine ait (teams.chat_id gibi).
-- Mevcut ikizin sohbeti (mesajlar + akış) etkinliğe taşınır; ikizin kendisi, eylemleri,
-- kartları ve ekleriyle birlikte SİLİNİR (Efe, karar: ikiz mekanizması tamamen gidiyor).

alter table events add column chat_id uuid unique references chats(id) on delete restrict;

-- Eski sohbet etkinliğe geçer; ikize boş yeni bir sohbet verilir ki `records.chat_id`
-- (not null unique) tutsun ve ikiz silinirken tetikleyici YALNIZ o boş sohbeti silsin.
create temp table _twin_swap on commit drop as
  select e.id as event_id, r.id as record_id, r.chat_id as old_chat, gen_random_uuid() as new_chat
    from events e join records r on r.id = e.record_id;
insert into chats (id) select new_chat from _twin_swap;
update records r set chat_id = s.new_chat from _twin_swap s where r.id = s.record_id;
update events e set chat_id = s.old_chat from _twin_swap s where e.id = s.event_id;
alter table events alter column chat_id set not null;

drop trigger events_record_id_frozen on events;
drop function events_record_id_frozen();
alter table events drop column record_id;

delete from records where id in (select record_id from _twin_swap);
