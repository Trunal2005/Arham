"""Separate worker process. Blocking IPC input, no polling or scheduler."""
import json
import sys
import time

from arham.db import connect, event, get_job, now
from arham.provider import generate_trades


def notify(event_id):
    print(json.dumps({"event_id": event_id}), flush=True)


def execute(path, job_id):
    job = get_job(path, job_id)
    if not job or job["status"] != "queued":
        return
    with connect(path) as db:
        db.execute("UPDATE jobs SET status='running',started_at=? WHERE id=?", (now(), job_id))
        started = event(db, "pull.started", {"job_id": job_id})
    notify(started)
    try:
        # Simulates upstream processing, without holding any HTTP connection open.
        time.sleep(job["delay_seconds"])
        with connect(path) as db:
            before = db.total_changes
            db.executemany(
                "INSERT OR IGNORE INTO trades VALUES (:trade_id,:client,:symbol,:quantity,:price_paise,:timestamp,:job_id)",
                ({**t, "job_id": job_id} for t in generate_trades(job["seed"], job["record_count"])),
            )
            inserted = db.total_changes - before
            db.execute("UPDATE jobs SET status='completed',finished_at=?,inserted_count=? WHERE id=?", (now(), inserted, job_id))
            completed = event(db, "pull.completed", {"job_id": job_id, "inserted_count": inserted})
        # Commit precedes notification: the dashboard can immediately read the rows.
        notify(completed)
    except Exception as exc:
        with connect(path) as db:
            db.execute("UPDATE jobs SET status='failed',finished_at=?,error=? WHERE id=?", (now(), str(exc), job_id))
            failed = event(db, "pull.failed", {"job_id": job_id, "error": "Ingestion failed; see job details."})
        notify(failed)


def main():
    path = sys.argv[1]
    for line in sys.stdin:
        execute(path, json.loads(line)["job_id"])


if __name__ == "__main__":
    main()
