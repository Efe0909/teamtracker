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
ok "$(code -b "$J/c" -X POST "$B/api/auth/logout")" 403 "tokensiz"
ok "$(curl -s -b "$J/c" -X POST -H "X-CSRF-Token: yanlis" "$B/api/auth/logout" | jq -r .error)" csrf "yanlis token"
ok "$(code -X POST -H "X-CSRF-Token: $TOK" "$B/api/auth/logout")" 403 "cerezsiz"

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
ok "$(loc -b "$J/g" -H "X-Real-IP: 10.0.0.1" "$BG/api/auth/callback?code=x&state=baska")" "$BG/?error=failed" "state uyusmaz"
ok "$(loc -H "X-Real-IP: 10.0.0.1" "$BG/api/auth/callback?code=x&state=$STATE")" "$BG/?error=failed" "cerezsiz"
ok "$(loc -b "$J/g" -H "X-Real-IP: 10.0.0.1" "$BG/api/auth/callback?error=access_denied&state=$STATE")" "$BG/?error=cancelled" "vazgecti"
ok "$(DB "select count(*) from security_events where event_type='login_denied' and detail like 'oauth:%state%'")" 2 "denetim izi"

t google_callback_reaches_google
# Dogru state + uydurma kod: Google'in token ucu reddetmeli (TLS'in ve
# ag cikisinin kaniti). Oturum ACILMAMALI.
H2=$(curl -s -D - -o /dev/null -c "$J/g2" -H "X-Real-IP: 10.0.0.2" "$BG/api/auth/google?next=app")
S2=$(grep -i '^location:' <<<"$H2" | tr -d '\r' | sed -n 's/.*[?&]state=\([^&]*\).*/\1/p')
ok "$(loc -b "$J/g2" -c "$J/g2" -H "X-Real-IP: 10.0.0.2" "$BG/api/auth/callback?code=uydurma&state=$S2")" "$BG/?error=failed" "sahte kod"
ok "$(DB "select count(*) from security_events where detail like 'oauth: token status%'")" 1 "Google reddetti (TLS calisiyor)"
ok "$(curl -s -b "$J/g2" "$BG/api/me" | jq -r .user)" null "oturum yok"

t login_rate_limit
for _ in $(seq 10); do curl -s -o /dev/null -H "X-Real-IP: 10.9.9.9" "$BG/api/auth/google?next=app"; done
ok "$(loc -H "X-Real-IP: 10.9.9.9" "$BG/api/auth/google?next=app")" "$BG/?error=rate_limited" "11. istek"
ok "$(loc -H "X-Real-IP: 10.9.9.8" "$BG/api/auth/google?next=app" | cut -c1-35)" "https://accounts.google.com/o/oauth" "baska IP etkilenmez"

printf '\n  \033[32mgecen=%s\033[0m  kalan=%s\n' "$P" "$F"
[ "$F" = 0 ]
