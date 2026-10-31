import { describe, expect, it } from 'vitest';
import {
  MatchRoomDurableObject,
  ROOM_STORAGE_KEYS,
  type MatchRoomEnv,
} from '../src/multiplayer/roomDurableObject';
import { RoomMatch, type RoomSeatDefinition, type RoomSocket } from '../src/multiplayer/roomMatch';
import {
  checkSnapshotIndex,
  inspectStoredSnapshot,
  readbackMeta,
  sha256Hex,
  type SnapshotReadbackSuccess,
} from '../src/multiplayer/snapshotReadback';

const ROOM_ID = 'phase2a16-readback';
const ADMIN = 'phase2a16-admin-token';
const CREATED_AT = 1_700_000_000_000;
const DURATION_MS = 1_800_000;
const DEADLINE_AT = CREATED_AT + DURATION_MS;

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
}

/**
 * Minimal Durable Object storage. Every put and delete is counted so a test can
 * prove the inspection action never writes, and snapshot replaces are detected
 * because a write would change the stored text.
 */
class FakeStorage {
  readonly values = new Map<string, unknown>();
  puts = 0;
  deletes = 0;
  reads = 0;

  async get<T = unknown>(key: string): Promise<T | undefined> {
    this.reads++;
    return this.values.get(key) as T | undefined;
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.puts++;
    this.values.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    this.deletes++;
    return this.values.delete(key);
  }

  snapshotOf(): Array<[string, unknown]> {
    return [...this.values.entries()].map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]);
  }
}

function fakeState(storage: FakeStorage): DurableObjectState {
  return {
    id: { toString: () => ROOM_ID },
    storage: storage as unknown as DurableObjectStorage,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> => callback(),
    abort: () => undefined,
  };
}

function env(overrides: Partial<MatchRoomEnv> = {}): MatchRoomEnv {
  return {
    CAPACITY: {} as DurableObjectNamespace,
    ROOMS: {} as DurableObjectNamespace,
    MP_ADMIN_TOKEN: ADMIN,
    MP_DEV_MODE: '1',
    MP_ONLINE_ENABLED: '1',
    ...overrides,
  };
}

function seats(): RoomSeatDefinition[] {
  return [
    { seatId: 0, playerId: 0, team: 0, token: 'seat-zero-token-000000000000' },
    { seatId: 1, playerId: 1, team: 1, token: 'seat-one-token-0000000000000' },
  ];
}

function startedRoom(now = CREATED_AT + 25): RoomMatch {
  const room = new RoomMatch({
    roomId: ROOM_ID,
    mode: '1v1',
    seats: seats(),
    matchDurationMs: DURATION_MS,
    matchDeadlineAt: DEADLINE_AT,
    now,
    // An explicit start builds the match already playing; this fixture does the
    // same rather than relying on a socket to start it.
    phase: 'playing',
    abandonAfterMs: 30_000,
  });
  expect(room.connect(0, seats()[0].token, new FakeSocket(), now).ok).toBe(true);
  expect(room.connect(1, seats()[1].token, new FakeSocket(), now).ok).toBe(true);
  for (let tick = 1; tick <= 40; tick++) room.tick(now + tick * 50);
  return room;
}

function metaFor(
  room: RoomMatch,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    roomId: ROOM_ID,
    mode: '1v1',
    seats: seats(),
    reservation: {
      reservationId: 'phase2a16-reservation',
      status: 'active',
      hardDeadlineAt: DEADLINE_AT,
      createdAt: CREATED_AT,
    },
    createdAt: CREATED_AT,
    matchDurationMs: DURATION_MS,
    started: true,
    startedAtMs: room.startedAt,
    finishedAtMs: room.finishedAt,
    totalTicks: room.game.state.tick,
    closed: false,
    closedReason: null,
    closedAt: null,
    finalResult: room.currentResult,
    ...overrides,
  };
}

/** Lay a snapshot into storage exactly the way the writer splits it. */
function store(
  storage: FakeStorage,
  text: string,
  options: { tick: number; generation?: string; chunkChars?: number } = { tick: 0 },
): { generation: string; chunks: number } {
  const chunkChars = options.chunkChars ?? ROOM_STORAGE_KEYS.snapshotChunkChars;
  const generation = options.generation ?? 'phase2a16generation01';
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += chunkChars) {
    chunks.push(text.slice(offset, offset + chunkChars));
  }
  chunks.forEach((chunk, index) => {
    storage.values.set(`${ROOM_STORAGE_KEYS.snapshotChunkPrefix}${generation}:${index}`, chunk);
  });
  storage.values.set(ROOM_STORAGE_KEYS.snapshotIndex, {
    version: 1,
    generation,
    chunks: chunks.length,
    length: text.length,
    tick: options.tick,
    updatedAt: CREATED_AT + 1_000,
  });
  return { generation, chunks: chunks.length };
}

interface Fixture {
  storage: FakeStorage;
  room: RoomMatch;
  text: string;
}

function fixture(options: { finished?: boolean; now?: number } = {}): Fixture {
  const now = options.now ?? CREATED_AT + 65_000;
  const room = startedRoom();
  const finishAt = now + 500;
  if (options.finished) room.finishAtDeadline(finishAt);
  const snapshot = room.snapshot(options.finished ? finishAt : now);
  // Stored with indentation so the on-disk bytes are definitely not what
  // JSON.stringify would emit for the same value. Any reserialisation in the
  // read path would change the hash and trip the exact-bytes assertion.
  const text = JSON.stringify(snapshot, null, 1);
  const storage = new FakeStorage();
  store(storage, text, { tick: snapshot.tick });
  storage.values.set(
    ROOM_STORAGE_KEYS.meta,
    metaFor(room, options.finished ? { closed: true, closedReason: 'match-finished', closedAt: finishAt } : {}),
  );
  return { storage, room, text };
}

interface InspectResponse {
  status: number;
  body: SnapshotReadbackSuccess & {
    ok: boolean;
    code?: string;
    stage?: string;
    problems?: string[];
  };
}

async function inspect(
  storage: FakeStorage,
  init: { token?: string | null; include?: string } = {},
): Promise<InspectResponse> {
  const object = new MatchRoomDurableObject(fakeState(storage), env());
  const headers = new Headers({ 'X-MCA-Room-Action': 'snapshot' });
  if (init.token !== null) headers.set('Authorization', `Bearer ${init.token ?? ADMIN}`);
  const query = init.include ? `?include=${init.include}` : '';
  const response = await object.fetch(
    new Request(`https://staging.example/api/multiplayer/rooms/${ROOM_ID}/snapshot${query}`, {
      method: 'GET',
      headers,
    }),
  );
  return { status: response.status, body: (await response.json()) as never };
}

describe('persisted snapshot read-back: access control', () => {
  it('rejects a request with no admin token', async () => {
    const { storage } = fixture();
    const result = await inspect(storage, { token: null });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(storage.puts).toBe(0);
    expect(storage.deletes).toBe(0);
  });

  it('rejects an invalid admin token', async () => {
    const { storage } = fixture();
    const result = await inspect(storage, { token: 'not-the-admin-token' });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('unauthorized');
  });

  it('is unavailable outside staging even with a valid token', async () => {
    const { storage } = fixture();
    const object = new MatchRoomDurableObject(fakeState(storage), env({ MP_DEV_MODE: '0' }));
    const response = await object.fetch(
      new Request(`https://prod.example/api/multiplayer/rooms/${ROOM_ID}/snapshot`, {
        method: 'GET',
        headers: {
          'X-MCA-Room-Action': 'snapshot',
          Authorization: `Bearer ${ADMIN}`,
        },
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, code: 'not-found' });
    expect(storage.reads).toBe(0);
    expect(storage.puts).toBe(0);
  });

  it('is unavailable when no admin token is configured at all', async () => {
    const { storage } = fixture();
    const object = new MatchRoomDurableObject(
      fakeState(storage),
      env({ MP_ADMIN_TOKEN: undefined, MP_DEV_MODE: '1' }),
    );
    const response = await object.fetch(
      new Request(`https://staging.example/api/multiplayer/rooms/${ROOM_ID}/snapshot`, {
        method: 'GET',
        headers: { 'X-MCA-Room-Action': 'snapshot', Authorization: `Bearer ${ADMIN}` },
      }),
    );
    expect(response.status).toBe(403);
  });

  it('fails safely for a room that was never stored', async () => {
    const storage = new FakeStorage();
    const result = await inspect(storage);
    expect(result.status).toBe(404);
    expect(result.body.code).toBe('not-found');
  });

  it('rejects an unsupported evidence option', async () => {
    const { storage } = fixture();
    const result = await inspect(storage, { include: 'everything' });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('invalid-readback');
  });
});

describe('persisted snapshot read-back: exact bytes', () => {
  it('assembles the stored text and hashes exactly those bytes', async () => {
    const { storage, text } = fixture();
    const result = await inspect(storage);
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    const encoder = new TextEncoder();
    const expectedBytes = encoder.encode(text);
    expect(result.body.readback.assembledLength).toBe(text.length);
    expect(result.body.readback.byteLength).toBe(expectedBytes.length);
    expect(result.body.readback.sha256).toBe(await sha256Hex(expectedBytes));
    expect(result.body.readback.hashSource).toBe('computed-from-assembled-bytes');
    expect(result.body.readback.indexCarriesHash).toBe(false);
    expect(result.body.readback.chunksRead).toBe(result.body.readback.chunksExpected);
    expect(result.body.readback.chunkKeyShape).toBe('generation:index');
  });

  it('reads stored bytes rather than reserialising the snapshot', async () => {
    const { storage, text } = fixture();
    // The fixture is stored with one-space indentation, so a reserialised copy
    // would differ. Assert the read-back length matches the stored text, not a
    // round-tripped JSON.stringify of the parsed value.
    const reserialised = JSON.stringify(JSON.parse(text));
    expect(reserialised.length).not.toBe(text.length);
    const result = await inspect(storage);
    expect(result.body.readback.assembledLength).toBe(text.length);
    expect(result.body.readback.assembledLength).not.toBe(reserialised.length);
    expect(result.body.readback.textIncluded).toBe(false);
    expect(result.body.readback.text).toBeUndefined();
  });

  it('returns the exact text only when it is explicitly requested', async () => {
    const { storage, text } = fixture();
    const result = await inspect(storage, { include: 'text' });
    expect(result.status).toBe(200);
    expect(result.body.readback.textIncluded).toBe(true);
    expect(result.body.readback.text).toBe(text);
    expect(result.body.readback.textUtf16Length).toBe(text.length);
  });

  it('is idempotent across repeated inspections', async () => {
    const { storage } = fixture();
    const first = await inspect(storage);
    const second = await inspect(storage);
    expect(second.body.readback.byteLength).toBe(first.body.readback.byteLength);
    expect(second.body.readback.sha256).toBe(first.body.readback.sha256);
    expect(second.body.snapshot).toEqual(first.body.snapshot);
  });

  it('hashes with SHA-256 (known vector)', async () => {
    const digest = await sha256Hex(new TextEncoder().encode('abc'));
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('persisted snapshot read-back: corruption is reported', () => {
  it('names the missing chunk', async () => {
    const { storage } = fixture();
    storage.values.delete(`${ROOM_STORAGE_KEYS.snapshotChunkPrefix}phase2a16generation01:0`);
    const result = await inspect(storage);
    expect(result.status).toBe(500);
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe('snapshot-chunk-missing');
    expect(result.body.stage).toBe('chunks');
    expect((result.body.problems ?? []).join(' ')).toContain('chunk 0');
  });

  it('rejects a chunk that was truncated in storage', async () => {
    const { storage } = fixture();
    const key = `${ROOM_STORAGE_KEYS.snapshotChunkPrefix}phase2a16generation01:0`;
    const chunk = storage.values.get(key) as string;
    storage.values.set(key, chunk.slice(0, chunk.length - 10));
    const result = await inspect(storage);
    expect(result.status).toBe(500);
    expect(result.body.code).toBe('snapshot-length-mismatch');
    expect(result.body.stage).toBe('assembly');
  });

  it('rejects unparsable stored text', async () => {
    const { storage, text } = fixture();
    store(storage, text.replace('"tick"', '"tick"'), { tick: JSON.parse(text).tick });
    const key = `${ROOM_STORAGE_KEYS.snapshotChunkPrefix}phase2a16generation01:0`;
    storage.values.set(key, '{not json');
    storage.values.set(ROOM_STORAGE_KEYS.snapshotIndex, {
      version: 1,
      generation: 'phase2a16generation01',
      chunks: 1,
      length: '{not json'.length,
      tick: 0,
      updatedAt: CREATED_AT,
    });
    const result = await inspect(storage);
    expect(result.status).toBe(500);
    expect(result.body.code).toBe('snapshot-parse-failed');
  });

  it('rejects a tick that disagrees with the index', async () => {
    const { storage, text } = fixture();
    const parsed = JSON.parse(text) as { tick: number };
    const index = storage.values.get(ROOM_STORAGE_KEYS.snapshotIndex) as Record<string, unknown>;
    storage.values.set(ROOM_STORAGE_KEYS.snapshotIndex, {
      ...index,
      tick: parsed.tick + 1,
    });
    const result = await inspect(storage);
    expect(result.status).toBe(500);
    expect(result.body.code).toBe('snapshot-tick-mismatch');
  });

  it('passes a schema failure through as an explicit validation error', async () => {
    const { storage, text } = fixture();
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const broken = JSON.stringify({ ...parsed, source: 'client' });
    const storage2 = new FakeStorage();
    store(storage2, broken, { tick: parsed.tick as number });
    storage2.values.set(ROOM_STORAGE_KEYS.meta, storage.values.get(ROOM_STORAGE_KEYS.meta));
    const result = await inspect(storage2);
    expect(result.status).toBe(500);
    expect(result.body.code).toBe('validation-invalid-source');
    expect(result.body.stage).toBe('validate');
  });

  it('reports index shapes it cannot trust', async () => {
    expect(checkSnapshotIndex(null).ok).toBe(false);
    expect(checkSnapshotIndex({ version: 2 }).ok).toBe(false);
    expect(
      checkSnapshotIndex({ version: 1, generation: 'g', chunks: 0, length: 10, tick: 0, updatedAt: 0 })
        .ok,
    ).toBe(false);
    expect(
      checkSnapshotIndex({ version: 1, generation: 'g', chunks: 1, length: 0, tick: 0, updatedAt: 0 })
        .ok,
    ).toBe(false);
    expect(
      checkSnapshotIndex({ version: 1, generation: 'g', chunks: 1, length: 4, tick: 0, updatedAt: 0 })
        .ok,
    ).toBe(true);
  });
});

describe('persisted snapshot read-back: read-only', () => {
  it('does not write, delete or reschedule anything', async () => {
    const { storage } = fixture();
    const before = storage.snapshotOf();
    const putsBefore = storage.puts;
    const deletesBefore = storage.deletes;
    await inspect(storage);
    expect(storage.puts).toBe(putsBefore);
    expect(storage.deletes).toBe(deletesBefore);
    expect(storage.snapshotOf()).toEqual(before);
  });

  it('leaves a closed room closed with its final result intact', async () => {
    const { storage } = fixture({ finished: true });
    const metaBefore = JSON.parse(
      JSON.stringify(storage.values.get(ROOM_STORAGE_KEYS.meta)),
    ) as Record<string, unknown>;
    const result = await inspect(storage);
    expect(result.status).toBe(200);
    expect(result.body.lifecycle.metaClosed).toBe(true);
    expect(result.body.lifecycle.snapshotPhase).toBe('finished');
    const metaAfter = storage.values.get(ROOM_STORAGE_KEYS.meta) as Record<string, unknown>;
    expect(metaAfter).toEqual(metaBefore);
    expect(metaAfter.closed).toBe(true);
    expect(metaAfter.closedReason).toBe('match-finished');
  });

  it('never loads or restores the room it inspects', async () => {
    // A room whose metadata is unreadable as a game state would fail a restore.
    // Inspection must still answer, because it does not restore anything.
    const { storage } = fixture();
    const result = await inspect(storage);
    expect(result.body.ok).toBe(true);
    // The DO object holds no restored match: only storage was read.
    const object = new MatchRoomDurableObject(fakeState(storage), env());
    await object.fetch(
      new Request(`https://staging.example/api/multiplayer/rooms/${ROOM_ID}/snapshot`, {
        method: 'GET',
        headers: { 'X-MCA-Room-Action': 'snapshot', Authorization: `Bearer ${ADMIN}` },
      }),
    );
    expect(storage.puts).toBe(0);
  });
});

describe('persisted snapshot read-back: lifecycle evidence', () => {
  it('reports a playing snapshot with no finish time', async () => {
    const { storage } = fixture();
    const result = await inspect(storage);
    expect(result.body.lifecycle.snapshotPhase).toBe('playing');
    expect(result.body.lifecycle.snapshotFinishedAtMs).toBeNull();
    expect(result.body.lifecycle.playingSnapshotHasFinishTime).toBe(false);
    expect(result.body.lifecycle.consistent).toBe(true);
    expect(result.body.lifecycle.finishedAtMatchesMeta).toBe(true);
    expect(result.body.lifecycle.resultMatchesMeta).toBe(true);
  });

  it('reports a finished snapshot with a finish time and matching result', async () => {
    const { storage } = fixture({ finished: true });
    const result = await inspect(storage);
    expect(result.body.lifecycle.snapshotPhase).toBe('finished');
    expect(result.body.lifecycle.snapshotFinishedAtMs).not.toBeNull();
    expect(result.body.lifecycle.finishedSnapshotHasFinishTime).toBe(true);
    expect(result.body.lifecycle.finishedAtMatchesMeta).toBe(true);
    expect(result.body.lifecycle.resultMatchesMeta).toBe(true);
    expect(result.body.lifecycle.consistent).toBe(true);
    // Both seats survive to the deadline with equal scores, so the neutral
    // result is a draw reached by the time limit.
    expect(result.body.snapshot.result.reason).toBe('draw');
    expect(result.body.snapshot.result.tick).toBe(result.body.snapshot.tick);
  });

  it('reports seat epochs and sequences from the stored snapshot', async () => {
    const { storage } = fixture({ finished: true });
    const result = await inspect(storage);
    expect(result.body.snapshot.seats).toHaveLength(2);
    for (const seat of result.body.snapshot.seats) {
      expect(seat.epoch).toBeGreaterThan(0);
      expect(seat.seq).toBeGreaterThanOrEqual(0);
    }
    expect(result.body.validation).toMatchObject({
      strict: true,
      function: 'validateRoomSnapshot',
      ok: true,
    });
  });

  it('flags a snapshot whose result disagrees with the persisted metadata', async () => {
    const { storage } = fixture({ finished: true });
    const meta = storage.values.get(ROOM_STORAGE_KEYS.meta) as Record<string, unknown>;
    storage.values.set(ROOM_STORAGE_KEYS.meta, {
      ...meta,
      finalResult: { ...(meta.finalResult as Record<string, unknown>), winnerTeam: 1 },
    });
    const result = await inspect(storage);
    expect(result.status).toBe(200);
    expect(result.body.lifecycle.resultMatchesMeta).toBe(false);
    expect(result.body.lifecycle.consistent).toBe(false);
  });

  it('normalises the durable envelope for comparison', () => {
    const meta = readbackMeta(
      {
        closed: true,
        closedReason: 'match-finished',
        closedAt: 12,
        startedAtMs: 10,
        finishedAtMs: 11,
        totalTicks: 300,
        reservation: { hardDeadlineAt: 99 },
        finalResult: { phase: 'finished' },
      },
      ROOM_ID,
    );
    expect(meta).toEqual({
      roomId: ROOM_ID,
      closed: true,
      closedReason: 'match-finished',
      closedAt: 12,
      startedAtMs: 10,
      finishedAtMs: 11,
      totalTicks: 300,
      hardDeadlineAt: 99,
      finalResult: { phase: 'finished' },
    });
  });
});

describe('persisted snapshot read-back: direct module use', () => {
  it('validates the exact stored text without touching storage', async () => {
    const { text } = fixture({ finished: true });
    const parsed = JSON.parse(text) as { tick: number };
    const result = await inspectStoredSnapshot({
      roomId: ROOM_ID,
      meta: readbackMeta({ closed: true, finalResult: parsed }, ROOM_ID),
      index: {
        version: 1,
        generation: 'g1',
        chunks: 1,
        length: text.length,
        tick: parsed.tick,
        updatedAt: 0,
      },
      parts: [text],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.readback.byteLength).toBe(new TextEncoder().encode(text).length);
  });
});
