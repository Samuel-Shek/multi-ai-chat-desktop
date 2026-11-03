#!/bin/sh
# Print the commit, lockfile hashes, and ARM64 bundle hashes for a hardened build.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

fail() {
  echo "fingerprint failed: $*" >&2
  exit 1
}

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

if [ -n "$(git status --porcelain)" ]; then
  echo "dirty-tree refuse: commit or stash changes before recording a fingerprint" >&2
  exit 1
fi

app="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Multi-AI Chat Hardened.app"
dmg_dir="src-tauri/target/aarch64-apple-darwin/release/bundle/dmg"

[ -d "$app" ] || fail "app bundle is absent: $app"
found_binary=0
for binary in "$app/Contents/MacOS"/*; do
  if [ -f "$binary" ]; then
    found_binary=1
    binary_type=$(file -b "$binary") || fail "cannot inspect app binary: $binary"
    case "$binary_type" in
      *"Mach-O 64-bit executable arm64"*) ;;
      *) fail "app binary is not arm64: $binary ($binary_type)" ;;
    esac
  fi
done
[ "$found_binary" -eq 1 ] || fail "app binary is absent: $app/Contents/MacOS"

dmg_count=0
disk_image=
for dmg in "$dmg_dir"/*.dmg; do
  if [ -f "$dmg" ]; then
    dmg_count=$((dmg_count + 1))
    disk_image=$dmg
  fi
done
[ "$dmg_count" -gt 0 ] || fail "DMG is absent: $dmg_dir"
[ "$dmg_count" -eq 1 ] || fail "expected exactly one DMG, found $dmg_count: $dmg_dir"

command -v codesign >/dev/null 2>&1 || fail "codesign is unavailable; cannot verify signature Identifier"
signature=$(codesign -dv --verbose=4 "$app" 2>&1) || fail "cannot read app signature: $signature"
identifier=$(printf '%s\n' "$signature" | awk '/^Identifier=/ { sub(/^Identifier=/, ""); print }')
[ "$identifier" = "com.samuelshek.multiaichat.hardened" ] || fail "unexpected signature Identifier: ${identifier:-absent}"
codesign --verify --deep --strict "$app" || fail "codesign --verify --deep --strict failed: $app"

echo "commit $(git rev-parse HEAD)"
echo "pnpm-lock.yaml $(hash_file pnpm-lock.yaml)"
echo "src-tauri/Cargo.lock $(hash_file src-tauri/Cargo.lock)"
for binary in "$app/Contents/MacOS"/*; do
  if [ -f "$binary" ]; then
    echo "app-binary $(basename "$binary") $(hash_file "$binary")"
  fi
done
echo "codesign-display:"
printf '%s\n' "$signature"
echo "codesign-verify ok"
echo "dmg $(basename "$disk_image") $(hash_file "$disk_image")"
