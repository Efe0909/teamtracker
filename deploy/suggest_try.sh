#!/bin/bash
# Malzeme onerisi modelini yerelde dener (spec/79 §9): deneme veritabanini kurar
# (deploy/testdb.sh up), ornek etkinligi OTF ve katilimciyla doldurur, `material-suggestions`
# ucunu uc kez cagirir (ilk parti, reddedilenlerle ikinci parti, serbest metin acik) ve
# sonucu yazar. Gercek OpenRouter istegi atar (para harcar, parti basina birkac kurus).
#
# Anahtar ekrana ve komut gecmisine yazilmasin diye gizli sorulur:
#   read -rs OPENROUTER_API_KEY && export OPENROUTER_API_KEY && deploy/suggest_try.sh
# Anahtar ortamdan gelir ve bu betik hicbir yere yazdirmaz. `PORT=8010` ile baska porta kurulur.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -n "${OPENROUTER_API_KEY:-}" ] || { echo "OPENROUTER_API_KEY ortamda yok (yukaridaki satiri kullan)" >&2; exit 1; }
export PORT=${PORT:-8010}
B=http://127.0.0.1:$PORT
DBN=ekiptakip_testdb
psql_() { docker exec -i ekiptakip-db psql -U ekiptakip -d "$DBN" -t -A -q -v ON_ERROR_STOP=1 "$@"; }

echo "-- deneme veritabani kuruluyor (API bu ortam degiskeniyle acilir)"
OUT=$(deploy/testdb.sh up 2>&1)
EID=$(grep -o 'events/[0-9a-f-]*' <<<"$OUT" | head -1 | cut -d/ -f2)
[ -n "$EID" ] || { echo "$OUT" | tail -5; echo "etkinlik kimligi bulunamadi" >&2; exit 1; }

J=$(mktemp -d); trap 'rm -rf "$J"' EXIT
SELIN=$(psql_ -c "select id from users where name='Selin'")
curl -s -c "$J/c" -o /dev/null "$B/api/auth/dev-login?user_id=$SELIN"
T=$(curl -s -b "$J/c" "$B/api/me" | jq -r .csrf)
w() { curl -s -b "$J/c" -X "$1" -H "X-CSRF-Token: $T" -H 'Content-Type: application/json' -d "$3" "$B$2"; }

echo "-- etkinlik dolduruluyor ($EID)"
w PATCH "/api/events/$EID" '{"field":"attendees","value":18}' >/dev/null
w PATCH "/api/events/$EID" '{"field":"start_time","value":"14:00"}' >/dev/null
OC=$(psql_ -c "select coalesce(json_agg(id), '[]') from (select id from nodes where node_type='outcome' and is_active order by name limit 2) s")
w PUT "/api/events/$EID/otf" "$(jq -n --argjson oc "$OC" '{
  purpose: "Üyelere Arduino ile temel robotik tanıtmak; küçük gruplarla çalışan bir robot kolu yapılacak.",
  end_time: "17:00", age_group: "Lisans öğrencileri",
  outcomes: "Katılımcılar devre kurup kod yükleyebilir hale gelir.",
  items: [{item:"av_projector", quantity:1}, {item:"av_mic_hand", quantity:1}, {item:"layout_class"}, {item:"host_coffee"}],
  contacts: [], outcome_ids: $oc, tech_notes: "Her masada priz olmalı."
}')" | jq -c 'if .error then {error} else "otf kaydedildi" end'

echo "-- mevcut kalemler:"
curl -s -b "$J/c" "$B/api/events/$EID" | jq -r '.materials[] | "   - \(.name) (\(.type), x\(.qty))"'

ask() { # ask <baslik> <govde>
  local t0 R; t0=$(date +%s)
  R=$(w POST "/api/events/$EID/material-suggestions" "$2")
  echo; echo "== $1 ($(( $(date +%s) - t0 )) sn)"
  if jq -e '.items' >/dev/null 2>&1 <<<"$R"; then
    jq -r '.items[] | "   • \(.name) — \(.description)"' <<<"$R"
    echo "   (${#R} bayt, $(jq '.items|length' <<<"$R") oneri)"
  else
    echo "   $R"
  fi
  LAST=$R
}

ask "1. parti (serbest metin KAPALI)" '{}'
FIRST3=$(jq -c '[.items[0:3][].name]' <<<"$LAST" 2>/dev/null || echo '[]')
ask "2. parti: ilk 3 oneri reddedildi" "$(jq -nc --argjson r "$FIRST3" '{rejected:$r}')"
echo "   reddedilenler: $FIRST3"
ask "3. parti (serbest metin ACIK, baslik/aciklama/OTF notlari gider)" '{"free_text":true}'

echo; echo "-- API gunlugu (icerik yok, yalniz sayilar):"
grep -a "malzeme onerisi\|oneri modeli" /tmp/ekiptakip-testdb/api.log | sed 's/\x1b\[[0-9;]*m//g' | tail -6
echo; echo "-- bitti. API acik ($B); kapatmak icin: deploy/testdb.sh down"
