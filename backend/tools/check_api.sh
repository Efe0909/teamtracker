#!/bin/bash
# JSON API sozlesmesi — KOSAN iki Rust surecine karsi (tools/vm_test.sh kaldirir):
#   B  = sahte kimlik (EKIPTAKIP_AUTH=sahte), tohumlu veritabani
#   BG = Google kipi (sahte istemci kimligiyle; Google'a gercekten gidilir)
#   PSQL = ayni veritabanina psql komutu
#
# Metin DEGIL alan karsilastirir: `{"error": "<kod>"}`, `user.name`, yonlendirme
# hedefi. Bu testler sinirin (spec/15-sinirlar.md) yazili halidir.
set -u
: "${B:?}" "${BG:?}" "${PSQL:?}"
P=0; F=0; CUR=""; J=$(mktemp -d); trap 'rm -rf "$J"' EXIT
t(){ CUR="$1"; }
ok(){ if [ "$1" = "$2" ]; then P=$((P+1)); else F=$((F+1)); printf '  \033[31mHATA\033[0m %-34s %-24s bekle=%s gercek=%s\n' "$CUR" "$3" "$2" "$1"; fi; }
DB(){ $PSQL -t -A -c "$1"; }
code(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }
loc(){ curl -s -o /dev/null -w '%{redirect_url}' "$@"; }

SELIN=$(DB "select id from users where name='Selin'")
DENIZ=$(DB "select id from users where name='Deniz'")

t me_anonymous
R=$(curl -s "$B/api/me")
ok "$(jq -r .user <<<"$R")" null "user"
ok "$(jq -r .auth <<<"$R")" fake "auth"
ok "$(jq -r .csrf <<<"$R")" null "csrf"
ok "$(jq -r '.dev_users|length' <<<"$R")" 3 "dev_users"

t no_html_anywhere
ok "$(code "$B/")" 404 "/"
ok "$(curl -s "$B/tasks" | jq -r .error)" not_found "eski HTML yolu"

t fake_mode_hides_google
ok "$(code "$B/api/auth/google?next=app")" 404 "google start"
ok "$(code "$B/api/auth/callback?code=x&state=y")" 404 "callback"

t dev_login
ok "$(code -c "$J/c" "$B/api/auth/dev-login?user_id=$SELIN")" 303 "status"
ok "$(loc "$B/api/auth/dev-login?user_id=$SELIN")" "$B/" "yonlendirme /"
R=$(curl -s -b "$J/c" "$B/api/me")
ok "$(jq -r .user.name <<<"$R")" Selin "user.name"
ok "$(jq -r .user.is_admin <<<"$R")" true "is_admin"
TOK=$(jq -r .csrf <<<"$R"); ok "${#TOK}" 64 "csrf uzunlugu"
ok "$(code "$B/api/auth/dev-login?user_id=nope")" 400 "gecersiz uuid"
ok "$(code "$B/api/auth/dev-login?user_id=00000000-0000-0000-0000-000000000000")" 404 "olmayan kullanici"

t csrf_gate
# R1-F02/G2: her CSRF reddi security_events'e mi yaziliyor — yalniz OTURUMLU
# olani (Python _reject kurali, spec/90). $J/c oturumu Selin'e ait.
SE0=$(DB "select count(*) from security_events where event_type='permission_denied'")
ok "$(code -b "$J/c" -X POST "$B/api/auth/logout")" 403 "tokensiz"
ok "$(curl -s -b "$J/c" -X POST -H "X-CSRF-Token: yanlis" "$B/api/auth/logout" | jq -r .error)" csrf "yanlis token"
ok "$(DB "select count(*) from security_events where event_type='permission_denied'")" "$((SE0+2))" "oturumlu csrf reddi iki kez yazildi"
ok "$(DB "select detail from security_events where event_type='permission_denied' order by created_at desc limit 1")" "csrf: /api/auth/logout" "detay csrf: on eki"
ok "$(code -X POST -H "X-CSRF-Token: $TOK" "$B/api/auth/logout")" 403 "cerezsiz"
ok "$(DB "select count(*) from security_events where event_type='permission_denied'")" "$((SE0+2))" "cerezsiz csrf reddi yazilmaz"

t tampered_cookie_is_anonymous
awk 'BEGIN{FS=OFS="\t"} $6=="ekiptakip"{$7="X" substr($7,2)} 1' "$J/c" > "$J/bad"
ok "$(curl -s -b "$J/bad" "$B/api/me" | jq -r .user)" null "imza bozuk"

t deactivation_is_immediate
DB "update users set is_active=false where id='$SELIN'" >/dev/null
ok "$(curl -s -b "$J/c" "$B/api/me" | jq -r .user)" null "kapatilan dustu"
ok "$(code "$B/api/auth/dev-login?user_id=$SELIN")" 404 "kapatilan giremez"
DB "update users set is_active=true where id='$SELIN'" >/dev/null

t logout
ok "$(code -b "$J/c" -c "$J/c" -X POST -H "X-CSRF-Token: $TOK" "$B/api/auth/logout")" 204 "status"
ok "$(curl -s -b "$J/c" "$B/api/me" | jq -r .user)" null "oturum kapandi"
ok "$(DB "select count(*) from security_events where event_type='logout' and actor_id='$SELIN'")" 1 "denetim izi"

t new_login_rotates_csrf
curl -s -c "$J/d" -o /dev/null "$B/api/auth/dev-login?user_id=$DENIZ"
T1=$(curl -s -b "$J/d" "$B/api/me" | jq -r .csrf)
curl -s -b "$J/d" -c "$J/d" -o /dev/null "$B/api/auth/dev-login?user_id=$DENIZ"
T2=$(curl -s -b "$J/d" "$B/api/me" | jq -r .csrf)
ok "$([ "$T1" != "$T2" ] && [ ${#T2} = 64 ] && echo V || echo Y)" V "token yenilendi"

# --- is uclari (kayit, eylem, sohbet, takim) ---------------------------------
# Selin admin; Deniz uye (Maliye, Satin Alim degil). Tohum: 5 kayit, 3 takim.
curl -s -c "$J/w" -o /dev/null "$B/api/auth/dev-login?user_id=$SELIN"
WT=$(curl -s -b "$J/w" "$B/api/me" | jq -r .csrf)
curl -s -c "$J/n" -o /dev/null "$B/api/auth/dev-login?user_id=$DENIZ"
NT=$(curl -s -b "$J/n" "$B/api/me" | jq -r .csrf)
g(){ curl -s -b "$J/$1" "$B$2"; }
w(){ curl -s -b "$J/$1" -X "$2" -H "X-CSRF-Token: $3" -H 'Content-Type: application/json' -d "$5" "$B$4"; }
wc_(){ curl -s -o /dev/null -w '%{http_code}' -b "$J/$1" -X "$2" -H "X-CSRF-Token: $3" -H 'Content-Type: application/json' -d "$5" "$B$4"; }
BUTCE=$(DB "select id from records where title like 'Bütçe onayı%'")
BCHAT=$(DB "select chat_id from records where id='$BUTCE'")
VEKALET=$(DB "select id from records where title like 'Onay akışına vekalet%'")
VCHAT=$(DB "select chat_id from records where id='$VEKALET'")
UNIT=$(DB "select unit_id from records where id='$BUTCE'")

t anonymous_is_401
ok "$(code "$B/api/meta")" 401 "meta"
ok "$(curl -s "$B/api/records" | jq -r .error)" unauthorized "records"

t meta
R=$(g w /api/meta)
ok "$(jq -r .me.id <<<"$R")" "$SELIN" "me.id"
ok "$(jq '.users|length' <<<"$R")" 3 "users"
ok "$(jq '.teams|length' <<<"$R")" 3 "teams"
ok "$(jq '[.nodes[]|select(.depth==0)]|length > 0' <<<"$R")" true "agac koku"
ok "$(jq '.users[0]|has("email")' <<<"$R")" false "e-posta sizmaz"

t records_list
ok "$(g w /api/records | jq length)" 5 "hepsi"
ok "$(g w '/api/records?status=uydurma&sort=x' | jq length)" 5 "gecersiz filtre duser"
ok "$(g w '/api/records?done=false' | jq length)" 5 "acik"
ok "$(g w "/api/records?search=b%C3%BCt%C3%A7e" | jq -r '.[0].id')" "$BUTCE" "tam metin"
ok "$(g w '/api/records?sort=priority' | jq -r '.[0].priority')" critical "oncelik sirasi"
ok "$(g w /api/records | jq -r "map(select(.id==\"$BUTCE\"))[0].open_actions")" 2 "acik eylem sayisi"

t record_detail
R=$(g w "/api/records/$BUTCE")
ok "$(jq -r .access.can_edit <<<"$R")" true "admin duzenler"
ok "$(jq '.actions|length' <<<"$R")" 2 "eylemler"
ok "$(jq -r .record.chat_id <<<"$R")" "$BCHAT" "chat_id"
ok "$(g w /api/records/bozuk | jq -r .error)" not_found "bozuk kimlik"
ok "$(code -b "$J/w" "$B/api/records/00000000-0000-0000-0000-000000000000")" 404 "olmayan"

t record_patch
ok "$(w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"status","value":"closed"}' | jq -r .error)" open_actions "acik eylemle kapanmaz"
ok "$(wc_ w PATCH "$WT" "/api/records/$BUTCE" '{"field":"status","value":"closed"}')" 409 "409"
ok "$(w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"status","value":"uydurma"}' | jq -r .error)" invalid_body "gecersiz deger"
ok "$(w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"sifre","value":"x"}' | jq -r .error)" invalid_body "bilinmeyen alan"
ok "$(w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"priority","value":"low"}' | jq -r .record.priority)" low "oncelik"
ok "$(DB "select detail from activity where verb='field_changed' and target_label='priority'")" '{"from":"critical","to":"low"}' "olgu, cumle degil"
w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"priority","value":"low"}' >/dev/null
ok "$(DB "select count(*) from activity where verb='field_changed'")" 1 "degismeyen deger iz birakmaz"
ok "$(w w PATCH "$WT" "/api/records/$BUTCE" "{\"field\":\"unit_id\",\"value\":\"$SELIN\"}" | jq -r .error)" invalid_unit "birim dugum olmali"

t record_permissions
ok "$(g n "/api/records/$VEKALET" | jq -r .access.can_edit)" false "uye kapsam disi"
ok "$(wc_ n PATCH "$NT" "/api/records/$VEKALET" '{"field":"priority","value":"low"}')" 403 "alan 403"

# R1-F02/G2: yetki 403'u da security_events'e tek satir, aktor + sorgusuz yol.
SE1=$(DB "select count(*) from security_events where event_type='permission_denied'")
ok "$(wc_ n PATCH "$NT" "/api/records/$VEKALET?ignored=1" '{"field":"priority","value":"low"}')" 403 "alan 403 (sorgulu url)"
ok "$(DB "select count(*) from security_events where event_type='permission_denied'")" "$((SE1+1))" "tek satir"
ok "$(DB "select detail from security_events where event_type='permission_denied' order by created_at desc limit 1")" "PATCH /api/records/$VEKALET" "detay: sorgu dizgisi yok"
ok "$(DB "select actor_id from security_events where event_type='permission_denied' order by created_at desc limit 1")" "$DENIZ" "aktor cerezdeki kullanici"

ok "$(wc_ n POST "$NT" "/api/chats/$VCHAT/messages" '{"body":"x"}')" 403 "mesaj 403"
ok "$(g n "/api/records/$BUTCE" | jq -r .access.can_edit_deadline)" false "son tarih kapsami yok"
ok "$(wc_ n PATCH "$NT" "/api/records/$BUTCE" '{"field":"due_date","value":"2026-12-01"}')" 403 "son tarih 403"

t actions
R=$(w w POST "$WT" "/api/records/$BUTCE/actions" "{\"title\":\"Sozlesme taslagi\",\"owner_id\":\"$DENIZ\"}")
ok "$(jq '.actions|length' <<<"$R")" 3 "eklendi"
A=$(DB "select id from actions where title='Sozlesme taslagi'")
ok "$(w w PATCH "$WT" "/api/actions/$A" '{"field":"status","value":"closed"}' | jq -r ".actions[]|select(.id==\"$A\").status")" closed "kapandi"
ok "$(DB "select resolved_by from actions where id='$A'")" "$SELIN" "kapatan izde"
ok "$(w w POST "$WT" "/api/records/$BUTCE/actions" '{"title":"  "}' | jq -r .error)" invalid_title "bos baslik"

t messages
ok "$(w w POST "$WT" "/api/chats/$BCHAT/messages" '{"body":"sozlesme testi"}' | jq -r 'has("id")')" true "gonderildi"
M=$(DB "select id from messages where body='sozlesme testi'")
ok "$(g w "/api/chats/$BCHAT/feed" | jq -r '.items[-1].body')" "sozlesme testi" "akista"
ok "$(w w POST "$WT" "/api/chats/$VCHAT/messages" "{\"body\":\"y\",\"reply_to_id\":\"$M\"}" | jq -r .error)" invalid_reply "sohbet disina yanit yok"
ok "$(w w POST "$WT" "/api/chats/$BCHAT/messages" '{"body":"   "}' | jq -r .error)" invalid_body "bos mesaj"

t create_record_open_to_all
# Kayit acmak herkese, her birimde acik (kullanici karari, spec/90 G1): UNIT
# Deniz'in dali (Uretim Hatti A) DISINDA ve yine 200.
R=$(w n POST "$NT" /api/records "{\"kind\":\"task\",\"title\":\"Sozlesme kaydi\",\"unit_id\":\"$UNIT\",\"owner_id\":null}")
NEW=$(jq -r .id <<<"$R")
ok "$(DB "select created_by from records where id='$NEW'")" "$DENIZ" "acan"
ok "$(g n "/api/records/$NEW" | jq -r .access.can_edit)" true "acan duzenler"
ok "$(w n POST "$NT" /api/records "{\"kind\":\"task\",\"title\":\"x\",\"unit_id\":\"$DENIZ\"}" | jq -r .error)" invalid_unit "gecersiz birim"

t home_teams_notifications
ok "$(g w /api/home | jq '.counts|has("overdue_records")')" true "sayaclar"
ok "$(g w /api/teams | jq length)" 3 "takimlar"
ok "$(g w /api/notifications | jq 'map(select(.actor_id=="'"$SELIN"'"))|length')" 0 "kendi hareketim yok"
ok "$(w w POST "$WT" /api/pins/uydurma '' | jq -r .error)" not_found "bilinmeyen pin"

# --- Google kipi -------------------------------------------------------------
t google_me
R=$(curl -s "$BG/api/me"); ok "$(jq -r .auth <<<"$R")" google "auth"
ok "$(jq -r 'has("dev_users")' <<<"$R")" false "dev_users yok"
ok "$(code "$BG/api/auth/dev-login?user_id=$DENIZ")" 404 "dev-login kapali"

t google_start
H=$(curl -s -D - -o /dev/null -c "$J/g" -H "X-Real-IP: 10.0.0.1" "$BG/api/auth/google?next=dashboard")
L=$(grep -i '^location:' <<<"$H" | tr -d '\r' | cut -d' ' -f2)
ok "${L%%\?*}" "https://accounts.google.com/o/oauth2/v2/auth" "Google'a"
for p in "code_challenge_method=S256" "response_type=code" "prompt=select_account" "client_id=test-client"; do
  ok "$(grep -qF "$p" <<<"$L" && echo V || echo Y)" V "$p"
done
ok "$(grep -qF "redirect_uri=http%3A%2F%2F$(sed 's/:/%3A/' <<<"${BG#http://}")%2Fapi%2Fauth%2Fcallback" <<<"$L" && echo V || echo Y)" V "redirect_uri"
ok "$(grep -ci '^set-cookie: oauth=.*HttpOnly' <<<"$H")" 1 "oauth cerezi"
ok "$(code -H "X-Real-IP: 10.0.0.1" "$BG/api/auth/google?next=evil.com")" 400 "serbest hedef yok"

t google_callback_state
STATE=$(sed -n 's/.*[?&]state=\([^&]*\).*/\1/p' <<<"$L")
ok "$(loc -b "$J/g" -H "X-Real-IP: 10.0.0.1" "$BG/api/auth/callback?code=x&state=baska")" "$BG/welcome?error=failed" "state uyusmaz"
ok "$(loc -H "X-Real-IP: 10.0.0.1" "$BG/api/auth/callback?code=x&state=$STATE")" "$BG/welcome?error=failed" "cerezsiz"
ok "$(loc -b "$J/g" -H "X-Real-IP: 10.0.0.1" "$BG/api/auth/callback?error=access_denied&state=$STATE")" "$BG/welcome?error=cancelled" "vazgecti"
ok "$(DB "select count(*) from security_events where event_type='login_denied' and detail like 'oauth:%state%'")" 2 "denetim izi"

t google_callback_reaches_google
# Dogru state + uydurma kod: Google'in token ucu reddetmeli (TLS'in ve
# ag cikisinin kaniti). Oturum ACILMAMALI.
H2=$(curl -s -D - -o /dev/null -c "$J/g2" -H "X-Real-IP: 10.0.0.2" "$BG/api/auth/google?next=app")
S2=$(grep -i '^location:' <<<"$H2" | tr -d '\r' | sed -n 's/.*[?&]state=\([^&]*\).*/\1/p')
ok "$(loc -b "$J/g2" -c "$J/g2" -H "X-Real-IP: 10.0.0.2" "$BG/api/auth/callback?code=uydurma&state=$S2")" "$BG/welcome?error=failed" "sahte kod"
ok "$(DB "select count(*) from security_events where detail like 'oauth: token status%'")" 1 "Google reddetti (TLS calisiyor)"
ok "$(curl -s -b "$J/g2" "$BG/api/me" | jq -r .user)" null "oturum yok"

t login_rate_limit
for _ in $(seq 10); do curl -s -o /dev/null -H "X-Real-IP: 10.9.9.9" "$BG/api/auth/google?next=app"; done
ok "$(loc -H "X-Real-IP: 10.9.9.9" "$BG/api/auth/google?next=app")" "$BG/welcome?error=rate_limited" "11. istek"
ok "$(loc -H "X-Real-IP: 10.9.9.8" "$BG/api/auth/google?next=app" | cut -c1-35)" "https://accounts.google.com/o/oauth" "baska IP etkilenmez"

printf '\n  \033[32mgecen=%s\033[0m  kalan=%s\n' "$P" "$F"
[ "$F" = 0 ]
