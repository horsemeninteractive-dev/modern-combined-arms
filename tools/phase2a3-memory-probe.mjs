#!/usr/bin/env node
// Phase 2A.3 memory / state census poller.
//
// Reads the token-protected admin status of one live staging room on a fixed
// interval and appends a bounded JSON line per sample. It never prints the
// admin token, seat tokens, or room credentials.
//
//   MP_ROOM_ID=... MP_ADMIN_TOKEN=... MP_OUT=staging-evidence/phase2a3-.../census.jsonl \
//     node tools/phase2a3-memory-probe.mjs
//
// Optional: MP_BASE, MP_INTERVAL_MS (default 30000), MP_DURATION_MS (default 1860000).

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const base =
  process.env.MP_BASE ?? 'https://mca-multiplayer-staging.horsemeninteractive.workers.dev';
const roomId = process.env.MP_ROOM_ID;
const admin = process.env.MP_ADMIN_TOKEN;
const out = process.env.MP_OUT;
const intervalMs = Number(process.env.MP_INTERVAL_MS ?? 30_000);
const durationMs = Number(process.env.MP_DURATION_MS ?? 1_860_000);

if (!roomId || !/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) {
  console.error('MP_ROOM_ID is required.');
  process.exit(2);
}
if (!admin) {
  console.error('MP_ADMIN_TOKEN is required.');
  process.exit(2);
}
if (!out) {
  console.error('MP_OUT is required.');
  process.exit(2);
}
mkdirSync(dirname(out), { recursive: true });

const startedAt = Date.now();
const nowIso = () => new Date().toISOString();

function sample(body) {
  const match = body.match ?? {};
  const census = match.census ?? {};
  return {
    at: nowIso(),
    elapsedMs: Date.now() - startedAt,
    phase: match.phase ?? null,
    tick: match.tick ?? null,
    closed: body.closed,
    census: {
      entities: census.entities ?? null,
      units: census.units ?? null,
      buildings: census.buildings ?? null,
      projectiles: census.projectiles ?? null,
      contacts: census.contacts ?? null,
      charted: census.charted ?? null,
      events: census.events ?? null,
      pendingCommands: census.pendingCommands ?? null,
      fogTiles: census.fogTiles ?? null,
    },
    seats: (match.seats ?? []).map((seat) => ({
      seat: seat.seatId,
      connected: seat.connected,
      bufferedBytes: seat.bufferedBytes ?? null,
      lastAckAt: seat.lastAckAt ?? null,
    })),
    keepalive: body.diagnostics?.keepalive ?? null,
    persistence: {
      snapshotCycles: body.diagnostics?.persistence?.snapshotCycles ?? null,
      writes: body.diagnostics?.persistence?.writes ?? null,
      deletes: body.diagnostics?.persistence?.deletes ?? null,
      writeBytes: body.diagnostics?.persistence?.writeBytes ?? null,
      lastSnapshotBytes: body.diagnostics?.persistence?.lastSnapshotBytes ?? null,
      maxSnapshotBytes: body.diagnostics?.persistence?.maxSnapshotBytes ?? null,
      behind: body.diagnostics?.persistence?.behind ?? null,
    },
    socket: body.diagnostics?.socket ?? null,
    snapshots: {
      total: body.diagnostics?.snapshots?.total ?? null,
      bytes: body.diagnostics?.snapshots?.bytes ?? null,
    },
  };
}

async function poll() {
  const response = await fetch(
    `${base}/api/multiplayer/rooms/${encodeURIComponent(roomId)}/status`,
    { headers: { Authorization: `Bearer ${admin}` } },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    appendFileSync(out, JSON.stringify({ at: nowIso(), http: response.status, ok: false }) + '\n');
    return false;
  }
  appendFileSync(out, JSON.stringify({ ok: true, ...sample(body) }) + '\n');
  return !body.closed;
}

let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});

while (!stopped && Date.now() - startedAt < durationMs) {
  const keepGoing = await poll().catch(() => true);
  if (!keepGoing) break;
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
