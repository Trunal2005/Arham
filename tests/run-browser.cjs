/* Owns only its isolated API/worker process tree. The application has no polling. */
const {spawn, execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

async function main() {
  const suite = process.env.UI_PHASE ? './ui-visual.cjs' : './browser.cjs';
  if (process.env.BASE_URL) return require(suite).run();
  const root = path.resolve(__dirname, '..');
  const folder = path.join(root, 'test-results', `browser-${Date.now()}`);
  fs.mkdirSync(folder, {recursive: true});
  const python = process.env.PYTHON_EXECUTABLE || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const port = await new Promise(resolve => {const s = net.createServer(); s.listen(0, '127.0.0.1', () => {const port = s.address().port; s.close(() => resolve(port));});});
  process.env.BASE_URL = `http://127.0.0.1:${port}`;
  const log = fs.openSync(path.join(folder, 'server.log'), 'a');
  const tracePath = path.join(folder, 'trace.jsonl');
  let server;
  async function start() {
    server = spawn(python, ['-m', 'uvicorn', 'arham.app:app', '--host', '127.0.0.1', '--port', String(port)], {cwd: root, windowsHide: true, stdio: ['ignore', log, log], env: {...process.env, ARHAM_DB: path.join(folder, 'browser.sqlite3'), ARHAM_TRACE: tracePath}});
    let spawnError;
    server.on('error', error => {spawnError = error;});
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      try {if ((await fetch(process.env.BASE_URL + '/api/health')).ok) return;} catch {}
      if (server.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(fs.readFileSync(path.join(folder, 'server.log'), 'utf8'));
  }
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const exited = new Promise(resolve => server.once('exit', resolve));
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
    else server.kill('SIGTERM');
    await exited;
  }
  try {
    await start();
    await require(suite).run({restartServer: async () => {await stop(); await start();}, crashWorker: async () => {
      const health = await (await fetch(process.env.BASE_URL + '/api/health')).json();
      if (!Number.isInteger(health.worker_pid) || health.worker_pid <= 0) throw new Error('Missing owned worker PID');
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(health.worker_pid), '/F'], {windowsHide: true, stdio: 'ignore'});
      else process.kill(health.worker_pid, 'SIGKILL');
    }, tracePath});
  } finally {await stop(); fs.closeSync(log);}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
