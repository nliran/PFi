#!/bin/bash
# Stop a running PFi server — works for both the local (run.sh) and LAN
# (run-lan.sh) modes, since both default to port 8765.
#
# Usage:  ./shutdown.sh            stop the server on the default port (8765)
#         ./shutdown.sh 8799       stop a server on a custom port
cd "$(dirname "$0")"

PORT="${1:-${PFI_PORT:-8765}}"

# Prefer a surgical, port-scoped stop: kill whatever is LISTENING on the port
# (-sTCP:LISTEN avoids killing browser tabs that merely hold a client
# connection to it). Only if nothing is on that port do we broaden to "any PFi
# server" via the command line — that covers a server started on a forgotten or
# custom port, without nuking a healthy server on a different port.
PIDS="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | sort -u)"
SCOPE="port $PORT"
if [ -z "$PIDS" ]; then
  PIDS="$(pgrep -f "app/server.py" 2>/dev/null | sort -u)"
  SCOPE="app/server.py (no listener on port $PORT)"
fi

if [ -z "$PIDS" ]; then
  echo "No PFi server found (port $PORT, or app/server.py)."
  exit 0
fi
echo "Target: $SCOPE"

echo "Stopping PFi (PIDs: $(echo "$PIDS" | tr '\n' ' '))…"
kill $PIDS 2>/dev/null  # graceful TERM first

# Give it up to ~5s to exit cleanly, then force-kill any stragglers.
for _ in $(seq 1 10); do
  STILL="$(for p in $PIDS; do kill -0 "$p" 2>/dev/null && echo "$p"; done)"
  [ -z "$STILL" ] && break
  sleep 0.5
done
STILL="$(for p in $PIDS; do kill -0 "$p" 2>/dev/null && echo "$p"; done)"
if [ -n "$STILL" ]; then
  echo "Force-stopping: $(echo "$STILL" | tr '\n' ' ')"
  kill -9 $STILL 2>/dev/null
fi

echo "PFi stopped."
