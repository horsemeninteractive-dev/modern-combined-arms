#!/usr/bin/env node
/**
 * Phase 2B.1 local lobby lifecycle probe.
 *
 * Drives the real Worker in local workerd (`wrangler dev`) over the real
 * transport: create -> both seats connect to the lobby -> readiness -> explicit
 * host start -> match hello/sync on the sockets the lobby already held.
 *
 * Every hop here is the production code path, including `WebSocketPair`, the
 * 101 upgrade and the lobby message wiring that unit tests cannot construct.
 *
 *   node tools/phase2b1-lobby-probe.mjs --base http://127.0.0.1:8791 --admin <token>
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  args.set(key, process.argv[i + 1]);
}

const BASE = args.get('base') ?? 'http://127.0.0.1:8791';
const ADMIN = args.get('admin') ?? 'phase2b1-local-admin-token';
const ROOM = args.get('room') ?? `phase2b1-probe-${Date.now().toString(36)}`;
const DURATION_MS = Number(args.get('duration') ?? 120_000);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`);
}

async function jsonFetch(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, init);
  let body;
  try {
    body = await response.json();
  } catch {
    body = { raw: await response.text() };
  }
  return { status: response.status, body };
}

/** Collect messages from one seat socket. */
function seatSocket(roomId, seat, token) {
  const socket = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/multiplayer/rooms/${roomId}/ws?seat=${seat}`, [
    'mca.v2',
    `mca.token.${token}`,
  ]);
  const messages = [];
  socket.addEventListener('message', (event) => {
    try {
      messages.push(JSON.parse(event.data));
    } catch {
      /* non-JSON frame */
    }
  });
  return {
    socket,
    messages,
    opened: new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve(true));
      socket.addEventListener('error', () => reject(new Error(`seat ${seat} socket error`)));
      setTimeout(() => reject(new Error(`seat ${seat} socket timeout`)), 8000);
    }),
    send: (value) => socket.send(JSON.stringify(value)),
    close: () => socket.close(1000, 'probe-done'),
    last: (type) => [...messages].reverse().find((message) => message.type === type),
  };
}

async function waitFor(predicate, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const health = await jsonFetch('/api/multiplayer/health');
  check('health reports the 2B.1 staging build', health.body.build === 'phase2b1-staging', health.body);

  const created = await jsonFetch(`/api/multiplayer/rooms/${ROOM}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: '1v1', matchDurationMs: DURATION_MS }),
  });
  check('room is created as a lobby', created.status === 200 && created.body.phase === 'lobby', {
    status: created.status,
    phase: created.body.phase,
  });
  check('create returns no match snapshot', created.body.match === undefined);
  const seats = created.body.seats ?? [];
  check('create mints two seat tokens', seats.length === 2, seats.map((seat) => seat.seatId));

  const host = seatSocket(ROOM, 0, seats[0].token);
  const guest = seatSocket(ROOM, 1, seats[1].token);
  await Promise.all([host.opened, guest.opened]);

  const hostHello = await waitFor(() => host.last('lobby'), 'host lobby state');
  const guestHello = await waitFor(() => guest.last('lobby'), 'guest lobby state');
  check('lobby hello has no tick', hostHello.tick === undefined && guestHello.tick === undefined, {
    hostKeys: Object.keys(hostHello),
  });
  check('lobby hello identifies the host seat', hostHello.hostSeat === 0 && guestHello.seat === 1);

  const early = await jsonFetch(`/api/multiplayer/rooms/${ROOM}/status`, {
    headers: { Authorization: `Bearer ${ADMIN}` },
  });
  check('connecting both seats did not start the match', early.body.phase === 'lobby' && early.body.started === false, {
    phase: early.body.phase,
    started: early.body.started,
  });

  const notReady = await jsonFetch(`/api/multiplayer/rooms/${ROOM}/start`, {
    method: 'POST',
    headers: { Authorization: `Room ${seats[0].token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  check('start is refused before both seats are ready', notReady.status === 409 && notReady.body.code === 'not-ready', notReady.body);

  host.send({ type: 'ready', v: 2, ready: true });
  guest.send({ type: 'ready', v: 2, ready: true });
  await waitFor(
    () => (host.last('lobby')?.config?.seats ?? []).every((seat) => seat.ready),
    'both seats ready',
  );
  check('readiness is echoed to both seats', (guest.last('lobby')?.config?.seats ?? []).every((seat) => seat.ready));

  const guestStart = await jsonFetch(`/api/multiplayer/rooms/${ROOM}/start`, {
    method: 'POST',
    headers: { Authorization: `Room ${seats[1].token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  check('guest cannot start the match', guestStart.status === 403 && guestStart.body.code === 'not-host', guestStart.body);

  const startedAt = Date.now();
  const started = await jsonFetch(`/api/multiplayer/rooms/${ROOM}/start`, {
    method: 'POST',
    headers: { Authorization: `Room ${seats[0].token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  check('host start is accepted', started.status === 200 && started.body.started === true, {
    status: started.status,
    phase: started.body.phase,
    tick: started.body.tick,
  });
  check(
    'the match deadline is the configured duration from the start',
    started.body.matchDeadlineAt - started.body.startedAtMs === DURATION_MS,
    { deadline: started.body.matchDeadlineAt, start: started.body.startedAtMs },
  );
  check('the start is not before the request', started.body.startedAtMs >= startedAt - 50);

  const hostHelloMatch = await waitFor(() => host.last('hello'), 'host match hello');
  const guestHelloMatch = await waitFor(() => guest.last('hello'), 'guest match hello');
  check('both seats are told the match is playing', hostHelloMatch.phase === 'playing' && guestHelloMatch.phase === 'playing');
  const hostSync = await waitFor(() => host.last('sync'), 'host baseline sync');
  const guestSync = await waitFor(() => guest.last('sync'), 'guest baseline sync');
  check('both seats receive a baseline sync on the same socket', Boolean(hostSync) && Boolean(guestSync));
  check(
    'the sync carries the map without an opponent token',
    Boolean(hostSync.state?.map) && hostSync.state?.map?.width > 0,
    { width: hostSync.state?.map?.width, height: hostSync.state?.map?.height },
  );

  const duplicate = await jsonFetch(`/api/multiplayer/rooms/${ROOM}/start`, {
    method: 'POST',
    headers: { Authorization: `Room ${seats[0].token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  check('a duplicate start is idempotent', duplicate.status === 200 && duplicate.body.alreadyStarted === true, {
    deadline: duplicate.body.matchDeadlineAt,
    sameDeadline: duplicate.body.matchDeadlineAt === started.body.matchDeadlineAt,
  });

  await new Promise((resolve) => setTimeout(resolve, 1200));
  const live = await jsonFetch(`/api/multiplayer/rooms/${ROOM}/status`, {
    headers: { Authorization: `Bearer ${ADMIN}` },
  });
  check('the match is ticking', live.body.phase === 'playing' && live.body.match.tick > 0, {
    tick: live.body.match?.tick,
    startedAtMs: live.body.matchTiming?.startedAtMs,
  });
  check(
    'the room kept its original start and deadline',
    live.body.matchTiming?.startedAtMs === started.body.startedAtMs &&
      live.body.match?.matchDeadlineAt === started.body.matchDeadlineAt,
  );

  const stopped = await jsonFetch(`/api/multiplayer/rooms/${ROOM}/shutdown`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN}` },
  });
  check('shutdown closes the room', stopped.body.ok === true && stopped.body.closed === true, stopped.body);
  const closed = await jsonFetch(`/api/multiplayer/rooms/${ROOM}/status`, {
    headers: { Authorization: `Bearer ${ADMIN}` },
  });
  check('the closed room reports its state and releases capacity', closed.body.closed === true, {
    closedReason: closed.body.closedReason,
    reservation: closed.body.reservation?.status,
  });
  const capacity = await jsonFetch('/api/multiplayer/health');
  check('health still answers after the room closed', capacity.status === 200);

  host.close();
  guest.close();

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(JSON.stringify({ roomId: ROOM, checks: results }, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('probe failed', error);
  process.exit(1);
});
