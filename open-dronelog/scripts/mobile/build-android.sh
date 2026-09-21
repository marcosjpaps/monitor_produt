#!/usr/bin/env sh
set -eu

MODE="debug"
SPLIT_PER_ABI="false"
TARGET=""
BUILD_APK="false"
BUILD_AAB="false"

usage() {
  cat <<'EOF'
Usage: ./scripts/mobile/build-android.sh [options]

Options:
  --release              Build in release mode
  --debug                Build in debug mode (default)
  --target <abi>         Build only one ABI: aarch64 | armv7 | i686 | x86_64
  --split-per-abi        Generate split artifacts per ABI
  --apk                  Generate APK output
  --aab                  Generate AAB output
  --help                 Show this help

Examples:
  ./scripts/mobile/build-android.sh --release --target aarch64 --apk
  ./scripts/mobile/build-android.sh --release --split-per-abi --aab
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --release)
      MODE="release"
      shift
      ;;
    --debug)
      MODE="debug"
      shift
      ;;
    --target)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --target" >&2
        exit 1
      fi
      TARGET="$2"
      shift 2
      ;;
    --target=*)
      TARGET="${1#*=}"
      shift
      ;;
    --split-per-abi)
      SPLIT_PER_ABI="true"
      shift
      ;;
    --apk)
      BUILD_APK="true"
      shift
      ;;
    --aab)
      BUILD_AAB="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -n "$TARGET" ]; then
  case "$TARGET" in
    aarch64|armv7|i686|x86_64) ;;
    *)
      echo "Invalid --target value: $TARGET" >&2
      echo "Allowed values: aarch64, armv7, i686, x86_64" >&2
      exit 1
      ;;
  esac
fi

# Default to APK-only if no artifact type is specified.
if [ "$BUILD_APK" = "false" ] && [ "$BUILD_AAB" = "false" ]; then
  BUILD_APK="true"
fi

# Ensure the generated Android project exists (important for fresh CI runners).
if [ ! -d "src-tauri/gen/android" ]; then
  echo "Android project not initialized. Running: npx tauri android init"
  npx tauri android init --config src-tauri/tauri.android.conf.json
fi

set -- npx tauri android build --config src-tauri/tauri.android.conf.json

if [ "$MODE" = "debug" ]; then
  set -- "$@" --debug
fi

if [ "$SPLIT_PER_ABI" = "true" ]; then
  set -- "$@" --split-per-abi
fi

if [ -n "$TARGET" ]; then
  set -- "$@" --target "$TARGET"
fi

if [ "$BUILD_APK" = "true" ]; then
  set -- "$@" --apk
fi

if [ "$BUILD_AAB" = "true" ]; then
  set -- "$@" --aab
fi

"$@"
