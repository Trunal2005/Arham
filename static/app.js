/* No polling: snapshots on load/reconnect, user input, and committed WebSocket events. */
const $ = id => document.getElementById(id);
const state = {offset: 0, limit: 50, search: '', total: 0, cursor: 0, socket: null, retry: 500, busy: false, version: 0, closing: false};
const integer = new Intl.NumberFormat('en-IN');
const money = new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR', maximumFractionDigits: 2});
const compactMoney = new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 2});
const date = new Intl.DateTimeFormat('en-IN', {timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let toastTimer, searchTimer, reconnectTimer, refreshVersion = 0;

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    const detail = data.detail;
    throw new Error(typeof detail === 'string' ? detail : detail?.message || 'Request failed. Check the inputs and try again.');
  }
  return data;
}

function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => {$('toast').hidden = true;}, 5500);
}

async function loadTrades() {
  const version = ++state.version;
  const query = new URLSearchParams({limit: state.limit, offset: state.offset, search: state.search});
  const data = await api('/api/trades?' + query);
  if (version !== state.version) return;
  state.total = data.total;
  if (state.offset >= data.total && state.offset > 0) {state.offset = 0; return loadTrades();}
  $('ledger-count').textContent = integer.format(data.total);
  $('trade-rows').innerHTML = data.items.map(t => `<tr><td>${escape(t.trade_id)}</td><td>${escape(t.client)}</td><td><span class="symbol-tag">${escape(t.symbol)}</span></td><td class="numeric">${integer.format(t.quantity)}</td><td class="numeric">${money.format(t.price_paise / 100)}</td><td class="date-time">${escape(date.format(new Date(t.timestamp)))}</td></tr>`).join('');
  $('empty').hidden = data.total > 0;
  $('empty').querySelector('h3').textContent = state.search ? 'No matching trades' : 'No trades yet';
  $('empty').querySelector('p').textContent = state.search ? 'Try another symbol, client or trade ID.' : 'Start your first exchange pull. Your ledger will fill automatically when it completes.';
  $('empty-pull').hidden = Boolean(state.search);
  $('pagination-info').textContent = data.total ? `${integer.format(state.offset + 1)}–${integer.format(Math.min(state.offset + state.limit, data.total))} of ${integer.format(data.total)} trades` : '0 trades';
  $('page-number').textContent = `Page ${Math.floor(state.offset / state.limit) + 1}`;
  $('previous').disabled = state.offset === 0;
  $('next').disabled = state.offset + state.limit >= data.total;
}

function renderJobs(jobs) {
  const active = jobs.find(j => ['queued', 'running'].includes(j.status));
  state.busy = Boolean(active);
  $('open-pull').disabled = state.busy;
  $('empty-pull').disabled = state.busy;
  $('pull-banner').hidden = !active;
  if (active) {
    $('pull-state').textContent = active.status.toUpperCase();
    $('pull-title').textContent = active.status === 'queued' ? 'Exchange pull queued' : 'Exchange pull in progress';
    $('pull-detail').textContent = `${integer.format(active.record_count)} records · ${active.delay_seconds}s simulated delay. Saved trades remain available; updates arrive automatically.`;
  }
  const last = jobs.find(j => j.status === 'completed');
  $('last-update').textContent = last ? `Last pull ${date.format(new Date(last.finished_at))} IST` : 'No pulls completed yet';
  if (jobs.length && !$('pull-dialog').open) $('seed').value = Math.min(2147483647, jobs[0].seed + 1);
  $('activity').innerHTML = jobs.length ? jobs.map(j => `<article class="activity-item"><span class="activity-icon" aria-hidden="true">${j.status === 'completed' ? '✓' : j.status === 'failed' ? '!' : '↓'}</span><div class="activity-body"><div class="activity-row"><strong>Exchange pull</strong><span class="badge ${escape(j.status)}">${escape(j.status.toUpperCase())}</span></div><p>${integer.format(j.record_count)} records · Seed ${j.seed}</p>${j.status === 'completed' ? `<p>${integer.format(j.inserted_count)} added · ${integer.format(j.record_count - j.inserted_count)} duplicates skipped</p>` : ''}${j.error ? `<p class="activity-error">${escape(j.error)}</p>` : ''}<small>${escape(date.format(new Date(j.created_at)))} IST</small></div></article>`).join('') : '<p class="muted">No pulls yet. Your exchange activity will appear here.</p>';
}

async function refresh() {
  const version = ++refreshVersion;
  try {
    const [summary, jobs] = await Promise.all([api('/api/summary'), api('/api/pulls'), loadTrades()]);
    if (version !== refreshVersion) return;
    $('total-trades').textContent = integer.format(summary.trade_count);
    $('total-value').textContent = compactMoney.format(summary.value_paise / 100);
    $('total-value').title = money.format(summary.value_paise / 100);
    $('total-quantity').textContent = integer.format(summary.quantity);
    $('total-clients').textContent = integer.format(summary.client_count);
    renderJobs(jobs.items);
    $('symbols').innerHTML = summary.symbols.length ? summary.symbols.map(s => {
      const share = summary.value_paise ? s.value_paise / summary.value_paise * 100 : 0;
      return `<div class="symbol-row"><div class="symbol-label"><span>${escape(s.symbol)}</span><span>${share.toFixed(1)}%</span></div><div class="bar"><div style="width:${share.toFixed(2)}%"></div></div></div>`;
    }).join('') : '<p class="muted">Available after your first pull.</p>';
    showError('');
  } catch (error) {if (version === refreshVersion) showError(error.message);}
}

function connect() {
  if (state.closing) return;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${scheme}//${location.host}/ws?after=${state.cursor}`);
  state.socket = socket;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'connected') {
      state.retry = 500;
      $('connection').classList.remove('connecting');
      $('connection').innerHTML = '<span class="tiny-dot"></span>Live updates connected';
      refresh(); // Reconcile the latest snapshot after replay, including missed updates.
      return;
    }
    if (!message.id || message.id <= state.cursor) return;
    state.cursor = message.id;
    refresh();
    if (message.type === 'pull.completed') toast(`Pull complete. ${integer.format(message.payload.inserted_count)} new trades added.`);
    if (message.type === 'pull.failed') toast(message.payload.error || 'Pull failed. Please retry.');
  };
  socket.onclose = () => {
    if (state.closing) return;
    $('connection').classList.add('connecting');
    $('connection').innerHTML = '<span class="tiny-dot"></span>Reconnecting to live updates…';
    reconnectTimer = setTimeout(connect, state.retry);
    state.retry = Math.min(state.retry * 2, 10000);
  };
  socket.onerror = () => socket.close();
}

function openDialog() {
  $('form-error').hidden = true;
  $('pull-dialog').showModal();
}
$('open-pull').onclick = openDialog;
$('empty-pull').onclick = openDialog;
$('close-dialog').onclick = () => $('pull-dialog').close();
$('pull-dialog').addEventListener('click', e => {if (e.target === $('pull-dialog') && e.offsetX >= 0 && e.offsetY >= 0 && (e.offsetX > e.target.clientWidth || e.offsetY > e.target.clientHeight)) e.target.close();});
$('pull-form').onsubmit = async event => {
  event.preventDefault();
  $('submit-pull').disabled = true;
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
  } finally {$('submit-pull').disabled = false;}
};
$('search').oninput = () => {clearTimeout(searchTimer); searchTimer = setTimeout(() => {state.search = $('search').value.trim(); state.offset = 0; loadTrades().catch(e => showError(e.message));}, 200);};
$('page-size').onchange = () => {state.limit = Number($('page-size').value); state.offset = 0; loadTrades().catch(e => showError(e.message));};
$('previous').onclick = () => {state.offset = Math.max(0, state.offset - state.limit); loadTrades().catch(e => showError(e.message));};
$('next').onclick = () => {state.offset += state.limit; loadTrades().catch(e => showError(e.message));};
window.addEventListener('pagehide', () => {state.closing = true; clearTimeout(reconnectTimer); state.socket?.close();});
window.addEventListener('pageshow', e => {if (e.persisted) {state.closing = false; connect();}});
refresh();
connect();
