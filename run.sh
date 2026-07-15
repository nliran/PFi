#!/bin/bash
# Launch the PFi portfolio tracker, then open it in your browser.
cd "$(dirname "$0")"
echo "Starting PFi at http://127.0.0.1:8765  (Ctrl-C to stop)"
( sleep 1 && open http://127.0.0.1:8765 ) &
python3 app/server.py
