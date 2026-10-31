#!/usr/bin/env node
// Deployed Phase 2A smoke test. Requires MP_ADMIN_TOKEN (or .dev/mp-admin-token)
// and a deployed staging origin in MP_BASE. Uses the minimal raw RFC 6455 client
// because the platform 101 response is not surfaced by Node's built-in
// WebSocket error path.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rawHandshake, waitRawMessage } from './phase2a-raw-client.mjs';

const base = process.env.MP_BASE ?? 'https://mca-multiplayer-staging.horsemeninteractive.workers.dev';
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
const expectedBuild = process.env.MP_EXPECT_BUILD ?? 'phase2a11-staging';
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

async function create(roomId, durationMs = 14_000) {
  return api(roomPath(roomId), 'POST', { roomId, mode: '1v1', matchDurationMs: durationMs });
}

async function handshake(roomId, seat, token, requestOrigin = origin) {
  return rawHandshake(base, roomId, seat, token, requestOrigin);
}

async function connect(room, seat) {
  const token = room.seats.find((entry) => entry.seatId === seat).token;
  const result = await handshake(room.roomId, seat, token);
  assert.equal(result.status, 101, `seat ${seat} handshake status`);
  sockets.add(result.socket);
  return result.socket;
}

async function run() {
  const health = await fetch(`${base}/api/multiplayer/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.onlineEnabled, true);
  assert.equal(health.build, expectedBuild);

  const roomId = `deploy-${Date.now().toString(36)}`;
  const created = await create(roomId);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.seats.length, 2);
  const room = created.data;

  const wrongToken = await handshake(roomId, 1, 'x'.repeat(32));
  assert.equal(wrongToken.status, 401);
  const crossOrigin = await handshake(roomId, 0, room.seats[0].token, 'https://evil.example');
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

  assert.ok(snapshotZero.state.map.terrain.length > 0, 'sync carries the static map');
  const playing = await waitRawMessage(
    zero,
    (message) => message.type === 'delta' && message.tick > snapshotZero.tick,
    10_000,
  );
  assert.equal(playing.team, 0);
  assert.equal(playing.base, snapshotZero.seq);
  assert.equal('map' in playing, false, 'delta never repeats the static map');
  assert.equal('state' in playing, false, 'delta never repeats a full snapshot');

  const duplicate = await handshake(roomId, 0, room.seats[0].token);
  assert.equal(duplicate.status, 409);

  const own = snapshotZero.state.entities.find(
    (entity) => entity.team === 0 && entity.kind === 'unit',
  );
  assert.ok(own, 'team 0 snapshot contains an own unit');
  zero.send(JSON.stringify({ type: 'command', v: 2, command: { type: 'stop', ids: [own.id] } }));
  const accepted = await waitRawMessage(zero, (message) => message.type === 'commandAccepted');
  assert.equal(accepted.commandType, 'stop');

  // The gate admits one command per seat per 100 ms. Let the accepted command
  // leave the rate window before asserting the next rejection code.
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

  const resyncStarted = Date.now();
  zero.send(JSON.stringify({ type: 'resync', v: 2 }));
  const resync = await waitRawMessage(
    zero,
    (message) => message.type === 'sync' && message.checkpoint === true,
    10_000,
  );
  const resyncMs = Date.now() - resyncStarted;
  assert.ok(resync.epoch > snapshotZero.epoch, 'resync advances the sync generation');
  assert.ok(resync.state.map.terrain.length > 0, 'resync restores the static map');

  zero.close();
  await sleep(500);
  const reconnected = await connect(room, 0);
  const reconnectHello = await waitRawMessage(reconnected, (message) => message.type === 'hello');
  const reconnectSync = await waitRawMessage(reconnected, (message) => message.type === 'sync');
  assert.equal(reconnectHello.seat, 0);
  assert.equal(reconnectSync.checkpoint, false);
  assert.ok(reconnectSync.epoch > resync.epoch, 'reconnect establishes a new generation');
  assert.ok(reconnectSync.state.map.terrain.length > 0, 'reconnect restores the static map');
  const result = await waitRawMessage(reconnected, (message) => message.type === 'result', 25_000);
  assert.ok(['victory', 'defeat', 'draw'].includes(result.outcome));
  await waitRawMessage(one, (message) => message.type === 'result', 25_000);

  let finalStatus = await api(roomPath(roomId, '/status'));
  for (let attempt = 0; attempt < 40 && !finalStatus.data.closed; attempt++) {
    await sleep(150);
    finalStatus = await api(roomPath(roomId, '/status'));
  }
  assert.equal(finalStatus.data.closed, true);
  assert.equal(finalStatus.data.reservation.status, 'released');

  // Capacity boundary on the deployed coordinator: two rooms hold both slots.
  const capA = await create(`cap-a-${Date.now().toString(36)}`, 20_000);
  const capB = await create(`cap-b-${Date.now().toString(36)}`, 20_000);
  assert.equal(capA.status, 200, JSON.stringify(capA.data));
  assert.equal(capB.status, 200, JSON.stringify(capB.data));
  const capC = await create(`cap-c-${Date.now().toString(36)}`, 20_000);
  assert.equal(capC.status, 503);
  assert.equal(capC.data.code, 'capacity-full');
  await api(roomPath(capA.data.roomId, '/shutdown'), 'POST', {});
  const capAfterRelease = await create(`cap-c-${Date.now().toString(36)}`, 20_000);
  assert.equal(capAfterRelease.status, 200);
  await api(roomPath(capB.data.roomId, '/shutdown'), 'POST', {});
  await api(roomPath(capAfterRelease.data.roomId, '/shutdown'), 'POST', {});

  console.log(
    JSON.stringify(
      {
        ok: true,
        origin: base,
        health,
        roomId,
        finalReservation: finalStatus.data.reservation.status,
        capacityRejected: capC.data.code,
        resyncMs,
        initialSyncBytes: JSON.stringify(snapshotZero).length,
        firstDeltaBytes: JSON.stringify(playing).length,
        checks: [
          'deployed 101 upgrade',
          'two seats connected',
          'team projections isolated',
          'valid command accepted',
          'forged authority rejected',
          'oversized frame rejected',
          'wrong token 401',
          'foreign origin 403',
          'duplicate seat 409',
          'resync checkpoint applied',
          'reconnect accepted on a new epoch',
          'delta carried no map or full state',
          'result delivered to both seats',
          'reservation released',
          'deployed global capacity boundary enforced',
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
