#!/bin/bash
# Start PFi on your LAN over HTTPS, protected by a username + password.
#
# The password is typed at a prompt, so it never lands in your shell history.
# Stop the server with Ctrl-C here, or run ./shutdown.sh from another terminal.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PFI_PORT:-8765}"

# Username: reuse an exported PFI_USER if present, otherwise prompt (default "pfi").
USER_NAME="${PFI_USER:-}"
if [ -z "$USER_NAME" ]; then
  read -r -p "Username [pfi]: " USER_NAME
  USER_NAME="${USER_NAME:-pfi}"
fi

# Password: prompt silently and confirm; require a non-empty match.
while true; do
  read -r -s -p "Password: " PASS1; echo
  if [ -z "$PASS1" ]; then echo "Password cannot be empty."; continue; fi
  read -r -s -p "Confirm:  " PASS2; echo
  [ "$PASS1" = "$PASS2" ] && break
  echo "Passwords did not match — try again."
done

# Best-effort LAN IP for the printed URL.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '')"

echo
echo "Starting PFi on your LAN (HTTPS, login required)…"
[ -n "$LAN_IP" ] && echo "  Open from any device:  https://$LAN_IP:$PORT"
echo "  Self-signed cert — your browser will warn once; that's expected."
echo "  Stop: Ctrl-C here, or ./shutdown.sh from another terminal."
echo

export PFI_HOST=0.0.0.0
export PFI_PORT="$PORT"
export PFI_TLS=1
export PFI_USER="$USER_NAME"
export PFI_PASS="$PASS1"
# exec replaces this shell with python, so signals (Ctrl-C) and ./shutdown.sh
# act directly on the server process.
exec python3 app/server.py
