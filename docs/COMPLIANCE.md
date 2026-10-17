# Assessment compliance

Statuses use **Verified**, **Implemented but not verified**, **Not implemented**, and **Not applicable**. These are internal engineering conclusions supported by local evidence, not official company scores.

| Requirement / audit criterion | Status | Evidence or boundary |
|---|---|---|
| A few thousand seeded records with ID/client/symbol/quantity/price/timestamp | Verified | Shared provider, 2,000/2,500/3,000-row integration cases, deterministic/positive data checks |
| GET `/getTrades` returns completed seeded data | Verified | Result URL returns 200 with records; a new command uses documented 202 acceptance |
| Literal single HTTP wait-then-200 behavior | Verified | Separately named `/mock-bse/getTrades`; not a claim that the named async route is a synchronous 15-minute response |
| Configurable delay up to 900 seconds | Verified | Input bounds, prompt 900-second acceptance, 5/32/900 UI presets |
| End-to-end elapsed 900-second completion | Implemented but not verified | Supported local delay path; actual timed tests run for 32 seconds |
| Prompt accepted HTTP response | Verified | Monotonic measurement, including a slow-subscriber regression |
| Ingestion survives initiating request/client closure | Verified | Closed HTTP client, actual 32-second completion and two WebSocket subscribers |
| Dashboard opens and reads saved trades during work | Verified | Backend samples throughout the wait, browser assertions/screenshots |
| Automatic update without manual page refresh | Verified | Two browser tabs update to committed counts; no navigation required |
| No frontend status polling, cron, or scheduler | Verified | Idle request assertions, source review; local timer only paints elapsed time |
| Separate background worker with durable jobs | Verified | Real subprocess tests, process-tree restart and worker-only failure |
| Exactly one active job / concurrency conflicts | Verified | Partial unique index, ten concurrent requests, process ownership test |
| Commit precedes completion publication | Verified | SQLite transaction structure, stage trace, query immediately after receipt |
| Idempotence and rollback preserving prior data | Verified | Duplicate tests, trigger-injected failure, broken post-commit pipe regression |
| WebSocket reconnect/replay/order/duplicate handling | Verified | API tests and actual browser disconnect/restart/injected duplicate checks |
| Consistent ledger/summary/job states | Verified | One explicit read snapshot and preservation of search/page on automatic updates |
| Financial summary and INR formatting | Verified | Independent integer accumulation and browser check of ₹624.97Cr |
| UTC persistence, IST display, simulated date label | Verified | Data assertions, explicit frontend time zone and visible ledger label |
| Accessible controls / keyboard / modal focus | Verified | Focus, validation, Escape assertions; named keyboard scroll region and visible focus styles |
| Mobile and tablet layout | Verified | Real 390px/1024px browser overflow checks and screenshots |
| Local offline operation without paid services/keys | Verified | No non-origin dashboard requests; local SQLite/worker/provider; free dependencies |
| One complete local Git repository and setup README | Verified | Sources, tests, evidence and commands; clean-clone result is recorded in VERIFICATION.md |
| Architecture note and diagram | Verified | ARCHITECTURE.md includes flow/sequence diagrams and upstream timeout analysis |
| Video walkthrough prepared | Verified | Raw behavioral recording plus disclosed machine-narrated MP4, captions and recording guide |
| Human-presented personal walkthrough | Not implemented | Machine narration is supplied; exact personal recording steps are in WALKTHROUGH.md |
| GitHub publication / company submission | Not implemented | Explicitly excluded by the audit request; no push, publication or email |
| Real BSE production integration / multi-host service | Not applicable | Assessment requests a local mock; production boundaries documented |

No remaining locally reproduced critical defect is known after the audit fixes. That is bounded by the tests and environment above; it is not a guarantee of selection or production readiness. See AUDIT.md for original findings, VERIFICATION.md for measured results, and WALKTHROUGH.md for delivery steps.
