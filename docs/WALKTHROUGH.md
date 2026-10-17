# Walkthrough

The browser acceptance runner records the real local UI to [walkthrough.webm](evidence/walkthrough.webm) and saves screenshots alongside it. The verified final recording is 29.52 seconds at 1440×1000 and has no narration. Open it in a browser or a player supporting WebM.

Suggested narration when presenting:

1. **Empty dashboard:** the page loads immediately and connects to WebSocket updates. All assets are local and there are no API keys.
2. **Configure a pull:** choose record count, reproducible dataset seed, and exchange processing delay. The upper bound is 900 seconds.
3. **Background processing:** submitting returns immediately. The worker is a separate process; no HTTP connection waits for the exchange delay.
4. **Automatic update:** the worker commits the batch and event together. IPC wakes the API, which broadcasts the completion over WebSocket. Both open tabs receive the same event without polling or reload.
5. **Search and paginate:** filter by symbol, client, or ID, then move through persisted records.
6. **Second pull:** the saved ledger remains available while another dataset is ingested. Existing trades never disappear during the pull.
7. **Mobile and reconnect:** an offline browser reconnects and receives the missed completion, then reconciles the current snapshot.
8. **Architecture and test evidence:** show `docs/ARCHITECTURE.md`, `docs/VERIFICATION.md`, and the pytest results. Explain that the automated elapsed-time check is 32 seconds, while the 15-minute setting is validated without a full 15-minute wait.

For a live long-duration demonstration, set 900 seconds, leave the dashboard open, and keep searching saved trades. There is no public hosting or paid API to configure.
