# Final engineering readiness report

This report records the earlier local engineering audit. For the later GitHub publication, final test rerun, and updated video evidence, see [submission verification](SUBMISSION.md).

Completed 17 October 2026. The project was improved in place; Python/FastAPI, SQLite, the separate worker, native frontend, and WebSockets were retained. No framework migration or paid service was introduced.

## 1. Problems discovered

The audit found a post-commit IPC failure could falsely mark saved data failed; broadcasts from two producers could arrive out of order; slow subscribers delayed HTTP acceptance; independent SELECTs/requests could render inconsistent financial states; a second API could disturb an existing worker; zero-delay initial responses were timing-dependent; and restored databases could leave browser cursors ahead of the event log. The frontend lacked delay presets, elapsed time, job ID, a visible simulated-date label, and adequate ledger readability/keyboard scrolling. Prior video evidence was silent and shorter than the 32-second scenario.

AUDIT.md records priorities, reasons, and verification-driven corrections, including the retained failed timing attempt and Windows byte-lock adjustment.

## 2. Exact improvements

- Notification failure cannot overwrite an already committed successful job.
- One signalled dispatcher drains durable events in order with per-client cursors; acceptance does not await subscribers.
- A single read snapshot supplies ledger, aggregates, and jobs consistently; read endpoints preserve individual contracts.
- An OS lock enforces one API owner per DB; graceful worker termination has a bounded wait and kill fallback.
- Initial `/getTrades` always returns 202; job responses are not cached. Impossible future replay cursors reconcile safely.
- A separately prefixed direct provider endpoint demonstrates delayed 200 data using the same unchanged seeded generator.
- Optional monotonic trace and browser receipt-to-DOM checkpoints produce reproducible timing evidence.
- 5/32/900-second presets, custom entry, elapsed clock, job ID, explicit simulated date, submission guards, readable ledger, accessible scroll/focus targets, and useful errors were added. Search, page and scroll survive automatic updates. Replay no longer toasts old jobs.
- Tests now start isolated browser servers automatically, inject real failures, exercise real concurrency, and preserve results/screenshots/video.

## 3. Files changed

Core: `arham/app.py`, `arham/db.py`, `arham/worker.py`, new `arham/telemetry.py`. The authoritative `arham/provider.py` generator remains unchanged.

Frontend: `static/index.html`, `static/app.js`, `static/style.css`.

Tests/setup: `tests/conftest.py`, `tests/browser.cjs`, new `tests/test_audit.py`, new `tests/run-browser.cjs`, `package.json`, `.gitignore`, optional `requirements-video.txt`. Original backend tests were retained.

Documentation/media: `README.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/VERIFICATION.md`, `docs/WALKTHROUGH.md`, new `docs/AUDIT.md`, `docs/COMPLIANCE.md`, this report, updated/new evidence under `docs/evidence/`, and new local video packaging scripts under `scripts/`.

## 4. Architecture decisions

Keep one local API/worker pair per SQLite database. Short browser requests create durable jobs; local worker delay and generation require no long HTTP call. Trades, completion state and event commit atomically. IPC signals an ordered event-log drain; WebSocket clients fetch one consistent snapshot after completion. SQLite primary keys enforce idempotence, integer paise preserves financial precision, and explicit WAL read transactions preserve consistency.

The direct provider demo can still time out behind a 30-second HTTP limit. Moving a real upstream HTTP call into a worker does not bypass its network timeout. A real exchange would need an upstream async/callback, resumable/chunked short-request protocol, or suitable approved network route. These assumptions are explicit in ARCHITECTURE.md.

## 5–7. Executed tests and actual results

- Unchanged baseline: 12 passed in 56.25 seconds.
- New fast regressions: 20 passed, 2 slow tests deselected, in 45.48 seconds.
- First full audit: 21 passed, 1 measurement failure. Stopwatch included new-client SSL context setup; corrected measurement retains the original one-second HTTP assertion.
- Corrected measurement test: 1 passed in 34.73 seconds.
- Final full backend run: **22 passed in 115.37 seconds**, zero failures/skips.
- Actual Chrome automation: **16 checks passed**, including a real 32-second pull, two tabs, reload during work, duplicate event handling, offline replay, worker failure/replacement, backend restart, and narrow/tablet layout. No uncaught exceptions, failed HTTP responses or external dashboard resources.
- Fresh clone/new environment, dependency installation with `--no-index` from local wheels: **2 real integration smoke tests passed in 6.28 seconds**; `pip check` passed.
- JavaScript syntax, Python compilation/tab checks, dependency consistency, Git whitespace, ignore patterns, tracked-file hygiene and local documentation links passed. No unconfigured lint/format tool is claimed as run.

## 8. Timed evidence

The final backend measurement accepted the GET in **17.90 ms**. Its initiating client closed immediately afterward. The worker finished transactional work after **32.100105 seconds**; both subscribers received completion by **32.178042 seconds** after initiation. Observed commit-to-receipt delays were **14.26 / 15.40 ms**. Cached reads at approximately 0, 10, 20 and 30.5 seconds took **66.13 / 15.30 / 15.26 / 31.53 ms** and retained 100 existing trades.

An independent browser run measured **569 ms** including click automation, a **32.197-second** job, and receipt-to-DOM checkpoints of **91.2 / 198.9 ms**. Browser and server clocks are kept separate. Reports are `docs/evidence/timeout-backend.json` and `timeout-browser.json`.

Independent accumulation of raw demo rows verified **624,969,894,595 paise**, or **₹624.969894595 crore**, correctly displayed as **₹624.97Cr**. This was checked against data, not assumed from a screenshot.

## 9. Remaining limits

No locally reproduced critical defect remains within the verified scope. End-to-end elapsed 900-second completion is implemented but not verified by a full wait; only its prompt acceptance is tested, while real completion runs use 32 seconds. This is a mock, one-host deployment, tested on Windows/Python 3.13/Chrome. Real BSE, production proxies, authentication, multi-host operation and load testing are outside scope. Swagger's optional viewer uses default CDN assets, though the dashboard/JSON API/OpenAPI document work locally. The prepared presentation uses disclosed synthetic narration; no personal human recording or actual company submission was made.

## 10. Exact run commands

From a clean checkout in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn arham.app:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. Tests: `.\.venv\Scripts\python.exe -m pytest -q`. Browser test setup: `npm ci`, `npx playwright install chromium`, then `npm run test:e2e`. No running server is required by the default browser runner.

## 11. Demonstration steps and artifacts

The prepared `docs/evidence/submission-walkthrough.mp4` is **103.12 seconds** with architecture/module cards and machine narration; the raw browser recording is **73.40 seconds**. The video decoded successfully with non-silent AAC audio; key frames/cards were visually reviewed. Captions and reproducible packaging scripts are included.

For a personal recording, follow WALKTHROUGH.md: explain the business constraint and diagram, show initial 5-second ingestion in two tabs, ingest a second seed with the 32-second preset while searching/page 2 remains usable, show automatic completion after 30 seconds, repeat the seed to prove duplicates, walk through API/worker/provider/DB code, then show actual tests and boundaries. Keep the real timed wait uncut when presenting it as evidence. Review the recording before sending it.

## 12. Git and submission state

Implementation/evidence commit: **`7e779c6`**, based on **`4a0742f`**. Clean-clone tests target that implementation commit; the follow-up documentation commit records their result. The final Git HEAD and clean-status result are reported in the chat handoff to avoid embedding a self-referential commit hash in this file.

Runtime databases, sidecars, process locks, virtual environments, browser caches, logs, and local secrets are ignored. No remote was configured or pushed, no hosting was published, and no company email was sent.

## 13. Requirement statuses and evaluator conclusion

COMPLIANCE.md gives each assessment/audit criterion one of the requested statuses: **Verified**, **Implemented but not verified**, **Not implemented**, or **Not applicable**. Core local functionality, recovery, integrity, real-time updates, UI controls, tests, architecture and prepared video are Verified. A full elapsed 900-second run is Implemented but not verified. Personal human narration and remote submission are Not implemented. Production exchange/multi-host work is Not applicable to the local mock assessment.

Engineering evaluation: requirements have explicit evidence and a documented async interpretation; request lifetime is separated correctly from processing; events and snapshots preserve data integrity; failure/reconnect/restart paths are exercised; the UI remains faithful and usable; reproducibility was checked from a fresh clone; and the repository contains reviewable delivery artifacts. Submission remains a user action. No official score or selection guarantee is asserted.
