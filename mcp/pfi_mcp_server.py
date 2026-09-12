#!/usr/bin/env python3
"""PFi MCP server -- read-only bridge from any MCP client to a local PFi instance.

Lets an AI (Claude Desktop, Claude Code, or any Model Context Protocol client)
connect to a running PFi tracker and answer questions about the portfolio with
structured tool calls instead of raw JSON. It talks to PFi over its ordinary
HTTP API, so it works against a localhost instance or a LAN one; it only ever
issues GETs, so it can read and analyze but never change your data.

Zero dependencies -- pure Python standard library, matching PFi itself. It speaks
the MCP stdio transport by hand (newline-delimited JSON-RPC 2.0 on stdin/stdout).
Protocol messages use stdout ONLY; all diagnostics go to stderr.

Point it at an instance with environment variables:
  PFI_URL       base URL of the PFi server   (default http://127.0.0.1:8765)
  PFI_USER      HTTP Basic-auth username      (only if that instance requires it)
  PFI_PASS      HTTP Basic-auth password
  PFI_INSECURE  "1" to skip TLS verification  (for a LAN instance's self-signed
                cert; not needed for the default http://127.0.0.1)

Run it the way an MCP client would (stdio): ``python3 pfi_mcp_server.py``.
See README.md in this directory for Claude Desktop / Claude Code setup.
"""
import base64
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

PROTOCOL_VERSION = "2024-11-05"  # echoed back to the client if it omits one
SERVER_NAME = "pfi"
SERVER_VERSION = "1.0.0"

BASE_URL = os.environ.get("PFI_URL", "http://127.0.0.1:8765").rstrip("/")
AUTH_USER = os.environ.get("PFI_USER") or ""
AUTH_PASS = os.environ.get("PFI_PASS") or ""
INSECURE = os.environ.get("PFI_INSECURE", "0") == "1"


def log(*a):
    """Diagnostics to stderr -- stdout is reserved for protocol messages."""
    print("[pfi-mcp]", *a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- #
# HTTP client for the PFi API                                                  #
# --------------------------------------------------------------------------- #
class ApiError(Exception):
    pass


def api_get(path, params=None):
    """GET {BASE_URL}{path} and return the decoded JSON. Raises ApiError with a
    human-readable message on any transport/HTTP/JSON failure."""
    url = BASE_URL + path
    if params:
        from urllib.parse import urlencode
        url += "?" + urlencode(params)
    req = urllib.request.Request(url, method="GET")
    if AUTH_USER and AUTH_PASS:
        token = base64.b64encode(f"{AUTH_USER}:{AUTH_PASS}".encode()).decode()
        req.add_header("Authorization", "Basic " + token)
    ctx = None
    if url.startswith("https") and INSECURE:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise ApiError(
                "PFi returned 401 Unauthorized. This instance needs a login -- "
                "set PFI_USER and PFI_PASS for the MCP server."
            )
        raise ApiError(f"PFi returned HTTP {e.code} for {path}.")
    except urllib.error.URLError as e:
        raise ApiError(
            f"Could not reach PFi at {BASE_URL} ({e.reason}). Is the tracker "
            f"running? Set PFI_URL if it listens elsewhere."
        )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise ApiError(f"PFi returned a non-JSON response for {path}.")


def _accounts_index():
    """name(lowercased) + id -> account dict, for resolving a name to an id."""
    accts = api_get("/api/accounts")
    by_id = {a["id"]: a for a in accts}
    by_name = {a["name"].lower(): a for a in accts}
    return accts, by_id, by_name


def _series_dates():
    """The net-worth series (also the id<->date map for snapshots)."""
    return api_get("/api/snapshots")


def _resolve_snapshot(series, date):
    """Find the snapshot row whose date matches `date` exactly or by prefix
    (so '2026-09' matches '2026-09-01'). Returns the row or None."""
    if not date:
        return None
    for r in series:
        if r["date"] == date or r["date"].startswith(date):
            return r
    return None


# --------------------------------------------------------------------------- #
# Tools -- each returns a JSON-serializable object                             #
# --------------------------------------------------------------------------- #
def tool_get_overview(_args):
    """The whole portfolio in one blob: net-worth time series, latest snapshot,
    allocation, ledgers, account metadata. Best first call for broad analysis."""
    return api_get("/api/export")


def tool_get_net_worth_series(_args):
    """Monthly net-worth history: liquid, nonliquid, debt, net_worth, and
    month-over-month change/pct_change per snapshot, oldest first."""
    return api_get("/api/snapshots")


def tool_get_allocation(_args):
    """Current asset allocation by class, net of any linked debt (real_estate is
    equity, not gross), with each class's share of total assets."""
    exp = api_get("/api/export")
    return {"date": exp["latest"]["date"], "allocation": exp["latest"]["allocation"]}


def tool_list_accounts(args):
    """Every account with its kind, asset_class, status, institution, rate, and
    ownership share. Set include_closed=false to hide closed accounts."""
    accts = api_get("/api/accounts")
    if args.get("include_closed") is False:
        accts = [a for a in accts if a.get("status") != "closed"]
    return accts


def tool_get_account_history(args):
    """One account's full month-by-month value history. Identify it by
    account_id, or by name (case-insensitive)."""
    accts, by_id, by_name = _accounts_index()
    aid = args.get("account_id")
    if aid is None:
        name = (args.get("name") or "").strip().lower()
        if not name:
            raise ApiError("Provide account_id or name.")
        match = by_name.get(name)
        if not match:
            # helpful partial-match hint
            near = [a["name"] for a in accts if name in a["name"].lower()]
            hint = f" Did you mean: {', '.join(near[:5])}?" if near else ""
            raise ApiError(f"No account named '{args.get('name')}'.{hint}")
        aid = match["id"]
    elif aid not in by_id:
        raise ApiError(f"No account with id {aid}.")
    return api_get(f"/api/accounts/{int(aid)}/history")


def tool_list_ledgers(_args):
    """Ledgers (loans, COGS, custom) with each one's running balance and entry
    count."""
    return api_get("/api/ledgers")


def tool_get_ledger(args):
    """One ledger's full detail: every dated entry with a running balance."""
    lid = args.get("ledger_id")
    if lid is None:
        raise ApiError("Provide ledger_id.")
    return api_get(f"/api/ledgers/{int(lid)}")


def tool_compare_months(args):
    """Per-account change between two months. Give date_a and date_b as
    'YYYY-MM-DD' or 'YYYY-MM'; omit to default to the two most recent months.
    Returns net-worth totals for each and every account that moved."""
    series = _series_dates()
    if len(series) < 1:
        raise ApiError("This instance has no snapshots yet.")
    date_a, date_b = args.get("date_a"), args.get("date_b")
    if not date_a and not date_b:
        row_b = series[-1]
        row_a = series[-2] if len(series) > 1 else series[-1]
    else:
        row_a = _resolve_snapshot(series, date_a) if date_a else series[-2]
        row_b = _resolve_snapshot(series, date_b) if date_b else series[-1]
    if not row_a or not row_b:
        avail = f"{series[0]['date']} .. {series[-1]['date']}"
        raise ApiError(f"Could not match those dates. Available range: {avail}.")

    det_a = api_get(f"/api/snapshots/{row_a['id']}")
    det_b = api_get(f"/api/snapshots/{row_b['id']}")
    va = {a["name"]: a["value"] for a in det_a["accounts"]}
    vb = {a["name"]: a["value"] for a in det_b["accounts"]}
    changes = []
    for name in sorted(set(va) | set(vb)):
        a_val, b_val = va.get(name), vb.get(name)
        delta = (b_val or 0) - (a_val or 0)
        if abs(delta) < 0.005:
            continue
        changes.append({
            "account": name,
            "from": a_val,          # null => did not exist that month
            "to": b_val,
            "change": delta,
        })
    changes.sort(key=lambda c: -abs(c["change"]))
    return {
        "from": {"date": row_a["date"], "net_worth": row_a["net_worth"]},
        "to": {"date": row_b["date"], "net_worth": row_b["net_worth"]},
        "net_worth_change": row_b["net_worth"] - row_a["net_worth"],
        "account_changes": changes,
    }


# name -> (handler, description, input schema properties, required list)
TOOLS = {
    "get_overview": (
        tool_get_overview,
        tool_get_overview.__doc__,
        {}, [],
    ),
    "get_net_worth_series": (
        tool_get_net_worth_series,
        tool_get_net_worth_series.__doc__,
        {}, [],
    ),
    "get_allocation": (
        tool_get_allocation,
        tool_get_allocation.__doc__,
        {}, [],
    ),
    "list_accounts": (
        tool_list_accounts,
        tool_list_accounts.__doc__,
        {"include_closed": {"type": "boolean",
                            "description": "Include closed accounts (default true)."}},
        [],
    ),
    "get_account_history": (
        tool_get_account_history,
        tool_get_account_history.__doc__,
        {"account_id": {"type": "integer", "description": "Account id."},
         "name": {"type": "string", "description": "Account name (case-insensitive)."}},
        [],
    ),
    "list_ledgers": (
        tool_list_ledgers,
        tool_list_ledgers.__doc__,
        {}, [],
    ),
    "get_ledger": (
        tool_get_ledger,
        tool_get_ledger.__doc__,
        {"ledger_id": {"type": "integer", "description": "Ledger id."}},
        ["ledger_id"],
    ),
    "compare_months": (
        tool_compare_months,
        tool_compare_months.__doc__,
        {"date_a": {"type": "string", "description": "Earlier month, YYYY-MM-DD or YYYY-MM."},
         "date_b": {"type": "string", "description": "Later month, YYYY-MM-DD or YYYY-MM."}},
        [],
    ),
}


def tools_list_payload():
    out = []
    for name, (_fn, desc, props, required) in TOOLS.items():
        out.append({
            "name": name,
            "description": " ".join((desc or "").split()),
            "inputSchema": {
                "type": "object",
                "properties": props,
                "required": required,
            },
        })
    return {"tools": out}


# --------------------------------------------------------------------------- #
# JSON-RPC / MCP stdio loop                                                    #
# --------------------------------------------------------------------------- #
def _result(msg_id, result):
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def _error(msg_id, code, message):
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def handle(msg):
    """Return a response dict for a request, or None for a notification."""
    method = msg.get("method")
    msg_id = msg.get("id")
    is_notification = "id" not in msg

    if method == "initialize":
        params = msg.get("params") or {}
        return _result(msg_id, {
            "protocolVersion": params.get("protocolVersion", PROTOCOL_VERSION),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        })

    if method in ("notifications/initialized", "initialized"):
        return None  # notification -- no reply

    if method == "ping":
        return _result(msg_id, {})

    if method == "tools/list":
        return _result(msg_id, tools_list_payload())

    if method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        entry = TOOLS.get(name)
        if not entry:
            return _error(msg_id, -32602, f"Unknown tool: {name}")
        fn = entry[0]
        try:
            data = fn(args)
            text = json.dumps(data, indent=2, default=str)
            return _result(msg_id, {"content": [{"type": "text", "text": text}]})
        except ApiError as e:
            # A tool-level error: report it inside the result so the model sees it.
            return _result(msg_id, {
                "content": [{"type": "text", "text": f"Error: {e}"}],
                "isError": True,
            })
        except Exception as e:  # pragma: no cover -- defensive
            log("tool crash:", repr(e))
            return _result(msg_id, {
                "content": [{"type": "text", "text": f"Internal error: {e}"}],
                "isError": True,
            })

    if is_notification:
        return None
    return _error(msg_id, -32601, f"Method not found: {method}")


def main():
    log(f"starting; PFI_URL={BASE_URL} auth={'on' if (AUTH_USER and AUTH_PASS) else 'off'}")
    stdin = sys.stdin
    while True:
        line = stdin.readline()
        if not line:  # EOF -- client closed the pipe
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            log("skipping non-JSON line")
            continue
        try:
            resp = handle(msg)
        except Exception as e:  # pragma: no cover -- never let the loop die
            log("handler crash:", repr(e))
            resp = _error(msg.get("id"), -32603, f"Internal error: {e}")
        if resp is not None:
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
    log("stdin closed; exiting")


if __name__ == "__main__":
    main()
