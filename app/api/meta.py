"""Meta endpoints: per-module version manifest for the About panel."""
import version
from api.routes import route


@route("GET", r"^/api/version$")
def get_version(conn, body):
    return (200, version.module_versions())
