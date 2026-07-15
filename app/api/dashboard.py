"""Dashboard endpoint + asset allocation (with equity netting)."""
import db as dbmod
from api.routes import route
from api.snapshots import latest_snapshot_id, net_worth_series, snapshot_detail


def counted_ledgers(conn, snap_id):
    """Ledgers flagged count_in_net_worth=1, each with its side and its balance
    as of the latest snapshot date and the prior snapshot date (for M/M). The
    Debt Overview shows the liability ones; Current Holdings shows them all in a
    dedicated Ledgers section."""
    if not snap_id:
        return []
    dates = conn.execute(
        "SELECT as_of FROM snapshot WHERE as_of <= "
        "(SELECT as_of FROM snapshot WHERE id=?) ORDER BY as_of DESC LIMIT 2",
        (snap_id,),
    ).fetchall()
    cur_date = dates[0]["as_of"] if dates else None
    prev_date = dates[1]["as_of"] if len(dates) > 1 else None

    def bal_asof(lid, as_of):
        if as_of is None:
            return None
        r = conn.execute(
            "SELECT COALESCE(SUM(amount),0) b FROM ledger_entry "
            "WHERE ledger_id=? AND entry_date IS NOT NULL AND entry_date <= ?",
            (lid, as_of),
        ).fetchone()
        return r["b"]

    leds = conn.execute(
        "SELECT id, name, side FROM ledger "
        "WHERE count_in_net_worth=1 AND kind != 'manuspend' ORDER BY name"
    ).fetchall()
    out = []
    for l in leds:
        out.append({
            "id": l["id"], "name": l["name"], "side": l["side"],
            "value": bal_asof(l["id"], cur_date) or 0,
            "prev_value": bal_asof(l["id"], prev_date),
        })
    return out


def allocation(conn, snap_id):
    """Asset-side allocation. When an asset is linked to a debt (e.g. a property
    to its mortgage) the slice shows net equity, matching the old workbook."""
    accts = conn.execute(
        """
        SELECT a.id, a.asset_class, a.linked_account_id, COALESCE(h.value,0) AS val
        FROM account a
        LEFT JOIN holding h ON h.account_id = a.id AND h.snapshot_id = ?
        WHERE a.kind != 'debt' AND (a.status = 'active' OR COALESCE(h.value,0) != 0)
        """,
        (snap_id,),
    ).fetchall()
    debt_vals = {r["account_id"]: r["value"] for r in conn.execute(
        "SELECT account_id, value FROM holding WHERE snapshot_id=?", (snap_id,))}
    buckets = {}
    for a in accts:
        v = a["val"]
        if a["linked_account_id"]:
            v -= debt_vals.get(a["linked_account_id"], 0)
        buckets[a["asset_class"]] = buckets.get(a["asset_class"], 0) + v
    return [{"asset_class": k, "total": v} for k, v in
            sorted(buckets.items(), key=lambda x: -x[1]) if abs(v) > 0.005]


def attach_prev_values(conn, snap_id, latest):
    """Annotate each latest-month account with ``prev_value`` = its holding in the
    prior snapshot, or ``None`` when the account had no holding row last month
    (i.e. it's new this month). Used by the Dashboard's month-over-month column."""
    if not latest:
        return
    prev = conn.execute(
        "SELECT id FROM snapshot WHERE as_of < (SELECT as_of FROM snapshot WHERE id=?) "
        "ORDER BY as_of DESC LIMIT 1",
        (snap_id,),
    ).fetchone()
    prev_vals = {}
    if prev:
        prev_vals = {r["account_id"]: r["value"] for r in conn.execute(
            "SELECT account_id, value FROM holding WHERE snapshot_id=?", (prev["id"],))}
    for a in latest["accounts"]:
        a["prev_value"] = prev_vals.get(a["id"])  # None => new this month


@route("GET", r"^/api/dashboard$")
def get_dashboard(conn, body):
    snap_id = latest_snapshot_id(conn)
    latest = snapshot_detail(conn, snap_id) if snap_id else None
    attach_prev_values(conn, snap_id, latest)
    return (200, {
        "series": net_worth_series(conn),
        "latest": latest,
        "ledgers": counted_ledgers(conn, snap_id),
        "allocation": allocation(conn, snap_id) if snap_id else [],
        "asset_classes": list(dbmod.ASSET_CLASSES),
        "kinds": list(dbmod.KINDS),
    })
