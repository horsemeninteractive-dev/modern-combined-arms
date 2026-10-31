#!/usr/bin/env node
// Phase 2A.11 deployed forced-restart verification.
//
// Creates a short two-seat staging room, preserves each seat's client reducer,
// aborts the Durable Object through the staging-only /restart route, reconnects
// both seats, and verifies that valid restored state and subsequent deltas are
// accepted without an epoch-rejection window. Then waits for the original
// deadline and verifies both results and reservation release.
//
//   MP_ADMIN_TOKEN=<token> node tools/phase2a11-forced-restart.mjs
//
// Seat and admin tokens are never written to evidence.

import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rawHandshake, waitRawMessage } from './phase2a-raw-client.mjs';
import { SnapshotAssembler } from '../src/multiplayer/snapshotAssembler.ts';

const PROTOCOL_VERSION = 2;
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
const evidenceDir = join(
  process.env.MP_EVIDENCE_ROOT ?? 'staging-evidence',
  `phase2a11-restart-${stamp}`,
);
mkdirSync(evidenceDir, { recursive: true });
const eventsPath = join(evidenceDir, 'metrics.jsonl');
const summaryPath = join(evidenceDir, 'summary.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const sockets = new Set();
const keepaliveTimers = [];

function event(record) {
  appendFileSync(eventsPath, JSON.stringify({ at: nowIso(), ...record }) + '\n');
}
function log(message, extra) {
  console.log(`[${nowIso()}] ${message}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}`);
}
function roomPath(roomId, suffix = '') {
  return `/api/multiplayer/rooms/${encodeURIComponent(roomId)}${suffix}`;
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
async function createRoom(roomId, matchDurationMs) {
  const response = await api(roomPath(roomId), 'POST', {
    roomId,
    mode: '1v1',
    matchDurationMs,
  });
  if (response.status !== 200 || !response.data?.ok) {
    throw new Error(`create failed: HTTP ${response.status} ${response.data?.code ?? ''}`);
  }
  return response.data;
}
async function status(roomId) {
  return (await api(roomPath(roomId, '/status'))).data;
}
function waitClose(socket, timeoutMs) {
  if (!socket.open) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('socket did not close'));
    }, timeoutMs);
    const off = socket.onClose(() => {
      cleanup();
      resolve();
    });
    function cleanup() {
      clearTimeout(timer);
      off();
    }
  });
}
function commandFor(assembler, seat) {
  const state = assembler.state();
  if (!state) return null;
  const own = state.entities.filter(
    (entity) => entity.kind === 'unit' && entity.team === seat && entity.hp > 0 && !entity.remembered,
  );
  if (!own.length) return null;
  const ids = own.slice(0, 5).map((entity) => entity.id);
  const width = state.map.width * state.map.tileSize;
  const height = state.map.height * state.map.tileSize;
  const x = Math.round(width * (seat === 0 ? 0.5 : 0.42));
  const z = Math.round(height * (seat === 0 ? 0.45 : 0.5));
  return { type: 'move', ids, x, z, attackMove: true };
}
async function openSeat(room, seat, assembler, timeoutMs = 15_000) {
  const token = room.seats.find((entry) => entry.seatId === seat)?.token;
  if (!token) throw new Error(`No token for seat ${seat}.`);
  const started = Date.now();
  let lastStatus = 0;
  while (Date.now() - started < timeoutMs) {
    const handshake = await rawHandshake(base, room.roomId, seat, token, base);
    if (handshake.status !== 101 || !handshake.socket) {
      lastStatus = handshake.status;
      await sleep(200);
      continue;
    }
    const socket = handshake.socket;
    sockets.add(socket);
    try {
      const [hello, sync] = await Promise.all([
        waitRawMessage(socket, (message) => message.type === 'hello', timeoutMs),
        waitRawMessage(socket, (message) => message.type === 'sync', timeoutMs),
      ]);
      const applied = assembler.apply(sync);
      if (!applied.ok) throw new Error(`sync rejected: ${applied.reason} ${applied.detail}`);
      return {
        socket,
        hello,
        sync,
        applied,
        connectMs: Date.now() - started,
        attempts: lastStatus,
      };
    } catch (error) {
      try {
        socket.close();
      } catch {
        /* already gone */
      }
      sockets.delete(socket);
      lastStatus = -1;
      if (Date.now() - started >= timeoutMs) throw error;
      await sleep(200);
    }
  }
  throw new Error(`seat ${seat} could not connect (last status ${lastStatus})`);
}
function startKeepalive(socket) {
  const timer = setInterval(() => {
    if (socket.open) socket.send(JSON.stringify({ type: 'keepalive', v: PROTOCOL_VERSION }));
  }, 20_000);
  keepaliveTimers.push(timer);
}

async function run() {
  const results = {
    at: nowIso(),
    base,
    build: null,
    roomId: null,
    checks: {},
    rejectedUpdates: 0,
    rejectedDetails: [],
    timeline: {},
  };
  const health = await fetch(`${base}/api/multiplayer/health`).then((response) => response.json());
  results.build = health.build ?? null;
  assert.equal(health.ok, true);

  const roomId = `restart-${Date.now().toString(36)}`;
  results.roomId = roomId;
  const room = await createRoom(roomId, 45_000);
  const assemblers = [
    new SnapshotAssembler({ roomId, team: 0 }),
    new SnapshotAssembler({ roomId, team: 1 }),
  ];
  const first = [];
  for (const seat of [0, 1]) {
    const opened = await openSeat(room, seat, assemblers[seat]);
    startKeepalive(opened.socket);
    first[seat] = opened;
    event({
      event: 'initial-connect',
      seat,
      status: 101,
      epoch: opened.sync.epoch,
      seq: opened.sync.seq,
      tick: opened.sync.tick,
      connectMs: opened.connectMs,
    });
  }
  await waitRawMessage(first[0].socket, (message) => message.type === 'delta', 10_000);
  await waitRawMessage(first[1].socket, (message) => message.type === 'delta', 10_000);

  // Issue one command per seat so the room is demonstrably authoritative and
  // actively simulating before the restart.
  for (const seat of [0, 1]) {
    const command = commandFor(assemblers[seat], seat);
    assert.ok(command, `seat ${seat} has a commandable unit`);
    first[seat].socket.send(JSON.stringify({ type: 'command', v: PROTOCOL_VERSION, command }));
    const accepted = await waitRawMessage(
      first[seat].socket,
      (message) => message.type === 'commandAccepted' || message.type === 'commandRejected',
      10_000,
    );
    assert.equal(accepted.type, 'commandAccepted', `seat ${seat} pre-restart command`);
    event({ event: 'pre-restart-command', seat, type: accepted.type, tick: accepted.tick });
  }
  // Let at least one periodic snapshot land, so this check measures restart
  // recovery rather than the age of the initial tick-0 checkpoint. The
  // remaining snapshot-age rollback is recorded separately below.
  await sleep(16_500);

  const before = await status(roomId);
  const preEpoch = assemblers.map((assembler) => assembler.epoch);
  const preSeq = assemblers.map((assembler) => assembler.seq);
  const preTick = assemblers.map((assembler) => assembler.tick);
  const savedOldSync = first.map((opened) => opened.sync);
  const savedOldDelta = first.map((opened) => {
    const parsed = opened.socket.messages
      .map((text) => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })
      .filter((message) => message?.type === 'delta');
    return parsed.at(-1) ?? null;
  });
  const preStart = before?.matchTiming?.startedAtMs ?? null;
  const preDeadline = before?.matchDeadlineAt ?? null;
  results.checks.beforeRestart = {
    phase: before?.match?.phase,
    start: preStart,
    deadline: preDeadline,
    tick: before?.match?.tick,
    epochs: preEpoch,
    seqs: preSeq,
  };
  event({
    event: 'pre-restart',
    start: preStart,
    deadline: preDeadline,
    tick: before?.match?.tick,
    epochs: preEpoch,
    seqs: preSeq,
  });

  const restartRequestedAt = Date.now();
  const restartResponse = await api(roomPath(roomId, '/restart'), 'POST', {});
  assert.equal(restartResponse.status, 200, JSON.stringify(restartResponse.data));
  results.timeline.restartRequestedAt = new Date(restartRequestedAt).toISOString();
  event({ event: 'restart-requested', status: restartResponse.status, data: restartResponse.data });

  await Promise.all(first.map((opened) => waitClose(opened.socket, 15_000)));
  results.timeline.closedAt = nowIso();
  event({ event: 'restart-closed', afterMs: Date.now() - restartRequestedAt });

  const reconnectStartedAt = Date.now();
  const second = [];
  for (const seat of [0, 1]) {
    const opened = await openSeat(room, seat, assemblers[seat]);
    startKeepalive(opened.socket);
    second[seat] = opened;
    results.timeline[`seat${seat}FirstSyncAt`] = nowIso();
    event({
      event: 'restored-connect',
      seat,
      epoch: opened.sync.epoch,
      seq: opened.sync.seq,
      tick: opened.sync.tick,
      connectMs: opened.connectMs,
    });

    // The preserved client reducer must accept the restored baseline even
    // though it still holds the pre-restart epoch.
    assert.ok(
      opened.sync.epoch > preEpoch[seat],
      `seat ${seat} restored epoch ${opened.sync.epoch} must exceed ${preEpoch[seat]}`,
    );
    const nextDelta = await waitRawMessage(
      opened.socket,
      (message) =>
        message.type === 'delta' &&
        message.epoch === opened.sync.epoch &&
        message.base === opened.sync.seq,
      10_000,
    );
    const deltaApplied = assemblers[seat].apply(nextDelta);
    if (!deltaApplied.ok) {
      results.rejectedUpdates += 1;
      results.rejectedDetails.push({ seat, kind: 'delta', reason: deltaApplied.reason });
      throw new Error(`seat ${seat} post-restart delta rejected: ${deltaApplied.reason}`);
    }
    results.timeline[`seat${seat}FirstDeltaAt`] = nowIso();
    event({
      event: 'restored-delta',
      seat,
      epoch: nextDelta.epoch,
      seq: nextDelta.seq,
      base: nextDelta.base,
      tick: nextDelta.tick,
    });

    // A delayed pre-restart sync or delta must never be accepted again.
    for (const stale of [savedOldSync[seat], savedOldDelta[seat]]) {
      if (!stale) continue;
      const rejected = assemblers[seat].apply(stale);
      if (rejected.ok) throw new Error(`seat ${seat} accepted a stale pre-restart message`);
      results.rejectedUpdates += 1;
      results.rejectedDetails.push({ seat, kind: `stale-${stale.type}`, reason: rejected.reason });
    }

    const command = commandFor(assemblers[seat], seat);
    assert.ok(command, `seat ${seat} has a commandable unit after restart`);
    opened.socket.send(JSON.stringify({ type: 'command', v: PROTOCOL_VERSION, command }));
    const accepted = await waitRawMessage(
      opened.socket,
      (message) => message.type === 'commandAccepted' || message.type === 'commandRejected',
      10_000,
    );
    assert.equal(accepted.type, 'commandAccepted', `seat ${seat} post-restart command`);
    results.timeline[`seat${seat}CommandAt`] = nowIso();
    event({ event: 'restored-command', seat, type: accepted.type, tick: accepted.tick });
  }
  results.timeline.reconnectedMs = Date.now() - reconnectStartedAt;
  const after = await status(roomId);
  results.checks.afterRestart = {
    phase: after?.match?.phase,
    start: after?.matchTiming?.startedAtMs,
    startDerived: after?.matchTiming?.startedAtDerived,
    deadline: after?.matchDeadlineAt,
    tick: after?.match?.tick,
    totalTicks: after?.matchTiming?.totalTicks,
    processTicks: after?.matchTiming?.processTicks,
    epochs: after?.match?.seats?.map((seat) => seat.epoch),
    seqs: after?.match?.seats?.map((seat) => seat.seq),
  };
  assert.equal(after?.matchTiming?.startedAtMs, preStart, 'match start is continuous');
  assert.equal(after?.matchTiming?.startedAtDerived, false, 'start is durable, not derived');
  assert.equal(after?.matchDeadlineAt, preDeadline, 'deadline is not extended');
  const restoredTick = second[0].sync.tick;
  const rollbackTicks = Math.max(0, (before?.match?.tick ?? 0) - restoredTick);
  results.checks.rollback = {
    preTick: before?.match?.tick ?? null,
    restoredTick,
    rollbackTicks,
    // The unchanged PERSIST_MS is 15 s at 20 Hz. Allow one checkpoint interval
    // plus scheduling margin; a larger regression would indicate wrong state.
    withinCheckpointInterval: rollbackTicks <= 320,
  };
  assert.ok(rollbackTicks <= 320, 'restore rollback is bounded by the checkpoint interval');
  assert.equal(
    after?.matchTiming?.totalTicks,
    restoredTick + (after?.matchTiming?.processTicks ?? 0),
    'whole-match tick total is restored tick plus this process ticks',
  );
  assert.ok(
    Math.abs((after?.match?.tick ?? 0) - assemblers[0].tick) <= 3,
    'first restored state is close to the authoritative tick',
  );
  event({ event: 'post-restart-status', ...results.checks.afterRestart });

  // Wait for the original 30 s deadline. Keepalives keep both seats transport
  // healthy; the final sync + result must arrive at the untouched deadline.
  const remaining = Math.max(0, (after?.matchDeadlineAt ?? Date.now()) - Date.now());
  const finalResults = await Promise.all(
    second.map((opened) =>
      waitRawMessage(opened.socket, (message) => message.type === 'result', remaining + 15_000),
    ),
  );
  await Promise.all(
    second.map((opened) =>
      waitRawMessage(
        opened.socket,
        (message) =>
          message.type === 'sync' && message.tick === finalResults[0].result?.tick,
        remaining + 15_000,
      ).then((message) => {
        const applied = assemblers[opened.hello.seat].apply(message);
        if (!applied.ok) throw new Error(`final sync rejected: ${applied.reason}`);
      }),
    ),
  );
  results.timeline.resultAt = nowIso();
  results.checks.final = {
    outcomes: finalResults.map((message) => message.outcome),
    winners: finalResults.map((message) => message.result?.winnerTeam),
    reasons: finalResults.map((message) => message.result?.reason),
    ticks: finalResults.map((message) => message.result?.tick),
    clientTicks: assemblers.map((assembler) => assembler.tick),
  };
  expectFinal(finalResults);
  await sleep(400);
  const finalStatus = await status(roomId);
  results.checks.closed = {
    closed: finalStatus?.closed,
    reason: finalStatus?.closedReason,
    reservation: finalStatus?.reservation?.status,
    matchTick: finalStatus?.match?.tick,
    totalTicks: finalStatus?.matchTiming?.totalTicks,
    finishedAtMs: finalStatus?.matchTiming?.finishedAtMs,
    resultTick: finalStatus?.finalResult?.tick ?? finalStatus?.match?.result?.tick ?? null,
  };
  assert.equal(finalStatus?.closed, true, 'room closed at deadline');
  assert.equal(finalStatus?.reservation?.status, 'released', 'reservation released');
  assert.equal(
    results.checks.closed.matchTick,
    Math.max(...assemblers.map((assembler) => assembler.tick)),
    'final client and server ticks agree',
  );
  assert.equal(
    results.rejectedUpdates,
    second.length * 2,
    'only the deliberate stale pre-restart messages were rejected',
  );
  results.passed = true;
  writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  writeFileSync(join(evidenceDir, 'status-before.json'), JSON.stringify(before, null, 2));
  writeFileSync(join(evidenceDir, 'status-after.json'), JSON.stringify(after, null, 2));
  writeFileSync(join(evidenceDir, 'status-final.json'), JSON.stringify(finalStatus, null, 2));
  log('forced restart verification passed', { evidenceDir, roomId });
  console.log(JSON.stringify({ evidenceDir, roomId, passed: true }, null, 2));
}

function expectFinal(messages) {
  assert.equal(messages.length, 2);
  const outcomes = messages.map((message) => message.outcome);
  assert.ok(
    outcomes.every((outcome) => outcome === 'victory' || outcome === 'defeat' || outcome === 'draw'),
    'both seats receive a final outcome',
  );
  assert.equal(messages[0].result?.tick, messages[1].result?.tick, 'both results share a tick');
  assert.equal(messages[0].result?.winnerTeam, messages[1].result?.winnerTeam, 'both results share a winner');
}

try {
  await run();
} catch (error) {
  writeFileSync(
    summaryPath,
    JSON.stringify(
      { at: nowIso(), passed: false, error: error instanceof Error ? error.message : String(error) },
      null,
      2,
    ),
  );
  event({ event: 'fatal', message: error instanceof Error ? error.message : String(error) });
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const timer of keepaliveTimers) clearInterval(timer);
  for (const socket of sockets) {
    try {
      socket.close();
    } catch {
      /* already gone */
    }
  }
  await sleep(300);
}
