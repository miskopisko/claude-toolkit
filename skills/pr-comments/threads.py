#!/usr/bin/env python3
"""List a PR's UNRESOLVED review threads, with everything needed to reply and resolve.

Read-only. Prints per thread: the GraphQL thread id (for resolveReviewThread), the
first comment's REST databaseId (for the replies endpoint), location, reviewer and body.
Works for any reviewer, human or bot. Also prints each reviewer's latest review
body: reviewers file findings there too (often about code a push didn't touch, so
no thread is ever raised), and those have no thread to resolve. A reviewer's later
verdict replaces their earlier body (an approval with no body clears an old "changes
requested"), and a body is flagged when it predates the last commit or the PR's
author has commented since.

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
      author{login}
      commits(last:1){ nodes{ commit{ committedDate } } }
      comments(last:100){ nodes{ url createdAt author{login} } }
      reviews(last:100){
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


def current_pr(repo):
    # With --repo, gh needs the PR named, so name it by the current branch.
    branch = sh(["git", "branch", "--show-current"]).stdout.strip()
    if not branch:
        return None
    r = sh(["gh", "pr", "view", branch, "--repo", repo, "--json", "number", "--jq", ".number"])
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
        pr = current_pr(repo)
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

    # Each reviewer's latest review, over all of them, so a later verdict replaces an
    # earlier body: an approval with no body clears an old "changes requested". An empty
    # COMMENTED review is only the wrapper of a thread reply, not a verdict, so it doesn't
    # count; nor do pending drafts. Reviews come oldest first.
    newest = {}
    for rv in p["reviews"]["nodes"]:
        if rv["state"] == "PENDING" or (rv["state"] == "COMMENTED" and not rv["body"].strip()):
            continue
        newest[who(rv)] = rv
    latest = [rv for rv in newest.values() if rv["state"] != "DISMISSED" and rv["body"].strip()]
    last_commit = ((p["commits"]["nodes"] or [{}])[0].get("commit") or {}).get("committedDate")
    pr_author = (p.get("author") or {}).get("login")
    if latest:
        print("REVIEW BODIES: the latest from each reviewer. Findings here have no thread;")
        print("answer them with a PR comment, unless they are already answered there.")
        for rv in latest:
            print("-" * 78)
            print(f"    by {who(rv)} at {rv['submittedAt']} ({rv['state']})   {rv['url']}")
            # ISO-8601 UTC timestamps from GitHub compare correctly as strings.
            if last_commit and rv["submittedAt"] < last_commit:
                print(f"    !! written before the last commit ({last_commit}); some of it may be fixed already")
            since = [c for c in p["comments"]["nodes"]
                     if (c.get("author") or {}).get("login") == pr_author and c["createdAt"] > rv["submittedAt"]]
            if since:
                print(f"    !! {pr_author} has commented on the PR since ({len(since)}); "
                      f"check it isn't already answered: {since[-1]['url']}")
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
