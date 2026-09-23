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

# --- veri yonetimi: agac uclari (R2-F05, spec/72) ---------------------------
# Efe: edit_nodes + Malzeme Temini dali. Deniz: edit_nodes + Uretim Hatti A
# dali (tohumda tanimli, yukarida). Selin admin.
EFE=$(DB "select id from users where name='Efe'")
curl -s -c "$J/e" -o /dev/null "$B/api/auth/dev-login?user_id=$EFE"
ET=$(curl -s -b "$J/e" "$B/api/me" | jq -r .csrf)

ROOT1=$(DB "select id from nodes where name='Yıllık Bayi Toplantısı 2026'")
MALZEME=$(DB "select id from nodes where name='Malzeme Temini'")
BUTCEN=$(DB "select id from nodes where name='Bütçe Onayı'")
TEDARIK=$(DB "select id from nodes where name='Tedarikçi Seçimi'")
MEKAN=$(DB "select id from nodes where name='Mekan & Lojistik'")
SALON=$(DB "select id from nodes where name='Salon Sözleşmesi'")
ULASIM=$(DB "select id from nodes where name='Ulaşım & Konaklama'")
ILETISIM=$(DB "select id from nodes where name='İletişim & Tanıtım'")
URETIM=$(DB "select id from nodes where name='Üretim Hattı A'")
DOLUM=$(DB "select id from nodes where name='Dolum Makinesi'")
KAPAK=$(DB "select id from nodes where name='Kapak Ünitesi'")
ETIKET=$(DB "select id from nodes where name='Etiketleme Ünitesi'")

t node_read_open_to_all
# Yetkisiz kullanici bile agaci OKUR (spec/21 §11'den bilincli sapma, spec/90
# yeni G maddesi): butun can_* false ama 200 doner, 403 degil.
BOS=$(DB "insert into users (email,name) values ('bos@ekiptakip.local','Yetkisiz') returning id" | head -1)
curl -s -c "$J/bos" -o /dev/null "$B/api/auth/dev-login?user_id=$BOS"
R=$(g bos /api/nodes)
ok "$(jq -r .can_add_root <<<"$R")" false "kok ekleyemez"
ok "$(jq -c '[.nodes[].can_edit]|unique' <<<"$R")" '[false]' "hicbir dugumde duzenleyemez"
ok "$(jq -c '[.nodes[].can_hard_delete]|unique' <<<"$R")" '[false]' "kalici silemez"

t node_root_only_admin
SE2=$(DB "select count(*) from security_events where event_type='permission_denied'")
ok "$(wc_ e POST "$ET" /api/nodes '{"name":"Efe kok denemesi","node_type":"generic","parent_id":null}')" 403 "editor ama admin degil: kok ekleyemez"
ok "$(DB "select count(*) from security_events where event_type='permission_denied'")" "$((SE2+1))" "403 denetime yazildi"
ok "$(DB "select detail from security_events where event_type='permission_denied' order by created_at desc limit 1")" "POST /api/nodes" "detay"
ok "$(wc_ e PATCH "$ET" "/api/nodes/$BUTCEN" '{"parent_id":null}')" 403 "kendi dalindaki dugumu bile koke tasiyamaz"
R=$(w w POST "$WT" /api/nodes '{"name":"Selin kok denemesi","node_type":"generic","parent_id":null}')
ok "$(jq -r ".nodes[]|select(.name==\"Selin kok denemesi\").depth" <<<"$R")" 0 "admin kok ekler"
R=$(w w PATCH "$WT" "/api/nodes/$ILETISIM" '{"parent_id":null}')
ok "$(jq -r ".nodes[]|select(.id==\"$ILETISIM\").parent_id" <<<"$R")" null "admin koke tasir"
w w PATCH "$WT" "/api/nodes/$ILETISIM" "{\"parent_id\":\"$ROOT1\"}" >/dev/null   # eski yerine geri

t node_branch_scope_iki_yonlu
# Efe'nin Malzeme Temini'nde yetkisi var; Uretim Hatti A'da yok. Kaynakta
# yetkili olmak hedefte yetkisiz olmayi telafi etmez.
ok "$(wc_ e PATCH "$ET" "/api/nodes/$TEDARIK" "{\"parent_id\":\"$URETIM\"}")" 403 "hedef dalda izin yok"
ok "$(DB "select parent_id from nodes where id='$TEDARIK'")" "$MALZEME" "tasinmadi"

t node_move_cycle
ok "$(w w PATCH "$WT" "/api/nodes/$MALZEME" "{\"parent_id\":\"$BUTCEN\"}" | jq -r .error)" move_cycle "kendi cocugunun altina"

t node_root_only_type
ok "$(w w POST "$WT" /api/nodes "{\"name\":\"Yeni Hücre\",\"node_type\":\"cell\",\"parent_id\":\"$MALZEME\"}" | jq -r .error)" root_only "cell yalniz kokte (ekleme)"
ok "$(w w PATCH "$WT" "/api/nodes/$ILETISIM" '{"node_type":"cell"}' | jq -r .error)" root_only "cell yalniz kokte (tur degisimi)"

t node_inactive_parent
w w PATCH "$WT" "/api/nodes/$SALON" '{"is_active":false}' >/dev/null
ok "$(w w POST "$WT" /api/nodes "{\"name\":\"X\",\"node_type\":\"generic\",\"parent_id\":\"$SALON\"}" | jq -r .error)" inactive_parent "pasifin altina eklenemez"
ok "$(w w PATCH "$WT" "/api/nodes/$ULASIM" "{\"parent_id\":\"$SALON\"}" | jq -r .error)" inactive_parent "pasifin altina tasinamaz"
w w PATCH "$WT" "/api/nodes/$SALON" '{"is_active":true}' >/dev/null

t node_invalid_name
ok "$(w w POST "$WT" /api/nodes '{"name":"","node_type":"generic","parent_id":null}' | jq -r .error)" invalid_name "bos ad"
LONG=$(printf 'a%.0s' $(seq 1 201))
ok "$(w w POST "$WT" /api/nodes "{\"name\":\"$LONG\",\"node_type\":\"generic\",\"parent_id\":null}" | jq -r .error)" invalid_name "201 karakter"

t node_invalid_parent
ok "$(w w POST "$WT" /api/nodes '{"name":"X","node_type":"generic","parent_id":"00000000-0000-0000-0000-000000000000"}' | jq -r .error)" invalid_parent "olmayan ust"

t node_team_projection
# Tur 'team' -> teams satiri + sohbet dogar (KNOW-262). Ayni ad ikinci kez
# kullanilinca "(2)" olur (teams.name TEKIL, dugum adi degil).
w w POST "$WT" /api/nodes "{\"name\":\"Kalite Takımı\",\"node_type\":\"team\",\"parent_id\":\"$MALZEME\"}" >/dev/null
TNA=$(DB "select id from nodes where name='Kalite Takımı' and parent_id='$MALZEME'")
ok "$(DB "select count(*) from nodes where id='$TNA'")" 1 "dugum olustu"
ok "$(DB "select name from teams where node_id='$TNA'")" "Kalite Takımı" "takim satiri dogdu"
ok "$(DB "select count(*) from chats where id=(select chat_id from teams where node_id='$TNA')")" 1 "sohbeti var"
ok "$(DB "select count(*) from activity where verb='team_created' and subject_label='Kalite Takımı'")" 1 "gecmise yazildi"
ok "$(DB "select count(*) from activity where verb='node_created' and subject_label='Kalite Takımı'")" 1 "node_created de ayrica yazilir"
ok "$(DB "select chat_id is null from activity where verb='node_created' and subject_label='Kalite Takımı'")" t "dugum olaylari chat_id NULL (akista cizilmez)"

w w POST "$WT" /api/nodes "{\"name\":\"Kalite Takımı\",\"node_type\":\"team\",\"parent_id\":\"$URETIM\"}" >/dev/null
TNB=$(DB "select id from nodes where name='Kalite Takımı' and parent_id='$URETIM'")
ok "$(DB "select name from teams where node_id='$TNB'")" "Kalite Takımı (2)" "ikinci ayni ad (2) olur"

w w PATCH "$WT" "/api/nodes/$TNA" '{"name":"Kalite Ekibi"}' >/dev/null
ok "$(DB "select name from teams where node_id='$TNA'")" "Kalite Ekibi" "yeniden adlandirma takima da isliyor"

ok "$(w w PATCH "$WT" "/api/nodes/$TNA" '{"node_type":"generic"}' | jq -r .error)" type_locked "projeksiyonu olan dugumun turu kilitli"
ok "$(wc_ w PATCH "$WT" "/api/nodes/$TNA" '{"node_type":"generic"}')" 409 "type_locked 409 doner"

t node_hard_delete
ok "$(wc_ n DELETE "$NT" "/api/nodes/$ETIKET" '')" 200 "bos (virgin) dugumu yalniz edit ile siler"
ok "$(DB "select count(*) from nodes where id='$ETIKET'")" 0 "gitti"

ok "$(wc_ n DELETE "$NT" "/api/nodes/$DOLUM" '')" 403 "bagimlisi (cocuk + kayit) olani edit tek basina silemez"
DB "insert into user_scopes (user_id,scope) values ('$DENIZ','hard_delete_nodes')" >/dev/null
KREC=$(DB "select id from records where unit_id='$KAPAK'")
ok "$(wc_ n DELETE "$NT" "/api/nodes/$DOLUM" '')" 200 "hard_delete_nodes ile siler"
ok "$(DB "select count(*) from nodes where id='$DOLUM'")" 0 "dugum gitti"
ok "$(DB "select count(*) from nodes where id='$KAPAK'")" 0 "alt agac da gitti"
ok "$(DB "select count(*) from records where id='$KREC'")" 0 "bagimli kayit da gitti"
ok "$(DB "select chat_id is null from activity where verb='node_deleted' and subject_label='Dolum Makinesi'")" t "silme de NULL chat_id ile denetime yazilir"
ok "$(DB "select detail from activity where verb='node_deleted' and subject_label='Dolum Makinesi'")" '{"descendants":1}' "goturulen alt dugum sayisi (Kapak Ünitesi)"
DB "delete from user_scopes where user_id='$DENIZ' and scope='hard_delete_nodes'" >/dev/null

ok "$(wc_ w DELETE "$WT" "/api/nodes/$TNB" '')" 200 "admin kalici silmede yetenegi atlar"
ok "$(DB "select count(*) from nodes where id='$TNB'")" 0 "dugum gitti"
ok "$(DB "select node_id from teams where name='Kalite Takımı (2)'")" "" "takimin node_id'si null oldu"
ok "$(DB "select count(*) from teams where name='Kalite Takımı (2)'")" 1 "takim satiri hayatta"

t node_activity_olgu
AC0=$(DB "select count(*) from activity where verb='node_changed'")
w w PATCH "$WT" "/api/nodes/$ULASIM" '{"name":"Ulaşım Planı","description":"detaylar"}' >/dev/null
ok "$(DB "select count(*) from activity where verb='node_changed'")" "$((AC0+2))" "iki alan degisti, iki satir"
ok "$(DB "select detail from activity where verb='node_changed' and target_label='name' order by created_at desc limit 1")" '{"from":"Ulaşım & Konaklama","to":"Ulaşım Planı"}' "ad olgu, cumle degil"
ok "$(DB "select detail from activity where verb='node_changed' and target_label='description' order by created_at desc limit 1")" '{"from":null,"to":"detaylar"}' "aciklama olgu"
w w PATCH "$WT" "/api/nodes/$ULASIM" '{"name":"Ulaşım Planı","description":"detaylar"}' >/dev/null
ok "$(DB "select count(*) from activity where verb='node_changed'")" "$((AC0+2))" "degismeyince iz yok"

# null ACIKLAMAYI SILER, VERILMEYEN alan (name) degismez.
w w PATCH "$WT" "/api/nodes/$ULASIM" '{"description":null}' >/dev/null
ok "$(DB "select description from nodes where id='$ULASIM'")" "" "description null ile silinir"
ok "$(DB "select name from nodes where id='$ULASIM'")" "Ulaşım Planı" "verilmeyen alan (name) degismez"

w w PATCH "$WT" "/api/nodes/$TEDARIK" "{\"parent_id\":\"$MEKAN\"}" >/dev/null
ok "$(DB "select detail from activity where verb='node_changed' and target_label='parent' order by created_at desc limit 1")" '{"from":"Malzeme Temini","to":"Mekan & Lojistik"}' "ust degisimi ADLA yazilir"
w w PATCH "$WT" "/api/nodes/$TEDARIK" "{\"parent_id\":\"$MALZEME\"}" >/dev/null   # eski yerine geri

t node_presence
curl -s -b "$J/e" -o /dev/null "$B/api/me"
PT1=$(DB "select last_seen_at from users where id='$EFE'")
curl -s -b "$J/e" -o /dev/null "$B/api/me"
PT2=$(DB "select last_seen_at from users where id='$EFE'")
ok "$([ -n "$PT1" ] && echo V || echo Y)" V "damga yazildi"
ok "$([ "$PT1" = "$PT2" ] && echo V || echo Y)" V "bir dakika icinde ikinci istek yeniden yazmaz"

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
