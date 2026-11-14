#!/bin/bash
# Build the Vroom iOS shell (with the current ../index.html baked in) and install it on a phone.
#
#   ios/device.sh                         # POSEIDON by default
#   DEVICE=<devicectl id or name> ios/device.sh
#   TEAM=ABCDE12345 BUNDLE=com.you.vroom ios/device.sh
#
# The phone must be paired with this Mac once (Xcode > Window > Devices and Simulators), unlocked,
# with Developer Mode on (Settings > Privacy & Security).
set -euo pipefail
cd "$(dirname "$0")"

TEAM="${TEAM:-E97LU2X2VL}"
BUNDLE="${BUNDLE:-cloud.acker.vroom}"
DEVICE="${DEVICE:-39C5CC20-5FC4-5942-AA30-305561CDB627}"
CONFIG="${CONFIG:-Release}"

command -v xcodegen >/dev/null || { echo "xcodegen missing: brew install xcodegen"; exit 1; }
xcodegen generate --quiet

LOG=build-device.log
set +e
xcodebuild -project Vroom.xcodeproj -scheme Vroom -configuration "$CONFIG" \
  -destination "generic/platform=iOS" -derivedDataPath build-device \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE" \
  CODE_SIGN_STYLE=Automatic build >"$LOG" 2>&1
STATUS=$?
set -e
grep -E "sync-web:|error:|warning: .*(sign|provision)|\*\* BUILD" "$LOG" || true
[ $STATUS -eq 0 ] || { echo "build failed (full log: ios/$LOG)"; exit $STATUS; }

APP="build-device/Build/Products/$CONFIG-iphoneos/Vroom.app"
[ -f "$APP/web/index.html" ] || { echo "web/index.html missing from $APP"; exit 1; }

xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --terminate-existing --device "$DEVICE" "$BUNDLE"
