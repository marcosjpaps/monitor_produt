#!/usr/bin/env sh
set -eu

printf '%s\n' 'Running Android toolchain checks for Open DroneLog...'

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

fail=0

check_cmd() {
  if has_cmd "$1"; then
    printf '  [ok] %s\n' "$1"
  else
    printf '  [missing] %s\n' "$1"
    fail=1
  fi
}

check_cmd node
check_cmd npm
check_cmd rustup
check_cmd cargo
check_cmd java
check_cmd javac
check_cmd adb
check_cmd sdkmanager

if has_cmd rustup; then
  printf '%s\n' 'Checking Rust Android targets...'
  for target in aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android; do
    if rustup target list --installed | grep -q "^${target}$"; then
      printf '  [ok] %s\n' "$target"
    else
      printf '  [missing] %s (install with: rustup target add %s)\n' "$target" "$target"
      fail=1
    fi
  done
fi

if [ "${fail}" -ne 0 ]; then
  printf '%s\n' 'Android doctor failed. Install missing dependencies and retry.'
  exit 1
fi

printf '%s\n' 'Android doctor passed.'
