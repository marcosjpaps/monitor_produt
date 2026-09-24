#!/usr/bin/env sh
set -eu

# Start Android development run against connected device/emulator.
npx tauri android dev --config src-tauri/tauri.android.conf.json
