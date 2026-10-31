#!/usr/bin/env node
// Phase 2A transport smoke test. Build and start the isolated Worker first:
//   npx vite build --config mp-room-vite.config.ts
//   npx wrangler dev --config mp-room-wrangler.jsonc --port 8791 \
//     --persist-to .dev/mp-room-local --var MP_ADMIN_TOKEN:<token> \
//     --var MCA_RESERVATION_TOKEN:<token> \
//     --var MP_ALLOWED_ORIGINS:http://127.0.0.1:8791
// Then:
//   MP_BASE=http://127.0.0.1:8791 MP_ADMIN_TOKEN=<token> \
//     node tools/phase2a-local-smoke.mjs
//
// This exercises the real Worker/Durable Object path, not a mock. It uses the
// raw client because Node's built-in WebSocket does not reliably expose the
// handshake status or send the Origin header. It never prints tokens.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rawHandshake, waitRawMessage } from './phase2a-raw-client.mjs';

const base = process.env.MP_BASE ?? 'http://127.0.0.1:8791';
const admin =
  process.env.MP_ADMIN_TOKEN ??
  (() => {
    try {
      return readFileSync('.dev/mp-admin-token', 'utf8').trim();
    } catch {
      return '';
    }
  })();
const origin = process.env.MP_ORIGIN ?? base;
if (!admin) {
  console.error('MP_ADMIN_TOKEN is required.');
  process.exit(2);
}

const sockets = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const roomPath = (roomId, suffix = '') =>
  `/api/multiplayer/rooms/${encodeURIComponent(roomId)}${suffix}`;

async function api(path, method = 'GET', body, token = admin) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ ok: false, code: 'bad-json' }));
  return { status: response.status, data };
}

async function create(roomId, durationMs = 15_000) {
  return api(roomPath(roomId), 'POST', { roomId, mode: '1v1', matchDurationMs: durationMs });
}

async function shutdown(roomId) {
  return api(roomPath(roomId, '/shutdown'), 'POST', {});
}

async function status(roomId) {
  return api(roomPath(roomId, '/status'));
}

async function connect(room, seat) {
  const token = room.seats.find((entry) => entry.seatId === seat).token;
  const result = await rawHandshake(base, room.roomId, seat, token, origin);
  assert.equal(result.status, 101, `seat ${seat} handshake status`);
  sockets.add(result.socket);
  return result.socket;
}

async function run() {
  const health = await fetch(`${base}/api/multiplayer/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.onlineEnabled, true);

  const unauthRoomId = `unauth-${Date.now().toString(36)}`;
  const unauthenticated = await api(
    roomPath(unauthRoomId),
    'POST',
    { roomId: unauthRoomId, mode: '1v1', matchDurationMs: 12_000 },
    null,
  );
  assert.equal(unauthenticated.status, 403);

  const roomId = `smoke-${Date.now().toString(36)}`;
  const created = await create(roomId);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.seats.length, 2);
  const room = created.data;

  const wrongToken = await rawHandshake(base, roomId, 1, 'x'.repeat(32), origin);
  assert.equal(wrongToken.status, 401);
  const crossOrigin = await rawHandshake(
    base,
    roomId,
    0,
    room.seats[0].token,
    'https://evil.example',
  );
  assert.equal(crossOrigin.status, 403);

  const zero = await connect(room, 0);
  const helloZero = await waitRawMessage(zero, (message) => message.type === 'hello');
  const snapshotZero = await waitRawMessage(zero, (message) => message.type === 'sync');
  assert.equal(helloZero.team, 0);
  assert.ok(snapshotZero.state.players.every((player) => player.team === 0));

  const one = await connect(room, 1);
  const helloOne = await waitRawMessage(one, (message) => message.type === 'hello');
  const snapshotOne = await waitRawMessage(one, (message) => message.type === 'sync');
  assert.equal(helloOne.team, 1);
  assert.ok(snapshotOne.state.players.every((player) => player.team === 1));

  // After both seats are present the room streams deltas; the first one proves
  // the incremental path is live and still team-scoped.
  const playing = await waitRawMessage(
    zero,
    (message) => message.type === 'delta' && message.tick > snapshotZero.tick,
    10_000,
  );
  assert.equal(playing.team, 0);

  const duplicate = await rawHandshake(base, roomId, 0, room.seats[0].token, origin);
  assert.equal(duplicate.status, 409);

  const own = snapshotZero.state.entities.find(
    (entity) => entity.team === 0 && entity.kind === 'unit',
  );
  assert.ok(own);
  zero.send(
    JSON.stringify({ type: 'command', v: 2, command: { type: 'stop', ids: [own.id] } }),
  );
  const accepted = await waitRawMessage(zero, (message) => message.type === 'commandAccepted');
  assert.equal(accepted.commandType, 'stop');

  await sleep(200);
  zero.send(
    JSON.stringify({
      type: 'command',
      v: 2,
      command: { type: 'stop', ids: [own.id], team: 1 },
    }),
  );
  const forbidden = await waitRawMessage(zero, (message) => message.type === 'commandRejected');
  assert.equal(forbidden.code, 'forbidden-field');

  await sleep(200);
  zero.send('x'.repeat(5000));
  const oversized = await waitRawMessage(zero, (message) => message.type === 'error');
  assert.equal(oversized.code, 'payload-too-large');

  zero.close();
  await sleep(500);
  const reconnected = await connect(room, 0);
  await waitRawMessage(reconnected, (message) => message.type === 'hello');

  const result = await waitRawMessage(reconnected, (message) => message.type === 'result', 25_000);
  assert.ok(['victory', 'defeat', 'draw'].includes(result.outcome));
  await waitRawMessage(one, (message) => message.type === 'result', 25_000);

  let finalStatus = await status(roomId);
  for (let attempt = 0; attempt < 40 && !finalStatus.data.closed; attempt++) {
    await sleep(150);
    finalStatus = await status(roomId);
  }
  assert.equal(finalStatus.data.closed, true);
  assert.equal(finalStatus.data.reservation.status, 'released');

  const heartbeatRoomId = `heartbeat-${Date.now().toString(36)}`;
  const heartbeatRoom = await create(heartbeatRoomId, 30_000);
  assert.equal(heartbeatRoom.status, 200);
  const hbZero = await connect(heartbeatRoom.data, 0);
  const hbOne = await connect(heartbeatRoom.data, 1);
  await waitRawMessage(hbZero, (message) => message.type === 'sync');
  await waitRawMessage(hbOne, (message) => message.type === 'sync');
  await sleep(21_000);
  const hbStatus = await status(heartbeatRoomId);
  assert.ok(hbStatus.data.match.stats.heartbeatCount >= 1);
  await shutdown(heartbeatRoomId);

  const capA = await create(`cap-a-${Date.now().toString(36)}`);
  const capB = await create(`cap-b-${Date.now().toString(36)}`);
  assert.equal(capA.status, 200);
  assert.equal(capB.status, 200);
  const capC = await create(`cap-c-${Date.now().toString(36)}`);
  assert.equal(capC.status, 503);
  assert.equal(capC.data.code, 'capacity-full');
  await shutdown(capA.data.roomId);
  const capAfterRelease = await create(`cap-c-${Date.now().toString(36)}`);
  assert.equal(capAfterRelease.status, 200);
  await shutdown(capB.data.roomId);
  await shutdown(capAfterRelease.data.roomId);

  console.log(
    JSON.stringify(
      {
        ok: true,
        base,
        health,
        roomId,
        heartbeat: hbStatus.data.match.stats.heartbeatCount,
        finalReservation: finalStatus.data.reservation.status,
        finalStats: finalStatus.data.match.stats,
        capacityRejected: capC.data.code,
        checks: [
          'two seats connected',
          'team projections isolated',
          'valid command accepted',
          'forged authority rejected',
          'oversized frame rejected',
          'wrong token 401',
          'foreign origin 403',
          'duplicate seat 409',
          'reconnect accepted',
          'result delivered to both seats',
          'reservation released',
          '20s heartbeat observed',
          'global capacity boundary enforced',
        ],
      },
      null,
      2,
    ),
  );
}

try {
  await run();
} finally {
  for (const socket of sockets) socket.close();
  await sleep(300);
}
