"""Snapshot (monthly entry) endpoints + net-worth series used elsewhere."""
import sqlite3

from api.common import rows_to_dicts
from api.routes import route


def included_ledgers(conn):
    """Ledgers flagged count_in_net_worth=1, each with its dated entries
    (entry_date, amount) sorted by date. Used to fold ledger balances into
    the net-worth series at each snapshot's as-of date."""
    leds = conn.execute(
        "SELECT id, name, side FROM ledger WHERE count_in_net_worth=1"
    ).fetchall()
    out = []
    for led in leds:
        entries = conn.execute(
            "SELECT entry_date, amount FROM ledger_entry "
            "WHERE ledger_id=? AND entry_date IS NOT NULL ORDER BY entry_date, id",
            (led["id"],),
        ).fetchall()
        out.append({"id": led["id"], "name": led["name"], "side": led["side"],
                    "entries": [(e["entry_date"], e["amount"]) for e in entries]})
    return out


def ledger_balance_asof(led, as_of):
    """Cumulative sum of a ledger's entries dated on/before as_of (ISO strings
    compare lexicographically)."""
    return sum(amt for (d, amt) in led["entries"] if d <= as_of)


def net_worth_series(conn):
    rows = conn.execute(
        """
        SELECT s.id, s.as_of, s.note,
          COALESCE(SUM(CASE WHEN a.kind='liquid'    THEN h.value END),0) AS liquid,
          COALESCE(SUM(CASE WHEN a.kind='nonliquid' THEN h.value END),0) AS nonliquid,
          COALESCE(SUM(CASE WHEN a.kind='debt'      THEN h.value END),0) AS debt
        FROM snapshot s
        LEFT JOIN holding h ON h.snapshot_id = s.id
        LEFT JOIN account a ON a.id = h.account_id
        GROUP BY s.id ORDER BY s.as_of
        """
    ).fetchall()
    leds = included_ledgers(conn)
    out = []
    prev = None
    for r in rows:
        liquid, nonliquid, debt = r["liquid"], r["nonliquid"], r["debt"]
        for led in leds:
            bal = ledger_balance_asof(led, r["as_of"])
            if led["side"] == "liability":
                debt += bal
            elif led["side"] == "asset":
                nonliquid += bal
        nw = liquid + nonliquid - debt
        change = None if prev is None else nw - prev
        pct = None if (prev is None or prev == 0) else (nw - prev) / prev
        out.append({
            "id": r["id"], "date": r["as_of"], "liquid": liquid,
            "nonliquid": nonliquid, "debt": debt, "net_worth": nw,
            "change": change, "pct_change": pct, "note": r["note"],
        })
        prev = nw
    return out


def latest_snapshot_id(conn):
    r = conn.execute("SELECT id FROM snapshot ORDER BY as_of DESC LIMIT 1").fetchone()
    return r["id"] if r else None


def recompute_parent(conn, snap_id, account_id):
    """Set a parent account's holding for one snapshot to
    SUM(active subholdings) × owner_pct. Components store FULL values; the
    parent line carries only the owned share."""
    row = conn.execute(
        """
        SELECT COALESCE(SUM(sh.value), 0) AS t,
               (SELECT owner_pct FROM account WHERE id=?) AS pct
        FROM subaccount sa
        JOIN subholding sh ON sh.subaccount_id = sa.id AND sh.snapshot_id = ?
        WHERE sa.parent_account_id = ? AND sa.status = 'active'
        """,
        (account_id, snap_id, account_id),
    ).fetchone()
    pct = row["pct"] if row["pct"] is not None else 1.0
    mine = float(row["t"]) * float(pct)
    conn.execute(
        "INSERT INTO holding (snapshot_id, account_id, value) VALUES (?,?,?) "
        "ON CONFLICT(snapshot_id, account_id) DO UPDATE SET value=excluded.value",
        (snap_id, account_id, mine),
    )


def recompute_parent_all(conn, account_id):
    """Recompute the parent holding for every snapshot that has component data
    for this account (used when ownership % changes outside a snapshot save)."""
    snaps = conn.execute(
        "SELECT DISTINCT sh.snapshot_id AS sid FROM subholding sh "
        "JOIN subaccount sa ON sa.id = sh.subaccount_id "
        "WHERE sa.parent_account_id = ?",
        (account_id,),
    ).fetchall()
    for s in snaps:
        recompute_parent(conn, s["sid"], account_id)


def snapshot_detail(conn, snap_id):
    snap = conn.execute("SELECT * FROM snapshot WHERE id=?", (snap_id,)).fetchone()
    if not snap:
        return None
    # Active accounts, plus any closed account that still held value this month
    # (so editing an old month shows the accounts that existed back then).
    accts = conn.execute(
        """
        SELECT a.id, a.name, a.kind, a.asset_class, a.apr, a.rate_type, a.status,
               a.sort_order, a.institution, a.subtype, a.linked_account_id,
               a.owner_pct, COALESCE(h.value, 0) AS value
        FROM account a
        LEFT JOIN holding h ON h.account_id = a.id AND h.snapshot_id = ?
        WHERE a.status = 'active' OR COALESCE(h.value, 0) != 0
        ORDER BY a.kind, a.sort_order, a.name
        """,
        (snap_id,),
    ).fetchall()
    accts = rows_to_dicts(accts)
    # Attach component sub-entries (e.g. ManuSpend's Discover/SoFi/... split).
    subs = conn.execute(
        """
        SELECT sa.id, sa.parent_account_id, sa.name, sa.sort_order,
               COALESCE(sh.value, 0) AS value
        FROM subaccount sa
        LEFT JOIN subholding sh
               ON sh.subaccount_id = sa.id AND sh.snapshot_id = ?
        WHERE sa.status = 'active'
        ORDER BY sa.parent_account_id, sa.sort_order, sa.name
        """,
        (snap_id,),
    ).fetchall()
    by_parent = {}
    for s in subs:
        by_parent.setdefault(s["parent_account_id"], []).append(
            {"id": s["id"], "name": s["name"], "value": s["value"],
             "sort_order": s["sort_order"]}
        )
    for a in accts:
        if a["id"] in by_parent:
            a["subaccounts"] = by_parent[a["id"]]
    return {"id": snap["id"], "date": snap["as_of"], "note": snap["note"], "accounts": accts}


@route("GET", r"^/api/snapshots$")
def list_snapshots(conn, body):
    return (200, net_worth_series(conn))


@route("GET", r"^/api/snapshots/(\d+)$")
def get_snapshot(conn, body, sid):
    d = snapshot_detail(conn, int(sid))
    return (200, d) if d else (404, None)


@route("POST", r"^/api/snapshots$")
def create_snapshot(conn, body):
    as_of = body.get("date")
    if not as_of:
        return (400, {"error": "date required"})
    try:
        cur = conn.execute("INSERT INTO snapshot (as_of) VALUES (?)", (as_of,))
    except sqlite3.IntegrityError:
        return (409, {"error": "snapshot already exists"})
    snap_id = cur.lastrowid
    if body.get("seed_from_latest"):
        prev = conn.execute(
            "SELECT id FROM snapshot WHERE as_of < ? ORDER BY as_of DESC LIMIT 1",
            (as_of,),
        ).fetchone()
        if prev:
            conn.execute(
                "INSERT INTO holding (snapshot_id, account_id, value) "
                "SELECT ?, account_id, value FROM holding WHERE snapshot_id=?",
                (snap_id, prev["id"]),
            )
    conn.commit()
    return (201, {"id": snap_id})


@route("PUT", r"^/api/snapshots/(\d+)$")
def update_snapshot(conn, body, sid):
    snap_id = int(sid)
    if "date" in body:
        conn.execute("UPDATE snapshot SET as_of=? WHERE id=?", (body["date"], snap_id))
    if "note" in body:
        note = body["note"]
        conn.execute("UPDATE snapshot SET note=? WHERE id=?",
                     ((note.strip() or None) if isinstance(note, str) else None, snap_id))
    for hv in body.get("holdings", []):
        conn.execute(
            "INSERT INTO holding (snapshot_id, account_id, value) VALUES (?,?,?) "
            "ON CONFLICT(snapshot_id, account_id) DO UPDATE SET value=excluded.value",
            (snap_id, hv["account_id"], float(hv["value"])),
        )
    # Ownership shares (joint accounts). owner_pct is an account-level property,
    # so persist it before recomputing parent holdings that depend on it.
    parents = set()
    for sh in body.get("shares", []):
        pct = max(0.0, min(1.0, float(sh["owner_pct"])))
        conn.execute(
            "UPDATE account SET owner_pct=? WHERE id=?", (pct, sh["account_id"]),
        )
        parents.add(sh["account_id"])
    # Component sub-entries. After upserting them, the parent account's holding
    # for this snapshot is recomputed as (sum of its subholdings × owner_pct),
    # so the single parent line always equals its (owned share of its) parts.
    for sv in body.get("subholdings", []):
        conn.execute(
            "INSERT INTO subholding (snapshot_id, subaccount_id, value) VALUES (?,?,?) "
            "ON CONFLICT(snapshot_id, subaccount_id) DO UPDATE SET value=excluded.value",
            (snap_id, sv["subaccount_id"], float(sv["value"])),
        )
        pa = conn.execute(
            "SELECT parent_account_id FROM subaccount WHERE id=?",
            (sv["subaccount_id"],),
        ).fetchone()
        if pa:
            parents.add(pa["parent_account_id"])
    for pid in parents:
        recompute_parent(conn, snap_id, pid)
    conn.commit()
    return (200, {"ok": True})


@route("DELETE", r"^/api/snapshots/(\d+)$")
def delete_snapshot(conn, body, sid):
    conn.execute("DELETE FROM snapshot WHERE id=?", (int(sid),))
    conn.commit()
    return (200, {"ok": True})
