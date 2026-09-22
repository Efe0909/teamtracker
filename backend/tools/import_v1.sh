#!/bin/bash
# TEK SEFERLIK: alpha-0.1 (v1 sema, Python) veritabanindan alpha-0.2'ye (v2)
# kimlik + agac verisini tasir. Is kayitlari TASINMAZ (kullanici karari,
# 2026-09-22): items/records, events, chats, messages, attachments, activity,
# security_events — v2 semasi onlari bastan kurdu, tasimak emege degmez.
#
# Tasinan: users, nodes, teams (her takima BOS bir chat acilir — v2'de
# teams.chat_id zorunlu), team_members, roles, role_scopes, user_roles,
# user_scopes, user_node_scopes, user_pins, push_subscriptions, tags.
# Dusen sutunlar: users.is_editor, users.scope_node_id (rol/scope modeli
# yerine gecti), nodes.pending_cr_id/pending_delete, tags.color.
#
# Iki adim, cunku iki surum ayni anda ayakta degil:
#   1) 0.1 ayaktayken (Docker Postgres) SQL dosyasi uret:
#        V1="sudo docker exec -i ekiptakip-db psql -U ekiptakip -d ekiptakip" \
#          backend/tools/import_v1.sh > v1.sql
#   2) 0.2'ye gecince tek islemde yukle, sonra servisi yeniden baslat
#      (agac indeksi acilista kurulur):
#        sudo -u ekiptakip psql -d ekiptakip -v ON_ERROR_STOP=1 -1 -f v1.sql
#        sudo systemctl restart ekiptakip
#
# v2'de kullanici varsa yukleme HICBIR SEY yazmadan durur: iki kez calismaz,
# dolu veritabaninin ustune yazmaz.
set -euo pipefail
: "${V1:?V1 = v1 veritabanina psql komutu}"

table() { # hedef_tablo "sutunlar" [kaynak_ifadesi]
  local t=$1 cols=$2 src=${3:-$1}
  echo "copy $t ($cols) from stdin with (format csv);"
  $V1 -v ON_ERROR_STOP=1 -q -c "copy (select $cols from $src) to stdout with (format csv)"
  echo '\.'
}

cat <<'EOF'
-- backend/tools/import_v1.sh uretti. psql -1 ile TEK islemde yukle.
\set ON_ERROR_STOP on
do $$ begin
  if exists (select 1 from users) then
    raise exception 'v2 veritabaninda kullanici var: ice aktarma bir kez yapilir';
  end if;
end $$;
EOF

table users "id, email, name, color, is_admin, google_sub, is_active, notify_level, last_login_at, last_seen_at, created_at"
table nodes "id, parent_id, name, node_type, description, sort_order, is_active, created_by, created_at"

# teams: v2'de her takimin sohbeti zorunlu. Gecici tabloya al, her satira bir
# chat uret (MATERIALIZED: gen_random_uuid iki yerde ayni deger olsun).
echo "create temp table v1_teams (id uuid, name text, description text, node_id uuid, color text, created_at timestamptz);"
table v1_teams "id, name, description, node_id, color, created_at" teams
cat <<'EOF'
with t as materialized (select *, gen_random_uuid() as chat_id from v1_teams),
     c as (insert into chats (id, created_at) select chat_id, created_at from t)
insert into teams (id, name, description, node_id, chat_id, color, created_at)
  select id, name, description, node_id, chat_id, color, created_at from t;
EOF

table team_members "team_id, user_id, role, added_at"
table roles "id, name, created_by, created_at"
table role_scopes "role_id, scope"
table user_roles "user_id, role_id, granted_by, granted_at"
table user_scopes "user_id, scope, granted_by, granted_at"
table user_node_scopes "user_id, node_id, granted_by, granted_at"
table user_pins "user_id, slug, pinned_at"
table push_subscriptions "id, user_id, endpoint, p256dh, auth, user_agent, last_ok_at, fail_count, created_at"
table tags "id, name, slug, created_by, created_at"

cat <<'EOF'
select 'users', count(*) from users union all select 'nodes', count(*) from nodes
union all select 'teams', count(*) from teams union all select 'team_members', count(*) from team_members
union all select 'roles', count(*) from roles union all select 'user_roles', count(*) from user_roles
union all select 'user_pins', count(*) from user_pins union all select 'push_subscriptions', count(*) from push_subscriptions
union all select 'tags', count(*) from tags;
EOF
