import { TILE_SIZE } from '../src/sim/constants';
import { createIslandAssault } from '../src/data/scenarios';
import { Game } from '../src/sim/game';
import { Terrain, tileIndex } from '../src/sim/terrain';
import { gateCommand } from './commandGate';
import { projectForTeam } from './projection';

/**
 * Phase-0 Durable Object room.
 *
 * This is a measurement prototype, not a production room. It runs the existing
 * Game at 20 Hz, accepts four dev seats (two per team), projects snapshots at
 * 10 Hz and records the costs the report needs. All transient room state stays
 * in memory: no SQLite row is written per tick.
 *
 * Seat authority comes from this object's seat table. A command's `team` is
 * ignored and replaced by the seat's team in `commandGate`.
 */

const SEAT_TEAMS = [0, 1, 0, 1];
const MAX_MESSAGE_BYTES = 4096;
const COMMAND_INTERVAL_MS = 100;
const SNAPSHOT_EVERY_TICKS = 2;
const SLOW_AFTER_DROPS = 12;
const SLOW_CLOSE_AFTER_DROPS = 40;
const EMPTY_ROOM_GRACE_MS = 60_000;

function envNumber(env, name, fallback) {
  const value = Number(env?.[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function scenarioFor(env) {
  const scenario = createIslandAssault();
  scenario.settings.seed = envNumber(env, 'PHASE0_SEED', scenario.settings.seed);
  scenario.settings.fog = true;
  scenario.players[0].isAI = false;
  scenario.players[1].isAI = env?.PHASE0_AI === '1';

  if (env?.PHASE0_STRESS === '1') {
    // The base theatre has 16 units and 7 structures. Add 70 units around each
    // start so the object starts at exactly 163 entities and stays there while
    // the tick budget is measured. They are kept near their own base to avoid
    // an unintended firefight changing the entity count mid-run.
    const land = [];
    for (let z = 6; z < scenario.height - 6; z++) {
      for (let x = 12; x < scenario.width - 8; x++) {
        const i = tileIndex(scenario.width, x, z);
        const t = scenario.tiles[i].t;
        if (t !== Terrain.DeepWater && t !== Terrain.ShallowWater) land.push([x, z]);
      }
    }
    const add = (owner, startX, startZ) => {
      const near = land.filter(([x, z]) => Math.hypot(x - startX, z - startZ) < 22);
      for (let i = 0; i < 70; i++) {
        const [x, z] = near[(i * 37 + 11) % near.length];
        scenario.units.push({ defId: i % 3 === 0 ? 'tank' : 'rifle', owner, x, z });
      }
    };
    add(0, scenario.players[0].startX, scenario.players[0].startZ);
    add(1, scenario.players[1].startX, scenario.players[1].startZ);
  }
  return scenario;
}

function summarize(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, p99: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}

function originAllowed(origin, env) {
  if (!origin) return env?.PHASE0_ALLOW_NO_ORIGIN === '1';
  const allowed = String(env?.PHASE0_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

function tokenAllowed(request, env) {
  const expected = String(env?.PHASE0_JOIN_TOKEN ?? '');
  if (!expected) return false;
  const url = new URL(request.url);
  const supplied = request.headers.get('x-phase0-token') ?? url.searchParams.get('token') ?? '';
  return supplied === expected;
}

export class Phase0Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.startedAt = Date.now();
    const gameStart = performance.now();
    this.game = new Game(scenarioFor(env), {
      localPlayerId: 0,
      enableAI: env?.PHASE0_AI === '1',
      aiSeed: envNumber(env, 'PHASE0_AI_SEED', 17),
      aiDifficulty: 'veteran',
    });
    this.startupMs = performance.now() - gameStart;
    this.roomId = 'unknown';
    this.closed = false;
    this.closedAt = null;
    this.quotaExhausted = false;
    this.quotaReason = null;
    this.timer = null;
    this.emptyTimer = null;
    this.nextTickAt = null;
    this.tickDurations = [];
    this.snapshotDurations = [];
    this.snapshotBytes = [];
    this.snapshotCount = 0;
    this.outboundFrames = 0;
    this.outboundBytes = 0;
    this.incomingMessages = 0;
    this.commandsAccepted = 0;
    this.commandsRejected = 0;
    this.connectionsAccepted = 0;
    this.errors = 0;
    this.sendFailures = 0;
    this.socketErrors = 0;
    this.tickSkips = 0;
    this.droppedSnapshots = 0;
    this.tickOverruns = 0;
    this.maxTickMs = 0;
    this.lastTickAt = null;
    this.lastEventSeq = 0;
    this.lastSnapshotAt = null;
    this.seats = SEAT_TEAMS.map((team, seat) => ({
      seat,
      team,
      ws: null,
      lastCommandAt: 0,
      unacked: 0,
      slow: false,
      dropped: 0,
      bytes: 0,
      frames: 0,
    }));
  }

  ensureLoop() {
    if (this.timer || this.closed) return;
    this.nextTickAt = performance.now() + 50;
    this.timer = setInterval(() => this.runTick(), 50);
  }

  stopLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.nextTickAt = null;
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  /**
   * Fixed 20 Hz clock. The interval is only a wake-up; the number of ticks is
   * derived from elapsed wall time so a late callback catches up instead of
   * silently slowing the simulation. Catch-up is capped at three ticks so a
   * suspended object cannot turn one wake-up into an unbounded CPU spike.
   */
  runTick() {
    if (this.closed) return;
    const wallNow = Date.now();
    const now = performance.now();
    if (this.nextTickAt === null) this.nextTickAt = now + 50;
    let ticks = 0;
    let snapshotDue = false;
    while (now >= this.nextTickAt && ticks < 3) {
      const start = performance.now();
      try {
        this.game.tick();
      } catch (error) {
        this.errors++;
        console.error('phase0 tick failed', error);
        return;
      }
      const elapsed = performance.now() - start;
      this.tickDurations.push(elapsed);
      this.maxTickMs = Math.max(this.maxTickMs, elapsed);
      if (elapsed > 50) this.tickOverruns++;
      this.nextTickAt += 50;
      ticks++;
      if (this.game.state.tick % SNAPSHOT_EVERY_TICKS === 0) snapshotDue = true;
      if (this.game.state.victory !== 'playing') break;
    }

    if (now - this.nextTickAt > 250) {
      const skipped = Math.floor((now - this.nextTickAt) / 50);
      if (skipped > 0) this.tickSkips += skipped;
      this.nextTickAt = now + 50;
    }
    if (ticks === 0) return;
    this.lastTickAt = wallNow;
    if (snapshotDue) this.broadcast();

    if (this.game.state.victory !== 'playing') {
      // Keep the sockets open for the final snapshot, but stop burning a timer
      // on a finished match. A real room would hand the result to a lobby.
      this.stopLoop();
    }
  }

  broadcast() {
    const teams = new Set(this.seats.filter((seat) => seat.ws && !seat.slow).map((seat) => seat.team));
    const since = this.lastEventSeq;
    for (const team of teams) {
      const projectionStart = performance.now();
      const snapshot = projectForTeam(this.game, team, since);
      const jsonText = JSON.stringify(snapshot);
      const bytes = new TextEncoder().encode(jsonText).byteLength;
      const projectionMs = performance.now() - projectionStart;
      this.snapshotDurations.push(projectionMs);
      this.snapshotBytes.push(bytes);
      this.snapshotCount++;
      this.lastSnapshotAt = Date.now();
      for (const seat of this.seats) {
        if (seat.team !== team || !seat.ws || seat.slow) continue;
        if (seat.ws.readyState !== undefined && seat.ws.readyState !== 1) {
          seat.ws = null;
          this.maybeEmpty();
          continue;
        }
        try {
          seat.ws.send(jsonText);
          seat.unacked++;
          seat.frames++;
          seat.bytes += bytes;
          this.outboundFrames++;
          this.outboundBytes += bytes;
        } catch {
          // A socket can close between the readyState check and send. That is a
          // normal disconnect race, not a simulation or protocol error.
          this.sendFailures++;
          this.dropSeat(seat, 'send-failed');
        }
      }
    }
    for (const seat of this.seats) {
      if (!seat.ws || seat.team === undefined) continue;
      if (seat.unacked <= SLOW_AFTER_DROPS) continue;
      seat.slow = true;
      seat.dropped++;
      this.droppedSnapshots++;
      if (seat.unacked > SLOW_CLOSE_AFTER_DROPS) {
        this.dropSeat(seat, 'slow-client');
      } else {
        setTimeout(() => {
          if (seat.ws && seat.slow) this.dropSeat(seat, 'slow-client');
        }, 2000);
      }
    }
    this.lastEventSeq = Math.max(this.lastEventSeq, this.game.state.eventSeq - 1);
  }

  dropSeat(seat, reason) {
    if (seat.ws) {
      try {
        seat.ws.close(1011, reason);
      } catch {
        /* already closed */
      }
      seat.ws = null;
    }
    seat.unacked = 0;
    seat.slow = false;
    this.maybeEmpty();
  }

  maybeEmpty() {
    if (this.seats.some((seat) => seat.ws)) return;
    if (this.emptyTimer) return;
    this.emptyTimer = setTimeout(() => {
      this.emptyTimer = null;
      if (!this.seats.some((seat) => seat.ws)) this.stopLoop();
    }, EMPTY_ROOM_GRACE_MS);
  }

  onMessage(seat, data) {
    this.incomingMessages++;
    if (this.quotaExhausted) return;
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : 0;
    if (bytes > MAX_MESSAGE_BYTES) {
      this.commandsRejected++;
      return;
    }
    let message;
    try {
      message = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    } catch {
      this.commandsRejected++;
      return;
    }
    if (!message || typeof message !== 'object') {
      this.commandsRejected++;
      return;
    }
    if (message.type === 'ack') {
      seat.unacked = Math.max(0, seat.unacked - 1);
      seat.slow = false;
      return;
    }
    if (message.type !== 'command') {
      this.commandsRejected++;
      return;
    }

    const now = Date.now();
    if (now - seat.lastCommandAt < COMMAND_INTERVAL_MS) {
      this.commandsRejected++;
      seat.lastCommandAt = now;
      return;
    }
    seat.lastCommandAt = now;
    const result = gateCommand(this.game, { seat: seat.seat, team: seat.team }, message.command);
    if (!result.ok) {
      this.commandsRejected++;
      return;
    }
    this.commandsAccepted++;
    this.game.enqueueCommand(result.command);

    // Billing approximation: one request per upgrade plus incoming WebSocket
    // messages at 20:1. Outgoing snapshots are not charged.
    const billed = this.connectionsAccepted + Math.ceil(this.incomingMessages / 20);
    const budget = envNumber(this.env, 'PHASE0_REQUEST_BUDGET', 100_000);
    if (billed >= budget) {
      this.quotaExhausted = true;
      this.quotaReason = 'request-budget';
      this.stopLoop();
      for (const other of this.seats) {
        if (!other.ws) continue;
        try {
          other.ws.close(1013, 'request budget exhausted');
        } catch {
          /* already closed */
        }
        other.ws = null;
      }
    }
  }

  stats() {
    const seats = this.seats.map((seat) => ({
      seat: seat.seat,
      team: seat.team,
      connected: !!seat.ws,
      slow: seat.slow,
      unacked: seat.unacked,
      frames: seat.frames,
      bytes: seat.bytes,
      dropped: seat.dropped,
    }));
    const entities = this.game.state.entities.filter((e) => e.hp > 0);
    const billedRequests = this.connectionsAccepted + Math.ceil(this.incomingMessages / 20);
    return {
      roomId: this.roomId,
      startedAt: this.startedAt,
      uptimeMs: Date.now() - this.startedAt,
      closed: this.closed,
      closedAt: this.closedAt,
      quotaExhausted: this.quotaExhausted,
      quotaReason: this.quotaReason,
      startupMs: this.startupMs,
      tick: this.game.state.tick,
      victory: this.game.state.victory,
      seats,
      metrics: {
        ticks: this.tickDurations.length,
        tickMs: summarize(this.tickDurations),
        snapshotMs: summarize(this.snapshotDurations),
        snapshotBytes: summarize(this.snapshotBytes),
        tickOverruns: this.tickOverruns,
        maxTickMs: this.maxTickMs,
        snapshots: this.snapshotCount,
        outboundFrames: this.outboundFrames,
        outboundBytes: this.outboundBytes,
        incomingMessages: this.incomingMessages,
        billedRequests,
        commandsAccepted: this.commandsAccepted,
        commandsRejected: this.commandsRejected,
        connectionsAccepted: this.connectionsAccepted,
        droppedSnapshots: this.droppedSnapshots,
        sendFailures: this.sendFailures,
        socketErrors: this.socketErrors,
        tickSkips: this.tickSkips,
        effectiveTickHz:
          this.startedAt > 0
            ? Math.round((this.tickDurations.length / ((Date.now() - this.startedAt) / 1000)) * 1000) / 1000
            : 0,
        errors: this.errors,
        lastTickAt: this.lastTickAt,
        lastSnapshotAt: this.lastSnapshotAt,
      },
      game: {
        entities: entities.length,
        units: entities.filter((e) => e.kind === 'unit').length,
        buildings: entities.filter((e) => e.kind === 'building').length,
        projectiles: this.game.state.projectiles.length,
      },
    };
  }

  async handleWebSocket(request, url) {
    if (this.closed) return json({ error: 'room-closed' }, 410);
    if (this.quotaExhausted) return json({ error: 'quota-exhausted' }, 503);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'upgrade-required' }, 426);
    }
    if (!tokenAllowed(request, this.env)) return json({ error: 'unauthorized' }, 401);
    if (!originAllowed(request.headers.get('Origin'), this.env)) {
      return json({ error: 'origin-rejected' }, 403);
    }
    const seatIndex = Number(url.searchParams.get('seat'));
    const seat = this.seats[seatIndex];
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= this.seats.length || !seat) {
      return json({ error: 'invalid-seat' }, 400);
    }
    if (seat.ws) return json({ error: 'seat-occupied' }, 409);
    if (this.seats.filter((entry) => entry.ws).length >= envNumber(this.env, 'PHASE0_MAX_CONNECTIONS', 4)) {
      return json({ error: 'room-full' }, 409);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    seat.ws = server;
    seat.unacked = 0;
    seat.slow = false;
    this.connectionsAccepted++;
    try {
      server.send(
        JSON.stringify({
          type: 'hello',
          room: this.roomId,
          seat: seat.seat,
          team: seat.team,
          tick: this.game.state.tick,
          protocol: 1,
          snapshotHz: 10,
          tickHz: 20,
          originSeen: request.headers.get('Origin') ?? null,
          cookieSeen: request.headers.has('Cookie'),
        }),
      );
    } catch {
      this.sendFailures++;
      this.dropSeat(seat, 'hello-failed');
    }
    server.addEventListener('message', (event) => this.onMessage(seat, event.data));
    server.addEventListener('close', () => {
      if (seat.ws === server) seat.ws = null;
      this.maybeEmpty();
    });
    server.addEventListener('error', () => {
      this.socketErrors++;
      if (seat.ws === server) seat.ws = null;
      this.maybeEmpty();
    });
    this.ensureLoop();
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    this.roomId = path.match(/\/room\/([^/]+)/)?.[1] ?? this.roomId;

    if (path.endsWith('/health')) return json({ ok: true, room: this.roomId, closed: this.closed });
    if (path.endsWith('/stats')) {
      if (!tokenAllowed(request, this.env)) return json({ error: 'unauthorized' }, 401);
      return json(this.stats());
    }
    if (path.endsWith('/shutdown')) {
      if (!tokenAllowed(request, this.env)) return json({ error: 'unauthorized' }, 401);
      if (!originAllowed(request.headers.get('Origin'), this.env)) {
        return json({ error: 'origin-rejected' }, 403);
      }
      this.shutdown('requested');
      return json({ ok: true, room: this.roomId });
    }
    if (path.endsWith('/ws')) return this.handleWebSocket(request, url);
    return json({ error: 'not-found' }, 404);
  }

  shutdown(reason) {
    if (this.closed) return;
    this.closed = true;
    this.closedAt = Date.now();
    this.stopLoop();
    for (const seat of this.seats) {
      if (!seat.ws) continue;
      try {
        seat.ws.close(1012, reason);
      } catch {
        /* already closed */
      }
      seat.ws = null;
    }
  }
}
