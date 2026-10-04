alter table roles add column color text not null default '#5b8cff'
  check (color ~ '^#[0-9A-Fa-f]{6}$');

create table role_node_scopes (
  role_id    uuid not null references roles(id) on delete cascade,
  node_id    uuid not null references nodes(id) on delete cascade,
  granted_by uuid references users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (role_id, node_id)
);
