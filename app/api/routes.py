"""Tiny route registry shared by all API handler modules.

Handlers register themselves with the ``@route(method, pattern)`` decorator and
receive ``(conn, body, *path_groups)``. They return ``(status, payload)``; a
payload of ``None`` is turned into the matching HTTP error by the server.
"""
import re

ROUTES = []  # list of (method, compiled_pattern, handler)


def route(method, pattern):
    rx = re.compile(pattern)

    def deco(fn):
        ROUTES.append((method, rx, fn))
        return fn

    return deco


def dispatch(method, path, conn, body):
    """Return (status, payload) for the first matching route, or None if no
    route matches (server replies 404)."""
    for m, rx, fn in ROUTES:
        if m != method:
            continue
        mo = rx.match(path)
        if mo:
            return fn(conn, body, *mo.groups())
    return None
