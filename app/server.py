"""Local web server for the PFi portfolio tracker.

Thin HTTP layer: serves the static frontend and delegates every ``/api/*``
request to :mod:`api` (route registry + handlers). Pure Python standard library,
backed by SQLite. Localhost-only by default -- your data never leaves the machine.

Run:  python3 server.py   then open http://127.0.0.1:8765

Exposing it to your LAN (see the security caveats below):
  PFI_HOST=0.0.0.0 \
  PFI_USER=you PFI_PASS=somesecret \
  PFI_TLS=1 \
  python3 server.py            then open https://<your-lan-ip>:8765

Environment variables:
  PFI_HOST   bind address (default 127.0.0.1; use 0.0.0.0 for LAN access)
  PFI_PORT   bind port (default 8765)
  PFI_USER   HTTP Basic-auth username  (auth enforced only when BOTH are set)
  PFI_PASS   HTTP Basic-auth password
  PFI_TLS    "1" to serve over HTTPS with a self-signed cert
  PFI_DATA_DIR  data directory for DB/logs/certs
                (default ~/Library/Application Support/PFi)
  PFI_DB     DB file path (default <data dir>/pfi.db)
  PFI_CERT   cert path (default <data dir>/certs/cert.pem; auto-generated)
  PFI_KEY    key path  (default <data dir>/certs/key.pem;  auto-generated)
"""
import base64
import hmac
import json
import os
import socket
import ssl
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import api
import db as dbmod
from version import APP_VERSION

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
# Defaults to localhost-only (your data never leaves the machine). Set
# PFI_HOST=0.0.0.0 to expose it to your LAN -- but turn on PFI_USER/PFI_PASS
# (Basic auth) and PFI_TLS=1 (HTTPS) first, because there is otherwise no gate.
HOST = os.environ.get("PFI_HOST", "127.0.0.1")
PORT = int(os.environ.get("PFI_PORT", "8765"))

# Auth is enforced only when a username AND password are both provided.
AUTH_USER = os.environ.get("PFI_USER") or ""
AUTH_PASS = os.environ.get("PFI_PASS") or ""
AUTH_ON = bool(AUTH_USER and AUTH_PASS)

# TLS / self-signed certificate. Kept in the per-user data dir (not inside the
# code/bundle) so the app stays read-only-friendly and data-free.
TLS_ON = os.environ.get("PFI_TLS", "0") == "1"
CERT = os.environ.get("PFI_CERT", os.path.join(dbmod.DATA_DIR, "certs", "cert.pem"))
KEY = os.environ.get("PFI_KEY", os.path.join(dbmod.DATA_DIR, "certs", "key.pem"))

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".ico": "image/x-icon",
}


class Handler(BaseHTTPRequestHandler):
    server_version = f"PFi/{APP_VERSION}"

    def log_message(self, *a):
        pass  # quiet

    # -- auth
    def _check_auth(self):
        """Return True if the request may proceed. When Basic auth is enabled,
        an unauthenticated/incorrect request gets a 401 + WWW-Authenticate
        (the browser then shows a native login prompt) and we return False."""
        if not AUTH_ON:
            return True
        hdr = self.headers.get("Authorization", "")
        if hdr.startswith("Basic "):
            try:
                user, _, pw = base64.b64decode(hdr[6:]).decode("utf-8").partition(":")
            except Exception:
                user = pw = ""
            # Constant-time compare on both fields to avoid leaking length/timing.
            if hmac.compare_digest(user, AUTH_USER) and hmac.compare_digest(pw, AUTH_PASS):
                return True
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="PFi", charset="UTF-8"')
        self.send_header("Content-Length", "0")
        self.end_headers()
        return False

    # -- helpers
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}

    def _serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        safe = os.path.normpath(path).lstrip("/")
        full = os.path.join(STATIC, safe)
        if not full.startswith(STATIC) or not os.path.isfile(full):
            return self.send_error(404)
        ext = os.path.splitext(full)[1]
        ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # -- dispatch
    def _handle(self, method):
        if not self._check_auth():
            return
        path = urlparse(self.path).path
        # Graceful self-shutdown (the in-app "Quit PFi" button). Reply first,
        # then stop the server from a separate thread -- ThreadingHTTPServer's
        # shutdown() must not run on the serve_forever() loop's own thread.
        if method == "POST" and path == "/api/shutdown":
            self._send_json({"ok": True, "message": "PFi is shutting down."})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        if not path.startswith("/api/"):
            if method == "GET":
                return self._serve_static(path)
            return self.send_error(404)
        body = self._read_body() if method in ("POST", "PUT") else {}
        conn = dbmod.connect()
        try:
            result = api.dispatch(method, path, conn, body)
        finally:
            conn.close()
        if result is None:
            return self.send_error(404)
        status, payload = result
        if payload is None:
            return self.send_error(status if status >= 400 else 404)
        self._send_json(payload, status)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")

    def do_DELETE(self):
        self._handle("DELETE")


def _lan_ips():
    """Best-effort set of this host's reachable IPv4 addresses, for the cert SAN."""
    ips = {"127.0.0.1"}
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # no packets sent; just picks the outbound iface
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return sorted(ips)


def _ensure_cert():
    """Generate a self-signed cert+key (via the openssl CLI) if they don't exist.
    The SAN covers localhost + this host's LAN IPs so browsers accept the
    hostname after you trust the cert once."""
    if os.path.isfile(CERT) and os.path.isfile(KEY):
        return
    os.makedirs(os.path.dirname(CERT) or ".", exist_ok=True)
    san = ["DNS:localhost"] + [f"IP:{ip}" for ip in _lan_ips()]
    conf = (
        "[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n"
        "[dn]\nCN=PFi Local\n"
        "[v3]\nbasicConstraints=CA:FALSE\nsubjectAltName=" + ",".join(san) + "\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".cnf", delete=False) as f:
        f.write(conf)
        conf_path = f.name
    try:
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
             "-keyout", KEY, "-out", CERT, "-days", "825", "-config", conf_path],
            check=True, capture_output=True,
        )
        os.chmod(KEY, 0o600)
        print(f"Generated self-signed cert for {', '.join(san)} -> {CERT}")
    finally:
        os.unlink(conf_path)


def main():
    dbmod.init().close()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    scheme = "http"
    if TLS_ON:
        _ensure_cert()
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        scheme = "https"

    if HOST not in ("127.0.0.1", "localhost") and not AUTH_ON:
        print("WARNING: bound to a non-localhost address with NO authentication.\n"
              "         Anyone on your network can read AND edit your data.\n"
              "         Set PFI_USER and PFI_PASS to require a login.")

    shown_host = "127.0.0.1" if HOST in ("0.0.0.0", "") else HOST
    print(f"PFi {APP_VERSION} running at {scheme}://{shown_host}:{PORT}  "
          f"(auth {'ON' if AUTH_ON else 'off'}, Ctrl-C to stop)")
    if HOST in ("0.0.0.0", ""):
        for ip in _lan_ips():
            if ip != "127.0.0.1":
                print(f"  LAN: {scheme}://{ip}:{PORT}")
    try:
        srv.serve_forever()  # returns when /api/shutdown calls srv.shutdown()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
        print("\nstopped")


if __name__ == "__main__":
    main()
