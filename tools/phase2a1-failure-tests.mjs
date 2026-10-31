#!/usr/bin/env node
// Phase 2A.1 post-soak lifecycle and cleanup tests against the isolated
// staging Worker. Run only after the main soak has closed and released.
//
//   MP_ADMIN_TOKEN=<token> node tools/phase2a1-failure-tests.mjs
//
// Tests: reconnect, permanent disconnect/abandonment, controlled shutdown,
// hard deadline, and the two-slot global capacity boundary.

import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
if (!admin) {
  console.error('MP_ADMIN_TOKEN is required.');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = join('staging-evidence', `phase2a1-failures-${stamp}`);
mkdirSync(evidenceDir, { recursive: true });
const eventsPath = join(evidenceDir, 'events.jsonl');
const resultsPath = join(evidenceDir, 'results.json');

const sockets = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const at = () => new Date().toISOString();

function event(record) {
  appendFileSync(eventsPath, JSON.stringify({ at: at(), ...record }) + '\n');
  console.log(JSON.stringify(record));
}

async function api(path, method = 'GET', body) {
  const headers = { Authorization: `Bearer ${admin}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ ok: false, code: 'bad-json' }));
  return { status: response.status, data };
}

const roomPath = (roomId, suffix = '') =>
  `/api/multiplayer/rooms/${encodeURIComponent(roomId)}${suffix}`;

async function createRoom(label, matchDurationMs) {
  const roomId = `${label}-${Date.now().toString(36)}`;
  const response = await api(roomPath(roomId), 'POST', {
    roomId,
    mode: '1v1',
    matchDurationMs,
  });
  if (response.status !== 200 || !response.data?.ok) {
    throw new Error(`create ${label} failed: HTTP ${response.status} ${response.data?.code ?? ''}`);
  }
  return {
    status: 200,
    ...response.data,
    tokenBySeat: new Map(response.data.seats.map((seat) => [seat.seatId, seat.token])),
  };
}

async function connect(room, seat) {
  const token = room.tokenBySeat.get(seat);
  const result = await rawHandshake(base, room.roomId, seat, token, base);
  assert.equal(result.status, 101, `seat ${seat} handshake`);
  sockets.push(result.socket);
  return result.socket;
}

async function status(roomId) {
  const response = await api(roomPath(roomId, '/status'));
  return response.data;
}

async function waitClosed(roomId, timeoutMs = 15_000) {
  const started = Date.now();
  let current = await status(roomId);
  while (!current?.closed && Date.now() - started < timeoutMs) {
    await sleep(150);
    current = await status(roomId);
  }
  return current;
}

async function shutdown(roomId) {
  return api(roomPath(roomId, '/shutdown'), 'POST', {});
}

function record(room) {
  return {
    roomId: room.roomId,
    matchDurationMs: room.matchDurationMs,
    matchDeadlineAt: room.matchDeadlineAt,
  };
}

async function run() {
  const results = { at: at(), base, tests: {} };

  // 1. Reconnect without losing the seat or the match.
  {
    const room = await createRoom('reconnect', 60_000);
    const zero = await connect(room, 0);
    const one = await connect(room, 1);
    await waitRawMessage(zero, (message) => message.type === 'hello', 10_000);
    await waitRawMessage(one, (message) => message.type === 'hello', 10_000);
    zero.close();
    await sleep(1_200);
    const reconnectStarted = Date.now();
    const replacement = await connect(room, 0);
    const hello = await waitRawMessage(replacement, (message) => message.type === 'hello', 10_000);
    const sync = await waitRawMessage(replacement, (message) => message.type === 'sync', 10_000);
    const recoveryMs = Date.now() - reconnectStarted;
    const nextDelta = await waitRawMessage(
      replacement,
      (message) => message.type === 'delta' && message.tick > sync.tick,
      10_000,
    );
    results.tests.reconnect = {
      ...record(room),
      passed:
        hello.seat === 0 &&
        hello.team === 0 &&
        sync.checkpoint === false &&
        sync.team === 0 &&
        sync.state.map.terrain.length > 0 &&
        nextDelta.epoch === sync.epoch &&
        nextDelta.base === sync.seq,
      hello: { seat: hello.seat, team: hello.team, phase: hello.phase },
      sync: { epoch: sync.epoch, seq: sync.seq, tick: sync.tick, checkpoint: sync.checkpoint },
      nextDelta: { epoch: nextDelta.epoch, seq: nextDelta.seq, base: nextDelta.base },
      recoveryMs,
    };
    await shutdown(room.roomId);
    const closed = await waitClosed(room.roomId);
    results.tests.reconnect.closed = closed?.closed ?? false;
    results.tests.reconnect.reservation = closed?.reservation?.status ?? null;
    event({ test: 'reconnect', ...results.tests.reconnect });
  }

  // 2. Permanent disconnect expires the seat and ends the match.
  {
    const room = await createRoom('abandon', 90_000);
    const zero = await connect(room, 0);
    const one = await connect(room, 1);
    await waitRawMessage(zero, (message) => message.type === 'sync', 10_000);
    await waitRawMessage(one, (message) => message.type === 'sync', 10_000);
    one.close();
    const started = Date.now();
    const result = await waitRawMessage(zero, (message) => message.type === 'result', 45_000);
    const closed = await waitClosed(room.roomId, 20_000);
    results.tests.abandon = {
      ...record(room),
      passed:
        result.outcome === 'victory' &&
        closed?.closed === true &&
        closed?.reservation?.status === 'released',
      outcome: result.outcome,
      winnerTeam: result.result?.winnerTeam,
      reason: result.result?.reason,
      observedAfterMs: Date.now() - started,
      closed: closed?.closed ?? false,
      reservation: closed?.reservation?.status ?? null,
    };
    event({ test: 'abandon', ...results.tests.abandon });
  }

  // 3. Controlled shutdown closes sockets and releases the reservation.
  {
    const room = await createRoom('shutdown', 60_000);
    const zero = await connect(room, 0);
    const one = await connect(room, 1);
    await waitRawMessage(zero, (message) => message.type === 'sync', 10_000);
    await waitRawMessage(one, (message) => message.type === 'sync', 10_000);
    const shutdownResponse = await shutdown(room.roomId);
    const closedMessage = await waitRawMessage(
      zero,
      (message) => message.type === 'roomClosed',
      10_000,
    );
    const closed = await waitClosed(room.roomId);
    results.tests.shutdown = {
      ...record(room),
      passed:
        shutdownResponse.status === 200 &&
        closedMessage.code === 'room-shutdown' &&
        closed?.closed === true &&
        closed?.reservation?.status === 'released',
      shutdownStatus: shutdownResponse.status,
      clientCode: closedMessage.code,
      closed: closed?.closed ?? false,
      reservation: closed?.reservation?.status ?? null,
    };
    event({ test: 'shutdown', ...results.tests.shutdown });
  }

  // 4. Hard deadline ends a separate short room with a result for both seats.
  {
    const room = await createRoom('deadline', 10_000);
    const zero = await connect(room, 0);
    const one = await connect(room, 1);
    await waitRawMessage(zero, (message) => message.type === 'sync', 10_000);
    await waitRawMessage(one, (message) => message.type === 'sync', 10_000);
    const zeroResult = await waitRawMessage(zero, (message) => message.type === 'result', 20_000);
    const oneResult = await waitRawMessage(one, (message) => message.type === 'result', 20_000);
    const closed = await waitClosed(room.roomId, 20_000);
    results.tests.deadline = {
      ...record(room),
      passed:
        ['victory', 'defeat', 'draw'].includes(zeroResult.outcome) &&
        ['victory', 'defeat', 'draw'].includes(oneResult.outcome) &&
        closed?.closed === true &&
        closed?.reservation?.status === 'released',
      outcomes: [zeroResult.outcome, oneResult.outcome],
      serverTick: closed?.match?.tick ?? null,
      elapsedMs:
        closed?.match?.startedAtMs && closed?.match?.finishedAtMs
          ? closed.match.finishedAtMs - closed.match.startedAtMs
          : null,
      closed: closed?.closed ?? false,
      reservation: closed?.reservation?.status ?? null,
    };
    event({ test: 'deadline', ...results.tests.deadline });
  }

  // 5. Client-requested resync establishes a new baseline and delta chain.
  {
    const room = await createRoom('resync', 60_000);
    const zero = await connect(room, 0);
    const one = await connect(room, 1);
    const before = await waitRawMessage(zero, (message) => message.type === 'sync', 10_000);
    await waitRawMessage(one, (message) => message.type === 'sync', 10_000);
    zero.send(JSON.stringify({ type: 'resync', v: 2 }));
    const started = Date.now();
    const after = await waitRawMessage(
      zero,
      (message) => message.type === 'sync' && message.checkpoint === true && message.epoch > before.epoch,
      10_000,
    );
    const recoveryMs = Date.now() - started;
    const nextDelta = await waitRawMessage(
      zero,
      (message) => message.type === 'delta' && message.epoch === after.epoch && message.base === after.seq,
      10_000,
    );
    results.tests.resync = {
      ...record(room),
      passed:
        after.team === 0 &&
        after.state.map.terrain.length > 0 &&
        nextDelta.base === after.seq &&
        nextDelta.epoch === after.epoch,
      before: { epoch: before.epoch, seq: before.seq },
      after: { epoch: after.epoch, seq: after.seq, tick: after.tick },
      nextDelta: { epoch: nextDelta.epoch, seq: nextDelta.seq, base: nextDelta.base },
      recoveryMs,
    };
    await shutdown(room.roomId);
    const closed = await waitClosed(room.roomId);
    results.tests.resync.closed = closed?.closed ?? false;
    results.tests.resync.reservation = closed?.reservation?.status ?? null;
    event({ test: 'resync', ...results.tests.resync });
  }

  // 6. Two rooms fill the global ledger; the third is rejected; release frees it.
  {
    const a = await createRoom('cap-a', 10_000);
    const b = await createRoom('cap-b', 10_000);
    const cId = `cap-c-${Date.now().toString(36)}`;
    const c = await api(roomPath(cId), 'POST', {
      roomId: cId,
      mode: '1v1',
      matchDurationMs: 10_000,
    });
    const rejected = c.status === 503 && c.data?.code === 'capacity-full';
    const shutdownA = await shutdown(a.roomId);
    const aClosed = await waitClosed(a.roomId, 15_000);
    const dId = `cap-d-${Date.now().toString(36)}`;
    const d = await api(roomPath(dId), 'POST', {
      roomId: dId,
      mode: '1v1',
      matchDurationMs: 10_000,
    });
    const released = d.status === 200 && aClosed?.reservation?.status === 'released';
    results.tests.capacity = {
      passed: rejected && released && shutdownA.status === 200,
      statuses: [a.status, b.status, c.status, d.status],
      rejectedCode: c.data?.code ?? null,
      aReservation: aClosed?.reservation?.status ?? null,
      freedStatus: d.status,
      freedCode: d.data?.code ?? null,
    };
    if (d.status === 200) await shutdown(dId);
    await shutdown(b.roomId);
    event({ test: 'capacity', ...results.tests.capacity });
  }

  results.passed = Object.values(results.tests).every((test) => test.passed === true);
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ evidenceDir, passed: results.passed }, null, 2));
  if (!results.passed) process.exitCode = 1;
}

try {
  await run();
} catch (error) {
  event({ test: 'fatal', message: error instanceof Error ? error.message : String(error) });
  writeFileSync(
    resultsPath,
    JSON.stringify({ at: at(), passed: false, error: error instanceof Error ? error.message : String(error) }, null, 2),
  );
  process.exitCode = 2;
} finally {
  for (const socket of sockets) {
    try {
      socket.close();
    } catch {
      /* already gone */
    }
  }
  await sleep(300);
}
