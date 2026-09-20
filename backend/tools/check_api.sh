#!/bin/bash
# tests/test_api.py'nin iddialarini KOSAN Rust sunucusuna karsi dogrular.
#
# Python testleri TestClient ile app nesnesine baglaniyor; Rust tarafinda
# karsiligi HTTP. Sozlesme AYNI: ayni yollar, ayni kodlar, ayni metinler.
# Yollar v2 adlandirmasiyla (/record/... , /tasks/...).
#
# Kullanim:  sunucuyu kaldir, sonra  tools/check_api.sh
B=http://localhost:8099
DB(){ docker exec ekiptakip-db psql -U ekiptakip -d ekiptakip_rust -t -A -c "$1"; }
P=0; F=0; CUR=""
t(){ CUR="$1"; }
ok(){ [ "$1" = "$2" ] && P=$((P+1)) || { F=$((F+1)); printf '  \033[31mHATA\033[0m %-42s %-22s bekle=%s gercek=%s\n' "$CUR" "$3" "$2" "$1"; }; }
has(){ curl -s "$@" | grep -qF "$TXT" && echo VAR || echo YOK; }
sess(){ rm -f /tmp/c; curl -s -c /tmp/c ${1:+-b "uid=$1"} -o /tmp/pg.html "$B/"; TOK=$(grep -oE 'X-CSRF-Token": "[^"]+' /tmp/pg.html|head -1|sed 's/.*: "//'); ASU="$1"; }
w(){ curl -s -b /tmp/c ${ASU:+-b "uid=$ASU"} -H "X-CSRF-Token: $TOK" -o /dev/null -w '%{http_code}' "$@"; }
g(){ curl -s ${ASU:+-b "uid=$ASU"} "$@"; }

EFE=$(DB "select id from users where name='Efe'"); SELIN=$(DB "select id from users where name='Selin'"); DENIZ=$(DB "select id from users where name='Deniz'")
BUTCE=$(DB "select id from records where title like 'Bütçe%'"); KAPAK=$(DB "select id from records where title like 'Kapak%'")
VEK=$(DB "select id from records where title like 'Onay akışına%'"); TEKLIF=$(DB "select id from records where title like 'Tedarikçi tek%'")
SEV=$(DB "select id from records where title like 'Sevkiyat%'"); MALZ=$(DB "select id from nodes where name='Malzeme Temini'")
MALIYE=$(DB "select id from teams where name='Maliye'"); SN=$(DB "select id from nodes where node_type='pillar' limit 1")
GEN=$(DB "select id from nodes where node_type='generic' limit 1"); BONAY=$(DB "select id from nodes where name='Bütçe Onayı'")
sess ""

t home_lists_modules
H=$(g "$B/"); for x in "Görev Yöneticisi" "Veri Yönetimi" 'href="/tasks"' 'href="/outcome-tree"'; do ok "$(echo "$H"|grep -qF "$x" && echo V||echo Y)" V "$x"; done
ok "$(echo "$H"|grep -qF 'Bütçe onayı' && echo V||echo Y)" Y "tablo degil"
t module_stub_pages
for u in /pivot:200 /tasks2:404 /outcome-tree:200 /tasks:200; do ok "$(curl -s -o /dev/null -w '%{http_code}' "$B${u%:*}")" "${u##*:}" "${u%:*}"; done
ok "$(g "$B/tasks"|grep -qF 'Yakında' && echo V||echo Y)" Y "tasks iskele degil"
t tasks_lists_my_items
ok "$(g "$B/tasks"|grep -qF 'Bütçe onayı 6 gündür bekliyor' && echo V||echo Y)" V "kayit tabloda"
t table_fragment_on_htmx
FR=$(g -H "HX-Request: true" "$B/tasks"); ok "$(echo "$FR"|grep -qF '<html' && echo V||echo Y)" Y "tam sayfa degil"; ok "$(echo "$FR"|grep -qF 'data-fragment="table"' && echo V||echo Y)" V "parca"
t node_filter_includes_subtree
R=$(g "$B/tasks?node=$MALZ"); ok "$(echo "$R"|grep -qF 'Bütçe onayı' && echo V||echo Y)" V in; ok "$(echo "$R"|grep -qF 'Tedarikçi teklifleri' && echo V||echo Y)" V in2; ok "$(echo "$R"|grep -qF 'Kapak Ünitesi — tekrar eden kayıp' && echo V||echo Y)" Y out
t team_filter
R=$(g "$B/tasks?team=$MALIYE"); ok "$(echo "$R"|grep -qF 'Bütçe onayı' && echo V||echo Y)" V in; ok "$(echo "$R"|grep -qF 'Onay akışına' && echo V||echo Y)" V in2; ok "$(echo "$R"|grep -qF 'Sevkiyat tarihi' && echo V||echo Y)" Y out
t quick_filter_overdue_via_action
R=$(g "$B/tasks?quick=overdue"); ok "$(echo "$R"|grep -qF 'Bütçe onayı' && echo V||echo Y)" V in; ok "$(echo "$R"|grep -qF 'Kapak Ünitesi — tekrar eden kayıp' && echo V||echo Y)" Y out
t quick_filter_my_open_actions
R=$(curl -s -b "uid=$DENIZ" "$B/tasks?quick=my_actions"); ok "$(echo "$R"|grep -qF 'Bütçe onayı' && echo V||echo Y)" V in; ok "$(echo "$R"|grep -qF 'Tedarikçi teklifleri' && echo V||echo Y)" Y out
t bad_filter_values_fall_back
ok "$(g "$B/tasks?team=xx&sort=';drop--&quick=yok"|grep -qF 'Bütçe onayı' && echo V||echo Y)" V "suzmesiz doner"
t pillar_ortogonal_sutun
ok "$(g "$B/tasks"|grep -qF '>Pillar<' && echo V||echo Y)" V "pillar filtresi"
t whoami_and_switch
ok "$(g "$B/whoami"|python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])')" Efe varsayilan
sess ""; curl -s -b /tmp/c -c /tmp/c -H "X-CSRF-Token: $TOK" -o /dev/null -X POST "$B/switch/$SELIN"; ok "$(curl -s -b /tmp/c "$B/whoami"|python3 -c 'import sys,json;print(json.load(sys.stdin)["is_admin"])')" True "switch admin"
t item_redirects_to_task_page
PG=$(g "$B/tasks/$BUTCE"); ok "$(echo "$PG"|grep -qF 'data-fragment="card_feed"' && echo V||echo Y)" V feed; ok "$(echo "$PG"|grep -qF 'data-fragment="card_actions"' && echo V||echo Y)" V actions
t kompozerde_ek_iptali_var
ok "$(echo "$PG"|grep -qF 'data-role="attach-clear"' && echo V||echo Y)" V "ek iptali"
t alanlar_dropdown_DEGIL_dialog
S=$(echo "$PG"|sed -n '/id="fields"/,/data-fragment="card_actions"/p'); ok "$(echo "$S"|grep -qF '<select' && echo V||echo Y)" Y "select yok"; ok "$(echo "$S"|grep -qF 'data-dialog="dlg-f-who"' && echo V||echo Y)" V tetik; ok "$(echo "$S"|grep -qF 'id="dlg-f-who"' && echo V||echo Y)" V dialog
t sohbette_hizli_eylem_simsegi
ok "$(echo "$PG"|grep -qF 'class="simsek" data-dialog="dlg-hizli-eylem"' && echo V||echo Y)" V simsek
t message_appends_single_event
sess ""; B4=$(DB "select count(*) from messages m join records r on r.chat_id=m.chat_id where r.id='$BUTCE'")
MR=$(curl -s -b /tmp/c -H "X-CSRF-Token: $TOK" -d "body=test mesajı" -X POST "$B/record/$BUTCE/message")
AF=$(DB "select count(*) from messages m join records r on r.chat_id=m.chat_id where r.id='$BUTCE'"); ok "$((AF-B4))" 1 "+1 mesaj"
ok "$(echo "$MR"|grep -qF 'test mesajı' && echo V||echo Y)" V govde
t field_change_writes_system_event_and_oob
FR2=$(curl -s -b /tmp/c -H "X-CSRF-Token: $TOK" -X PATCH -d "status=in_progress" "$B/record/$BUTCE/field")
ok "$(echo "$FR2"|grep -qF 'hx-swap-oob="true"' && echo V||echo Y)" V oob
ok "$(DB "select status from records where id='$BUTCE'")" in_progress durum
ok "$(DB "select detail from activity where chat_id=(select chat_id from records where id='$BUTCE') order by created_at desc limit 1"|grep -qF 'Açık → Devam' && echo V||echo Y)" V "Açık → Devam"
t out_of_scope_is_403_not_just_hidden
sess "$EFE"; ok "$(w -X PATCH -d "status=closed" "$B/record/$KAPAK/field")" 403 patch; ok "$(w -X POST -d "body=x" "$B/record/$KAPAK/message")" 403 mesaj; ok "$(DB "select status from records where id='$KAPAK'")" pending degismedi
t admin_can_edit_anything
sess "$SELIN"; ok "$(w -X PATCH -d "priority=critical" "$B/record/$KAPAK/field")" 200 admin
t participant_beats_scope
sess "$DENIZ"; ok "$(w -X POST -d "body=dahilim" "$B/record/$BUTCE/message")" 200 katilimci; ok "$(w -X POST -d "body=x" "$B/record/$VEK/message")" 403 disarda
t team_membership_beats_scope
ok "$(w -X POST -d "body=takimdanim" "$B/record/$TEKLIF/message")" 200 "takim uyesi"
t action_endpoints_respect_card_permission
ok "$(w -X POST -d "title=x" "$B/record/$VEK/action")" 403 "eylem ekle 403"
t actions_crud_and_close_guard
sess ""; ok "$(w -X POST -d "title=Nakliye planını revize et&owner_id=$DENIZ" "$B/record/$SEV/action")" 200 ekle
ok "$(w -X PATCH -d "status=closed" "$B/record/$SEV/field")" 400 "acik eylemle kapanmaz"
for a in $(DB "select id from actions where record_id='$SEV' and status in ('open','in_progress')"); do ok "$(w -X PATCH -d "status=closed" "$B/action/$a")" 200 "eylem kapat"; done
ok "$(w -X PATCH -d "status=closed" "$B/record/$SEV/field")" 200 "sonra kapanir"
ok "$(DB "select count(*)>0 from activity where chat_id=(select chat_id from records where id='$SEV') and detail like '%eylem%'")" t "akista eylem"
t alan_degisimi_zaman_damgali
w -X PATCH -d "priority=low" "$B/record/$BUTCE/field" >/dev/null
ok "$(DB "select detail from activity where chat_id=(select chat_id from records where id='$BUTCE') order by created_at desc limit 1"|grep -qF 'önceliği' && echo V||echo Y)" V "önceliği"
t sorumlu_ve_takim_degisikligi
ok "$(w -X PATCH -d "owner_id=$DENIZ" "$B/record/$BUTCE/field")" 200 sorumlu
ok "$(DB "select owner_id from records where id='$BUTCE'")" "$DENIZ" yazildi
ok "$(w -X PATCH -d "team_id=$MALIYE" "$B/record/$BUTCE/field")" 200 takim
ok "$(w -X PATCH -d "owner_id=abc" "$B/record/$BUTCE/field")" 400 "bozuk 400"
ok "$(DB "select owner_id from records where id='$BUTCE'")" "$DENIZ" "bosaltmadi"
t pillar_karttan_secilir
ok "$(w -X PATCH -d "pillar_id=$SN" "$B/record/$BUTCE/field")" 200 "pillar yaz"
ok "$(DB "select pillar_id from records where id='$BUTCE'")" "$SN" yazildi
ok "$(w -X PATCH -d "pillar_id=$GEN" "$B/record/$BUTCE/field")" 400 "pillar olmayan"
t create_requires_node_and_scope
ok "$(w -X POST -d "title=yeni&unit_id=$BONAY" "$B/record")" 303 "kapsam ici"
ok "$(w -X POST -d "title=yeni&unit_id=$KAPAKN" "$B/record")" 400 "gecersiz"
sess "$EFE"; KUN=$(DB "select id from nodes where name='Kapak Ünitesi'"); ok "$(w -X POST -d "title=yeni&unit_id=$KUN" "$B/record")" 403 "kapsam disi"
ok "$(w -X POST -d "title=yeni&unit_id=yok" "$B/record")" 400 "gecersiz kimlik"
printf '\n  \033[32mgecen=%s\033[0m  kalan=%s\n' "$P" "$F"
