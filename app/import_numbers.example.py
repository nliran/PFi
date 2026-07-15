"""EXAMPLE one-time migration: a Numbers workbook -> SQLite.

This is a *template*. The real importer is tailored to a specific personal
workbook and is kept out of version control (see .gitignore). Copy this file to
``import_numbers.py``, then edit the account maps, sheet names, and table names
below to match your own Numbers workbook.

It reads an "OverTime" sheet (a monthly time series) plus a few per-person /
per-category sub-ledgers and loads them into the app database.

Re-runnable: it clears the data tables first, so running it again re-imports
cleanly from the workbook.
"""
import datetime as dt
import os
import sys

import db as dbmod
from version import IMPORTER_VERSION as __version__

# Point this at your own workbook, placed next to the repo root.
NUMBERS_FILE = os.path.join(dbmod.HERE, "..", "Portfolio.numbers")

# name -> asset_class. Rename these to your own liquid accounts. The asset_class
# strings must match the classes the app knows about (cash / stock_bonds /
# crypto / real_estate / inventory / equity_retire / owed / debt).
LIQUID = {
    "Checking": "cash",
    "Savings": "cash",
    "Brokerage": "stock_bonds",
    "Retirement Taxable": "stock_bonds",
    "Crypto Wallet": "crypto",
}
NONLIQUID = {
    "Primary Home": "real_estate",
    "Rental Property": "real_estate",
    "401k": "equity_retire",
    "IRA": "equity_retire",
    "Collectible": "inventory",
    "Loan To Friend": "owed",
}
# debt name -> apr (as a decimal, e.g. 0.0549 for 5.49%)
DEBT_APR = {
    "Credit Card": 0.0,
    "Mortgage": 0.03,
    "Auto Loan": 0.0549,
}

# rows that are totals/notes, not real accounts
SKIP_LABELS = {"", "Cash", "Non-Liquid", "Debts", "NOTES", "None"}


def fnum(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def to_iso(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return None


def load_workbook():
    import numbers_parser
    return numbers_parser.Document(NUMBERS_FILE)


def clear(conn):
    for t in ("holding", "snapshot", "ledger_entry", "ledger", "account"):
        conn.execute(f"DELETE FROM {t}")
    conn.commit()


def import_timeseries(conn, doc):
    sheet = next(s for s in doc.sheets if s.name == "OverTime")
    tables = {t.name: list(t.rows(values_only=True)) for t in sheet.tables}

    # Dates come from the header row (row 0) of the liquid table, cols 1..N
    header = tables["Table 1"][0]
    dates = []  # list of (col_index, iso_date)
    for ci, cell in enumerate(header[1:], start=1):
        iso = to_iso(cell)
        if iso:
            dates.append((ci, iso))

    # Create snapshots
    col_to_snap = {}
    for ci, iso in dates:
        cur = conn.execute("INSERT INTO snapshot (as_of) VALUES (?)", (iso,))
        col_to_snap[ci] = cur.lastrowid

    # Create accounts from the three tables and fill holdings
    sort = 0
    account_specs = [
        ("Table 1", "liquid", LIQUID),
        ("Table 1-1", "nonliquid", NONLIQUID),
        ("Table 1-1-1", "debt", None),
    ]
    n_accounts = 0
    n_holdings = 0
    for tname, kind, classmap in account_specs:
        rows = tables[tname]
        unlabeled = 0
        for r in rows[1:]:  # skip header/date row
            label = (str(r[0]).strip() if r[0] is not None else "")
            if label in SKIP_LABELS:
                # An empty label is only a real account if the row has numbers.
                if label == "" and any(fnum(c) not in (None, 0.0) for c in r[1:]):
                    unlabeled += 1
                    label = f"Unlabeled {kind} {unlabeled}"
                else:
                    continue
            if kind == "debt":
                asset_class = "debt"
                apr = DEBT_APR.get(label)
            else:
                asset_class = classmap.get(label, "cash" if kind == "liquid" else "real_estate")
                apr = None
            sort += 1
            cur = conn.execute(
                "INSERT INTO account (name, kind, asset_class, apr, sort_order) VALUES (?,?,?,?,?)",
                (label, kind, asset_class, apr, sort),
            )
            acct_id = cur.lastrowid
            n_accounts += 1
            for ci, snap_id in col_to_snap.items():
                val = fnum(r[ci]) if ci < len(r) else None
                if val is None:
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO holding (snapshot_id, account_id, value) VALUES (?,?,?)",
                    (snap_id, acct_id, val),
                )
                n_holdings += 1
    conn.commit()
    return n_accounts, len(dates), n_holdings


def add_ledger(conn, name, kind, note=None):
    cur = conn.execute(
        "INSERT INTO ledger (name, kind, note) VALUES (?,?,?)", (name, kind, note)
    )
    return cur.lastrowid


def add_entry(conn, ledger_id, entry_date, label, amount, note, sort):
    conn.execute(
        "INSERT INTO ledger_entry (ledger_id, entry_date, label, amount, note, sort_order)"
        " VALUES (?,?,?,?,?,?)",
        (ledger_id, entry_date, label, amount, note, sort),
    )


def import_person_ledger(conn, doc, sheet_name, table_name, ledger_name):
    """Per-person loan ledgers: columns [label, amount, note, date]."""
    sheet = next(s for s in doc.sheets if s.name == sheet_name)
    table = next(t for t in sheet.tables if t.name == table_name)
    rows = list(table.rows(values_only=True))
    lid = add_ledger(conn, ledger_name, "loan")
    n = 0
    for i, r in enumerate(rows):
        label = (str(r[0]).strip() if r[0] is not None else "")
        amount = fnum(r[1]) if len(r) > 1 else None
        note = (str(r[2]).strip() if len(r) > 2 and r[2] is not None else "")
        date = to_iso(r[3]) if len(r) > 3 else None
        if not label and amount is None:
            continue
        if amount is None:
            amount = 0.0
        add_entry(conn, lid, date, label, amount, note, i)
        n += 1
    conn.commit()
    return n


def import_category_ledger(conn, doc, sheet_name, table_name, ledger_name, kind, note):
    """A dated category ledger: column 0 is a date or a label, column 1 an amount."""
    sheet = next(s for s in doc.sheets if s.name == sheet_name)
    table = next(t for t in sheet.tables if t.name == table_name)
    rows = list(table.rows(values_only=True))
    lid = add_ledger(conn, ledger_name, kind, note)
    n = 0
    for i, r in enumerate(rows):
        c0 = r[0]
        label = ""
        date = to_iso(c0)
        if date is None and c0 is not None:
            label = str(c0).strip()
        amount = fnum(r[1]) if len(r) > 1 else None
        if amount is None and not label and date is None:
            continue
        add_entry(conn, lid, date, label, amount or 0.0, "", i)
        n += 1
    conn.commit()
    return n


def main():
    conn = dbmod.init()
    clear(conn)
    doc = load_workbook()
    na, nd, nh = import_timeseries(conn, doc)
    print(f"accounts={na} snapshots={nd} holdings={nh}")
    # Adapt these calls to your own sheet/table/ledger names:
    print("Person A entries:", import_person_ledger(conn, doc, "PersonA", "Activity", "Person A"))
    print("Person B entries:", import_person_ledger(conn, doc, "PersonB", "Table 1", "Person B"))
    conn.close()
    print("Import complete.")


if __name__ == "__main__":
    sys.exit(main())
