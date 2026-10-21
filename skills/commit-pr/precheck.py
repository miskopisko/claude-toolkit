#!/usr/bin/env python3
"""Gather everything needed to draft a commit + PR, and flag anything unsafe.

Read-only apart from a `git fetch` of the shared repo's remote (`remote` in the workflow
config, default origin): writes nothing, stages nothing. Exits non-zero if a
hard blocker is found. Also prints where the house style for commit messages and PR
bodies can be learned from: the rules file, recent commits on the trunk, their trailers,
and the PR template.

Usage:  python3 precheck.py [--repo owner/name] [--no-fetch]
"""
import collections
import fnmatch
import os
import re
import subprocess
import sys

from workflow import load, root


def sh(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout.strip()


def rc(*a):
    return subprocess.run(a, capture_output=True, text=True).returncode


def push_remote(remote):
    """Where the user's own branches go: remote.pushDefault, else origin (in a fork made with
    `gh repo fork`, the fork), else the shared repo's remote."""
    configured = sh("git", "config", "--get", "remote.pushDefault")
    if configured:
        return configured
    return "origin" if rc("git", "remote", "get-url", "origin") == 0 else remote


SQUASHED = re.compile(r"\s*\(#\d+\)$")


def tickets_from(branch, prefix):
    """Leading numbers of the branch name after its prefix: feature/412-413-csv-export -> 412, 413."""
    rest = branch[len(prefix):] if prefix and branch.startswith(prefix) else branch.rsplit("/", 1)[-1]
    out = []
    for tok in re.split(r"[-_]", rest):
        if not tok.isdigit():
            break
        out.append(tok)
    return out


def main():
    cfg = load()
    args = sys.argv[1:]
    if "--repo" in args:
        i = args.index("--repo")
        if i + 1 >= len(args) or args[i + 1].startswith("-"):
            sys.exit("usage: precheck.py [--repo owner/name] [--no-fetch]")
        repo = args[i + 1]
    else:
        repo = cfg["repo"]
    trunk, prefix, remote = cfg["trunk"], cfg["branchPrefix"], cfg["remote"]
    pushto = push_remote(remote)
    legacy = cfg.get("legacyBranches") or []
    branch = sh("git", "branch", "--show-current")
    blockers, warnings = [], []
    gh_repo = ["--repo", repo] if repo else []

    print(f"repo: {repo or '(unknown)'}")
    print(f"branch: {branch or '(detached HEAD)'}")

    # --- base branch: always the trunk --------------------------------------
    # Tickets branch from the trunk and PR into it. The parent chain is walked only
    # for the PR body's "Part of #n (epic #nn)".
    base = trunk
    tickets = tickets_from(branch, prefix) if branch else []
    prs_issues = sh("gh", "pr", "view", branch, *gh_repo, "--json", "closingIssuesReferences",
                    "--jq", "[.closingIssuesReferences[].number]|map(tostring)|join(\",\")") if branch else ""
    for n in (prs_issues or "").split(","):
        if n and n not in tickets:
            tickets.append(n)

    top = None
    for t in tickets:
        n, seen, last = t, 0, None
        while n and seen < 5:
            seen += 1
            parent = sh("gh", "issue", "view", n, *gh_repo, "--json", "parent",
                        "--jq", ".parent.number // empty")
            if not parent:
                break
            last = n = parent
        if last:
            top = last
            break
    print(f"base (PR target): {base}")
    print(f"tickets: {', '.join('#' + t for t in tickets) or '(none found: ask)'}")
    print(f"top of the parent chain (the epic, for the PR body): {'#' + top if top else '(none)'}")

    protected = {trunk, "main", "master"}
    if branch in protected:
        blockers.append(f"on protected branch '{branch}' — never commit here; cut a ticket branch (/prep-branch)")
    elif any(fnmatch.fnmatch(branch, p) for p in legacy):
        blockers.append(f"on legacy branch '{branch}' — tickets branch from {trunk}; cut a ticket branch (/prep-branch)")

    # --- staged set ---------------------------------------------------------
    staged = [f for f in sh("git", "diff", "--cached", "--name-only").splitlines() if f]
    if not staged:
        blockers.append("nothing staged — the user stages what they intend to commit")
    print(f"\nstaged ({len(staged)}):")
    for f in sh("git", "diff", "--cached", "--name-status").splitlines():
        print(f"  {f}")
    stat = sh("git", "diff", "--cached", "--stat")
    if stat:
        print("\n" + stat.splitlines()[-1].strip())

    # --- drift: things NOT going in ----------------------------------------
    unstaged = [f for f in sh("git", "diff", "--name-only").splitlines() if f]
    untracked = [f for f in sh("git", "ls-files", "--others", "--exclude-standard").splitlines() if f]
    if unstaged or untracked:
        print(f"\nNOT staged — will NOT be committed ({len(unstaged) + len(untracked)}):")
        for f in unstaged:
            print(f"  M  {f}")
        for f in untracked:
            print(f"  ?? {f}")
        warnings.append("unstaged/untracked files exist — confirm each is deliberately "
                        "excluded (another session's work, machine-local config)")

    skipped = [l[2:] for l in sh("git", "ls-files", "-v").splitlines() if l.startswith("S ")]
    if skipped:
        print("\nhidden by skip-worktree (invisible to git status):")
        for f in skipped:
            print(f"  {f}")

    # --- branch freshness ---------------------------------------------------
    if "--no-fetch" not in args:
        sh("git", "fetch", "-q", remote)
    if rc("git", "rev-parse", "--verify", "-q", f"{remote}/{base}") != 0:
        blockers.append(f"no {remote}/{base} — check `trunk` and `remote` in the workflow config")
    else:
        behind = sh("git", "rev-list", "--count", f"HEAD..{remote}/{base}")
        ahead = sh("git", "rev-list", "--count", f"{remote}/{base}..HEAD")
        print(f"\nvs {remote}/{base}: {ahead or 0} ahead, {behind or 0} behind")
        if behind and behind != "0":
            warnings.append(f"branch is {behind} commit(s) behind {remote}/{base} — "
                            f"merge it in before opening the PR")

        # A legacy branch not yet on the trunk, carried on this branch, would land in the PR too.
        refs = set()
        for p in legacy:
            refs |= {b.strip() for b in sh("git", "branch", "-r", "--list", f"{remote}/{p}").splitlines() if b.strip()}
        for e in sorted(refs):
            if rc("git", "merge-base", "--is-ancestor", e, "HEAD") != 0:
                continue
            extra = sh("git", "rev-list", "--count", f"{remote}/{base}..{e}")
            if extra and extra != "0":
                blockers.append(f"branch contains {e}, which has {extra} commit(s) not on "
                                f"{remote}/{base} — the PR would carry them; ask the user")

    # --- upstream + existing PR --------------------------------------------
    up = sh("git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    # Pushed = tracking a branch of the same name on any remote (the fork's, in a fork).
    pushed = bool(up) and "/" in up and up.split("/", 1)[1] == branch
    print(f"upstream: {up or '(none)'}"
          + ("" if pushed else f"  — first push: git push -u {pushto} HEAD"))
    pr = sh("gh", "pr", "list", *gh_repo, "--head", branch, "--state", "open",
            "--json", "number,url", "--jq", ".[0].url") if branch else ""
    if pr:
        print(f"OPEN PR ALREADY EXISTS: {pr}")
        warnings.append("a PR is already open for this branch — this is a follow-up "
                        "commit, not a new PR. Commit, push, and stop.")

    # --- where the house style comes from -----------------------------------
    top_dir = root()
    print("\n## HOUSE STYLE SOURCES")
    rules = cfg.get("rulesFile")
    if rules:
        path = rules if os.path.isabs(rules) else os.path.join(top_dir, rules)
        print(f"rules file: {path}" + ("" if os.path.exists(path) else "  (MISSING)"))
    else:
        print("rules file: (none set)")
    templates = [p for p in (".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md",
                             "pull_request_template.md", "docs/pull_request_template.md")
                 if os.path.exists(os.path.join(top_dir, p))]
    tdir = os.path.join(top_dir, ".github", "PULL_REQUEST_TEMPLATE")
    if os.path.isdir(tdir):
        templates += [os.path.join(".github/PULL_REQUEST_TEMPLATE", f) for f in sorted(os.listdir(tdir))]
    print(f"PR template: {', '.join(templates) or '(none)'}")
    # Non-merge commits only. A squash merge's subject is the PR title plus " (#n)": strip
    # the suffix and label it, since a PR title isn't necessarily how commits are written.
    subjects = sh("git", "log", "--no-merges", "-12", "--format=%s", f"{remote}/{base}")
    print(f"recent subjects on {remote}/{base} (evidence of the style, not rules; "
          f"[PR] = a squash-merged PR title, its (#n) removed):")
    for s in subjects.splitlines():
        print(f"  [PR] {SQUASHED.sub('', s)}" if SQUASHED.search(s) else f"  {s}")
    trailers = collections.Counter()
    for t in sh("git", "log", "--no-merges", "-50", "--format=%(trailers:only,unfold)",
                f"{remote}/{base}").splitlines():
        if ":" in t:
            trailers[t.split(":", 1)[0].strip()] += 1
    print("trailers in the last 50: " + (", ".join(f"{k} ×{v}" for k, v in trailers.most_common()) or "(none)"))

    board = cfg.get("board") or {}
    print(f"\nboard: {board['name'] + ' → ' + (board.get('inReview') or 'In review') if board.get('name') else '(none configured: the board step is skipped)'}")
    not_local = (cfg.get("gate") or {}).get("notLocal") or []
    if not_local:
        print(f"CI jobs /gate can't run locally: {', '.join(not_local)}")

    # --- report -------------------------------------------------------------
    if warnings:
        print("\n⚠️  WARNINGS")
        for w in warnings:
            print(f"  - {w}")
    if blockers:
        print("\n⛔ BLOCKERS")
        for b in blockers:
            print(f"  - {b}")
        sys.exit(1)
    print("\nprechecks passed — safe to draft the commit message.")


if __name__ == "__main__":
    main()
