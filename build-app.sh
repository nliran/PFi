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

# Read the version with sed, not Python: this script also runs from inside the
# app (self-update rebuild), where the system python3 can't start (see the
# launcher below).
VERSION="$(sed -nE 's/^APP_VERSION = "([^"]+)".*/\1/p' app/version.py)"
if [ -z "$VERSION" ]; then
  echo "ERROR: couldn't read APP_VERSION from app/version.py" >&2
  exit 1
fi
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
DATA="$HOME/Library/Application Support/PFi"
LOG="$DATA/pfi-server.log"
mkdir -p "$DATA"

alert() {  # alert <title> <message> — args go through argv, so no quoting issues
  osascript - "$1" "$2" >/dev/null 2>&1 <<'OSA'
on run argv
  display alert (item 1 of argv) message (item 2 of argv) as critical
end run
OSA
}

listening() { lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; }

if [ -z "$APP_CODE" ] || [ ! -f "$APP_CODE/server.py" ]; then
  alert "PFi could not start" "The app code inside PFi.app is missing or damaged. Rebuild it with build-app.sh."
  exit 1
fi

# Pick a Python that actually runs when launched from an app. On macOS 26 the
# Command Line Tools shim (/usr/bin/python3) fails with "posix_spawn ...
# Undefined error: 0" under LaunchServices, even though it works in Terminal —
# so prefer a standalone install, keep the system one as a last resort, and
# test-run each candidate rather than trusting that it exists.
PY=""
for cand in /usr/local/bin/python3 /opt/homebrew/bin/python3 \
            /Library/Frameworks/Python.framework/Versions/Current/bin/python3 \
            /usr/bin/python3; do
  [ -x "$cand" ] || continue
  if "$cand" -c 'import sqlite3, ssl' >/dev/null 2>&1; then PY="$cand"; break; fi
done

cd "$APP_CODE"
if ! listening; then
  if [ -z "$PY" ]; then
    alert "PFi could not start" "No working Python 3 was found. Install Python 3 from python.org, then open PFi again."
    exit 1
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] launcher: starting server with $PY" >>"$LOG"
  nohup "$PY" server.py >>"$LOG" 2>&1 &
  pid=$!
  for _ in $(seq 1 50); do
    listening && break
    kill -0 "$pid" 2>/dev/null || break   # server already exited — stop waiting
    sleep 0.2
  done
  if ! listening; then
    alert "PFi could not start" "The server didn't come up. Last log line:

$(tail -n 1 "$LOG")

Full log: $LOG"
    exit 1
  fi
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
