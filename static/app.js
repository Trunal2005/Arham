/* No polling: snapshots on load/reconnect, user input, and committed WebSocket events. */
const $ = id => document.getElementById(id);
const state = {offset: 0, limit: 50, search: '', total: 0, cursor: 0, socket: null, retry: 500, busy: false, closing: false, submitting: false, timer: null, renderTimings: new Map(), latestJob: null, loaded: false, snapshotError: false, highlightJob: null, highlightUntil: 0};
const integer = new Intl.NumberFormat('en-IN');
const money = new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR', maximumFractionDigits: 2});
const compactMoney = new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 2});
const date = new Intl.DateTimeFormat('en-IN', {timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
const executionTime = new Intl.DateTimeFormat('en-IN', {timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
const executionDate = new Intl.DateTimeFormat('en-IN', {timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'});
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let toastTimer, searchTimer, reconnectTimer, timerFrame, highlightTimer, refreshVersion = 0;

async function api(path, options = {}) {
  const response = await fetch(path, {cache: 'no-store', ...options});
  let data;
  try {data = await response.json();} catch {throw new Error(`Server returned HTTP ${response.status}. Retry this action.`);}
  if (!response.ok) {
    const detail = data.detail;
    const message = Array.isArray(detail) ? detail.map(d => `${d.loc.at(-1)}: ${d.msg}`).join('; ') : detail?.message;
    throw new Error(typeof detail === 'string' ? detail : message || `Request failed (HTTP ${response.status}). Retry this action.`);
  }
  return data;
}

function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
function toast(message, tone = 'success') {
  clearTimeout(toastTimer);
  $('toast').dataset.tone = tone;
  $('toast').setAttribute('role', tone === 'error' ? 'alert' : 'status');
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => {$('toast').hidden = true;}, 5500);
}

function renderTrades(data) {
  const scroller = document.querySelector('.table-wrap');
  const scroll = [scroller.scrollLeft, scroller.scrollTop];
  state.total = data.total;
  $('ledger-count').textContent = integer.format(data.total);
  $('trade-rows').innerHTML = data.items.map(t => {
    const isNew = t.job_id === state.highlightJob && performance.now() < state.highlightUntil;
    const timestamp = new Date(t.timestamp);
    return `<tr${isNew ? ' class="new-row"' : ''}><td>${escape(t.trade_id)}${isNew ? '<span class="new-tag">NEW</span>' : ''}</td><td>${escape(t.client)}</td><td><span class="symbol-tag">${escape(t.symbol)}</span></td><td class="numeric">${integer.format(t.quantity)}</td><td class="numeric">${money.format(t.price_paise / 100)}</td><td class="date-time"><time datetime="${escape(t.timestamp)}"><span>${escape(executionTime.format(timestamp))}</span><small>${escape(executionDate.format(timestamp))} · IST</small></time></td></tr>`;
  }).join('');
  $('empty').hidden = data.total > 0;
  $('empty').querySelector('h3').textContent = state.search ? 'No matching trades' : 'Your ledger starts here';
  $('empty').querySelector('p').textContent = state.search ? 'Try another symbol, client or trade reference. Your other saved trades are still available.' : 'Pull your first batch from the mock exchange. New trades appear here automatically when the pull finishes.';
  $('empty-pull').hidden = Boolean(state.search);
  $('pagination-info').textContent = data.total ? `${integer.format(state.offset + 1)}–${integer.format(Math.min(state.offset + state.limit, data.total))} of ${integer.format(data.total)} trades` : '0 trades';
  $('page-number').textContent = `Page ${Math.floor(state.offset / state.limit) + 1}`;
  $('previous').disabled = state.offset === 0;
  $('next').disabled = state.offset + state.limit >= data.total;
  scroller.scrollLeft = scroll[0];
  scroller.scrollTop = scroll[1];
}

function updateElapsed() {
  if (!state.timer) return;
  const elapsed = Math.floor(state.timer.base + (performance.now() - state.timer.anchor) / 1000);
  const text = `Elapsed ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  if ($('pull-elapsed').textContent !== text) $('pull-elapsed').textContent = text;
  // This only paints a local clock; it makes no HTTP/status requests.
  timerFrame = requestAnimationFrame(updateElapsed);
}

function renderJobs(jobs, serverTime) {
  const active = jobs.find(j => ['queued', 'running'].includes(j.status));
  state.latestJob = active || jobs[0] || null;
  state.busy = Boolean(active);
  $('open-pull').disabled = state.busy || state.submitting;
  $('empty-pull').disabled = state.busy || state.submitting;
  $('pull-banner').hidden = !active;
  if (active) {
    $('pull-job-id').textContent = `Job ${active.id}`;
    $('pull-delay').textContent = active.delay_seconds === 900 ? '15 min / 900s' : `${active.delay_seconds} seconds`;
    $('pull-records').textContent = integer.format(active.record_count);
    const key = active.id + (active.started_at || active.created_at);
    if (state.timer?.key !== key) {
      cancelAnimationFrame(timerFrame);
      state.timer = {key, anchor: performance.now(), base: Math.max(0, (Date.parse(serverTime) - Date.parse(active.started_at || active.created_at)) / 1000)};
      updateElapsed();
    }
  } else {
    state.timer = null;
    cancelAnimationFrame(timerFrame);
  }
  renderIngestion(state.latestJob);
  const last = jobs.find(j => j.status === 'completed');
  $('last-update').textContent = last ? `Last pull ${date.format(new Date(last.finished_at))} IST` : 'No pulls completed yet';
  if (jobs.length && !$('pull-dialog').open) $('seed').value = Math.min(2147483647, jobs[0].seed + 1);
  $('activity').innerHTML = jobs.length ? jobs.map(j => `<article class="activity-item"><span class="activity-icon" aria-hidden="true">${j.status === 'completed' ? '✓' : j.status === 'failed' ? '!' : '↓'}</span><div class="activity-body"><div class="activity-row"><strong>Dataset ${j.seed}</strong><span class="badge ${escape(j.status)}">${escape(j.status.toUpperCase())}</span></div><p>${integer.format(j.record_count)} records · ${j.delay_seconds}s delay</p>${j.status === 'completed' ? `<p>${integer.format(j.inserted_count)} added · ${integer.format(j.record_count - j.inserted_count)} duplicates skipped</p>` : ''}${j.error ? `<p class="activity-error">${escape(j.error)}</p>` : ''}<small>${escape(date.format(new Date(j.created_at)))} IST</small></div></article>`).join('') : '<p class="muted">No exchange pulls yet. Start a pull to see its status and results here.</p>';
}

function renderIngestion(job) {
  const status = job?.status || 'ready';
  const active = ['queued', 'running'].includes(status);
  $('ingestion-panel').dataset.state = status;
  // The panel is readable during processing; don't defer its live status announcements.
  $('ingestion-panel').setAttribute('aria-busy', 'false');
  $('pull-state').textContent = status.toUpperCase();
  $('retry-pull').hidden = status !== 'failed';
  $('retry-pull').textContent = 'Retry pull';
  $('ledger-link').hidden = state.total === 0 || status === 'failed';
  $('pull-result').hidden = !job || active;
  const icon = status === 'completed' ? 'i-check' : 'i-download';
  $('ingestion-icon').innerHTML = status === 'failed' ? '!' : `<svg class="icon"><use href="#${icon}"/></svg>`;
  if (!job) {
    $('pull-title').textContent = 'Ready for your first exchange pull';
    $('pull-detail').textContent = 'Choose a dataset and processing delay. Trades will appear here automatically when the pull finishes.';
  } else if (active) {
    $('pull-title').textContent = status === 'queued' ? 'Your exchange pull is queued' : 'Exchange pull in progress';
    $('pull-detail').textContent = 'Keep working with your saved trades. The ledger updates automatically after this batch is committed.';
  } else {
    const completed = status === 'completed';
    $('pull-title').textContent = completed ? 'Latest pull completed' : 'Exchange pull interrupted';
    $('pull-detail').textContent = completed ? `${integer.format(job.inserted_count)} new records added. ${integer.format(job.record_count - job.inserted_count)} duplicates skipped. Your saved ledger is available below.` : `${job.error || 'The exchange pull could not finish.'} Your saved trades are unchanged. Retry when you are ready.`;
    $('result-inserted').textContent = integer.format(job.inserted_count);
    $('result-duplicates').textContent = completed ? integer.format(job.record_count - job.inserted_count) : '—';
    $('result-duration').textContent = job.started_at && job.finished_at ? `${Math.max(0, (Date.parse(job.finished_at) - Date.parse(job.started_at)) / 1000).toFixed(1)}s` : 'Not started';
    $('result-job').textContent = job.id;
  }
  const phases = {accepted: job ? 'done' : '', processing: status === 'running' ? 'current' : status === 'completed' ? 'done' : status === 'failed' ? 'error' : '', committed: status === 'completed' ? 'done' : '', updated: status === 'completed' ? 'done' : ''};
  document.querySelectorAll('#sync-steps li').forEach((step, index) => {
    const phase = phases[step.dataset.step];
    step.className = phase;
    step.querySelector('span').textContent = phase === 'done' ? '✓' : phase === 'error' ? '!' : String(index + 1);
    step.querySelector('span').setAttribute('aria-hidden', 'true');
    step.setAttribute('aria-current', phase === 'current' ? 'step' : 'false');
  });
}

async function refresh() {
  const version = ++refreshVersion;
  document.querySelector('.trades-panel').setAttribute('aria-busy', 'true');
  try {
    const query = new URLSearchParams({limit: state.limit, offset: state.offset, search: state.search});
    const data = await api('/api/dashboard?' + query);
    if (version !== refreshVersion) return;
    const {summary, jobs, trades} = data;
    if (state.offset >= trades.total && state.offset > 0) {state.offset = 0; return refresh();}
    renderTrades(trades);
    $('total-trades').textContent = integer.format(summary.trade_count);
    $('total-value').textContent = compactMoney.format(summary.value_paise / 100);
    $('total-value').title = money.format(summary.value_paise / 100);
    $('total-quantity').textContent = integer.format(summary.quantity);
    $('total-clients').textContent = integer.format(summary.client_count);
    renderJobs(jobs, data.server_time);
    state.loaded = true;
    state.snapshotError = false;
    $('metrics').classList.remove('is-loading');
    $('ledger-loading').hidden = true;
    $('symbols').innerHTML = summary.symbols.length ? summary.symbols.map(s => {
      const share = summary.value_paise ? s.value_paise / summary.value_paise * 100 : 0;
      return `<div class="symbol-row"><div class="symbol-label"><span>${escape(s.symbol)}</span><span>${share.toFixed(1)}%</span></div><div class="bar"><div style="width:${share.toFixed(2)}%"></div></div></div>`;
    }).join('') : '<p class="muted">Available after your first pull.</p>';
    showError('');
    for (const [id, timing] of state.renderTimings) {
      if (jobs.some(j => j.id === timing.jobId && j.status === 'completed')) {
        state.renderTimings.delete(id);
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('arham:rendered', {detail: {...timing, eventId: id, renderedAt: performance.now()}})));
      }
    }
  } catch (error) {if (version === refreshVersion) {
    showError(error.message);
    $('pagination-info').textContent = state.loaded ? 'Could not update ledger. Saved rows remain visible.' : 'Ledger unavailable. Retry the connection.';
    if (!state.loaded) {
      state.snapshotError = true;
      $('metrics').classList.remove('is-loading');
      $('ledger-loading').hidden = true;
      $('ingestion-panel').dataset.state = 'failed';
      $('pull-state').textContent = 'UNAVAILABLE';
      $('pull-title').textContent = 'We couldn’t load your ledger';
      $('pull-detail').textContent = 'Check that the local server is running, then retry. No exchange pull has been started.';
      $('ingestion-icon').textContent = '!';
      $('open-pull').disabled = true;
      $('empty-pull').disabled = true;
      $('ledger-link').hidden = true;
      $('ledger-count').textContent = '—';
      $('activity').innerHTML = '<p class="muted">Pull history is temporarily unavailable.</p>';
      $('symbols').innerHTML = '<p class="muted">The symbol breakdown will return when your connection is restored.</p>';
      $('retry-pull').textContent = 'Retry loading';
      $('retry-pull').hidden = false;
    }
  }}
  finally {if (version === refreshVersion) document.querySelector('.trades-panel').setAttribute('aria-busy', 'false');}
}

const loadTrades = refresh;

function connect() {
  if (state.closing) return;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${scheme}//${location.host}/ws?after=${state.cursor}`);
  state.socket = socket;
  let replaying = true;
  socket.onmessage = event => {
    if (socket !== state.socket) return;
    const message = JSON.parse(event.data);
    if (message.type === 'connected') {
      state.cursor = message.cursor;
      replaying = false;
      state.retry = 500;
      $('connection').classList.remove('connecting');
      $('connection').innerHTML = '<span class="tiny-dot"></span>Live updates connected';
      refresh(); // Reconcile the latest snapshot after replay, including missed updates.
      return;
    }
    if (!message.id || message.id <= state.cursor) return;
    state.cursor = message.id;
    if (replaying) return; // Reconcile once after replay; don't toast historical jobs.
    window.dispatchEvent(new CustomEvent('arham:received', {detail: {...message, receivedAt: performance.now()}}));
    if (message.type === 'pull.queued') {
      $('update-feedback').hidden = true;
      state.highlightUntil = 0;
      document.querySelectorAll('.new-tag').forEach(tag => tag.remove());
      document.querySelectorAll('.new-row').forEach(row => row.classList.remove('new-row'));
    }
    if (message.type === 'pull.completed') {
      state.renderTimings.set(message.id, {jobId: message.payload.job_id, receivedAt: performance.now()});
      state.highlightJob = message.payload.job_id;
      state.highlightUntil = performance.now() + 9000;
      $('update-feedback').textContent = `✓ Ledger updated automatically · ${integer.format(message.payload.inserted_count)} new records added`;
      $('update-feedback').hidden = false;
      document.querySelectorAll('.metric').forEach(card => {card.classList.remove('metric-updated'); requestAnimationFrame(() => card.classList.add('metric-updated'));});
      clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => {document.querySelectorAll('.new-row').forEach(row => row.classList.remove('new-row')); document.querySelectorAll('.new-tag').forEach(tag => tag.remove());}, 9000);
    }
    refresh();
    if (message.type === 'pull.completed') toast(`Pull complete. ${integer.format(message.payload.inserted_count)} new trades added.`);
    if (message.type === 'pull.failed') toast(message.payload.error || 'Pull failed. Please retry.', 'error');
  };
  socket.onclose = () => {
    if (state.closing || socket !== state.socket) return;
    $('connection').classList.add('connecting');
    $('connection').innerHTML = '<span class="tiny-dot"></span>Reconnecting to live updates…';
    reconnectTimer = setTimeout(connect, state.retry);
    state.retry = Math.min(state.retry * 2, 10000);
  };
  socket.onerror = () => socket.close();
}

function openDialog() {
  if (state.busy || state.submitting) return;
  state.dialogTrigger = document.activeElement;
  $('form-error').hidden = true;
  $('pull-dialog').showModal();
  $('delay').focus();
  updatePresetSelection();
}
$('open-pull').onclick = openDialog;
$('empty-pull').onclick = openDialog;
$('close-dialog').onclick = () => $('pull-dialog').close();
$('pull-dialog').addEventListener('close', () => {if (!state.dialogTrigger?.disabled) state.dialogTrigger?.focus(); else $('search').focus();});
function updatePresetSelection() {document.querySelectorAll('[data-delay]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.delay) === Number($('delay').value))));}
document.querySelectorAll('[data-delay]').forEach(button => {button.onclick = () => {$('delay').value = button.dataset.delay; updatePresetSelection(); $('delay').focus();};});
$('delay').addEventListener('input', updatePresetSelection);
$('retry-pull').onclick = () => {
  if (state.snapshotError) {refresh(); return;}
  const job = state.latestJob;
  openDialog();
  if (job) {$('delay').value = job.delay_seconds; $('seed').value = job.seed; $('record-count').value = job.record_count; updatePresetSelection();}
};
$('pull-dialog').addEventListener('click', e => {if (e.target === $('pull-dialog') && e.offsetX >= 0 && e.offsetY >= 0 && (e.offsetX > e.target.clientWidth || e.offsetY > e.target.clientHeight)) e.target.close();});
$('pull-form').onsubmit = async event => {
  event.preventDefault();
  if (state.submitting || state.busy) return;
  state.submitting = true;
  $('submit-pull').disabled = true;
  $('submit-label').textContent = 'Starting pull…';
  $('form-error').hidden = true;
  try {
    const parameters = new URLSearchParams({delay_seconds: $('delay').value, record_count: $('record-count').value, seed: $('seed').value});
    await api('/getTrades?' + parameters);
    $('pull-dialog').close();
    toast('Pull accepted. You can keep using your saved trades.');
    await refresh();
  } catch (error) {
    $('form-error').textContent = error.message;
    $('form-error').hidden = false;
    refresh();
  } finally {state.submitting = false; $('submit-pull').disabled = false; $('submit-label').textContent = 'Start background pull'; $('open-pull').disabled = state.busy; $('empty-pull').disabled = state.busy;}
};
$('search').oninput = () => {clearTimeout(searchTimer); searchTimer = setTimeout(() => {state.search = $('search').value.trim(); state.offset = 0; loadTrades().catch(e => showError(e.message));}, 200);};
$('page-size').onchange = () => {state.limit = Number($('page-size').value); state.offset = 0; loadTrades().catch(e => showError(e.message));};
$('previous').onclick = () => {state.offset = Math.max(0, state.offset - state.limit); loadTrades().catch(e => showError(e.message));};
$('next').onclick = () => {state.offset += state.limit; loadTrades().catch(e => showError(e.message));};
window.addEventListener('pagehide', () => {state.closing = true; clearTimeout(reconnectTimer); state.socket?.close();});
window.addEventListener('pageshow', e => {if (e.persisted) {state.closing = false; connect();}});
refresh();
connect();
