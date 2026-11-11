-- Görev ve etkinlik silme (kalıcı, cascade): tek kapsam `delete_records`.
insert into scopes (name) values ('delete_records') on conflict (name) do nothing;

-- Etkinlik silinince sohbeti (mesajlar, ekler) arkada kalmasın: takım ve kayıtla aynı kalıp.
create trigger events_chat_gc after delete on events
  for each row execute function drop_chat();
