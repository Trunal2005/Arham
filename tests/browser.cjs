const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function run(controls = {}) {
  const output = path.resolve('docs/evidence');
  await fs.mkdir(output, {recursive: true});
  const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {})});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, recordVideo: {dir: path.resolve('test-results/video'), size: {width: 1440, height: 1000}}});
  const url = process.env.BASE_URL || 'http://127.0.0.1:8000';
  const errors = [], requests = [], external = [], checks = [], chapters = [];
  let timeoutEvidence;
  const videoStart = performance.now();
  const page = await context.newPage();
  const second = await context.newPage();
  const video = page.video();
  const chapter = (title, narration) => chapters.push({seconds: (performance.now() - videoStart) / 1000, title, narration});
  await context.addInitScript(() => {
    window.__renderEvents = []; window.__receivedEvents = [];
    addEventListener('arham:rendered', e => window.__renderEvents.push(e.detail));
    addEventListener('arham:received', e => window.__receivedEvents.push(e.detail));
  });
  await context.route('**/*', route => {
    if (route.request().url().startsWith(url + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  for (const tab of [page, second]) {
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('response', response => {if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);});
  }
  page.on('request', request => requests.push(request.url()));
  // A background tab can suspend animation frames even after its DOM updates.
  // Observe the DOM independently of rendering cadence for both-tab assertions.
  const total = async (tab, text, timeout = 15000) => {
    await tab.bringToFront();
    try {await tab.waitForFunction(value => document.getElementById('total-trades').textContent === value, text, {timeout, polling: 100});}
    catch (error) {
      console.error('Trade count diagnostic:', JSON.stringify(await tab.evaluate(() => ({actual: document.getElementById('total-trades').textContent, connection: document.getElementById('connection').textContent, error: document.getElementById('error').textContent, cursor: state.cursor, socket: state.socket?.readyState, received: window.__receivedEvents})), null, 2), errors);
      throw error;
    }
    await page.bringToFront();
  };
  const screenshot = name => page.screenshot({path: path.join(output, name + '.png'), fullPage: true});
  async function startPull(delay, seed, count = 3000) {
    await page.getByRole('button', {name: 'Pull exchange data', exact: true}).first().click();
    await page.locator('#delay').fill(String(delay)); await page.locator('#seed').fill(String(seed)); await page.locator('#record-count').fill(String(count));
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/getTrades');
    const before = performance.now();
    await page.getByRole('button', {name: 'Start background pull'}).click();
    const response = await pending;
    assert.equal(response.status(), 202);
    return {job: (await response.json()).job_id, acceptanceSeconds: (performance.now() - before) / 1000};
  }
  try {
    chapter('The problem', 'The exchange may take fifteen minutes, but ordinary HTTP connections end after thirty seconds. This local dashboard separates acceptance, background work, and live updates.');
    await page.goto(url); await second.goto(url); await page.bringToFront();
    await page.getByText('Live updates connected', {exact: true}).waitFor(); await total(page, '0');
    await screenshot('empty-desktop'); checks.push('fresh empty database and immediate shell');
    const beforeIdle = requests.length;
    await page.waitForTimeout(2500); assert.equal(requests.length, beforeIdle); checks.push('empty dashboard does not poll');
    await page.getByRole('button', {name: 'Pull exchange data', exact: true}).first().click();
    assert.equal(await page.locator('#delay').evaluate(e => e === document.activeElement), true);
    for (const delay of ['32', '900', '5']) {await page.locator(`[data-delay="${delay}"]`).click(); assert.equal(await page.locator('#delay').inputValue(), delay);}
    checks.push('5/32/900 presets and modal initial focus');
    await page.locator('#record-count').fill('0');
    const beforeInvalid = requests.length;
    await page.getByRole('button', {name: 'Start background pull'}).click();
    assert.equal(await page.locator('#record-count').evaluate(e => e.checkValidity()), false); assert.equal(requests.length, beforeInvalid);
    await page.locator('#record-count').fill('3000'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#open-pull').evaluate(e => e === document.activeElement), true);
    checks.push('native input validation, Escape, and restored focus');
    chapter('Short request, separate worker', 'Choose a delay and a reproducible seed. The request returns accepted promptly. A separate Python worker waits locally, while the saved ledger remains available.');
    await page.getByRole('button', {name: 'Pull exchange data', exact: true}).first().click();
    await screenshot('pull-configuration');
    const initial = page.waitForResponse(r => new URL(r.url()).pathname === '/getTrades');
    await page.evaluate(() => {document.getElementById('pull-form').requestSubmit(); document.getElementById('pull-form').requestSubmit();});
    assert.equal((await initial).status(), 202);
    await page.locator('#pull-banner').waitFor({state: 'visible'});
    assert.match(await page.locator('#pull-job-id').textContent(), /^Job [a-f0-9-]+$/);
    await screenshot('pull-in-progress'); await total(page, '3,000'); await total(second, '3,000');
    assert.equal(await page.locator('#trade-rows tr').count(), 50);
    assert.equal((await (await context.request.get(url + '/api/pulls')).json()).items.length, 1);
    checks.push('double submission prevented and two tabs update automatically'); await screenshot('dashboard-desktop');
    await page.locator('#search').fill('RELIANCE');
    await page.waitForFunction(() => [...document.querySelectorAll('.symbol-tag')].length && [...document.querySelectorAll('.symbol-tag')].every(e => e.textContent === 'RELIANCE'));
    const firstId = await page.locator('#trade-rows td').first().textContent();
    await page.getByRole('button', {name: 'Next page'}).click();
    await page.waitForFunction(id => document.querySelector('#trade-rows td').textContent !== id, firstId);
    assert.equal(await page.locator('#page-number').textContent(), 'Page 2'); await screenshot('search'); checks.push('search and stable pagination');
    await startPull(5, 43); await page.locator('#pull-banner').waitFor({state: 'visible'});
    assert.equal(await page.locator('#trade-rows tr').count(), 50); await screenshot('cached-trades-during-pull');
    await total(page, '6,000'); await total(second, '6,000');
    assert.equal(await page.locator('#search').inputValue(), 'RELIANCE'); assert.equal(await page.locator('#page-number').textContent(), 'Page 2');
    assert.equal(await page.locator('#total-value').textContent(), '₹624.97Cr'); assert.equal(await page.locator('#total-value').getAttribute('title'), '₹6,24,96,98,945.95');
    checks.push('cached rows, filter/page preservation, and independently verified INR amount');
    chapter('The real 32-second test', 'This pull really waits thirty two seconds. The acceptance request has already ended. During the wait, the ledger stays usable. The worker commits all records and its completion event atomically. A blocking pipe wakes one ordered event dispatcher. WebSocket then updates both tabs without polling. Moving a remote HTTP request into a worker would not bypass an upstream network timeout; this mock processing happens locally.');
    const long = await startPull(32, 44); const longAcceptedAt = performance.now(); assert.ok(long.acceptanceSeconds < 2);
    await page.locator('#pull-banner').waitFor({state: 'visible'});
    await page.waitForTimeout(5000); await second.reload(); await total(second, '6,000'); await second.locator('#pull-banner').waitFor({state: 'visible'});
    checks.push('browser reload during running ingestion retains saved trades');
    // Observe cached rows with enough headroom for browser/recording latency.
    // The durable job timestamps below independently prove the full 32s delay;
    // checking the old count at 30.5s races legitimate completion after 202 latency.
    await page.waitForTimeout(Math.max(0, longAcceptedAt + 25000 - performance.now()));
    assert.equal(await page.locator('#total-trades').textContent(), '6,000'); assert.equal(await page.locator('#page-number').textContent(), 'Page 2');
    assert.match(await page.locator('#pull-elapsed').textContent(), /Elapsed 0:[23]\d/); await screenshot('timeout-running-during-delay');
    await total(page, '9,000', 15000); await total(second, '9,000', 15000);
    for (const tab of [page, second]) await tab.waitForFunction(job => window.__renderEvents.some(e => e.jobId === job), long.job);
    const tabTimings = await Promise.all([page, second].map(tab => tab.evaluate(job => {const e = window.__renderEvents.find(e => e.jobId === job); return {...e, receiveToRenderMs: e.renderedAt - e.receivedAt};}, long.job)));
    assert.ok(tabTimings.every(t => t.receiveToRenderMs >= 0 && t.receiveToRenderMs < 3000));
    const committed = await (await context.request.get(url + '/api/pulls/' + long.job)).json();
    assert.ok(Date.parse(committed.finished_at) - Date.parse(committed.started_at) >= 32000);
    timeoutEvidence = {status: 'passed', jobId: long.job, acceptanceSeconds: long.acceptanceSeconds, configuredDelaySeconds: 32, workerWallSeconds: (Date.parse(committed.finished_at) - Date.parse(committed.started_at)) / 1000, tabs: tabTimings, browserClock: 'performance.now per document; only same-document durations are subtracted'};
    if (controls.tracePath) timeoutEvidence.serverTrace = (await fs.readFile(controls.tracePath, 'utf8')).trim().split('\n').map(JSON.parse).filter(e => e.job_id === long.job);
    await fs.writeFile(path.join(output, 'timeout-browser.json'), JSON.stringify(timeoutEvidence, null, 2)); await screenshot('timeout-completed');
    checks.push('real 32-second pull, fast 202, elapsed clock, and measured two-tab DOM update');
    chapter('Idempotence and recovery', 'Repeating the same seed skips duplicates. Search and pagination stay in place during automatic updates. Durable events replay after a disconnection, and database transactions prevent partial batches.');
    await startPull(0, 44);
    await page.waitForFunction(() => [...document.querySelectorAll('.activity-item')].some(e => e.textContent.includes('0 added') && e.textContent.includes('3,000 duplicates skipped')));
    assert.equal(await page.locator('#total-trades').textContent(), '9,000'); await screenshot('duplicates-skipped'); checks.push('duplicate dataset adds zero and displays duplicate count');
    const beforeDuplicate = requests.length;
    await page.evaluate(() => {const e = window.__receivedEvents.find(e => e.type === 'pull.completed'); state.socket.onmessage({data: JSON.stringify(e)});});
    await page.waitForTimeout(500); assert.equal(requests.length, beforeDuplicate); checks.push('duplicate event ignored without extra refresh');
    const offline = await browser.newContext({viewport: {width: 390, height: 844}});
    const mobile = await offline.newPage(); mobile.on('pageerror', e => errors.push(e.message));
    await mobile.goto(url); await total(mobile, '9,000'); await offline.setOffline(true); await mobile.evaluate(() => state.socket.close());
    await mobile.getByText('Reconnecting to live updates…', {exact: true}).waitFor();
    await context.request.post(url + '/api/pulls', {data: {delay_seconds: .5, record_count: 100, seed: 45}}); await total(page, '9,100');
    await offline.setOffline(false); await total(mobile, '9,100');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mobile.screenshot({path: path.join(output, 'dashboard-mobile.png'), fullPage: true}); await mobile.setViewportSize({width: 1024, height: 900});
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mobile.screenshot({path: path.join(output, 'dashboard-tablet.png'), fullPage: true}); await offline.close(); checks.push('disconnect, missed-event replay, and mobile/tablet overflow');
    let expectedTotal = '9,100';
    if (controls.crashWorker && controls.restartServer) {
      await startPull(5, 46, 100); await page.locator('#pull-banner').waitFor({state: 'visible'}); await controls.crashWorker();
      await page.waitForFunction(() => document.querySelector('.activity-item .badge')?.textContent === 'FAILED'); assert.equal(await page.locator('#total-trades').textContent(), expectedTotal);
      await page.getByText('Live updates connected', {exact: true}).waitFor(); await startPull(0, 46, 100); await total(page, '9,200'); checks.push('worker crash visible and next explicit pull replaces worker');
      await startPull(5, 47, 100); await page.locator('#pull-banner').waitFor({state: 'visible'}); await controls.restartServer();
      await total(page, '9,300', 20000); await total(second, '9,300', 20000); expectedTotal = '9,300'; checks.push('backend restart recovers interrupted job and reconnects both tabs');
    }
    await page.reload(); await total(page, expectedTotal); await page.getByText('Live updates connected', {exact: true}).waitFor(); checks.push('browser refresh preserves committed data');
    await page.waitForTimeout(500); const afterIdle = requests.length; await page.waitForTimeout(2500); assert.equal(requests.length, afterIdle);
    assert.deepEqual(external, []); assert.deepEqual(errors, []); checks.push('no idle polling, external resources, browser exceptions, or failed HTTP responses');
    chapter('Engineering evidence', 'The code separates API orchestration, the worker, the seeded provider, and SQLite transactions. Reproducible tests cover timeouts, concurrent requests, failure rollback, ordered delivery, and restart recovery. The nine hundred second setting is validated separately; this recording does not claim a full fifteen minute wait.');
    await page.waitForTimeout(3000);
    await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify({status: 'passed', checks, browser: await browser.version(), httpRequests: requests.length, checkedAt: new Date().toISOString(), timeoutEvidence, externalRequests: external, errors}, null, 2));
    await fs.writeFile(path.join(output, 'video-chapters.json'), JSON.stringify(chapters, null, 2));
    console.log(`PASS: ${checks.length} browser checks, including real 32-second ingestion and recovery.`);
  } finally {
    await screenshot('last-browser-state').catch(() => {}); if (errors.length) console.error('Browser errors:', errors);
    await context.close(); await video.saveAs(path.join(output, 'walkthrough.webm')); await browser.close();
  }
}
module.exports = {run};
if (require.main === module) run().catch(error => {console.error(error); process.exitCode = 1;});
