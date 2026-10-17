# Visible UI/UX redesign

This update focuses on the dashboard's appearance and interaction. FastAPI, SQLite, job persistence, the worker, provider, IPC, and WebSocket architecture are unchanged. All application changes are in `static/index.html`, `static/style.css`, and `static/app.js`; browser test-harness changes verify the new visible states.

## What visibly changed

- A persistent ingestion panel replaces the small banner. Running work has a prominent navy surface, mint activity indicator, full job reference, elapsed clock, configured delay, requested count, and state-based milestones. It does not invent a completion percentage.
- Completion retains inserted/duplicate counts, measured processing duration and job reference. Failure retains the job/error context and provides a working prefilled retry. Color changes are immediate to avoid a low-contrast transition between dark running and light failure states.
- Stronger typography, more consistent spacing, a narrower sidebar, meaningful local SVG icons, a featured navy traded-value card, and larger metric values create a clear hierarchy using the original navy/white/green identity.
- The ledger has larger reference/client/symbol/price text, clearer numeric weights, stronger symbol labels, split time/date display, sticky headers, keyboard focus, contained scrolling and a fixed footer outside the scrolling rows.
- Real WebSocket completion produces a visible ledger confirmation and temporarily highlights only records belonging to the newly committed job. Starting another pull clears old completion feedback. Error messages use a distinct error-toast palette.
- The pull dialog now uses selectable preset cards with selected-state feedback, a clearer form hierarchy, field help, and a submitting state. Existing validation, Escape handling and focus restoration remain.
- Initial loading uses explicit loading copy and skeleton placeholders. A failed initial snapshot shows unavailable values and a retry action, rather than falsely claiming an empty database. Cached rows remain visible on later read failures.
- Desktop, tablet and mobile layouts retain functional controls and contain horizontal table overflow within the ledger. Reduced-motion preferences disable presentation animations. All assets remain local and free.

## Before/after evidence

The browser used isolated databases with the same seeds and counts, not a modified live demo database. Desktop viewport: **1440×1050**. Mobile: **390×844**. Tablet: **1024×900**. The normal ledger has seeds 42+43, 6,000 records and ₹624.97Cr; the running screenshot starts seed 44 while those 6,000 records remain available. Job UUIDs and actual pull times differ between runs.

| State | Before | After |
|---|---|---|
| Dashboard | [Before](evidence/ui/before/dashboard-desktop.png) | [After](evidence/ui/after/dashboard-desktop.png) |
| Active ingestion | [Before](evidence/ui/before/running-desktop.png) | [After](evidence/ui/after/running-desktop.png) |
| Mobile dashboard | [Before](evidence/ui/before/dashboard-mobile.png) | [After](evidence/ui/after/dashboard-mobile.png) |
| Mobile ingestion | [Before](evidence/ui/before/running-mobile.png) | [After](evidence/ui/after/running-mobile.png) |
| Pull configuration | [Before](evidence/ui/before/configuration.png) | [After](evidence/ui/after/configuration.png) |
| Completed pull | [Before](evidence/ui/before/success-desktop.png) | [After](evidence/ui/after/success-desktop.png) |
| Real worker failure | [Before](evidence/ui/before/failure-desktop.png) | [After](evidence/ui/after/failure-desktop.png) |
| Empty state | [Before](evidence/ui/before/empty-desktop.png) | [After](evidence/ui/after/empty-desktop.png) |

Additional after screenshots: [loading](evidence/ui/after/loading-desktop.png), [unavailable snapshot](evidence/ui/after/connection-error.png), [tablet](evidence/ui/after/dashboard-tablet.png), and [running viewport](evidence/ui/after/running-viewport.png).

## Actual verification

- **22 backend tests passed in 119.95 seconds**, including both real 32-second ingestion tests. [JUnit report](evidence/ui/regression/backend-results.xml).
- **16 full browser checks passed**, including the real 32-second flow, two tabs updating without reload, saved trades during processing, search/page preservation, duplicates, offline replay, worker failure and backend restart. [Results](evidence/ui/regression/browser-results.json).
- **10 focused visual/state checks passed** on the final UI: skeleton loading, desktop/mobile/tablet overflow, active job details, saved rows during work, automatic success, real worker failure, prefilled retry/recovery, and explicit initial-503 error/retry. [Results](evidence/ui/after/results.json).
- The focused test intentionally injects two HTTP 503 responses to verify unavailable-state handling. Those are recorded separately; there were no unexpected browser errors. A test-only delayed-request cleanup race was corrected before the final passing run; no failing test was removed.
- JavaScript syntax, Git whitespace, and absence of backend-source changes were checked. Original readiness-audit evidence is preserved; this iteration's screenshots, recording and regression results live separately under `docs/evidence/ui`.

## View the new UI

Open **http://127.0.0.1:8000/?ui=2** after starting the application. The HTML references versioned frontend assets. An existing tab from the prior version may need **Ctrl+F5 once** to load the new UI; ingestion updates continue to use WebSocket and never require a page refresh.

```powershell
cd 'C:\Internship Task\Arham'
.\.venv\Scripts\python.exe -m uvicorn arham.app:app --host 127.0.0.1 --port 8000
```

Stop an existing server on that port before starting another one. The application still enforces one API owner per database.

To repeat the focused after-state capture (after installing the optional Playwright browser dependencies):

```powershell
$env:UI_PHASE = 'after'
npm run test:e2e
Remove-Item Env:UI_PHASE
```

`npm run test:e2e` without `UI_PHASE` runs the full browser regression. The focused harness starts and cleans up its own isolated server and deliberately crashes only that worker to verify the failure/retry states. The before images were captured from commit `08fad3c` before frontend changes; setting `UI_PHASE=before` against new code would not recreate the historical interface.
