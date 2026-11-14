#!/usr/bin/env python3
"""Check the final newline of staged text without modifying the working tree."""

import subprocess
import sys


def git(*args):
    return subprocess.check_output(("git", *args))


def main():
    paths = git("diff", "--cached", "--name-only", "-z", "--diff-filter=ACM").split(b"\0")
    missing = []
    for path in filter(None, paths):
        name = path.decode("utf-8", "surrogateescape")
        content = git("show", ":" + name)
        if b"\0" not in content and content and not content.endswith(b"\n"):
            missing.append(name)
    if missing:
        print("Staged files need a final newline: " + ", ".join(missing), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
