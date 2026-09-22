#!/bin/bash
# Yayin ikilisi: Mac'te cross-derle -> tarball -> GitHub release -> deploy/release.nix.
#
# flake.nix'teki `packages.aarch64-linux.prebuilt` bu dosyadaki url+hash'i
# fetchurl ile ceker; hedef makine (VM/Pi) HIC derleme yapmaz. Tarball ikiliyi
# VE on yuz derlemesini (frontend/dist -> share/ekiptakip/web) birlikte tasir:
# ayni commit'ten, API ile istemcisi birbirine uyumlu.
#
#   backend/tools/release.sh              # GERCEK: GitHub'a yukler (herkese acik)
#   DRY_RUN=1 backend/tools/release.sh    # derler + tarball + hash; yukleme YOK,
#                                         # release.nix yazilmaz, icerigi basar
#
# Sonra: git add deploy/release.nix && git commit; ~/nix'te
#   services.ekiptakip.package = teamtracker.packages.aarch64-linux.prebuilt;
#   nix flake update teamtracker
set -euo pipefail
cd "$(dirname "$0")/../.."       # depo koku

[ -n "${DRY_RUN:-}" ] || [ -z "$(git status --porcelain --untracked-files=no)" ] \
  || { echo "calisma agaci temiz degil: once commit'le (tarball HEAD'e karsilik gelmeli)"; exit 1; }

SHA=$(git rev-parse --short=10 HEAD)
TAG=rust-$SHA
TAR=ekiptakip-$SHA-aarch64-linux.tar.gz
REPO=Efe0909/teamtracker

(cd backend && nix shell nixpkgs#zig nixpkgs#cargo-zigbuild \
  --command cargo zigbuild --release --target aarch64-unknown-linux-musl)
# npm ci: package-lock.json'a birebir; derleme tsc denetiminden gecmezse durur.
(cd frontend && npm ci --no-audit --no-fund && npm run build)

STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
# `install -D` GNU'ya ozgu, macOS'ta yok: mkdir + cp.
mkdir -p "$STAGE/bin" "$STAGE/share/ekiptakip"
cp backend/target/aarch64-unknown-linux-musl/release/ekiptakip "$STAGE/bin/"
cp -R frontend/dist "$STAGE/share/ekiptakip/web"

mkdir -p dist
tar -C "$STAGE" -czf "dist/$TAR" bin share
HASH=$(nix hash file --sri "dist/$TAR")

PIN=$(cat <<EOF
# tools/release.sh yazar — ELLE DUZENLEME.
{
  tag = "$TAG";
  url = "https://github.com/$REPO/releases/download/$TAG/$TAR";
  hash = "$HASH";
}
EOF
)

if [ -n "${DRY_RUN:-}" ]; then
  echo "dist/$TAR ($(du -h "dist/$TAR" | cut -f1)) — yukleme YOK. deploy/release.nix su olurdu:"
  echo "$PIN"
  exit 0
fi

# Once yukle, SONRA pin'le: yukleme patlarsa release.nix var olmayan bir
# dosyaya isaret etmez.
gh release create "$TAG" "dist/$TAR" --repo "$REPO" --prerelease \
  --title "Rust $SHA" --notes "aarch64-linux-musl, statik. Kaynak: $SHA"
echo "$PIN" > deploy/release.nix
echo "yuklendi. deploy/release.nix guncellendi — commit'le."
