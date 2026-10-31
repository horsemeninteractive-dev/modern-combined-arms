import { describe, expect, it } from 'vitest';
import {
  MatchRoomDurableObject,
  ROOM_STORAGE_KEYS,
  validatePersistedMeta,
  type MatchRoomEnv,
} from '../src/multiplayer/roomDurableObject';
import { RoomLobby } from '../src/multiplayer/roomLobby';
import {
  validateLobbyConfig,
  defaultLobbyConfig,
  startConditions,
  LOBBY_COLORS,
  DEFAULT_MATCH_DURATION_MS,
  MAX_MATCH_DURATION_MS,
  type LobbyConfigV1,
} from '../src/multiplayer/lobbyConfig';
import { DEFAULT_RESERVATION_POLICY } from '../src/multiplayer/reservationPolicy';
import {
  ReservationLedger,
  type ReservationRequest,
  type ReservationStorage,
} from '../src/multiplayer/reservation';
import type { RoomMatch, RoomSeatDefinition, RoomSocket } from '../src/multiplayer/roomMatch';
import { ROOM_PROTOCOL_VERSION } from '../src/multiplayer/protocol';

const ADMIN_TOKEN = 'phase2b1-admin-token-0000000000';
const HOST_TOKEN = 'host-seat-token-0000000000000';
const GUEST_TOKEN = 'guest-seat-token-000000000000';
const DURATION_MS = 120_000;

/* ------------------------------------------------------------------ */
/* Deterministic Durable Object harness                                 */
/* ------------------------------------------------------------------ */

/** Durable storage fake: values are stored as JSON so aliasing cannot leak. */
class FakeStorage implements DurableObjectStorage {
  private readonly data = new Map<string, string>();
  readonly puts: string[] = [];
  failPut: ((key: string) => boolean) | null = null;

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const raw = this.data.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    if (this.failPut?.(key)) throw new Error(`injected storage failure: ${key}`);
    this.data.set(key, JSON.stringify(value));
    this.puts.push(key);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  keys(): string[] {
    return [...this.data.keys()].sort();
  }

  raw(key: string): unknown {
    const raw = this.data.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as unknown);
  }
}

class MemoryLedgerStorage implements ReservationStorage {
  private readonly data = new Map<string, unknown>();
  readonly kv = {
    get: <T = unknown>(key: string): T | undefined => this.data.get(key) as T | undefined,
    put: <T = unknown>(key: string, value: T): void => {
      this.data.set(key, value);
    },
  };
  transactionSync<T>(callback: () => T): T {
    return callback();
  }
}

/** The real capacity ledger, reached through a service-binding shaped fake. */
class FakeCapacityBinding {
  createCalls = 0;
  readonly ledger = new ReservationLedger(new MemoryLedgerStorage(), DEFAULT_RESERVATION_POLICY);

  idFromName(name: string): DurableObjectId {
    return { name, toString: () => name } as DurableObjectId;
  }

  get(_id: DurableObjectId): DurableObjectStub {
    return { fetch: (input: string, init?: RequestInit) => this.handle(input, init) };
  }

  activeRooms(): number {
    const decision = this.ledger.status(Date.now());
    return decision.ok ? decision.activeRooms : -1;
  }

  private async handle(input: string, init?: RequestInit): Promise<Response> {
    const path = new URL(input).pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    let decision: unknown;
    if (path === '/reserve') {
      this.createCalls++;
      decision = this.ledger.reserve(body as unknown as ReservationRequest);
    } else if (path === '/heartbeat') {
      decision = this.ledger.heartbeat(String(body.reservationId), Date.now());
    } else if (path === '/release') {
      decision = this.ledger.release(
        String(body.reservationId),
        { actualDurationMs: Number(body.actualDurationMs ?? 0), actualRequests: 0 },
        Date.now(),
      );
    } else if (path === '/status') {
      decision = this.ledger.status(Date.now());
    } else {
      decision = { ok: false, code: 'reservation-not-found', message: 'Unknown capacity route.' };
    }
    return new Response(JSON.stringify(decision), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

class FakeSocket implements RoomSocket {
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  bufferedAmount = 0;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.closed = { code, reason };
  }

  messages(): Array<Record<string, unknown>> {
    return this.sent.map((text) => JSON.parse(text) as Record<string, unknown>);
  }

  last(): Record<string, unknown> {
    return this.messages()[this.messages().length - 1];
  }
}

function roomEnv(capacity: FakeCapacityBinding): MatchRoomEnv {
  return {
    CAPACITY: capacity as unknown as DurableObjectNamespace,
    ROOMS: {} as DurableObjectNamespace,
    MP_ONLINE_ENABLED: '1',
    MP_ADMIN_TOKEN: ADMIN_TOKEN,
    MP_DEV_MODE: '1',
    MP_ALLOW_NO_ORIGIN: '1',
    MP_DEFAULT_MATCH_SECONDS: '120',
    MP_MAX_MATCH_SECONDS: '1800',
  };
}

interface Harness {
  roomId: string;
  storage: FakeStorage;
  env: MatchRoomEnv;
  capacity: FakeCapacityBinding;
  /** The live object instance. `null` means the object was evicted. */
  current: MatchRoomDurableObject | null;
}

function harness(roomId = 'phase2b1-room'): Harness {
  const storage = new FakeStorage();
  const capacity = new FakeCapacityBinding();
  return { roomId, storage, capacity, env: roomEnv(capacity), current: null };
}

function newObject(h: Harness): MatchRoomDurableObject {
  const state = {
    id: { toString: () => h.roomId } as DurableObjectId,
    storage: h.storage,
    blockConcurrencyWhile: <T>(cb: () => Promise<T>): Promise<T> => cb(),
    abort: () => undefined,
  } as DurableObjectState;
  return new MatchRoomDurableObject(state, h.env);
}

function url(h: Harness, action: string): string {
  return `https://room.test/rooms/${h.roomId}/internal/${action}`;
}

/**
 * Open (or reopen) the live object. A new instance over the same storage is
 * exactly what eviction does: every field starts empty and `load()` has to
 * rebuild the room from durable state alone.
 */
async function open(h: Harness): Promise<MatchRoomDurableObject> {
  if (!h.current) {
    h.current = newObject(h);
    // A status read forces the real `load()` path without mutating anything.
    await h.current.fetch(new Request(url(h, 'status'), { headers: adminHeaders() }));
  }
  return h.current;
}

/** Emulate a Durable Object eviction: the next request builds a fresh object. */
function evict(h: Harness): void {
  h.current = null;
}

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${ADMIN_TOKEN}`, ...extra };
}

async function readJson(
  response: Response,
): Promise<{ status: number } & Record<string, unknown>> {
  return { status: response.status, ...((await response.json()) as Record<string, unknown>) };
}

async function createRoom(
  h: Harness,
  durationMs = DURATION_MS,
): Promise<{ status: number } & Record<string, unknown>> {
  const room = await open(h);
  return readJson(
    await room.fetch(
      new Request(url(h, 'create'), {
        method: 'POST',
        headers: adminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ mode: '1v1', matchDurationMs: durationMs }),
      }),
    ),
  );
}

async function status(h: Harness): Promise<{ status: number } & Record<string, unknown>> {
  const room = await open(h);
  return readJson(await room.fetch(new Request(url(h, 'status'), { headers: adminHeaders() })));
}

async function startMatch(
  h: Harness,
  seat: 0 | 1,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const room = await open(h);
  const token = seatTokens(h)[seat];
  const response = await room.fetch(
    new Request(url(h, 'start'), {
      method: 'POST',
      headers: { Authorization: `Room ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function shutdown(h: Harness): Promise<{ status: number; body: Record<string, unknown> }> {
  const room = await open(h);
  const response = await room.fetch(
    new Request(url(h, 'shutdown'), { method: 'POST', headers: adminHeaders() }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** The lobby half of the live object, as the socket adapter would see it. */
function lobbyOf(room: MatchRoomDurableObject): RoomLobby | null {
  return (room as unknown as { lobby: RoomLobby | null }).lobby;
}

function matchOf(room: MatchRoomDurableObject): unknown {
  return (room as unknown as { match: unknown }).match;
}

function lobby(h: Harness): RoomLobby {
  if (!h.current) throw new Error('Room is not open.');
  const found = lobbyOf(h.current);
  if (!found) throw new Error('Room has no lobby.');
  return found;
}

function ready(value = true, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'ready', v: ROOM_PROTOCOL_VERSION, ready: value, ...extra });
}

interface Joined {
  host: FakeSocket;
  guest: FakeSocket;
}

/** Seat tokens are minted at creation; read the real ones from durable state. */
function seatTokens(h: Harness): string[] {
  const meta = h.storage.raw(ROOM_STORAGE_KEYS.meta) as { seats: RoomSeatDefinition[] };
  return meta.seats.map((seat) => seat.token);
}

/**
 * Put both seats on the lobby through the lobby's own connect path and mark
 * them ready through the real message parser. `WebSocketPair` cannot be built
 * outside workerd, so the socket is attached directly; authorization, hello,
 * broadcast and readiness still run through the real lobby.
 */
function joinBoth(h: Harness, markReady = true): Joined {
  const room = lobby(h);
  const host = new FakeSocket();
  const guest = new FakeSocket();
  const tokens = seatTokens(h);
  expect(room.connect(0, tokens[0], host, Date.now()).ok).toBe(true);
  expect(room.connect(1, tokens[1], guest, Date.now()).ok).toBe(true);
  if (markReady) {
    room.receive(0, host, ready(), Date.now());
    room.receive(1, guest, ready(), Date.now());
  }
  return { host, guest };
}

/* ------------------------------------------------------------------ */
/* Lobby configuration model                                            */
/* ------------------------------------------------------------------ */

describe('Phase 2B.1 lobby configuration', () => {
  it('builds a legal default from the map catalogue and the room duration', () => {
    const config = defaultLobbyConfig('island-assault', DURATION_MS);
    expect(validateLobbyConfig(config).ok).toBe(true);
    expect(config.version).toBe(1);
    expect(config.matchDurationMs).toBe(DURATION_MS);
    expect(new Set(config.seats.map((seat) => seat.color)).size).toBe(2);
    expect(config.seats.every((seat) => seat.ready === false)).toBe(true);
  });

  it('rejects unsupported versions, maps, durations, nations and colours', () => {
    const base = defaultLobbyConfig('island-assault', DURATION_MS);
    const cases: Array<[unknown, string]> = [
      [{ ...base, version: 2 }, 'unsupported-lobby-version'],
      [{ ...base, mapId: 'no-such-map' }, 'invalid-map'],
      [{ ...base, matchDurationMs: 1 }, 'invalid-duration'],
      [{ ...base, matchDurationMs: MAX_MATCH_DURATION_MS + 1 }, 'invalid-duration'],
      [{ ...base, seats: [{ ...base.seats[0], nation: 'atlantis' }, base.seats[1]] }, 'invalid-nation'],
      [{ ...base, seats: [{ ...base.seats[0], color: '#123456' }, base.seats[1]] }, 'invalid-colour'],
      [
        { ...base, seats: [base.seats[0], { ...base.seats[1], color: LOBBY_COLORS[0] }] },
        'duplicate-colour',
      ],
      [{ ...base, seats: [base.seats[0]] }, 'invalid-lobby'],
      [{ ...base, seats: [{ ...base.seats[0], ready: 'yes' }, base.seats[1]] }, 'invalid-lobby'],
      [null, 'invalid-lobby'],
      [undefined, 'invalid-lobby'],
    ];
    for (const [raw, code] of cases) {
      const parsed = validateLobbyConfig(raw);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.problem.code).toBe(code);
    }
  });

  it('reports every unmet start condition in a fixed order', () => {
    const config: LobbyConfigV1 = defaultLobbyConfig('island-assault', DURATION_MS);
    const empty = startConditions({
      seats: [{ joined: false, connected: false }, { joined: false, connected: false }],
      config,
      hardDeadlineAt: Date.now() + 600_000,
      released: false,
      now: Date.now(),
    });
    expect(empty.map((problem) => problem.code)).toEqual(['seat-empty', 'not-ready']);

    const disconnected = startConditions({
      seats: [{ joined: true, connected: true }, { joined: true, connected: false }],
      config,
      hardDeadlineAt: Date.now() + 600_000,
      released: false,
      now: Date.now(),
    });
    expect(disconnected.map((problem) => problem.code)).toEqual(['seat-disconnected', 'not-ready']);

    const readyConfig = {
      ...config,
      seats: [{ ...config.seats[0], ready: true }, { ...config.seats[1], ready: true }],
    };
    expect(
      startConditions({
        seats: [{ joined: true, connected: true }, { joined: true, connected: true }],
        config: readyConfig,
        hardDeadlineAt: Date.now() + 600_000,
        released: false,
        now: Date.now(),
      }),
    ).toEqual([]);

    // A lobby holds capacity time: a match that would outlive the reservation
    // cannot start, even with every seat ready.
    expect(
      startConditions({
        seats: [{ joined: true, connected: true }, { joined: true, connected: true }],
        config: readyConfig,
        hardDeadlineAt: Date.now() + 1000,
        released: false,
        now: Date.now(),
      }).map((problem) => problem.code),
    ).toEqual(['match-window-expired']);

    expect(
      startConditions({
        seats: [{ joined: true, connected: true }, { joined: true, connected: true }],
        config: readyConfig,
        hardDeadlineAt: Date.now() + 600_000,
        released: true,
        now: Date.now(),
      }).map((problem) => problem.code),
    ).toEqual(['reservation-inactive']);
  });
});

/* ------------------------------------------------------------------ */
/* RoomLobby                                                            */
/* ------------------------------------------------------------------ */

describe('Phase 2B.1 lobby authority', () => {
  const seats: RoomSeatDefinition[] = [
    { seatId: 0, playerId: 0, team: 0, token: HOST_TOKEN },
    { seatId: 1, playerId: 1, team: 1, token: GUEST_TOKEN },
  ];

  function makeLobby(): RoomLobby {
    return new RoomLobby({
      roomId: 'lobby-unit',
      seats,
      config: defaultLobbyConfig('island-assault', DURATION_MS),
      hardDeadlineAt: Date.now() + 600_000,
      now: Date.now(),
    });
  }

  it('authenticates seats by token and reports lobby state without a tick', () => {
    const room = makeLobby();
    const host = new FakeSocket();
    expect(room.authorizeSeat(0, GUEST_TOKEN)).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(room.authorizeSeat(0, HOST_TOKEN)).toEqual({ ok: true });
    expect(room.connect(0, HOST_TOKEN, host, 1000).ok).toBe(true);
    const hello = host.messages()[0];
    expect(hello.type).toBe('lobby');
    expect(hello.phase).toBe('lobby');
    expect(hello.seat).toBe(0);
    expect(hello.hostSeat).toBe(0);
    expect(hello).not.toHaveProperty('tick');
    expect(String(host.sent[0])).not.toContain('entities');
    expect(String(host.sent[0])).not.toContain('token');
  });

  it('tracks readiness and refuses gameplay before the match starts', () => {
    const room = makeLobby();
    const host = new FakeSocket();
    const guest = new FakeSocket();
    room.connect(0, HOST_TOKEN, host, 1000);
    room.connect(1, GUEST_TOKEN, guest, 1000);
    room.receive(1, guest, JSON.stringify({ type: 'ready', v: 2, ready: true }), 1100);
    expect(room.lobbyConfig.seats[1].ready).toBe(true);
    expect((host.last().config as { seats: Array<{ ready: boolean }> }).seats[1].ready).toBe(true);

    room.receive(0, host, JSON.stringify({ type: 'command', v: 2, command: { type: 'stop', ids: [] } }), 1200);
    expect(host.last()).toMatchObject({ type: 'error', code: 'match-not-started' });
    room.receive(0, host, JSON.stringify({ type: 'resync', v: 2 }), 1300);
    expect(host.last()).toMatchObject({ type: 'error', code: 'match-not-started' });

    room.receive(0, host, JSON.stringify({ type: 'keepalive', v: 2 }), 1400);
    expect(host.last()).toMatchObject({ type: 'keepaliveAck' });

    // Readiness is not a way to smuggle identity or configuration.
    room.receive(0, host, ready(true, { color: '#000000' }), 1500);
    expect(host.last()).toMatchObject({ type: 'error', code: 'unknown-field' });
    expect(room.lobbyConfig.seats[0].color).toBe(LOBBY_COLORS[0]);
  });

  it('treats a seat as occupied only after its player connects', () => {
    const room = makeLobby();
    expect(room.occupancy()).toEqual([
      { joined: false, connected: false },
      { joined: false, connected: false },
    ]);
    room.connect(0, HOST_TOKEN, new FakeSocket(), 1000);
    expect(room.occupancy()).toEqual([
      { joined: true, connected: true },
      { joined: false, connected: false },
    ]);
    // A second socket on an occupied seat is refused; the first stays authority.
    expect(room.connect(0, HOST_TOKEN, new FakeSocket(), 1150)).toMatchObject({
      ok: false,
      code: 'seat-occupied',
    });
    room.disconnect(0, room.socketFor(0)!);
    expect(room.occupancy()[0]).toEqual({ joined: true, connected: false });
  });
});

/* ------------------------------------------------------------------ */
/* Blocker A — lobby restoration                                        */
/* ------------------------------------------------------------------ */

describe('Phase 2B.1 lobby restoration', () => {
  it('creates a lobby, not a match: no snapshot and no Game', async () => {
    const h = harness();
    const created = await createRoom(h);
    expect(created.status).toBe(200);
    expect(created.phase).toBe('lobby');
    expect(created.seats as unknown[]).toHaveLength(2);
    // Only metadata is durable at creation.
    expect(h.storage.keys()).toEqual([ROOM_STORAGE_KEYS.meta]);
    expect(h.storage.raw(ROOM_STORAGE_KEYS.snapshotIndex)).toBeUndefined();
    expect(matchOf(await open(h))).toBeNull();
  });

  it('restores an empty lobby from metadata alone', async () => {
    const h = harness();
    await createRoom(h);
    evict(h);
    const restored = await open(h);
    expect(matchOf(restored)).toBeNull();
    expect(lobbyOf(restored)).not.toBeNull();
    expect(await status(h)).toMatchObject({
      status: 200,
      phase: 'lobby',
      started: false,
      closed: false,
    });
    expect(h.storage.raw(ROOM_STORAGE_KEYS.snapshotIndex)).toBeUndefined();
  });

  it('restores a one-seat lobby and keeps that seat authoritative', async () => {
    const h = harness();
    await createRoom(h);
    expect(lobby(h).connect(0, seatTokens(h)[0], new FakeSocket(), Date.now()).ok).toBe(true);
    evict(h);
    const restored = await open(h);
    expect(matchOf(restored)).toBeNull();
    // A restart closes sockets, so the seat is claimable again with its token,
    // and only with its token.
    const tokens = seatTokens(h);
    expect(lobbyOf(restored)!.connect(0, tokens[1], new FakeSocket(), Date.now())).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
    expect(lobbyOf(restored)!.connect(0, tokens[0], new FakeSocket(), Date.now()).ok).toBe(true);
  });

  it('restores a two-seat lobby with readiness intact', async () => {
    const h = harness();
    await createRoom(h);
    joinBoth(h, false);
    const room = lobby(h);
    room.receive(0, room.socketFor(0)!, ready(), Date.now());
    await new Promise((resolve) => setTimeout(resolve, 5));
    evict(h);
    const restoredLobby = lobbyOf(await open(h))!;
    expect(restoredLobby.lobbyConfig.seats[0].ready).toBe(true);
    expect(restoredLobby.lobbyConfig.seats[1].ready).toBe(false);
    expect((await status(h)).phase).toBe('lobby');
  });

  it('does not start a match when both players connect after restoration', async () => {
    const h = harness();
    await createRoom(h);
    evict(h);
    const restored = await open(h);
    joinBoth(h, false);
    expect(matchOf(restored)).toBeNull();
    expect((await status(h)).phase).toBe('lobby');
    const meta = h.storage.raw(ROOM_STORAGE_KEYS.meta) as Record<string, unknown>;
    expect(meta.started).toBe(false);
    expect(meta.matchDeadlineAt).toBeNull();
  });

  it('keeps the reservation identity across repeated restoration', async () => {
    const h = harness();
    await createRoom(h);
    const before = (h.storage.raw(ROOM_STORAGE_KEYS.meta) as {
      reservation: { reservationId: string };
    }).reservation.reservationId;
    for (let pass = 0; pass < 3; pass++) {
      expect((await status(h)).reservation).toMatchObject({
        reservationId: before,
        status: 'active',
      });
      evict(h);
    }
    expect(h.capacity.createCalls).toBe(1);
    expect(h.capacity.activeRooms()).toBe(1);
  });

  it('fails a playing room safely when its snapshot is missing', async () => {
    const h = harness();
    await createRoom(h);
    const meta = h.storage.raw(ROOM_STORAGE_KEYS.meta) as Record<string, unknown>;
    const started = Date.now();
    await h.storage.put(ROOM_STORAGE_KEYS.meta, {
      ...meta,
      started: true,
      startedAtMs: started,
      matchDeadlineAt: (meta.reservation as { hardDeadlineAt: number }).hardDeadlineAt,
    });
    evict(h);
    const body = await status(h);
    expect(body.status).toBe(503);
    expect(body.code).toBe('room-state-unavailable');
  });

  it('fails a playing room safely when its snapshot is malformed', async () => {
    const h = harness();
    await createRoom(h);
    const meta = h.storage.raw(ROOM_STORAGE_KEYS.meta) as Record<string, unknown>;
    const started = Date.now();
    await h.storage.put(ROOM_STORAGE_KEYS.meta, {
      ...meta,
      started: true,
      startedAtMs: started,
      matchDeadlineAt: (meta.reservation as { hardDeadlineAt: number }).hardDeadlineAt,
    });
    await h.storage.put(ROOM_STORAGE_KEYS.snapshotIndex, {
      version: 1,
      generation: 'broken',
      chunks: 1,
      length: 8,
      tick: 0,
      updatedAt: started,
    });
    await h.storage.put(`${ROOM_STORAGE_KEYS.snapshotChunkPrefix}broken:0`, '{"tick":');
    evict(h);
    const body = await status(h);
    expect(body.status).toBe(503);
    expect(body.code).toBe('room-state-unavailable');
  });

  it('keeps a finished room finished and refuses to start it again', async () => {
    const h = harness();
    await createRoom(h);
    expect((await shutdown(h)).body).toEqual({ ok: true, closed: true });
    evict(h);

    const body = await status(h);
    expect(body).toMatchObject({
      ok: true,
      phase: 'closed',
      closed: true,
      closedReason: 'room-shutdown',
    });
    expect(body.finalResult).toBeNull();

    const restart = await startMatch(h, 0);
    expect(restart.status).toBe(410);
    expect(restart.body.code).toBe('room-closed');
  });

  it('rejects durable metadata that contradicts itself', async () => {
    const h = harness();
    await createRoom(h);
    const meta = h.storage.raw(ROOM_STORAGE_KEYS.meta) as Record<string, unknown>;
    const created = meta.createdAt as number;
    expect(validatePersistedMeta({ ...meta, matchDeadlineAt: created + 1000 }, h.roomId)).toContain(
      'metadata has a match deadline but never started',
    );
    expect(validatePersistedMeta({ ...meta, startedAtMs: 1000 }, h.roomId)).toContain(
      'metadata has a match start but never started',
    );
    expect(
      validatePersistedMeta(
        { ...meta, lobbyConfig: { ...defaultLobbyConfig(), mapId: 'nope' } },
        h.roomId,
      ),
    ).toContain('lobby configuration is invalid');
    expect(validatePersistedMeta(meta, h.roomId)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Blocker B — explicit start                                           */
/* ------------------------------------------------------------------ */

describe('Phase 2B.1 explicit match start', () => {
  it('accepts a host start once both seats are connected and ready', async () => {
    const h = harness();
    await createRoom(h);
    const { host, guest } = joinBoth(h);
    const result = await startMatch(h, 0);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, started: true, phase: 'playing', tick: 0 });
    expect(result.body.durationMs).toBe(DURATION_MS);

    // Both seats are told the match is playing on the socket they already hold.
    for (const socket of [host, guest]) {
      const types = socket.messages().map((message) => message.type);
      expect(types).toContain('hello');
      expect(types).toContain('sync');
      expect(socket.messages().find((message) => message.type === 'hello')!.phase).toBe('playing');
    }

    expect(await status(h)).toMatchObject({ phase: 'playing', started: true });
    const meta = h.storage.raw(ROOM_STORAGE_KEYS.meta) as Record<string, unknown>;
    expect(meta.started).toBe(true);
    expect(meta.startedAtMs).toBe(result.body.startedAtMs);
    expect(meta.matchDeadlineAt).toBe(result.body.matchDeadlineAt);
    expect(h.storage.raw(ROOM_STORAGE_KEYS.snapshotIndex)).toMatchObject({ tick: 0 });
  });

  it('derives the deadline from the configured duration at start', async () => {
    const h = harness();
    await createRoom(h);
    const createdAt = (h.storage.raw(ROOM_STORAGE_KEYS.meta) as { createdAt: number }).createdAt;
    joinBoth(h);
    expect((await status(h)).started).toBe(false);
    expect((h.storage.raw(ROOM_STORAGE_KEYS.meta) as Record<string, unknown>).matchDeadlineAt).toBeNull();

    const result = await startMatch(h, 0);
    const startedAt = result.body.startedAtMs as number;
    expect(result.body.matchDeadlineAt).toBe(startedAt + DURATION_MS);
    expect(startedAt).toBeGreaterThanOrEqual(createdAt);
  });

  it('refuses a start from the guest seat', async () => {
    const h = harness();
    await createRoom(h);
    joinBoth(h);
    const result = await startMatch(h, 1);
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('not-host');
    expect((await status(h)).phase).toBe('lobby');
  });

  it('refuses an unauthenticated start', async () => {
    const h = harness();
    await createRoom(h);
    joinBoth(h);
    const room = await open(h);
    const response = await room.fetch(
      new Request(url(h, 'start'), {
        method: 'POST',
        headers: { Authorization: 'Room not-a-real-seat-token', 'Content-Type': 'application/json' },
        body: '{}',
      }),
    );
    expect(response.status).toBe(401);
    expect(((await response.json()) as Record<string, unknown>).code).toBe('unauthorized');
    expect((await status(h)).phase).toBe('lobby');
  });

  it('refuses a start with one seat, a disconnected seat or missing readiness', async () => {
    const lone = harness('phase2b1-lone');
    await createRoom(lone);
    lobby(lone).connect(0, seatTokens(lone)[0], new FakeSocket(), Date.now());
    expect((await startMatch(lone, 0)).body.code).toBe('seat-empty');

    const away = harness('phase2b1-away');
    await createRoom(away);
    const joined = joinBoth(away);
    lobby(away).disconnect(1, joined.guest);
    expect((await startMatch(away, 0)).body.code).toBe('seat-disconnected');

    const unready = harness('phase2b1-unready');
    await createRoom(unready);
    joinBoth(unready, false);
    expect((await startMatch(unready, 0)).body.code).toBe('not-ready');
  });

  it('starts only once and never restarts or resets the timer', async () => {
    const h = harness();
    await createRoom(h);
    joinBoth(h);
    const first = await startMatch(h, 0);
    expect(first.body.started).toBe(true);
    const deadline = first.body.matchDeadlineAt as number;

    const second = await startMatch(h, 0);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      alreadyStarted: true,
      startedAtMs: first.body.startedAtMs,
      matchDeadlineAt: deadline,
      tick: 0,
    });

    const third = await startMatch(h, 0);
    expect(third.body.alreadyStarted).toBe(true);
    expect(third.body.matchDeadlineAt).toBe(deadline);
  });

  it('serialises concurrent start requests into one match', async () => {
    const h = harness();
    await createRoom(h);
    joinBoth(h);
    const [a, b] = await Promise.all([startMatch(h, 0), startMatch(h, 0)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.started === true, b.body.started === true].filter(Boolean)).toHaveLength(1);
    expect(a.body.startedAtMs).toBe(b.body.startedAtMs);
    expect(a.body.matchDeadlineAt).toBe(b.body.matchDeadlineAt);
    expect(h.capacity.createCalls).toBe(1);
    expect(h.capacity.activeRooms()).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Failure boundaries and recovery                                      */
/* ------------------------------------------------------------------ */

describe('Phase 2B.1 start failure boundaries', () => {
  it('rolls back to a retryable lobby when the opening snapshot cannot be written', async () => {
    const h = harness();
    await createRoom(h);
    joinBoth(h);
    h.storage.failPut = (key) => key.startsWith(ROOM_STORAGE_KEYS.snapshotChunkPrefix);

    const failed = await startMatch(h, 0);
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe('match-start-not-durable');

    expect(await status(h)).toMatchObject({ phase: 'lobby', started: false, closed: false });
    expect(h.capacity.activeRooms()).toBe(1);

    // The failed attempt leaked no reservation, and the host can retry.
    h.storage.failPut = null;
    const retried = await startMatch(h, 0);
    expect(retried.status).toBe(200);
    expect(retried.body.started).toBe(true);
    expect(h.capacity.activeRooms()).toBe(1);
  });

  it('rolls back to a retryable lobby when the lifecycle commit cannot be written', async () => {
    const h = harness();
    await createRoom(h);
    joinBoth(h);
    h.storage.failPut = (key) => key === ROOM_STORAGE_KEYS.meta;

    const failed = await startMatch(h, 0);
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe('match-start-not-durable');
    expect((await status(h)).phase).toBe('lobby');

    h.storage.failPut = null;
    expect((await startMatch(h, 0)).body.started).toBe(true);
  });

  it('recovers an eviction between the snapshot and the lifecycle commit as a lobby', async () => {
    const h = harness();
    await createRoom(h);
    joinBoth(h);
    h.storage.failPut = (key) => key === ROOM_STORAGE_KEYS.meta;
    expect((await startMatch(h, 0)).status).toBe(503);
    h.storage.failPut = null;

    // The opening snapshot exists on disk, but the lifecycle never committed.
    expect(h.storage.raw(ROOM_STORAGE_KEYS.snapshotIndex)).toBeDefined();
    evict(h);
    expect(matchOf(await open(h))).toBeNull();
    expect((await status(h)).phase).toBe('lobby');

    // The eviction closed both sockets, so the players reconnect and then the
    // host can start: the lobby survived, the match never existed.
    joinBoth(h);
    expect((await startMatch(h, 0)).body.started).toBe(true);
    expect((await status(h)).phase).toBe('playing');
  });

  it('recovers an eviction after the lifecycle commit as an active match', async () => {
    const h = harness();
    await createRoom(h);
    joinBoth(h);
    const started = await startMatch(h, 0);
    const startedAt = started.body.startedAtMs as number;
    const deadline = started.body.matchDeadlineAt as number;

    evict(h);
    const body = await status(h);
    expect(body).toMatchObject({ phase: 'playing', started: true });
    expect((body.matchTiming as { startedAtMs: number }).startedAtMs).toBe(startedAt);
    expect((body.match as { matchDeadlineAt: number }).matchDeadlineAt).toBe(deadline);
    expect(body.startedMatchDeadlineAt).toBe(deadline);
  });

  it('rejects an invalid stored lobby configuration instead of inventing a match', async () => {
    const h = harness();
    await createRoom(h);
    const meta = h.storage.raw(ROOM_STORAGE_KEYS.meta) as Record<string, unknown>;
    await h.storage.put(ROOM_STORAGE_KEYS.meta, {
      ...meta,
      lobbyConfig: { ...defaultLobbyConfig(), version: 7 },
    });
    evict(h);
    const body = await status(h);
    expect(body.status).toBe(503);
    expect(body.code).toBe('room-state-unavailable');
    expect(String(body.message)).toContain('lobby configuration');
  });
});

/* ------------------------------------------------------------------ */
/* Reservation and capacity safety                                      */
/* ------------------------------------------------------------------ */

describe('Phase 2B.1 reservation safety', () => {
  it('reserves once for the lobby, never again on restore or start', async () => {
    const h = harness();
    await createRoom(h);
    joinBoth(h);
    expect(h.capacity.createCalls).toBe(1);
    expect(h.capacity.activeRooms()).toBe(1);
    evict(h);
    expect((await status(h)).phase).toBe('lobby');
    joinBoth(h);
    expect((await startMatch(h, 0)).body.started).toBe(true);
    expect(h.capacity.activeRooms()).toBe(1);
    expect(h.capacity.createCalls).toBe(1);
  });

  it('releases a closed lobby exactly once and frees its capacity slot', async () => {
    const h = harness();
    await createRoom(h);
    expect((await shutdown(h)).body).toEqual({ ok: true, closed: true });
    expect(h.capacity.activeRooms()).toBe(0);

    expect((await shutdown(h)).body).toEqual({ ok: true, alreadyClosed: true });
    expect(h.capacity.activeRooms()).toBe(0);

    evict(h);
    expect((await status(h)).phase).toBe('closed');
    expect(h.capacity.activeRooms()).toBe(0);
  });

  it('keeps the two-room cap for lobby creation', async () => {
    const capacity = new FakeCapacityBinding();
    const env = roomEnv(capacity);
    const statuses: number[] = [];
    for (const roomId of ['capacity-a', 'capacity-b', 'capacity-c']) {
      const storage = new FakeStorage();
      const state = {
        id: { toString: () => roomId } as DurableObjectId,
        storage,
        blockConcurrencyWhile: <T>(cb: () => Promise<T>): Promise<T> => cb(),
        abort: () => undefined,
      } as DurableObjectState;
      const response = await new MatchRoomDurableObject(state, env).fetch(
        new Request(`https://room.test/rooms/${roomId}/internal/create`, {
          method: 'POST',
          headers: adminHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ mode: '1v1', matchDurationMs: DURATION_MS }),
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 503]);
    expect(capacity.activeRooms()).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Lobby socket route                                                   */
/* ------------------------------------------------------------------ */

describe('Phase 2B.1 lobby socket route', () => {
  function wsRequest(
    h: Harness,
    seat: string | number,
    token: string | null,
    options: { upgrade?: boolean; origin?: string } = {},
  ): Request {
    const headers: Record<string, string> = {};
    if (options.upgrade !== false) headers.Upgrade = 'websocket';
    if (options.origin) headers.Origin = options.origin;
    if (token) headers['Sec-WebSocket-Protocol'] = `mca.v2, mca.token.${token}`;
    return new Request(`${url(h, 'ws')}?seat=${seat}`, { headers });
  }

  it('rejects anything that is not a WebSocket upgrade', async () => {
    const h = harness('phase2b1-ws-upgrade');
    await createRoom(h);
    const response = await (await open(h)).fetch(
      wsRequest(h, 0, seatTokens(h)[0], { upgrade: false }),
    );
    expect(response.status).toBe(426);
  });

  it('rejects a foreign origin before it looks at the seat', async () => {
    const h = harness('phase2b1-ws-origin');
    await createRoom(h);
    const env = { ...h.env };
    delete env.MP_ALLOW_NO_ORIGIN;
    h.env = env;
    evict(h);
    const response = await (await open(h)).fetch(
      wsRequest(h, 0, seatTokens(h)[0], { origin: 'https://evil.example' }),
    );
    expect(response.status).toBe(403);
  });

  it('rejects an invalid seat, a missing token and the other seat token', async () => {
    const h = harness('phase2b1-ws-auth');
    await createRoom(h);
    const room = await open(h);
    const tokens = seatTokens(h);

    expect((await room.fetch(wsRequest(h, 2, tokens[0]))).status).toBe(400);
    expect((await room.fetch(wsRequest(h, 0, null))).status).toBe(401);
    expect((await room.fetch(wsRequest(h, 0, tokens[1]))).status).toBe(401);
    // The refusal never reaches the transport: no lobby seat was occupied.
    expect(lobby(h).occupancy()[0]).toEqual({ joined: false, connected: false });
  });

  it('rejects a socket on a closed room', async () => {
    const h = harness('phase2b1-ws-closed');
    await createRoom(h);
    const tokens = seatTokens(h);
    await shutdown(h);
    evict(h);
    const response = await (await open(h)).fetch(wsRequest(h, 0, tokens[0]));
    expect(response.status).toBe(410);
  });

  it('accepts an authorised lobby seat up to the transport handoff', async () => {
    const h = harness('phase2b1-ws-ok');
    await createRoom(h);
    const room = await open(h);
    // `WebSocketPair` and a 101 response only exist inside workerd. Getting to
    // that constructor proves the seat passed lobby authorization; the 101
    // upgrade itself is not exercised by this suite and is recorded as a
    // limitation in the phase report.
    await expect(room.fetch(wsRequest(h, 0, seatTokens(h)[0]))).rejects.toThrow(/WebSocketPair/);
    expect(lobby(h).occupancy()[0]).toEqual({ joined: false, connected: false });
  });
});

/* ------------------------------------------------------------------ */
/* Seat sockets after the start                                         */
/* ------------------------------------------------------------------ */

describe('Phase 2B.1 seat socket ownership after the start', () => {
  /** Drive one socket message through the room's own routing, as the WS adapter does. */
  function seatMessage(
    room: MatchRoomDurableObject,
    seat: number,
    socket: FakeSocket,
    text: string,
    now = Date.now(),
  ) {
    (
      room as unknown as {
        receiveFromSeat: (seat: number, socket: FakeSocket, text: string, now: number) => void;
      }
    ).receiveFromSeat(seat, socket, text, now);
  }

  function command(ids: number[], x: number, z: number, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      type: 'command',
      v: ROOM_PROTOCOL_VERSION,
      command: { type: 'move', ids, x, z, attackMove: false, ...extra },
    });
  }

  it('routes a command from a socket opened in the lobby into the running match', async () => {
    const h = harness('phase2b1-socket-command');
    await createRoom(h);
    const { host } = joinBoth(h);
    expect((await startMatch(h, 0)).status).toBe(200);
    const room = await open(h);
    // The lobby no longer exists: a handler that captured it at open time would
    // drop everything this seat sends from here on.
    expect(lobbyOf(room)).toBeNull();

    const match = matchOf(room) as RoomMatch;
    const unit = match.game.state.entities.find((entity) => entity.owner === 0 && entity.kind === 'unit')!;
    expect(unit).toBeTruthy();

    const before = host.messages().length;
    // Exactly what the browser client sends: intent only, no team of its own.
    seatMessage(room, 0, host, command([unit.id], unit.x + 4, unit.z + 4));

    const replies = host.messages().slice(before);
    const accepted = replies.find((message) => message.type === 'commandAccepted');
    const rejected = replies.find((message) => message.type === 'commandRejected');
    expect(rejected).toBeUndefined();
    expect(accepted).toBeTruthy();
    // The gate queues the order; one authoritative tick is what applies it.
    expect(match.game.pending.length).toBeGreaterThan(0);
    match.tick(Date.now());
    expect(match.game.getEntity(unit.id)?.order?.type).toBe('move');

    // The seat cannot name its own authority: the room owns the team. Sent a
    // couple of seconds later so the per-seat command rate limit is not what
    // refuses it.
    seatMessage(room, 0, host, command([unit.id], unit.x, unit.z, { team: 1 }), Date.now() + 2_000);
    expect(host.last()).toMatchObject({ type: 'commandRejected', code: 'forbidden-field' });
  });

  it('still refuses a command from a socket that is not the seat’s own', async () => {
    const h = harness('phase2b1-socket-foreign');
    await createRoom(h);
    const { host, guest } = joinBoth(h);
    await startMatch(h, 0);
    const room = await open(h);
    const match = matchOf(room) as RoomMatch;
    const unit = match.game.state.entities.find((entity) => entity.owner === 0 && entity.kind === 'unit')!;

    // Seat 1's socket claiming seat 0 gets an error, never authority.
    seatMessage(room, 0, guest, command([unit.id], unit.x + 4, unit.z + 4));
    expect(guest.messages().some((message) => message.type === 'error')).toBe(true);
    expect(host.messages().some((message) => message.type === 'commandAccepted')).toBe(false);
    expect(match.game.getEntity(unit.id)?.order?.type).not.toBe('move');
  });

  it('answers a keepalive sent after the start on the same socket', async () => {
    const h = harness('phase2b1-socket-keepalive');
    await createRoom(h);
    const { host } = joinBoth(h);
    await startMatch(h, 0);
    const room = await open(h);
    const before = host.messages().length;
    seatMessage(room, 0, host, JSON.stringify({ type: 'keepalive', v: ROOM_PROTOCOL_VERSION }));
    expect(host.messages().slice(before).some((message) => message.type === 'keepaliveAck')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Documented defaults for the next phase                               */
/* ------------------------------------------------------------------ */

describe('Phase 2B.1 documented defaults', () => {
  it('uses the island catalogue map and the reservation duration until the lobby edits them', async () => {
    const h = harness();
    expect((await createRoom(h, DEFAULT_MATCH_DURATION_MS)).phase).toBe('lobby');
    const meta = h.storage.raw(ROOM_STORAGE_KEYS.meta) as Record<string, unknown>;
    const config = meta.lobbyConfig as LobbyConfigV1;
    expect(config.mapId).toBe('island-assault');
    expect(config.matchDurationMs).toBe(DEFAULT_MATCH_DURATION_MS);
    expect(config.seats.map((seat) => seat.color)).toEqual([LOBBY_COLORS[0], LOBBY_COLORS[1]]);
  });
});
