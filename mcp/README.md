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

## Prerequisites

Start PFi so the server is listening:

```bash
./run.sh          # http://127.0.0.1:8765
```

The MCP server needs the tracker running — it reads PFi over its normal API.

## Add it to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (create it
if missing) and add a `pfi` entry. Use the **absolute path** to the script:

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

Restart Claude Desktop. You should see the `pfi` tools appear; then just ask
questions about your portfolio in plain language.

## Add it to Claude Code

```bash
claude mcp add pfi -- python3 /path/to/PFi/mcp/pfi_mcp_server.py
```

(or add the same block to a project `.mcp.json`). Then ask Claude Code to analyze
your PFi data.

## Pointing at a different instance / LAN

Configure with environment variables (in the `env` block above, or your shell):

| Variable       | Default                 | Meaning                                              |
| -------------- | ----------------------- | ---------------------------------------------------- |
| `PFI_URL`      | `http://127.0.0.1:8765` | Base URL of the PFi server                           |
| `PFI_USER`     | *(unset)*               | HTTP Basic-auth username — only if the instance requires a login |
| `PFI_PASS`     | *(unset)*               | HTTP Basic-auth password                             |
| `PFI_INSECURE` | `0`                     | `1` to skip TLS verification (a LAN instance's self-signed cert) |

For a LAN instance started with `./run-lan.sh`, set `PFI_URL=https://<lan-ip>:8765`,
`PFI_USER`/`PFI_PASS` to that login, and `PFI_INSECURE=1` (self-signed cert).

## Tools it exposes (all read-only)

| Tool                   | What it returns                                                       |
| ---------------------- | -------------------------------------------------------------------- |
| `get_overview`         | The whole portfolio in one blob (best first call): net-worth series, latest snapshot, allocation, ledgers, account metadata |
| `get_net_worth_series` | Monthly net worth: liquid / nonliquid / debt / net_worth + M/M change |
| `get_allocation`       | Current asset allocation by class, net of linked debt, with % shares |
| `list_accounts`        | Every account with kind, class, status, institution, rate, ownership |
| `get_account_history`  | One account's full monthly history (by `account_id` or `name`)       |
| `list_ledgers`         | Ledgers with running balances and entry counts                       |
| `get_ledger`           | One ledger's full detail (every dated entry + running balance)       |
| `compare_months`       | Per-account change between two months (defaults to the latest two)   |

All of these read from PFi's `GET /api/export` and the existing granular read
endpoints. Nothing here writes.

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
