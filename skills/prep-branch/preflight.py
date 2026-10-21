#!/usr/bin/env python3
"""Report everything prep-branch needs to know before it touches a branch.

Read-only: no fetch, no checkout, no tracker writes. Run `git fetch <remote> --prune`
first so the refs it compares against are current. <remote> is the workflow config's
`remote`, the git remote for the shared repo (default origin).

Tickets branch from the trunk and their PRs target it (`trunk` in the workflow config).
This reports the ticket's readiness and its parent chain (for context only), how far
the local trunk has drifted from <remote>/<trunk>, any ticket branch that already exists, and
anything in the working tree that would get in the way.

Usage:  python3 preflight.py <ticket-number> [--repo owner/name]
        python3 preflight.py --deps <START>     dependency files changed since START,
                                                with the restore command for each
"""
import fnmatch
import json
import os
import subprocess
import sys

from workflow import load

problems = []   # anything that should stop the run until the user decides

FIELDS = "number,title,state,labels,assignees,parent,projectItems"


def run(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def git(*args):
    return run("git", *args)


def as_set(v):
    """A label setting may be one name or a list of names."""
    if not v:
        return set()
    return {v} if isinstance(v, str) else set(v)


def lines(out):
    return [l for l in (out or "").splitlines() if l.strip()]


def count(rng):
    return int(git("rev-list", "--count", rng) or 0)


def issue(repo, n):
    # subIssuesSummary needs a recent gh; fall back without it.
    for fields in (FIELDS + ",subIssuesSummary", FIELDS):
        out = run("gh", "issue", "view", str(n), "--repo", repo, "--json", fields)
        if out:
            return json.loads(out)
    return None


def open_blockers(repo, n):
    out = run("gh", "api", f"repos/{repo}/issues/{n}/dependencies/blocked_by")
    rows = json.loads(out) if out else []
    return [b for b in rows if b.get("state") == "open"]


def flag(msg):
    problems.append(msg)
    print(f"  ⛔ {msg}")


def legacy_remotes(remote, patterns):
    found = []
    for p in patterns:
        found += [b.strip() for b in lines(git("branch", "-r", "--list", f"{remote}/{p}"))]
    return sorted(set(found))


# ── Dependency files ────────────────────────────────────────────────────────
# (file-name pattern, restore command, True if the restore deletes what is installed)
DEPS = [
    ("package-lock.json", "npm ci", True),
    ("npm-shrinkwrap.json", "npm ci", True),
    ("yarn.lock", "yarn install --frozen-lockfile  (Yarn 2+: yarn install --immutable)", False),
    ("pnpm-lock.yaml", "pnpm install --frozen-lockfile", False),
    ("bun.lock", "bun install --frozen-lockfile", False),
    ("bun.lockb", "bun install --frozen-lockfile", False),
    ("*.csproj", "dotnet restore", False),
    ("*.fsproj", "dotnet restore", False),
    ("*.props", "dotnet restore", False),
    ("packages.lock.json", "dotnet restore", False),
    ("global.json", "dotnet restore  (check the SDK version it pins is installed)", False),
    ("dotnet-tools.json", "dotnet tool restore", False),
    ("uv.lock", "uv sync", True),
    ("poetry.lock", "poetry install", False),
    ("Pipfile.lock", "pipenv sync", False),
    ("requirements*.txt", "pip install -r <file>  (in the project's virtualenv)", False),
    ("Gemfile.lock", "bundle install", False),
    ("go.sum", "go mod download", False),
    ("go.mod", "go mod download", False),
    ("Cargo.lock", "cargo fetch", False),
    ("composer.lock", "composer install", False),
    ("mix.lock", "mix deps.get", False),
    ("pubspec.lock", "dart pub get  (flutter pub get for Flutter)", False),
    ("Podfile.lock", "pod install", False),
    ("pom.xml", "mvn dependency:resolve", False),
    ("gradle.lockfile", "./gradlew dependencies --refresh-dependencies", False),
    ("*.gradle", "./gradlew dependencies --refresh-dependencies", False),
    ("*.gradle.kts", "./gradlew dependencies --refresh-dependencies", False),
    ("package.json", "the package manager's install (no lockfile changed alongside it)", False),
]


def deps(start):
    if not git("rev-parse", "--verify", "-q", f"{start}^{{commit}}"):
        sys.exit(f"not a commit: {start}")
    changed = lines(git("diff", "--name-only", start, "HEAD"))
    todo = {}   # (dir, command) -> (files, wipes)
    for path in changed:
        d, base = os.path.dirname(path) or ".", os.path.basename(path)
        for pattern, cmd, wipes in DEPS:
            if fnmatch.fnmatch(base, pattern):
                if pattern == "package.json" and any(
                        os.path.dirname(p) == os.path.dirname(path) and os.path.basename(p) in
                        ("package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml",
                         "bun.lock", "bun.lockb") for p in changed):
                    break
                files, w = todo.get((d, cmd), ([], False))
                todo[(d, cmd)] = (files + [base], w or wipes)
                break
    print(f"## DEPENDENCY FILES CHANGED SINCE {start[:12]}")
    if not todo:
        print("  none: no restore needed")
        return
    for (d, cmd), (files, wipes) in sorted(todo.items()):
        warn = "  ⚠️  deletes what is installed and reinstalls: needs its own yes" if wipes else ""
        print(f"  in {d}: {cmd}   ({', '.join(sorted(set(files)))}){warn}")


def main():
    args = sys.argv[1:]
    if args[:1] == ["--deps"]:
        if len(args) < 2:
            sys.exit("usage: preflight.py --deps <START>")
        return deps(args[1])
    cfg = load()
    repo = cfg["repo"]
    if "--repo" in args:
        i = args.index("--repo")
        if i + 1 >= len(args):
            sys.exit("usage: preflight.py <ticket-number> [--repo owner/name]")
        repo = args[i + 1]
        del args[i:i + 2]
    if not args or not args[0].lstrip("#").isdigit():
        sys.exit("usage: preflight.py <ticket-number> [--repo owner/name]")
    if not repo:
        sys.exit("no repo: set `repo` in the workflow config or pass --repo")
    n = int(args[0].lstrip("#"))
    trunk, prefix, labels_cfg = cfg["trunk"], cfg["branchPrefix"], cfg["labels"]
    legacy = cfg.get("legacyBranches") or []
    me = run("gh", "api", "user", "--jq", ".login") or "?"
    remote = cfg["remote"]
    base = f"{remote}/{trunk}"

    # ── Ticket ──────────────────────────────────────────────────────────────
    t = issue(repo, n)
    if not t:
        sys.exit(f"could not read #{n} in {repo}")
    labels = {l["name"] for l in t["labels"]}
    who = [a["login"] for a in t["assignees"]]
    print(f"## TICKET #{n} — {t['title']}")
    print(f"  repo={repo}  state={t['state']}  labels={','.join(sorted(labels)) or '—'}  "
          f"assignees={','.join(who) or '—'}")
    if t["state"] != "OPEN":
        flag("ticket is closed")
    spec = as_set(labels_cfg.get("spec")) & labels
    if spec:
        flag(f"labelled {', '.join(sorted(spec))}: a spec, not an implementable ticket")
    if "subIssuesSummary" not in t:
        print("  ⚠️  this gh can't read sub-issues (no subIssuesSummary; upgrade gh): "
              "couldn't check whether this is a parent ticket or epic — check by hand")
    subs = (t.get("subIssuesSummary") or {}).get("total") or 0
    if subs:
        flag(f"has {subs} sub-issue(s): a parent ticket, not one to implement directly")
    parked = as_set(labels_cfg.get("parked")) & labels
    if parked:
        flag(f"parked ({', '.join(sorted(parked))})")
    ready = as_set(labels_cfg.get("ready"))
    if ready and not ready & labels:
        print(f"  ⚠️  none of the ready labels ({', '.join(sorted(ready))}) — takeable only if the user says so")
    triage = as_set(labels_cfg.get("needsTriage")) & labels
    if triage:
        print(f"  ⚠️  labelled {', '.join(sorted(triage))}: not triaged yet")
    if who and me not in who:
        flag(f"assigned to someone else ({','.join(who)})")
    elif not who:
        print("  ⚠️  unassigned — take.py will assign it (step 3)")
    board = cfg.get("board") or {}
    if board.get("name"):
        title, col = board["name"], board.get("inProgress") or "In progress"
        cards = {p["title"]: (p.get("status") or {}).get("name") for p in t.get("projectItems") or []}
        status = cards.get(title)
        print(f"  {title}: {status or ('(no status)' if title in cards else '(not on the board)')}"
              + ("" if status == col else f"  — take.py will move it to {col} (step 3)"))
    else:
        print("  board: none configured — step 3 only assigns")
    for b in open_blockers(repo, n):
        flag(f"blocked by open #{b['number']} — {b['title']}")

    # Parent chain, for the report only.
    chain, cur, seen = [], t, 0
    while cur and cur.get("parent") and seen < 5:
        seen += 1
        cur = issue(repo, cur["parent"]["number"])
        if not cur:
            break
        chain.append(f"#{cur['number']} {cur['title']}")
    print(f"  parents: {' → '.join(chain) or '(none)'}")

    # ── Trunk ───────────────────────────────────────────────────────────────
    print(f"\n## TRUNK: {trunk}")
    if not git("rev-parse", "--verify", "-q", base):
        flag(f"no {base} — fetch first")
        return summary()
    print(f"  {base}: {git('log', '-1', '--format=%h %s', base)}")
    if git("rev-parse", "--verify", "-q", f"refs/heads/{trunk}"):
        a, b = (git("rev-list", "--left-right", "--count", f"{trunk}...{base}") or "0 0").split()
        print(f"  local {trunk} vs {base}: ahead {a}, behind {b}")
        if int(a):
            flag(f"local {trunk} has {a} commit(s) not on {base} — unpushed work, ask before touching it")

    # ── Ticket branch ───────────────────────────────────────────────────────
    print(f"\n## TICKET BRANCH ({prefix}{n}-<slug>)")
    local = [b.strip(" *+") for b in lines(git("branch", "--list", f"{prefix}{n}-*"))]
    # Any remote: in a fork, ticket branches are pushed to the fork, not to `remote`.
    rem = [b.strip() for b in lines(git("branch", "-r", "--list", f"*/{prefix}{n}-*"))]
    print(f"  local: {local or '(none)'}   remote: {rem or '(none)'}")
    legacy_refs = legacy_remotes(remote, legacy)
    for b in local:
        up = git("rev-parse", "--abbrev-ref", f"{b}@{{u}}") or "(no upstream)"
        ahead = count(f"{base}..{b}")
        behind = count(f"{b}..{base}")
        print(f"  {b}: upstream={up}  ahead of {trunk}={ahead}  behind {trunk}={behind}")
        if any(fnmatch.fnmatch(up, f"{remote}/{p}") for p in legacy):
            print(f"  ⚠️  {b} still tracks a legacy branch — repoint it at {base} (step 2)")
        # Commits of a legacy branch that hasn't reached the trunk would ride along on a rebase.
        for e in legacy_refs:
            extra = count(f"{base}..{e}")
            if extra and git("merge-base", "--is-ancestor", e, b) is not None:
                flag(f"{b} contains {e}, which has {extra} commit(s) not yet on "
                     f"{trunk} — a rebase onto {trunk} would carry them; ask the user")
    if len(local) > 1:
        flag(f"more than one local {prefix}{n}-* branch — ask which is live")

    # ── Working tree ────────────────────────────────────────────────────────
    print("\n## WORKING TREE")
    print(f"  on: {git('branch', '--show-current') or '(detached HEAD)'}")
    gd = git("rev-parse", "--git-dir")
    for marker, what in (("rebase-merge", "rebase"), ("rebase-apply", "rebase/am"),
                         ("MERGE_HEAD", "merge"), ("CHERRY_PICK_HEAD", "cherry-pick"),
                         ("REVERT_HEAD", "revert")):
        if gd and os.path.exists(os.path.join(gd, marker)):
            flag(f"a {what} is in progress — finish or abort it first")
    status = lines(subprocess.run(["git", "status", "--porcelain"],
                                  capture_output=True, text=True).stdout)
    staged = [s for s in status if s[0] not in " ?"]
    changed = [s for s in status if s[0] != "?" and s[1] != " "]
    untracked = [s for s in status if s.startswith("??")]
    for name, rows in (("staged", staged), ("modified, unstaged", changed),
                       ("untracked", untracked)):
        if rows:
            flag(f"{len(rows)} {name}:")
            for r in rows:
                print(f"       {r}")
    stashes = lines(git("stash", "list"))
    if stashes:
        print(f"  ℹ️  {len(stashes)} stash(es) — not in the way, but may be forgotten work:")
        for s in stashes:
            print(f"       {s}")

    # skip-worktree files: hidden from status, but a checkout or rebase that
    # touches them aborts with "Your local changes would be overwritten".
    hidden = [l[2:] for l in lines(git("ls-files", "-v")) if l.startswith("S ")]
    if hidden:
        print(f"  skip-worktree (expected: machine-local edits): {len(hidden)}")
        for h in hidden:
            print(f"       {h}")
        touched = lines(git("diff", "--name-only", "HEAD", base, "--", *hidden))
        for f in sorted(set(touched)):
            flag(f"{f} differs between HEAD and {base} — the switch will abort; "
                 "use the skip-worktree recovery in step 1")

    return summary()


def summary():
    print()
    if problems:
        print(f"PREFLIGHT: {len(problems)} blocker(s) — resolve with the user before changing anything")
        sys.exit(1)
    print("PREFLIGHT: clear")


if __name__ == "__main__":
    main()
