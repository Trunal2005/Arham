/* Capture the current UI and its actual response; evidence overlay is not product UI. */
const {chromium} = require('playwright');
const {spawn, execFileSync} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');

(async () => {
  const folder = path.resolve('test-results/submission-supplement');
  await fs.mkdir(folder, {recursive: true});
  const port = await new Promise(resolve => {const s = net.createServer(); s.listen(0, '127.0.0.1', () => {const p = s.address().port; s.close(() => resolve(p));});});
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(path.resolve('.venv/Scripts/python.exe'), ['-m', 'uvicorn', 'arham.app:app', '--port', String(port)], {
    windowsHide: true, stdio: 'ignore', env: {...process.env, ARHAM_DB: path.join(folder, `demo-${Date.now()}.sqlite3`)}
  });
  let browser;
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {try {if ((await fetch(url + '/api/health')).ok) {ready = true; break;}} catch {} await new Promise(r => setTimeout(r, 100));}
    assert.ok(ready, 'Isolated demonstration server must start');
    browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_EXECUTABLE});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, recordVideo: {dir: folder, size: {width: 1440, height: 1000}}});
    const page = await context.newPage();
    await page.goto(url);
    await page.getByText('Live updates connected', {exact: true}).waitFor();
    await context.request.get(url + '/getTrades?delay_seconds=0&record_count=3000&seed=42');
    await page.waitForFunction(() => document.querySelector('#total-trades').textContent === '3,000');
    await page.getByRole('button', {name: 'Pull exchange data', exact: true}).first().click();
    await page.locator('#delay').fill('32');
    await page.locator('#seed').fill('43');
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/getTrades');
    const start = performance.now();
    await page.getByRole('button', {name: 'Start background pull'}).click();
    const response = await pending;
    const evidence = {method: 'GET', path: new URL(response.url()).pathname + new URL(response.url()).search,
      status: response.status(), location: response.headers().location, body: await response.json(),
      acceptanceSeconds: (performance.now() - start) / 1000, configuredDelaySeconds: 32};
    assert.equal(evidence.status, 202);
    assert.ok(evidence.acceptanceSeconds < 2);
    await fs.writeFile('docs/evidence/submission-http-response.json', JSON.stringify(evidence, null, 2) + '\n');
    await page.evaluate(evidence => {
      const panel = document.createElement('aside');
      panel.style.cssText = 'position:fixed;right:20px;bottom:20px;width:550px;z-index:9999;background:#101c32;color:white;padding:25px;border:2px solid #73e5b0;border-radius:12px;box-shadow:0 10px 40px #0005;font:16px/1.6 system-ui';
      const title = document.createElement('h2'); title.textContent = 'HTTP 202 · Actual captured response'; title.style.cssText = 'font-size:23px;margin:0 0 10px;color:#73e5b0';
      const note = document.createElement('p'); note.textContent = 'Submission evidence panel (not application UI). Current dashboard; full 32-second completion appears earlier in the walkthrough.';
      const pre = document.createElement('pre'); pre.style.cssText = 'font:14px/1.7 monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:15px 0';
      pre.textContent = `GET ${evidence.path}\n\nHTTP ${evidence.status} Accepted\nAccepted in ${evidence.acceptanceSeconds.toFixed(3)} seconds\nLocation: ${evidence.location}\n\n${JSON.stringify(evidence.body, null, 2)}`;
      panel.append(title, note, pre); document.body.append(panel);
    }, evidence);
    await page.screenshot({path: 'docs/evidence/submission-http-response.png'});
    await page.waitForTimeout(14000);
    const video = page.video(); await context.close();
    await video.saveAs(path.join(folder, 'supplement.webm'));
    console.log(JSON.stringify({status: evidence.status, acceptanceSeconds: evidence.acceptanceSeconds, video: path.join(folder, 'supplement.webm')}));
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
