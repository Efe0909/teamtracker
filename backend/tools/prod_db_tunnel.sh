#!/bin/bash
# Pi'deki CANLI Postgres'e DBeaver/psql icin tunel: localhost:5433 -> evsunucu.
# Pi'de Postgres yalniz unix soketinde, peer auth: socat soketi `ekiptakip`
# kullanicisi olarak TCP'ye cevirir, ssh Mac'e tasir. Parola YOK.
#   backend/tools/prod_db_tunnel.sh start|stop|status
# DBeaver: localhost:5433, db ekiptakip, kullanici ekiptakip, parola bos.
# DIKKAT: gercek veri. Yazdigin sorgu anında canliya gider.
set -eu
HOST=${PI_HOST:-efe@evsunucu}
PORT=${TUNNEL_PORT:-5433}
PID=${TMPDIR:-/tmp}/ekiptakip-prod-tunnel.pid

running() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }

case "${1:-}" in
start)
  running && { echo "zaten acik (pid $(cat "$PID"))"; exit 0; }
  # socat'i efe indirir (`ekiptakip` kullanicisinin home'u yok), ekiptakip calistirir.
  ssh -f -o ExitOnForwardFailure=yes -L "$PORT:127.0.0.1:5434" "$HOST" \
    'S=$(nix build nixpkgs#socat --no-link --print-out-paths) && exec sudo -n -u ekiptakip $S/bin/socat TCP-LISTEN:5434,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:/run/postgresql/.s.PGSQL.5432'
  pgrep -nf "ssh -f .*-L $PORT:127.0.0.1:5434" >"$PID"
  echo "acik: localhost:$PORT (db ekiptakip, kullanici ekiptakip, parola yok)"
  ;;
stop)
  running && kill "$(cat "$PID")"
  rm -f "$PID"
  ssh "$HOST" 'sudo -n pkill -u ekiptakip socat' || true
  echo "kapandi"
  ;;
status)
  if running; then echo "acik (pid $(cat "$PID"))"; else echo "kapali"; fi
  ;;
*) echo "kullanim: $0 start|stop|status" >&2; exit 2 ;;
esac
