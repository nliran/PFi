"""PFi backend API package.

Importing this package registers every route (each handler module calls the
``@route`` decorator at import time) and exposes :func:`dispatch`.
"""
from version import API_VERSION as __version__

from api.routes import dispatch  # noqa: F401  (re-exported)

# Import handler modules for their side effect: registering routes.
from api import accounts, dashboard, export, ledgers, meta, snapshots, subaccounts, trends, updates  # noqa: E402,F401

__all__ = ["dispatch", "__version__"]
