"""Shared helpers for API handler modules."""


def rows_to_dicts(rows):
    return [dict(r) for r in rows]
