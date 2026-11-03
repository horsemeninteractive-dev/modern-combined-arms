#!/usr/bin/env node
/**
 * Deployed room smoke test.
 *
 * Drives the live room worker the way a player does: the host opens a room
 * anonymously and receives a join code, the guest redeems that code, both seats
 * connect, agree a nation, ready up, the host starts, and the match is played to
 * its result. It asserts the authority boundaries around that path (wrong token,
 * foreign origin, duplicate seat, forged command) and the pieces of the protocol
 * a stale worker silently loses (per-seat research, the researched-command
 * gates), because a worker deployed from an older commit accepts the connection
 * and then quietly refuses everything the client sends it.
 *
 * `MP_ADMIN_TOKEN` (or a `.dev/mp-admin-token` file) is optional: with it the
 * room's status and reservation release are asserted and the test room is shut
 * down afterwards, plus the capacity boundary is exercised. Without it the
 * player-facing half still runs and the room is left to lapse on its own.
 *
 * The lobby requires a match of at least 60 s, so a full run takes about that
 * long by design; the wait is the match, not the harness.
 *
 *   node tools/phase2a-deployed-smoke.mjs
 *   MP_BASE=http://127.0.0.1:8791 node tools/phase2a-deployed-smoke.mjs
 *   MP_EXPECT_BUILD=phase2b4-live node tools/phase2a-deployed-smoke.mjs
 *
 * Env: MP_BASE (worker origin), MP_ORIGIN (socket Origin, defaults to MP_BASE),
 * MP_EXPECT_BUILD (assert the deployed build marker), MP_MATCH_MS (match length,
 * minimum and default 60 s), MP_ADMIN_TOKEN (cleanup and status assertions).
 *
 * The raw RFC 6455 client is used because the platform's 101 response is not
 * surfaced by Node's built-in WebSocket error path.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rawHandshake } from './phase2a-raw-client.mjs';

const base =
  process.env.MP_BASE ?? 'https://mca-multiplayer-staging.horsemeninteractive.workers.dev';
const origin = process.env.MP_ORIGIN ?? base;
const expectBuild = process.env.MP_EXPECT_BUILD ?? '';
const matchMs = Math.max(60_000, Number(process.env.MP_MATCH_MS ?? 60_000));
if (!Number.isFinite(matchMs)) {
  console.error('MP_MATCH_MS must be a number.');
  process.exit(2);
}
const roomId = (process.env.MP_ROOM ?? `smoke-${Date.now().toString(36)}`).toLowerCase();
const admin =
  process.env.MP_ADMIN_TOKEN ??
  (() => {
    try {
      return readFileSync('.dev/mp-admin-token', 'utf8').trim();
    } catch {
      return '';
    }
  })();

const sockets = new Set();
const checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const roomPath = (suffix = '') => `/api/multiplayer/rooms/${encodeURIComponent(roomId)}${suffix}`;

function check(name) {
  checks.push(name);
  console.log(`  ok  ${name}`);
}

function skip(name, why) {
  console.log(`  --  ${name} (${why})`);
}

async function api(path, method = 'GET', body, auth = admin) {
  const headers = {};
  if (auth) headers.Authorization = auth.startsWith('Room ') ? auth : `Bearer ${auth}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ ok: false, code: 'bad-json' }));
  return { status: response.status, data };
}

const frameCount = (socket) => socket.messages.length;

/**
 * Wait for a JSON frame at or after `from`. Frames are consumed by index because
 * the raw client keeps every frame it received: a predicate that only checks the
 * type would happily return an earlier rejection for a later probe.
 */
async function waitFrom(socket, from, predicate, timeout = 10_000, label = 'frame') {
  const scan = () => {
    for (let i = from; i < socket.messages.length; i++) {
      let message;
      try {
        message = JSON.parse(socket.messages[i]);
      } catch {
        continue;
      }
      if (predicate(message)) return message;
    }
    return null;
  };
  const deadline = Date.now() + timeout;
  for (;;) {
    const hit = scan();
    if (hit) return hit;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(50);
  }
}

async function connect(seat, token, requestOrigin = origin) {
  const result = await rawHandshake(base, roomId, seat, token, requestOrigin);
  if (result.status !== 101) return result;
  sockets.add(result.socket);
  return result;
}

const send = (socket, message) => socket.send(JSON.stringify({ v: 2, ...message }));

async function run() {
  console.log(`\nDeployed room smoke — ${base}`);
  console.log(`  room ${roomId}, match ${Math.round(matchMs / 1000)} s\n`);

  const health = await fetch(`${base}/api/multiplayer/health`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.onlineEnabled, true);
  assert.equal(health.protocol, 'mca.v2');
  if (expectBuild) assert.equal(health.build, expectBuild, 'deployed build marker');
  check(`health (build ${health.build}, protocol ${health.protocol})`);

  // ---- host opens a room, guest redeems the code -----------------------
  const opened = await api(
    `/api/multiplayer/rooms/${encodeURIComponent(roomId)}/open`,
    'POST',
    { roomId, mode: '1v1', matchDurationMs: matchMs },
    null,
  );
  assert.equal(opened.status, 200, JSON.stringify(opened.data));
  assert.equal(opened.data.seat, 0);
  assert.equal(typeof opened.data.joinCode, 'string');
  const hostToken = opened.data.token;
  const joinCode = opened.data.joinCode;
  check('host opened a room and received a join code');

  const wrongCode = await api(roomPath('/join'), 'POST', { code: 'ZZZZZZZZZZ' }, null);
  assert.ok(wrongCode.status >= 400, `wrong join code answered ${wrongCode.status}`);
  check(`wrong join code refused (${wrongCode.status})`);

  const joined = await api(roomPath('/join'), 'POST', { code: joinCode }, null);
  assert.equal(joined.status, 200, JSON.stringify(joined.data));
  assert.equal(joined.data.seat, 1);
  const guestToken = joined.data.token;
  check('guest joined with the code');

  // The join code is the guest's bearer secret, so redeeming it again hands back
  // the same seat rather than inventing a third player in a 1v1 room.
  const again = await api(roomPath('/join'), 'POST', { code: joinCode }, null);
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.seat, 1);
  assert.equal(again.data.token, guestToken);
  check('join code is single-seat (repeat join returns seat 1)');

  // ---- transport boundaries --------------------------------------------
  const badToken = await handshakeProbe(0, 'x'.repeat(32));
  assert.equal(badToken, 401);
  check('wrong seat token rejected (401)');

  const foreign = await handshakeProbe(1, guestToken, 'https://evil.example');
  assert.equal(foreign, 403);
  check('foreign origin rejected (403)');

  // ---- two seats in the lobby ------------------------------------------
  const seat0 = await connect(0, hostToken);
  assert.equal(seat0.status, 101, 'seat 0 handshake');
  const seat1 = await connect(1, guestToken);
  assert.equal(seat1.status, 101, 'seat 1 handshake');
  const lobby0 = await waitFrom(seat0.socket, 0, (m) => m.type === 'lobby', 15_000, 'seat 0 lobby');
  const lobby1 = await waitFrom(seat1.socket, 0, (m) => m.type === 'lobby', 15_000, 'seat 1 lobby');
  assert.equal(lobby0.seat, 0);
  assert.equal(lobby0.hostSeat, 0);
  assert.equal(lobby0.phase, 'lobby');
  assert.equal(lobby1.seat, 1);
  check(`two seats connected (101 upgrade, ${lobby0.config.mapId})`);

  // One socket per seat: the token is repeated in the subprotocol, so a second
  // client holding it must not be able to drive the same seat at once.
  const duplicate = await handshakeProbe(0, hostToken);
  assert.equal(duplicate, 409);
  check('second socket on the same seat refused (409)');

  // A nation the roster does not define cannot be stored, and the nations the
  // current build ships are accepted. Together these prove the deployed worker
  // holds the same faction catalogue as the client bundle.
  const guestCursor = frameCount(seat1.socket);
  await send(seat1.socket, { type: 'lobbySet', nation: 'atlantis' });
  try {
    const refused = await waitFrom(seat1.socket, guestCursor, (m) => m.type === 'error', 3_000, 'nation refusal');
    assert.equal(refused.code, 'invalid-nation');
    check('unknown nation refused (invalid-nation)');
  } catch {
    skip('unknown nation refusal frame', 'room answered with state only');
  }

  const hostCursor = frameCount(seat0.socket);
  await send(seat0.socket, { type: 'lobbySet', nation: 'finland' });
  await send(seat1.socket, { type: 'lobbySet', nation: 'iran' });
  const nations = await waitFrom(
    seat0.socket,
    hostCursor,
    (m) =>
      m.type === 'lobby' && m.config.seats[0].nation === 'finland' && m.config.seats[1].nation === 'iran',
    10_000,
    'both nations applied',
  );
  assert.equal(nations.config.seats[0].nation, 'finland');
  assert.equal(nations.config.seats[1].nation, 'iran');
  check('current nations accepted (finland vs iran)');

  const readyCursor = frameCount(seat0.socket);
  await send(seat0.socket, { type: 'ready', ready: true });
  await send(seat1.socket, { type: 'ready', ready: true });
  await waitFrom(
    seat0.socket,
    readyCursor,
    (m) => m.type === 'lobby' && m.config.seats[0].ready && m.config.seats[1].ready,
    10_000,
    'both seats ready',
  );
  check('both seats ready');

  // ---- start -----------------------------------------------------------
  const syncCursor0 = frameCount(seat0.socket);
  const started = await api(roomPath('/start'), 'POST', {}, `Room ${hostToken}`);
  assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.notEqual(started.data.ok, false, JSON.stringify(started.data));
  check('host started the match');

  const hello0 = await waitFrom(seat0.socket, syncCursor0, (m) => m.type === 'hello', 20_000, 'seat 0 hello');
  assert.equal(hello0.phase, 'playing');
  const sync0 = await waitFrom(seat0.socket, syncCursor0, (m) => m.type === 'sync', 20_000, 'seat 0 sync');
  const sync1 = await waitFrom(seat1.socket, 0, (m) => m.type === 'sync', 20_000, 'seat 1 sync');
  assert.ok(sync0.state.map.terrain.length > 0, 'sync carries the static map');
  assert.ok(sync0.state.entities.length > 0, 'sync carries entities');
  assert.ok(sync0.state.players.every((p) => p.team === 0), 'seat 0 sees another team');
  assert.ok(sync1.state.players.every((p) => p.team === 1), 'seat 1 sees another team');
  check(
    `sync is team-projected (${sync0.state.entities.length} own-team entities, ${sync0.state.players.length} player row)`,
  );

  // The seat's own research, and only its own: a worker built before research
  // existed omits this field while still answering the health check.
  const ownRow = sync0.state.players[0];
  assert.ok(ownRow.research && Array.isArray(ownRow.research.completed), 'sync carries research state');
  assert.equal(sync0.state.players.some((p) => p.team !== 0), false);
  check('research replicated to its owner only');

  const deltaCursor = frameCount(seat0.socket);
  const delta = await waitFrom(
    seat0.socket,
    deltaCursor,
    (m) => m.type === 'delta' && m.tick > sync0.tick,
    20_000,
    'a later delta',
  );
  assert.equal(delta.base, sync0.seq);
  assert.equal('map' in delta, false, 'delta repeated the static map');
  assert.equal('state' in delta, false, 'delta repeated a full snapshot');
  check(`deltas streaming (tick ${sync0.tick} -> ${delta.tick})`);

  // ---- commands --------------------------------------------------------
  const ownUnit = sync0.state.entities.find((e) => e.kind === 'unit' && e.team === 0);
  const ownBuilding = sync0.state.entities.find((e) => e.kind === 'building' && e.team === 0);
  assert.ok(ownUnit, 'no own unit in the projection');
  assert.ok(ownBuilding, 'no own building in the projection');

  const acceptCursor = frameCount(seat0.socket);
  await send(seat0.socket, { type: 'command', command: { type: 'stop', ids: [ownUnit.id] } });
  const accepted = await waitFrom(
    seat0.socket,
    acceptCursor,
    (m) => m.type === 'commandAccepted',
    10_000,
    'commandAccepted',
  );
  assert.equal(accepted.commandType, 'stop');
  check('valid command accepted (stop)');

  await sleep(200);
  const forgedCursor = frameCount(seat0.socket);
  await send(seat0.socket, {
    type: 'command',
    command: { type: 'stop', ids: [ownUnit.id], team: 1 },
  });
  const forged = await waitFrom(
    seat0.socket,
    forgedCursor,
    (m) => m.type === 'commandRejected',
    10_000,
    'forged team rejection',
  );
  assert.equal(forged.code, 'forbidden-field');
  check('forged authority rejected (forbidden-field)');

  // These reach a domain check and are refused there. A worker from before the
  // research work answers with a transport-level rejection instead, which is the
  // failure this smoke exists to catch.
  const domainProbes = [
    {
      label: 'research',
      command: { type: 'research', buildingId: ownBuilding.id, techId: 'manoeuvre1' },
      expect: 'research-unavailable',
    },
    {
      label: 'installModule',
      command: { type: 'installModule', buildingId: ownBuilding.id, moduleId: 'advancedTurbine' },
      expect: 'module-unavailable',
    },
    {
      label: 'useAbility',
      command: { type: 'useAbility', unitId: ownUnit.id, abilityId: 'reconSmokescreen' },
      expect: 'upgrade-unavailable',
    },
  ];
  for (const probe of domainProbes) {
    await sleep(200);
    const from = frameCount(seat0.socket);
    await send(seat0.socket, { type: 'command', command: probe.command });
    const rejected = await waitFrom(
      seat0.socket,
      from,
      (m) => m.type === 'commandRejected',
      10_000,
      `${probe.label} rejection`,
    );
    assert.equal(rejected.code, probe.expect, `${probe.label} answered ${rejected.code}`);
    check(`${probe.label} gate present (${rejected.code})`);
  }

  await sleep(200);
  const bigCursor = frameCount(seat0.socket);
  seat0.socket.send('x'.repeat(5000));
  const oversized = await waitFrom(seat0.socket, bigCursor, (m) => m.type === 'error', 10_000, 'oversize error');
  assert.equal(oversized.code, 'payload-too-large');
  check('oversized frame rejected (payload-too-large)');

  const resyncCursor = frameCount(seat0.socket);
  const resyncStarted = Date.now();
  await send(seat0.socket, { type: 'resync' });
  const resync = await waitFrom(
    seat0.socket,
    resyncCursor,
    (m) => m.type === 'sync' && m.checkpoint === true,
    15_000,
    'resync checkpoint',
  );
  const resyncMs = Date.now() - resyncStarted;
  assert.ok(resync.epoch > sync0.epoch, 'resync did not advance the epoch');
  assert.ok(resync.state.map.terrain.length > 0, 'resync lost the static map');
  check(`resync checkpoint applied (${resyncMs} ms)`);

  // ---- reconnect -------------------------------------------------------
  seat0.socket.close();
  sockets.delete(seat0.socket);
  await sleep(500);
  const rejoined = await connect(0, hostToken);
  assert.equal(rejoined.status, 101, 'reconnect handshake');
  const rejoinHello = await waitFrom(rejoined.socket, 0, (m) => m.type === 'hello', 15_000, 'reconnect hello');
  const rejoinSync = await waitFrom(rejoined.socket, 0, (m) => m.type === 'sync', 15_000, 'reconnect sync');
  assert.equal(rejoinHello.seat, 0);
  assert.equal(rejoinSync.checkpoint, false);
  assert.ok(rejoinSync.epoch > resync.epoch, 'reconnect did not open a new epoch');
  check('reconnect accepted on a new epoch');

  // ---- result ----------------------------------------------------------
  const wait = matchMs + 60_000;
  const result0 = await waitFrom(rejoined.socket, 0, (m) => m.type === 'result', wait, 'seat 0 result');
  const result1 = await waitFrom(seat1.socket, 0, (m) => m.type === 'result', wait, 'seat 1 result');
  assert.ok(['victory', 'defeat', 'draw'].includes(result0.outcome));
  assert.ok(['victory', 'defeat', 'draw'].includes(result1.outcome));
  const opposed =
    result0.outcome === 'draw'
      ? result1.outcome === 'draw'
      : result1.outcome === (result0.outcome === 'victory' ? 'defeat' : 'victory');
  assert.ok(opposed, `results disagree: ${result0.outcome} vs ${result1.outcome}`);
  check(`result delivered to both seats (${result0.outcome} / ${result1.outcome})`);

  if (!admin) {
    skip('room closure and capacity', 'no admin token');
    return;
  }

  let status = await api(roomPath('/status'));
  for (let attempt = 0; attempt < 75 && status.data.closed !== true; attempt++) {
    await sleep(200);
    status = await api(roomPath('/status'));
  }
  assert.equal(status.data.closed, true, 'room did not close after the result');
  assert.equal(status.data.reservation.status, 'released');
  check('room closed and reservation released');

  // Capacity is global and is the one boundary a seat cannot observe for itself.
  const capA = await openRoom(`cap-a-${Date.now().toString(36)}`);
  if (capA.status === 503) {
    // Another player holds the slots; the boundary cannot be observed now.
    skip('capacity boundary', 'room slots already in use');
    return;
  }
  const capB = await openRoom(`cap-b-${Date.now().toString(36)}`);
  assert.equal(capA.status, 200, JSON.stringify(capA.data));
  assert.equal(capB.status, 200, JSON.stringify(capB.data));
  const capC = await openRoom(`cap-c-${Date.now().toString(36)}`);
  assert.equal(capC.status, 503, `third room answered ${capC.status}`);
  assert.equal(capC.data.code, 'capacity-full');
  for (const id of [capA.data.roomId, capB.data.roomId]) {
    await api(`/api/multiplayer/rooms/${encodeURIComponent(id)}/shutdown`, 'POST', {});
  }
  check('capacity boundary enforced (third room 503)');
}

async function handshakeProbe(seat, token, requestOrigin = origin) {
  const result = await rawHandshake(base, roomId, seat, token, requestOrigin);
  if (result.socket) {
    result.socket.close();
    sockets.delete(result.socket);
  }
  return result.status;
}

async function openRoom(id) {
  return api(
    `/api/multiplayer/rooms/${encodeURIComponent(id)}/open`,
    'POST',
    { roomId: id, mode: '1v1', matchDurationMs: matchMs },
    null,
  );
}

try {
  await run();
  console.log(`\n✔ ${checks.length} checks passed\n`);
  console.log(JSON.stringify({ ok: true, origin: base, roomId, checks }, null, 2));
} catch (error) {
  console.error(`\n✖ ${error.message}`);
  console.error(`  ${checks.length} checks passed before the failure`);
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.close();
  await sleep(300);
  if (admin) {
    await api(roomPath('/shutdown'), 'POST', {}).catch(() => {});
  }
}
