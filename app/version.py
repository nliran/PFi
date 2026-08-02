"""Single source of truth for module versions.

Each module re-exposes its own number from here (``from version import DB_VERSION``)
so there is exactly one place to bump a version. The ``/api/version`` endpoint and
the in-app About panel read :func:`module_versions`.

Versioning is independent per module (semver: MAJOR.MINOR.PATCH):

  app       - overall release of the whole tracker
  db        - storage schema / migration layer (app/db.py)
  importer  - Numbers workbook importer (app/import_numbers.py)
  api       - backend HTTP API + routing (app/api, app/server.py)
  ui        - frontend SPA (app/static)
"""

APP_VERSION = "1.22.0"
DB_VERSION = "1.7.0"
IMPORTER_VERSION = "1.0.0"
API_VERSION = "1.11.0"
UI_VERSION = "1.21.0"


def module_versions():
    """Backend-known versions. The UI version is owned by the frontend
    (static/js/version.js) and merged into the About panel client-side."""
    return {
        "app": APP_VERSION,
        "db": DB_VERSION,
        "importer": IMPORTER_VERSION,
        "api": API_VERSION,
        "ui": UI_VERSION,
    }
