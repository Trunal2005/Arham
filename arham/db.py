import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect(path):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def initialize(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, status TEXT NOT NULL,
                delay_seconds REAL NOT NULL, record_count INTEGER NOT NULL,
                seed INTEGER NOT NULL, created_at TEXT NOT NULL,
                started_at TEXT, finished_at TEXT, error TEXT,
                inserted_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_active_pull ON jobs((1))
                WHERE status IN ('queued','running');
            CREATE TABLE IF NOT EXISTS trades (
                trade_id TEXT PRIMARY KEY, client TEXT NOT NULL,
                symbol TEXT NOT NULL, quantity INTEGER NOT NULL,
                price_paise INTEGER NOT NULL, timestamp TEXT NOT NULL,
                job_id TEXT NOT NULL REFERENCES jobs(id)
            );
            CREATE INDEX IF NOT EXISTS trade_timestamp ON trades(timestamp DESC,trade_id);
            CREATE INDEX IF NOT EXISTS trade_job ON trades(job_id);
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
            );
        """)


def event(db, kind, payload):
    cursor = db.execute(
        "INSERT INTO events(type,payload,created_at) VALUES (?,?,?)",
        (kind, json.dumps(payload), now()),
    )
    return cursor.lastrowid


def job_dict(row):
    return dict(row) if row else None


def get_job(path, job_id):
    with connect(path) as db:
        return job_dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())


def read_events(path, after=0, limit=100):
    with connect(path) as db:
        rows = db.execute("SELECT * FROM events WHERE id>? ORDER BY id LIMIT ?", (after, limit)).fetchall()
    return [{"id": r["id"], "type": r["type"], "payload": json.loads(r["payload"]), "created_at": r["created_at"]} for r in rows]
