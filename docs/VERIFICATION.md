# Verification record

Verified locally on **17 October 2026 (IST)** with Python 3.13, a clean project virtual environment, SQLite, FastAPI/Uvicorn, and Chrome driven by Playwright. No external exchange, cloud service, or paid account was involved.

## Backend: 12 passed

Command:

```powershell
.\.venv\Scripts\python.exe -m pytest -q --junitxml=test-results/backend.xml
```

Final full run: **12 passed in 62.47 seconds**, zero skipped tests or failures. The retained [JUnit report](evidence/backend-results.xml) contains individual timings.

| Verified behavior | Evidence |
|---|---|
| Background ingestion and WebSocket fanout | A real API process starts a real worker; two real WebSocket subscribers receive the same completion ID. Exactly 3,000 records become queryable after the event. |
| Fast accepted requests and cached reads | Tests assert accepted requests under 1–2 seconds and cached reads under one second while ingestion is active. These are local-test thresholds, not a production performance guarantee. |
| Event ordering | Live events are queued → started → completed, with increasing IDs. |
| Duplicate protection | Repeating the same 3,000-record seed inserts zero; a different seed adds 3,000. |
| Named mock route | `/getTrades` returns a fast 202 and a result URL; after the completion event its result returns 2,500 seeded trade records with 200. |
| Search and pagination | Non-overlapping pages; case-insensitive symbol, client, and trade ID searches; SQL-like strings treated literally. |
| Validation | Invalid delay/count/seed and pagination rejected; unknown jobs return 404. |
| WebSocket reconnect | A cursor before completion replays it; an up-to-date cursor receives connected without duplicate history. |
| Server interruption recovery | Terminate the test process tree mid-pull; restart with the same DB; old data persists and queued/running work completes once. |
| Mid-batch database failure | An injected SQLite trigger aborts record 15. No partial rows remain; a failed event is delivered; after removing the cause a retry succeeds. |
| Worker crash | Terminate only the test worker; a failure event arrives, health becomes 503, and a new explicit pull starts a replacement worker and succeeds. |
| 15-minute configuration | A 900-second mock job is accepted in under one second; committed reads stay available. The test then shuts down its isolated server. |
| Actual delay beyond HTTP cutoff | A real 32-second pull returns 202 immediately. At 30.5 seconds, a short ledger read still succeeds. Completion arrives through WebSocket after 32 seconds with 3,000 rows. |
| Money and deterministic data | Repeated generation produces identical unique IDs and data; integer paise aggregates match the sum across all persisted rows. |
| Concurrent pull guard | Both API behavior and the database's partial unique index reject another active job. |

## Browser: 10 acceptance checks passed

The [machine-readable browser report](evidence/browser-results.json) records browser version, completion timestamp, and the ten checks. The runner is `tests/browser.cjs`, executed against an isolated empty database.

1. Correct empty dashboard with live connection.
2. No HTTP requests while idle (2.5-second observation).
3. Visible configurable background pull and in-progress state.
4. Two already open tabs update to 3,000 trades without reloading.
5. Symbol search displays only matching trades.
6. Next-page action changes the displayed trade IDs.
7. A populated ledger remains usable during a second pull, then updates to 6,000 records.
8. An offline browser with its WebSocket explicitly closed reconnects and reconciles a missed pull to 6,100 records.
9. At a 390-pixel mobile viewport, the page has no horizontal document overflow; wide ledger columns scroll inside the table.
10. No uncaught browser exceptions or failed HTTP responses; the populated idle dashboard also makes no polling requests.

Screenshots and a real browser recording are under [evidence](evidence/). The final desktop ledger is a bounded scrolling table with a sticky header, rather than a 50-row page extending far below the activity panels.

Additional checks: JavaScript syntax, Python compilation, `pip check`, and Git whitespace validation pass. The browser assets have no external resource requests or paid dependencies.

## What was not verified or delivered

- A full 900-second elapsed wait was not performed. The upper bound is validated and accepted; real end-to-end elapsed waiting was verified at 32 seconds. A live 15-minute demonstration is available by setting the delay to 900.
- No real BSE integration, external network appliance, production proxy, authentication system, multi-host deployment, or load benchmark was tested.
- The video is a real UI recording without narration. The accompanying walkthrough document provides a presentation script.
- The Git repository is local. No GitHub publication or email submission was performed.

The asynchronous mock exchange accept/result protocol is a documented design choice necessitated by the stated HTTP lifetime limit; it does not emulate a synchronous connection that stays open for 15 minutes.
