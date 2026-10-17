# Walkthrough and submission preparation

## Prepared artifacts

- [Machine-narrated presentation](evidence/submission-walkthrough.mp4): 118.60 seconds, disclosed local synthetic voice, architecture/module cards and actual browser recordings. The original 103.12-second presentation is retained, followed by a 15.48-second current-dashboard supplement displaying its actual captured HTTP 202 response.
- [Raw behavioral browser recording](evidence/walkthrough.webm): 73.40 seconds, no narration. It includes a real 32-second wait, live completion, duplicates and recovery.
- [Captions](evidence/submission-walkthrough.vtt), [chapter narration](evidence/video-chapters.json), and [packaging metadata](evidence/video-package.json).
- [Test verification](VERIFICATION.md), [timeout backend trace](evidence/timeout-backend.json), [browser timing](evidence/timeout-browser.json), and [architecture diagrams](ARCHITECTURE.md).

The final MP4 passed full FFmpeg decoding and real Chrome playback/seeking, including audio decoding. See [playback verification](evidence/submission-video-verification.json) and [captured response](evidence/submission-http-response.json). The original recording shows the earlier dashboard styling; the supplement shows the current interface and clearly labels its response evidence panel as separate from product UI. The original uninterrupted 32-second scenario remains intact. Narration is local text-to-speech, not a human voice recording. The 900-second setting is validated, but no full 15-minute wait is claimed.

## Reproduce automated recording

From the repository root, after Python/Node dependency setup:

```powershell
npm ci
npx playwright install chromium
npm run test:e2e
```

The runner automatically creates a fresh database and server. It deliberately stops only its own server/worker processes to prove recovery, then cleans them up. It overwrites the lightweight evidence artifacts under `docs/evidence` and leaves temporary logs/databases/videos ignored under `test-results`.

To produce the optional narrated MP4 on Windows:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-video.txt
.\scripts\prepare-video.ps1
```

This uses the browser-installed Chromium (or `BROWSER_EXECUTABLE`), free FFmpeg packaging, and Windows' installed System.Speech voice. No voice API key, paid service, or external speech generation is used. The application does not depend on these video tools. On other operating systems, keep the raw recording and record your own narration with any local recorder; the supplied PowerShell voice step is Windows-specific.

## Exact steps for a personal 3–5 minute demonstration

1. Start with a fresh demo database, keeping your existing data separate:

   ```powershell
   $env:ARHAM_DB = "$PWD\test-results\personal-demo.sqlite3"
   .\.venv\Scripts\python.exe -m uvicorn arham.app:app --host 127.0.0.1 --port 8000
   ```

   Use a new filename if you previously used that demo. Open two tabs at `http://127.0.0.1:8000` and start a local screen recorder with your microphone.

2. **Business problem:** explain the 15-minute exchange pull and 30-second ordinary HTTP limit. Show ARCHITECTURE.md: fast acceptance → durable job → separate worker → atomic commit → ordered WebSocket event → one consistent snapshot.
3. **Immediate loading and background ingestion:** show the empty dashboard, then seed 42 / 3,000 records / 5-second preset. Explain prompt 202 and show both tabs update automatically. Point out simulated execution dates, actual pull times and integer-paise totals.
4. **Timeout proof:** keep the saved trades visible, choose seed 43 / 3,000 records / 32-second preset. Show the request has ended in browser Network tools. Search RELIANCE and move to page 2 while elapsed time exceeds 30 seconds. Keep both tabs open until the new committed count appears without refresh. Do not speed up or cut the actual wait if claiming it as timed evidence.
5. **Duplicates:** repeat seed 43 and the same count. Show zero inserted and 3,000 duplicates skipped, with the ledger unchanged.
6. **Code walkthrough:** show `arham/provider.py` for the single seeded generator, `arham/worker.py` for local delay/transaction/notify-after-commit, `arham/db.py` for WAL/read snapshots/unique IDs, and `arham/app.py` for acceptance and ordered replay. Explain why a worker does not bypass an upstream HTTP timeout; real BSE would require an appropriate upstream async/resumable protocol or network allowance.
7. **Tests and boundaries:** show the actual 22-pass JUnit result, 16 browser checks, monotonic timing evidence and independent ₹624.97Cr calculation for seeds 42+43. Explain that 900-second acceptance is verified while elapsed completion tests run at 32 seconds. Mention one API owner per local DB and no real exchange or public deployment.
8. Stop and replay your recording. Verify that the text, voice, 202 response, live update and timings are readable/audible. Save the file alongside the repository or provide a link only after deciding how to submit it.

## Final handoff checklist

Confirm the README setup commands, test reports, architecture note, compliance table and chosen video are included. Check `git status --short`; no DBs, environments, temporary logs, browser caches or secrets should be tracked. A personal introduction can improve presentation but is not technical proof. No fabricated official score, guaranteed selection, remote publication or submitted-email claim should be added.
