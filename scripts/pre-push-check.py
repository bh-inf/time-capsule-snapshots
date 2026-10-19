#!/usr/bin/env python3
"""Reject conflict markers, unmerged paths, and unparsable archive JSON before push."""

import json
import os
import subprocess
import sys

MARKERS = ("<<<<<<<", ">>>>>>>")


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(1)


def main() -> None:
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    archive = os.path.join(root, "v1")
    if not os.path.isdir(archive):
        fail("v1/ is missing")
    for dirpath, _, filenames in os.walk(archive):
        for name in filenames:
            path = os.path.join(dirpath, name)
            if os.path.islink(path):
                fail(f"refusing symlink {path}")
            with open(path, encoding="utf-8", errors="replace") as handle:
                if name.endswith(".json"):
                    handle.seek(0)
                    try:
                        json.load(handle)
                    except json.JSONDecodeError as error:
                        fail(f"invalid json {path}: {error}")
                    handle.seek(0)
                for line in handle:
                    stripped = line.strip()
                    if stripped.startswith(MARKERS) or stripped == "=======":
                        fail(f"conflict marker in {path}")
    if os.path.isdir(os.path.join(root, ".git")):
        result = subprocess.run(
            ["git", "ls-files", "-u"],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            fail(result.stderr.strip() or "git ls-files failed")
        if result.stdout.strip():
            fail("unmerged files:\n" + result.stdout)


if __name__ == "__main__":
    main()
