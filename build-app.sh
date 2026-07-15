#!/bin/bash
# Build the self-contained PFi.app launcher from the current source tree.
#
# The bundle carries a COPY of the app code (Contents/Resources/app) and the
# icon — but never any data: your DB, logs, and TLS certs live in
# ~/Library/Application Support/PFi, completely outside the bundle. That makes
# PFi.app relocatable AND safe to share (it contains code only).
#
# Usage:
#   ./build-app.sh                 build/refresh ~/Applications/PFi.app
#   ./build-app.sh --share         also write a shareable PFi.app.zip to ~/Desktop
#   ./build-app.sh /path/PFi.app   build to a custom location
set -euo pipefail
cd "$(dirname "$0")"
SRC="$(pwd)"

SHARE=0
TARGET="$HOME/Applications/PFi.app"
for arg in "$@"; do
  case "$arg" in
    --share) SHARE=1 ;;
    *) TARGET="$arg" ;;
  esac
done

VERSION="$(/usr/bin/python3 -c "import sys; sys.path.insert(0,'app'); import version; print(version.APP_VERSION)")"
echo "Building PFi.app v$VERSION -> $TARGET"

rm -rf "$TARGET"
mkdir -p "$TARGET/Contents/MacOS" "$TARGET/Contents/Resources/app"

# --- code (NO data/, NO certs/, NO caches) -----------------------------------
# rsync with explicit excludes keeps the bundle data-free even if stray files
# appear next to the code.
rsync -a \
  --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='certs' --exclude='data' --exclude='*.db' \
  --exclude='*.db-*' --exclude='*.pem' --exclude='*.log' \
  app/ "$TARGET/Contents/Resources/app/"

# --- icon --------------------------------------------------------------------
cp launcher/PFi.icns "$TARGET/Contents/Resources/AppIcon.icns"

# --- Info.plist --------------------------------------------------------------
cat > "$TARGET/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>PFi</string>
	<key>CFBundleDisplayName</key>
	<string>PFi</string>
	<key>CFBundleIdentifier</key>
	<string>com.noam.pfi</string>
	<key>CFBundleVersion</key>
	<string>$VERSION</string>
	<key>CFBundleShortVersionString</key>
	<string>$VERSION</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleExecutable</key>
	<string>PFi</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.13</string>
	<key>LSUIElement</key>
	<true/>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
PLIST

# --- launcher executable (self-locating; data lives in Application Support) ---
cat > "$TARGET/Contents/MacOS/PFi" <<'LAUNCH'
#!/bin/bash
# PFi launcher. Runs the server code bundled INSIDE this .app, with all data in
# ~/Library/Application Support/PFi. Relocatable: everything is resolved from
# the bundle's own path, so the .app works wherever you move it.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin"

APP_CODE="$(cd "$(dirname "$0")/../Resources/app" 2>/dev/null && pwd || true)"
PORT="${PFI_PORT:-8765}"
URL="http://127.0.0.1:$PORT"
PY="/usr/bin/python3"
DATA="$HOME/Library/Application Support/PFi"
LOG="$DATA/pfi-server.log"
mkdir -p "$DATA"

if [ -z "$APP_CODE" ] || [ ! -f "$APP_CODE/server.py" ]; then
  osascript -e 'display alert "PFi could not start" message "The app code inside PFi.app is missing or damaged. Rebuild it with build-app.sh." as critical' >/dev/null 2>&1
  exit 1
fi

cd "$APP_CODE"
if ! lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  nohup "$PY" server.py >>"$LOG" 2>&1 &
  for _ in $(seq 1 30); do
    lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1 && break
    sleep 0.2
  done
fi
open "$URL"
LAUNCH
chmod +x "$TARGET/Contents/MacOS/PFi"

# Refresh Finder's view of the (re)built bundle.
touch "$TARGET"

# --- safety: assert the bundle carries no data --------------------------------
LEAK="$(find "$TARGET" \( -name '*.db' -o -name '*.pem' -o -name '*.log' -o -name 'pfi.db*' \) 2>/dev/null || true)"
if [ -n "$LEAK" ]; then
  echo "ERROR: bundle contains data files that must not ship:" >&2
  echo "$LEAK" >&2
  exit 1
fi
echo "OK: bundle is data-free."

if [ "$SHARE" = "1" ]; then
  ZIP="$HOME/Desktop/PFi-v$VERSION.app.zip"
  rm -f "$ZIP"
  ( cd "$(dirname "$TARGET")" && /usr/bin/ditto -c -k --keepParent "$(basename "$TARGET")" "$ZIP" )
  echo "Shareable (code-only) zip: $ZIP"
fi

echo "Done."
