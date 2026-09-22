#!/bin/bash
# Atilip-yikilan VM denemesi (YAYIN degil, hizli dongu).
#
# Mac'te cross-derler, VM'de GECICI bir dizin + GECICI bir veritabani + sahte
# kimlikle kaldirir, check_api.sh'i kosar, sonra HEPSINI siler. Gercek servise
# (ekiptakip.service) ve gercek veritabanina (ekiptakip) DOKUNMAZ; ayri port,
# yalniz VM'nin loopback'i, disariya acik degil.
#
#   backend/tools/vm_test.sh            # derle + dene
#   SKIP_BUILD=1 backend/tools/vm_test.sh   # son derlemeyi yeniden dene
#   VM=efe@baska-makine backend/tools/vm_test.sh
#
# Cikis kodu check_api.sh'inki: 0 = kalan yok.
set -euo pipefail
VM=${VM:-efe@192.168.64.8}
cd "$(dirname "$0")/.."          # backend/

[ -n "${SKIP_BUILD:-}" ] || nix shell nixpkgs#zig nixpkgs#cargo-zigbuild \
  --command cargo zigbuild --release --target aarch64-unknown-linux-musl

ID=burn_$(date +%s)              # hem dizin hem veritabani adi
scp -q target/aarch64-unknown-linux-musl/release/ekiptakip "$VM:/tmp/$ID.bin"
ssh "$VM" "mkdir -m 755 /tmp/$ID && mv /tmp/$ID.bin /tmp/$ID/ekiptakip && chmod 755 /tmp/$ID/ekiptakip"
rsync -a seed.sql tools/check_api.sh "$VM:/tmp/$ID/"

ssh "$VM" "ID=$ID bash -s" <<'REMOTE'
set -euo pipefail
D=/tmp/$ID
mkdir -m 777 "$D/media"          # uygulama ekiptakip kullanicisi olarak yazacak

cleanup() {
  sudo pkill -f "$D/ekiptakip" 2>/dev/null || true
  sudo -u postgres dropdb --force --if-exists "$ID"
  rm -rf "$D"
}
trap cleanup EXIT

sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "create database $ID owner ekiptakip"

# Genel ortam: gelistirme modu, atilacak anahtar. Iki surec, ayni veritabani:
# 18099 sahte kimlik, 18100 Google kipi (uydurma istemci kimligiyle).
export DATABASE_URL="postgresql:///$ID?host=/run/postgresql&user=ekiptakip"
export EKIPTAKIP_SECRET_KEY="burn-not-a-secret-$ID" EKIPTAKIP_MEDIA_ROOT="$D/media"

start() { # port, ek ortam...
  local port=$1; shift
  (cd "$D" && exec sudo -u ekiptakip env DATABASE_URL="$DATABASE_URL" \
     EKIPTAKIP_SECRET_KEY="$EKIPTAKIP_SECRET_KEY" EKIPTAKIP_MEDIA_ROOT="$EKIPTAKIP_MEDIA_ROOT" \
     PORT="$port" "$@" "$D/ekiptakip" >>"$D/app-$port.log" 2>&1) &
  disown                         # oldurulunca "Terminated" satiri basmasin
  for _ in $(seq 60); do
    curl -s -o /dev/null "http://127.0.0.1:$port/api/me" && return 0
    sleep 0.25
  done
  echo "sunucu acilmadi ($port):"; tail -20 "$D/app-$port.log"; exit 1
}

# Goc acilista kosar; tohum tablolar varken yuklenir.
start 18099 EKIPTAKIP_AUTH=sahte
sudo -u ekiptakip env PGOPTIONS=--client-min-messages=warning \
  psql -v ON_ERROR_STOP=1 -q -d "$ID" -f "$D/seed.sql"
start 18100 GOOGLE_CLIENT_ID=test-client GOOGLE_CLIENT_SECRET=test-secret

B=http://127.0.0.1:18099 BG=http://127.0.0.1:18100 PSQL="sudo -u ekiptakip psql -d $ID" \
  bash "$D/check_api.sh"
REMOTE
