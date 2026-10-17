"""Opt-in local audit evidence; telemetry failure must never fail ingestion."""
import json
import logging
import os
import time
from pathlib import Path

from arham.db import now


def trace(stage, job_id=None, **fields):
    stamp = time.monotonic()
    target = os.getenv("ARHAM_TRACE")
    if target:
        record = {"stage": stage, "job_id": job_id, "monotonic": stamp,
                  "utc": now(), "pid": os.getpid(), **fields}
        try:
            Path(target).parent.mkdir(parents=True, exist_ok=True)
            # One append write per record; API and worker share the local OS clock.
            fd = os.open(target, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
            try:
                os.write(fd, (json.dumps(record) + "\n").encode())
            finally:
                os.close(fd)
        except OSError:
            logging.getLogger("arham").exception("Cannot write optional audit trace")
    return stamp
