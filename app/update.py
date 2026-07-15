"""Self-update: check GitHub for newer PFi code and fast-forward to it.

PFi is a git checkout of https://github.com/nliran/PFi. This module lets the
running app see whether the published code is newer than what it's running and
pull it in with one click (a fast-forward ``git pull``), after which the server
restarts itself so the new code takes effect.

Two install shapes are handled:

* ``git``    - you're running the checkout directly (``./run.sh`` or a
               ``git clone``). Update = ``git pull`` in place, then restart.
* ``bundle`` - you launched the packaged ``PFi.app``, whose code is a *copy*.
               Update = ``git pull`` the source checkout at ``~/PFi`` (or
               ``$PFI_SRC``), rebuild the running ``.app`` from it with
               ``build-app.sh``, then restart.

Reading a public repo needs no credentials, so anyone who cloned can self-update
for free. Only the maintainer needs a token, and only to *push*.
"""
import importlib.util
import os
import re
import shutil
import subprocess

import version

REMOTE = "origin"
BRANCH = "main"

CODE_DIR = os.path.dirname(os.path.abspath(__file__))   # .../app
CODE_ROOT = os.path.dirname(CODE_DIR)                    # dir that contains app/


def _run(args, cwd, timeout=90):
    """Run a command, returning (ok, stdout, stderr). Never raises."""
    try:
        p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return p.returncode == 0, p.stdout.strip(), p.stderr.strip()
    except Exception as e:  # pragma: no cover - defensive (git missing, timeout, ...)
        return False, "", str(e)


def purge_bytecode(root):
    """Delete cached bytecode for every ``.py`` under *root* before we restart.

    macOS's ``/usr/bin/python3`` mirrors its bytecode cache OUTSIDE the source
    tree (``~/Library/Caches/com.apple.python/...`` via ``sys.pycache_prefix``),
    and Python treats a ``.pyc`` as fresh when its recorded source mtime merely
    *matches* the source. Right after a ``git pull`` the new file can land in the
    same filesystem-second as the old cache, so without this purge a restart
    would silently keep running the OLD code. ``cache_from_source`` resolves the
    real cache path (mirror or local ``__pycache__``) for us."""
    for dirpath, dirnames, filenames in os.walk(root):
        for fn in filenames:
            if fn.endswith(".py"):
                try:
                    cached = importlib.util.cache_from_source(os.path.join(dirpath, fn))
                    if cached and os.path.exists(cached):
                        os.remove(cached)
                except Exception:
                    pass
        if "__pycache__" in dirnames:
            shutil.rmtree(os.path.join(dirpath, "__pycache__"), ignore_errors=True)


def _find_checkout():
    """The git checkout to update from: the one we're running inside, or (for the
    packaged .app, whose code is a copy) the known source checkout at ~/PFi."""
    d = CODE_ROOT
    while True:
        if os.path.isdir(os.path.join(d, ".git")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    src = os.environ.get("PFI_SRC") or os.path.expanduser("~/PFi")
    if os.path.isdir(os.path.join(src, ".git")):
        return src
    return None


def _bundle_path():
    """If the running code lives inside a macOS ``.app`` bundle, return its path."""
    p = CODE_DIR
    while True:
        if p.endswith(".app"):
            return p
        parent = os.path.dirname(p)
        if parent == p:
            return None
        p = parent


def _install_kind(checkout):
    if not checkout:
        return "unknown"
    if os.path.realpath(CODE_ROOT).startswith(os.path.realpath(checkout)):
        return "git"      # we're running inside the checkout itself
    return "bundle"       # running a copy (e.g. PFi.app); source checkout exists


def _parse_app_version(text):
    m = re.search(r'APP_VERSION\s*=\s*["\']([0-9]+(?:\.[0-9]+)*)', text or "")
    return m.group(1) if m else None


def _vtuple(v):
    try:
        return tuple(int(x) for x in v.split("."))
    except Exception:
        return ()


def check(fetch=True):
    """Report whether a newer version is published. Read-only; never restarts."""
    current = version.APP_VERSION
    checkout = _find_checkout()
    kind = _install_kind(checkout)
    res = {
        "current": current, "latest": None, "update_available": False,
        "kind": kind, "can_update": False, "dirty": False, "behind": 0,
        "message": "",
    }
    if not checkout:
        res["message"] = (
            "This copy isn't a git install, so it can't self-update. Clone "
            "https://github.com/nliran/PFi and run ./run.sh, or keep ~/PFi as "
            "the source the app was built from."
        )
        return res
    if fetch:
        ok, _, err = _run(["git", "fetch", "--quiet", REMOTE, BRANCH], checkout, timeout=30)
        if not ok:
            res["message"] = "Couldn't reach GitHub to check for updates" + (f": {err}" if err else ".")
            return res
    ok, out, _ = _run(["git", "show", f"{REMOTE}/{BRANCH}:app/version.py"], checkout)
    res["latest"] = _parse_app_version(out) if ok else None
    ok, out, _ = _run(["git", "rev-list", "--count", f"HEAD..{REMOTE}/{BRANCH}"], checkout)
    res["behind"] = int(out) if ok and out.isdigit() else 0
    ok, out, _ = _run(["git", "status", "--porcelain"], checkout)
    res["dirty"] = bool(out)
    newer = bool(res["latest"] and _vtuple(res["latest"]) > _vtuple(current))
    res["update_available"] = newer or res["behind"] > 0
    res["can_update"] = res["update_available"] and not res["dirty"]
    if res["dirty"] and res["update_available"]:
        res["message"] = ("An update is available, but the source checkout at "
                          f"{checkout} has uncommitted local changes. Commit or "
                          "stash them first.")
    elif not res["update_available"]:
        res["message"] = "You're on the latest version."
    else:
        res["message"] = f"Update available: v{res['latest'] or '?'} (you have v{current})."
    return res


def apply_update():
    """Fast-forward the checkout to the published code (rebuilding the running
    ``.app`` if we're the packaged bundle). Returns a dict; the caller restarts
    the server on ``ok=True`` and no ``noop``. This function never restarts."""
    checkout = _find_checkout()
    if not checkout:
        return {"ok": False, "message": "No git checkout to update from."}
    kind = _install_kind(checkout)
    before = version.APP_VERSION

    ok, out, _ = _run(["git", "status", "--porcelain"], checkout)
    if out:
        return {"ok": False, "message": f"The source checkout at {checkout} has "
                "uncommitted changes; commit or stash them first."}

    ok, _, err = _run(["git", "fetch", "--quiet", REMOTE, BRANCH], checkout, timeout=30)
    if not ok:
        return {"ok": False, "message": "Couldn't reach GitHub: " + (err or "network error")}

    ok, out, _ = _run(["git", "rev-list", "--count", f"HEAD..{REMOTE}/{BRANCH}"], checkout)
    behind = int(out) if ok and out.isdigit() else 0
    if behind == 0:
        return {"ok": True, "noop": True, "from": before, "to": before,
                "message": "Already up to date."}

    ok, out, err = _run(["git", "merge", "--ff-only", f"{REMOTE}/{BRANCH}"], checkout)
    if not ok:
        return {"ok": False, "message": "Update isn't a clean fast-forward (local "
                f"history in {checkout} has diverged). Resolve it there manually.\n"
                + (err or out)}

    ok, out, _ = _run(["git", "show", "HEAD:app/version.py"], checkout)
    after = _parse_app_version(out) or before

    rebuilt = False
    if kind == "bundle":
        script = os.path.join(checkout, "build-app.sh")
        if not os.path.isfile(script):
            return {"ok": False, "message": "Pulled the update, but build-app.sh "
                    "is missing so the app couldn't be rebuilt. Rebuild manually."}
        bundle = _bundle_path()
        args = ["bash", script] + ([bundle] if bundle else [])
        bok, bout, berr = _run(args, checkout, timeout=180)
        if not bok:
            return {"ok": False, "message": "Pulled the update, but rebuilding the "
                    "app failed:\n" + (berr or bout)}
        rebuilt = True

    return {"ok": True, "from": before, "to": after, "kind": kind, "rebuilt": rebuilt,
            "message": f"Updated from v{before} to v{after}."}
