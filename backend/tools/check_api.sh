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
ok "$(jq -r '.dev_users|length' <<<"$R")" 7 "dev_users"

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
ok "$(jq '.users|length' <<<"$R")" 7 "users"
ok "$(jq '.teams|length' <<<"$R")" 5 "teams (3 sade + 2 pillar takimi)"
ok "$(jq -r '.external_off|index("decision")!=null' <<<"$R")" true "anahtarsiz karar servisi kapali"
ok "$(jq -c '[.pillars[]|.name]' <<<"$R")" '["Güvenlik","Kalite"]' "pillars sort_order, ad"
ok "$(jq -c '.pillars[0]|keys' <<<"$R")" '["color","description","id","is_active","name","sort_order","team_id"]' "MetaPillar alanlari"
ok "$(jq -c '.teams[0]|keys' <<<"$R")" '["banner_id","chat_id","color","description","id","name","node_ids","pillar_id"]' "MetaTeam alanlari (node_id yok)"
ok "$(jq '[.teams[]|select(.pillar_id!=null)]|length' <<<"$R")" 2 "pillar takimlari pillar_id tasir"
ok "$(jq '[.teams[]|select(.name=="Satın Alım")|.node_ids|length][0]' <<<"$R")" 2 "team_nodes: Satin Alim iki dugumde"
ok "$(jq -c '[.nodes[].node_type]|unique' <<<"$R")" '["cell","checkpoint","generic","machine","operational","option","step","widget"]' "agacta team/pillar turu yok"
ok "$(jq -c '[.nodes[]|select(.parent_id==null).key]' <<<"$R")" '["units","event_management"]' "kokler key ile (spec/74)"
ok "$(jq -c '[.nodes[]|select(.depth==1 and .root_key!="units").key]' <<<"$R")" '["event_types","event_locations","event_outcomes"]' "Etkinlik Yonetimi bolumleri key ile"
ok "$(jq -c '.me.favorite_nodes' <<<"$R")" '[]' "favoriler bos"
ok "$(jq '[.nodes[]|select(.depth==0)]|length > 0' <<<"$R")" true "agac koku"
ok "$(jq '.users[0]|has("email")' <<<"$R")" false "e-posta sizmaz"

t websocket_gate
# Yukseltme istegi: oturum + Origin kapisi. Olaylarin kendisi (abonelik, yetki)
# Rust birim testlerinde; burada yalniz el sikismanin durum kodu. curl 101'den
# sonra bekler, -m 1 keser (cikis kodu 28, durum kodu yine yazilir).
UP=(-H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==")
ok "$(code -m 1 "${UP[@]}" "$B/api/ws")" 401 "oturumsuz"
ok "$(code -m 1 -b "$J/w" "${UP[@]}" -H "Origin: https://evil.example" "$B/api/ws")" 403 "yabanci Origin"
ok "$(curl -s -m 1 -b "$J/w" "${UP[@]}" -H "Origin: https://evil.example" "$B/api/ws" | jq -r .error)" bad_origin "kod bad_origin"
ok "$(code -m 1 -b "$J/w" "${UP[@]}" "$B/api/ws")" 101 "Origin'siz (tarayici disi) gecer"
ok "$(code -m 1 -b "$J/w" "${UP[@]}" -H "Origin: ${B}" "$B/api/ws")" 101 "ayni Origin gecer"

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

t record_patch_stale
# `base` = istemcinin GORDUGU deger. Alan baska biri tarafindan degistiyse
# yazma reddedilir (409 stale_field), sessiz son-yazan-kazanir olmaz.
ok "$(w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"priority","value":"high","base":"critical"}' | jq -r .error)" stale_field "bayat base"
ok "$(wc_ w PATCH "$WT" "/api/records/$BUTCE" '{"field":"priority","value":"high","base":"critical"}')" 409 "409"
ok "$(DB "select priority from records where id='$BUTCE'")" low "bayat yazma uygulanmadi"
ok "$(DB "select count(*) from activity where verb='field_changed'")" 1 "reddedilen yazma iz birakmaz"
ok "$(w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"priority","value":"high","base":"low"}' | jq -r .record.priority)" high "guncel base kabul"
ok "$(DB "select detail from activity where verb='field_changed' and target_label='priority' order by created_at desc limit 1")" '{"from":"low","to":"high"}' "gunluk eski degeri islemden alir"
# Hedef deger zaten orada (iki kisi ayni seyi yapti): hata degil, no-op.
ok "$(w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"priority","value":"high","base":"critical"}' | jq -r .record.priority)" high "hedef zaten orada"
# Farkli alan baskasinin degisikligine takilmaz: yalniz kendi alani karsilastirilir.
ok "$(w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"due_date","value":"2030-01-01"}' | jq -r .record.due_date)" 2030-01-01 "base yok = kontrol yok"
ok "$(w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"due_date","value":null,"base":"2030-01-01"}' | jq -r .record.due_date)" null "tarih -> null"
# null gecerli bir base: "bos gormustu".
ok "$(w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"due_date","value":"2031-01-01","base":null}' | jq -r .record.due_date)" 2031-01-01 "base null, alan bos"
ok "$(w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"due_date","value":"2032-01-01","base":null}' | jq -r .error)" stale_field "base null ama alan dolu"
w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"due_date","value":null}' >/dev/null
w w PATCH "$WT" "/api/records/$BUTCE" '{"field":"priority","value":"low"}' >/dev/null

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
ok "$(w w PATCH "$WT" "/api/actions/$A" '{"field":"status","value":"closed","closing_note":"Sozlesme taslagi tamamlandi ve yoneticiye gonderildi."}' | jq -r ".actions[]|select(.id==\"$A\").status")" closed "kapandi"
ok "$(DB "select resolved_by from actions where id='$A'")" "$SELIN" "kapatan izde"
ANOTE='Sozlesme taslagi tamamlandi ve yoneticiye gonderildi.'
ok "$(DB "select closing_note from actions where id='$A'")" "$ANOTE" "eylem kapanis notu saklandi"
BCHAT=$(DB "select chat_id from records where id='$BUTCE'")
ok "$(g w "/api/chats/$BCHAT/feed" | jq -r '.items[]|select(.verb=="closing_note" and .target_label=="action")|.body' | tail -1)" "$ANOTE" "eylem kapanis notu akis mesaji"
w w PATCH "$WT" "/api/actions/$A" '{"field":"status","value":"open"}' >/dev/null
ok "$(DB "select coalesce(closing_note,'NULL') from actions where id='$A'")" NULL "eylem yeniden acilinca not silinir"
ok "$(w w PATCH "$WT" "/api/actions/$A" '{"field":"status","value":"cancelled"}' | jq -r ".actions[]|select(.id==\"$A\").status")" cancelled "eylem iptali not gerektirmez"
ok "$(w w POST "$WT" "/api/records/$BUTCE/actions" '{"title":"  "}' | jq -r .error)" invalid_title "bos baslik"

t messages
ok "$(w w POST "$WT" "/api/chats/$BCHAT/messages" '{"body":"sozlesme testi"}' | jq -r 'has("id")')" true "gonderildi"
M=$(DB "select id from messages where body='sozlesme testi'")
ok "$(g w "/api/chats/$BCHAT/feed" | jq -r '.items[-1].body')" "sozlesme testi" "akista"
ok "$(w w POST "$WT" "/api/chats/$VCHAT/messages" "{\"body\":\"y\",\"reply_to_id\":\"$M\"}" | jq -r .error)" invalid_reply "sohbet disina yanit yok"
ok "$(w w POST "$WT" "/api/chats/$BCHAT/messages" '{"body":"   "}' | jq -r .error)" invalid_body "bos mesaj"

# Gelen kutusu: iliski tek satir, gizlilik ve yalniz MESAJ zamani.
t chat_inbox
ok "$(code "$B/api/chats/inbox")" 401 "oturumsuz"
IT=$(DB "select team_id from team_members where user_id='$DENIZ' order by team_id limit 1")
IC1=91000000-0000-0000-0000-000000000001
IC2=91000000-0000-0000-0000-000000000002
IC3=91000000-0000-0000-0000-000000000003
IC4=91000000-0000-0000-0000-000000000004
IC5=91000000-0000-0000-0000-000000000005
IC6=91000000-0000-0000-0000-000000000006
DB "insert into chats(id) values ('$IC1'),('$IC2'),('$IC3'),('$IC4'),('$IC5'),('$IC6');
    insert into records(id,chat_id,unit_id,kind,title,created_by,owner_id,team_id,access_mode) values
      ('$IC1','$IC1','$UNIT','task','Inbox owner','$SELIN','$DENIZ',null,'private'),
      ('$IC2','$IC2','$UNIT','task','Inbox creator','$DENIZ',null,null,'private'),
      ('$IC3','$IC3','$UNIT','task','Inbox participant','$SELIN',null,null,'private'),
      ('$IC4','$IC4','$UNIT','task','Inbox team','$SELIN',null,'$IT','private'),
      ('$IC5','$IC5','$UNIT','task','Inbox unrelated','$SELIN',null,null,'private'),
      ('$IC6','$IC6','$UNIT','task','Inbox empty','$DENIZ','$DENIZ','$IT','private');
    insert into record_participants(record_id,user_id) values ('$IC3','$DENIZ'),('$IC6','$DENIZ');
    insert into messages(id,chat_id,author_id,body,created_at) values
      ('92000000-0000-0000-0000-000000000001','$IC1','$SELIN','old','2099-01-02'),
      ('92000000-0000-0000-0000-000000000002','$IC1','$DENIZ','latest','2099-01-02'),
      ('92000000-0000-0000-0000-000000000003','$IC2','$DENIZ','creator','2099-01-02'),
      ('92000000-0000-0000-0000-000000000004','$IC3','$DENIZ','participant','2099-01-03');
    insert into activity(chat_id,actor_id,verb,subject_label,detail,created_at)
      values ('$IC1','$SELIN','field_changed','Inbox owner','{\"from\":\"a\",\"to\":\"b\"}','2099-01-04');" >/dev/null
R=$(g n /api/chats/inbox)
ok "$(jq -c '.[0]|keys' <<<"$R")" '["can_post","chat_id","kind","last_actor_id","last_message","record_id","team_id","title","updated_at"]' "sozlesme, sahte unread yok"
ok "$(jq -c '[.[]|select(.title|startswith("Inbox "))|.chat_id]' <<<"$R")" "[\"$IC3\",\"$IC1\",\"$IC2\",\"$IC4\",\"$IC6\"]" "mesaj sirasi, baglar, tekillik"
ok "$(jq -r ".[]|select(.chat_id==\"$IC1\")|.last_message" <<<"$R")" latest "esit zamanda id; faaliyet degil"
ok "$(jq -r ".[]|select(.chat_id==\"$IC1\")|.last_actor_id" <<<"$R")" "$DENIZ" "son mesajin yazari"
ok "$(jq -r ".[]|select(.chat_id==\"$IC4\")|.record_id+\"|\"+.team_id" <<<"$R")" "$IC4|$IT" "kayit navigasyonu"
ok "$(jq -r ".[]|select(.kind==\"team\" and .team_id==\"$IT\")|(.record_id==null and .can_post)" <<<"$R")" true "takim navigasyonu"
ok "$(jq '[.[]|select(.title|startswith("Inbox "))|.can_post]|all' <<<"$R")" true "iliskililer yazabilir"
ok "$(jq ".[]|select(.chat_id==\"$IC6\")|(.last_message==null and .updated_at==null)" <<<"$R")" true "mesajsiz sohbet"
ok "$(g n "/api/chats/$IC5/feed" | jq -r .error)" forbidden "iliskisiz gizli sohbet sizmaz"
DB "delete from records where id in ('$IC1','$IC2','$IC3','$IC4','$IC5','$IC6');
    delete from chats where id in ('$IC1','$IC2','$IC3','$IC4','$IC5','$IC6');" >/dev/null

t create_record_open_to_all
# Kayit acmak herkese, her birimde acik (kullanici karari, spec/90 G1): UNIT
# Deniz'in dali (Uretim Hatti A) DISINDA ve yine 200.
R=$(w n POST "$NT" /api/records "{\"kind\":\"task\",\"title\":\"Sozlesme kaydi\",\"description\":\"Sozlesme taslagi hazirlanacak ve hukuk ekibiyle paylasilarak gozden gecirilecek.\",\"unit_id\":\"$UNIT\",\"owner_id\":null}")
NEW=$(jq -r .id <<<"$R")
ok "$(DB "select created_by from records where id='$NEW'")" "$DENIZ" "acan"
ok "$(w n POST "$NT" /api/records "{\"kind\":\"task\",\"title\":\"abc\",\"description\":\"Bu aciklama uzun ve gecerli bir test metnidir.\",\"unit_id\":\"$UNIT\"}" | jq -r .error)" title_too_short "kisa baslik"
ok "$(w n POST "$NT" /api/records "{\"kind\":\"task\",\"title\":\"Gecerli baslik\",\"description\":\"kisa\",\"unit_id\":\"$UNIT\"}" | jq -r .error)" description_too_short "kisa aciklama"
LEGACY=$(DB "with c as (insert into chats default values returning id) insert into records (unit_id,chat_id,kind,title,description,created_by) select '$UNIT',id,'task','Old','x','$DENIZ' from c returning id" | head -1)
w n PATCH "$NT" "/api/records/$LEGACY" '{"field":"priority","value":"low"}' >/dev/null
ok "$(DB "select priority from records where id='$LEGACY'")" low "degismeyen eski kisa alan denetlenmez"
ok "$(w n PATCH "$NT" "/api/records/$NEW" '{"field":"priority","value":"high"}' | jq -r 'has("quality")')" false "oncelik degisikliginde quality yok"
DB "insert into user_scopes (user_id,scope) values ('$DENIZ','bypass_text_quality')" >/dev/null
ok "$(w n PATCH "$NT" "/api/records/$NEW" '{"field":"title","value":"x"}' | jq -r .record.title)" x "kisa baslik kapsamla"
ok "$(w n PATCH "$NT" "/api/records/$NEW" '{"field":"description","value":"y"}' | jq -r .record.description)" y "kisa aciklama kapsamla"
ok "$(w n PATCH "$NT" "/api/records/$NEW" '{"field":"description","value":null}' | jq -r .error)" description_required "bos aciklama kapsamda da yasak"
ok "$(w n PATCH "$NT" "/api/records/$NEW" '{"field":"status","value":"closed","closing_note":"x"}' | jq -r .record.status)" closed "kisa kapanis notu kapsamla"
w n PATCH "$NT" "/api/records/$NEW" '{"field":"status","value":"open"}' >/dev/null
DB "delete from user_scopes where user_id='$DENIZ' and scope='bypass_text_quality'" >/dev/null
w n PATCH "$NT" "/api/records/$NEW" '{"field":"title","value":"Sozlesme kaydi"}' >/dev/null
w n PATCH "$NT" "/api/records/$NEW" '{"field":"description","value":"Sozlesme taslagi hazirlanacak ve hukuk ekibiyle paylasilarak gozden gecirilecek."}' >/dev/null
ok "$(w n PATCH "$NT" "/api/records/$NEW" '{"field":"description","value":"Sozlesme taslagi hazirlanacak ve hukuk ekibiyle paylasilarak son kez gozden gecirilecek."}' | jq -c '.quality')" '{"outcome":"skipped","reasons":[]}' "kapali servis: quality skipped, uydurma guven yok"
ok "$(w n PATCH "$NT" "/api/records/$NEW" '{"field":"status","value":"closed"}' | jq -r .error)" closing_note_required "kapanis notu zorunlu"
ok "$(w n PATCH "$NT" "/api/records/$NEW" '{"field":"status","value":"closed","closing_note":"Kisa not"}' | jq -r .error)" closing_note_too_short "kisa kapanis notu"
NOTE='Sozlesme taslagi hazirlandi ve yoneticiye inceleme icin gonderildi.'
ok "$(w n PATCH "$NT" "/api/records/$NEW" "{\"field\":\"status\",\"value\":\"closed\",\"closing_note\":\"$NOTE\"}" | jq -r .record.status)" closed "kayit kapandi"
ok "$(DB "select closing_note from records where id='$NEW'")" "$NOTE" "kapanis notu saklandi"
NEWCHAT=$(DB "select chat_id from records where id='$NEW'")
ok "$(g n "/api/chats/$NEWCHAT/feed" | jq -r '.items[]|select(.verb=="closing_note")|.body' | tail -1)" "$NOTE" "kapanis notu akis mesaji"
w n PATCH "$NT" "/api/records/$NEW" '{"field":"status","value":"open"}' >/dev/null
ok "$(DB "select coalesce(closing_note,'NULL') from records where id='$NEW'")" NULL "yeniden acinca not silinir"
ok "$(w n PATCH "$NT" "/api/records/$NEW" '{"field":"status","value":"cancelled"}' | jq -r .record.status)" cancelled "iptal not gerektirmez"

ok "$(g n "/api/records/$NEW" | jq -r .access.can_edit)" true "acan duzenler"
ok "$(w n POST "$NT" /api/records "{\"kind\":\"task\",\"title\":\"Gecersiz birim kaydi\",\"description\":\"Bu kayit gecersiz birim icin dogrulama amaciyla olusturuldu.\",\"unit_id\":\"$DENIZ\"}" | jq -r .error)" invalid_unit "gecersiz birim"

t home_teams_notifications
ok "$(g w /api/home | jq '.counts|has("overdue_records")')" true "sayaclar"
ok "$(g w /api/teams | jq length)" 5 "takimlar"
ok "$(g w /api/notifications | jq '.items|map(select(.actor_id=="'"$SELIN"'"))|length')" 0 "kendi hareketim yok"
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
ok "$(jq -c '[.nodes[].can_edit]|unique' <<<"$R")" '[false]' "hicbir dugumde duzenleyemez"
ok "$(jq -c '[.nodes[].can_hard_delete]|unique' <<<"$R")" '[false]' "kalici silemez"
ok "$(jq -c '[.nodes[].child_types|length]|unique' <<<"$R")" '[0]' "hicbir yere ekleyemez"

t node_roots_code_only
# spec/74: kokler yalniz gocle; admin dahil kimse kok yaratamaz/tasiyamaz/kapatamaz.
UNITS=$(DB "select id from nodes where key='units'")
TYPES=$(DB "select id from nodes where key='event_types'")
PLACES=$(DB "select id from nodes where key='event_locations'")
ok "$(DB "select count(*) from nodes where parent_id is null")" 2 "iki kok (units, event_management)"
ok "$(DB "select count(*) from nodes where key is not null and parent_id is not null")" 3 "uc bolum Etkinlik Yonetimi'nin altinda"
ok "$(DB "select parent_id from nodes where id='$ROOT1'")" "$UNITS" "eski kok Birimler altinda"
ok "$(DB "select node_type from nodes where id='$ROOT1'")" generic "elle operational generic oldu"
ok "$(w w POST "$WT" /api/nodes '{"name":"Selin kok denemesi","node_type":"generic","parent_id":null}' | jq -r .error)" root_locked "admin bile kok yaratamaz"
ok "$(w w PATCH "$WT" "/api/nodes/$UNITS" '{"is_active":false}' | jq -r .error)" root_locked "kok kapatilamaz"
ok "$(w w DELETE "$WT" "/api/nodes/$UNITS" '' | jq -r .error)" root_locked "kok silinemez"
R=$(w w PATCH "$WT" "/api/nodes/$UNITS" '{"name":"Birimlerimiz"}')
ok "$(jq -r ".nodes[]|select(.id==\"$UNITS\").name" <<<"$R")" Birimlerimiz "kokun adi degisir"
ok "$(jq -r ".nodes[]|select(.id==\"$UNITS\").key" <<<"$R")" units "key sabit"
w w PATCH "$WT" "/api/nodes/$UNITS" '{"name":"Birimler"}' >/dev/null
SE2=$(DB "select count(*) from security_events where event_type='permission_denied'")
ok "$(wc_ e POST "$ET" /api/nodes "{\"name\":\"Efe dal disi\",\"node_type\":\"generic\",\"parent_id\":\"$URETIM\"}")" 403 "dal izni olmayan yere ekleyemez"
ok "$(DB "select count(*) from security_events where event_type='permission_denied'")" "$((SE2+1))" "403 denetime yazildi"
ok "$(DB "select detail from security_events where event_type='permission_denied' order by created_at desc limit 1")" "POST /api/nodes" "detay"

t node_branch_scope_iki_yonlu
# Efe'nin Malzeme Temini'nde yetkisi var; Uretim Hatti A'da yok. Kaynakta
# yetkili olmak hedefte yetkisiz olmayi telafi etmez.
ok "$(wc_ e PATCH "$ET" "/api/nodes/$TEDARIK" "{\"parent_id\":\"$URETIM\"}")" 403 "hedef dalda izin yok"
ok "$(DB "select parent_id from nodes where id='$TEDARIK'")" "$MALZEME" "tasinmadi"

t node_move_cycle
ok "$(w w PATCH "$WT" "/api/nodes/$MALZEME" "{\"parent_id\":\"$BUTCEN\"}" | jq -r .error)" move_cycle "kendi cocugunun altina"

t node_types_per_root
# Tur kurallari kok semasindan (refdata.rs): Birimler'de cell artik her yerde.
R=$(w w POST "$WT" /api/nodes "{\"name\":\"Yeni Hücre\",\"node_type\":\"cell\",\"parent_id\":\"$MALZEME\"}")
ok "$(jq -r ".nodes[]|select(.name==\"Yeni Hücre\").node_type" <<<"$R")" cell "cell kok-yalniz degil"
ok "$(w w POST "$WT" /api/nodes "{\"name\":\"Toplanti Yeri\",\"node_type\":\"location\",\"parent_id\":\"$MALZEME\"}" | jq -r .error)" type_not_allowed "Birimler'e location girmez"
ok "$(w w POST "$WT" /api/nodes "{\"name\":\"Gecersiz Adim\",\"node_type\":\"checkpoint\",\"parent_id\":\"$TYPES\"}" | jq -r .error)" type_not_allowed "Etkinlik Turleri'ne yalniz option"
ok "$(w w PATCH "$WT" "/api/nodes/$ILETISIM" "{\"parent_id\":\"$PLACES\"}" | jq -r .error)" type_not_allowed "kokler arasi tasima yok"
ok "$(jq -c ".nodes[]|select(.id==\"$UNITS\").child_types" <<<"$R")" '["cell","machine","task","step","generic"]' "Birimler tur listesi"

t node_event_types
# Yeni tur: sunucu option yapar ve slotlarini (steps, widgets) yaratir.
R=$(w w POST "$WT" /api/nodes "{\"name\":\"Atölye\",\"parent_id\":\"$TYPES\"}")
ATOLYE=$(jq -r '.nodes[]|select(.name=="Atölye").id' <<<"$R")
ok "$(jq -r ".nodes[]|select(.id==\"$ATOLYE\").node_type" <<<"$R")" option "tur sunucudan"
ok "$(jq -c "[.nodes[]|select(.parent_id==\"$ATOLYE\").attrs.slot]" <<<"$R")" '["steps","widgets"]' "slotlar otomatik"
STEPS=$(jq -r ".nodes[]|select(.parent_id==\"$ATOLYE\" and .attrs.slot==\"steps\").id" <<<"$R")
ok "$(w w DELETE "$WT" "/api/nodes/$STEPS" '' | jq -r .error)" operational_locked "slot silinmez"
R=$(w w POST "$WT" /api/nodes "{\"name\":\"Mekan\",\"parent_id\":\"$STEPS\",\"attrs\":{\"offset_days\":-3}}")
ok "$(jq -c '.nodes[]|select(.name=="Mekan" and .node_type=="checkpoint").warnings' <<<"$R")" '["late_checkpoint"]' "7 gun kurali reddetmez, uyarir"
ok "$(w w POST "$WT" /api/nodes "{\"name\":\"Gecersiz Adim\",\"parent_id\":\"$STEPS\",\"attrs\":{\"offset_days\":\"x\"}}" | jq -r .error)" invalid_attrs "attrs dogrulanir"
ok "$(w n POST "$NT" /api/nodes "{\"name\":\"Deniz turu\",\"parent_id\":\"$TYPES\"}" | jq -r .error)" forbidden "manage_event_types yok"
DB "insert into user_scopes (user_id,scope) values ('$DENIZ','manage_event_types')" >/dev/null
ok "$(wc_ n POST "$NT" /api/nodes "{\"name\":\"Deniz turu\",\"parent_id\":\"$TYPES\"}")" 200 "scope ile ekler (dal izni gerekmez)"
DB "delete from user_scopes where user_id='$DENIZ' and scope='manage_event_types'" >/dev/null
ok "$(w w POST "$WT" /api/records "{\"kind\":\"task\",\"title\":\"Gecersiz birim kaydi\",\"description\":\"Bu kayit etkinlik turunu birim olarak kullanamaz.\",\"unit_id\":\"$ATOLYE\"}" | jq -r .error)" unit_outside_units "tur birim degil"

t node_event_management
# Etkinlik Yonetimi: kok yalniz admin; bolumler key'li ama kok degil ("Bolum").
MGMT=$(DB "select id from nodes where key='event_management'")
OUTCOMES=$(DB "select id from nodes where key='event_outcomes'")
R=$(g w /api/nodes)
ok "$(jq -r ".nodes[]|select(.id==\"$TYPES\").locked" <<<"$R")" operational "bolum kok degil, slot gibi kilitli"
ok "$(jq -r ".nodes[]|select(.id==\"$MGMT\").locked" <<<"$R")" root "Etkinlik Yonetimi kok"
ok "$(w w PATCH "$WT" "/api/nodes/$TYPES" '{"is_active":false}' | jq -r .error)" operational_locked "bolum kapatilamaz"
ok "$(w w PATCH "$WT" "/api/nodes/$TYPES" "{\"parent_id\":\"$PLACES\"}" | jq -r .error)" operational_locked "bolum tasinamaz"
ok "$(w w DELETE "$WT" "/api/nodes/$PLACES" '' | jq -r .error)" operational_locked "bolum silinemez"
ok "$(w w POST "$WT" /api/nodes "{\"name\":\"Bolum denemesi\",\"parent_id\":\"$MGMT\"}" | jq -r .error)" type_not_allowed "kokun altina bolum eklenmez"
ok "$(w n PATCH "$NT" "/api/nodes/$MGMT" '{"description":"Deniz bunu duzenleyemez ki."}' | jq -r .error)" forbidden "kok yalniz admin"
ok "$(w n POST "$NT" /api/nodes "{\"name\":\"Deniz kazanimi\",\"parent_id\":\"$OUTCOMES\"}" | jq -r .error)" forbidden "manage_event_outcomes yok"
R=$(w w POST "$WT" /api/nodes "{\"name\":\"Marka bilinirliği\",\"description\":\"Kulübün kampüste tanınırlığını artırır.\",\"parent_id\":\"$OUTCOMES\"}")
ok "$(jq -r '.nodes[]|select(.name=="Marka bilinirliği").node_type' <<<"$R")" outcome "kazanim turu sunucudan"
ok "$(jq -r '.nodes[]|select(.name=="Marka bilinirliği").root_key' <<<"$R")" event_outcomes "bolum key'i"
ok "$(jq -r '.nodes[]|select(.name=="Marka bilinirliği").description' <<<"$R")" "Kulübün kampüste tanınırlığını artırır." "aciklama tutulur"
DB "insert into user_scopes (user_id,scope) values ('$DENIZ','manage_event_outcomes')" >/dev/null
ok "$(wc_ n POST "$NT" /api/nodes "{\"name\":\"Deniz kazanimi\",\"parent_id\":\"$OUTCOMES\"}")" 200 "scope ile kazanim ekler"
DB "delete from user_scopes where user_id='$DENIZ' and scope='manage_event_outcomes'" >/dev/null
# Sabit adlar: slot ve widget adi koddan; aciklama serbest.
WID=$(DB "select id from nodes where parent_id='$ATOLYE' and attrs->>'slot'='widgets'")
ok "$(w w PATCH "$WT" "/api/nodes/$STEPS" '{"name":"Baska ad"}' | jq -r .error)" name_locked "slot adi sabit"
ok "$(wc_ w PATCH "$WT" "/api/nodes/$STEPS" '{"description":"Hazırlık adımları burada durur."}')" 200 "slot aciklamasi degisir"
R=$(w w POST "$WT" /api/nodes "{\"name\":\"otf form\",\"parent_id\":\"$WID\",\"attrs\":{\"widget\":\"otf\"}}")
OTFW=$(jq -r ".nodes[]|select(.parent_id==\"$WID\").id" <<<"$R")
ok "$(jq -r ".nodes[]|select(.id==\"$OTFW\").name" <<<"$R")" "Etkinlik talep formu (OTF)" "widget adi katalogdan, istekteki ad yok sayilir"
ok "$(w w PATCH "$WT" "/api/nodes/$OTFW" '{"name":"otf form"}' | jq -r .error)" name_locked "widget adi sabit"
R=$(w w PATCH "$WT" "/api/nodes/$OTFW" '{"attrs":{"widget":"supplies"}}')
ok "$(jq -r ".nodes[]|select(.id==\"$OTFW\").name" <<<"$R")" "Satın alımlar" "widget turu degisince ad katalogu izler"

t node_favorites
ok "$(w w PUT "$WT" "/api/nodes/$MALZEME/favorite" '' | jq -c .)" "[\"$MALZEME\"]" "favori eklenir"
ok "$(g w /api/meta | jq -c .me.favorite_nodes)" "[\"$MALZEME\"]" "meta'da"
ok "$(w w DELETE "$WT" "/api/nodes/$MALZEME/favorite" '' | jq -c .)" "[]" "favori cikar"

t node_inactive_parent
w w PATCH "$WT" "/api/nodes/$SALON" '{"is_active":false}' >/dev/null
ok "$(w w POST "$WT" /api/nodes "{\"name\":\"Yeni Alt Dugum\",\"node_type\":\"generic\",\"parent_id\":\"$SALON\"}" | jq -r .error)" inactive_parent "pasifin altina eklenemez"
ok "$(w w PATCH "$WT" "/api/nodes/$ULASIM" "{\"parent_id\":\"$SALON\"}" | jq -r .error)" inactive_parent "pasifin altina tasinamaz"
w w PATCH "$WT" "/api/nodes/$SALON" '{"is_active":true}' >/dev/null

t node_invalid_name
ok "$(w w POST "$WT" /api/nodes '{"name":"","node_type":"generic","parent_id":null}' | jq -r .error)" invalid_name "bos ad"
ok "$(w w POST "$WT" /api/nodes '{"name":"Kisa","node_type":"generic","parent_id":null}' | jq -r .error)" name_too_short "kisa ad"
LONG=$(printf 'a%.0s' $(seq 1 201))
ok "$(w w POST "$WT" /api/nodes "{\"name\":\"$LONG\",\"node_type\":\"generic\",\"parent_id\":null}" | jq -r .error)" invalid_name "201 karakter"

t node_invalid_parent
ok "$(w w POST "$WT" /api/nodes '{"name":"Gecersiz Ust Dugum","node_type":"generic","parent_id":"00000000-0000-0000-0000-000000000000"}' | jq -r .error)" invalid_parent "olmayan ust"

t node_types_no_team_pillar
# Takim ve pillar agactan ayrildi (spec/22): o turle yazma invalid_type,
# tur listeleri onlari icermez.
ok "$(w w POST "$WT" /api/nodes "{\"name\":\"Kalite Takımı\",\"node_type\":\"team\",\"parent_id\":\"$MALZEME\"}" | jq -r .error)" invalid_type "team turu ekleme"
ok "$(wc_ w POST "$WT" /api/nodes "{\"name\":\"Kalite\",\"node_type\":\"pillar\",\"parent_id\":null}")" 400 "pillar turu 400"
ok "$(w w PATCH "$WT" "/api/nodes/$ULASIM" '{"node_type":"team"}' | jq -r .error)" invalid_type "tur degisimi team"
R=$(g w /api/nodes)
ok "$(jq -r ".nodes[]|select(.id==\"$BUTCEN\").delete_counts.teams" <<<"$R")" 1 "delete_counts.teams (Maliye bagi)"
ok "$(jq -r ".nodes[]|select(.id==\"$ROOT1\").delete_counts.teams" <<<"$R")" 4 "alt agac toplami (4 seed bagi)"

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

SATIN=$(DB "select id from teams where name='Satın Alım'")
DB "insert into team_nodes (team_id,node_id) values ('$SATIN','$SALON')" >/dev/null
ok "$(wc_ w DELETE "$WT" "/api/nodes/$SALON" '')" 200 "admin kalici silmede yetenegi atlar"
ok "$(DB "select count(*) from nodes where id='$SALON'")" 0 "dugum gitti"
ok "$(DB "select count(*) from team_nodes where node_id='$SALON'")" 0 "team_nodes baglari cascade ile gitti"
ok "$(DB "select count(*) from teams where id='$SATIN'")" 1 "takim hayatta"
ok "$(DB "select count(*) from team_nodes where team_id='$SATIN'")" 2 "takimin diger baglari durur"

t node_activity_olgu
AC0=$(DB "select count(*) from activity where verb='node_changed'")
w w PATCH "$WT" "/api/nodes/$ULASIM" '{"name":"Ulaşım Planı","description":"Ulasim isleminin adimlari ve gerekli tedarik bilgileri ekipte paylasilir."}' >/dev/null
ok "$(DB "select count(*) from activity where verb='node_changed'")" "$((AC0+2))" "iki alan degisti, iki satir"
ok "$(DB "select detail from activity where verb='node_changed' and target_label='name' order by created_at desc limit 1")" '{"from":"Ulaşım & Konaklama","to":"Ulaşım Planı"}' "ad olgu, cumle degil"
ok "$(DB "select detail from activity where verb='node_changed' and target_label='description' order by created_at desc limit 1")" '{"from":null,"to":"Ulasim isleminin adimlari ve gerekli tedarik bilgileri ekipte paylasilir."}' "aciklama olgu"
w w PATCH "$WT" "/api/nodes/$ULASIM" '{"name":"Ulaşım Planı","description":"Ulasim isleminin adimlari ve gerekli tedarik bilgileri ekipte paylasilir."}' >/dev/null
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

# --- yonetim paneli (R3-F01..F05, spec/71) -----------------------------------
# Selin admin; Efe'ye manage_users panelden verilir; Deniz yetkisiz baslar.
U(){ printf '{"op":"%s","value":%s}' "$1" "$2"; }

t admin_gate
ok "$(code -b "$J/n" "$B/api/admin")" 403 "yetkisiz okuyamaz"
ok "$(wc_ w PATCH "$WT" "/api/admin/users/$EFE" "$(U grant_scope '"manage_users"')")" 200 "admin kapsam verir"
ok "$(DB "select detail from security_events where event_type='scope_granted' order by created_at desc limit 1")" manage_users "denetim izi"
ok "$(g e /api/admin | jq -r .is_admin)" false "manage_users okur"
ok "$(wc_ e POST "$ET" /api/admin/roles '{"name":"x","scopes":[]}')" 403 "manage_users rol tanimlayamaz"
ok "$(wc_ e PATCH "$ET" "/api/admin/users/$DENIZ" "$(U admin true)")" 403 "manage_users admin yapamaz"
ok "$(wc_ e PATCH "$ET" "/api/admin/users/$SELIN" "$(U active false)")" 403 "manage_users admini kapatamaz"
# Kalite kapisi ayari (spec/76): yalniz admin okur/yazar, sorular sabit.
ok "$(g e /api/admin/quality | jq -r .error)" forbidden "manage_users kalite ayarini okuyamaz"
ok "$(g w /api/admin/quality | jq -r .customized)" false "kalite: varsayilan calisiyor"
QC=$(g w /api/admin/quality | jq -c '.config | .questions.specific.min = 0.3')
ok "$(w w PUT "$WT" /api/admin/quality "$QC" | jq -r '[.config.questions.specific.min, .customized] | @csv')" "0.3,true" "kalite esigi kaydedildi"
ok "$(w w PUT "$WT" /api/admin/quality '{"questions":{}}' | jq -r .error)" quality_questions_mismatch "eksik soru reddedilir"
ok "$(w w PUT "$WT" /api/admin/quality "$(jq -c '.questions.context.min = 2' <<<"$QC")" | jq -r .error)" quality_min_invalid "gecersiz esik reddedilir"
ok "$(wc_ e PUT "$ET" /api/admin/quality "$QC")" 403 "manage_users kalite ayarini yazamaz"
ok "$(w w DELETE "$WT" /api/admin/quality '' | jq -r .customized)" false "kalite: varsayilana donus"
ok "$(w w PATCH "$WT" "/api/admin/users/$EFE" "$(U grant_scope '"yok_boyle"')" | jq -r .error)" invalid_scope "gecersiz kapsam"

t admin_grant_limits
# spec/75 A1: admin olmayan manage_users yalniz KENDINDE olani verir ve geri
# alir, manage_users'i hic, kendi satirina hic dokunmaz. Admin sinirsiz.
# Efe: edit_nodes + manage_users + Malzeme Temini dali.
ZEYNEP=$(DB "select id from users where name='Zeynep'")
SEA=$(DB "select count(*) from security_events where event_type='permission_denied' and actor_id='$EFE'")
ok "$(w e PATCH "$ET" "/api/admin/users/$EFE" "$(U grant_scope '"manage_teams"')" | jq -r .error)" self_permissions "kendine scope veremez"
ok "$(w e PATCH "$ET" "/api/admin/users/$EFE" "$(U revoke_scope '"edit_nodes"')" | jq -r .error)" self_permissions "kendinden de alamaz"
ok "$(wc_ e PATCH "$ET" "/api/admin/users/$EFE" "$(U active false)")" 403 "kendini kapatamaz (403)"
ok "$(w e PATCH "$ET" "/api/admin/users/$ZEYNEP" "$(U grant_scope '"manage_teams"')" | jq -r .error)" grant_not_held "kendinde olmayan scope"
ok "$(w e PATCH "$ET" "/api/admin/users/$DENIZ" "$(U revoke_scope '"manage_teams"')" | jq -r .error)" grant_not_held "veremeyecegini alamaz"
ok "$(w e PATCH "$ET" "/api/admin/users/$ZEYNEP" "$(U grant_scope '"manage_users"')" | jq -r .error)" grant_manage_users "manage_users verilemez"
ok "$(w e PATCH "$ET" "/api/admin/users/$ZEYNEP" "$(U grant_node "\"$URETIM\"")" | jq -r .error)" grant_not_held "kendi dali disi"
ok "$(DB "select count(*) from security_events where event_type='permission_denied' and actor_id='$EFE'")" "$((SEA+7))" "her red denetimde"
ok "$(DB "select count(*) from user_scopes where (user_id='$ZEYNEP' and scope in ('manage_teams','manage_users')) or (user_id='$EFE' and scope='manage_teams')")" 0 "reddedilen yazilmadi"
ok "$(wc_ e PATCH "$ET" "/api/admin/users/$ZEYNEP" "$(U grant_scope '"edit_nodes"')")" 200 "kendinde olani verir"
ok "$(wc_ e PATCH "$ET" "/api/admin/users/$ZEYNEP" "$(U grant_node "\"$TEDARIK\"")")" 200 "kendi dalinin altini verir"
ok "$(DB "select count(*) from user_node_scopes where user_id='$ZEYNEP' and node_id='$TEDARIK'")" 1 "dal yazildi"
ok "$(wc_ e PATCH "$ET" "/api/admin/users/$ZEYNEP" "$(U revoke_node "\"$TEDARIK\"")")" 200 "kendi dalinda geri alir"
ok "$(wc_ e PATCH "$ET" "/api/admin/users/$ZEYNEP" "$(U revoke_scope '"edit_nodes"')")" 200 "kendinde olani geri alir"
ok "$(wc_ w PATCH "$WT" "/api/admin/users/$SELIN" "$(U grant_scope '"manage_teams"')")" 200 "admin kendi satirina yazar"
ok "$(wc_ w PATCH "$WT" "/api/admin/users/$ZEYNEP" "$(U grant_node "\"$URETIM\"")")" 200 "admin her dali verir"
w w PATCH "$WT" "/api/admin/users/$SELIN" "$(U revoke_scope '"manage_teams"')" >/dev/null
w w PATCH "$WT" "/api/admin/users/$ZEYNEP" "$(U revoke_node "\"$URETIM\"")" >/dev/null

t admin_users
ok "$(w e POST "$ET" /api/admin/users '{"email":" Yeni@X.org ","name":"Yeni"}' | jq -r '.people[]|select(.email=="yeni@x.org").name')" Yeni "davet, e-posta kucuk harf"
ok "$(w e POST "$ET" /api/admin/users '{"email":"YENI@x.org","name":"Iki"}' | jq -r .error)" user_exists "ayni e-posta"
ok "$(w e POST "$ET" /api/admin/users '{"email":"bozuk","name":"x"}' | jq -r .error)" invalid_email "bozuk e-posta"
YENI=$(DB "select id from users where email='yeni@x.org'")
w e PATCH "$ET" "/api/admin/users/$YENI" "$(U active false)" >/dev/null
ok "$(DB "select detail from security_events where event_type='deactivation' and email='yeni@x.org'")" kapatildi "kapatma denetim izi"

t admin_lockout
ok "$(w w PATCH "$WT" "/api/admin/users/$SELIN" "$(U admin false)" | jq -r .error)" self_admin "kendi adminligini kapatamaz"
ok "$(w w PATCH "$WT" "/api/admin/users/$SELIN" "$(U active false)" | jq -r .error)" last_admin "son admin kapatilamaz"
w w PATCH "$WT" "/api/admin/users/$DENIZ" "$(U admin true)" >/dev/null
ok "$(wc_ n PATCH "$NT" "/api/admin/users/$SELIN" "$(U admin false)")" 200 "ikinci admin varken dusurulur"
w n PATCH "$NT" "/api/admin/users/$SELIN" "$(U admin true)" >/dev/null
w w PATCH "$WT" "/api/admin/users/$DENIZ" "$(U admin false)" >/dev/null
ok "$(DB "select count(*) from security_events where event_type in ('admin_granted','admin_revoked')")" 4 "her degisim denetimde"

t admin_roles
R=$(w w POST "$WT" /api/admin/roles '{"name":"Yapici","color":"#e5484d","scopes":["edit_deadline","edit_nodes"],"node_ids":["'"$MALZEME"'"]}')
ROL=$(jq -r '.roles[]|select(.name=="Yapici").id' <<<"$R")
ok "$(jq -r '.roles[]|select(.name=="Yapici").color' <<<"$R")" '#e5484d' "rol rengi"
ok "$(jq -r '.roles[]|select(.name=="Yapici").node_ids[0]' <<<"$R")" "$MALZEME" "rol dali"
ok "$(w w POST "$WT" /api/admin/roles '{"name":"Yapici","scopes":[]}' | jq -r .error)" role_exists "ayni ad"
ok "$(w w POST "$WT" /api/admin/roles '{"name":"Z","scopes":["yok"]}' | jq -r .error)" invalid_scope "gecersiz kapsam"
ok "$(w w POST "$WT" /api/admin/roles '{"name":"Renk","color":"red","scopes":[]}' | jq -r .error)" invalid_color "gecersiz rol rengi"
ok "$(w w POST "$WT" /api/admin/roles '{"name":"Dali","node_ids":["00000000-0000-0000-0000-000000000000"]}' | jq -r .error)" invalid_parent "gecersiz rol dali"
# A1: rolun BUTUN scope ve dal izinleri atayanda olmali; manage_users iceren rol hic.
ok "$(w e PATCH "$ET" "/api/admin/users/$DENIZ" "$(U grant_role "\"$ROL\"")" | jq -r .error)" grant_not_held "rolun scope'u atayanda yok"
w w PATCH "$WT" "/api/admin/users/$EFE" "$(U grant_scope '"edit_deadline"')" >/dev/null
ok "$(wc_ e PATCH "$ET" "/api/admin/users/$DENIZ" "$(U grant_role "\"$ROL\"")")" 200 "manage_users kendinde olani ATAYABILIR"
ok "$(g n /api/nodes | jq -r ".nodes[]|select(.id==\"$TEDARIK\").can_edit")" true "rol dali duzenleme verir"
ok "$(g n /api/meta | jq -r ".users[]|select(.id==\"$DENIZ\").roles[]|select(.id==\"$ROL\").color")" '#e5484d' "meta rol rengi"
ROL2=$(w w POST "$WT" /api/admin/roles '{"name":"Operasyon","color":"#5b8cff","scopes":["edit_nodes"],"node_ids":["'"$MALZEME"'"]}' | jq -r '.roles[]|select(.name=="Operasyon").id')
ok "$(wc_ e PATCH "$ET" "/api/admin/users/$DENIZ" "$(U grant_role \"$ROL2\")")" 200 "ikinci rol de atanabilir"
ok "$(g w /api/admin | jq -r ".people[]|select(.id==\"$DENIZ\").role_ids|length")" 2 "birden fazla rol"
ok "$(g w /api/admin | jq -c ".people[]|select(.id==\"$DENIZ\").scopes[]|select(.name==\"edit_nodes\")|[.direct,(.via_roles|length)]")" '[true,2]' "rol scope tek satir"
ROLWIDE=$(w w POST "$WT" /api/admin/roles '{"name":"Genis dal","scopes":["edit_nodes"],"node_ids":["'"$URETIM"'"]}' | jq -r '.roles[]|select(.name=="Genis dal").id')
ok "$(w e PATCH "$ET" "/api/admin/users/$ZEYNEP" "$(U grant_role \"$ROLWIDE\")" | jq -r .error)" grant_not_held "sahip olmadigi rol dali"
ROLMU=$(w w POST "$WT" /api/admin/roles '{"name":"Kisi yonetimi","scopes":["manage_users"]}' | jq -r '.roles[]|select(.name=="Kisi yonetimi").id')
ok "$(w e PATCH "$ET" "/api/admin/users/$ZEYNEP" "$(U grant_role "\"$ROLMU\"")" | jq -r .error)" grant_manage_users "manage_users iceren rol verilemez"
ok "$(wc_ w PATCH "$WT" "/api/admin/users/$ZEYNEP" "$(U grant_role "\"$ROLMU\"")")" 200 "admin verir"
ok "$(w e PATCH "$ET" "/api/admin/users/$ZEYNEP" "$(U revoke_role "\"$ROLMU\"")" | jq -r .error)" grant_manage_users "manage_users rolunu geri de alamaz"
w w DELETE "$WT" "/api/admin/roles/$ROLMU" '' >/dev/null
w w PATCH "$WT" "/api/admin/users/$DENIZ" "$(U grant_scope '"create_tags"')" >/dev/null
w w PATCH "$WT" "/api/admin/roles/$ROL" '{"scopes":["edit_deadline","create_tags"]}' >/dev/null
ok "$(g w /api/admin | jq -c ".people[]|select(.id==\"$DENIZ\").scopes[]|select(.name==\"create_tags\")|[.direct,(.via_roles|length)]")" "[true,1]" "kaynak: dogrudan + rol"
ok "$(g n /api/meta | jq -r '.me.scopes|index("edit_deadline")!=null')" true "rol duzenlemesi aninda yansir"
w w DELETE "$WT" "/api/admin/roles/$ROL" '' >/dev/null
ok "$(g n /api/meta | jq -c '[.me.scopes|index("edit_deadline"), (index("create_tags")!=null)]')" "[null,true]" "rol gitti, dogrudan verilen kaldi"
w w DELETE "$WT" "/api/admin/roles/$ROL2" '' >/dev/null
ok "$(g n /api/nodes | jq -r ".nodes[]|select(.id==\"$TEDARIK\").can_edit")" false "son rol silinince dal izni kalkar"

t admin_branch_scope
# Python'da dal izninin arayuzu yoktu; edit_nodes dalsiz ise yaramaz.
w w PATCH "$WT" "/api/admin/users/$DENIZ" "$(U grant_node "\"$MALZEME\"")" >/dev/null
ok "$(g n /api/nodes | jq -r ".nodes[]|select(.id==\"$TEDARIK\").can_edit")" true "verilen dalda duzenler"
w w PATCH "$WT" "/api/admin/users/$DENIZ" "$(U revoke_node "\"$MALZEME\"")" >/dev/null
ok "$(g n /api/nodes | jq -r ".nodes[]|select(.id==\"$TEDARIK\").can_edit")" false "geri alinca duzenleyemez"

# --- takim uyeligi (R4-F09) ---------------------------------------------------
t team_members
TM=$(DB "select team_id from team_members where user_id='$SELIN' and role='lead'")
TMC=$(DB "select chat_id from teams where id='$TM'")
M(){ printf '{"user_id":"%s","role":"%s"}' "$1" "$2"; }
ok "$(wc_ n POST "$NT" "/api/teams/$TM/members" "$(M "$DENIZ" member)")" 403 "manage_teams yoksa 403"
ok "$(w w POST "$WT" "/api/teams/$TM/members" "$(M "$DENIZ" member)" | jq -r ".members[]|select(.user_id==\"$DENIZ\").role")" member "admin ekler"
w w POST "$WT" "/api/teams/$TM/members" "$(M "$DENIZ" mentor)" >/dev/null
w w POST "$WT" "/api/teams/$TM/members" "$(M "$DENIZ" mentor)" >/dev/null   # ayni rol: olgu yok
ok "$(w w DELETE "$WT" "/api/teams/$TM/members/$DENIZ" '' | jq -r "[.members[]|select(.user_id==\"$DENIZ\")]|length")" 0 "cikar"
ok "$(wc_ w DELETE "$WT" "/api/teams/$TM/members/$DENIZ" '')" 404 "uye degilse 404"
ok "$(DB "select string_agg(verb, ',' order by created_at) from activity where chat_id='$TMC' and verb like 'member_%'")" "member_added,member_role,member_removed" "duvara olgu, ayni rol yazilmaz"
ok "$(DB "select detail from activity where chat_id='$TMC' and verb='member_role'")" '{"from":"member","to":"mentor"}' "rol degisimi once/sonra"

# --- takim ve pillar yazmalari (spec/22) ---------------------------------------
t teams_crud
ok "$(w w POST "$WT" /api/teams '{"name":"Ekip","description":null,"color":null}' | jq -r .error)" name_too_short "kisa takim adi"
DB "insert into user_scopes (user_id,scope) values ('$DENIZ','manage_teams')" >/dev/null
ok "$(w n POST "$NT" /api/teams '{"name":"Uzun Takim","description":"kisa","color":null}' | jq -r .error)" description_too_short "kisa aciklama kapsam olmadan"
DB "insert into user_scopes (user_id,scope) values ('$DENIZ','bypass_text_quality')" >/dev/null
R=$(w n POST "$NT" /api/teams '{"name":"Kisa Aciklama","description":"x","color":null}')
SHORT_TEAM=$(jq -r .id <<<"$R")
ok "$([ "$SHORT_TEAM" != null ] && echo V || echo Y)" V "kisa aciklama kapsamla"
ok "$(wc_ n DELETE "$NT" "/api/teams/$SHORT_TEAM" '')" 204 "kapsam testi temizle"
DB "delete from user_scopes where user_id='$DENIZ' and scope in ('manage_teams','bypass_text_quality')" >/dev/null
R=$(w w POST "$WT" /api/teams '{"name":"Bakım Takımı","description":"Makine bakımını planlar ve ekipman arızalarını düzenli olarak izler.","color":"#0f766e"}')
TID=$(jq -r .id <<<"$R")
ok "$(jq -c 'keys' <<<"$R")" '["id"]' "201 { id }"
ok "$(wc_ w POST "$WT" /api/teams '{"name":"Bakım2","description":null,"color":null}')" 201 "201"
TID2=$(DB "select id from teams where name='Bakım2'")
ok "$(DB "select count(*) from chats where id=(select chat_id from teams where id='$TID')")" 1 "sohbetiyle birlikte"
ok "$(DB "select count(*) from activity where verb='team_created' and chat_id=(select chat_id from teams where id='$TID')")" 1 "team_created duvara"
ok "$(w w POST "$WT" /api/teams '{"name":"Bakım Takımı","description":null,"color":null}' | jq -r .error)" name_taken "ayni ad"
ok "$(wc_ w POST "$WT" /api/teams '{"name":"Bakım Takımı","description":null,"color":null}')" 409 "409"
ok "$(w w POST "$WT" /api/teams '{"name":"  ","description":null,"color":null}' | jq -r .error)" invalid_name "bos ad"
ok "$(wc_ n POST "$NT" /api/teams '{"name":"Yetkisiz","description":null,"color":null}')" 403 "manage_teams yoksa 403"
ok "$(DB "select count(*) from teams where name='Yetkisiz'")" 0 "403 yazmaz"

t teams_patch
ok "$(wc_ w PATCH "$WT" "/api/teams/$TID" '{"name":"Bakım Ekibi"}')" 204 "ad"
ok "$(DB "select name||'|'||description from teams where id='$TID'")" "Bakım Ekibi|Makine bakımını planlar ve ekipman arızalarını düzenli olarak izler." "verilmeyen alan degismez"
w w PATCH "$WT" "/api/teams/$TID" '{"description":null,"color":"#111111"}' >/dev/null
ok "$(DB "select coalesce(description,'NULL')||'|'||color from teams where id='$TID'")" "NULL|#111111" "null siler"
ok "$(w w PATCH "$WT" "/api/teams/$TID" '{"name":"Maliye"}' | jq -r .error)" name_taken "ad cakismasi"
ok "$(DB "select detail from activity where verb='team_renamed' and chat_id=(select chat_id from teams where id='$TID')")" '{"from":"Bakım Takımı","to":"Bakım Ekibi"}' "team_renamed olgusu"
ok "$(wc_ w PATCH "$WT" "/api/teams/00000000-0000-0000-0000-000000000000" '{"name":"x"}')" 404 "olmayan takim"
ok "$(wc_ n PATCH "$NT" "/api/teams/$TID" '{"name":"x"}')" 403 "yetkisiz"

t team_node_links
ok "$(wc_ w PUT "$WT" "/api/teams/$TID/nodes/$MEKAN" '')" 204 "bagla"
ok "$(wc_ w PUT "$WT" "/api/teams/$TID/nodes/$MEKAN" '')" 204 "idempotent"
ok "$(DB "select count(*) from team_nodes where team_id='$TID' and node_id='$MEKAN'")" 1 "tek satir"
ok "$(DB "select string_agg(verb||':'||target_label, ',') from activity where verb like 'team_node_%' and chat_id=(select chat_id from teams where id='$TID')")" "team_node_linked:Mekan & Lojistik" "tekrar baglama iz birakmaz"
ok "$(g w /api/meta | jq -c ".teams[]|select(.id==\"$TID\").node_ids")" "[\"$MEKAN\"]" "meta.node_ids"
ok "$(w w PUT "$WT" "/api/teams/$TID/nodes/00000000-0000-0000-0000-000000000000" '' | jq -r .error)" invalid_node "olmayan dugum"
DB "update nodes set is_active=false where id='$ULASIM'" >/dev/null
ok "$(w w PUT "$WT" "/api/teams/$TID/nodes/$ULASIM" '' | jq -r .error)" invalid_node "pasif dugum"
DB "update nodes set is_active=true where id='$ULASIM'" >/dev/null
ok "$(wc_ w PUT "$WT" "/api/teams/00000000-0000-0000-0000-000000000000/nodes/$MEKAN" '')" 404 "olmayan takim"
ok "$(wc_ n PUT "$NT" "/api/teams/$TID/nodes/$ULASIM" '')" 403 "yetkisiz"
ok "$(g w /api/nodes | jq -r ".nodes[]|select(.id==\"$MEKAN\").delete_counts.teams")" 1 "delete_counts.teams"
ok "$(wc_ w DELETE "$WT" "/api/teams/$TID/nodes/$MEKAN" '')" 204 "kopar"
ok "$(wc_ w DELETE "$WT" "/api/teams/$TID/nodes/$MEKAN" '')" 204 "yoksa da 204"
ok "$(DB "select string_agg(verb, ',' order by created_at) from activity where verb like 'team_node_%' and chat_id=(select chat_id from teams where id='$TID')")" "team_node_linked,team_node_unlinked" "kopma bir kez yazildi"

t teams_delete
TREC=$(w w POST "$WT" /api/records "{\"kind\":\"task\",\"title\":\"Takim silme\",\"description\":\"Takim silme davranisini dogrulamak icin olusturulan kayit aciklamasi.\",\"unit_id\":\"$UNIT\",\"owner_id\":null,\"team_id\":\"$TID2\"}" | jq -r .id)
TCHAT=$(DB "select chat_id from teams where id='$TID2'")
ok "$(wc_ n DELETE "$NT" "/api/teams/$TID2" '')" 403 "yetkisiz"
ok "$(wc_ w DELETE "$WT" "/api/teams/$TID2" '')" 204 "sil"
ok "$(DB "select count(*) from teams where id='$TID2'")" 0 "gitti"
ok "$(DB "select count(*) from chats where id='$TCHAT'")" 0 "sohbet tetikleyiciyle gitti"
ok "$(DB "select coalesce(team_id::text,'NULL') from records where id='$TREC'")" NULL "records.team_id NULL"
ok "$(wc_ w DELETE "$WT" "/api/teams/$TID2" '')" 404 "ikinci silme 404"

t pillars_crud
ok "$(w w POST "$WT" /api/pillars '{"name":"abc","description":null,"color":null}' | jq -r .error)" name_too_short "kisa pillar adi"
DB "insert into user_scopes (user_id,scope) values ('$DENIZ','manage_teams')" >/dev/null
ok "$(w n POST "$NT" /api/pillars '{"name":"Valid Pillar","description":"kisa","color":null}' | jq -r .error)" description_too_short "kisa pillar aciklamasi"
DB "delete from user_scopes where user_id='$DENIZ' and scope='manage_teams'" >/dev/null
R=$(w w POST "$WT" /api/pillars '{"name":"Çevre","description":"Çevre çalışmaları ve sürdürülebilirlik hedeflerini kulüp genelinde koordine eder.","color":"#0f766e"}')
PID=$(jq -r .id <<<"$R"); PTID=$(jq -r .team_id <<<"$R")
ok "$(jq -c 'keys' <<<"$R")" '["id","team_id"]' "201 { id, team_id }"
ok "$(DB "select team_id from pillars where id='$PID'")" "$PTID" "ozel takim bagli"
ok "$(DB "select name||'|'||description||'|'||color from teams where id='$PTID'")" "Çevre|Çevre çalışmaları ve sürdürülebilirlik hedeflerini kulüp genelinde koordine eder.|#0f766e" "takim pillar'dan turedi"
ok "$(DB "select count(*) from chats where id=(select chat_id from teams where id='$PTID')")" 1 "sohbet var"
ok "$(DB "select sort_order from pillars where id='$PID'")" 2 "sona eklenir"
ok "$(w w POST "$WT" /api/pillars '{"name":"Çevre","description":null,"color":null}' | jq -r .error)" name_taken "pillar adi"
ok "$(wc_ w POST "$WT" /api/pillars '{"name":"Maliye","description":null,"color":null}')" 409 "takim adiyla cakisma"
ok "$(DB "select count(*) from pillars")" 3 "basarisiz POST pillar birakmaz"
ok "$(DB "select count(*) from teams")" 7 "...takim da (islem geri alindi)"
ok "$(w w POST "$WT" /api/pillars '{"name":"","description":null,"color":null}' | jq -r .error)" invalid_name "bos ad"
ok "$(wc_ n POST "$NT" /api/pillars '{"name":"Yetkisiz","description":null,"color":null}')" 403 "manage_teams yoksa 403"
R=$(g w /api/meta)
ok "$(jq -r ".teams[]|select(.id==\"$PTID\").pillar_id" <<<"$R")" "$PID" "meta: takim.pillar_id"
ok "$(jq -c '[.pillars[].name]' <<<"$R")" '["Güvenlik","Kalite","Çevre"]' "meta.pillars sirasi"

t pillars_patch
ok "$(wc_ w PATCH "$WT" "/api/pillars/$PID" '{"name":"Çevre ve İSG","description":null,"is_active":false,"sort_order":-1}')" 204 "204"
ok "$(DB "select name||'|'||coalesce(description,'NULL')||'|'||is_active||'|'||sort_order from pillars where id='$PID'")" "Çevre ve İSG|NULL|false|-1" "pillar alanlari"
ok "$(DB "select name||'|'||coalesce(description,'NULL') from teams where id='$PTID'")" "Çevre ve İSG|NULL" "ozel takima da yazildi"
ok "$(g w /api/meta | jq -c '[.pillars[]|[.name,.is_active]]')" '[["Çevre ve İSG",false],["Güvenlik",true],["Kalite",true]]' "pasifler de gelir, sort_order'a gore"
ok "$(DB "select detail from activity where verb='team_renamed' and chat_id=(select chat_id from teams where id='$PTID')")" '{"from":"Çevre","to":"Çevre ve İSG"}' "team_renamed duvara"
ok "$(w w PATCH "$WT" "/api/pillars/$PID" '{"name":"Kalite"}' | jq -r .error)" name_taken "ad cakismasi"
ok "$(DB "select name from teams where id='$PTID'")" "Çevre ve İSG" "cakisma takimi bozmaz"
ok "$(w w PATCH "$WT" "/api/teams/$PTID" '{"name":"Baska"}' | jq -r .error)" team_is_pillar "ozel takimin adi takimdan degismez"
ok "$(wc_ w PATCH "$WT" "/api/teams/$PTID" '{"name":"Baska"}')" 409 "409"
ok "$(w w DELETE "$WT" "/api/teams/$PTID" '' | jq -r .error)" team_is_pillar "ozel takim silinmez"
ok "$(wc_ w PATCH "$WT" "/api/pillars/00000000-0000-0000-0000-000000000000" '{"name":"x"}')" 404 "olmayan pillar"
ok "$(wc_ n PATCH "$NT" "/api/pillars/$PID" '{"name":"x"}')" 403 "yetkisiz"

t records_pillar
ok "$(w w POST "$WT" /api/records "{\"kind\":\"task\",\"title\":\"Pasif pillar\",\"description\":\"Bu kayit pasif pillar secimini reddettigini dogrular.\",\"unit_id\":\"$UNIT\",\"owner_id\":null,\"pillar_id\":\"$PID\"}" | jq -r .error)" invalid_pillar "pasif pillar"
ok "$(w w POST "$WT" /api/records "{\"kind\":\"task\",\"title\":\"Yok pillar\",\"description\":\"Bu kayit dugum kimliginin pillar yerine gecmedigini sinar.\",\"unit_id\":\"$UNIT\",\"owner_id\":null,\"pillar_id\":\"$UNIT\"}" | jq -r .error)" invalid_pillar "dugum kimligi pillar degil"
w w PATCH "$WT" "/api/pillars/$PID" '{"is_active":true}' >/dev/null
PREC=$(w w POST "$WT" /api/records "{\"kind\":\"task\",\"title\":\"Pillar kaydi\",\"description\":\"Aktif pillar kaydinin liste ve PATCH filtrelerini dogrulamak icin kullanilir.\",\"unit_id\":\"$UNIT\",\"owner_id\":null,\"pillar_id\":\"$PID\"}" | jq -r .id)
ok "$(DB "select pillar_id from records where id='$PREC'")" "$PID" "aktif pillar"
KALITE=$(DB "select id from pillars where name='Kalite'")
# Kalite'nin iki tohum kaydindan biri (Kapak Ünitesi) node_hard_delete'te gitti.
ok "$(g w "/api/records?pillar=$KALITE" | jq length)" 1 "?pillar= pillars tablosuna bakar"
ok "$(g w "/api/records?pillar=$PID" | jq -r '.[0].title')" "Pillar kaydi" "yeni pillar suzgeci"
ok "$(w w PATCH "$WT" "/api/records/$PREC" "{\"field\":\"pillar_id\",\"value\":\"$UNIT\"}" | jq -r .error)" invalid_pillar "PATCH da pillars'a bakar"
ok "$(w w PATCH "$WT" "/api/records/$PREC" "{\"field\":\"pillar_id\",\"value\":\"$KALITE\"}" | jq -r .record.pillar_id)" "$KALITE" "PATCH pillar"
w w PATCH "$WT" "/api/records/$PREC" "{\"field\":\"pillar_id\",\"value\":\"$PID\"}" >/dev/null

t pillars_delete
DB "insert into user_scopes (user_id,scope) values ('$EFE','manage_teams')" >/dev/null
ok "$(wc_ e DELETE "$ET" "/api/pillars/$PID" '')" 403 "manage_teams yetmez, yalniz admin"
ok "$(wc_ e PATCH "$ET" "/api/pillars/$PID" '{"sort_order":9}')" 204 "manage_teams yazar"
DB "delete from user_scopes where user_id='$EFE' and scope='manage_teams'" >/dev/null
PCHAT=$(DB "select chat_id from teams where id='$PTID'")
ok "$(wc_ w DELETE "$WT" "/api/pillars/$PID" '')" 204 "admin siler"
ok "$(DB "select count(*) from pillars where id='$PID'")" 0 "pillar gitti"
ok "$(DB "select count(*) from teams where id='$PTID'")" 0 "ozel takim gitti"
ok "$(DB "select count(*) from chats where id='$PCHAT'")" 0 "sohbet gitti"
ok "$(DB "select coalesce(pillar_id::text,'NULL') from records where id='$PREC'")" NULL "records.pillar_id NULL"
ok "$(wc_ w DELETE "$WT" "/api/pillars/$PID" '')" 404 "ikinci silme 404"

# --- anma (R4-F03) -----------------------------------------------------------
t mention_invites
ok "$(g n "/api/records/$VEKALET" | jq -r .access.can_edit)" false "anilmadan once duzenleyemez"
w w POST "$WT" "/api/chats/$VCHAT/messages" '{"body":"@Deniz bakar misin? @all","reply_to_id":null}' >/dev/null
ok "$(DB "select count(*) from record_participants where record_id='$VEKALET' and user_id='$DENIZ'")" 1 "@kisi karta katilimci olur"
ok "$(g n "/api/records/$VEKALET" | jq -r .access.can_edit)" true "katilimci duzenler (mail forward)"
w w POST "$WT" "/api/teams/$TM/members" "$(M "$DENIZ" member)" >/dev/null
TMSG=$(DB "select count(*) from record_participants")
w w POST "$WT" "/api/chats/$TMC/messages" '{"body":"@Efe duvarda","reply_to_id":null}' >/dev/null
ok "$(DB "select count(*) from record_participants")" "$TMSG" "takim duvarinda davet yok"

# --- ekler (R3-F08..F13) -------------------------------------------------------
# Deniz VEKALET'e anmayla katilimci oldu (yukarida): o sohbete yazabilir.
t attachments
base64 -d <<<'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' >"$J/px.png"
up(){ curl -s -b "$J/$1" -X POST -H "X-CSRF-Token: $2" --data-binary "@$3" "$B/api/attachments?name=${4:-a.png}"; }
A1=$(up n "$NT" "$J/px.png" "../../etc/foto.png" | jq -r .id)
ok "$(DB "select mime||' '||original_name from attachments where id='$A1'")" "image/png foto.png" "tur baytlardan, ad yolsuz"
printf 'photo.jpg ama PDF' >"$J/bad.jpg"
ok "$(up n "$NT" "$J/bad.jpg" | jq -r .error)" bad_file_type "uzantiya guvenilmez"
head -c 11000000 /dev/zero >"$J/big"
ok "$(up n "$NT" "$J/big" | jq -r .error)" file_too_big "10 MB siniri"
ok "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' -b "$J/n" "$B/api/attachments/$A1/thumb")" "200 image/jpeg" "kucuk resim"
ok "$(w w POST "$WT" "/api/chats/$VCHAT/messages" "{\"body\":\"\",\"attachment_ids\":[\"$A1\"]}" | jq -r .error)" invalid_attachment "baskasinin eki asilamaz"
MID=$(w n POST "$NT" "/api/chats/$VCHAT/messages" "{\"body\":\"\",\"attachment_ids\":[\"$A1\"]}" | jq -r .id)
ok "$(g n "/api/chats/$VCHAT/feed" | jq -r ".attachments[\"$MID\"][0].id")" "$A1" "akista mesajin eki"
ok "$(w w POST "$WT" "/api/chats/$VCHAT/messages" "{\"body\":\"x\",\"attachment_ids\":[\"$A1\"]}" | jq -r .error)" invalid_attachment "ek iki kez baglanmaz"
ok "$(w n POST "$NT" "/api/chats/$BCHAT/messages" "{\"body\":\"\",\"attachment_ids\":[\"$A1\"]}" | jq -r .error)" invalid_attachment "kamera eki baska hedefte tekrar kullanilmaz"
A2=$(up n "$NT" "$J/px.png" | jq -r .id)
M2=$(w n POST "$NT" "/api/chats/$BCHAT/messages" "{\"body\":\"\",\"attachment_ids\":[\"$A2\"]}" | jq -r .id)
ok "$(g n "/api/chats/$BCHAT/feed" | jq -r ".attachments[\"$M2\"][0].id")" "$A2" "ayni fotograf hedefe bagimsiz yuklenir"

t attachment_tags
ok "$(wc_ n POST "$NT" "/api/attachments/$A1/tags" '{"name":"İstanbul"}')" 403 "tag_media yoksa 403"
w w POST "$WT" "/api/attachments/$A1/tags" '{"name":"İstanbul"}' >/dev/null
ok "$(w w POST "$WT" "/api/attachments/$A1/tags" '{"name":"istanbul"}' | jq -r '.tags|length')" 1 "slug tekil: ayni etiket"
TAG=$(DB "select id from tags where slug='istanbul'")
ok "$(w w DELETE "$WT" "/api/attachments/$A1/tags/$TAG" '' | jq -r '.tags|length')" 0 "etiket cikar"

t attachment_delete
ok "$(wc_ e DELETE "$ET" "/api/attachments/$A1" '')" 403 "yukleyen degilse silemez"
ok "$(wc_ n DELETE "$NT" "/api/attachments/$A1" '')" 204 "yukleyen siler"
ok "$(code -b "$J/n" "$B/api/attachments/$A1")" 404 "dosya gitti"
ok "$(g n "/api/chats/$VCHAT/feed" | jq -r ".attachments[\"$MID\"][0].deleted")" true "mesaj kalir, mezar tasi"

# --- kart bloklari (R4-F01, F02, F12) -------------------------------------------
# Iletisim dalinda kayit: Efe (Malzeme) ve Deniz (Uretim) duzenleyemez.
t cards
KR=$(w w POST "$WT" /api/records "{\"kind\":\"task\",\"title\":\"Kart denemesi\",\"description\":\"Toplanti ve katilim bilgilerini gosteren kartlari burada test edecegiz.\",\"unit_id\":\"$ILETISIM\",\"owner_id\":null,\"card_types\":[\"meeting\",\"pool\",\"media\"]}" | jq -r .id)
ok "$(g n "/api/records/$KR" | jq -r '[.access.can_edit, (.cards|map(.card_type)|join(","))]|join(" ")')" "false meeting,pool,media" "acilista kart secici"
KM=$(g w "/api/records/$KR" | jq -r '.cards[]|select(.card_type=="meeting").id')
KP=$(g w "/api/records/$KR" | jq -r '.cards[]|select(.card_type=="pool").id')
KMD=$(g w "/api/records/$KR" | jq -r '.cards[]|select(.card_type=="media").id')
ok "$(w w PATCH "$WT" "/api/cards/$KM" '{"title":"Planlama","data":{"when":"2026-10-01T18:30","link":"https://meet.x/a","evil":"x"}}' | jq -c ".cards[]|select(.id==\"$KM\").data")" '{"link":"https://meet.x/a","title":"Planlama","when":"2026-10-01T18:30"}' "beyaz liste"
ok "$(w w PATCH "$WT" "/api/cards/$KM" '{"data":{"link":"javascript:alert(1)"}}' | jq -r .error)" invalid_link "yalniz http(s) baglanti"
ok "$(w w POST "$WT" "/api/records/$KR/cards" '{"card_type":"survey"}' | jq -r .error)" invalid_card_type "bilinmeyen tur eklenemez"
ok "$(wc_ n POST "$NT" "/api/records/$KR/cards" '{"card_type":"pool"}')" 403 "duzenleyemeyen kart ekleyemez"

t card_signups
ok "$(w n PUT "$NT" "/api/cards/$KP/signup" '{"answer":"yes"}' | jq -r ".cards[]|select(.id==\"$KP\").signups[0].user_id")" "$DENIZ" "katilim duzenleme istemez"
ok "$(w n PUT "$NT" "/api/cards/$KP/signup" '{"answer":"maybe"}' | jq -r .error)" invalid_answer "havuzda belki yok"
w e PUT "$ET" "/api/cards/$KM/signup" '{"answer":"maybe","note":"gec kalirim"}' >/dev/null
ok "$(w w PATCH "$WT" "/api/cards/$KM" '{"title":"Planlama 2"}' | jq -r ".cards[]|select(.id==\"$KM\").signups[0].note")" "gec kalirim" "duzenleme katilimi silmez"
ok "$(w n PUT "$NT" "/api/cards/$KP/signup" '{"answer":null}' | jq -r ".cards[]|select(.id==\"$KP\").signups|length")" 0 "geri cekil"

t card_media
KA=$(up w "$WT" "$J/px.png" | jq -r .id)
ok "$(w w POST "$WT" "/api/cards/$KMD/attachments" "{\"attachment_ids\":[\"$KA\"]}" | jq -r ".cards[]|select(.id==\"$KMD\").attachments[0].id")" "$KA" "medya kartina gorsel"
ok "$(w w POST "$WT" "/api/cards/$KM/attachments" "{\"attachment_ids\":[\"$KA\"]}" | jq -r .error)" invalid_card_type "yalniz medya kartina"
ok "$(w w DELETE "$WT" "/api/cards/$KMD" '' | jq -r '.cards|length')" 2 "kart silinir"
ok "$(DB "select count(*) from card_attachments where attachment_id='$KA'")" 0 "ek bagsiz kalir (supurmeye)"

# --- yetki kararlari (spec/75 §6, §7; 2026-10-03) -------------------------------
CAN=$(DB "select id from users where name='Can'")
curl -s -c "$J/c2" -o /dev/null "$B/api/auth/dev-login?user_id=$CAN"
CT=$(curl -s -b "$J/c2" "$B/api/me" | jq -r .csrf)
OWN(){ printf '{"field":"owner_id","value":%s}' "$1"; }

t record_owner_change
# A2: sorumluyu mevcut sorumlu, admin ya da birimin dal editoru degistirir.
# Deniz katilimci (can_edit) ama Tedarikci Secimi onun dali degil; Efe'nin
# dali (Malzeme Temini) onu kapsiyor.
OR=$(w w POST "$WT" /api/records "{\"kind\":\"task\",\"title\":\"Sorumlu denemesi\",\"description\":\"Kayit sorumlusu degistirme yetkisi bu icerik uzerinden sinanir.\",\"unit_id\":\"$TEDARIK\",\"owner_id\":\"$SELIN\"}" | jq -r .id)
w w PUT "$WT" "/api/records/$OR/participants/$DENIZ" '' >/dev/null
ok "$(w n PATCH "$NT" "/api/records/$OR" "$(OWN "\"$DENIZ\"")" | jq -r .error)" owner_change_denied "duzenleyen kendini sorumlu yapamaz"
ok "$(wc_ n PATCH "$NT" "/api/records/$OR" "$(OWN null)")" 403 "sorumluyu bosaltamaz"
ok "$(DB "select owner_id from records where id='$OR'")" "$SELIN" "degismedi"
ok "$(wc_ w PATCH "$WT" "/api/records/$OR" "$(OWN null)")" 200 "admin bosaltir"
ok "$(w n PATCH "$NT" "/api/records/$OR" "$(OWN "\"$ZEYNEP\"")" | jq -r .error)" owner_change_denied "sorumlusuzu baskasina veremez"
ok "$(wc_ n PATCH "$NT" "/api/records/$OR" "$(OWN "\"$DENIZ\"")")" 200 "sorumlusuz kaydi kendine alir"
ok "$(wc_ n PATCH "$NT" "/api/records/$OR" "$(OWN "\"$ZEYNEP\"")")" 200 "sorumlu devreder"
ok "$(w n PATCH "$NT" "/api/records/$OR" "$(OWN "\"$DENIZ\"")" | jq -r .error)" owner_change_denied "devreden geri alamaz"
ok "$(wc_ e PATCH "$ET" "/api/records/$OR" "$(OWN "\"$EFE\"")")" 200 "dal editoru degistirir"
ok "$(DB "select owner_id from records where id='$OR'")" "$EFE" "son sorumlu"

t event_owner_change
# A2 etkinlikte: ayni kural + manage_events. Sorumlu ikize de yazilir.
EV=$(w w POST "$WT" /api/events "{\"title\":\"Yetki etkinligi\",\"description\":\"Yetki degisikligi testinde kullanilan etkinlik aciklamasi.\",\"kind_id\":\"$ATOLYE\",\"unit_id\":\"$TEDARIK\"}")
EVID=$(jq -r .id <<<"$EV"); EVREC=$(jq -r .record_id <<<"$EV")
w w PUT "$WT" "/api/events/$EVID/participants/$DENIZ" '{}' >/dev/null
ok "$(w n PATCH "$NT" "/api/events/$EVID" "$(OWN "\"$DENIZ\"")" | jq -r .error)" owner_change_denied "katilimci onaylayici olamaz"
DB "insert into user_scopes (user_id,scope) values ('$DENIZ','manage_events')" >/dev/null
ok "$(wc_ n PATCH "$NT" "/api/events/$EVID" "$(OWN "\"$DENIZ\"")")" 200 "manage_events degistirir"
DB "delete from user_scopes where user_id='$DENIZ' and scope='manage_events'" >/dev/null
ok "$(DB "select owner_id from records where id='$EVREC'")" "$DENIZ" "ikize yazildi"
ok "$(wc_ n PATCH "$NT" "/api/events/$EVID" "$(OWN "\"$SELIN\"")")" 200 "sorumlu devreder"

t purchases_v2
# spec/73 §5 (017): kalem etkinlikten bagimsiz; sponsor adim degil istek; teslim
# isareti ve satin alindi AYRI kapilar. `purchased` yalniz review_purchases.
ok "$(wc_ n POST "$NT" "/api/events/$EVID/materials" '{"name":"Lehim teli"}')" 403 "scope'suz ekleyemez"
DB "insert into user_scopes (user_id,scope) values ('$DENIZ','manage_purchases')" >/dev/null
M=$(w n POST "$NT" "/api/events/$EVID/materials" '{"name":"Lehim teli"}')
MID=$(jq -r '.materials[0].id' <<<"$M")
ok "$(jq -r '.materials[0]|"\(.qty) \(.state) \(.purchased)"' <<<"$M")" "1 0 false" "varsayilanlar"
ok "$(DB "select (m.created_by='$DENIZ')::text||' '||(select count(*) from event_materials where material_id=m.id) from materials m where m.id='$MID'")" "true 1" "ekleyen ve etkinlik bagi"
ok "$(w n PATCH "$NT" "/api/materials/$MID" '{"qty":0}' | jq -r .error)" invalid_qty "adet >= 1"
ok "$(w n PATCH "$NT" "/api/materials/$MID" '{"state":4}' | jq -r .error)" invalid_state "sponsor adimi yok: state <= 3"
ok "$(w n PATCH "$NT" "/api/materials/$MID" '{"delivered":true}' | jq -r .error)" not_approved "onaysiz teslim edilmez"
ok "$(w n PATCH "$NT" "/api/materials/$MID" '{"chosen":"sponsor"}' | jq -r .error)" no_sponsor "sponsorsuz sponsor secilmez"
ok "$(w n PATCH "$NT" "/api/materials/$MID" '{"qty":12,"has_sponsor":true,"sponsor_qty":8,"sponsor_date":"2026-10-15","chosen":"sponsor"}' | jq -r '.materials[0]|"\(.qty) \(.has_sponsor) \(.sponsor_qty) \(.sponsor_chosen)"')" "12 true 8 true" "sponsor istegi"
ok "$(w n PATCH "$NT" "/api/materials/$MID" '{"has_sponsor":false}' | jq -r '.materials[0]|"\(.sponsor_qty) \(.sponsor_chosen) \(.sponsor_date)"')" "null false null" "vazgecince sponsor alanlari temizlenir"
ok "$(w n PATCH "$NT" "/api/materials/$MID" '{"owned":true}' | jq -r '.materials[0].owned')" true "elde var"
ok "$(w n PATCH "$NT" "/api/materials/$MID" '{"has_sponsor":true}' | jq -r .error)" owned_no_sponsor "elde olan sponsordan istenmez"
w n PATCH "$NT" "/api/materials/$MID" '{"owned":false}' >/dev/null
P1=$(w n POST "$NT" "/api/materials/$MID/providers" '{"contact":"firma.example","price":100}' | jq -r '.materials[0].providers[0].id')
ok "$(w n PATCH "$NT" "/api/material-providers/$P1" '{"price":99.5,"arrival_date":"2026-10-12"}' | jq -r '.materials[0].providers[0]|"\(.price) \(.arrival_date)"')" "99.5 2026-10-12" "teklif duzenlenir"
ok "$(w n PATCH "$NT" "/api/material-providers/$P1" '{"price":null}' | jq -r '.materials[0].providers[0].price')" null "null fiyati siler"
ok "$(w n PATCH "$NT" "/api/materials/$MID" "{\"chosen\":\"$P1\"}" | jq -r '.materials[0].chosen_provider_id')" "$P1" "teklif secilir"
M2=$(w n POST "$NT" "/api/events/$EVID/materials" '{"name":"Rozet"}'); MID2=$(jq -r '.materials[1].id' <<<"$M2")
ok "$(w n PATCH "$NT" "/api/materials/$MID2" "{\"chosen\":\"$P1\"}" | jq -r .error)" invalid_provider "baska kalemin teklifi secilmez"
w n DELETE "$NT" "/api/material-providers/$P1" '' >/dev/null
ok "$(DB "select chosen_provider_id is null from materials where id='$MID'")" t "teklif silinince secim kalkar"

t purchased_review
w n PATCH "$NT" "/api/materials/$MID" '{"state":2}' >/dev/null
ok "$(wc_ n PATCH "$NT" "/api/materials/$MID/purchased" '{"purchased":true}')" 403 "manage_purchases satin alindi isaretlemez"
DB "insert into user_scopes (user_id,scope) values ('$DENIZ','review_purchases')" >/dev/null
ok "$(w n PATCH "$NT" "/api/materials/$MID/purchased" '{"purchased":true}' | jq -r .error)" not_approved "onaysiz satin alinmis sayilmaz"
w n PATCH "$NT" "/api/materials/$MID" '{"state":3,"delivered":true}' >/dev/null
ok "$(w n PATCH "$NT" "/api/materials/$MID/purchased" '{"purchased":true}' | jq -r '"\(.purchased) \(.delivered)"')" "true true" "maliye isaretler"
ok "$(DB "select (purchased_at is not null)::text||' '||(purchased_by='$DENIZ')::text from materials where id='$MID'")" "true true" "ne zaman, kim"
ok "$(w n PATCH "$NT" "/api/materials/$MID" '{"qty":3}' | jq -r .error)" purchased_locked "satin alinan kalemin tedarigi donar"
ok "$(wc_ n DELETE "$NT" "/api/materials/$MID" '')" 409 "silinemez"
ok "$(w n PATCH "$NT" "/api/materials/$MID" '{"notes":"teslim alindi","delivered":false}' | jq -r '.materials[0]|"\(.notes) \(.delivered)"')" "teslim alindi false" "not ve teslim isareti serbest"
w n PATCH "$NT" "/api/materials/$MID/purchased" '{"purchased":false}' >/dev/null
ok "$(DB "select purchased::text||' '||(purchased_at is null)::text from materials where id='$MID'")" "false true" "inceleme geri alinir"
DB "delete from user_scopes where user_id='$DENIZ' and scope in ('manage_purchases','review_purchases')" >/dev/null

t action_owner_participant
# K1: eyleme atanan kayda katilimci olur, eylemini kapatabilir (A3 de kapanir).
ok "$(g c2 "/api/records/$VEKALET" | jq -r .access.can_edit)" false "atanmadan once duzenleyemez"
w w POST "$WT" "/api/records/$VEKALET/actions" "{\"title\":\"Can'in eylemi\",\"owner_id\":\"$CAN\"}" >/dev/null
ok "$(DB "select count(*) from record_participants where record_id='$VEKALET' and user_id='$CAN'")" 1 "acilista sahip katilimci"
CA=$(DB "select id from actions where title='Can''in eylemi'")
ok "$(w c2 PATCH "$CT" "/api/actions/$CA" '{"field":"status","value":"closed","closing_note":"Eylem tamamlandi ve sonuc ekip arkadaslariyla paylasildi."}' | jq -r ".actions[]|select(.id==\"$CA\").status")" closed "sahip kendi eylemini kapatir"
w w PATCH "$WT" "/api/actions/$CA" "{\"field\":\"owner_id\",\"value\":\"$ZEYNEP\"}" >/dev/null
ok "$(DB "select count(*) from record_participants where record_id='$VEKALET' and user_id='$ZEYNEP'")" 1 "atamada sahip katilimci"
w w PATCH "$WT" "/api/actions/$CA" "{\"field\":\"owner_id\",\"value\":\"$CAN\"}" >/dev/null
ok "$(DB "select count(*) from record_participants where record_id='$VEKALET' and user_id='$CAN'")" 1 "idempotent"
ok "$(DB "select count(*) from actions a where owner_id is not null and not exists (select 1 from record_participants p where p.record_id=a.record_id and p.user_id=a.owner_id)")" 0 "katilimci olmayan eylem sahibi yok"

t card_request_mode
# K5: request kipinde kart cevabi ve oy yalniz onayli uyeye ve duzenleyene.
w w PATCH "$WT" "/api/records/$KR" '{"field":"access_mode","value":"request"}' >/dev/null
ok "$(wc_ n PUT "$NT" "/api/cards/$KP/signup" '{"answer":"yes"}')" 403 "onaysiz katilamaz"
ok "$(wc_ n PUT "$NT" "/api/cards/$KP/vote" '{"options":[0]}')" 403 "onaysiz oy veremez"
ok "$(g n "/api/records/$KR" | jq '.cards|length')" 2 "okuma acik (gizli degil)"
ok "$(wc_ w PUT "$WT" "/api/cards/$KP/signup" '{"answer":"yes"}')" 200 "duzenleyen katilir"
w n POST "$NT" "/api/records/$KR/join" '' >/dev/null
w w POST "$WT" "/api/records/$KR/join-requests/$DENIZ" '{"approve":true}' >/dev/null
ok "$(wc_ n PUT "$NT" "/api/cards/$KP/signup" '{"answer":"yes"}')" 200 "onayli uye katilir"
ok "$(w n PUT "$NT" "/api/cards/$KP/vote" '{"options":[0]}' | jq -r .error)" invalid_card_type "onayli uye oy kapisindan gecer"
w w PATCH "$WT" "/api/records/$KR" '{"field":"access_mode","value":"public"}' >/dev/null

t private_event_and_attachments
# A4: ikizi gizli etkinlik, ikizin sohbeti gibi uye olmayana 403.
# A5: gizli kayda bagli ek de; profil fotografi yine herkese.
w w PATCH "$WT" "/api/records/$EVREC" '{"field":"access_mode","value":"private"}' >/dev/null
ok "$(code -b "$J/bos" "$B/api/events/$EVID")" 403 "etkinlik ayrintisi"
ok "$(code -b "$J/bos" "$B/api/events/$EVID/otf")" 403 "OTF"
ok "$(code -b "$J/bos" "$B/api/events/$EVID/otf.docx")" 403 "docx"
ok "$(code -b "$J/n" "$B/api/events/$EVID")" 200 "katilimci gorur"
ok "$(code -b "$J/n" "$B/api/events/$EVID/otf")" 200 "katilimci OTF gorur"
EVCHAT=$(DB "select chat_id from records where id='$EVREC'")
PA=$(up w "$WT" "$J/px.png" | jq -r .id)
w w POST "$WT" "/api/chats/$EVCHAT/messages" "{\"body\":\"\",\"attachment_ids\":[\"$PA\"]}" >/dev/null
ok "$(code -b "$J/bos" "$B/api/attachments/$PA")" 403 "gizli sohbetteki ek"
ok "$(code -b "$J/bos" "$B/api/attachments/$PA/thumb")" 403 "kucuk resmi de"
ok "$(code -b "$J/n" "$B/api/attachments/$PA")" 200 "uye indirir"
AV=$(up w "$WT" "$J/px.png" | jq -r .id)
ok "$(code -b "$J/bos" "$B/api/attachments/$AV")" 200 "bagsiz (profil adayi) ek herkese"
w w PATCH "$WT" /api/me/profile "{\"avatar_id\":\"$PA\"}" >/dev/null
ok "$(code -b "$J/bos" "$B/api/attachments/$PA/thumb")" 200 "profil fotografi gizli sohbetten gelse de herkese"
w w PATCH "$WT" "/api/records/$EVREC" '{"field":"access_mode","value":"public"}' >/dev/null
ok "$(code -b "$J/bos" "$B/api/events/$EVID")" 200 "ikiz acilinca gorunur"

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
