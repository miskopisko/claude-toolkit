"""The project's workflow settings, shared by next, prep-branch, gate, commit-pr and pr-comments.

Reads .claude/workflow.json (the team's, committed) and then .claude/workflow.local.json
(yours, git-ignored) from the repository root; keys in the local file win, one level deep.
Anything unset is worked out from git and gh. Identical copies of this file ship in each of
those skills, so each folder works on its own; scripts/check-shared.sh keeps them in step.

Usage from a skill script:  from workflow import load;  cfg = load()
"""
import json
import subprocess
from pathlib import Path

DEFAULTS = {
    "repo": None,               # owner/name; default: the gh repo of this checkout
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
    if not cfg["repo"]:
        cfg["repo"] = _run("gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner") or None
    if not cfg["trunk"]:
        cfg["trunk"] = _run("gh", "repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name") \
            or _run("git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD").removeprefix("origin/") or "main"
    return cfg


if __name__ == "__main__":
    print(json.dumps(load(), indent=2))
