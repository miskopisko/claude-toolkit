#!/usr/bin/env python3
"""Walk an epic's delivery tree and classify every open ticket.

Read-only. Resolves epic -> sub-issues -> (for any child carrying the spec label) that
spec's own sub-issues, then reports each open ticket's labels, assignee and OPEN blocker
count using GitHub's native issue dependencies. Ends with the long-lived branches
(`legacyBranches` in the workflow config) that hold commits not yet on the trunk.

Usage:  python3 frontier.py <epic-number> [--repo owner/name] [--me <login>]
"""
import fnmatch
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from workflow import load


def as_set(v):
    if not v:
        return set()
    return {v} if isinstance(v, str) else set(v)


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def gh(path):
    out = run(["gh", "api", path, "--paginate"])
    if out is None:
        return None
    # --paginate prints one JSON document per page; decode them in turn and join arrays.
    dec, pos, docs = json.JSONDecoder(), 0, []
    while pos < len(out):
        while pos < len(out) and out[pos].isspace():
            pos += 1
        if pos >= len(out):
            break
        try:
            doc, pos = dec.raw_decode(out, pos)
        except json.JSONDecodeError:
            return None
        docs.append(doc)
    if not docs:
        return None
    if all(isinstance(d, list) for d in docs):
        return [x for d in docs for x in d]
    return docs[0]


def children(repo, number):
    return gh(f"repos/{repo}/issues/{number}/sub_issues") or []


def detail(repo, number):
    d = gh(f"repos/{repo}/issues/{number}")
    if not d:
        return None
    s = d.get("issue_dependencies_summary") or {}
    return {
        "number": d["number"],
        "title": d["title"],
        "state": d["state"],
        "labels": [l["name"] for l in d.get("labels", [])],
        "assignees": [a["login"] for a in d.get("assignees", [])],
        "blocked_by": s.get("blocked_by", 0),
        "author": (d.get("user") or {}).get("login", "?"),
        "url": d["html_url"],
    }


def legacy_report(trunk, patterns):
    """Long-lived branches matching `patterns` that hold commits not on origin/<trunk>."""
    if not patterns:
        return
    remote = (run(["git", "branch", "-r", "--format=%(refname:short)"]) or "").splitlines()
    hits = []
    for ref in remote:
        name = ref.removeprefix("origin/")
        if ref == name or name == "HEAD":
            continue
        if any(fnmatch.fnmatchcase(name, p) for p in patterns):
            n = run(["git", "rev-list", "--count", f"origin/{trunk}..{ref}"])
            if n and n != "0":
                hits.append((ref, n))
    print(f"\n## LONG-LIVED BRANCHES NOT ON {trunk}  (patterns: {', '.join(patterns)})")
    if not hits:
        print("  none; every matching branch is fully on the trunk")
    for ref, n in hits:
        print(f"  {ref}: {n} commit(s) not on origin/{trunk}")


def main():
    if len(sys.argv) < 2 or not sys.argv[1].lstrip("#").isdigit():
        sys.exit("usage: frontier.py <epic-number> [--repo owner/name] [--me login]")
    epic = int(sys.argv[1].lstrip("#"))
    cfg = load()
    repo, me = cfg["repo"], None
    args = sys.argv[2:]
    for i, a in enumerate(args):
        if a == "--repo" and i + 1 < len(args):
            repo = args[i + 1]
        if a == "--me" and i + 1 < len(args):
            me = args[i + 1]
    if not repo:
        sys.exit("no repo: set `repo` in .claude/workflow.json, pass --repo, or run inside a gh checkout")
    if me is None:
        me = run(["gh", "api", "user", "--jq", ".login"]) or "?"

    labels = cfg["labels"]
    ready = as_set(labels.get("ready"))
    parked = as_set(labels.get("parked"))
    spec = as_set(labels.get("spec"))
    triage = as_set(labels.get("needsTriage"))

    head = detail(repo, epic)
    if not head:
        sys.exit(f"could not read #{epic} in {repo}")
    print(f"EPIC #{epic} — {head['title']}")
    print(f"you = {me}   repo = {repo}   trunk = {cfg['trunk']}\n")

    # Tree: direct children, plus the children of any child that is a spec.
    groups = []          # (label-for-group, [issue numbers])
    plain, specs = [], []
    for c in children(repo, epic):
        if spec & {l["name"] for l in c.get("labels", [])}:
            specs.append(c)
        else:
            plain.append(c)
    if plain:
        groups.append((f"directly under epic #{epic}", [c["number"] for c in plain]))
    for s in specs:
        kids = children(repo, s["number"])
        groups.append((f"under SPEC #{s['number']} — {s['title'][:48]}",
                       [k["number"] for k in kids]))

    with ThreadPoolExecutor(max_workers=8) as pool:
        resolved = {}
        for label, nums in groups:
            resolved[label] = [d for d in pool.map(lambda n: detail(repo, n), nums) if d]

    ORDER = ["IN FLIGHT (yours)", "TAKEABLE NOW",
             "UNBLOCKED, NOT MARKED READY", "BLOCKED", "PARKED",
             "ASSIGNED TO OTHERS", "CLOSED"]
    buckets = {k: [] for k in ORDER}

    for label, items in resolved.items():
        for d in items:
            d["group"] = label
            if d["state"] != "open":
                buckets["CLOSED"].append(d)
            elif parked & set(d["labels"]):
                buckets["PARKED"].append(d)
            elif me in d["assignees"]:
                buckets["IN FLIGHT (yours)"].append(d)
            elif d["assignees"]:
                buckets["ASSIGNED TO OTHERS"].append(d)
            elif d["blocked_by"] > 0:
                buckets["BLOCKED"].append(d)
            elif ready & set(d["labels"]):
                buckets["TAKEABLE NOW"].append(d)
            else:
                # Open, unassigned, nothing blocking it, but no ready label, so it is
                # not formally grabbable. Usually means it was written but never triaged.
                buckets["UNBLOCKED, NOT MARKED READY"].append(d)

    if not groups:
        print("(no sub-issues found under this epic)\n")

    for name in [n for n in ORDER if n != "CLOSED"]:
        rows = buckets[name]
        if not rows:
            continue
        print(f"## {name}  ({len(rows)})")
        for d in sorted(rows, key=lambda x: x["number"]):
            blk = f"blocked x{d['blocked_by']}" if d["blocked_by"] else ""
            who = ",".join(d["assignees"]) or "—"
            print(f"  #{d['number']:<5} {','.join(d['labels'])[:26]:<26} "
                  f"{who:<13} {blk:<10} {d['title'][:44]}")
            print(f"         └ {d['group']}")
        print()

    print(f"## CLOSED: {len(buckets['CLOSED'])}")

    # Hygiene: tickets you wrote that still sit at the needs-triage label.
    if triage:
        mine_untriaged = [d for items in resolved.values() for d in items
                          if d["state"] == "open" and d["author"] == me
                          and triage & set(d["labels"])]
        if mine_untriaged:
            tl = ", ".join(sorted(triage))
            rl = " / ".join(sorted(ready)) or "a ready label"
            print(f"\n!! {len(mine_untriaged)} open ticket(s) you authored still carry `{tl}`: "
                  f"{', '.join('#%d' % d['number'] for d in mine_untriaged)}")
            print(f"   triage is for issues you did NOT create; these want {rl}, "
                  "or a blocker if they are waiting on something.")

    legacy_report(cfg["trunk"], cfg.get("legacyBranches") or [])


if __name__ == "__main__":
    main()
