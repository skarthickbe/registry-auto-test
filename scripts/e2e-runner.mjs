// Lets the checklist UI start Playwright, which a browser cannot do itself.
//
//   POST /run         start `playwright test -c e2e` (409 while a run is in progress);
//                     body { "headed": true } shows the browser, slowed down to follow
//   GET  /status      { state, startedAt, finishedAt, exitCode, log }
//   GET  /results     latest results written by e2e/checklist-reporter.ts
//   GET  /shots/<png> a screenshot from those results
//   GET  /live/frame.jpg, /live/test.json  the running test's browser and title (e2e/fixtures.ts)
//
// Listens on 127.0.0.1 only and runs one fixed command; the UI reaches it through
// the dev-server proxy (proxy.conf.json, /e2e-api → this server).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.E2E_RUNNER_PORT ?? 4400);
const RESULTS_DIR = path.join(ROOT, 'e2e', 'ui-results');
const LIVE_DIR = path.join(RESULTS_DIR, 'live');

let status = { state: 'idle' };
let log = [];

const SLOW_MO_MS = 600;

function startRun({ headed = false } = {}) {
  if (status.state === 'running') return false;
  log = [];
  status = { state: 'running', startedAt: new Date().toISOString(), headed };
  fs.rmSync(LIVE_DIR, { recursive: true, force: true });
  const child = spawn('npx', ['playwright', 'test', '-c', 'e2e', ...(headed ? ['--headed'] : [])], {
    cwd: ROOT,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      SLOW_MO: headed ? String(SLOW_MO_MS) : '0',
      LIVE_VIEW: '1',
    },
  });
  const collect = (chunk) => {
    log.push(...chunk.toString().split('\n').filter((l) => l.trim()));
    log = log.slice(-200);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  // Exit code 1 means some tests failed; the run itself still finished.
  child.on('close', (code) => {
    status = { ...status, state: 'finished', finishedAt: new Date().toISOString(), exitCode: code };
    console.log(`[e2e-runner] run finished with exit code ${code}`);
  });
  child.on('error', (e) => {
    status = { ...status, state: 'error', finishedAt: new Date().toISOString(), error: e.message };
  });
  console.log('[e2e-runner] run started');
  return true;
}

http
  .createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && req.url === '/run') {
      let body = '';
      req.on('data', (chunk) => (body += chunk).length > 1000 && req.destroy());
      req.on('end', () => {
        let headed = false;
        try {
          // Only this boolean is read from the request; nothing else reaches the command.
          headed = JSON.parse(body || '{}').headed === true;
        } catch {
          return send(400, { error: 'Body must be JSON' });
        }
        send(startRun({ headed }) ? 202 : 409, status);
      });
      return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/status')) return send(200, { ...status, log: log.slice(-20) });
    if (req.method === 'GET' && req.url?.startsWith('/results')) {
      const file = path.join(RESULTS_DIR, 'results.json');
      if (!fs.existsSync(file)) return send(404, { error: 'No results yet' });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }
    // Only plain file names from the shots folder, never paths.
    const shot = /^\/shots\/([\w.-]+\.png)$/.exec(req.url ?? '');
    if (req.method === 'GET' && shot) {
      const file = path.join(RESULTS_DIR, 'shots', shot[1]);
      if (!fs.existsSync(file)) return send(404, { error: 'No such screenshot' });
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return fs.createReadStream(file).pipe(res);
    }
    const live = /^\/live\/(frame\.jpg|test\.json)(\?.*)?$/.exec(req.url ?? '');
    if (req.method === 'GET' && live) {
      const file = path.join(LIVE_DIR, live[1]);
      if (!fs.existsSync(file)) return send(404, { error: 'Nothing live yet' });
      res.writeHead(200, {
        'Content-Type': live[1].endsWith('.jpg') ? 'image/jpeg' : 'application/json',
        'Cache-Control': 'no-store',
      });
      return fs.createReadStream(file).pipe(res);
    }
    send(404, { error: 'Not found' });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[e2e-runner] listening on http://127.0.0.1:${PORT}`));
