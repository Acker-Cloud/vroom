#!/bin/bash
# Copy the repo's one-file game into the app bundle as web/index.html.
# Runs as an Xcode pre-build phase (TARGET_BUILD_DIR set) or by hand (copies into ios/web/ for a look).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../index.html"
[ -f "$SRC" ] || { echo "error: $SRC not found"; exit 1; }

if [ -n "${TARGET_BUILD_DIR:-}" ] && [ -n "${UNLOCALIZED_RESOURCES_FOLDER_PATH:-}" ]; then
  DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/web"
else
  DEST="$HERE/build/web"
fi
mkdir -p "$DEST"
cp -f "$SRC" "$DEST/index.html"
VER=$(grep -oE "APP_VERSION *= *'[^']+'" "$SRC" | head -1 | grep -oE "'[^']+'" | tr -d "'" || true)
echo "sync-web: index.html ${VER:+v$VER }-> $DEST"
