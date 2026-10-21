"""The project's workflow settings, shared by next, prep-branch, gate, commit-pr and pr-comments.

Reads .claude/workflow.json (the team's, committed) and then .claude/workflow.local.json
(yours, git-ignored) from the repository root; keys in the local file win, one level deep.
Anything unset is worked out from git and gh. Identical copies of this file ship in each of
those skills, so each folder works on its own; scripts/check-shared.sh keeps them in step.

Usage from a skill script:  from workflow import load;  cfg = load()
"""
import json
import subprocess
import sys
from pathlib import Path

DEFAULTS = {
    "repo": None,               # owner/name; default: the gh repo of this checkout
    "remote": "origin",         # the git remote for the shared repo (in a fork, often "upstream")
    "trunk": None,              # the branch tickets branch from and PR into; default: the repo's default branch
    "branchPrefix": "feature/", # ticket branches are <branchPrefix><n>-<slug>
    "legacyBranches": [],       # glob patterns of long-lived branches still being finished, e.g. "epic/*"
    "labels": {
        "ready": ["ready-for-agent", "ready-for-human"],
        "parked": ["revisit-later", "wontfix"],
        "spec": "spec",
        "needsTriage": "needs-triage",
    },
    "board": None,              # {"name", "inProgress", "inReview"}: a GitHub Project to move cards on; none = no moves
    "rulesFile": None,          # a doc of standing rules and house conventions the skills defer to
    "gate": {"jobs": [], "notLocal": []},
}


def _run(*args):
    r = subprocess.run(args, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def root():
    return Path(_run("git", "rev-parse", "--show-toplevel") or ".")


def _read(path):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as e:
        sys.exit(f"{path}: not valid JSON ({e})")


def _merge(base, over):
    out = dict(base)
    for k, v in over.items():
        out[k] = {**out[k], **v} if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load():
    top = root()
    cfg = DEFAULTS
    for name in ("workflow.json", "workflow.local.json"):
        cfg = _merge(cfg, _read(top / ".claude" / name))
    remote = cfg["remote"]
    if not cfg["repo"]:
        # The shared repo is the one `remote` points at, which in a fork isn't gh's default.
        url = _run("git", "remote", "get-url", remote)
        cfg["repo"] = _run("gh", "repo", "view", url, "--json", "nameWithOwner", "-q", ".nameWithOwner") \
            if url else None
        cfg["repo"] = cfg["repo"] or None
    if not cfg["trunk"]:
        view = ["gh", "repo", "view"] + ([cfg["repo"]] if cfg["repo"] else [])
        cfg["trunk"] = _run(*view, "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name") \
            or _run("git", "symbolic-ref", "--short", f"refs/remotes/{remote}/HEAD").removeprefix(f"{remote}/") \
            or "main"
    return cfg


if __name__ == "__main__":
    print(json.dumps(load(), indent=2))
