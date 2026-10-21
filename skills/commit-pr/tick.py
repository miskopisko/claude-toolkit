#!/usr/bin/env python3
"""Tick a ticket's acceptance criteria in its issue body — the ones /gate reported as met.

Writes to the tracker (not with --list). The repo comes from the workflow config, or --repo.
The criteria are the `- [ ]` boxes under the first heading that mentions
"acceptance", down to the next heading as high or higher: the same rule the desk plugin counts by.
Only the box characters change; every other byte of the body is left as it was. Idempotent: a box
already ticked stays ticked, and the body is only rewritten when something changed.

Usage:  python3 tick.py <ticket> <criterion>... | --all  [--list] [--repo owner/name]
        <criterion> is a 1-based position under the heading, as --list prints them.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

from workflow import load

HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
CHECKBOX = re.compile(r"^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$")


def run(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"failed: {' '.join(cmd)}\n{r.stderr.strip()}")
    return r.stdout


def criteria_lines(lines):
    """Indexes into lines of the boxes under the acceptance heading."""
    found, level, under = [], None, False
    for i, line in enumerate(lines):
        heading = HEADING.match(line)
        if heading:
            depth = len(heading.group(1))
            if under and level is not None and depth <= level:
                under = False
            if level is None and re.search("acceptance", heading.group(2), re.I):
                level, under = depth, True
            continue
        if under and CHECKBOX.match(line):
            found.append(i)
    return found


def main():
    args = sys.argv[1:]
    usage = "usage: tick.py <ticket> <criterion>... | --all  [--list] [--repo owner/name]"
    repo = None
    if "--repo" in args:
        i = args.index("--repo")
        if i + 1 >= len(args):
            sys.exit(usage)
        repo = args[i + 1]
        del args[i:i + 2]
    listing = "--list" in args
    tick_all = "--all" in args
    rest = [a for a in args if a not in ("--list", "--all")]
    if not rest or not rest[0].lstrip("#").isdigit() or not all(a.isdigit() for a in rest[1:]):
        sys.exit(usage)
    n, picks = int(rest[0].lstrip("#")), [int(a) for a in rest[1:]]
    repo = repo or load()["repo"]
    if not repo:
        sys.exit("⛔ no repo: set `repo` in the workflow config or pass --repo")

    body = json.loads(run("gh", "issue", "view", str(n), "--repo", repo, "--json", "body"))["body"]
    # Split keeping each line's own ending, so CRLF bodies survive the round trip.
    lines = body.splitlines(keepends=True)
    boxes = criteria_lines([l.rstrip("\r\n") for l in lines])
    if not boxes:
        sys.exit(f"⛔ #{n} has no checkboxes under an acceptance-criteria heading")

    if listing or (not picks and not tick_all):
        for k, i in enumerate(boxes, 1):
            m = CHECKBOX.match(lines[i].rstrip("\r\n"))
            print(f"  {k}. [{'x' if m.group(2) != ' ' else ' '}] {m.group(4)}")
        return

    wanted = range(1, len(boxes) + 1) if tick_all else picks
    bad = [p for p in wanted if not 1 <= p <= len(boxes)]
    if bad:
        sys.exit(f"⛔ #{n} has {len(boxes)} criteria; no criterion {', '.join(map(str, bad))}")

    changed = 0
    for p in wanted:
        i = boxes[p - 1]
        text = lines[i].rstrip("\r\n")
        ending = lines[i][len(text):]
        m = CHECKBOX.match(text)
        if m.group(2) == " ":
            lines[i] = f"{m.group(1)}x{m.group(3)}{m.group(4)}{ending}"
            changed += 1

    if changed:
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
            f.write("".join(lines))
        try:
            run("gh", "issue", "edit", str(n), "--repo", repo, "--body-file", f.name)
        finally:
            os.unlink(f.name)

    done = sum(CHECKBOX.match(lines[i].rstrip("\r\n")).group(2) != " " for i in boxes)
    print(f"#{n}: ticked {changed} more; acceptance criteria {done} of {len(boxes)} ticked")


if __name__ == "__main__":
    main()
