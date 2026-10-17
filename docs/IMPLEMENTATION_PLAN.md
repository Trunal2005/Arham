# Implementation plan and acceptance mapping

This was a new empty repository. There was no pre-existing implementation or master plan on disk. This plan is based on the original one-page Arham assessment and the user's request for frontend, backend, database, background worker, WebSocket integration, tests, and zero paid services.

## Priority 1: Correct ingestion and immediate reads

- [x] Initialize local Git repository and define free local dependencies.
- [x] Seed a few thousand trades with ID, client, symbol, quantity, price, and timestamp.
- [x] Expose `GET /getTrades` with configurable 0–900-second processing delay through an asynchronous accept/result contract.
- [x] Return accepted job immediately, avoiding long-lived HTTP requests.
- [x] Use a separate worker process and durable SQLite job state.
- [x] Keep committed trades readable while a new pull runs.
- [x] Commit data, completion state, and event atomically.
- [x] Enforce duplicate prevention and one active pull in the database.

## Priority 2: Push updates and recovery

- [x] Notify the API through blocking process IPC, without a scheduler or polling loop.
- [x] Broadcast completion to multiple open WebSocket subscribers.
- [x] Refetch the ledger once on an event, without refreshing the page.
- [x] Persist monotonic events and replay after reconnect.
- [x] Reconcile current snapshot on connect/reconnect.
- [x] Recover interrupted jobs on server restart; retain all committed trades.
- [x] Report failures and roll back incomplete batches.

## Priority 3: Usable frontend

- [x] Instant dashboard shell and independently loaded cached records.
- [x] Empty, active pull, completed, failure, and reconnect states.
- [x] Search, pagination, row counts, INR values, IST display.
- [x] Trade aggregates, symbol distribution, and pull history.
- [x] Keyboard-accessible configuration dialog and responsive mobile layout.
- [x] Local CSS/JavaScript assets, no CDN, external font, or build requirement.

## Priority 4: Delivery and verification

- [x] Real-process API and WebSocket tests, including a 32-second pull.
- [x] Test acceptance of a 900-second job without waiting for HTTP.
- [x] Test deterministic data, duplicates, concurrent rejection, validation, search, and pagination.
- [x] Test reconnect replay, interrupted-worker recovery, and transactional failure.
- [x] Provide setup README and architecture note with diagrams.
- [x] Final browser acceptance run and saved evidence: 10 checks passed (see VERIFICATION.md).
- [x] Final recorded walkthrough and desktop/mobile visual review (see WALKTHROUGH.md).

## Scope decisions

The mock uses an asynchronous exchange protocol because the stated HTTP cutoff makes synchronous 15-minute responses impossible. SQLite and a supervised local worker replace hosted infrastructure. Seed data intentionally has reproducible mock execution timestamps. One API process owns one worker; high availability, real exchange integration, public hosting, and authentication are outside this assessment implementation. No paid endpoint or real BSE credential is used.

## Readiness audit follow-up

- [x] Correct committed-job status after a broken completion pipe.
- [x] Decouple HTTP acceptance from slow subscribers and order all event producers through one signalled dispatcher.
- [x] Read ledger, summary and job state in a single snapshot; enforce one database owner.
- [x] Add distinct literal mock-provider endpoint and document real upstream timeout assumptions.
- [x] Add visible elapsed time/job ID, presets, simulated-date label and ledger accessibility/readability improvements.
- [x] Preserve filters/page/scroll and reconcile replay without historical toasts.
- [x] Add true concurrency, slow-subscriber, failed-batch preservation and future-cursor regressions.
- [x] Run 22 backend tests, 16 browser checks and save monotonic timing evidence.
- [x] Prepare a separate machine-narrated/captioned video and a precise personal recording guide.

See AUDIT.md for prioritized reasons, COMPLIANCE.md for exact requirement statuses, and VERIFICATION.md for actual results and remaining boundaries.
