#!/usr/bin/env python3
"""
Export current Postgres state back to the JSON seed files.

Run this periodically to keep data/segments.json, data/nodes.json etc.
in sync with what's actually in the database — including user-entered data
and any waypoints / edits made through the UI that aren't in migrations.

Usage:
    DATABASE_URL=postgresql://... python dump_postgres_to_json.py

The script also adds an on-demand admin API endpoint /api/admin/dump-to-json
so it can be triggered remotely without SSH access (requires ADMIN_KEY).
"""

import json
import os
import sys
from pathlib import Path

DATA = Path(__file__).parent / "data"

TABLES = [
    ("nodes",    "nodes.json"),
    ("systems",  "systems.json"),
    ("segments", "segments.json"),
    ("capacity", "capacity.json"),
    ("outages",  "outages.json"),
    ("rules",    "rules.json"),
]


def dump():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL is not set.", file=sys.stderr)
        sys.exit(1)

    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        print("ERROR: psycopg2 not installed. Run: pip install psycopg2-binary", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(database_url, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        for table, filename in TABLES:
            with conn.cursor() as cur:
                try:
                    cur.execute(f"SELECT data FROM {table} ORDER BY 1")
                    rows = [row["data"] for row in cur.fetchall()]
                except Exception as e:
                    print(f"  SKIP  {table}: {e}")
                    continue

            dest = DATA / filename
            with open(dest, "w") as f:
                json.dump(rows, f, indent=2)
            print(f"  OK    {table} → {filename}  ({len(rows)} rows)")
    finally:
        conn.close()

    print(f"\nDump complete. JSON files updated in {DATA}/")


if __name__ == "__main__":
    dump()
