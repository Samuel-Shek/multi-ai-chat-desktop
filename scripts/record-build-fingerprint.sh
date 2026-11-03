#!/bin/sh
# Print the commit, lockfile hashes, and ARM64 bundle hashes for a hardened build.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

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

echo "commit $(git rev-parse HEAD)"
echo "pnpm-lock.yaml $(hash_file pnpm-lock.yaml)"
echo "src-tauri/Cargo.lock $(hash_file src-tauri/Cargo.lock)"

app="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Multi-AI Chat Hardened.app"
dmg_dir="src-tauri/target/aarch64-apple-darwin/release/bundle/dmg"

if [ -d "$app/Contents/MacOS" ]; then
  found_binary=0
  for binary in "$app/Contents/MacOS"/*; do
    if [ -f "$binary" ]; then
      found_binary=1
      echo "app-binary $(basename "$binary") $(hash_file "$binary")"
    fi
  done
  if [ "$found_binary" -eq 0 ]; then
    echo "app-binary absent"
  fi
  if command -v codesign >/dev/null 2>&1; then
    echo "codesign-display:"
    codesign -dv --verbose=4 "$app" 2>&1 || true
    if codesign --verify --deep --strict "$app"; then
      echo "codesign-verify ok"
    else
      echo "codesign-verify failed"
    fi
  else
    echo "codesign not available on this host"
  fi
else
  echo "app-binary absent"
  echo "codesign not checked: app bundle is absent"
fi

if [ -d "$dmg_dir" ]; then
  found_dmg=0
  for dmg in "$dmg_dir"/*.dmg; do
    if [ -f "$dmg" ]; then
      found_dmg=1
      echo "dmg $(basename "$dmg") $(hash_file "$dmg")"
    fi
  done
  if [ "$found_dmg" -eq 0 ]; then
    echo "dmg absent"
  fi
else
  echo "dmg absent"
fi
