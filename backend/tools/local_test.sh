#!/bin/bash
# JSON sozlesmesi YERELDE: atilip yikilan veritabani + iki surec (sahte kimlik
# ve Google kipi) + tools/check_api.sh. VM karsiligi tools/vm_test.sh.
# Docker'da `ekiptakip-db` ayakta olmali (CLAUDE.md "alpha-0.2").
#   backend/tools/local_test.sh
set -u
cd "$(dirname "$0")/.." || exit 1
cargo build -q || exit 1
S=$(mktemp -d); ID=ekiptakip_ct
docker exec ekiptakip-db dropdb -U ekiptakip --if-exists --force "$ID" >/dev/null 2>&1
docker exec ekiptakip-db createdb -U ekiptakip "$ID" || exit 1
export DATABASE_URL="postgresql://ekiptakip:ekiptakip@127.0.0.1:5432/$ID" \
  EKIPTAKIP_SECRET_KEY=local-test-not-a-secret-xxxxxxxxxxxxxxxx \
  EKIPTAKIP_MEDIA_ROOT="$S/media"
start() {
  port=$1; shift
  env PORT="$port" "$@" ./target/debug/ekiptakip >"$S/app-$port.log" 2>&1 &
  echo $! >>"$S/pids"; disown
  for _ in $(seq 60); do curl -s -o /dev/null "http://127.0.0.1:$port/api/me" && return 0; sleep 0.25; done
  echo "acilmadi: $port"; tail "$S/app-$port.log"
}
start 18099 EKIPTAKIP_AUTH=sahte
docker exec -i ekiptakip-db psql -U ekiptakip -d "$ID" -q -v ON_ERROR_STOP=1 <seed.sql >/dev/null
# Agac acilista kurulur: tohumdan sonra yeniden baslat (KNOW-310).
kill $(cat "$S/pids"); : >"$S/pids"; sleep 0.5
start 18099 EKIPTAKIP_AUTH=sahte
start 18100 GOOGLE_CLIENT_ID=test-client GOOGLE_CLIENT_SECRET=test-secret
# LLM cagri yolu (spec/79 §11): sahte OpenRouter + anahtarli ucuncu surec. Gercek anahtar yok.
python3 tools/openrouter_stub.py 18101 >"$S/stub.log" 2>&1 &
echo $! >>"$S/pids"; disown
start 18102 EKIPTAKIP_AUTH=sahte OPENROUTER_API_KEY=stub-key EKIPTAKIP_OPENROUTER_URL=http://127.0.0.1:18101
B=http://127.0.0.1:18099 BG=http://127.0.0.1:18100 BL=http://127.0.0.1:18102 \
  PSQL="docker exec ekiptakip-db psql -U ekiptakip -d $ID" bash tools/check_api.sh
rc=$?
kill $(cat "$S/pids") 2>/dev/null
docker exec ekiptakip-db dropdb -U ekiptakip --force "$ID" >/dev/null 2>&1
rm -rf "$S"
exit $rc
