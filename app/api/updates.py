"""Update endpoint: report whether newer PFi code is published on GitHub.

Read-only. Applying an update (``POST /api/update/apply``) is special-cased in
server.py because it has to restart the running process."""
import update
from api.routes import route


@route("GET", r"^/api/update$")
def get_update(conn, body):
    return (200, update.check())
