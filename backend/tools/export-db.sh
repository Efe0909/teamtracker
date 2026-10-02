#!/bin/bash
# VM'deki canli 0.2 semasini (yalniz DDL, veri yok) depoya yazar.
# 0.2 Docker kullanmiyor: NixOS'un postgresql.service'i, peer auth (KNOW-286).
#
#   ./export-db.sh                      # -> db-scheme-export.sql
#   HOST=efe@baska ./export-db.sh       # baska makine
#
# --restrict-key sabit: pg_dump 16.10+ her dokumde rastgele \restrict anahtari
# yaziyor, sabitlenmezse her ihracat sahte bir diff uretir.
set -euo pipefail
cd "$(dirname "$0")"

HOST=${HOST:-efe@192.168.64.8}
OUT=db-scheme-export.sql

ssh "$HOST" "sudo -u postgres pg_dump -d ekiptakip --schema-only --no-owner --no-privileges --restrict-key=ekiptakip" > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "$OUT: $(grep -c '^CREATE TABLE' "$OUT") tablo, $(wc -l < "$OUT") satir"
