#!/bin/bash
# Demo yigini: bos bir `ekiptakip_demo` veritabani + Rust API (sahte kimlik) + Vite.
# CANLIYA DOKUNMAZ: yalniz yerel Postgres, veritabani adi `demo` icerir.
#
#   demo/stack.sh reset    veritabanini at/yeniden kur, API'yi bastan baslat (goc kosar)
#   demo/stack.sh seed     reset + tohum + anlik goruntu (snapshot)
#   demo/stack.sh restore  anlik goruntuye don (capture sonrasi / oncesi)
#   demo/stack.sh up       API + Vite'i baslat (yoksa)
#   demo/stack.sh down     ikisini de durdur
#   demo/stack.sh status
#
# Postgres: varsayilan 127.0.0.1:5432, kullanici/parola `ekiptakip` (docker-compose.yml
# ile ayni). Docker varsa `docker compose up -d` yeter; yoksa yerel bir Postgres.
set -eu
cd "$(dirname "$0")/.."
ROOT=$PWD
OUT=${DEMO_OUT:-$ROOT/demo/out}
DB=${DEMO_DB:-ekiptakip_demo}
HOSTPG=${PGHOST:-127.0.0.1}
export PGPASSWORD=${PGPASSWORD:-ekiptakip}
PG="psql -h $HOSTPG -U ekiptakip -X -q"
mkdir -p "$OUT/log" "$OUT/media"

# UTC: sqlx baglanti saat dilimini UTC'ye sabitler; tohum ve tarayici da UTC kullanir
# (bugun/yarin/gecikti her saatte tutarli).
export TZ=UTC

# Surecleri KOMUT SATIRI METNIYLE degil dinledikleri PORTLA buluruz: `pgrep -f` cagiranin
# kendi kabuguyla da eslesip onu oldurebilir.
listener() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1 || true; }
api_pid() { listener 8000; }
vite_pid() { listener 5173; }

stop_api() { p=$(api_pid); [ -n "$p" ] && kill "$p" 2>/dev/null && sleep 0.5 || true; }
stop_vite() { p=$(vite_pid); [ -n "$p" ] && kill "$p" 2>/dev/null || true; }

start_api() {
  [ -n "$(api_pid)" ] && return 0
  [ -x backend/target/debug/ekiptakip ] || (cd backend && cargo build -q)
  # Yalniz SURECI arka plana at (cd ile && zincirleme degil): alt kabuk, cagiranin
  # borusunu (`| tail`) acik tutup komutu sonsuza kadar bekletirdi.
  (
    cd backend
    DATABASE_URL="postgresql://ekiptakip:$PGPASSWORD@$HOSTPG:5432/$DB" \
    EKIPTAKIP_AUTH=sahte EKIPTAKIP_SECRET_KEY=demo-only-not-a-secret-xxxxxxxxxxxxxxxxxxxx \
    EKIPTAKIP_MEDIA_ROOT="$OUT/media" PORT=8000 RUST_LOG=info \
      nohup ./target/debug/ekiptakip >"$OUT/log/api.log" 2>&1 </dev/null &
  )
  for _ in $(seq 80); do curl -s -o /dev/null http://127.0.0.1:8000/api/me && return 0; sleep 0.25; done
  echo "API acilmadi:"; tail "$OUT/log/api.log"; exit 1
}

start_vite() {
  [ -n "$(vite_pid)" ] && return 0
  [ -d frontend/node_modules ] || (cd frontend && npm ci --no-audit --no-fund >/dev/null)
  (
    cd frontend
    nohup npm run dev -- --host 127.0.0.1 >"$OUT/log/vite.log" 2>&1 </dev/null &
  )
  for _ in $(seq 80); do curl -s -o /dev/null http://127.0.0.1:5173/ && return 0; sleep 0.25; done
  echo "Vite acilmadi:"; tail "$OUT/log/vite.log"; exit 1
}

case "${1:-status}" in
  reset)
    stop_api
    $PG -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
    rm -rf "$OUT/media" && mkdir -p "$OUT/media"
    start_api   # acilista gocler kosar, kokler (Birimler, Etkinlik Turleri/Yerleri) dogar
    echo "bos demo veritabani hazir: $DB"
    ;;
  seed)
    # tek komut: bos veritabani + tohum + anlik goruntu (capture hep ayni durumdan baslar)
    "$0" reset
    PSQL="PGPASSWORD=$PGPASSWORD psql -h $HOSTPG -U ekiptakip -d $DB" API=http://127.0.0.1:8000 \
      python3 demo/seed/run.py
    "$0" snapshot
    ;;
  snapshot)
    stop_api
    $PG -d postgres -c "drop database if exists ${DB}_snap with (force)" -c "create database ${DB}_snap template $DB"
    rm -rf "$OUT/media.snap" && cp -a "$OUT/media" "$OUT/media.snap"
    start_api
    echo "anlik goruntu alindi: ${DB}_snap"
    ;;
  restore)
    # capture sirasinda degisen veriyi at, tohumlu duruma don
    stop_api
    $PG -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB template ${DB}_snap"
    rm -rf "$OUT/media" && cp -a "$OUT/media.snap" "$OUT/media"
    start_api
    echo "tohumlu duruma donuldu"
    ;;
  up) start_api; start_vite; echo "api :8000, vite :5173" ;;
  down) stop_api; stop_vite ;;
  status) echo "api pid=$(api_pid) vite pid=$(vite_pid)" ;;
  *) echo "kullanim: $0 reset|seed|snapshot|restore|up|down|status"; exit 2 ;;
esac
