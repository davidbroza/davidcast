#!/usr/bin/env bash
# Patch LSUIElement=true into every davidcast.app Info.plist under
# src-tauri/target/. Without this key the bundle is treated as a regular
# dock app — even with NSWindow level=screensaver and CanJoinAllSpaces,
# macOS still won't float the palette over another app's fullscreen Space.
# Tauri 2's bundle config has no infoPlist override, so we patch after.
set -euo pipefail

cd "$(dirname "$0")/.."

shopt -s nullglob
plists=(
  src-tauri/target/release/bundle/macos/davidcast.app/Contents/Info.plist
  src-tauri/target/*-apple-darwin/release/bundle/macos/davidcast.app/Contents/Info.plist
)

found=0
for plist in "${plists[@]}"; do
  [ -f "$plist" ] || continue
  found=1
  plutil -insert LSUIElement -bool YES "$plist" 2>/dev/null \
    || plutil -replace LSUIElement -bool YES "$plist"
  echo "patched LSUIElement: $plist"
done

if [ "$found" = "0" ]; then
  echo "patch-info-plist.sh: no davidcast.app bundles found under target/ — nothing to patch" >&2
fi
