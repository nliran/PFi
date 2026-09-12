# PFi MCP server — let an AI analyze your portfolio

`pfi_mcp_server.py` is a small [Model Context Protocol](https://modelcontextprotocol.io)
server that lets an AI client (Claude Desktop, Claude Code, or any MCP client)
connect to a **running PFi instance** and answer questions about your portfolio
with structured tool calls — "how has my allocation drifted since 2020?", "what
changed most last month?", "chart my net worth vs. debt" — instead of you pasting
raw JSON.

- **Read-only.** It only ever issues HTTP `GET`s against PFi's API, so an AI can
  read and analyze but can **never** change your accounts, snapshots, or values.
- **Zero dependencies.** Pure Python standard library, like PFi itself — no
  `pip install`. It speaks the MCP stdio transport directly.
- **Local by default.** It talks to `http://127.0.0.1:8765`, so your data stays
  on your machine. It also works against a LAN instance (see auth below).

---

## Quick start

1. **Start PFi** so the server is listening (the MCP server reads PFi over its
   normal API — it does not open the database directly):

   ```bash
   ./run.sh          # http://127.0.0.1:8765
   ```

2. **Register the MCP server** with your client (see below). Use the **absolute
   path** to `mcp/pfi_mcp_server.py`.

3. **Ask questions** about your portfolio in plain language. The client picks the
   right tool(s) for you.

> **Requires Python 3** (the version that ships with macOS is fine). No
> `pip install` needed — the server is stdlib-only.

### Add it to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (create it
if missing) and add a `pfi` entry:

```json
{
  "mcpServers": {
    "pfi": {
      "command": "python3",
      "args": ["/path/to/PFi/mcp/pfi_mcp_server.py"],
      "env": { "PFI_URL": "http://127.0.0.1:8765" }
    }
  }
}
```

Restart Claude Desktop. The `pfi` tools should appear in the tool menu (the
plug/hammer icon); then just ask questions about your portfolio.

### Add it to Claude Code

```bash
claude mcp add pfi -- python3 /path/to/PFi/mcp/pfi_mcp_server.py
```

(or add the same block to a project `.mcp.json`). Then ask Claude Code to analyze
your PFi data. Run `claude mcp list` to confirm it's connected.

---

## Configuration

Configure with environment variables (in the `env` block above, or your shell):

| Variable       | Default                 | Meaning                                              |
| -------------- | ----------------------- | ---------------------------------------------------- |
| `PFI_URL`      | `http://127.0.0.1:8765` | Base URL of the PFi server                           |
| `PFI_USER`     | *(unset)*               | HTTP Basic-auth username — only if the instance requires a login |
| `PFI_PASS`     | *(unset)*               | HTTP Basic-auth password                             |
| `PFI_INSECURE` | `0`                     | `1` to skip TLS verification (a LAN instance's self-signed cert) |

**Pointing at a LAN instance.** For an instance started with `./run-lan.sh`, set
`PFI_URL=https://<lan-ip>:8765`, `PFI_USER`/`PFI_PASS` to that login, and
`PFI_INSECURE=1` (self-signed cert). For example:

```json
{
  "mcpServers": {
    "pfi": {
      "command": "python3",
      "args": ["/path/to/PFi/mcp/pfi_mcp_server.py"],
      "env": {
        "PFI_URL": "https://192.168.1.20:8765",
        "PFI_USER": "me",
        "PFI_PASS": "secret",
        "PFI_INSECURE": "1"
      }
    }
  }
}
```

---

## Tools it exposes (all read-only)

Eight tools, all read-only. `get_overview` is the best first call for broad
questions — it returns the whole portfolio in one payload, so the model rarely
needs anything else. The rest are targeted follow-ups (a single account's
history, one ledger's detail, a month-over-month comparison).

Money is USD. Net worth is a monthly time series (one row per snapshot, dated to
the first of the month). Debts are stored as **positive** values and subtracted:
`net_worth = liquid + nonliquid − debt`.

| Tool                   | Arguments | Returns |
| ---------------------- | --------- | ------- |
| [`get_overview`](#get_overview)                 | *(none)* | The whole portfolio in one blob |
| [`get_net_worth_series`](#get_net_worth_series) | *(none)* | Monthly net-worth history with M/M change |
| [`get_allocation`](#get_allocation)             | *(none)* | Current asset allocation by class |
| [`list_accounts`](#list_accounts)               | `include_closed?` | Every account with its metadata |
| [`get_account_history`](#get_account_history)   | `account_id?` **or** `name?` | One account's full monthly history |
| [`list_ledgers`](#list_ledgers)                 | *(none)* | Ledgers with running balances + entry counts |
| [`get_ledger`](#get_ledger)                     | `ledger_id` *(required)* | One ledger's full detail |
| [`compare_months`](#compare_months)             | `date_a?`, `date_b?` | Per-account change between two months |

### `get_overview`

The whole portfolio in one payload — the best first call for broad analysis.

- **Arguments:** none.
- **Returns:** `meta` (app/api versions, currency, snapshot count, date range,
  the list of account `kinds` and `asset_classes`, and a `legend` explaining the
  conventions), `net_worth` (the full monthly series), `latest` (the most recent
  snapshot: dated accounts with their prior-month value, allocation, and
  ledgers), `accounts` (metadata for every account), and `ledgers`.
  Per-account full history is **not** inlined — use `get_account_history` for a
  drill-down.
- **Backed by:** `GET /api/export`.
- **Ask:** *"Give me an overview of my portfolio."* · *"How is my net worth
  trending?"*

### `get_net_worth_series`

Monthly net-worth history, oldest first.

- **Arguments:** none.
- **Returns:** one row per snapshot with `date`, `liquid`, `nonliquid`, `debt`,
  `net_worth`, and the month-over-month `change` / `pct_change`.
- **Backed by:** `GET /api/snapshots`.
- **Ask:** *"Chart my net worth over time."* · *"Which months did my net worth
  drop?"*

### `get_allocation`

Current asset allocation by class, **net of any linked debt** — e.g. a property
is counted at its equity (value minus its linked mortgage), not gross.

- **Arguments:** none.
- **Returns:** `date` (the latest snapshot's date) and `allocation`: a list of
  `{ asset_class, total, pct }`, where `pct` is that class's share of total
  assets.
- **Backed by:** `GET /api/export` (the `latest.allocation` slice).
- **Ask:** *"What's my current asset allocation?"* · *"How much of my portfolio
  is in real estate equity?"*

### `list_accounts`

Every account with its metadata.

- **Arguments:**
  - `include_closed` *(boolean, optional, default `true`)* — set `false` to hide
    accounts whose status is `closed`.
- **Returns:** a list of accounts, each with `id`, `name`, `kind`
  (`liquid` | `nonliquid` | `debt`), `asset_class`, `status`, `institution`,
  `rate`, and `owner_pct` (< 1 for a jointly-owned account, counted at the
  owner's share).
- **Backed by:** `GET /api/accounts`.
- **Ask:** *"List my open accounts."* · *"Which institutions hold my cash?"*

### `get_account_history`

One account's full month-by-month value history. Identify the account **either**
by id **or** by name (case-insensitive); if a name doesn't match, the error
suggests close matches.

- **Arguments (provide one):**
  - `account_id` *(integer)* — the account's id (from `list_accounts` or
    `get_overview`).
  - `name` *(string)* — the account name, case-insensitive.
- **Returns:** the account's full monthly value history.
- **Backed by:** `GET /api/accounts/{id}/history`.
- **Ask:** *"Show the history of my brokerage account."* · *"How has account 12
  changed month to month?"*

### `list_ledgers`

Ledgers (loans, COGS, custom) with a running balance and entry count each.

- **Arguments:** none.
- **Returns:** a list of ledgers, each with its running balance and number of
  entries.
- **Backed by:** `GET /api/ledgers`.
- **Ask:** *"What ledgers do I have?"* · *"What's the balance on my loan
  ledger?"*

### `get_ledger`

One ledger's full detail — every dated entry with a running balance.

- **Arguments:**
  - `ledger_id` *(integer, **required**)* — the ledger's id (from
    `list_ledgers`).
- **Returns:** the ledger with all of its dated entries and running balances.
- **Backed by:** `GET /api/ledgers/{id}`.
- **Ask:** *"Show every entry in ledger 3."*

### `compare_months`

Per-account change between two months. Omit both dates to compare the two most
recent months.

- **Arguments:**
  - `date_a` *(string, optional)* — the earlier month, `YYYY-MM-DD` or
    `YYYY-MM` (a `YYYY-MM` prefix matches that month's snapshot).
  - `date_b` *(string, optional)* — the later month, same format.
- **Returns:** `from` / `to` (each `{ date, net_worth }`), the total
  `net_worth_change`, and `account_changes` — every account that moved, sorted
  by the size of the change, each `{ account, from, to, change }` (a `null`
  `from` means the account didn't exist that month).
- **Backed by:** `GET /api/snapshots` + `GET /api/snapshots/{id}`.
- **Ask:** *"What changed most last month?"* · *"Compare 2024-01 with 2025-01."*

All of these read from PFi's `GET /api/export` and the existing granular read
endpoints. Nothing here writes.

---

## Troubleshooting

- **"Could not reach PFi at …"** — the tracker isn't running or listens
  elsewhere. Start it with `./run.sh` and/or set `PFI_URL` to the right base URL.
- **"PFi returned 401 Unauthorized"** — the instance requires a login. Set
  `PFI_USER` and `PFI_PASS` in the server's `env` block.
- **TLS / certificate errors against a LAN instance** — `run-lan.sh` uses a
  self-signed cert; set `PFI_INSECURE=1`.
- **"This instance has no snapshots yet"** — add at least one snapshot in the PFi
  UI; the analysis tools need data to read.
- **The client doesn't list the `pfi` tools** — confirm the **absolute** path to
  `pfi_mcp_server.py` is correct, that `python3` is on `PATH`, and restart the
  client. In Claude Code, `claude mcp list` shows the connection status.
- **Diagnostics** — the server logs to **stderr** only (stdout is reserved for
  the protocol). Your client's MCP logs will show lines prefixed `[pfi-mcp]`,
  including the `PFI_URL` and whether auth is on.

---

## Quick manual test

You can drive it by hand over stdio (no MCP client needed):

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_allocation","arguments":{}}}' \
  | python3 mcp/pfi_mcp_server.py
```

You should see an `initialize` result, the tool list, and your current
allocation come back as JSON.
