#!/usr/bin/env node
// Phase 2A.1 deployed soak harness.
//
// Creates one authoritative 1v1 staging room, connects two independent raw
// WebSocket clients, issues bounded move/attack/production commands and writes
// timestamped evidence. It never logs seat or admin tokens.
//
// Main soak:
//   MP_ADMIN_TOKEN=<token> node tools/phase2a1-soak.mjs
//
// Short command/transport probe:
//   MP_SOAK_MS=20000 MP_SOAK_LABEL=probe node tools/phase2a1-soak.mjs
//
// The match is not restarted if it ends early. A non-zero exit means the test
// failed or was aborted; the evidence directory is still written.

import assert from 'node:assert/strict';
import {
  appendFileSync,
  existsSync,
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
const label = process.env.MP_SOAK_LABEL ?? 'main-30m';
const isMain = targetMs >= 1_800_000;
const intervalMs = Number(process.env.MP_INTERVAL_MS ?? 30_000);
const commandEveryMs = Number(process.env.MP_COMMAND_EVERY_MS ?? 5_000);
// Optional RFC 6455 ping for the diagnostic raw client. Application keepalive
// is the protocol-level mechanism; this transport ping exists only because the
// long-lived raw HTTPS socket is the piece of the harness that has dropped on
// this host, and it is disabled unless explicitly requested.
const wsPingMs = Number(process.env.MP_WS_PING_MS ?? 0);
const productionEveryMs = Number(process.env.MP_PRODUCTION_EVERY_MS ?? 180_000);
const maxCommandLatencyMs = 3_000;
// Deliberately silent seat: still connected and keepalive-driven, but never
// generates a gameplay command. Set only for the Phase 2A.3 idle-seat soak.
const idleSeat = process.env.MP_IDLE_SEAT === undefined ? null : Number(process.env.MP_IDLE_SEAT);
if (idleSeat !== null && idleSeat !== 0 && idleSeat !== 1) {
  console.error('MP_IDLE_SEAT must be 0 or 1.');
  process.exit(2);
}

if (!admin) {
  console.error('MP_ADMIN_TOKEN is required.');
  process.exit(2);
}
if (!Number.isFinite(targetMs) || targetMs < 10_000) {
  console.error('MP_SOAK_MS must be at least 10000.');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceRoot = process.env.MP_EVIDENCE_ROOT ?? 'staging-evidence';
const evidenceDir = join(evidenceRoot, `${label}-${stamp}`);
mkdirSync(evidenceDir, { recursive: true });
const metricsPath = join(evidenceDir, 'metrics.jsonl');
const summaryPath = join(evidenceDir, 'summary.json');
const statusPath = join(evidenceDir, 'status-final.json');
const runLogPath = join(evidenceDir, 'run.log');

const sockets = [];
const seatTokens = [null, null];
const reconnecting = [false, false];
let keepaliveTimer = null;
let wsPingTimer = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function log(message, extra) {
  const line = `[${nowIso()}] ${message}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}`;
  console.log(line);
  appendFileSync(runLogPath, line + '\n');
}

function metric(record) {
  appendFileSync(metricsPath, JSON.stringify({ at: nowIso(), ...record }) + '\n');
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

const roomPath = (roomId, suffix = '') =>
  `/api/multiplayer/rooms/${encodeURIComponent(roomId)}${suffix}`;

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
  const map = bytes(snapshot.map);
  const fog = bytes(snapshot.fog);
  const entities = bytes(snapshot.entities);
  const players = bytes(snapshot.players);
  const events = bytes(snapshot.events);
  const projectiles = bytes(snapshot.projectiles);
  const contacts = bytes(snapshot.contacts);
  return {
    total,
    map,
    fog,
    entities,
    players,
    events,
    projectiles,
    contacts,
    mapRatio: total ? map / total : null,
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
  commandsSent: 0,
  commandsAccepted: 0,
  commandsRejected: 0,
  commandTimeouts: 0,
  commandByType: {},
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
};

const latest = [null, null];
const assemblers = [null, null];
const lastResyncAt = [0, 0];
const pending = [null, null];
let room = null;
let resultReceivedAt = null;
let stopping = false;
let abortReason = null;

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
        metric({ type: 'assembly-reject', seat, reason: applied.reason, detail: applied.detail });
        if (Date.now() - lastResyncAt[seat] >= 5000) {
          lastResyncAt[seat] = Date.now();
          stats.resyncRequests[seat]++;
          socket.send(JSON.stringify({ type: 'resync', v: PROTOCOL_VERSION }));
        }
        return;
      }
      if (applied.kind === 'sync') {
        stats.syncs[seat]++;
        stats.syncBytes[seat] += bytes;
        stats.epochs[seat] = assembler.epoch;
        if (stats.firstSyncBytes[seat] === null) stats.firstSyncBytes[seat] = bytes;
        // The map is present only on the first sync, reconnect or explicit
        // resync; periodic checkpoints retain the client's existing map.
        if (message.state.map !== undefined) {
          stats.syncMapBytes[seat] += Buffer.byteLength(
            JSON.stringify(message.state.map),
            'utf8',
          );
        }
        stats.syncFogBytes[seat] += Buffer.byteLength(JSON.stringify(message.state.fog), 'utf8');
      } else {
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
        metric({ type: 'ack-without-command', seat, message });
        return;
      }
      const latency = at - current.sentAt;
      stats.commandLatencies.push(latency);
      if (message.type === 'commandAccepted') {
        stats.commandsAccepted++;
        metric({
          type: 'command-result',
          seat,
          purpose: current.purpose,
          commandType: current.command.type,
          outcome: 'accepted',
          latencyMs: latency,
          tick: message.tick,
        });
      } else {
        stats.commandsRejected++;
        stats.rejectionByCode[message.code] = (stats.rejectionByCode[message.code] ?? 0) + 1;
        metric({
          type: 'command-result',
          seat,
          purpose: current.purpose,
          commandType: current.command.type,
          outcome: 'rejected',
          code: message.code,
          detail: message.detail,
          latencyMs: latency,
        });
      }
      pending[seat] = null;
      return;
    }
    if (message.type === 'keepaliveAck') {
      stats.keepaliveAcks[seat]++;
      return;
    }
    if (message.type === 'result') {
      stats.results[seat] = message;
      if (resultReceivedAt === null) resultReceivedAt = at;
      metric({
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
      metric({ type: 'room-closed-message', seat, code: message.code, reason: message.reason });
      return;
    }
    if (message.type === 'error') {
      stats.errors.push({ at: nowIso(), scope: `seat-${seat}-error`, code: message.code });
      metric({ type: 'server-error', seat, code: message.code, message: message.message });
    }
  });
  socket.onClose(() => {
    stats.socketCloses.push({ at: nowIso(), seat, code: socket.closeCode, reason: socket.closeReason });
    metric({ type: 'socket-close', seat, code: socket.closeCode, reason: socket.closeReason });
    // A stale socket's close must not tear down a newer connection for the
    // same seat. Reconnect within the server's abandonment window instead of
    // treating any transport blip as a failed soak.
    if (sockets[seat] !== socket) return;
    if (stopping || resultReceivedAt !== null) return;
    void reconnectSeat(seat, `close-${socket.closeCode ?? 'none'}`);
  });
}

async function reconnectSeat(seat, cause) {
  if (reconnecting[seat] || stopping || resultReceivedAt !== null) return;
  if (!room || !seatTokens[seat]) return;
  reconnecting[seat] = true;
  const beganAt = Date.now();
  const attempts = Number(process.env.MP_RECONNECT_ATTEMPTS ?? 8);
  log('seat reconnecting', { seat, cause });
  metric({ type: 'reconnect-start', seat, cause });
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (stopping || resultReceivedAt !== null) {
      reconnecting[seat] = false;
      return;
    }
    await sleep(Math.min(2_000, 250 * attempt));
    stats.reconnectAttempts[seat]++;
    const connected = await rawHandshake(base, room.roomId, seat, seatTokens[seat], base);
    if (connected.status === 101) {
      sockets[seat] = connected.socket;
      stats.reconnects[seat]++;
      reconnecting[seat] = false;
      attachSocket(seat, connected.socket);
      metric({
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
    metric({
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

async function createRoom(roomId) {
  const matchDurationMs = Math.min(1_800_000, targetMs + (isMain ? 0 : 10_000));
  const response = await api(roomPath(roomId), 'POST', {
    roomId,
    mode: '1v1',
    matchDurationMs,
  });
  if (response.status !== 200 || !response.data?.ok) {
    throw new Error(`room create failed: HTTP ${response.status} ${response.data?.code ?? ''}`);
  }
  return response.data;
}

async function run() {
  const health = await fetch(`${base}/api/multiplayer/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.onlineEnabled, true);
  log('health', health);

  const roomId = `${label.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-${Date.now().toString(36)}`;
  const created = await createRoom(roomId);
  room = sanitizeRoom(created);
  writeFileSync(join(evidenceDir, 'room.json'), JSON.stringify(room, null, 2));
  log('room created', room);

  for (const seat of [0, 1]) {
    assemblers[seat] = new SnapshotAssembler({ roomId, team: seat });
    const seatRecord = created.seats.find((entry) => entry.seatId === seat);
    seatTokens[seat] = seatRecord.token;
    const connected = await rawHandshake(base, roomId, seat, seatRecord.token, base);
    if (connected.status !== 101) throw new Error(`seat ${seat} handshake ${connected.status}`);
    sockets.push(connected.socket);
    attachSocket(seat, connected.socket);
  }

  const helloZero = await waitRawMessage(sockets[0], (message) => message.type === 'hello', 10_000);
  const helloOne = await waitRawMessage(sockets[1], (message) => message.type === 'hello', 10_000);
  await waitRawMessage(sockets[0], (message) => message.type === 'sync', 10_000);
  await waitRawMessage(sockets[1], (message) => message.type === 'sync', 10_000);
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  log('both seats connected', { seat0: helloZero.seat, seat1: helloOne.seat, startedAtIso });

  // A seat that runs out of controllable units has nothing to send. Leave a
  // one-way idle flow and the first Phase 2A.2 main run lost seat 1 at 941 s.
  // Application keepalive keeps a seat alive without sending gameplay commands.
  keepaliveTimer = setInterval(() => {
    for (const seat of [0, 1]) {
      const socket = sockets[seat];
      if (!socket?.open) continue;
      socket.send(JSON.stringify({ type: 'keepalive', v: PROTOCOL_VERSION }));
      stats.keepalivesSent[seat]++;
    }
  }, 20_000);
  keepaliveTimer.unref();

  if (Number.isFinite(wsPingMs) && wsPingMs > 0) {
    wsPingTimer = setInterval(() => {
      for (const socket of sockets) {
        if (socket?.open) socket.ping();
      }
    }, wsPingMs);
    wsPingTimer.unref();
    log('transport ping enabled', { wsPingMs });
  }

  // Give the scheduler a moment to enter playing before the first interval.
  await sleep(500);
  const firstProductionMs = isMain ? 60_000 : 10_000;
  let nextCommandAt = [startedAt + 3_000, startedAt + 5_000];
  let nextProductionAt = [
    startedAt + firstProductionMs,
    startedAt + firstProductionMs + 2_000,
  ];
  let sequence = 0;

  while (Date.now() - startedAt < targetMs) {
    if (abortReason) break;
    const now = Date.now();
    const elapsed = now - startedAt;
    if (stats.lastIntervalAt === null) stats.lastIntervalAt = now;
    if (now - stats.lastIntervalAt >= intervalMs) {
      writeInterval(now, startedAt);
      stats.lastIntervalAt = now;
    }

    for (const seat of [0, 1]) {
      if (seat === idleSeat) continue;
      if (now < nextCommandAt[seat]) continue;
      if (pending[seat] && now - pending[seat].sentAt < maxCommandLatencyMs) continue;
      if (pending[seat]) {
        stats.commandTimeouts++;
        metric({
          type: 'command-timeout',
          seat,
          purpose: pending[seat].purpose,
          commandType: pending[seat].command.type,
          ageMs: now - pending[seat].sentAt,
        });
        pending[seat] = null;
      }
      const snapshot = latest[seat];
      if (!snapshot) {
        nextCommandAt[seat] = now + 1_000;
        continue;
      }
      const productionDue = now >= nextProductionAt[seat];
      const choice = chooseCommand(snapshot, seat, sequence, productionDue);
      if (!choice) {
        nextCommandAt[seat] = now + 2_000;
        continue;
      }
      if (choice.purpose === 'production') nextProductionAt[seat] = now + productionEveryMs;
      const socket = sockets[seat];
      if (!socket?.open) {
        nextCommandAt[seat] = now + 500;
        continue;
      }
      const envelope = { type: 'command', v: PROTOCOL_VERSION, command: choice.command };
      socket.send(JSON.stringify(envelope));
      stats.commandsSent++;
      stats.commandByType[choice.command.type] =
        (stats.commandByType[choice.command.type] ?? 0) + 1;
      pending[seat] = {
        sentAt: now,
        purpose: choice.purpose,
        command: choice.command,
      };
      metric({
        type: 'command-sent',
        seat,
        elapsedMs: elapsed,
        purpose: choice.purpose,
        command: choice.command,
      });
      nextCommandAt[seat] = now + commandEveryMs;
    }

    if (stats.results[0] && stats.results[1]) break;
    if (isMain && now - startedAt > targetMs + 15_000) break;
    await sleep(250);
  }

  stopping = true;
  const endedAt = Date.now();
  const elapsedMs = endedAt - startedAt;
  stats.resultAtMs = resultReceivedAt === null ? null : resultReceivedAt - startedAt;

  if (!stats.results[0] || !stats.results[1]) {
    // The main soak should end with a server result. A short probe is stopped
    // explicitly through the admin shutdown path instead.
    if (isMain) {
      abortReason = abortReason ?? 'main soak ended without a result for both seats';
    } else {
      await api(roomPath(roomId, '/shutdown'), 'POST', {});
    }
  }

  let finalStatus = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await api(roomPath(roomId, '/status'));
    finalStatus = sanitizeStatus(response.data);
    if (finalStatus?.closed) break;
    await sleep(150);
  }
  if (finalStatus) writeFileSync(statusPath, JSON.stringify(finalStatus, null, 2));

  const summary = buildSummary({
    room,
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
    at: nowIso(),
    elapsedMs,
    snapshots: snapshotDeltas,
    snapshotBytes: byteDeltas,
    snapshotAvgBytes: [0, 1].map((seat) =>
      snapshotDeltas[seat] ? Math.round(byteDeltas[seat] / snapshotDeltas[seat]) : null,
    ),
    lastTick: [...stats.lastTick],
    longestGapMs: [...stats.longestGapMs],
    commandsSent: stats.commandsSent,
    commandsAccepted: stats.commandsAccepted,
    commandsRejected: stats.commandsRejected,
    commandTimeouts: stats.commandTimeouts,
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
  metric(interval);
  log('interval', {
    index: interval.index,
    elapsedMs,
    snapshots: interval.snapshots,
    avgBytes: interval.snapshotAvgBytes,
    commands: [interval.commandsAccepted, interval.commandsRejected, interval.commandTimeouts],
    entities: interval.latestEntities,
    visibleEnemies: interval.latestVisibleEnemies,
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
  const reconstruction = {
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
  };
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
      evidenceDir,
    },
    health: input.health,
    room: input.room,
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
    snapshots: [0, 1].map((seat) => ({
      seat,
      count: stats.snapshots[seat],
      bytes: stats.snapshotBytes[seat],
      frequencyHz:
        input.elapsedMs > 0 ? stats.snapshots[seat] / (input.elapsedMs / 1000) : null,
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
    reconstruction,
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
      server: server.diagnostics?.keepalive ?? null,
      idleSeat,
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
    room,
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
  if (wsPingTimer !== null) clearInterval(wsPingTimer);
  for (const socket of sockets) {
    try {
      socket.close();
    } catch {
      /* already gone */
    }
  }
  await sleep(300);
}
