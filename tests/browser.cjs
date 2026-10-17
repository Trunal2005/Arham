/* Run against an empty test database: ARHAM_DB=test-results/browser.sqlite3. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const output = path.resolve('docs/evidence');
  await fs.mkdir(output, {recursive: true});
  const launch = {headless: true};
  if (process.env.BROWSER_EXECUTABLE) launch.executablePath = process.env.BROWSER_EXECUTABLE;
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, recordVideo: {dir: path.resolve('test-results/video'), size: {width: 1440, height: 1000}}});
  const errors = [], requests = [];
  const page = await context.newPage();
  const second = await context.newPage();
  for (const tab of [page, second]) {
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('response', response => {if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);});
  }
  page.on('request', request => requests.push(request.url()));
  const url = process.env.BASE_URL || 'http://127.0.0.1:8000';
  const video = page.video();
  try {
    await page.goto(url);
    await second.goto(url);
    await page.getByText('Live updates connected', {exact: true}).waitFor();
    await second.getByText('Live updates connected', {exact: true}).waitFor();
    await page.bringToFront();
    await page.waitForFunction(() => document.getElementById('total-trades').textContent === '0');
    await page.screenshot({path: path.join(output, 'empty-desktop.png'), fullPage: true});
    // A disconnected interval has no timers fetching data. Reconnection is separately tested.
    const beforeIdle = requests.length;
    await page.waitForTimeout(2500);
    assert.equal(requests.length, beforeIdle, 'Idle dashboard must not poll HTTP');

    await page.getByRole('button', {name: 'Pull exchange data', exact: true}).first().click();
    await page.locator('#delay').fill('12');
    await page.locator('#record-count').fill('3000');
    await page.locator('#seed').fill('42');
    await page.screenshot({path: path.join(output, 'pull-configuration.png'), fullPage: true});
    await page.getByRole('button', {name: 'Start background pull'}).click();
    await page.locator('#pull-banner').waitFor({state: 'visible'});
    await page.screenshot({path: path.join(output, 'pull-in-progress.png'), fullPage: true});
    await page.waitForFunction(() => document.getElementById('total-trades').textContent === '3,000');
    await second.waitForFunction(() => document.getElementById('total-trades').textContent === '3,000');
    assert.equal(await page.locator('#trade-rows tr').count(), 50);
    await page.screenshot({path: path.join(output, 'dashboard-desktop.png'), fullPage: true});

    await page.locator('#search').fill('RELIANCE');
    await page.waitForFunction(() => [...document.querySelectorAll('.symbol-tag')].length > 0 && [...document.querySelectorAll('.symbol-tag')].every(e => e.textContent === 'RELIANCE'));
    await page.screenshot({path: path.join(output, 'search.png'), fullPage: true});
    await page.locator('#search').fill('');
    await page.waitForFunction(() => document.getElementById('ledger-count').textContent === '3,000');
    const firstId = await page.locator('#trade-rows tr td').first().textContent();
    await page.getByRole('button', {name: 'Next page'}).click();
    await page.waitForFunction(id => document.querySelector('#trade-rows td').textContent !== id, firstId);
    assert.equal(await page.locator('#page-number').textContent(), 'Page 2');

    // An already populated ledger stays usable throughout another pull.
    await page.getByRole('button', {name: 'Pull exchange data', exact: true}).first().click();
    await page.locator('#delay').fill('5');
    await page.locator('#seed').fill('43');
    await page.getByRole('button', {name: 'Start background pull'}).click();
    await page.locator('#pull-banner').waitFor({state: 'visible'});
    assert.equal(await page.locator('#trade-rows tr').count(), 50);
    await page.screenshot({path: path.join(output, 'cached-trades-during-pull.png'), fullPage: true});
    await page.waitForFunction(() => document.getElementById('total-trades').textContent === '6,000');
    await second.waitForFunction(() => document.getElementById('total-trades').textContent === '6,000');

    // Disconnect tab two during a third pull; reconnect must reconcile the missed event.
    const offline = await browser.newContext({viewport: {width: 390, height: 844}});
    const mobile = await offline.newPage();
    await mobile.goto(url);
    await mobile.waitForFunction(() => document.getElementById('total-trades').textContent === '6,000');
    await offline.setOffline(true);
    await mobile.evaluate(() => state.socket.close());
    await mobile.getByText('Reconnecting to live updates…', {exact: true}).waitFor();
    const response = await context.request.post(url + '/api/pulls', {data: {delay_seconds: .5, record_count: 100, seed: 44}});
    assert.equal(response.status(), 202);
    await page.waitForFunction(() => document.getElementById('total-trades').textContent === '6,100');
    await offline.setOffline(false);
    await mobile.waitForFunction(() => document.getElementById('total-trades').textContent === '6,100', null, {timeout: 15000});
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile page must not overflow horizontally');
    await mobile.screenshot({path: path.join(output, 'dashboard-mobile.png'), fullPage: true});
    await offline.close();

    const afterIdle = requests.length;
    await page.waitForTimeout(2500);
    assert.equal(requests.length, afterIdle, 'Populated dashboard must not poll HTTP');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify({status: 'passed', checks: ['empty state', 'idle without polling', 'background pull', 'two-tab live update', 'search', 'pagination', 'cached trades during pull', 'offline reconnect', 'mobile layout', 'no browser errors'], browser: await browser.version(), httpRequests: requests.length, checkedAt: new Date().toISOString()}, null, 2));
    console.log('PASS: 10 browser acceptance checks; no console or HTTP errors.');
  } finally {
    await page.screenshot({path: path.join(output, 'last-browser-state.png'), fullPage: true}).catch(() => {});
    if (errors.length) console.error('Browser errors:', errors);
    await context.close();
    await video.saveAs(path.join(output, 'walkthrough.webm'));
    await browser.close();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
