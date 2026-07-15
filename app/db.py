"""SQLite storage layer for the PFi portfolio tracker.

One file, no external deps. Your data lives OUTSIDE the app code, in the
standard per-user macOS location ``~/Library/Application Support/PFi/`` (so the
app itself carries no data and can be moved or shared freely). Override the
whole directory with ``PFI_DATA_DIR`` or the DB file directly with ``PFI_DB``.
"""
import os
import sqlite3

from version import DB_VERSION as __version__

HERE = os.path.dirname(os.path.abspath(__file__))


def _data_dir():
    """Per-user data directory (DB, logs, TLS certs). Decoupled from the code so
    the app bundle stays data-free and portable. Honors ``PFI_DATA_DIR``."""
    env = os.environ.get("PFI_DATA_DIR")
    if env:
        return os.path.expanduser(env)
    return os.path.join(os.path.expanduser("~"), "Library", "Application Support", "PFi")


DATA_DIR = _data_dir()
DB_PATH = os.environ.get("PFI_DB") or os.path.join(DATA_DIR, "pfi.db")
if DB_PATH:
    DB_PATH = os.path.expanduser(DB_PATH)

# kind groups an account into the three net-worth stacks.
KINDS = ("liquid", "nonliquid", "debt")

# asset_class drives the allocation breakdown (asset side).
ASSET_CLASSES = (
    "cash",
    "stock_bonds",
    "real_estate",
    "equity_retire",
    "owed",
    "inventory",
    "crypto",
    "debt",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS account (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,             -- liquid | nonliquid | debt
    asset_class  TEXT NOT NULL,             -- cash | stock_bonds | real_estate | ...
    apr          REAL,                      -- only meaningful for debts
    rate_type    TEXT,                      -- 'fixed' | 'variable' | NULL (debts)
    archived     INTEGER NOT NULL DEFAULT 0,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'active',  -- active | closed
    closed_date  TEXT,                      -- when an account was closed
    institution  TEXT,                      -- custodian / bank / lender
    subtype      TEXT,                      -- Checking, Roth IRA, Mortgage, Rental, ...
    notes        TEXT,
    linked_account_id INTEGER,              -- e.g. property -> its mortgage (equity)
    owner_pct    REAL NOT NULL DEFAULT 1.0  -- my ownership share (1.0=100%); joint accts <1
);

CREATE TABLE IF NOT EXISTS snapshot (
    id     INTEGER PRIMARY KEY,
    as_of  TEXT NOT NULL UNIQUE,           -- ISO date, first of the month
    note   TEXT                            -- freeform "why did things change" note
);

CREATE TABLE IF NOT EXISTS holding (
    snapshot_id  INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
    account_id   INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    value        REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (snapshot_id, account_id)
);

CREATE TABLE IF NOT EXISTS ledger (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE,            -- e.g. a person, a category, or a custom ledger
    kind  TEXT NOT NULL,                   -- loan | cogs | manuspend
    note  TEXT,
    side  TEXT,                            -- asset | liability (null = neither, e.g. manuspend)
    count_in_net_worth INTEGER NOT NULL DEFAULT 0  -- 1 = fold balance into net worth
);

CREATE TABLE IF NOT EXISTS ledger_entry (
    id          INTEGER PRIMARY KEY,
    ledger_id   INTEGER NOT NULL REFERENCES ledger(id) ON DELETE CASCADE,
    entry_date  TEXT,                       -- ISO date, nullable
    label       TEXT,
    amount      REAL NOT NULL DEFAULT 0,    -- +adds to balance owed, -reduces it
    note        TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- A subaccount is a named component that rolls up into a parent account's
-- value (e.g. the ManuSpend cash line is split into Discover, SoFi, ...).
-- The parent account stays a single line in net worth / allocation; the
-- subholdings just record how that single value is composed each month.
CREATE TABLE IF NOT EXISTS subaccount (
    id                INTEGER PRIMARY KEY,
    parent_account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    institution       TEXT,
    notes             TEXT,
    status            TEXT NOT NULL DEFAULT 'active',  -- active | closed
    sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subholding (
    snapshot_id   INTEGER NOT NULL REFERENCES snapshot(id) ON DELETE CASCADE,
    subaccount_id INTEGER NOT NULL REFERENCES subaccount(id) ON DELETE CASCADE,
    value         REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (snapshot_id, subaccount_id)
);

CREATE INDEX IF NOT EXISTS idx_holding_snapshot ON holding(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_entry_ledger ON ledger_entry(ledger_id);
CREATE INDEX IF NOT EXISTS idx_subaccount_parent ON subaccount(parent_account_id);
CREATE INDEX IF NOT EXISTS idx_subholding_snapshot ON subholding(snapshot_id);
"""


def connect():
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# columns added after v1; (name, definition) applied if missing
MIGRATIONS = [
    ("status", "TEXT NOT NULL DEFAULT 'active'"),
    ("closed_date", "TEXT"),
    ("institution", "TEXT"),
    ("subtype", "TEXT"),
    ("notes", "TEXT"),
    ("linked_account_id", "INTEGER"),
    ("owner_pct", "REAL NOT NULL DEFAULT 1.0"),
    ("rate_type", "TEXT"),
]


def migrate(conn):
    existing = {r["name"] for r in conn.execute("PRAGMA table_info(account)")}
    for col, ddl in MIGRATIONS:
        if col not in existing:
            conn.execute(f"ALTER TABLE account ADD COLUMN {col} {ddl}")
    # carry forward any old 'archived' flags into the new status column
    conn.execute("UPDATE account SET status='closed' WHERE archived=1 AND status='active'")
    # snapshot.note (added v1.4.0): per-month "why things changed" note
    snap_cols = {r["name"] for r in conn.execute("PRAGMA table_info(snapshot)")}
    if "note" not in snap_cols:
        conn.execute("ALTER TABLE snapshot ADD COLUMN note TEXT")
    # ledger.side + ledger.count_in_net_worth (added v1.6.0): let chosen
    # ledgers fold their as-of-date balance into net worth.
    ledger_cols = {r["name"] for r in conn.execute("PRAGMA table_info(ledger)")}
    if "side" not in ledger_cols:
        conn.execute("ALTER TABLE ledger ADD COLUMN side TEXT")
    if "count_in_net_worth" not in ledger_cols:
        conn.execute("ALTER TABLE ledger ADD COLUMN count_in_net_worth INTEGER NOT NULL DEFAULT 0")
    conn.commit()


def seed_manuspend(conn):
    """One-time, idempotent: turn the legacy 'Manufactured Spend' ledger into
    subaccounts of the ManuSpend cash account, and seed the latest snapshot's
    component split from the ledger's current balances. Older months keep their
    aggregate value untouched (detail tracked from now forward)."""
    acct = conn.execute(
        "SELECT id FROM account WHERE name='ManuSpend' LIMIT 1"
    ).fetchone()
    led = conn.execute(
        "SELECT id FROM ledger WHERE kind='manuspend' LIMIT 1"
    ).fetchone()
    if not acct or not led:
        return
    parent_id = acct["id"]
    # already migrated? (subaccounts exist) -> nothing to do
    have = conn.execute(
        "SELECT COUNT(*) c FROM subaccount WHERE parent_account_id=?", (parent_id,)
    ).fetchone()["c"]
    if have:
        return
    entries = conn.execute(
        "SELECT label, amount, sort_order FROM ledger_entry "
        "WHERE ledger_id=? ORDER BY sort_order, id",
        (led["id"],),
    ).fetchall()
    if not entries:
        return
    latest = conn.execute(
        "SELECT id FROM snapshot ORDER BY as_of DESC LIMIT 1"
    ).fetchone()
    for e in entries:
        cur = conn.execute(
            "INSERT INTO subaccount (parent_account_id, name, sort_order) "
            "VALUES (?,?,?)",
            (parent_id, e["label"] or "Component", e["sort_order"] or 0),
        )
        if latest is not None:
            conn.execute(
                "INSERT INTO subholding (snapshot_id, subaccount_id, value) "
                "VALUES (?,?,?)",
                (latest["id"], cur.lastrowid, e["amount"] or 0),
            )
    conn.commit()


def init():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = connect()
    conn.executescript(SCHEMA)
    migrate(conn)
    seed_manuspend(conn)
    conn.commit()
    return conn


if __name__ == "__main__":
    init()
    print("Initialized DB at", os.path.abspath(DB_PATH))
