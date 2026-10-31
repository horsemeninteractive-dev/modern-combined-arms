#!/usr/bin/env node
// Phase 2A.12 deployed recovery soak.
//
// Creates one authoritative 1v1 staging room, connects two independent raw
// WebSocket clients, issues balanced commands from both seats and deliberately
// restarts the Durable Object at two checkpoint ages (early and late in the
// 15 s persistence interval). It records the pre-restart checkpoint age,
// restored snapshot tick, rollback, reconnect/first-sync/first-delta latency,
// post-restart command acceptance, resync rate limiting and stale-message
// rejection.
//
// Full 30-minute soak:
//   MP_ADMIN_TOKEN=<token> node tools/phase2a12-soak.mjs
//
// Short harness validation (two restarts, not a stability verdict):
//   MP_SOAK_MS=80000 MP_SOAK_LABEL=phase2a12-dry \
//     MP_RESTART_OFFSETS=10000,40000 MP_RESTART_AGES=1500,12500 \
//     node tools/phase2a12-soak.mjs
//
// Seat and admin tokens are never written to evidence.

import assert from 'node:assert/strict';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
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
const targetMs = Number(process.env.MP_SOAK_MS ?? 1_800_000);
const label = process.env.MP_SOAK_LABEL ?? 'phase2a12-30m';
const isMain = targetMs >= 1_800_000;
const intervalMs = Number(process.env.MP_INTERVAL_MS ?? 30_000);
const commandEveryMs = Number(process.env.MP_COMMAND_EVERY_MS ?? 5_000);
const productionEveryMs = Number(process.env.MP_PRODUCTION_EVERY_MS ?? 180_000);
const statusPollMs = Number(process.env.MP_STATUS_POLL_MS ?? 10_000);
const fastStatusPollMs = Number(process.env.MP_FAST_STATUS_POLL_MS ?? 250);
const reconnectAttempts = Number(process.env.MP_RECONNECT_ATTEMPTS ?? 20);
const restartOffsets = String(process.env.MP_RESTART_OFFSETS ?? '300000,1080000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value));
const restartAges = String(process.env.MP_RESTART_AGES ?? '1500,12500')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value));

if (!admin) {
  console.error('MP_ADMIN_TOKEN is required.');
  process.exit(2);
}
if (!Number.isFinite(targetMs) || targetMs < 10_000) {
  console.error('MP_SOAK_MS must be at least 10000.');
  process.exit(2);
}
if (!restartOffsets.length || !restartAges.length) {
  console.error('MP_RESTART_OFFSETS and MP_RESTART_AGES must contain numbers.');
  process.exit(2);
}
if (restartOffsets.some((offset) => offset >= targetMs - 20_000)) {
  console.error('Every restart offset must be at least 20 s before the target end.');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceRoot = process.env.MP_EVIDENCE_ROOT ?? 'staging-evidence';
const evidenceDir = join(evidenceRoot, `${label}-${stamp}`);
mkdirSync(evidenceDir, { recursive: true });
const eventPath = join(evidenceDir, 'metrics.jsonl');
const statusPath = join(evidenceDir, 'status-samples.jsonl');
const summaryPath = join(evidenceDir, 'summary.json');
const runLogPath = join(evidenceDir, 'run.log');
const finalStatusPath = join(evidenceDir, 'status-final.json');
const roomPathFile = join(evidenceDir, 'room.json');

const sockets = [null, null];
const seatTokens = [null, null];
const assemblers = [null, null];
const latest = [null, null];
const latestSync = [null, null];
const latestDelta = [null, null];
const pending = [null, null];
const reconnecting = [false, false];
const lastResyncAt = [0, 0];
let room = null;
let roomId = null;
let keepaliveTimer = null;
let stopping = false;
let abortReason = null;
let resultReceivedAt = null;
let expectedRestart = false;
let restartContext = null;
let restartState = 'idle';
let restartBaselineCheckpoint = null;
let restartSelectedCheckpoint = null;
let restartDueAt = null;
let restartScheduleIndex = 0;
let lastStatus = null;
let lastCheckpoint = null;
let lastStatusSampleAt = 0;
let fastPolling = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function log(message, extra) {
  const line = `[${nowIso()}] ${message}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}`;
  console.log(line);
  appendFileSync(runLogPath, line + '\n');
}

function event(record) {
  appendFileSync(eventPath, JSON.stringify({ at: nowIso(), ...record }) + '\n');
}

function statusSample(record) {
  appendFileSync(statusPath, JSON.stringify({ at: nowIso(), ...record }) + '\n');
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function distribution(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, p99: null, max: null, min: null, mean: null };
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: Math.max(...values),
    min: Math.min(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
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

const roomPath = (id, suffix = '') => `/api/multiplayer/rooms/${encodeURIComponent(id)}${suffix}`;

function sanitizeRoom(data) {
  return {
    roomId: data.roomId,
    mode: data.mode,
    protocol: data.protocol,
    matchDurationMs: data.matchDurationMs,
    matchDeadlineAt: data.matchDeadlineAt,
    seats: (data.seats ?? []).map((seat) => ({
      seatId: seat.seatId,
      playerId: seat.playerId,
      team: seat.team,
    })),
  };
}

function sanitizeStatus(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    ok: data.ok,
    roomId: data.roomId,
    mode: data.mode,
    protocol: data.protocol,
    closed: data.closed,
    closedReason: data.closedReason,
    closedAt: data.closedAt,
    started: data.started,
    createdAt: data.createdAt,
    matchDurationMs: data.matchDurationMs,
    matchDeadlineAt: data.matchDeadlineAt,
    reservation: data.reservation
      ? {
          reservationId: data.reservation.reservationId,
          status: data.reservation.status,
          hardDeadlineAt: data.reservation.hardDeadlineAt,
        }
      : null,
    lastHeartbeatAt: data.lastHeartbeatAt,
    heartbeatIntervalMs: data.heartbeatIntervalMs,
    persistenceIntervalMs: data.persistenceIntervalMs,
    diagnostics: data.diagnostics,
    matchTiming: data.matchTiming,
    match: data.match
      ? {
          phase: data.match.phase,
          tick: data.match.tick,
          startedAtMs: data.match.startedAtMs,
          finishedAtMs: data.match.finishedAtMs,
          closedReason: data.match.closedReason,
          stats: data.match.stats,
          diagnostics: data.match.diagnostics,
          result: data.match.result,
        }
      : null,
    finalResult: data.finalResult,
  };
}

function combatUnits(snapshot, seat) {
  const excluded = new Set([
    'engineer',
    'medic',
    'harvester',
    'recovery',
    'uav',
    'pathfinder',
    'deepReconUAV',
  ]);
  return snapshot.entities.filter(
    (entity) =>
      entity.kind === 'unit' &&
      entity.team === seat &&
      entity.hp > 0 &&
      !entity.remembered &&
      !excluded.has(entity.defId),
  );
}

function visibleEnemyUnits(snapshot, seat) {
  const excluded = new Set([
    'fighter',
    'interceptor',
    'uav',
    'deepReconUAV',
    'missileBoat',
    'corvette',
    'submarine',
    'frigate',
  ]);
  return snapshot.entities.filter(
    (entity) =>
      entity.kind === 'unit' &&
      entity.team !== seat &&
      entity.hp > 0 &&
      !entity.remembered &&
      !excluded.has(entity.defId),
  );
}

function commandPost(snapshot, seat) {
  return snapshot.entities.find(
    (entity) =>
      entity.kind === 'building' &&
      entity.team === seat &&
      entity.defId === 'commandPost' &&
      !entity.construction &&
      entity.hp > 0 &&
      !entity.remembered,
  );
}

function chooseCommand(snapshot, seat, sequence, productionDue) {
  const combat = combatUnits(snapshot, seat);
  const enemies = visibleEnemyUnits(snapshot, seat);
  const allUnits = snapshot.entities.filter(
    (entity) =>
      entity.kind === 'unit' && entity.team === seat && entity.hp > 0 && !entity.remembered,
  );
  const usable = combat.length ? combat : allUnits;

  if (productionDue) {
    const post = commandPost(snapshot, seat);
    const queueLength = Array.isArray(post?.queue) ? post.queue.length : 0;
    if (post && queueLength < 2) {
      return {
        purpose: 'production',
        command: { type: 'produce', buildingId: post.id, defId: 'engineer' },
      };
    }
  }

  if (enemies.length && combat.length) {
    return {
      purpose: 'attack',
      command: {
        type: 'attack',
        ids: combat.slice(0, 6).map((entity) => entity.id),
        targetId: enemies[0].id,
      },
    };
  }

  if (usable.length) {
    const worldWidth = snapshot.map.width * snapshot.map.tileSize;
    const worldHeight = snapshot.map.height * snapshot.map.tileSize;
    const phase = sequence % 4;
    const cx = worldWidth * 0.45;
    const cz = worldHeight * 0.42;
    const x = clamp(cx + (phase - 1.5) * 12, 8, worldWidth - 8);
    const z = clamp(cz + ((phase % 2) - 0.5) * 16, 8, worldHeight - 8);
    return {
      purpose: 'move',
      command: {
        type: 'move',
        ids: usable.slice(0, 8).map((entity) => entity.id),
        x: Math.round(x),
        z: Math.round(z),
        attackMove: true,
      },
    };
  }

  return null;
}

function snapshotBreakdown(snapshot) {
  const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
  const total = bytes(snapshot);
  return {
    total,
    map: bytes(snapshot.map),
    fog: bytes(snapshot.fog),
    entities: bytes(snapshot.entities),
    players: bytes(snapshot.players),
    events: bytes(snapshot.events),
    projectiles: bytes(snapshot.projectiles),
    contacts: bytes(snapshot.contacts),
    mapRatio: total ? bytes(snapshot.map) / total : null,
    units: snapshot.entities.filter((entity) => entity.kind === 'unit').length,
    buildings: snapshot.entities.filter((entity) => entity.kind === 'building').length,
    terrainTiles: snapshot.map.terrain.length,
    elevationTiles: snapshot.map.elevation.length,
    oreTiles: snapshot.map.ore.length,
    fogTiles: snapshot.fog.length,
  };
}

const stats = {
  snapshots: [0, 0],
  snapshotBytes: [0, 0],
  syncs: [0, 0],
  deltas: [0, 0],
  syncBytes: [0, 0],
  deltaBytes: [0, 0],
  deltaSizes: [[], []],
  deltaFieldBytes: [{}, {}],
  fogEntries: [0, 0],
  epochs: [0, 0],
  firstSyncBytes: [null, null],
  syncMapBytes: [0, 0],
  syncFogBytes: [0, 0],
  deltaMapBytes: 0,
  resyncRequests: [0, 0],
  rejectedUpdates: 0,
  lastReject: null,
  snapshotSizes: [[], []],
  snapshotGaps: [[], []],
  tickDeltas: [[], []],
  firstTick: [null, null],
  lastTick: [null, null],
  lastSnapshotAt: [null, null],
  longestGapMs: [0, 0],
  stateSamples: [],
  commandsSent: [0, 0],
  commandsAccepted: [0, 0],
  commandsRejected: [0, 0],
  commandTimeouts: [0, 0],
  commandByType: [{}, {}],
  rejectionByCode: {},
  commandLatencies: [],
  ackAnomalies: 0,
  socketCloses: [],
  reconnects: [0, 0],
  reconnectAttempts: [0, 0],
  reconnectFailures: [0, 0],
  keepalivesSent: [0, 0],
  keepaliveAcks: [0, 0],
  errors: [],
  results: [null, null],
  resultAtMs: null,
  intervalIndex: 0,
  lastIntervalAt: null,
  lastIntervalSnapshotCounts: [0, 0],
  lastIntervalBytes: [0, 0],
  lastBreakdownAt: [0, 0],
  checkpointsSeen: 0,
};

function noteError(scope, error) {
  const message = error instanceof Error ? error.message : String(error);
  stats.errors.push({ at: nowIso(), scope, message });
  log(`ERROR ${scope}: ${message}`);
}

function attachSocket(seat, socket) {
  socket.onMessage((text) => {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    const at = Date.now();
    if (message.type === 'sync' || message.type === 'delta') {
      const bytes = Buffer.byteLength(text, 'utf8');
      const assembler = assemblers[seat];
      if (!assembler) return;
      const applied = assembler.apply(message);
      if (!applied.ok) {
        stats.rejectedUpdates++;
        stats.lastReject = {
          at: nowIso(),
          seat,
          reason: applied.reason,
          detail: applied.detail,
        };
        event({ type: 'assembly-reject', seat, reason: applied.reason, detail: applied.detail });
        if (!expectedRestart && Date.now() - lastResyncAt[seat] >= 5000) {
          lastResyncAt[seat] = Date.now();
          stats.resyncRequests[seat]++;
          socket.send(JSON.stringify({ type: 'resync', v: PROTOCOL_VERSION }));
        }
        return;
      }
      if (applied.kind === 'sync') {
        latestSync[seat] = message;
        stats.syncs[seat]++;
        stats.syncBytes[seat] += bytes;
        stats.epochs[seat] = assembler.epoch;
        if (stats.firstSyncBytes[seat] === null) stats.firstSyncBytes[seat] = bytes;
        if (message.state.map !== undefined) {
          stats.syncMapBytes[seat] += Buffer.byteLength(
            JSON.stringify(message.state.map),
            'utf8',
          );
        }
        stats.syncFogBytes[seat] += Buffer.byteLength(JSON.stringify(message.state.fog), 'utf8');
      } else {
        latestDelta[seat] = message;
        stats.deltas[seat]++;
        stats.deltaBytes[seat] += bytes;
        stats.deltaSizes[seat].push(bytes);
        stats.fogEntries[seat] += message.changes?.fog?.set?.length ?? 0;
        if (message.changes?.map !== undefined) {
          stats.deltaMapBytes += Buffer.byteLength(JSON.stringify(message.changes.map), 'utf8');
        }
        for (const [key, value] of Object.entries(message.changes ?? {})) {
          stats.deltaFieldBytes[seat][key] =
            (stats.deltaFieldBytes[seat][key] ?? 0) + Buffer.byteLength(JSON.stringify(value));
        }
      }
      const previousAt = stats.lastSnapshotAt[seat];
      if (previousAt !== null) {
        const gap = at - previousAt;
        stats.snapshotGaps[seat].push(gap);
        stats.longestGapMs[seat] = Math.max(stats.longestGapMs[seat], gap);
      }
      const previousTick = stats.lastTick[seat];
      if (previousTick !== null && applied.tick > previousTick) {
        stats.tickDeltas[seat].push(applied.tick - previousTick);
      }
      if (stats.firstTick[seat] === null) stats.firstTick[seat] = applied.tick;
      stats.lastTick[seat] = applied.tick;
      stats.lastSnapshotAt[seat] = at;
      stats.snapshots[seat]++;
      stats.snapshotBytes[seat] += bytes;
      stats.snapshotSizes[seat].push(bytes);
      const state = assembler.state();
      latest[seat] = state;
      if (restartContext?.captureArmed) {
        const capture = restartContext.seats[seat];
        if (applied.kind === 'sync' && capture.firstSyncAt === null) {
          capture.firstSyncAt = at;
          capture.firstSyncEpoch = message.epoch;
          capture.firstSyncSeq = message.seq;
          capture.firstSyncTick = message.tick;
          capture.firstSyncCheckpoint = message.checkpoint;
          capture.firstSyncHadMap = message.state.map !== undefined;
          capture.firstSyncFogTiles = message.state.fog?.length ?? null;
          capture.firstSyncStateTick = state?.tick ?? null;
          event({
            type: 'restart-first-sync',
            restart: restartContext.index,
            seat,
            epoch: message.epoch,
            seq: message.seq,
            tick: message.tick,
            checkpoint: message.checkpoint,
            hadMap: capture.firstSyncHadMap,
          });
        }
        if (applied.kind === 'delta' && capture.firstDeltaAt === null) {
          capture.firstDeltaAt = at;
          capture.firstDeltaTick = applied.tick;
          capture.firstDeltaEpoch = message.epoch;
          capture.firstDeltaSeq = message.seq;
          event({
            type: 'restart-first-delta',
            restart: restartContext.index,
            seat,
            epoch: message.epoch,
            seq: message.seq,
            tick: applied.tick,
          });
        }
      }
      if (at - stats.lastBreakdownAt[seat] >= 60_000 && state) {
        stats.lastBreakdownAt[seat] = at;
        stats.stateSamples.push({
          seat,
          at: nowIso(),
          tick: state.tick,
          entities: state.entities.length,
          ownUnits: state.entities.filter(
            (entity) => entity.kind === 'unit' && entity.team === seat && !entity.remembered,
          ).length,
          visibleEnemies: state.entities.filter(
            (entity) => entity.kind === 'unit' && entity.team !== seat && !entity.remembered,
          ).length,
          materials: state.players.find((player) => player.team === seat)?.mats ?? null,
          breakdown: snapshotBreakdown(state),
        });
      }
      return;
    }
    if (message.type === 'commandAccepted' || message.type === 'commandRejected') {
      const current = pending[seat];
      if (!current) {
        stats.ackAnomalies++;
        event({ type: 'ack-without-command', seat, message });
        return;
      }
      const latency = at - current.sentAt;
      stats.commandLatencies.push(latency);
      const accepted = message.type === 'commandAccepted';
      if (accepted) {
        stats.commandsAccepted[seat]++;
      } else {
        stats.commandsRejected[seat]++;
        stats.rejectionByCode[message.code] = (stats.rejectionByCode[message.code] ?? 0) + 1;
      }
      stats.commandByType[seat][current.command.type] =
        (stats.commandByType[seat][current.command.type] ?? 0) + 1;
      event({
        type: 'command-result',
        seat,
        purpose: current.purpose,
        commandType: current.command.type,
        outcome: accepted ? 'accepted' : 'rejected',
        code: message.code,
        detail: message.detail,
        latencyMs: latency,
        tick: message.tick,
      });
      if (current.restartCommand && restartContext) {
        const capture = restartContext.seats[seat];
        if (capture.firstCommandAt === null) {
          capture.firstCommandAt = at;
          capture.firstCommandAccepted = accepted;
          capture.firstCommandTick = message.tick ?? null;
          capture.firstCommandCode = message.code ?? null;
        }
      }
      pending[seat] = null;
      current.resolve?.({ accepted, message, latency });
      return;
    }
    if (message.type === 'keepaliveAck') {
      stats.keepaliveAcks[seat]++;
      return;
    }
    if (message.type === 'result') {
      stats.results[seat] = message;
      if (resultReceivedAt === null) resultReceivedAt = at;
      event({
        type: 'result',
        seat,
        outcome: message.outcome,
        winnerTeam: message.result?.winnerTeam,
        reason: message.result?.reason,
        tick: message.result?.tick,
      });
      return;
    }
    if (message.type === 'roomClosed') {
      event({ type: 'room-closed-message', seat, code: message.code, reason: message.reason });
      return;
    }
    if (message.type === 'error') {
      const expected =
        message.code === 'resync-rate-limited' && restartContext?.seatTestingResync !== null;
      event({
        type: 'server-error',
        seat,
        code: message.code,
        message: message.message,
        expected,
      });
      if (!expected) {
        stats.errors.push({ at: nowIso(), scope: `seat-${seat}-error`, code: message.code });
      }
    }
  });
  socket.onClose(() => {
    stats.socketCloses.push({ at: nowIso(), seat, code: socket.closeCode, reason: socket.closeReason });
    event({ type: 'socket-close', seat, code: socket.closeCode, reason: socket.closeReason });
    if (sockets[seat] !== socket) return;
    if (stopping || resultReceivedAt !== null) return;
    if (expectedRestart) {
      event({ type: 'restart-close', restart: restartContext?.index ?? null, seat, at: nowIso() });
      if (restartContext) restartContext.closed[seat] = Date.now();
      return;
    }
    void reconnectSeat(seat, `close-${socket.closeCode ?? 'none'}`);
  });
}

async function connectSeat(seat, timeoutMs = 20_000) {
  const beganAt = Date.now();
  let lastStatus = 0;
  while (Date.now() - beganAt < timeoutMs) {
    const handshake = await rawHandshake(base, roomId, seat, seatTokens[seat], base);
    if (handshake.status === 101 && handshake.socket) {
      const socket = handshake.socket;
      sockets[seat] = socket;
      attachSocket(seat, socket);
      try {
        const hello = await waitRawMessage(socket, (message) => message.type === 'hello', timeoutMs);
        const sync = await waitRawMessage(socket, (message) => message.type === 'sync', timeoutMs);
        return { socket, hello, sync, connectMs: Date.now() - beganAt, attempts: lastStatus };
      } catch (error) {
        try {
          socket.close();
        } catch {
          /* already gone */
        }
        lastStatus = -1;
        if (Date.now() - beganAt >= timeoutMs) throw error;
      }
    } else {
      lastStatus = handshake.status;
    }
    await sleep(200);
  }
  throw new Error(`seat ${seat} could not connect (last status ${lastStatus})`);
}

async function reconnectSeat(seat, cause) {
  if (reconnecting[seat] || stopping || resultReceivedAt !== null) return;
  if (!room || !seatTokens[seat]) return;
  reconnecting[seat] = true;
  const beganAt = Date.now();
  event({ type: 'reconnect-start', seat, cause });
  log('seat reconnecting', { seat, cause });
  for (let attempt = 1; attempt <= reconnectAttempts; attempt++) {
    if (stopping || resultReceivedAt !== null) {
      reconnecting[seat] = false;
      return;
    }
    await sleep(Math.min(2_000, 250 * attempt));
    stats.reconnectAttempts[seat]++;
    const connected = await rawHandshake(base, roomId, seat, seatTokens[seat], base);
    if (connected.status === 101 && connected.socket) {
      sockets[seat] = connected.socket;
      stats.reconnects[seat]++;
      attachSocket(seat, connected.socket);
      reconnecting[seat] = false;
      event({
        type: 'reconnect',
        seat,
        attempt,
        cause,
        elapsedMs: Date.now() - beganAt,
      });
      log('seat reconnected', { seat, attempt, elapsedMs: Date.now() - beganAt });
      return;
    }
    stats.reconnectFailures[seat]++;
    event({
      type: 'reconnect-failed',
      seat,
      attempt,
      cause,
      status: connected.status,
      elapsedMs: Date.now() - beganAt,
    });
  }
  reconnecting[seat] = false;
  if (!stopping && resultReceivedAt === null) {
    abortReason = `seat ${seat} could not reconnect (${cause})`;
    log(abortReason);
  }
}

function sendCommand(seat, choice, restartCommand = false) {
  const socket = sockets[seat];
  if (!socket?.open) return null;
  const sentAt = Date.now();
  stats.commandsSent[seat]++;
  const promise = new Promise((resolve) => {
    pending[seat] = {
      sentAt,
      purpose: choice.purpose,
      command: choice.command,
      restartCommand,
      resolve,
    };
  });
  socket.send(JSON.stringify({ type: 'command', v: PROTOCOL_VERSION, command: choice.command }));
  event({
    type: 'command-sent',
    seat,
    purpose: choice.purpose,
    commandType: choice.command.type,
    command: choice.command,
    restartCommand,
  });
  return promise;
}

async function waitUntil(predicate, timeoutMs, labelText) {
  const beganAt = Date.now();
  while (Date.now() - beganAt < timeoutMs) {
    if (predicate()) return true;
    await sleep(50);
  }
  throw new Error(`${labelText} timed out after ${timeoutMs} ms`);
}

async function waitForMessage(seat, predicate, timeoutMs = 10_000) {
  const socket = sockets[seat];
  if (!socket) throw new Error(`seat ${seat} has no socket`);
  for (const text of socket.messages) {
    try {
      const message = JSON.parse(text);
      if (predicate(message)) return message;
    } catch {
      /* ignore */
    }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`seat ${seat} message timeout`));
    }, timeoutMs);
    const offMessage = socket.onMessage((text) => {
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    });
    const offClose = socket.onClose(() => {
      cleanup();
      reject(new Error(`seat ${seat} closed while waiting for message`));
    });
    function cleanup() {
      clearTimeout(timer);
      offMessage();
      offClose();
    }
  });
}

function lastProtocolMessage(seat, type) {
  const socket = sockets[seat];
  if (!socket) return null;
  for (let index = socket.messages.length - 1; index >= 0; index--) {
    try {
      const message = JSON.parse(socket.messages[index]);
      if (message.type === type) return message;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function pollStatus(options = {}) {
  const response = await api(roomPath(roomId, '/status'));
  const raw = response.data;
  const clean = sanitizeStatus(raw);
  if (!clean?.ok) return clean;
  lastStatus = clean;
  const persistence = clean.diagnostics?.persistence ?? null;
  const timing = clean.matchTiming ?? null;
  const observedCheckpoint = persistence?.lastSuccessAt ?? null;
  const snapshotCycles = persistence?.snapshotCycles ?? null;
  if (
    snapshotCycles !== null &&
    snapshotCycles !== lastCheckpoint?.snapshotCycles &&
    !expectedRestart
  ) {
    lastCheckpoint = {
      snapshotCycles,
      lastSuccessAt: observedCheckpoint,
      observedAt: Date.now(),
      totalTicks: timing?.totalTicks ?? null,
      processTicks: timing?.processTicks ?? null,
      ageSinceSuccessMs: persistence?.ageSinceSuccessMs ?? null,
    };
    stats.checkpointsSeen++;
    event({ type: 'checkpoint-observed', ...lastCheckpoint });
    log('checkpoint observed', {
      lastSuccessAt: observedCheckpoint === null ? null : new Date(observedCheckpoint).toISOString(),
      totalTicks: lastCheckpoint.totalTicks,
      snapshotCycles: lastCheckpoint.snapshotCycles,
    });
  }
  const at = Date.now();
  if (!options.skipSample && (options.forceSample || at - lastStatusSampleAt >= 5_000)) {
    lastStatusSampleAt = at;
    statusSample({
      tick: clean.match?.tick ?? timing?.totalTicks ?? null,
      totalTicks: timing?.totalTicks ?? null,
      processTicks: timing?.processTicks ?? null,
      phase: clean.match?.phase ?? null,
      closed: clean.closed ?? false,
      lastSuccessAt: persistence?.lastSuccessAt ?? null,
      ageSinceSuccessMs: persistence?.ageSinceSuccessMs ?? null,
      snapshotCycles: persistence?.snapshotCycles ?? null,
      snapshotBytes: persistence?.lastSnapshotBytes ?? null,
      syncs: clean.diagnostics?.sync?.count ?? null,
      deltas: clean.diagnostics?.delta?.count ?? null,
      persistenceFailures: persistence?.failures ?? null,
      reservations: clean.diagnostics?.reservations ?? null,
    });
  }
  return clean;
}

function createRoom() {
  const matchDurationMs = Math.min(1_800_000, targetMs + (isMain ? 0 : 10_000));
  return api(roomPath(roomId), 'POST', { roomId, mode: '1v1', matchDurationMs }).then(
    (response) => {
      if (response.status !== 200 || !response.data?.ok) {
        throw new Error(`room create failed: HTTP ${response.status} ${response.data?.code ?? ''}`);
      }
      return response.data;
    },
  );
}

async function waitForRestartCloses(context, timeoutMs = 8_000) {
  await waitUntil(
    () => context.closed[0] !== null && context.closed[1] !== null,
    timeoutMs,
    'both sockets closing for restart',
  );
}

async function runRestart(index, selectedCheckpoint) {
  const ageTargetMs = restartAges[index % restartAges.length];
  const selected = selectedCheckpoint ?? lastCheckpoint;
  if (!selected) throw new Error('No successful snapshot checkpoint was selected for the restart.');
  expectedRestart = true;
  restartContext = {
    index,
    scheduledAgeMs: ageTargetMs,
    seats: [
      {
        seat: 0,
        firstSyncAt: null,
        firstSyncEpoch: null,
        firstSyncSeq: null,
        firstSyncTick: null,
        firstSyncCheckpoint: null,
        firstSyncHadMap: null,
        firstSyncFogTiles: null,
        firstSyncStateTick: null,
        firstDeltaAt: null,
        firstDeltaTick: null,
        firstDeltaEpoch: null,
        firstDeltaSeq: null,
        firstCommandAt: null,
        firstCommandAccepted: null,
        firstCommandTick: null,
        firstCommandCode: null,
        resyncAcceptedAt: null,
        resyncRateLimitedAt: null,
        resyncSyncEpoch: null,
        staleSyncReject: null,
        staleDeltaReject: null,
      },
      {
        seat: 1,
        firstSyncAt: null,
        firstSyncEpoch: null,
        firstSyncSeq: null,
        firstSyncTick: null,
        firstSyncCheckpoint: null,
        firstSyncHadMap: null,
        firstSyncFogTiles: null,
        firstSyncStateTick: null,
        firstDeltaAt: null,
        firstDeltaTick: null,
        firstDeltaEpoch: null,
        firstDeltaSeq: null,
        firstCommandAt: null,
        firstCommandAccepted: null,
        firstCommandTick: null,
        firstCommandCode: null,
        resyncAcceptedAt: null,
        resyncRateLimitedAt: null,
        resyncSyncEpoch: null,
        staleSyncReject: null,
        staleDeltaReject: null,
      },
    ],
    closed: [null, null],
    captureArmed: false,
    seatTestingResync: null,
  };

  const before = await pollStatus({ forceSample: true });
  const persistence = before.diagnostics?.persistence ?? null;
  const timing = before.matchTiming ?? null;
  const preTick = before.match?.tick ?? timing?.totalTicks ?? null;
  const preEpochs = [assemblers[0]?.epoch ?? null, assemblers[1]?.epoch ?? null];
  const preSeqs = [assemblers[0]?.seq ?? null, assemblers[1]?.seq ?? null];
  const savedSync = [latestSync[0], latestSync[1]];
  const savedDelta = [latestDelta[0], latestDelta[1]];
  const lastSuccessAt = selected.lastSuccessAt ?? null;
  const lastCheckpointTick = selected.totalTicks ?? null;
  const snapshotCyclesBefore = selected.snapshotCycles ?? null;
  const checkpointObservedAt = selected.observedAt;
  const ageSinceAnyPersistenceSuccessMs = persistence?.ageSinceSuccessMs ?? null;
  const pendingAtRestart = pending.map((entry) =>
    entry ? { purpose: entry.purpose, type: entry.command.type, ageMs: Date.now() - entry.sentAt } : null,
  );
  for (const seat of [0, 1]) {
    if (pending[seat]) {
      pending[seat].resolve?.({ accepted: false, message: { code: 'restart-interrupted' }, latency: null });
      pending[seat] = null;
    }
  }
  if (lastSuccessAt === null) {
    throw new Error('No successful checkpoint was observed before the restart.');
  }

  // A command accepted after the last checkpoint is intentionally issued here
  // so the restore can show whether that post-checkpoint authority is durable.
  const postCheckpointCommand = await Promise.all(
    [0, 1].map(async (seat) => {
      const snapshot = latest[seat];
      if (!snapshot) return null;
      const choice = chooseCommand(snapshot, seat, index, false);
      if (!choice) return null;
      const result = sendCommand(seat, choice, false);
      if (!result) return null;
      const ack = await Promise.race([result, sleep(400).then(() => null)]);
      return { seat, purpose: choice.purpose, commandType: choice.command.type, ack };
    }),
  ).then((entries) => entries.filter(Boolean));

  const restartRequestedAt = Date.now();
  const checkpointAgeAtRequest = restartRequestedAt - checkpointObservedAt;
  writeFileSync(
    join(evidenceDir, `restart-${index}-status-before.json`),
    JSON.stringify(sanitizeStatus(before), null, 2),
  );
  event({
    type: 'restart-request',
    restart: index,
    scheduledAgeMs: ageTargetMs,
    checkpointObservedAt,
    checkpointAgeAtRequestMs: checkpointAgeAtRequest,
    ageSinceAnyPersistenceSuccessMs,
    lastSuccessAt,
    lastSuccessAtIso: lastSuccessAt === null ? null : new Date(lastSuccessAt).toISOString(),
    lastCheckpointTick,
    snapshotCyclesBefore,
    preTick,
    preEpochs,
    preSeqs,
    pendingAtRestart,
    postCheckpointCommand: postCheckpointCommand.map((entry) => ({
      seat: entry.seat,
      purpose: entry.purpose,
      commandType: entry.commandType,
      accepted: entry.ack?.accepted ?? null,
      tick: entry.ack?.message?.tick ?? null,
    })),
  });

  const response = await api(roomPath(roomId, '/restart'), 'POST', {});
  const restartResponseAt = Date.now();
  const checkpointAgeAtAbortApprox = restartResponseAt - checkpointObservedAt + 50;
  event({
    type: 'restart-response',
    restart: index,
    status: response.status,
    data: response.data,
    requestToResponseMs: restartResponseAt - restartRequestedAt,
  });
  if (response.status !== 200 || !response.data?.ok) {
    throw new Error(`restart ${index} failed: HTTP ${response.status} ${response.data?.code ?? ''}`);
  }
  await waitForRestartCloses(restartContext);
  const closedAt = Math.max(...restartContext.closed);
  // The old sockets are gone. Keep the recovery context for capture, but allow
  // an unexpected close of a new socket to use the normal reconnect path.
  expectedRestart = false;
  restartContext.captureArmed = true;
  await sleep(120);

  let restored = null;
  let restoredAttempts = 0;
  for (let attempt = 0; attempt < 50; attempt++) {
    restoredAttempts++;
    const candidate = await pollStatus({ skipSample: true });
    if (candidate?.ok) {
      restored = candidate;
      break;
    }
    await sleep(100);
  }
  if (!restored?.ok) throw new Error(`restart ${index} did not restore the room`);
  const restoredPersistence = restored.diagnostics?.persistence ?? null;
  const restoredTiming = restored.matchTiming ?? null;
  const restoredTotalTicks = restoredTiming?.totalTicks ?? null;
  const restoredProcessTicks = restoredTiming?.processTicks ?? null;
  const restoredSnapshotTick =
    restoredTotalTicks !== null && restoredProcessTicks !== null
      ? restoredTotalTicks - restoredProcessTicks
      : null;
  const restoredInfo = {
    at: nowIso(),
    status: restored,
    totalTicks: restoredTotalTicks,
    processTicks: restoredProcessTicks,
    snapshotTick: restoredSnapshotTick,
    attempts: restoredAttempts,
  };
  writeFileSync(
    join(evidenceDir, `restart-${index}-status-restored-before-connect.json`),
    JSON.stringify(restoredInfo, null, 2),
  );
  event({ type: 'restart-restored-before-connect', restart: index, ...restoredInfo });

  const reconnectResults = await Promise.all([0, 1].map((seat) => connectSeat(seat)));
  const connectedAt = Date.now();
  for (const seat of [0, 1]) {
    event({
      type: 'restart-reconnect',
      restart: index,
      seat,
      epoch: reconnectResults[seat].sync.epoch,
      seq: reconnectResults[seat].sync.seq,
      tick: reconnectResults[seat].sync.tick,
      checkpoint: reconnectResults[seat].sync.checkpoint,
      hadMap: reconnectResults[seat].sync.state.map !== undefined,
      connectMs: reconnectResults[seat].connectMs,
      sinceCloseMs: connectedAt - closedAt,
    });
  }
  await waitUntil(
    () => restartContext.seats[0].firstDeltaAt !== null && restartContext.seats[1].firstDeltaAt !== null,
    10_000,
    'first post-restart deltas',
  );

  const postRestartCommands = [];
  for (const seat of [0, 1]) {
    const snapshot = latest[seat];
    if (!snapshot) throw new Error(`seat ${seat} has no restored state`);
    const choice = chooseCommand(snapshot, seat, index + 2, false);
    if (!choice) throw new Error(`seat ${seat} has no post-restart command`);
    const result = sendCommand(seat, choice, true);
    if (!result) throw new Error(`seat ${seat} could not send a post-restart command`);
    const ack = await Promise.race([result, sleep(5_000).then(() => null)]);
    if (!ack) throw new Error(`seat ${seat} post-restart command timed out`);
    postRestartCommands.push({ seat, accepted: ack.accepted, tick: ack.message?.tick ?? null });
    if (!ack.accepted) throw new Error(`seat ${seat} post-restart command was rejected`);
  }

  // The server rate-limits resync per seat. The first request must succeed and
  // the immediate duplicate must be explicitly refused, proving recovery is
  // possible without weakening the flood protection.
  for (const seat of [0, 1]) {
    restartContext.seatTestingResync = seat;
    const socket = sockets[seat];
    const beforeEpoch = assemblers[seat].epoch;
    socket.send(JSON.stringify({ type: 'resync', v: PROTOCOL_VERSION }));
    const sync = await waitForMessage(
      seat,
      (message) => message.type === 'sync' && message.epoch > beforeEpoch,
      10_000,
    );
    restartContext.seats[seat].resyncAcceptedAt = Date.now();
    restartContext.seats[seat].resyncSyncEpoch = sync.epoch;
    event({ type: 'restart-resync-accepted', restart: index, seat, epoch: sync.epoch, seq: sync.seq });
    socket.send(JSON.stringify({ type: 'resync', v: PROTOCOL_VERSION }));
    const limited = await waitForMessage(
      seat,
      (message) => message.type === 'error' && message.code === 'resync-rate-limited',
      10_000,
    );
    restartContext.seats[seat].resyncRateLimitedAt = Date.now();
    event({
      type: 'restart-resync-rate-limited',
      restart: index,
      seat,
      code: limited.code,
      message: limited.message,
    });
    restartContext.seatTestingResync = null;
  }

  // Replay the exact last pre-restart sync and delta through the preserved
  // reducer. Both must be refused without changing the restored baseline.
  for (const seat of [0, 1]) {
    const syncReject = savedSync[seat] ? assemblers[seat].apply(savedSync[seat]) : null;
    const deltaReject = savedDelta[seat] ? assemblers[seat].apply(savedDelta[seat]) : null;
    restartContext.seats[seat].staleSyncReject = syncReject
      ? { ok: syncReject.ok, reason: syncReject.reason ?? null, detail: syncReject.detail ?? null }
      : null;
    restartContext.seats[seat].staleDeltaReject = deltaReject
      ? { ok: deltaReject.ok, reason: deltaReject.reason ?? null, detail: deltaReject.detail ?? null }
      : null;
    event({
      type: 'restart-stale-replay',
      restart: index,
      seat,
      sync: restartContext.seats[seat].staleSyncReject,
      delta: restartContext.seats[seat].staleDeltaReject,
    });
  }

  const after = await pollStatus({ forceSample: true });
  const afterTiming = after.matchTiming ?? null;
  const rollbackTicks =
    preTick !== null && restoredSnapshotTick !== null ? preTick - restoredSnapshotTick : null;
  const rollbackMs = rollbackTicks !== null ? rollbackTicks * 50 : null;
  const stopState = latest.map((state) => state?.tick ?? null);
  const record = {
    index,
    scheduledAgeMs: ageTargetMs,
    checkpointObservedAt,
    checkpointObservedAtIso: new Date(checkpointObservedAt).toISOString(),
    checkpointAgeAtRequestMs: checkpointAgeAtRequest,
    checkpointAgeAtAbortApproxMs: checkpointAgeAtAbortApprox,
    ageSinceAnyPersistenceSuccessMs,
    lastSuccessAt,
    lastSuccessAtIso: lastSuccessAt === null ? null : new Date(lastSuccessAt).toISOString(),
    lastCheckpointTick,
    snapshotCyclesBefore,
    snapshotCyclesAfterRestore: restoredPersistence?.snapshotCycles ?? null,
    preTick,
    preEpochs,
    preSeqs,
    restoredSnapshotTick,
    restoredTotalTicks,
    restoredProcessTicks,
    restoredAtIso: restoredInfo.at,
    postRestartTickAfterChecks: afterTiming?.totalTicks ?? after.match?.tick ?? null,
    processTicksAfterChecks: afterTiming?.processTicks ?? null,
    rollbackTicks,
    rollbackMs,
    withinCheckpointInterval: rollbackMs !== null ? rollbackMs <= 15_000 : null,
    restartRequestedAt: new Date(restartRequestedAt).toISOString(),
    restartResponseAt: new Date(restartResponseAt).toISOString(),
    socketsClosedAt: restartContext.closed.map((value) => (value ? new Date(value).toISOString() : null)),
    closedAfterRequestMs: restartContext.closed.map((value) => (value === null ? null : value - restartRequestedAt)),
    restoredStatusAfterCloseMs: restoredInfo.at ? Date.parse(restoredInfo.at) - closedAt : null,
    reconnect: reconnectResults.map((entry, seat) => ({
      seat,
      connectMs: entry.connectMs,
      firstSyncAt: restartContext.seats[seat].firstSyncAt,
      firstSyncMsAfterClose:
        restartContext.seats[seat].firstSyncAt === null
          ? null
          : restartContext.seats[seat].firstSyncAt - closedAt,
      firstSyncTick: restartContext.seats[seat].firstSyncTick,
      firstSyncEpoch: restartContext.seats[seat].firstSyncEpoch,
      firstSyncSeq: restartContext.seats[seat].firstSyncSeq,
      firstSyncHadMap: restartContext.seats[seat].firstSyncHadMap,
      firstSyncFogTiles: restartContext.seats[seat].firstSyncFogTiles,
      firstSyncStateTick: restartContext.seats[seat].firstSyncStateTick,
      firstDeltaAt: restartContext.seats[seat].firstDeltaAt,
      firstDeltaMsAfterSync:
        restartContext.seats[seat].firstDeltaAt === null ||
        restartContext.seats[seat].firstSyncAt === null
          ? null
          : restartContext.seats[seat].firstDeltaAt - restartContext.seats[seat].firstSyncAt,
      firstDeltaTick: restartContext.seats[seat].firstDeltaTick,
      firstDeltaEpoch: restartContext.seats[seat].firstDeltaEpoch,
      firstCommandAt: restartContext.seats[seat].firstCommandAt,
      firstCommandMsAfterSync:
        restartContext.seats[seat].firstCommandAt === null ||
        restartContext.seats[seat].firstSyncAt === null
          ? null
          : restartContext.seats[seat].firstCommandAt - restartContext.seats[seat].firstSyncAt,
      firstCommandAccepted: restartContext.seats[seat].firstCommandAccepted,
      firstCommandTick: restartContext.seats[seat].firstCommandTick,
      resyncAcceptedAt: restartContext.seats[seat].resyncAcceptedAt,
      resyncRateLimitedAt: restartContext.seats[seat].resyncRateLimitedAt,
      resyncSyncEpoch: restartContext.seats[seat].resyncSyncEpoch,
      staleSyncReject: restartContext.seats[seat].staleSyncReject,
      staleDeltaReject: restartContext.seats[seat].staleDeltaReject,
      stateTickAfterRecovery: stopState[seat],
    })),
    postRestartCommands,
    postCheckpointCommands: postCheckpointCommand.map((entry) => ({
      seat: entry.seat,
      purpose: entry.purpose,
      commandType: entry.commandType,
      accepted: entry.ack?.accepted ?? null,
      tick: entry.ack?.message?.tick ?? null,
    })),
    startContinuity: {
      before: before.matchTiming?.startedAtMs ?? null,
      after: after.matchTiming?.startedAtMs ?? null,
      deadlineBefore: before.matchDeadlineAt ?? null,
      deadlineAfter: after.matchDeadlineAt ?? null,
    },
    rejectedUpdates: stats.rejectedUpdates,
    lastReject: stats.lastReject,
  };
  writeFileSync(join(evidenceDir, `restart-${index}.json`), JSON.stringify(record, null, 2));
  event({ type: 'restart-recovered', restart: index, ...record });
  log('restart recovered', {
    index,
    checkpointAgeAtRequestMs: record.checkpointAgeAtRequestMs,
    rollbackTicks,
    rollbackMs,
    restoredSnapshotTick,
    reconnectMs: record.reconnect.map((entry) => entry.firstSyncMsAfterClose),
  });
  restartContext = null;
  expectedRestart = false;
  restartState = 'idle';
  fastPolling = false;
  return record;
}

async function run() {
  const health = await fetch(`${base}/api/multiplayer/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.onlineEnabled, true);
  log('health', health);

  roomId = `${label.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-${Date.now().toString(36)}`;
  const created = await createRoom();
  room = sanitizeRoom(created);
  writeFileSync(roomPathFile, JSON.stringify(room, null, 2));
  log('room created', room);
  event({ type: 'room-created', room });

  for (const seat of [0, 1]) {
    assemblers[seat] = new SnapshotAssembler({ roomId, team: seat });
    const seatRecord = created.seats.find((entry) => entry.seatId === seat);
    seatTokens[seat] = seatRecord.token;
  }
  const initialConnects = await Promise.all([0, 1].map((seat) => connectSeat(seat)));
  for (const seat of [0, 1]) {
    event({
      type: 'initial-connect',
      seat,
      epoch: initialConnects[seat].sync.epoch,
      seq: initialConnects[seat].sync.seq,
      tick: initialConnects[seat].sync.tick,
      connectMs: initialConnects[seat].connectMs,
    });
  }
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  log('both seats connected', { startedAtIso });
  await pollStatus({ forceSample: true });

  keepaliveTimer = setInterval(() => {
    for (const seat of [0, 1]) {
      const socket = sockets[seat];
      if (!socket?.open) continue;
      socket.send(JSON.stringify({ type: 'keepalive', v: PROTOCOL_VERSION }));
      stats.keepalivesSent[seat]++;
    }
  }, 20_000);
  keepaliveTimer.unref();

  const firstProductionMs = isMain ? 60_000 : 10_000;
  const nextProductionAt = [startedAt + firstProductionMs, startedAt + firstProductionMs + 2_000];
  const nextCommandAt = [startedAt + 2_000, startedAt + 3_000];
  let sequence = 0;
  let lastPollAt = 0;

  while (Date.now() - startedAt < targetMs + 20_000) {
    if (abortReason) break;
    const now = Date.now();
    const elapsed = now - startedAt;
    if (stats.lastIntervalAt === null) stats.lastIntervalAt = now;
    if (now - stats.lastIntervalAt >= intervalMs) {
      writeInterval(now, startedAt);
      stats.lastIntervalAt = now;
    }
    const nextRestartOffset = restartOffsets[restartScheduleIndex];
    if (
      nextRestartOffset !== undefined &&
      elapsed >= nextRestartOffset - 15_000 &&
      restartState !== 'restarting'
    ) {
      fastPolling = true;
    }
    if (now - lastPollAt >= (fastPolling ? fastStatusPollMs : statusPollMs)) {
      lastPollAt = now;
      try {
        await pollStatus();
      } catch (error) {
        noteError('status-poll', error);
      }
    }

    if (
      restartState === 'idle' &&
      restartScheduleIndex < restartOffsets.length &&
      elapsed >= restartOffsets[restartScheduleIndex]
    ) {
      restartState = 'waiting-checkpoint';
      restartBaselineCheckpoint = lastCheckpoint?.snapshotCycles ?? null;
      restartSelectedCheckpoint = null;
      restartDueAt = null;
      log('restart waiting for a fresh checkpoint', {
        index: restartScheduleIndex,
        baseline: restartBaselineCheckpoint,
      });
      event({
        type: 'restart-wait-checkpoint',
        restart: restartScheduleIndex,
        scheduledOffsetMs: restartOffsets[restartScheduleIndex],
        targetAgeMs: restartAges[restartScheduleIndex % restartAges.length],
        baselineSnapshotCycles: restartBaselineCheckpoint,
      });
    }
    if (restartState === 'waiting-checkpoint') {
      const current = lastCheckpoint?.snapshotCycles ?? null;
      if (
        current !== null &&
        lastCheckpoint?.observedAt &&
        current !== restartBaselineCheckpoint
      ) {
        const targetAgeMs = restartAges[restartScheduleIndex % restartAges.length];
        restartSelectedCheckpoint = { ...lastCheckpoint };
        restartDueAt = lastCheckpoint.observedAt + targetAgeMs;
        restartState = 'waiting-offset';
        event({
          type: 'restart-checkpoint-selected',
          restart: restartScheduleIndex,
          checkpointObservedAt: lastCheckpoint.observedAt,
          checkpointObservedAtIso: new Date(lastCheckpoint.observedAt).toISOString(),
          checkpointLastSuccessAt: lastCheckpoint.lastSuccessAt,
          checkpointTickAtObservation: lastCheckpoint.totalTicks,
          snapshotCycles: lastCheckpoint.snapshotCycles,
          targetAgeMs,
        });
        log('restart scheduled after checkpoint', {
          restart: restartScheduleIndex,
          targetAgeMs,
        });
      }
    }
    if (restartState === 'waiting-offset' && now >= restartDueAt) {
      restartState = 'restarting';
      try {
        await runRestart(restartScheduleIndex, restartSelectedCheckpoint);
        restartScheduleIndex++;
      } catch (error) {
        noteError('restart', error);
        abortReason = `restart ${restartScheduleIndex} failed: ${
          error instanceof Error ? error.message : String(error)
        }`;
        break;
      }
    }

    if (!expectedRestart && !restartContext && !stopping) {
      const seat = stats.commandsSent[0] <= stats.commandsSent[1] ? 0 : 1;
      if (now >= nextCommandAt[seat] && !pending[seat]) {
        const snapshot = latest[seat];
        if (!snapshot) {
          nextCommandAt[seat] = now + 1_000;
        } else {
          const productionDue = now >= nextProductionAt[seat];
          const choice = chooseCommand(snapshot, seat, sequence, productionDue);
          if (!choice) {
            nextCommandAt[seat] = now + 2_000;
          } else {
            const result = sendCommand(seat, choice, false);
            if (choice.purpose === 'production') nextProductionAt[seat] = now + productionEveryMs;
            if (result) {
              sequence++;
              nextCommandAt[seat] = now + commandEveryMs;
              const ack = await Promise.race([result, sleep(1_500).then(() => null)]);
              if (!ack) {
                stats.commandTimeouts[seat]++;
                event({ type: 'command-timeout', seat, purpose: choice.purpose, commandType: choice.command.type });
                pending[seat] = null;
              }
            } else {
              nextCommandAt[seat] = now + 1_000;
            }
          }
        }
      }
    }

    if (stats.results[0] && stats.results[1]) break;
    await sleep(100);
  }

  stopping = true;
  const endedAt = Date.now();
  const elapsedMs = endedAt - startedAt;
  stats.resultAtMs = resultReceivedAt === null ? null : resultReceivedAt - startedAt;

  if (!stats.results[0] || !stats.results[1]) {
    if (isMain) {
      abortReason = abortReason ?? 'main soak ended without a result for both seats';
    } else {
      await api(roomPath(roomId, '/shutdown'), 'POST', {});
    }
  }

  let finalStatus = null;
  for (let attempt = 0; attempt < 300; attempt++) {
    const response = await api(roomPath(roomId, '/status'));
    finalStatus = sanitizeStatus(response.data);
    if (finalStatus?.closed) break;
    await sleep(100);
  }
  if (finalStatus) writeFileSync(finalStatusPath, JSON.stringify(finalStatus, null, 2));

  const summary = buildSummary({
    health,
    startedAt,
    startedAtIso,
    endedAt,
    elapsedMs,
    finalStatus,
    abortReason,
  });
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  log('summary written', {
    evidenceDir,
    elapsedMs,
    serverTicks: finalStatus?.match?.stats?.ticks ?? null,
    results: stats.results.map((result) => result?.outcome ?? null),
    abortReason,
  });

  if (abortReason) process.exitCode = 4;
  else if (stats.errors.some((error) => error.scope !== 'seat-0-error' && error.scope !== 'seat-1-error')) {
    process.exitCode = 5;
  }
}

function writeInterval(now, startedAt) {
  const elapsedMs = now - startedAt;
  const snapshotDeltas = [0, 1].map(
    (seat) => stats.snapshots[seat] - stats.lastIntervalSnapshotCounts[seat],
  );
  const byteDeltas = [0, 1].map(
    (seat) => stats.snapshotBytes[seat] - stats.lastIntervalBytes[seat],
  );
  const interval = {
    type: 'interval',
    index: stats.intervalIndex++,
    elapsedMs,
    snapshots: snapshotDeltas,
    snapshotBytes: byteDeltas,
    snapshotAvgBytes: [0, 1].map((seat) =>
      snapshotDeltas[seat] ? Math.round(byteDeltas[seat] / snapshotDeltas[seat]) : null,
    ),
    lastTick: [...stats.lastTick],
    longestGapMs: [...stats.longestGapMs],
    commandsSent: [...stats.commandsSent],
    commandsAccepted: [...stats.commandsAccepted],
    commandsRejected: [...stats.commandsRejected],
    commandTimeouts: [...stats.commandTimeouts],
    keepalivesSent: [...stats.keepalivesSent],
    keepaliveAcks: [...stats.keepaliveAcks],
    pending: pending.map((entry) => (entry ? entry.command.type : null)),
    syncs: [...stats.syncs],
    deltas: [...stats.deltas],
    deltaBytes: [...stats.deltaBytes],
    latestEntities: latest.map((snapshot) => snapshot?.entities.length ?? null),
    latestOwnUnits: latest.map((snapshot, seat) =>
      snapshot
        ? snapshot.entities.filter(
            (entity) => entity.kind === 'unit' && entity.team === seat && !entity.remembered,
          ).length
        : null,
    ),
    latestVisibleEnemies: latest.map((snapshot, seat) =>
      snapshot
        ? snapshot.entities.filter(
            (entity) => entity.kind === 'unit' && entity.team !== seat && !entity.remembered,
          ).length
        : null,
    ),
    clientHeapMb: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
  };
  stats.lastIntervalSnapshotCounts = [...stats.snapshots];
  stats.lastIntervalBytes = [...stats.snapshotBytes];
  event(interval);
  log('interval', {
    index: interval.index,
    elapsedMs,
    snapshots: interval.snapshots,
    commands: [interval.commandsAccepted, interval.commandsRejected, interval.commandTimeouts],
    ticks: interval.lastTick,
    entities: interval.latestEntities,
  });
}

function buildSummary(input) {
  const { finalStatus } = input;
  const server = finalStatus?.match;
  const serverElapsed =
    server?.startedAtMs && server?.finishedAtMs ? server.finishedAtMs - server.startedAtMs : null;
  const expectedTicks = serverElapsed === null ? null : Math.round(serverElapsed / 50);
  const tickDeltas = [0, 1].map((seat) => {
    const histogram = {};
    for (const delta of stats.tickDeltas[seat]) histogram[delta] = (histogram[delta] ?? 0) + 1;
    return histogram;
  });
  const reconstructed = [0, 1].map((seat) => assemblers[seat]?.state() ?? null);
  const winner = stats.results[0]?.result?.winnerTeam ?? null;
  const expectedOutcome = (seat) =>
    stats.results[seat]?.outcome === undefined
      ? null
      : winner === null
        ? 'draw'
        : winner === seat
          ? 'victory'
          : 'defeat';
  return {
    test: {
      label,
      base,
      isMain,
      targetMs,
      startedAt: input.startedAtIso,
      endedAt: new Date(input.endedAt).toISOString(),
      wallElapsedMs: input.elapsedMs,
      intervalMs,
      commandEveryMs,
      productionEveryMs,
      statusPollMs,
      fastStatusPollMs,
      restartOffsets,
      restartAges,
      evidenceDir,
    },
    health: input.health,
    room: room,
    results: stats.results.map((result) =>
      result
        ? {
            outcome: result.outcome,
            winnerTeam: result.result?.winnerTeam,
            reason: result.result?.reason,
            tick: result.result?.tick,
          }
        : null,
    ),
    resultAtMs: stats.resultAtMs,
    abortReason: input.abortReason,
    server: server
      ? {
          phase: server.phase,
          tick: server.tick,
          startedAtMs: server.startedAtMs,
          finishedAtMs: server.finishedAtMs,
          elapsedMs: serverElapsed,
          expectedTicksAt20Hz: expectedTicks,
          actualTicks: server.stats?.ticks ?? null,
          effectiveHz:
            serverElapsed && server.stats?.ticks != null
              ? server.stats.ticks / (serverElapsed / 1000)
              : null,
          stats: server.stats ?? null,
          diagnostics: server.diagnostics ?? null,
          result: server.result ?? null,
        }
      : null,
    reservation: finalStatus?.reservation ?? null,
    closed: finalStatus?.closed ?? null,
    restarts: (() => {
      try {
        return restartOffsets.map((_, index) =>
          JSON.parse(readFileSync(join(evidenceDir, `restart-${index}.json`), 'utf8')),
        );
      } catch {
        return [];
      }
    })(),
    snapshots: [0, 1].map((seat) => ({
      seat,
      count: stats.snapshots[seat],
      bytes: stats.snapshotBytes[seat],
      frequencyHz: input.elapsedMs > 0 ? stats.snapshots[seat] / (input.elapsedMs / 1000) : null,
      sizes: distribution(stats.snapshotSizes[seat]),
      gaps: distribution(stats.snapshotGaps[seat]),
      longestGapMs: stats.longestGapMs[seat],
      firstTick: stats.firstTick[seat],
      lastTick: stats.lastTick[seat],
      tickDeltas: tickDeltas[seat],
    })),
    protocol: {
      version: PROTOCOL_VERSION,
      syncs: stats.syncs,
      deltas: stats.deltas,
      syncBytes: stats.syncBytes,
      deltaBytes: stats.deltaBytes,
      firstSyncBytes: stats.firstSyncBytes,
      syncMapBytes: stats.syncMapBytes,
      syncFogBytes: stats.syncFogBytes,
      deltaMapBytes: stats.deltaMapBytes,
      deltaSize: [distribution(stats.deltaSizes[0]), distribution(stats.deltaSizes[1])],
      fogEntries: stats.fogEntries,
      deltaFieldBytes: stats.deltaFieldBytes,
      epochs: stats.epochs,
      resyncRequests: stats.resyncRequests,
      rejectedUpdates: stats.rejectedUpdates,
      lastReject: stats.lastReject,
    },
    reconstruction: {
      ready: [0, 1].map((seat) => Boolean(assemblers[seat]?.ready)),
      epoch: [0, 1].map((seat) => assemblers[seat]?.epoch ?? null),
      seq: [0, 1].map((seat) => assemblers[seat]?.seq ?? null),
      tick: reconstructed.map((state) => state?.tick ?? null),
      phase: reconstructed.map((state) => state?.result?.phase ?? null),
      entities: reconstructed.map((state) => state?.entities.length ?? null),
      fogTiles: reconstructed.map((state) => state?.fog?.length ?? null),
      mapTiles: reconstructed.map((state) => state?.map?.terrain?.length ?? null),
      serverTick: server?.tick ?? null,
      serverPhase: server?.phase ?? null,
      tickMatches: reconstructed.every(
        (state) => Boolean(state) && server?.tick !== undefined && state.tick === server.tick,
      ),
      outcomesMatch: [0, 1].every(
        (seat) => stats.results[seat] && stats.results[seat].outcome === expectedOutcome(seat),
      ),
    },
    stateSamples: stats.stateSamples,
    commands: {
      sent: stats.commandsSent,
      accepted: stats.commandsAccepted,
      rejected: stats.commandsRejected,
      timeouts: stats.commandTimeouts,
      byType: stats.commandByType,
      rejectionByCode: stats.rejectionByCode,
      latencyMs: distribution(stats.commandLatencies),
      ackAnomalies: stats.ackAnomalies,
    },
    socketCloses: stats.socketCloses,
    reconnects: {
      counts: stats.reconnects,
      attempts: stats.reconnectAttempts,
      failures: stats.reconnectFailures,
    },
    keepalive: {
      sent: stats.keepalivesSent,
      acked: stats.keepaliveAcks,
      server: server?.diagnostics?.keepalive ?? null,
    },
    checkpoints: {
      observed: stats.checkpointsSeen,
      last: lastCheckpoint,
    },
    errors: stats.errors,
    clientMemory: {
      note: 'Node client heap only; not server memory.',
      heapUsedMb: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
      rssMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
    },
  };
}

process.on('SIGINT', () => {
  stopping = true;
  abortReason = 'SIGINT';
  log('SIGINT received; aborting');
});

try {
  await run();
} catch (error) {
  noteError('run', error);
  const summary = buildSummary({
    health: null,
    startedAt: Date.now(),
    startedAtIso: new Date().toISOString(),
    endedAt: Date.now(),
    elapsedMs: 0,
    finalStatus: null,
    abortReason: error instanceof Error ? error.message : String(error),
  });
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  process.exitCode = 2;
} finally {
  stopping = true;
  if (keepaliveTimer !== null) clearInterval(keepaliveTimer);
  for (const socket of sockets) {
    try {
      socket?.close();
    } catch {
      /* already gone */
    }
  }
  await sleep(300);
}
