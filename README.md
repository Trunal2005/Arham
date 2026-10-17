# Arham Trade Desk

A local trade dashboard for the Arham Fintech Software Engineer assessment. It stays usable during a long exchange pull and updates connected dashboards automatically when trades are committed.

**No paid services, API keys, credit card, cloud account, Redis, Docker, or frontend build are required.** Python, FastAPI, SQLite, the browser, and the worker run on your own machine. Once dependencies are installed, the application works offline. Your existing computer, electricity, and internet connection are outside the software's zero-service-cost claim.

## Run on Windows

Requires Python 3.11 or newer (verified with Python 3.13) and a modern browser.

```powershell
cd 'C:\Internship Task\Arham'
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn arham.app:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**. API documentation is at **http://127.0.0.1:8000/docs**. `./run.ps1` is a convenience launcher after setup. Production-only dependencies are in `requirements.txt`; development dependencies add the test runner and HTTP client.

The dashboard and JSON API run without internet once dependencies are installed. The optional Swagger `/docs` viewer uses its default CDN assets; the offline OpenAPI document is always available at `/openapi.json`.

On macOS/Linux, use `python3 -m venv .venv` and substitute `.venv/bin/python` for `.\.venv\Scripts\python.exe`.

## Try the assessment scenario

1. Open the dashboard in two browser tabs. The initial ledger is empty; the mock never inserts fake UI-only records.
2. Choose **Pull exchange data**. Start with 3,000 records, seed 42, and a 5-second delay.
3. The request returns `202 Accepted` immediately. The dashboard remains available while the separate worker runs.
4. Both open tabs receive the committed completion event over WebSocket and fetch the updated snapshot. No reload, polling interval, or scheduler is involved.
5. Start another pull with seed 43. Search and paginate the saved trades while the pull runs. New trades arrive automatically.
6. Repeat the same seed and record count to verify duplicates are skipped.
7. Enter **900** seconds for the full 15-minute mock delay. No HTTP connection is held open during this wait. Existing rows remain available throughout.
8. Stop and restart the server during a pull. The durable queued/running job is resumed from the beginning; its trade IDs prevent duplicates. Previously committed data survives.

Prices are integer paise in SQLite; displayed amounts use INR. Timestamps are stored in UTC and displayed in IST. Trade generation is deterministic, including a fixed example exchange date of 1 January 2026; timestamps are mock execution times, not the time you clicked Pull. Pull activity records actual request/completion times.

## HTTP and WebSocket contracts

| Route | Behavior |
|---|---|
| `GET /getTrades?delay_seconds=5&record_count=3000&seed=42` | Start the mock exchange pull; returns `202`, a job ID and a `Location` result URL immediately. |
| `GET /getTrades?job_id=<id>` | Returns `202` while processing; after completion returns `200` with the seeded trade data. |
| `POST /api/pulls` | Alternative explicit ingestion command; JSON parameters are `delay_seconds`, `record_count`, `seed`. Same worker/provider path as the dashboard's `/getTrades` call. |
| `GET /api/pulls` | Recent 20 pulls, with statuses, row counts, and failures. |
| `GET /api/pulls/<id>` | Durable status for one pull; also returned as the POST response's `Location`. |
| `GET /api/trades?limit=50&offset=0&search=RELIANCE` | Immediately read committed cached trades; case-insensitive symbol/client/ID search. |
| `GET /api/summary` | Trade, quantity, value, client, and per-symbol aggregates. |
| `GET /api/dashboard?limit=50&offset=0&search=RELIANCE` | Consistent trade page, summary and recent jobs from one SQLite read snapshot; used by the dashboard. |
| `GET /mock-bse/getTrades?delay_seconds=0&record_count=3000&seed=42` | Independent literal provider demonstration: wait, then return 200 seeded records without ingesting them. A long direct HTTP wait is subject to the network cutoff. |
| `GET /api/health` | Database connectivity and worker liveness (`503` if degraded). |
| `WS /ws?after=<event_id>` | Replay missed durable events, send `connected`, then push live events. |

`delay_seconds` accepts 0–900, `record_count` 1–10,000, and `seed` 0–2,147,483,647. Concurrent pulls return `409` with the existing job ID. Invalid inputs return `422`. Unknown job IDs return `404`. Ingestion failures become visible `failed` jobs and WebSocket events; the transaction rolls back all rows from that batch.

**Why `/getTrades` is asynchronous:** a synchronous 15-minute `GET` cannot succeed through a network that terminates HTTP at 30 seconds. The dashboard consumes `/getTrades` using a fast accept/result protocol. The original endpoint name and seeded trade response are preserved, while the long computation runs inside the worker process. The browser never repeatedly calls the status URL: it waits for WebSocket completion, then reads the committed ledger. This is a design interpretation of the assessment, rather than a claim that a synchronous long HTTP connection can survive the stated limit.

Events have `{id, type, payload, created_at}`. Types are `pull.queued`, `pull.started`, `pull.completed`, and `pull.failed`. A completion payload contains `job_id` and `inserted_count`. Clients track monotonic event IDs, ignore duplicates, and reconnect with their last cursor. Replay registration is protected against a gap between history and live subscription. A completion is published only after SQLite commits the trades and event together.

One dispatcher drains durable events in ID order when signalled by API/worker activity. It tracks each subscriber's cursor, so a new command cannot overtake an earlier completion. Slow WebSocket sends never hold up HTTP acceptance. Replay reconciles the current snapshot once instead of producing historical completion toasts. The active-job timer is a local display using `performance.now()`, not a status-fetch loop; it displays elapsed time without claiming a completion percentage.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

This starts real API/worker subprocesses with isolated temporary databases, including **two real 32-second** ingestion tests proving the operation outlives the HTTP connection limit. Allow about two minutes. For the fast subset:

```powershell
.\.venv\Scripts\python.exe -m pytest -q -m 'not slow'
```

Tests cover two-subscriber WebSocket completion, a closed initiating HTTP client, measured cached reads throughout ingestion, ordered events, duplicate prevention, a new seed, search/pagination, validation, replay after reconnect, recovery after process-tree termination, transactional rollback, slow subscribers, true concurrent requests, broken post-commit IPC, and the 900-second configuration returning immediately. The suite does not wait a full 900 seconds; its real elapsed-time tests use 32 seconds.

Optional browser verification needs Node.js and free Playwright:

```powershell
npm ci
npx playwright install chromium
npm run test:e2e
```

The runner creates a fresh database on a free localhost port and owns/cleans up only its test server process tree. It verifies the real 32-second flow, two tabs, reload during work, offline replay, worker crash, server restart, and mobile/tablet layout. Allow about 90 seconds. To use installed Chrome instead of downloaded Chromium, set `BROWSER_EXECUTABLE` to its executable path and run `npx playwright install ffmpeg` for recording. `PYTHON_EXECUTABLE` can select another Python environment. An optional `BASE_URL` uses your own empty test server and skips process-control checks.

Screenshots, raw UI recording, and JSON results are under `docs/evidence/`. [Verification notes](docs/VERIFICATION.md) distinguish all actual measurements from configuration-only checks. To reproduce server timing logs manually:

```powershell
$env:ARHAM_TRACE = "$PWD\test-results\manual-trace.jsonl"
.\.venv\Scripts\python.exe -m uvicorn arham.app:app --host 127.0.0.1 --port 8000
```

The optional trace is disabled by default. It records local monotonic timestamps and UTC context; telemetry write failure is logged without failing ingestion. Monotonic values are comparable only within the same OS clock domain/boot. Browser receipt-to-DOM checkpoints use `performance.now()` inside each document and are never subtracted from server clock values.

The [walkthrough guide](docs/WALKTHROUGH.md) includes the actual narrated MP4, raw recording, captions, and commands for reproducing or recording your own presentation. Video packaging uses an optional free dependency and Windows' local synthetic voice; none is required by the application.

## Repository guide

```text
arham/app.py        API, WebSocket hub, durable job creation, IPC bridge
arham/worker.py     Separate worker: blocking IPC, delay, atomic ingestion
arham/provider.py   Seeded mock BSE data generator
arham/db.py         SQLite schema, events, transaction helpers
arham/telemetry.py  Optional local monotonic audit trace
static/            Responsive dashboard; no npm build or CDN
tests/             Real process/API/WebSocket and browser checks
docs/              Architecture, implementation plan, walkthrough, evidence
```

See [architecture](docs/ARCHITECTURE.md), [audit findings](docs/AUDIT.md), [assessment compliance](docs/COMPLIANCE.md), [implementation plan](docs/IMPLEMENTATION_PLAN.md), and [walkthrough guide](docs/WALKTHROUGH.md).

## Operating boundaries

- Run **one API process** per database. It owns one worker and the WebSocket hub. An OS-held lock rejects a second process against the same database and releases automatically on process exit. Do not pass `--workers`. Multiple local deployments use distinct `ARHAM_DB` paths and ports.
- SQLite lives in `data/trades.sqlite3` by default, ignored by Git. Set `ARHAM_DB` to change it. Keep its WAL/SHM sidecars with the database when managing backups; stop the server before copying it.
- The worker sleeps locally to model upstream computation. A real exchange adapter would need an asynchronous job/callback protocol or resumable short requests. This project does not connect to real BSE or provide production brokerage integration.
- The worker executes one pull at a time. Unexpected worker exits fail active jobs visibly; starting another pull restarts the worker. A server restart replays interrupted work, resetting its delay. There is no distributed queue, multi-host deployment, login, or public hosting.
- Bind to `127.0.0.1` as shown. Authentication, TLS, tenant isolation, rate limiting, and bounded audit retention would be needed before exposing a real financial service publicly.
- Network devices can also have separate WebSocket policies. Reconnect and durable replay handle disconnections; a deployment proxy must allow WebSocket upgrades. Only HTTP requests are subject to the assessment's stated 30-second cutoff.
- The raw recording and machine-narrated presentation are local review artifacts. No email is sent and no GitHub repository is published automatically. The local Git repository, README, architecture diagram, tests, and video are prepared for review/submission; selection is not guaranteed.
