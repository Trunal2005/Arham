# Verification record

Audit verified locally on **17 October 2026 (IST)**. This is engineering evidence, not an official company evaluation. No paid account, real exchange, or hosted service was used.

## Actual runs

| Run | Result |
|---|---|
| Unchanged baseline `4a0742f` | 12 passed in 56.25 seconds |
| Audit fast suite | 20 passed, 2 slow tests deselected in 45.48 seconds |
| First full audit run | 21 passed, 1 failed: a measurement included HTTP-client construction; see AUDIT.md |
| Corrected measurement regression | 1 passed, 21 deselected in 34.73 seconds; original one-second assertion retained |
| Final full backend suite | **22 passed in 115.37 seconds**, no failures or skipped tests |
| Expanded Chrome browser run | **16 acceptance checks passed**, no uncaught browser exceptions, failed HTTP responses, or external resource requests |

Commands:

```powershell
.\.venv\Scripts\python.exe -m pytest -q --junitxml=test-results/backend-audit.xml
npm run test:e2e
```

[Final JUnit](evidence/backend-results.xml) and [browser results](evidence/browser-results.json) retain measured results. The browser runner owns a fresh isolated database/server, including worker-crash and backend-restart control. Tests probe server readiness and sample reads; those test harness actions are not application polling.

## Measured 32-second flow

The final [backend timing report](evidence/timeout-backend.json) records a distinct initiating HTTP client closing immediately after acceptance, with 100 existing trades available throughout the new 3,000-row pull.

| Measurement | Actual observation |
|---|---:|
| GET acceptance, excluding client-object construction | 17.90 ms |
| Worker start to finished transactional work | 32.100105 s |
| Initiation to both subscribers receiving completion | 32.178042 s |
| Observed commit completion to first subscriber receipt | 14.26 ms |
| Observed commit completion to second subscriber receipt | 15.40 ms |
| Cached reads around 0 / 10 / 20 / 30.5 seconds | 66.13 / 15.30 / 15.26 / 31.53 ms |
| Persisted count after completion | 3,100 (100 saved + 3,000 new) |

The trace includes API accepted, worker started, worker finished, commit completion observed, and successful WebSocket send milestones. Server/test elapsed times use the same OS `time.monotonic()` domain. UTC stamps are contextual, not the elapsed-time calculation. A commit stamp is observed after the commit and connection close; a send stamp means the transport accepted a frame, not a browser acknowledgment.

The independent [browser timing report](evidence/timeout-browser.json) records a 32-second job with two actual tabs. Acceptance including click automation took **569 ms**; job wall duration was **32.197 seconds**. Receipt-to-render checkpoints were **91.2 ms** and **198.9 ms** in their respective document `performance.now()` domains. No browser clock is subtracted from a server clock. A DOM checkpoint is emitted on an animation frame after applying the returned snapshot; it is not a claim to measure a monitor's physical display latency.

These are observations on this local machine, not production latency guarantees. [After-30-second screenshot](evidence/timeout-running-after-30s.png) and [completed screenshot](evidence/timeout-completed.png) accompany behavioral assertions. Search and page 2 remain selected while cached records are displayed.

## Backend coverage

The 22 tests exercise real API and worker processes, real WebSocket clients, and isolated SQLite databases. They verify:

- Empty state, seeded data, positive integer quantities/prices, UTC timestamps and deterministic IDs.
- Two subscribers, ordered queued/started/completed IDs, completion after committed writes, immediate cached reads.
- Idempotent duplicate counts, new datasets, search, stable pagination, validation and missing resources.
- Ten concurrent real HTTP requests: exactly one accepted and nine conflicts referencing that job.
- A deliberately slow subscriber cannot hold up HTTP acceptance.
- A broken post-commit IPC notification does not turn a committed job into a failure.
- Read snapshots remain consistent across concurrent commits; dashboard aggregates match independently accumulated raw rows.
- Database-trigger failure rolls back a partial batch and preserves earlier committed trades.
- Process-tree termination and restart recover an interrupted job; worker-only failure is visible and an explicit retry starts a replacement.
- OS ownership rejects a second API before it can disturb the first worker.
- Reconnect replay, current/future cursors, duplicate handling, and direct mock-provider consistency.
- The original real 32-second test plus a measured closed-client/32-second/cached-read/two-subscriber test.
- A configured 900-second job returns 202 promptly. **The suite does not wait 900 seconds and does not claim elapsed 15-minute completion.**

## Browser coverage

The [16 recorded checks](evidence/browser-results.json) cover fresh loading; no idle polling; 5/32/900 delay presets; initial modal focus; native validation; Escape and focus restoration; double-submit prevention; two-tab automatic updates; search and pagination; saved records and filter/page preservation during ingestion; exact INR totals; reload while working; the real timed 32-second job; duplicate counts and duplicate-event suppression; disconnect/replay; 390px and 1024px layouts; worker failure/retry; backend restart; and persisted state on page reload. Related assertions are grouped into 16 checks, rather than represented as separate test-runner cases.

All tested dashboard resources are local. Non-origin requests were blocked and asserted absent, demonstrating operation without an internet-backed frontend dependency. The optional Swagger UI still uses default CDN assets; the dashboard, JSON API and `/openapi.json` do not.

## Financial verification

The original demo database contains seeds 42 and 43, 6,000 unique trade IDs, total quantity **3,032,820**, and **80** unique clients. Independent Python integer accumulation from raw persisted rows matches the SQL aggregates at **624,969,894,595 paise** = **₹6,249,698,945.95** = **₹624.969894595 crore**, correctly displayed as **₹624.97Cr**. This value is not inferred from a screenshot. [Financial evidence](evidence/financial-summary.json) retains the calculation.

The dataset's execution date is intentionally simulated (1 January 2026), explicitly labeled in the ledger. Pull creation/completion timestamps are actual UTC values displayed in IST. All monetary aggregation uses integer paise; the UI converts only for formatting.

## Media and static checks

The new raw browser recording is **73.40 seconds**. A separate **103.12-second** MP4 combines this verified recording with architecture/module cards, locally synthesized narration, and sidecar captions. The synthetic voice is disclosed. Intro/outro and running/completed/mobile/tablet screenshots were visually checked; the MP4 decoded successfully with a non-silent AAC audio track (mean −21.8 dB, peak −0.2 dB). This is not a claim of human narration or company submission.

JavaScript syntax checks, Python compilation/tab checks, `pip check`, Git whitespace checks, tracked-file hygiene, and local documentation links are checked separately. There is no configured formatter/linter whose successful execution is being claimed.

## Boundaries

No real BSE API, production network appliance, multi-host deployment, public authentication or load benchmark was tested. The literal direct provider can be subject to the stated network timeout; moving the same request into a worker would not bypass that timeout. See ARCHITECTURE.md. The local Git repository and presentation artifacts are prepared for review. Nothing was pushed, published or emailed.
