"""Trends endpoint: per-snapshot asset-class allocation (net of linked debt)
and debt / real-estate-equity time series for the Trends view charts."""
from api.routes import route


@route("GET", r"^/api/trends$")
def get_trends(conn, body):
    # One pass over every holding, joined to its account + snapshot.
    rows = conn.execute(
        """
        SELECT s.id AS sid, s.as_of, a.id AS aid, a.kind, a.asset_class,
               a.linked_account_id, h.value
        FROM snapshot s
        JOIN holding h ON h.snapshot_id = s.id
        JOIN account a ON a.id = h.account_id
        ORDER BY s.as_of
        """
    ).fetchall()

    # Group by snapshot.
    snaps = {}          # sid -> {"date":, "vals":{aid:value}, "rows":[...]}
    order = []
    for r in rows:
        sid = r["sid"]
        if sid not in snaps:
            snaps[sid] = {"date": r["as_of"], "vals": {}, "rows": []}
            order.append(sid)
        snaps[sid]["vals"][r["aid"]] = r["value"]
        snaps[sid]["rows"].append(r)

    classes = set()
    series = []
    for sid in order:
        s = snaps[sid]
        vals = s["vals"]
        alloc = {}
        debt_total = 0.0
        re_gross = 0.0
        re_mortgage = 0.0
        for r in s["rows"]:
            if r["kind"] == "debt":
                debt_total += r["value"]
                continue
            v = r["value"]
            if r["linked_account_id"]:
                v -= vals.get(r["linked_account_id"], 0)
            cls = r["asset_class"]
            alloc[cls] = alloc.get(cls, 0) + v
            if cls == "real_estate":
                re_gross += r["value"]
                if r["linked_account_id"]:
                    re_mortgage += vals.get(r["linked_account_id"], 0)
        classes.update(alloc.keys())
        series.append({
            "date": s["date"],
            "alloc": alloc,
            "debt": debt_total,
            "re_gross": re_gross,
            "re_mortgage": re_mortgage,
            "re_equity": re_gross - re_mortgage,
        })

    # Stable class ordering by latest-month size (largest first).
    last = series[-1]["alloc"] if series else {}
    classes = sorted(classes, key=lambda c: -last.get(c, 0))
    return (200, {"series": series, "classes": classes})
