#!/usr/bin/env node
/**
 * Trailer capture driver (dev only).
 *
 * The trailer is shot inside the real game: this script starts a dev server,
 * launches Chrome on a private profile, and asks the in-page director
 * (`tools/trailer/stage.js`) to stage a shot, drive the camera and record the
 * composite. Frames and clips come back over a loopback sink because a page
 * cannot write files.
 *
 *   node tools/trailer/capture.mjs stills            # framing checks -> trailer/raw/*.png
 *   node tools/trailer/capture.mjs stills contact    # one shot
 *   node tools/trailer/capture.mjs record            # every shot -> trailer/raw/*.webm
 *   node tools/trailer/capture.mjs record contact
 *   node tools/trailer/capture.mjs record --headed    # watch it work
 *
 * Nothing here ships in the bundle: the game only ever sees a page module it
 * imports at runtime from /tools/trailer/stage.js.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const VITE_PORT = 5178;
const SINK_PORT = 5211;
const CDP_PORT = 9333;
const RAW = path.join(ROOT, 'trailer', 'raw');

const ORIGIN = `http://127.0.0.1:${VITE_PORT}`;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(RAW, { recursive: true });

/* -------------------------------------------------------------------------- */
/* Loopback sink the page posts its frames and clips to                       */
/* -------------------------------------------------------------------------- */

const received = [];
const sink = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${SINK_PORT}`);
  if (req.method !== 'POST' || url.pathname !== '/file') {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }
  // Names are authored by the director, but never trusted with a path.
  const name = path.basename(url.searchParams.get('name') ?? '');
  if (!/^[a-z0-9][a-z0-9._-]*\.(png|webm|json)$/i.test(name)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('bad name');
    return;
  }
  const chunks = [];
  let bytes = 0;
  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 400 * 1024 * 1024) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const target = path.join(RAW, name);
    writeFileSync(target, body);
    received.push({ name, bytes: body.length });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ ok: true, name, bytes: body.length, path: target }),
    );
  });
});

function startSink() {
  return new Promise((resolve, reject) => {
    sink.once('error', reject);
    sink.listen(SINK_PORT, '127.0.0.1', () => resolve());
  });
}

/* -------------------------------------------------------------------------- */
/* Dev server                                                                 */
/* -------------------------------------------------------------------------- */

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

async function startVite() {
  if (await reachable(`${ORIGIN}/index.html`)) {
    console.log(`dev server already listening on ${ORIGIN}`);
    return null;
  }
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteBin)) throw new Error('Vite is not installed: run npm install first.');
  const log = path.join(ROOT, '.dev', 'trailer-vite.log');
  mkdirSync(path.dirname(log), { recursive: true });
  const child = spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  const capture = (chunk) => {
    output += chunk.toString();
    try {
      writeFileSync(log, output);
    } catch {
      /* The log is a convenience; capture still works without it. */
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await reachable(`${ORIGIN}/index.html`)) {
      console.log(`dev server ready on ${ORIGIN}`);
      return child;
    }
    if (child.exitCode !== null) break;
    await sleep(250);
  }
  child.kill();
  throw new Error(`dev server did not start; see ${log}`);
}

/* -------------------------------------------------------------------------- */
/* Chrome over the DevTools protocol                                          */
/* -------------------------------------------------------------------------- */

function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('No Chrome or Edge binary found. Set CHROME_PATH.');
  return found;
}

function launchChrome({ headed }) {
  const profile = path.join(ROOT, '.dev', 'trailer-profile');
  mkdirSync(profile, { recursive: true });
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1920,1080',
    '--window-position=0,0',
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    // The director needs the audio graph running without a click, and the
    // machine must stay quiet while it records: muting the output device keeps
    // WebAudio rendering into the recording destination.
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    // A recording is a real-time job: never throttle the frame loop.
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-ipc-flooding-protection',
    `--app=${ORIGIN}/index.html?trailer`,
  ];
  if (!headed) args.unshift('--headless=new');
  const chrome = spawn(findChrome(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    // Chrome's own updater and GPU chatter is not the director's business.
    if (/error|fail/i.test(text) && !/Fontconfig|GPU process|updater|named pipe/i.test(text)) {
      process.stderr.write(`[chrome] ${text}`);
    }
  });
  return chrome;
}

async function pageTarget() {
  for (let attempt = 0; attempt < 160; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* Chrome is still coming up. */
    }
    await sleep(250);
  }
  throw new Error('Chrome did not expose a page target.');
}

class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        this.onEvent?.(message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs) {
    const call = this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (!timeoutMs) return call;
    let timer;
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`evaluate timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      return await Promise.race([call, guard]);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
  });
  const session = new Session(socket);
  // Page-side logging is the only window into the director while a take runs.
  session.onEvent = (message) => {
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? '') 
        .join(' ');
      if (text.startsWith('[trailer]') || message.params.type === 'error') {
        console.log(`${message.params.type === 'error' ? '[page error] ' : ''}${text}`);
      }
    } else if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      console.error(`[page exception] ${details.exception?.description ?? details.text}`);
    }
  };
  await session.send('Runtime.enable');
  await session.send('Page.enable');
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return session;
}

/** Wait for the shell to have built the game and exposed it. */
async function waitForGame(session) {
  for (let attempt = 0; attempt < 240; attempt++) {
    const result = await session.evaluate(
      'Boolean(window.ironTide && window.ironTide.renderer && document.getElementById("gl"))',
    );
    if (result.result?.value) return;
    await sleep(250);
  }
  throw new Error('the game shell never became ready');
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

async function main() {
  const argv = process.argv.slice(2);
  const headed = argv.includes('--headed');
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const mode = positional[0] ?? 'stills';
  const ids = positional.slice(1);
  if (!['stills', 'record', 'shots', 'info'].includes(mode)) {
    throw new Error(`unknown mode "${mode}": use stills, record, shots or info`);
  }

  await startSink();
  const vite = await startVite();
  const chrome = launchChrome({ headed });

  const shutdown = async (code) => {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        chrome.kill('SIGTERM');
      }
    } catch {
      /* Already gone. */
    }
    if (vite) vite.kill();
    sink.close();
    await sleep(400);
    process.exit(code);
  };

  try {
    const target = await pageTarget();
    const session = await connect(target);
    await waitForGame(session);

    if (mode === 'shots') {
      const list = await session.evaluate(
        '(async () => (await import("/tools/trailer/script.js")).SHOTS.map((s) => s.id))()',
      );
      console.log(list.result.value.join('\n'));
      await shutdown(0);
      return;
    }

    if (mode === 'info') {
      const facts = await session.evaluate(
        `(async () => {
          const director = await import('/tools/trailer/stage.js');
          return await director.run('info', ${JSON.stringify(ids.length ? ids : null)});
        })()`,
      );
      console.log(JSON.stringify(facts.result?.value, null, 2));
      await shutdown(0);
      return;
    }

    const wanted = ids.length > 0 ? ids : null;
    const expression = `(async () => {
      const director = await import('/tools/trailer/stage.js');
      return await director.run(${JSON.stringify(mode)}, ${JSON.stringify(wanted)});
    })()`;
    const result = await session.evaluate(expression, 30 * 60 * 1000);
    const value = result.result?.value;
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'director failed');
    }
    if (mode === 'stills') {
      console.log(`wrote ${value?.length ?? 0} still(s):`);
      for (const entry of value ?? []) console.log(`  ${entry.name}  ${Math.round(entry.bytes / 1024)} KB`);
    } else {
      console.log(`wrote ${value?.length ?? 0} clip(s):`);
      for (const entry of value ?? []) {
        const size = existsSync(path.join(RAW, entry.name))
          ? `${Math.round(statSync(path.join(RAW, entry.name)).size / 1024)} KB`
          : 'missing';
        console.log(`  ${entry.name}  ${size}`);
      }
    }
    await shutdown(0);
  } catch (error) {
    console.error(String(error));
    await shutdown(1);
  }
}

main();
