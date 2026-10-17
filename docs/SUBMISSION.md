# Submission verification

Prepared on 17 October 2026 for the Arham Fintech Software Engineer assessment. The existing FastAPI/SQLite/worker/WebSocket architecture and four prior commits were preserved. Submission changes polish documentation, exclude private-key/credential files, improve browser-test timing reliability, and fill the video's missing visible HTTP-response evidence.

## Verification

| Check | Result |
|---|---|
| Backend integration suite | 22 passed in 128.24 seconds; two real 32-second tests. |
| Full browser acceptance suite | 16 checks passed; 202 accepted in 0.344 seconds, worker duration 32.499 seconds, both tabs updated automatically. |
| Dependency consistency | `python -m pip check`: no broken requirements. |
| Clean checkout / fresh environment | Dependencies installed from locally cached wheels using requirements-dev.txt; API/worker/WebSocket and mock-contract smoke tests: 2 passed in 7.89 seconds. |
| Syntax | Python compilation and JavaScript syntax checks passed. |
| Historical credential/path scan | 136 Git blobs scanned; no matching private-key, GitHub/AWS/API-token, or personal Windows home-path patterns. |
| Tracked generated/private files | No virtual environment, node_modules, local database, `.env`, or cache directories tracked. Ignore rules tested with representative paths. |
| Video | 118.60 seconds, 1440 × 1000, H.264/AAC; full decode, non-silent audio, real Chrome playback and seeks passed. |

Fresh evidence: [backend timing](evidence/submission/backend-timeout.json), [browser results](evidence/submission/browser-results.json), [repository scan](evidence/submission/repository-scan.json), [video playback](evidence/submission-video-verification.json), and [actual HTTP response](evidence/submission-http-response.json).

Initial browser reruns exposed background-tab timing sensitivity and a narrow assertion that raced legitimate completion. The harness now activates tabs for observations, checks DOM state independently of animation frames, and observes cached rows earlier in the delay. It still verifies real processing of at least 32 seconds, prompt 202 acceptance, measured WebSocket-to-DOM updates, duplicates, reconnect, worker failure, and server recovery. The backend's independent delayed-read tests remain unchanged.

The earlier audit/video evidence is retained separately; fresh submission results do not silently replace the measurements associated with the original narration.

## Video coverage

[Final walkthrough](evidence/submission-walkthrough.mp4) preserves the original 103.12-second narrated application recording and adds a 15.48-second supplement. The original shows saved trades, starting a pull, responsiveness during the actual 32-second wait, automatic completion, duplicates, and architecture. The supplement shows the current dashboard and a captured real `202 Accepted` response with its job ID and `Location` (accepted in 0.167 seconds). Its overlay is explicitly labelled as submission evidence rather than product UI.

The original clip uses the earlier visual styling; the supplement uses the current design. Both show the actual application. Narration uses a disclosed local synthetic voice. Captions have approximate phrase timing. No full 900-second completion or real BSE connection is claimed. The MP4 is approximately 4.7 MiB, below GitHub's ordinary per-file limit; Git LFS is unnecessary for this artifact.

## Publication and handoff

Target: [Trunal2005/Arham](https://github.com/Trunal2005/Arham), branch `main`. README links use repository-relative paths so they work on GitHub. Local databases, secrets, environments, caches, and temporary test outputs are excluded. Pattern-based scanning provides evidence, not a guarantee against every possible kind of secret.

Publication succeeded without force-pushing. GitHub's default branch is `main` and the repository is public and no longer empty. All 113 files in the initial submission commit matched their local Git blob hashes, including the MP4. The later publication-verification commit only updates documentation/evidence.

Real Chrome checks confirmed the README renders with its dashboard image, GitHub renders the Mermaid SVG with all five architecture components, and the GitHub-hosted MP4 plays with decoded audio at its full 118.60-second duration. See [publication evidence](evidence/submission/github-verification.json). The final commit hash and clean working tree are confirmed in the handoff.

No assessment email has been sent. Before sending, personally review the narration and include the repository/video links and any attachments requested by the assessment email.
