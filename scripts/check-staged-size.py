#!/usr/bin/env python3
"""Reject staged regular files larger than 5 MiB without reading their contents."""

import subprocess
import sys

MAX_BYTES = 5 * 1024 * 1024


def git(*args):
    return subprocess.check_output(("git", *args))


def main():
    paths = git("diff", "--cached", "--name-only", "-z", "--diff-filter=ACM").split(b"\0")
    oversized = []
    for path in filter(None, paths):
        name = path.decode("utf-8", "surrogateescape")
        entry = git("ls-files", "--stage", "-z", "--", name)
        if not entry.startswith(b"100"):
            continue
        size = int(git("cat-file", "-s", ":" + name))
        if size > MAX_BYTES:
            oversized.append(name)
    if oversized:
        print("Staged files exceed 5 MiB: " + ", ".join(oversized), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
