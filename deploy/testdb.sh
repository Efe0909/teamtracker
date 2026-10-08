#!/bin/bash
# Yerel DENEME veritabani: atilip yikilan `ekiptakip_testdb` + sahte kimlikli API
# (127.0.0.1:8000) + ornek etkinlik ("Robotik Atölyesi", satin alimlar widget'i dolu).
# Ekrana bakmak icin: veritabanini kurar, sonra `cd frontend && npm run dev` yeter.
# Gercek `ekiptakip` veritabanina ve yayina DOKUNMAZ. Mac'te Docker'da `ekiptakip-db`
# ayakta olmali (CLAUDE.md "alpha-0.2"); bulut oturumlarinda Docker yok, makinenin kendi
# Postgres'i kullanilir (asagida PG_MODE). `jq` ve `curl` gerekir.
#
#   deploy/testdb.sh up      # sifirdan kur: veritabani + tohum + ornek etkinlik, API acik kalir
#   deploy/testdb.sh down    # API'yi kapat, veritabanini ve medya dizinini sil
#
# Giris (karsilama sayfasinda kullanici secmek yerine dogrudan):
#   http://dashboard.localhost:5173/api/auth/dev-login?user_id=<Selin>   (up kimligi yazar)
set -euo pipefail
cd "$(dirname "$0")/.."

DBN=ekiptakip_testdb
CT=ekiptakip-db
STATE=/tmp/ekiptakip-testdb
PORT=8000
B=http://127.0.0.1:$PORT

# Postgres iki yerden gelir (PG_MODE ile zorlanabilir):
#   docker — Mac: `ekiptakip-db` konteyneri (docker compose up -d)
#   native — bulut oturumlari (Docker yok): makinenin kendi Postgres'i; yoksa kurulur ve
#            baslatilir, `ekiptakip` rolu (parola `ekiptakip`) yoksa olusturulur.
if [ -z "${PG_MODE:-}" ]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CT"; then PG_MODE=docker
  elif [ "$(uname -s)" = Darwin ]; then
    echo "Docker'da $CT ayakta degil: kokte 'docker compose up -d'" >&2; exit 1
  else PG_MODE=native; fi
fi

# pgx <komut> <arglar...>: psql/createdb/dropdb, secilen Postgres'e.
if [ "$PG_MODE" = docker ]; then
  pgx() { local c=$1; shift; docker exec -i "$CT" "$c" -U ekiptakip "$@"; }
else
  export PGHOST=127.0.0.1 PGUSER=ekiptakip PGPASSWORD=ekiptakip
  pgx() { local c=$1; shift; "$c" "$@"; }
fi
psql_() { pgx psql -d "$DBN" -t -A -q -v ON_ERROR_STOP=1 "$@"; }

ensure_native_pg() {
  [ "$PG_MODE" = native ] || return 0
  local as_root=""; [ "$(id -u)" -ne 0 ] && as_root="sudo"
  if ! command -v psql >/dev/null; then
    echo "Postgres kuruluyor (apt)..."; $as_root apt-get install -y -qq postgresql postgresql-client >/dev/null
  fi
  if ! pg_isready -q -h 127.0.0.1; then
    echo "Postgres baslatiliyor..."
    $as_root service postgresql start >/dev/null 2>&1 || {
      local v; v=$(ls /usr/lib/postgresql 2>/dev/null | sort -n | tail -1)
      $as_root pg_ctlcluster "$v" main start; }
    for _ in $(seq 40); do pg_isready -q -h 127.0.0.1 && break; sleep 0.5; done
  fi
  # Rol yoksa postgres kullanicisiyla olustur (superuser: createdb + uzanti gerekebilir).
  local pgu="sudo -u postgres"; [ "$(id -u)" -eq 0 ] && pgu="runuser -u postgres --"
  if ! $pgu psql -tAc "select 1 from pg_roles where rolname='ekiptakip'" | grep -q 1; then
    $pgu psql -qc "create role ekiptakip login superuser password 'ekiptakip'"
  fi
}

# SIGTERM'e guvenilmez (kapanista bekleyen baglanti): kisa bekle, sonra -9. Port serbest
# kalmazsa yeniden baslatilan API baglanamaz ve eski surece "acildi" denir.
stop_api() {
  local pid; pid=$(cat "$STATE/pid" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 8); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -9 "$pid" 2>/dev/null || true
  fi
  : >"$STATE/pid" 2>/dev/null || true
}

start_api() {
  # exec: alt kabuk surecin KENDISI olur, `$!` gercek pid'dir (aksi halde kill alt kabugu vurur).
  (cd backend && exec env DATABASE_URL="postgresql://ekiptakip:ekiptakip@127.0.0.1:5432/$DBN" \
    EKIPTAKIP_AUTH=sahte EKIPTAKIP_SECRET_KEY=local-test-not-a-secret-xxxxxxxxxxxxxxxx \
    EKIPTAKIP_MEDIA_ROOT="$STATE/media" PORT=$PORT \
    ./target/debug/ekiptakip >"$STATE/api.log" 2>&1) &
  echo $! >"$STATE/pid"
  for _ in $(seq 80); do curl -s -o /dev/null "$B/api/me" && return 0; sleep 0.25; done
  echo "API acilmadi:"; tail "$STATE/api.log"; exit 1
}

down() {
  mkdir -p "$STATE"; stop_api
  pgx dropdb --if-exists --force "$DBN" >/dev/null 2>&1 || true
  rm -rf "$STATE"
  echo "testdb kapatildi ($DBN silindi)"
}

# Ornek etkinlik: panonun her sutunu, sponsor seridi, teslim ve zaten var dolu.
sample() {
  local j; j=$(mktemp -d)
  local selin; selin=$(psql_ -c "select id from users where name='Selin'")
  psql_ -c "insert into user_scopes (user_id,scope) values ('$selin','manage_purchases'),('$selin','manage_event_widgets') on conflict do nothing" >/dev/null
  curl -s -c "$j/c" -o /dev/null "$B/api/auth/dev-login?user_id=$selin"
  local t; t=$(curl -s -b "$j/c" "$B/api/me" | jq -r .csrf)
  w() { curl -s -b "$j/c" -X "$1" -H "X-CSRF-Token: $t" -H 'Content-Type: application/json' -d "$3" "$B$2"; }
  local types tedarik atolye eid
  types=$(psql_ -c "select id from nodes where key='event_types'")
  tedarik=$(psql_ -c "select id from nodes where name='Tedarikçi Seçimi'")
  atolye=$(w POST /api/nodes "{\"name\":\"Atölye\",\"parent_id\":\"$types\"}" | jq -r '.nodes[]|select(.name=="Atölye").id')
  eid=$(w POST /api/events "{\"title\":\"Robotik Atölyesi\",\"description\":\"Arduino ile robot yapımı atölyesi için malzeme ve tedarik planı.\",\"kind_id\":\"$atolye\",\"unit_id\":\"$tedarik\"}" | jq -r .id)
  w PATCH "/api/events/$eid" '{"field":"date","value":"2026-10-24"}' >/dev/null
  w POST "/api/events/$eid/widgets" '{"type":"supplies","record_id":null}' >/dev/null
  mat() { w POST "/api/events/$eid/materials" "{\"name\":\"$1\"}" | jq -r '.materials[-1].id'; }
  local m1 m2 m3 m4 m5 m6 p
  m1=$(mat "Karton ve kağıt"); m2=$(mat "Lazer kesim: MDF 3 mm"); m3=$(mat "Arduino Uno seti")
  m4=$(mat "Tişört baskısı"); m5=$(mat "Lehim teli"); m6=$(mat "Projeksiyon")
  w PATCH "/api/materials/$m2" '{"type":"service","priority":"critical","qty":40,"state":2}' >/dev/null
  w POST "/api/materials/$m2/providers" '{"contact":"https://kesimhane.example/teklif","price":2480,"arrival_date":"2026-10-14"}' >/dev/null
  w POST "/api/materials/$m2/providers" '{"contact":"0212 555 01 42","price":2750,"arrival_date":"2026-10-12"}' >/dev/null
  w PATCH "/api/materials/$m3" '{"type":"equipment","priority":"high","qty":12,"state":2,"has_sponsor":true,"sponsor_qty":8,"sponsor_date":"2026-10-15"}' >/dev/null
  p=$(w POST "/api/materials/$m3/providers" '{"contact":"https://devreci.example/uno-set","price":7200,"arrival_date":"2026-10-17"}' | jq -r ".materials[]|select(.id==\"$m3\").providers[0].id")
  w POST "/api/materials/$m3/providers" '{"contact":"0532 555 01 17","price":7650,"arrival_date":"2026-10-14"}' >/dev/null
  w POST "/api/materials/$m3/providers" '{"contact":"https://elektrohat.example","price":6900,"arrival_date":"2026-10-28"}' >/dev/null
  w PATCH "/api/materials/$m3" "{\"chosen\":\"$p\"}" >/dev/null
  w PATCH "/api/materials/$m4" '{"type":"service","qty":40,"state":1,"has_sponsor":true}' >/dev/null
  w POST "/api/materials/$m4/providers" '{"contact":"baskiatolyesi.example","price":3200,"arrival_date":"2026-10-19"}' >/dev/null
  w PATCH "/api/materials/$m5" '{"priority":"low","state":3}' >/dev/null
  w POST "/api/materials/$m5/providers" '{"contact":"https://elektrohat.example/lehim","price":340,"arrival_date":"2026-10-12"}' >/dev/null
  w PATCH "/api/materials/$m5" '{"delivered":true}' >/dev/null
  w PATCH "/api/materials/$m6" '{"owned":true,"notes":"Kulüp odasında var."}' >/dev/null
  rm -rf "$j"
  echo "etkinlik:  http://dashboard.localhost:5173/events/$eid"
  echo "giris:     http://dashboard.localhost:5173/api/auth/dev-login?user_id=$selin"
}

case "${1:-}" in
  up)
    ensure_native_pg
    down >/dev/null; mkdir -p "$STATE"
    pgx createdb "$DBN"
    (cd backend && cargo build -q)
    start_api                       # gocler acilista kosar
    psql_ <backend/seed.sql >/dev/null
    stop_api; sleep 0.5; start_api  # agac acilista kurulur: tohumdan sonra yeniden baslat (KNOW-310)
    sample
    echo "API: $B (kapatmak icin: deploy/testdb.sh down) · on yuz: cd frontend && npm run dev"
    ;;
  down) down ;;
  *) echo "kullanim: deploy/testdb.sh up|down" >&2; exit 2 ;;
esac
