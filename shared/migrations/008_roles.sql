-- Roller: bir scope demeti (TODO.md "Yetki kapsamlari ve roller (Discord modeli)",
-- spec/71-yonetim-paneli.md §5).
--
-- Flatten YOK: rol tutmak != rolun scope'larina sahip olmak. Yetki kontrolu
-- (shared/scope.py active_scopes) user_scopes ile user_roles ⋈ role_scopes'un
-- BIRLESIMINI okuma aninda hesaplar. user_roles tek basina hicbir zaman
-- okunmaz — her zaman role_scopes ile join edilir.
--
-- scope kataloğu KOD tarafli liste (shared/scope.py SCOPES), bu tablo onun
-- veritabanindaki izi: FK'lerin dayanacagi bir yer, calisma aninda degismez.
create table if not exists scopes (
  name       text primary key,
  created_at timestamptz not null default now()
);

create table if not exists roles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null
);

create table if not exists role_scopes (
  role_id uuid not null references roles(id) on delete cascade,
  scope   text not null references scopes(name) on delete restrict,
  primary key (role_id, scope)
);

create table if not exists user_roles (
  user_id    uuid not null references users(id) on delete cascade,
  role_id    uuid not null references roles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references users(id) on delete set null,
  primary key (user_id, role_id)
);

create index if not exists user_roles_user_idx on user_roles(user_id);

-- user_scopes (goc 007) artik sadece katalogdaki adlari kabul eder — yonetim
-- panelinde yazim hatasi sessizce yetki vermesin (goc 007'nin zaten dedigi
-- kural, burada veritabani seviyesinde de uygulaniyor).
--
-- NOT: bu FK rol-kaynakli scope'lari KAPSAMAZ (rolden gelen scope bu tabloda
-- satir birakmaz) — o yuzden edit_nodes gibi dugum-bagimli kapsamlarin dal
-- kontrolu FK ile degil shared/scope.py'de kod seviyesinde yapiliyor
-- (authorized_on_node), spec/71-yonetim-paneli.md §5 madde 2.
alter table user_scopes
  add constraint user_scopes_scope_fk
  foreign key (scope) references scopes(name) on delete restrict;

insert into scopes (name) values
  ('edit_nodes'),
  ('manage_users'),
  ('manage_teams')
on conflict (name) do nothing;

-- security_events.event_type CHECK genisletiliyor: rol/scope denetim izi
-- icin (spec/71-yonetim-paneli.md §5 "Audit"). Kisit adi 001_schema.sql'de
-- otomatik uretildi; ayni idempotent oruntu (003, 007): once dusur, sonra
-- genis haliyle geri koy.
alter table security_events drop constraint if exists security_events_event_type_check;
alter table security_events add constraint security_events_event_type_check
  check (event_type in
         ('login','login_denied','logout','permission_denied','deactivation',
          'scope_granted','scope_revoked','role_granted','role_revoked',
          'role_created','role_deleted','admin_granted','admin_revoked'));
