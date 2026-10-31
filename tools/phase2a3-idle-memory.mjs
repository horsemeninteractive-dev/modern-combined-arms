#!/usr/bin/env node
// Phase 2A.3 discriminating experiment: does a room that is activated but never
// ticks or broadcasts still grow? One seat connects, the room stays in `waiting`
// (the second seat never joins), so no Game.tick() and no snapshots occur. The
// keepalive keeps the socket alive in the waiting phase.
//
//   MP_ADMIN_TOKEN=... MP_DURATION_MS=600000 MP_OUT=.../idle.jsonl \
//     node tools/phase2a3-idle-memory.mjs

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { rawHandshake, waitRawMessage } from './phase2a-raw-client.mjs';

const base =
  process.env.MP_BASE ?? 'https://mca-multiplayer-staging.horsemeninteractive.workers.dev';
const admin =
  process.env.MP_ADMIN_TOKEN ??
  (() => {
    try {
      return readFileSync('.dev/mp-admin-token', 'utf8').trim();
    } catch {
      return '';
    }
  })();
const out = process.env.MP_OUT;
const durationMs = Number(process.env.MP_DURATION_MS ?? 600_000);
const intervalMs = Number(process.env.MP_INTERVAL_MS ?? 60_000);

if (!admin) {
  console.error('MP_ADMIN_TOKEN is required.');
  process.exit(2);
}
if (!out) {
  console.error('MP_OUT is required.');
  process.exit(2);
}
mkdirSync(dirname(out), { recursive: true });

const roomId = `idle-${Date.now().toString(36)}`;
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function record(value) {
  appendFileSync(out, JSON.stringify({ at: nowIso(), roomId, ...value }) + '\n');
}

async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${admin}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(base + path, { ...init, headers });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const roomPath = (suffix = '') =>
  `/api/multiplayer/rooms/${encodeURIComponent(roomId)}${suffix}`;

const created = await api(roomPath(), {
  method: 'POST',
  body: JSON.stringify({ roomId, mode: '1v1', matchDurationMs: durationMs + 60_000 }),
});
if (created.status !== 200 || !created.body?.ok) {
  console.error('room create failed', created.status, created.body?.code);
  process.exit(2);
}
const seat = created.body.seats.find((entry) => entry.seatId === 0);
const connected = await rawHandshake(base, roomId, 0, seat.token, base);
if (connected.status !== 101) {
  console.error('handshake failed', connected.status);
  process.exit(2);
}
const socket = connected.socket;
await waitRawMessage(socket, (message) => message.type === 'hello', 10_000);
await waitRawMessage(socket, (message) => message.type === 'snapshot', 10_000);
record({ event: 'connected', phase: 'waiting' });

let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});

const keepalive = setInterval(() => {
  if (socket.open) socket.send(JSON.stringify({ type: 'keepalive', v: 1 }));
}, 20_000);
keepalive.unref();

const startedAt = Date.now();
while (!stopped && Date.now() - startedAt < durationMs) {
  await sleep(intervalMs);
  const status = await api(roomPath('/status')).catch(() => ({ status: 0, body: null }));
  const match = status.body?.match;
  record({
    event: 'sample',
    http: status.status,
    phase: match?.phase ?? null,
    tick: match?.tick ?? null,
    census: match?.census ?? null,
    keepalive: status.body?.diagnostics?.keepalive ?? null,
    persistence: {
      writes: status.body?.diagnostics?.persistence?.writes ?? null,
      snapshotCycles: status.body?.diagnostics?.persistence?.snapshotCycles ?? null,
      writeBytes: status.body?.diagnostics?.persistence?.writeBytes ?? null,
    },
    seats: match?.seats ?? null,
  });
}

clearInterval(keepalive);
socket.close();
const closed = await api(roomPath('/shutdown'), { method: 'POST' }).catch(() => null);
record({ event: 'shutdown', status: closed?.status ?? null });
