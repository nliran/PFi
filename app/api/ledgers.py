"""Ledger endpoints: list, detail (with running balance), entries CRUD."""
from api.routes import route


def ledger_with_balance(conn, ledger_id):
    led = conn.execute("SELECT * FROM ledger WHERE id=?", (ledger_id,)).fetchone()
    if not led:
        return None
    entries = conn.execute(
        "SELECT * FROM ledger_entry WHERE ledger_id=? ORDER BY sort_order, id",
        (ledger_id,),
    ).fetchall()
    running = 0.0
    out = []
    for e in entries:
        running += e["amount"]
        d = dict(e)
        d["balance"] = running
        out.append(d)
    return {"id": led["id"], "name": led["name"], "kind": led["kind"],
            "note": led["note"], "side": led["side"],
            "count_in_net_worth": bool(led["count_in_net_worth"]),
            "balance": running, "entries": out}


@route("GET", r"^/api/ledgers$")
def list_ledgers(conn, body):
    # 'manuspend' ledgers are now modeled as account subaccounts, not ledgers,
    # so they're hidden here (rows kept in the DB for provenance).
    rows = conn.execute(
        "SELECT * FROM ledger WHERE kind != 'manuspend' ORDER BY kind, name"
    ).fetchall()
    out = []
    for r in rows:
        full = ledger_with_balance(conn, r["id"])
        out.append({"id": r["id"], "name": r["name"], "kind": r["kind"],
                    "note": r["note"], "side": r["side"],
                    "count_in_net_worth": bool(r["count_in_net_worth"]),
                    "balance": full["balance"],
                    "count": len(full["entries"])})
    return (200, out)


@route("GET", r"^/api/ledgers/(\d+)$")
def get_ledger(conn, body, lid):
    d = ledger_with_balance(conn, int(lid))
    return (200, d) if d else (404, None)


@route("POST", r"^/api/ledgers$")
def create_ledger(conn, body):
    cur = conn.execute(
        "INSERT INTO ledger (name, kind, note) VALUES (?,?,?)",
        (body.get("name", "New ledger"), body.get("kind", "loan"),
         body.get("note", "")),
    )
    conn.commit()
    return (201, {"id": cur.lastrowid})


@route("PUT", r"^/api/ledgers/(\d+)$")
def update_ledger(conn, body, lid):
    fields, vals = [], []
    for k in ("name", "kind", "note", "side"):
        if k in body:
            fields.append(f"{k}=?")
            vals.append(body[k])
    if "count_in_net_worth" in body:
        fields.append("count_in_net_worth=?")
        vals.append(1 if body["count_in_net_worth"] else 0)
    if fields:
        vals.append(int(lid))
        conn.execute(f"UPDATE ledger SET {','.join(fields)} WHERE id=?", vals)
        conn.commit()
    d = ledger_with_balance(conn, int(lid))
    return (200, d) if d else (404, None)


@route("POST", r"^/api/ledgers/(\d+)/entries$")
def add_entry(conn, body, lid):
    if not body.get("entry_date"):
        return (400, {"error": "entry_date is required"})
    cur = conn.execute(
        "INSERT INTO ledger_entry (ledger_id, entry_date, label, amount, note, sort_order) "
        "VALUES (?,?,?,?,?,?)",
        (int(lid), body.get("entry_date"), body.get("label", ""),
         float(body.get("amount", 0)), body.get("note", ""),
         body.get("sort_order", 9999)),
    )
    conn.commit()
    return (201, {"id": cur.lastrowid})


@route("PUT", r"^/api/entries/(\d+)$")
def update_entry(conn, body, eid):
    if "entry_date" in body and not body["entry_date"]:
        return (400, {"error": "entry_date is required"})
    fields, vals = [], []
    for k in ("entry_date", "label", "amount", "note", "sort_order"):
        if k in body:
            fields.append(f"{k}=?")
            vals.append(body[k])
    if fields:
        vals.append(int(eid))
        conn.execute(f"UPDATE ledger_entry SET {','.join(fields)} WHERE id=?", vals)
        conn.commit()
    return (200, {"ok": True})


@route("DELETE", r"^/api/entries/(\d+)$")
def delete_entry(conn, body, eid):
    conn.execute("DELETE FROM ledger_entry WHERE id=?", (int(eid),))
    conn.commit()
    return (200, {"ok": True})
