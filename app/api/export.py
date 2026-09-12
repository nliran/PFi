"""Consolidated read-only export: the whole portfolio as one LLM-friendly JSON
document.

This is the single endpoint an AI (or any external tool) reads to analyze a PFi
instance -- it composes the existing read paths (net-worth series, latest
snapshot, allocation, ledgers) into one labeled, denormalized blob so a model can
reason without knowing the schema. It is strictly read-only: it never writes, and
it is what the bundled MCP server (``mcp/pfi_mcp_server.py``) calls under the hood.

Per-account full history is intentionally NOT inlined (30 accounts x 100+ months
is a lot of tokens); fetch it per account via ``/api/accounts/{id}/history`` when
a drill-down is actually needed.
"""
import datetime as _dt

import db as dbmod
import version
from api.dashboard import allocation, attach_prev_values, counted_ledgers
from api.ledgers import ledger_with_balance
from api.routes import route
from api.snapshots import latest_snapshot_id, net_worth_series, snapshot_detail

# A compact legend so a model reading this cold understands the conventions.
LEGEND = (
    "PFi portfolio export. All money is USD. 'net_worth' is a monthly time "
    "series (one row per snapshot, dated first-of-month), oldest first. Each "
    "account has a 'kind' (liquid | nonliquid | debt) and an 'asset_class'. "
    "Debts are stored as POSITIVE values and subtracted in net_worth "
    "(net_worth = liquid + nonliquid - debt). 'allocation' nets each asset "
    "against any linked debt (e.g. a property against its mortgage), so a "
    "real_estate slice is equity, not gross value; 'pct' is its share of total "
    "assets. 'owner_pct' < 1 is a jointly-owned account counted at the owner's "
    "share. In 'latest.accounts', 'prev_value' is the prior month's value "
    "(null = new that month). Per-account full history is not inlined here; "
    "fetch /api/accounts/{id}/history for a single account's whole timeline."
)


def build_export(conn):
    """Assemble the full read-only export payload from existing read paths."""
    series = net_worth_series(conn)
    snap_id = latest_snapshot_id(conn)
    latest = snapshot_detail(conn, snap_id) if snap_id else None
    if latest:
        attach_prev_values(conn, snap_id, latest)

    alloc = allocation(conn, snap_id) if snap_id else []
    asset_total = sum(a["total"] for a in alloc)
    for a in alloc:
        a["pct"] = (a["total"] / asset_total) if asset_total else None

    accts = conn.execute(
        "SELECT id, name, kind, asset_class, status, institution, subtype, apr, "
        "rate_type, owner_pct, linked_account_id "
        "FROM account ORDER BY kind, sort_order, name"
    ).fetchall()

    ledgers = [
        ledger_with_balance(conn, r["id"])
        for r in conn.execute(
            "SELECT id FROM ledger WHERE kind != 'manuspend' ORDER BY kind, name"
        ).fetchall()
    ]

    latest_nw = series[-1] if series else None
    return {
        "meta": {
            "app_version": version.APP_VERSION,
            "api_version": version.API_VERSION,
            "generated_at": _dt.datetime.now().isoformat(timespec="seconds"),
            "currency": "USD",
            "snapshot_count": len(series),
            "date_range": {
                "first": series[0]["date"] if series else None,
                "last": series[-1]["date"] if series else None,
            },
            "kinds": list(dbmod.KINDS),
            "asset_classes": list(dbmod.ASSET_CLASSES),
            "legend": LEGEND,
        },
        "net_worth": series,
        "latest": {
            "date": latest["date"] if latest else None,
            "net_worth": latest_nw["net_worth"] if latest_nw else None,
            "accounts": latest["accounts"] if latest else [],
            "allocation": alloc,
            "ledgers": counted_ledgers(conn, snap_id) if snap_id else [],
        },
        "accounts": [dict(a) for a in accts],
        "ledgers": ledgers,
    }


@route("GET", r"^/api/export$")
def get_export(conn, body):
    return (200, build_export(conn))
