# PFi — Personal Finance / Portfolio Tracker

A small, self-hosted net-worth and portfolio tracker. You take a periodic
"snapshot" of every account you have (cash, brokerage, crypto, real estate,
retirement, debts, plus a few custom ledgers), and PFi charts your allocation,
net worth, and trends over time.

It runs entirely on your own machine, stores everything in a local SQLite
database, and has **no external dependencies to run** — just the Python
standard library and a browser.

> **Privacy:** this repository contains code only. No financial data is
> included. Your database, your source spreadsheet, and your personalized
> import script all stay on your machine (see [Your data](#your-data)).

## Running it

```bash
git clone https://github.com/nliran/PFi.git
cd PFi
./run.sh
```

`run.sh` starts the server at <http://127.0.0.1:8765> and opens it in your
browser. On first run it creates an empty database at
`~/Library/Application Support/PFi/pfi.db`. Stop the server with `Ctrl-C`.

Requires **Python 3** (the version that ships with macOS is fine). No `pip
install` is needed to run the app.

Other entry points:

- `run-lan.sh` — serve over your local network (HTTPS with a self-signed cert)
- `shutdown.sh` — stop a running instance
- `build-app.sh` — package a double-clickable `PFi.app` for macOS
  (`build-app.sh --share` also writes a code-only `PFi.app.zip` you can hand to
  someone else)

## Analyze it with an AI (optional)

PFi can be read by an AI assistant so you can ask questions about your portfolio
in plain language ("how has my allocation drifted since 2020?", "what changed
most last month?") instead of reading charts by hand. Two read-only paths:

- **`GET /api/export`** — the whole portfolio as one labeled JSON document
  (net-worth series, latest snapshot, allocation, ledgers, account metadata),
  designed to be handed straight to a model.
- **A bundled MCP server** (`mcp/pfi_mcp_server.py`) — connect Claude Desktop,
  Claude Code, or any [MCP](https://modelcontextprotocol.io) client to a running
  PFi instance and it gets structured tools (`get_overview`, `get_allocation`,
  `get_account_history`, `compare_months`, …). Zero dependencies; see
  [`mcp/README.md`](mcp/README.md) for setup.

Both are **strictly read-only** — an AI can read and analyze your data, but can
never change it.

## Your data

Everything personal is kept out of version control by `.gitignore`:

| What | Where | In git? |
|------|-------|---------|
| Your balances | `data/*.db` (and `~/Library/Application Support/PFi/pfi.db`) | No |
| A source spreadsheet, if you import one | `*.numbers` | No |
| Your personalized import script | `app/import_numbers.py` | No |

### Importing from an Apple Numbers workbook (optional)

PFi was originally built to migrate a personal Apple Numbers workbook. That
importer is specific to one spreadsheet's layout, so it is **not** committed.
A generic template is provided instead:

```bash
pip3 install numbers-parser
cp app/import_numbers.example.py app/import_numbers.py
# edit app/import_numbers.py: set the account maps, sheet names, and table
# names to match your own workbook, then:
python3 app/import_numbers.py
```

If you don't have a spreadsheet to import, just run the app and add accounts and
snapshots through the UI.

## Project layout

```
app/
  server.py            # stdlib HTTP server (HTTP + optional HTTPS)
  db.py                # SQLite schema + access layer
  version.py           # single source of truth for module versions
  import_numbers.example.py  # template importer (copy -> import_numbers.py)
  api/                 # backend HTTP API (accounts, snapshots, ledgers, export, ...)
  static/              # single-page frontend (vanilla JS, no build step)
mcp/                   # read-only MCP server for AI analysis (see mcp/README.md)
launcher/              # macOS .app icon + generator
build-app.sh           # package PFi.app
run.sh / run-lan.sh / shutdown.sh
```
