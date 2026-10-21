#!/usr/bin/env python3
"""Run the project's CI-equivalent checks for whatever is STAGED, and report.

The jobs come from `gate.jobs` in .claude/workflow.json (or workflow.local.json); see
the skill's README for their shape. Never stages, commits or pushes.

The jobs are shell commands from a file anyone with commit access can change, so the
gate runs only a `gate` block this checkout has trusted: its sha256 fingerprint must be
listed in `$(git rev-parse --git-path gate-trusted)`. Any change to the block, in either
config file, makes it untrusted again. `--trust` records the current block's fingerprint,
and is only for after the user has seen every command and said yes.

Usage:
  python3 gate.py            # scope from staged files
  python3 gate.py --plan     # show what would run, run nothing (works with nothing staged)
  python3 gate.py --all      # scope from all working-tree changes, not just staged
  python3 gate.py --trust    # trust the current gate block, run nothing

Exit status: 0 all ran jobs passed (or none applied), or --plan / --trust done; 1 a job
failed or nothing is staged; 2 no gate jobs are configured or the config is invalid;
3 the gate block isn't trusted yet.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from functools import lru_cache

from workflow import load, root

RULE = "=" * 72


def out(args, cwd):
    r = subprocess.run(args, capture_output=True, text=True, cwd=cwd)
    return r.stdout


def lines(args, cwd):
    return [f for f in out(args, cwd).splitlines() if f]


def changed(kind, repo):
    if kind == "staged":
        return lines(["git", "diff", "--cached", "--name-only"], repo)
    if kind == "unstaged":
        return lines(["git", "diff", "--name-only"], repo)
    return lines(["git", "ls-files", "--others", "--exclude-standard"], repo)


def skip_worktree(repo):
    # `git ls-files -v` tags skip-worktree entries with "S"; their edits never show in a diff.
    return [l[2:] for l in lines(["git", "ls-files", "-v"], repo) if l.startswith("S ")]


@lru_cache(maxsize=None)
def _regex(pattern):
    """A glob as a regex. `**` crosses directories, `*` and `?` don't. A pattern with no
    `/` matches a file name at any depth; one ending in `/` matches everything under it."""
    if pattern.endswith("/"):
        pattern += "**"
    if "/" not in pattern:
        pattern = "**/" + pattern
    pattern = pattern.lstrip("/")
    rx, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            rx, i = rx + "(?:.*/)?", i + 3
        elif pattern.startswith("**", i):
            rx, i = rx + ".*", i + 2
        elif pattern[i] == "*":
            rx, i = rx + "[^/]*", i + 1
        elif pattern[i] == "?":
            rx, i = rx + "[^/]", i + 1
        else:
            rx, i = rx + re.escape(pattern[i]), i + 1
    return re.compile(rx + r"\Z")


def matches(path, globs):
    return any(_regex(g).match(path) for g in globs)


def str_list(job, key, i):
    v = job.get(key, [])
    if not isinstance(v, list) or not all(isinstance(g, str) and g for g in v):
        sys.exit(f"gate.jobs[{i}].{key} must be a list of glob strings")
    return v


def read_jobs(cfg):
    gate = cfg.get("gate") or {}
    jobs, not_local = gate.get("jobs") or [], gate.get("notLocal") or []
    if not isinstance(jobs, list) or not isinstance(not_local, list):
        print("gate.jobs and gate.notLocal must be lists.", file=sys.stderr)
        sys.exit(2)
    if not jobs:
        print("No gate jobs configured: `gate.jobs` in .claude/workflow.json (or "
              "workflow.local.json) is empty.\nThe gate mirrors the project's CI, so it "
              "has nothing to run until that is set up.", file=sys.stderr)
        sys.exit(2)
    parsed = []
    for i, j in enumerate(jobs):
        try:
            if not isinstance(j, dict):
                sys.exit(f"gate.jobs[{i}] must be an object")
            for key in ("name", "run"):
                if not isinstance(j.get(key), str) or not j[key].strip():
                    sys.exit(f"gate.jobs[{i}].{key} must be a non-empty string")
            paths = str_list(j, "paths", i)
            if not paths:
                sys.exit(f"gate.jobs[{i}] ({j['name']}) needs at least one entry in paths")
            only_if = str_list(j, "onlyIf", i)
            cwd = j.get("cwd", ".")
            if not isinstance(cwd, str) or cwd.startswith("/") or ".." in cwd.split("/"):
                sys.exit(f"gate.jobs[{i}].cwd must be a path inside the repo, relative to its root")
            ci = j.get("ci", j["name"])
            if not isinstance(ci, str) or not ci:
                sys.exit(f"gate.jobs[{i}].ci must be a non-empty string")
        except SystemExit as e:
            print(f"invalid gate config: {e.code}", file=sys.stderr)
            sys.exit(2)
        parsed.append({"name": j["name"], "run": j["run"], "paths": paths,
                       "onlyIf": only_if, "cwd": cwd, "ci": ci})
    return parsed, [str(n) for n in not_local]


def fingerprint(gate):
    """sha256 of the effective gate block, independent of key order and whitespace."""
    blob = json.dumps(gate, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


def trust_file(repo):
    p = out(["git", "rev-parse", "--git-path", "gate-trusted"], repo).strip()
    return os.path.join(repo, p)  # an absolute p wins in join


def trusted(fp, repo):
    try:
        with open(trust_file(repo)) as f:
            return fp in (l.strip() for l in f)
    except FileNotFoundError:
        return False


def show_jobs(jobs, not_local):
    for j in jobs:
        where = "" if j["cwd"] in (".", "") else f"  (in {j['cwd']})"
        print(f"  - {j['name']}: {j['run']}{where}")
    if not_local:
        print(f"  notLocal: {', '.join(not_local)}")


def run(job, repo, results):
    print(f"\n{RULE}\n== {job['name']}\n{RULE}", flush=True)
    t0 = time.time()
    cwd = os.path.join(repo, job["cwd"])
    if not os.path.isdir(cwd):
        results.append((job, False, 0.0))
        print(f"-- FAIL (0s): {job['name']}: cwd `{job['cwd']}` is not a directory in the repo",
              flush=True)
        return False
    rc = subprocess.run(job["run"], shell=True, cwd=cwd).returncode
    dt = time.time() - t0
    results.append((job, rc == 0, dt))
    print(f"-- {'PASS' if rc == 0 else 'FAIL'} ({dt:.0f}s): {job['name']}", flush=True)
    return rc == 0


def unique(seq):
    return list(dict.fromkeys(seq))


def main():
    if not out(["git", "rev-parse", "--show-toplevel"], None).strip():
        sys.exit("not inside a git repo")
    repo = str(root())
    args = sys.argv[1:]
    unknown = [a for a in args if a not in ("--plan", "--all", "--trust")]
    if unknown:
        sys.exit(f"unknown argument {unknown[0]}\nusage: gate.py [--plan] [--all] | --trust")
    plan_only = "--plan" in args
    use_all = "--all" in args

    cfg = load()
    jobs, not_local = read_jobs(cfg)
    fp = fingerprint(cfg.get("gate"))
    is_trusted = trusted(fp, repo)

    if "--trust" in args:
        if len(args) > 1:
            sys.exit("--trust takes no other arguments")
        print("Trusting this gate block (fingerprint "
              f"{fp[:12]}) for this checkout. Its jobs:")
        show_jobs(jobs, not_local)
        if not is_trusted:
            with open(trust_file(repo), "a") as f:
                f.write(fp + "\n")
        print("\nRecorded. Nothing was run; run the gate again to use it.")
        return

    if not is_trusted and not plan_only:
        print("UNTRUSTED gate block: these shell commands come from the repo's workflow "
              "config,\nand this checkout hasn't approved them (or they changed since). "
              "Nothing was run.\n")
        show_jobs(jobs, not_local)
        print("\nShow the user every command above. Run `gate.py --trust` only after the "
              "user approves,\nthen run the gate again.")
        sys.exit(3)

    staged = changed("staged", repo)
    unstaged = changed("unstaged", repo)
    untracked = changed("untracked", repo)
    paths = sorted(set(staged + unstaged + untracked)) if use_all else staged
    if not paths and not plan_only:
        sys.exit("nothing staged: stage what you intend to commit, or pass --all")

    if plan_only:
        print(f"trust: {'trusted' if is_trusted else 'NOT trusted; `--trust` after the user approves'}"
              f" (fingerprint {fp[:12]})")
        print("\nall configured jobs:")
        show_jobs(jobs, not_local)
        print()
    print(f"scope: {'all working-tree changes' if use_all else 'staged only'} "
          f"({len(paths)} file(s))")
    if not paths:
        print("  nothing staged: a real run would refuse until something is staged (or --all)")

    # The jobs read the working tree, not the index. Anything unstaged in a tested area
    # means the gate is checking something slightly different from the commit.
    tested = unique(g for j in jobs for g in j["paths"])
    if not use_all:
        drift = [f for f in unstaged + untracked if matches(f, tested)]
        if drift:
            print("\nWARNING: UNSTAGED/UNTRACKED changes in tested areas. The test run reflects")
            print("    the working tree, NOT the staged snapshot. These are in play:")
            for f in unique(drift):
                print(f"      {f}")
            print("    If any belong to another session's work, keep them out of the commit.")
    hidden = [f for f in skip_worktree(repo) if matches(f, tested)]
    if hidden:
        print("\nnote: skip-worktree files in tested areas. Local edits to these never show")
        print("      as changes, but the jobs run against them:")
        for f in hidden:
            print(f"      {f}")

    selected, skipped_only_if = [], []
    for j in jobs:
        if not any(matches(p, j["paths"]) for p in paths):
            continue
        if j["onlyIf"] and not any(matches(p, j["onlyIf"]) for p in paths):
            skipped_only_if.append(j)
            continue
        selected.append(j)

    for j in skipped_only_if:
        print(f"\nnote: skipping `{j['name']}`: none of {', '.join(j['onlyIf'])} changed.")
        print("      CI may still run it; run it by hand if you suspect drift.")

    print(f"\n{len(selected)} job(s) to run:")
    show_jobs(selected, [])
    if not selected:
        print("  (none: no configured job covers these paths)" if paths
              else "  (none: nothing in scope)")

    if plan_only:
        print("\n--plan: nothing executed.")
        return

    results = []
    for j in selected:
        if not run(j, repo, results):
            print("\nStopping at first failure.", flush=True)
            break

    print(f"\n{RULE}\nSUMMARY\n{RULE}")
    for j, ok, dt in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {dt:6.0f}s  {j['name']}")
    if not results:
        print("  nothing ran")
    failed = [j["name"] for j, ok, _ in results if not ok]
    unreached = len(selected) - len(results)
    if unreached:
        print(f"  ...{unreached} job(s) not reached")

    if not_local:
        print(f"\nNOT RUN LOCALLY: {', '.join(not_local)}. This is not full CI parity: "
              "say so when reporting.")

    if failed:
        print(f"\nFAILED: {', '.join(failed)}")
        sys.exit(1)
    if not results:
        print("\nNo job applied to these paths, so nothing was verified. No trailer.")
        return

    ran = ", ".join(unique(j["ci"] for j, _, _ in results))
    tail = f"; {', '.join(not_local)} not run locally" if not_local else ""
    print("\nAll green. Draft trailer for the commit:")
    print(f"\n  Verified: {len(results)} local CI job(s) pass ({ran}){tail}.")


if __name__ == "__main__":
    main()
