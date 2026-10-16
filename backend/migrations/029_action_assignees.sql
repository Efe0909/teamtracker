-- Eyleme birden fazla kisi atanir (spec/75 K1 degismez: her atanan kayda
-- katilimci olur, uygulama atamada ekler). `actions.owner_id` tek kisiydi;
-- coktan-coga tabloya tasinir ve sutun kalkar (cift kaynak olmasin).
create table action_assignees (
  action_id uuid not null references actions(id) on delete cascade,
  user_id   uuid not null references users(id) on delete cascade,
  added_by  uuid references users(id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (action_id, user_id)
);
create index on action_assignees (user_id);

insert into action_assignees (action_id, user_id)
select id, owner_id from actions where owner_id is not null;

alter table actions drop column owner_id;
