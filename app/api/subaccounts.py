"""Subaccount endpoints: the component breakdown that rolls up into a parent
account's value (e.g. the ManuSpend cash line split into Discover, SoFi, ...).

A subaccount never appears in net worth / allocation on its own — only its
parent does. Subholdings record how the parent's monthly value is composed."""
from api.common import rows_to_dicts
from api.routes import route

_EDITABLE = ("name", "institution", "notes", "status", "sort_order")


def subaccount_history(conn, sub_id):
    sub = conn.execute("SELECT * FROM subaccount WHERE id=?", (sub_id,)).fetchone()
    if not sub:
        return None
    rows = conn.execute(
        """
        SELECT s.as_of AS date, COALESCE(sh.value, 0) AS value
        FROM snapshot s
        LEFT JOIN subholding sh ON sh.snapshot_id = s.id AND sh.subaccount_id = ?
        ORDER BY s.as_of
        """,
        (sub_id,),
    ).fetchall()
    return {"subaccount": dict(sub), "history": rows_to_dicts(rows)}


@route("GET", r"^/api/accounts/(\d+)/subaccounts$")
def list_subaccounts(conn, body, aid):
    # Include each component's value in the latest snapshot for display.
    rows = conn.execute(
        """
        SELECT sa.*, COALESCE(sh.value, 0) AS value
        FROM subaccount sa
        LEFT JOIN subholding sh ON sh.subaccount_id = sa.id
              AND sh.snapshot_id = (SELECT id FROM snapshot ORDER BY as_of DESC LIMIT 1)
        WHERE sa.parent_account_id = ?
        ORDER BY sa.sort_order, sa.name
        """,
        (int(aid),),
    ).fetchall()
    return (200, rows_to_dicts(rows))


@route("GET", r"^/api/subaccounts/(\d+)/history$")
def get_subaccount_history(conn, body, sid):
    d = subaccount_history(conn, int(sid))
    return (200, d) if d else (404, None)


@route("POST", r"^/api/accounts/(\d+)/subaccounts$")
def create_subaccount(conn, body, aid):
    cur = conn.execute(
        "INSERT INTO subaccount (parent_account_id, name, institution, notes, "
        "status, sort_order) VALUES (?,?,?,?,?,?)",
        (int(aid), body.get("name", "New component"), body.get("institution"),
         body.get("notes"), body.get("status", "active"),
         body.get("sort_order", 999)),
    )
    conn.commit()
    return (201, {"id": cur.lastrowid})


@route("PUT", r"^/api/subaccounts/(\d+)$")
def update_subaccount(conn, body, sid):
    fields, vals = [], []
    for k in _EDITABLE:
        if k in body:
            fields.append(f"{k}=?")
            vals.append(body[k])
    if fields:
        vals.append(int(sid))
        conn.execute(f"UPDATE subaccount SET {','.join(fields)} WHERE id=?", vals)
        conn.commit()
    return (200, {"ok": True})


@route("DELETE", r"^/api/subaccounts/(\d+)$")
def close_subaccount(conn, body, sid):
    # Soft close: keep history, hide from new monthly entries.
    conn.execute("UPDATE subaccount SET status='closed' WHERE id=?", (int(sid),))
    conn.commit()
    return (200, {"ok": True})
