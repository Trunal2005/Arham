const {chromium} = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
async function main() {
  const folder = path.resolve('test-results/video-package');
  await fs.mkdir(folder, {recursive: true});
  const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {})});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const css = 'body{margin:0;background:#101c32;color:#ecf2f8;font:24px system-ui;padding:95px;box-sizing:border-box;width:1440px;height:1000px}small{color:#8ee2bb;letter-spacing:4px;font-size:17px}h1{font-size:60px;letter-spacing:-2px;margin:30px 0}p{color:#adbed1;line-height:1.7}section{display:flex;gap:20px;margin:55px 0}article{flex:1;padding:28px;border:1px solid #36516a;border-radius:12px}article strong{display:block;color:#8ee2bb;font-size:27px;margin-bottom:15px}article span{color:#b4c3d4;font-size:20px;line-height:1.7}footer{color:#a4b9ce;font-size:19px;margin-top:45px}code{color:#8ee2bb;font-size:20px}li{margin:20px 0;color:#b4c3d4}';
  await page.setContent(`<style>${css}</style><small>ARHAM FINTECH · ENGINEERING ASSESSMENT</small><h1>Fifteen-minute work.<br>A dashboard that stays available.</h1><p>Real local application, real worker, real 32-second verification.</p><section><article><strong>Accept</strong><span>Short HTTP request<br>202 + durable job</span></article><article><strong>Ingest</strong><span>Separate worker<br>Atomic SQLite commit</span></article><article><strong>Update</strong><span>Ordered event log<br>WebSocket → dashboard</span></article></section><footer>No paid API · No scheduler · No frontend polling<br>Machine-narrated demonstration · Local mock exchange</footer>`);
  await page.screenshot({path: path.join(folder, 'intro.png')});
  await page.setContent(`<style>${css}</style><small>CODE WALKTHROUGH & ENGINEERING EVIDENCE</small><h1>Small components.<br>Explicit guarantees.</h1><ul><li><code>arham/app.py</code> — fast acceptance, consistent snapshots, ordered push</li><li><code>arham/worker.py</code> — local delay, atomic batch, notify after commit</li><li><code>arham/provider.py</code> — one deterministic seeded generator</li><li><code>arham/db.py</code> — integer paise, unique IDs, WAL, process ownership</li><li><code>tests/</code> — real processes, failure injection, real browsers</li></ul><p>Timing evidence: docs/evidence/timeout-backend.json and timeout-browser.json<br>Full results and boundaries: docs/VERIFICATION.md</p><footer>900-second configuration tested for acceptance. Actual timed runs: 32 seconds.<br>No real BSE connection · No claim of company selection or submission</footer>`);
  await page.screenshot({path: path.join(folder, 'outro.png')});
  await browser.close();
}
main().catch(e => {console.error(e); process.exitCode = 1;});
