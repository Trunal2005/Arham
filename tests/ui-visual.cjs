/* Matching before/after data, viewport and real worker states; never mutates demo DB. */
const {chromium} = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

async function run(controls = {}) {
  const phase = process.env.UI_PHASE || 'after';
  const output = path.resolve('docs/evidence/ui', phase);
  await fs.mkdir(output, {recursive: true});
  const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {})});
  const context = await browser.newContext({viewport: {width: 1440, height: 1050}});
  const page = await context.newPage();
  const url = process.env.BASE_URL;
  const errors = [], checks = [], injectedErrors = [];
  let expectedHttpFailure = false;
  let delayInitialSnapshot = phase === 'after';
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => {if (r.status() >= 400) {
    if (expectedHttpFailure && new URL(r.url()).pathname === '/api/dashboard') injectedErrors.push(r.status());
    else errors.push(`${r.status()} ${r.url()}`);
  }});
  const total = value => page.waitForFunction(text => document.getElementById('total-trades').textContent === text, value);
  const snap = name => page.screenshot({path: path.join(output, name + '.png'), fullPage: true});
  async function pull(seed, delay = 0, count = 3000) {
    const response = await context.request.post(url + '/api/pulls', {data: {seed, delay_seconds: delay, record_count: count}});
    assert.equal(response.status(), 202);
    return (await response.json()).job_id;
  }
  try {
    if (phase === 'after') await page.route('**/api/dashboard?*', async route => {if (delayInitialSnapshot) await new Promise(resolve => setTimeout(resolve, 1200)); await route.continue();});
    await page.goto(url, {waitUntil: 'domcontentloaded'});
    if (phase === 'after') {
      await page.locator('#ledger-loading').waitFor({state: 'visible'});
      assert.equal(await page.locator('#metrics').evaluate(e => e.classList.contains('is-loading')), true);
      await snap('loading-desktop');
      delayInitialSnapshot = false;
      checks.push('honest skeleton loading before snapshot');
    }
    await total('0');
    await snap('empty-desktop');
    await pull(42); await total('3,000'); await pull(43); await total('6,000');
    await page.waitForTimeout(5500); // Let transient toast clear for a fair visual comparison.
    await snap('dashboard-desktop');
    if (phase === 'after') await page.screenshot({path: path.join(output, 'dashboard-viewport.png')});
    await page.setViewportSize({width: 390, height: 844}); await snap('dashboard-mobile');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({width: 1440, height: 1050});
    if (phase === 'after') {
      await page.setViewportSize({width: 1024, height: 900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await snap('dashboard-tablet');
      await page.setViewportSize({width: 1440, height: 1050});
      checks.push('tablet layout without document overflow');
    }
    await page.getByRole('button', {name: 'Pull exchange data', exact: true}).first().click();
    await snap('configuration'); await page.keyboard.press('Escape');
    const activeId = await pull(44, 8);
    await page.locator('#pull-banner').waitFor({state: 'visible'});
    await page.waitForTimeout(1100);
    await snap('running-desktop');
    if (phase === 'after') await page.screenshot({path: path.join(output, 'running-viewport.png')});
    await page.setViewportSize({width: 390, height: 844}); await snap('running-mobile');
    assert.equal(await page.locator('#total-trades').textContent(), '6,000');
    assert.ok((await page.locator('#pull-job-id').textContent()).includes(activeId));
    assert.match(await page.locator('#pull-elapsed').textContent(), /Elapsed/);
    await page.setViewportSize({width: 1440, height: 1050}); await total('9,000');
    await snap('success-desktop');
    checks.push('matching seeded data', 'desktop/mobile without overflow', 'real active job ID and elapsed', 'saved trades during pull', 'automatic success');
    if (controls.crashWorker) {
      await pull(45, 20, 100); await page.locator('#pull-banner').waitFor({state: 'visible'});
      await controls.crashWorker();
      await page.waitForFunction(() => document.querySelector('.activity-item .badge')?.textContent === 'FAILED');
      if (phase === 'after') assert.equal(await page.locator('#toast').getAttribute('data-tone'), 'error');
      await snap('failure-desktop');
      assert.equal(await page.locator('#total-trades').textContent(), '9,000');
      checks.push('real worker failure preserves cached data');
    }
    if (phase === 'after') {
      assert.equal(await page.locator('#ingestion-panel').getAttribute('data-state'), 'failed');
      await page.getByRole('button', {name: 'Retry pull', exact: true}).click();
      assert.equal(await page.locator('#seed').inputValue(), '45');
      assert.equal(await page.locator('#record-count').inputValue(), '100');
      await page.locator('#delay').fill('0');
      await page.getByRole('button', {name: 'Start background pull'}).click();
      await total('9,100');
      assert.equal(await page.locator('#ingestion-panel').getAttribute('data-state'), 'completed');
      assert.equal(await page.locator('#result-inserted').textContent(), '100');
      checks.push('retry prefilled correctly and recovers');
      expectedHttpFailure = true;
      await page.route('**/api/dashboard?*', route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({detail: 'Test: temporary database unavailability'})}));
      await page.reload();
      await page.getByRole('button', {name: 'Retry loading', exact: true}).waitFor();
      await snap('connection-error');
      assert.equal(await page.locator('#empty').isVisible(), false);
      await page.unrouteAll({behavior: 'wait'});
      await page.getByRole('button', {name: 'Retry loading', exact: true}).click();
      await total('9,100');
      expectedHttpFailure = false;
      assert.equal(await page.locator('#error').isVisible(), false);
      checks.push('injected 503 has explicit error state and manual retry');
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({phase, status: 'passed', checks, errors, deliberatelyInjectedHttpStatuses: injectedErrors, browser: await browser.version(), viewport: {width: 1440, height: 1050}, dataset: 'seeds 42+43: 6000; running seed44: +3000', checkedAt: new Date().toISOString()}, null, 2));
    console.log(`PASS: ${phase} UI states captured and ${checks.length} checks verified.`);
  } finally {await page.unrouteAll({behavior: 'wait'}); await context.close(); await browser.close();}
}
module.exports = {run};
