#!/usr/bin/env node
/**
 * Four-seat phase-0 client.
 *
 * Usage:
 *   node phase0/client.mjs
 *   PHASE0_DURATION_MS=1800000 PHASE0_OUT=tmp/soak.json node phase0/client.mjs
 *
 * The client acks every snapshot, sends a rate-limited command batch and can
 * withhold acks from one seat to exercise the slow-client path. It is a load
 * generator and measurement consumer, not a game client.
 */
import { writeFileSync } from 'node:fs';

const WS_BASE = process.env.PHASE0_WS ?? 'ws://127.0.0.1:8787';
const HTTP_BASE = process.env.PHASE0_HTTP ?? 'http://127.0.0.1:8787';
const ROOM = process.env.PHASE0_ROOM ?? 'phase0-soak';
const TOKEN = process.env.PHASE0_TOKEN ?? 'phase0-local-token';
const DURATION_MS = Number(process.env.PHASE0_DURATION_MS ?? 20_000);
const COMMAND_MS = Number(process.env.PHASE0_COMMAND_MS ?? 250);
const SLOW_SEAT = process.env.PHASE0_SLOW_SEAT === undefined ? null : Number(process.env.PHASE0_SLOW_SEAT);
const RECONNECT_SEAT = process.env.PHASE0_RECONNECT_SEAT === undefined ? null : Number(process.env.PHASE0_RECONNECT_SEAT);
const OUT = process.env.PHASE0_OUT ?? null;
const SEATS = (process.env.PHASE0_SEATS ?? '0,1,2,3')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value));

const start = Date.now();
const clients = SEATS.map((seat) => ({
  seat,
  socket: null,
  connected: false,
  hello: null,
  snapshots: 0,
  bytes: 0,
  acks: 0,
  commands: 0,
  commandAccepted: 0,
  closeCode: null,
  closeReason: null,
  reconnects: 0,
  lastCommandAt: 0,
  lastTick: 0,
  latest: null,
}));
let finished = false;
let reconnectTimer = null;

function log(...args) {
  console.log(`[${((Date.now() - start) / 1000).toFixed(1)}s]`, ...args);
}

function urlFor(seat) {
  return `${WS_BASE}/api/phase0/room/${encodeURIComponent(ROOM)}/ws?seat=${seat}&token=${encodeURIComponent(TOKEN)}`;
}

function sendCommand(client) {
  if (!client.socket || client.socket.readyState !== WebSocket.OPEN) return;
  const snapshot = client.latest;
  if (!snapshot) return;
  const ownIds = new Set((snapshot.players ?? []).map((player) => player.id));
  const unit = (snapshot.entities ?? []).find((entity) => ownIds.has(entity.owner) && entity.kind === 'unit');
  if (!unit) return;
  const now = Date.now();
  if (now - client.lastCommandAt < COMMAND_MS) return;
  client.lastCommandAt = now;
  const limit = (snapshot.map?.width ?? 96) * (snapshot.map?.tileSize ?? 4) - 4;
  const x = unit.x + (client.seat % 2 === 0 ? 8 : -8);
  const moveX = x > 0 && x < limit ? x : unit.x;
  client.socket.send(
    JSON.stringify({
      type: 'command',
      // Deliberately forged: the server must derive team from the seat, not
      // from this field. The gate replaces it with the seat's team.
      command: {
        type: 'move',
        team: snapshot.team === 0 ? 1 : 0,
        ids: [unit.id],
        x: moveX,
        z: unit.z,
      },
    }),
  );
  client.commands++;
}

function connect(client) {
  const socket = new WebSocket(urlFor(client.seat));
  client.socket = socket;
  socket.addEventListener('open', () => {
    client.connected = true;
    log(`seat ${client.seat} open`);
  });
  socket.addEventListener('message', (event) => {
    const text = typeof event.data === 'string' ? event.data : '';
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.type === 'hello') {
      client.hello = message;
      return;
    }
    if (message.type !== 'snapshot') return;
    client.snapshots++;
    client.bytes += Buffer.byteLength(text);
    client.lastTick = message.tick;
    client.latest = message;
    if (client.seat !== SLOW_SEAT) {
      socket.send(JSON.stringify({ type: 'ack', seq: message.tick }));
      client.acks++;
    }
    sendCommand(client);
  });
  socket.addEventListener('close', (event) => {
    client.connected = false;
    client.closeCode = event.code;
    client.closeReason = event.reason;
    log(`seat ${client.seat} closed ${event.code} ${event.reason}`);
  });
  socket.addEventListener('error', (event) => {
    log(`seat ${client.seat} socket error`, event?.message ?? '');
  });
}

async function stats() {
  const url = `${HTTP_BASE}/api/phase0/room/${encodeURIComponent(ROOM)}/stats?token=${encodeURIComponent(TOKEN)}`;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return await response.json();
  } catch (error) {
    return { error: String(error) };
  }
}

function summary(serverStats) {
  const elapsed = Date.now() - start;
  const perClient = clients.map((client) => ({
    seat: client.seat,
    connected: client.connected,
    hello: client.hello,
    snapshots: client.snapshots,
    bytes: client.bytes,
    acks: client.acks,
    commands: client.commands,
    closeCode: client.closeCode,
    closeReason: client.closeReason,
    reconnects: client.reconnects,
    lastTick: client.lastTick,
  }));
  return {
    elapsedMs: elapsed,
    room: ROOM,
    wsBase: WS_BASE,
    httpBase: HTTP_BASE,
    durationMs: DURATION_MS,
    commandMs: COMMAND_MS,
    slowSeat: SLOW_SEAT,
    reconnectSeat: RECONNECT_SEAT,
    clients: perClient,
    aggregate: {
      snapshots: perClient.reduce((sum, client) => sum + client.snapshots, 0),
      bytes: perClient.reduce((sum, client) => sum + client.bytes, 0),
      acks: perClient.reduce((sum, client) => sum + client.acks, 0),
      commands: perClient.reduce((sum, client) => sum + client.commands, 0),
    },
    server: serverStats,
  };
}

async function finish() {
  if (finished) return;
  finished = true;
  for (const client of clients) {
    try {
      client.socket?.close(1000, 'measurement complete');
    } catch {
      /* already closed */
    }
  }
  if (reconnectTimer) clearTimeout(reconnectTimer);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const serverStats = await stats();
  const result = summary(serverStats);
  if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

for (const client of clients) connect(client);

const progress = setInterval(() => {
  const snapshots = clients.reduce((sum, client) => sum + client.snapshots, 0);
  const bytes = clients.reduce((sum, client) => sum + client.bytes, 0);
  log(`snapshots=${snapshots} bytes=${bytes} connected=${clients.filter((c) => c.connected).length}`);
}, 10_000);

const end = setTimeout(() => {
  clearInterval(progress);
  void finish();
}, DURATION_MS);

// Optional reconnect exercise: drop the chosen seat once, halfway through the
// first ten seconds, then reconnect with the same seat after 500 ms.
if (RECONNECT_SEAT !== null) {
  setTimeout(() => {
    const client = clients.find((entry) => entry.seat === RECONNECT_SEAT);
    if (!client) return;
    client.socket?.close(4000, 'reconnect-test');
    reconnectTimer = setTimeout(() => {
      client.reconnects++;
      connect(client);
    }, 500);
  }, 5000);
}

process.on('SIGINT', () => {
  clearTimeout(end);
  clearInterval(progress);
  void finish();
});
