# Changelog

All notable changes to PFi are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
PFi versions each module independently with [SemVer](https://semver.org)
(`app` = the overall release; `db`, `api`, `ui`, `importer` track their own
layers — see [`app/version.py`](app/version.py)). Each entry notes the module
versions it changed.

## [Unreleased]

## [1.23.1] - 2026-10-11

### Fixed

- **On Apple Silicon Macs, `PFi.app` ran under Rosetta (Intel emulation).**
  The app's launcher is a shell script, so macOS couldn't tell it was Apple
  Silicon-ready and started it as an Intel process — and the Python server it
  started inherited that. Symptoms: macOS warns that support for Intel-based
  apps is ending, and on Macs where the only Python is the system one (the
  Command Line Tools 3.9, which is Apple Silicon-only), the server couldn't
  start at all (`posix_spawn ... Undefined error: 0` in the log; the browser
  showed "can't connect to the server"). The app now declares Apple Silicon
  support (`LSArchitecturePriority` in `Info.plist`), and the launcher
  re-launches itself natively if macOS still starts it under Rosetta.
- **The launcher picks a Python that actually starts.** It test-runs the
  installed Pythons and uses the first that works, preferring a standalone
  install (python.org or Homebrew) over the old system 3.9.
- **Launch failures are no longer silent.** If no working Python is found, or
  the server doesn't come up, the app shows an alert with the last log line
  instead of opening the browser to a dead page.
- `build-app.sh` reads the version with `sed`, so building needs no Python.

**After updating:** quit PFi (the power button) and open it again from the
icon. An update restarts the server in place, so it keeps running the way it
was started until the next launch from the icon. **If your PFi.app won't start
at all,** the Update button can't reach you; rebuild it once from your checkout
with `./build-app.sh`.

Modules: app 1.23.0 → 1.23.1.

## [1.23.0] - 2026-09-12

### Added

- **Read-only AI access to your portfolio.** Point an AI assistant at a running
  PFi instance and ask about your finances in plain language ("how has my
  allocation drifted since 2020?", "what changed most last month?") instead of
  reading charts by hand. Two paths, both **strictly read-only** — an AI can
  read and analyze your data but can never change it:
  - **`GET /api/export`** — the entire portfolio as one labeled, LLM-friendly
    JSON document: net-worth time series, latest snapshot, allocation (net of
    linked debt), ledgers, and account metadata, with a legend explaining the
    conventions. Composes the existing read paths; never writes.
    (`app/api/export.py`)
  - **Bundled MCP server** (`mcp/pfi_mcp_server.py`) — a zero-dependency
    (Python-stdlib-only) [Model Context Protocol](https://modelcontextprotocol.io)
    server that bridges any MCP client (Claude Desktop, Claude Code, …) to a
    running PFi instance over its HTTP API. Exposes eight read-only tools:
    `get_overview`, `get_net_worth_series`, `get_allocation`, `list_accounts`,
    `get_account_history`, `list_ledgers`, `get_ledger`, and `compare_months`.
    Speaks the MCP stdio transport directly and is configured with
    `PFI_URL` / `PFI_USER` / `PFI_PASS` / `PFI_INSECURE` for localhost or LAN
    instances. See [`mcp/README.md`](mcp/README.md) for setup and a full
    function reference.
- Documentation: MCP setup and function reference (`mcp/README.md`), an
  "Analyze it with an AI" section in the top-level [`README.md`](README.md), and
  this changelog.

### Module versions

- `app` 1.22.0 → 1.23.0
- `api` 1.11.0 → 1.12.0 (new `/api/export` endpoint)

## [1.22.0] - 2026-08-02

### Added

- **Trends: month-by-month net-worth table.** A per-month net-worth breakdown
  on the Trends view, with a show/hide and reorder picker for the columns.

### Module versions

- `app` 1.21.1 → 1.22.0
- `ui` 1.20.0 → 1.21.0

## [1.21.1] - 2026-07-15

### Changed

- Verify the in-app self-update against the live GitHub release before
  offering it.

### Module versions

- `app` 1.21.0 → 1.21.1

## [1.21.0] - 2026-07-15

### Added

- **In-app self-update.** One-click update (git pull + restart) with a UI
  affordance, so you can move to the latest release without the command line.

### Module versions

- `app` 1.20.0 → 1.21.0
- `ui` 1.19.1 → 1.20.0

## [1.20.0] - 2026-07-15

### Added

- Initial public, data-free release of PFi — a small, self-hosted net-worth and
  portfolio tracker. Runs on the Python standard library and a browser, stores
  everything in a local SQLite database, and ships with no financial data.

### Module versions

- `app` 1.20.0, `db` 1.7.0, `api` 1.10.1, `ui` 1.19.1, `importer` 1.0.0

[Unreleased]: https://github.com/nliran/PFi/compare/v1.23.1...HEAD
[1.23.1]: https://github.com/nliran/PFi/compare/v1.23.0...v1.23.1
[1.23.0]: https://github.com/nliran/PFi/compare/v1.22.0...v1.23.0
[1.22.0]: https://github.com/nliran/PFi/compare/v1.21.1...v1.22.0
[1.21.1]: https://github.com/nliran/PFi/compare/v1.21.0...v1.21.1
[1.21.0]: https://github.com/nliran/PFi/compare/v1.20.0...v1.21.0
[1.20.0]: https://github.com/nliran/PFi/releases/tag/v1.20.0
