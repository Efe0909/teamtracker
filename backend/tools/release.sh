#!/bin/bash
# Yayin ikilisi: Mac'te cross-derle -> tarball -> GitHub release -> deploy/release.nix.
#
# flake.nix'teki `packages.<sistem>.default` bu dosyadaki url+hash'i fetchurl
# ile ceker; hedef makine (VM/Pi/VDS) HIC derleme yapmaz. Tarball ikiliyi VE
# on yuz derlemesini (frontend/dist -> share/ekiptakip/web) birlikte tasir:
# ayni commit'ten, API ile istemcisi birbirine uyumlu. Iki hedef, tek release:
# aarch64-linux (Pi, VM) ve x86_64-linux (VDS).
#
#   backend/tools/release.sh              # GERCEK: GitHub'a yukler (herkese acik)
#   DRY_RUN=1 backend/tools/release.sh    # derler + tarball + hash; yukleme YOK,
#                                         # release.nix yazilmaz, icerigi basar
#
# Sonra: git add deploy/release.nix && git commit; ~/nix'te
#   nix flake update teamtracker-alpha02
set -euo pipefail
cd "$(dirname "$0")/../.."       # depo koku

[ -n "${DRY_RUN:-}" ] || [ -z "$(git status --porcelain --untracked-files=no)" ] \
  || { echo "calisma agaci temiz degil: once commit'le (tarball HEAD'e karsilik gelmeli)"; exit 1; }

SHA=$(git rev-parse --short=10 HEAD)
TAG=rust-$SHA
REPO=Efe0909/teamtracker
# Nix sistemi -> Rust hedefi
TARGETS="aarch64-linux:aarch64-unknown-linux-musl x86_64-linux:x86_64-unknown-linux-musl"

# npm ci: package-lock.json'a birebir; derleme tsc denetiminden gecmezse durur.
(cd frontend && npm ci --no-audit --no-fund && npm run build)

mkdir -p dist
PIN="# tools/release.sh yazar — ELLE DUZENLEME.
{
  tag = \"$TAG\";"
ASSETS=()
for pair in $TARGETS; do
  SYS=${pair%%:*}; TRIPLE=${pair##*:}
  TAR=ekiptakip-$SHA-$SYS.tar.gz

  (cd backend && nix shell nixpkgs#zig nixpkgs#cargo-zigbuild \
    --command cargo zigbuild --release --target "$TRIPLE")

  STAGE=$(mktemp -d)
  # `install -D` GNU'ya ozgu, macOS'ta yok: mkdir + cp.
  mkdir -p "$STAGE/bin" "$STAGE/share/ekiptakip"
  cp "backend/target/$TRIPLE/release/ekiptakip" "$STAGE/bin/"
  cp -R frontend/dist "$STAGE/share/ekiptakip/web"
  tar -C "$STAGE" -czf "dist/$TAR" bin share
  rm -rf "$STAGE"

  HASH=$(nix hash file --sri "dist/$TAR")
  ASSETS+=("dist/$TAR")
  PIN="$PIN
  $SYS = {
    url = \"https://github.com/$REPO/releases/download/$TAG/$TAR\";
    hash = \"$HASH\";
  };"
done
PIN="$PIN
}"

if [ -n "${DRY_RUN:-}" ]; then
  du -h "${ASSETS[@]}"
  echo "yukleme YOK. deploy/release.nix su olurdu:"
  echo "$PIN"
  exit 0
fi

# Once yukle, SONRA pin'le: yukleme patlarsa release.nix var olmayan bir
# dosyaya isaret etmez.
gh release create "$TAG" "${ASSETS[@]}" --repo "$REPO" --prerelease \
  --title "Rust $SHA" --notes "linux-musl, statik (aarch64 + x86_64). Kaynak: $SHA"
echo "$PIN" > deploy/release.nix
echo "yuklendi. deploy/release.nix guncellendi — commit'le."
