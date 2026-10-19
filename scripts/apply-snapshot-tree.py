#!/usr/bin/env python3
"""Copy a collect artifact into the archive tree without rewriting history."""

import json
import os
import re
import sys

DATE_FILE = re.compile(r"^v1/[A-Z]{2}/[0-9]{4}/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$")
INDEX_FILE = re.compile(r"^v1/[A-Z]{2}/index\.json$")


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(1)


def walk(root: str) -> list[str]:
    found: list[str] = []
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            found.append(rel)
    return found


def read(path: str) -> bytes:
    if os.path.islink(path):
        fail(f"refusing symlink {path}")
    with open(path, "rb") as handle:
        return handle.read()


def exclusive_write(path: str, body: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o644)
    with os.fdopen(fd, "wb") as handle:
        handle.write(body)


def merge_index(existing: dict, incoming: dict) -> dict:
    region = incoming.get("region") or existing.get("region")
    dates = sorted(set(existing.get("dates") or []) | set(incoming.get("dates") or []))
    return {
        "schema_version": 1,
        "region": region,
        "dates": dates,
        "latest": dates[-1] if dates else None,
    }


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: apply-snapshot-tree.py SOURCE_DIR DEST_ROOT")
    source_root, dest_root = sys.argv[1], sys.argv[2]
    files = walk(source_root)
    if not files:
        fail("snapshot artifact is empty")
    for rel in files:
        if not (DATE_FILE.match(rel) or INDEX_FILE.match(rel)):
            fail(f"artifact contains an unexpected path {rel}")
        source = os.path.join(source_root, rel)
        dest = os.path.join(dest_root, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        body = read(source)
        if DATE_FILE.match(rel):
            text = body.decode("utf-8")
            for line in text.splitlines():
                stripped = line.strip()
                if stripped.startswith("<<<<<<<") or stripped.startswith(">>>>>>>") or stripped == "=======":
                    fail(f"conflict marker in {rel}")
            try:
                json.loads(text)
            except json.JSONDecodeError as error:
                fail(f"invalid json {rel}: {error}")
            if os.path.lexists(dest):
                current = read(dest)
                if current != body:
                    fail(f"refusing to modify archived date file {rel}")
                continue
            exclusive_write(dest, body)
            continue
        incoming = json.loads(body)
        existing: dict = {"dates": [], "region": incoming.get("region"), "schema_version": 1}
        if os.path.lexists(dest):
            existing = json.loads(read(dest))
        merged = json.dumps(merge_index(existing, incoming), ensure_ascii=False, indent=2) + "\n"
        temp = dest + ".tmp"
        if os.path.lexists(temp):
            if os.path.islink(temp):
                fail(f"refusing symlink {temp}")
            os.remove(temp)
        with open(temp, "w", encoding="utf-8") as handle:
            handle.write(merged)
        os.replace(temp, dest)


if __name__ == "__main__":
    main()
