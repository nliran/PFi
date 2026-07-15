"""Account endpoints: list, history, create, update, close."""
from api.common import rows_to_dicts
from api.routes import route
from api.snapshots import recompute_parent_all

# Columns a client is allowed to set via PUT.
_EDITABLE = (
    "name", "kind", "asset_class", "apr", "rate_type", "archived", "sort_order",
    "status", "closed_date", "institution", "subtype", "notes",
    "linked_account_id", "owner_pct",
)


def account_history(conn, acct_id):
    acct = conn.execute("SELECT * FROM account WHERE id=?", (acct_id,)).fetchone()
    if not acct:
        return None
    rows = conn.execute(
        """
        SELECT s.as_of AS date, COALESCE(h.value, 0) AS value
        FROM snapshot s
        LEFT JOIN holding h ON h.snapshot_id = s.id AND h.account_id = ?
        ORDER BY s.as_of
        """,
        (acct_id,),
    ).fetchall()
    out = {"account": dict(acct), "history": rows_to_dicts(rows)}
    if acct["linked_account_id"]:
        linked = conn.execute(
            "SELECT id, name FROM account WHERE id=?", (acct["linked_account_id"],)
        ).fetchone()
        if linked:
            lrows = conn.execute(
                """SELECT s.as_of AS date, COALESCE(h.value,0) AS value
                   FROM snapshot s LEFT JOIN holding h
                   ON h.snapshot_id=s.id AND h.account_id=? ORDER BY s.as_of""",
                (acct["linked_account_id"],),
            ).fetchall()
            out["linked"] = {"id": linked["id"], "name": linked["name"],
                             "history": rows_to_dicts(lrows)}
    return out


@route("GET", r"^/api/accounts$")
def list_accounts(conn, body):
    rows = conn.execute(
        "SELECT * FROM account ORDER BY kind, sort_order, name"
    ).fetchall()
    return (200, rows_to_dicts(rows))


@route("GET", r"^/api/accounts/(\d+)/history$")
def get_history(conn, body, aid):
    d = account_history(conn, int(aid))
    return (200, d) if d else (404, None)


@route("POST", r"^/api/accounts$")
def create_account(conn, body):
    cur = conn.execute(
        "INSERT INTO account (name, kind, asset_class, apr, rate_type, sort_order, "
        "status, institution, subtype, notes, linked_account_id) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (body.get("name", "New account"), body.get("kind", "liquid"),
         body.get("asset_class", "cash"), body.get("apr"), body.get("rate_type"),
         body.get("sort_order", 999),
         body.get("status", "active"), body.get("institution"),
         body.get("subtype"), body.get("notes"),
         body.get("linked_account_id")),
    )
    conn.commit()
    return (201, {"id": cur.lastrowid})


@route("PUT", r"^/api/accounts/(\d+)$")
def update_account(conn, body, aid):
    fields, vals = [], []
    for k in _EDITABLE:
        if k in body:
            fields.append(f"{k}=?")
            vals.append(body[k])
    if fields:
        vals.append(int(aid))
        conn.execute(f"UPDATE account SET {','.join(fields)} WHERE id=?", vals)
        # Ownership change re-derives the parent line from its components.
        if "owner_pct" in body:
            recompute_parent_all(conn, int(aid))
        conn.commit()
    return (200, {"ok": True})


@route("DELETE", r"^/api/accounts/(\d+)$")
def close_account(conn, body, aid):
    # Soft close: keep all history, just hide from new monthly entries.
    conn.execute(
        "UPDATE account SET archived=1, status='closed' WHERE id=?", (int(aid),)
    )
    conn.commit()
    return (200, {"ok": True})
