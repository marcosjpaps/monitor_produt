#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_ICON="$ROOT_DIR/src/assets/icon.png"
TAURI_ICON="$ROOT_DIR/src-tauri/icons/icon.png"
ANDROID_RES_DIR="$ROOT_DIR/src-tauri/gen/android/app/src/main/res"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

cp "$SOURCE_ICON" "$TAURI_ICON"

echo "Synced Tauri source icon: $TAURI_ICON"

if [[ -d "$ANDROID_RES_DIR" ]]; then
  while IFS= read -r target; do
    cp "$SOURCE_ICON" "$target"
  done < <(find "$ANDROID_RES_DIR" -type f \( -name 'ic_launcher.png' -o -name 'ic_launcher_round.png' -o -name 'ic_launcher_foreground.png' \))
  echo "Synced generated Android launcher icon assets under: $ANDROID_RES_DIR"
else
  echo "Android generated resources not found yet. Run android init/build first."
fi
