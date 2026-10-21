#!/usr/bin/env python3
"""List a PR's UNRESOLVED review threads, with everything needed to reply and resolve.

Read-only. Prints per thread: the GraphQL thread id (for resolveReviewThread), the
first comment's REST databaseId (for the replies endpoint), location, reviewer and body.
Works for any reviewer, human or bot. Also prints each reviewer's latest review
body: reviewers file findings there too (often about code a push didn't touch, so
no thread is ever raised), and those have no thread to resolve.

Usage:  python3 threads.py [pr-number] [--repo owner/name] [--all]
        no pr-number -> infers the PR for the current branch
        --all        -> include already-resolved threads too
"""
import json
import subprocess
import sys

from workflow import load

QUERY = """
query($owner:String!,$repo:String!,$pr:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){
      title
      headRefName
      reviews(last:50){
        nodes{ url state submittedAt author{login __typename} body }
      }
      reviewThreads(first:100){
        totalCount
        nodes{
          id isResolved isOutdated path line originalLine
          comments(first:50){
            totalCount
            nodes{ databaseId url createdAt author{login __typename} body }
          }
        }
      }
    }
  }
}"""


def sh(args):
    return subprocess.run(args, capture_output=True, text=True)


def current_pr():
    r = sh(["gh", "pr", "view", "--json", "number", "--jq", ".number"])
    if r.returncode == 0 and r.stdout.strip():
        return int(r.stdout.strip())
    return None


def who(c):
    a = c.get("author") or {}
    login = a.get("login") or "ghost"
    return f"{login} (bot)" if a.get("__typename") == "Bot" else login


def main():
    repo, pr, show_all = None, None, False
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == "--repo" and i + 1 < len(args):
            repo = args[i + 1]
        elif a == "--all":
            show_all = True
        elif a.lstrip("#").isdigit():
            pr = int(a.lstrip("#"))

    repo = repo or load()["repo"]
    if not repo or "/" not in repo:
        sys.exit("no repo: set `repo` in .claude/workflow.json, pass --repo, or run inside a gh checkout")

    if pr is None:
        pr = current_pr()
        if pr is None:
            sys.exit("no PR for the current branch; pass a PR number")

    owner, name = repo.split("/", 1)
    r = sh(["gh", "api", "graphql", "-f", f"query={QUERY}",
            "-f", f"owner={owner}", "-f", f"repo={name}", "-F", f"pr={pr}"])
    if r.returncode != 0:
        sys.exit(r.stderr.strip() or "graphql call failed")
    d = json.loads(r.stdout)
    if "errors" in d:
        sys.exit(json.dumps(d["errors"], indent=2))

    p = (d.get("data") or {}).get("repository", {}).get("pullRequest")
    if not p:
        sys.exit(f"PR #{pr} not found in {repo}")
    rt = p["reviewThreads"]
    threads = rt["nodes"]
    live = [t for t in threads if show_all or not t["isResolved"]]

    print(f"PR #{pr} — {p['title']}   ({repo})")
    print(f"branch: {p['headRefName']}")
    print(f"threads: {len(threads)} total, "
          f"{sum(1 for t in threads if not t['isResolved'])} unresolved")
    if rt["totalCount"] > len(threads):
        print(f"!! only the first {len(threads)} of {rt['totalCount']} threads were read; "
              "resolve these, then run again for the rest")
    print()

    # The latest review body per reviewer that wrote one.
    latest = {}
    for rv in p["reviews"]["nodes"]:
        if rv["body"].strip():
            latest[who(rv)] = rv
    if latest:
        print("REVIEW BODIES: the latest from each reviewer. Findings here have no thread;")
        print("answer them with a PR comment.")
        for rv in latest.values():
            print("-" * 78)
            print(f"    by {who(rv)} at {rv['submittedAt']} ({rv['state']})   {rv['url']}")
            for ln in rv["body"].splitlines():
                print(f"    {ln}")
        print("-" * 78)
        print()

    if not live:
        print("No unresolved threads." + (" Read the review bodies above before calling the round done."
                                          if latest else " Done."))
        return

    for n, t in enumerate(live, 1):
        cs = t["comments"]["nodes"]
        if not cs:
            continue
        first = cs[0]
        flags = []
        if t["isResolved"]:
            flags.append("RESOLVED")
        if t["isOutdated"]:
            flags.append("OUTDATED — the line it was written against has since changed")
        line = t["line"] if t["line"] is not None else t.get("originalLine")
        loc = f"{t['path']}:{line}" if line is not None else f"{t['path']} (file-level)"
        print("=" * 78)
        print(f"[{n}] {loc}   {' | '.join(flags)}")
        print(f"    thread_id  = {t['id']}        <- resolveReviewThread")
        print(f"    comment_id = {first['databaseId']}   <- /pulls/{pr}/comments/<id>/replies")
        print(f"    url        = {first['url']}")
        print(f"    by {who(first)} at {first['createdAt']}")
        print()
        for c in cs:
            print(f"    --- {who(c)} ---")
            for ln in c["body"].splitlines():
                print(f"    {ln}")
            print()
        more = t["comments"]["totalCount"] - len(cs)
        if more > 0:
            print(f"    ... {more} more comment(s); open the url to read them\n")

    print("=" * 78)
    print(f"\n{len(live)} thread(s) to work through.")


if __name__ == "__main__":
    main()
