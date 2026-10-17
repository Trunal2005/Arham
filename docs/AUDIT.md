# Selection readiness engineering audit

This is an internal engineering review, not an official Arham score or a prediction of selection. The audit starts from local commit `4a0742f`; its working tree was clean. All tracked backend, frontend, tests, README, architecture, implementation plan, walkthrough, and evidence files were read before source changes. The unchanged baseline passed **12 tests in 56.25 seconds**.

## Prioritized findings and corrections

| Priority | Finding in baseline | Correction / rationale |
|---|---|---|
| P1 · data integrity | A broken completion IPC write was caught by the ingestion exception handler after the trade transaction had already committed. It could incorrectly mark a successful pull failed. | Notification occurs outside the transaction failure handler. A targeted broken-pipe regression asserts saved rows and completed state remain intact. |
| P1 · event ordering | API-created queued events and worker-created completion events used separate broadcast paths. A new pull could broadcast a higher event ID before the previous completion, which a cursor-based client could then discard. | Both producers signal one ordered durable-log dispatcher. Each subscription tracks its delivered cursor. No periodic database scan was added. |
| P1 · prompt acceptance | Accepting an HTTP request awaited WebSocket broadcasting. A slow subscriber or long replay could delay job submission and the response. | Acceptance commits the job, signals the dispatcher, and sends one IPC message; it never awaits subscribers. A deliberately stalled subscriber regression checks prompt acceptance. |
| P1 · consistent financial display | SQLite SELECTs ran without an explicit read transaction, and the UI fetched summary, trades, and jobs independently. A commit between those reads could mix old counts with new rows/status. | Explicit WAL read snapshots; one dashboard snapshot endpoint renders rows, totals, and jobs together. Existing individual endpoints remain supported. |
| P1 · process ownership | One API per DB was only a README warning. A second server could requeue a job belonging to a live worker. | OS-owned database lock rejects a second API before startup mutates jobs. The OS releases the lock after a crash. |
| P2 · HTTP contract | A zero-delay initial `/getTrades` call could return 200 if the worker completed before the response was constructed. | Newly accepted commands always return 202. Result requests remain 202 while active and 200 after completion. Job/result responses use `Cache-Control: no-store`. |
| P2 · restored database cursor | A browser cursor greater than the database's latest event could suppress all subsequent live events after a DB restore. | Server clamps future cursors; connected acknowledgment reconciles the browser cursor. |
| P2 · requirement interpretation | Named `/getTrades` implements an asynchronous protocol, rather than a single delayed 200 containing trades. | Preserve that protocol. Add separately named `/mock-bse/getTrades` for literal delayed-provider demonstration, backed by the same authoritative generator. Document its network timeout limitations. |
| P2 · measurement gap | Assertions proved a 32-second test passed, but there was no durable stage-by-stage monotonic timing report or measured browser render latency. | Opt-in append-only trace records API acceptance, worker start/finish, completed DB commit, and successful WebSocket sends. Browser captures receipt-to-render durations in its own monotonic clock domain. |
| P2 · operator UX | No delay presets, elapsed time, visible job ID, or simulated trade-date label. Historical event replay could produce old completion toasts. | Add the requested controls and labels, a local monotonic elapsed clock, and replay reconciliation without historical toasts. No fake completion percentage or polling. |
| P2 · accessibility/readability | Small low-contrast ledger text, weak hover state, tiny pager controls, and no keyboard focus target for the scrolling table. | Increase text contrast/size and targets, make the ledger a named keyboard-accessible scroll region, retain modal focus on close/Escape, and preserve page/search on updates. |
| P2 · submission evidence | Existing silent 29.52-second browser recording did not demonstrate a real 32-second pull or narrate the architecture/testing explanation. | Expanded recorded browser run includes the real wait and failure recovery; a presentation script and explicit evidence limitations accompany it. See WALKTHROUGH.md for the final video artifacts. |
| P3 · repository hygiene | Ignored the default data directory but not SQLite/log/secret files created at other project-relative paths. | Add general DB, sidecar, lock, log and `.env.*` patterns. Keep useful lightweight screenshots/results/video. |

## Verification-driven adjustments

The new second-process regression first exposed a Windows-specific byte-lock behavior: reading the locked byte itself raises PermissionError before lock acquisition. Initialization now checks file size without reading the protected byte, then reports the intended ownership error. The test was retained and rerun, followed by the full suite. The 20 fast tests then passed.

The first full measured run reported 21 passed and one failed: its acceptance stopwatch included construction of a new HTTP client's SSL context, taking 1.016 seconds under concurrent browser recording. The measurement was corrected to time the actual GET inside the already-created client; the client still closes immediately afterward. The original latency assertion was retained. This is a measurement correction, not an increased timeout or a hidden/deleted test.

No functioning provider, UI framework, database engine, worker transport, or deployment stack was replaced. No cron, scheduler, paid service, authentication, extra product pages, or hosted queue was introduced.

## Remaining boundaries

- One local API/worker pair per SQLite database. OS locking now enforces this; multi-host distribution remains outside scope.
- The direct mock-provider demonstration can time out for a long delay behind a 30-second HTTP cutoff. A worker cannot defeat a real upstream cutoff. See ARCHITECTURE.md.
- Restart recovery repeats the configured mock delay; it does not pretend to resume partially elapsed computation.
- Event history and trade data are retained without automatic expiry. A bounded retention policy and production authentication/TLS are optional future deployment work, not local assessment requirements.
- 900 seconds is configured and accepted quickly in tests; elapsed end-to-end completion is exercised at 32 seconds. These are distinct claims.
- Latest measured results and all acceptance statuses are in VERIFICATION.md and COMPLIANCE.md. No repository publication, company email, or actual submission was performed.
