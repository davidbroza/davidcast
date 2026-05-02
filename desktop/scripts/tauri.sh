#!/usr/bin/env bash
# Wrap the Tauri CLI so every `pnpm tauri build` automatically patches
# Info.plist with LSUIElement=true. See patch-info-plist.sh for the why.
# `dev` and other subcommands exec straight through.
set -e

here="$(cd "$(dirname "$0")" && pwd)"
tauri="$here/../node_modules/.bin/tauri"

if [ "${1:-}" = "build" ]; then
  "$tauri" "$@"
  bash "$here/patch-info-plist.sh"
else
  exec "$tauri" "$@"
fi
