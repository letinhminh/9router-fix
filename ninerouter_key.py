#!/usr/bin/env python3
"""Print the active 9Router API key.

WAL-safe: tries a read-only connection first; if that fails (SQLite cannot open a
WAL database read-only without writing sidecars), it copies the DB (+ -wal/-shm)
to a temp dir and reads the copy, so the live database is never touched.
"""
import os
import shutil
import sqlite3
import sys
import tempfile

DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(os.path.expanduser("~"), ".9router")
DB = os.path.join(DATA_DIR, "db", "data.sqlite")
SQL = "SELECT key FROM apiKeys WHERE isActive=1 ORDER BY createdAt DESC LIMIT 1"


def _query(path, uri=False):
    con = sqlite3.connect(path, uri=True) if uri else sqlite3.connect(path)
    try:
        row = con.execute(SQL).fetchone()
        return row[0] if row else None
    finally:
        con.close()


def main():
    if not os.path.exists(DB):
        sys.exit(1)
    try:
        key = _query(f"file:{DB}?mode=ro", uri=True)
        if key:
            print(key)
            return
    except sqlite3.Error:
        pass
    tmp = tempfile.mkdtemp(prefix="9rkey-")
    try:
        for suffix in ("", "-wal", "-shm"):
            src = DB + suffix
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(tmp, "data.sqlite" + suffix))
        key = _query(os.path.join(tmp, "data.sqlite"))
        if key:
            print(key)
            return
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1)


if __name__ == "__main__":
    main()
