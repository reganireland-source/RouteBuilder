import json
import os
from pathlib import Path

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL")
DATA_DIR = Path(__file__).parent.parent / "data"

# Each entry: (table_name, json_filename, primary_key_field)
_TABLES = [
    ("nodes",    "nodes.json",    "id"),
    ("systems",  "systems.json",  "id"),
    ("segments", "segments.json", "id"),
    ("capacity", "capacity.json", "segment_id"),
    ("outages",  "outages.json",  "fault_id"),
    ("rules",    "rules.json",    "node_id"),
]

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS nodes    (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS systems  (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS segments (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS capacity (segment_id  TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS outages  (fault_id    TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS rules    (node_id     TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS config   (key         TEXT PRIMARY KEY, value JSONB NOT NULL);
"""


def get_conn() -> psycopg2.extensions.connection:
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def init_db() -> None:
    """Create tables (if missing) and seed from JSON files on first run."""
    if not DATABASE_URL:
        return
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(_CREATE_SQL)
        conn.commit()
        _seed_if_empty(conn)
    finally:
        conn.close()


def _seed_if_empty(conn) -> None:
    """Populate each table from the committed JSON files if the table is empty."""
    with conn.cursor() as cur:
        for table, filename, pk in _TABLES:
            cur.execute(f"SELECT COUNT(*) AS n FROM {table}")
            if cur.fetchone()["n"] > 0:
                continue
            path = DATA_DIR / filename
            if not path.exists():
                continue
            items = json.loads(path.read_text())
            if items:
                psycopg2.extras.execute_values(
                    cur,
                    f"INSERT INTO {table} ({pk}, data) VALUES %s ON CONFLICT DO NOTHING",
                    [(item[pk], json.dumps(item)) for item in items],
                )

        # Config is a single dict stored under key "main"
        cur.execute("SELECT COUNT(*) AS n FROM config")
        if cur.fetchone()["n"] == 0:
            path = DATA_DIR / "config.json"
            cfg = json.loads(path.read_text()) if path.exists() else {"on_net_ownership": ["owned", "consortium", "iru"]}
            cur.execute(
                "INSERT INTO config (key, value) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                ("main", json.dumps(cfg)),
            )

    conn.commit()
