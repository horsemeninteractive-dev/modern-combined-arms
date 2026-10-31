import { describe, expect, it } from 'vitest';
import { createTeamSnapshot } from '../src/multiplayer/projection';
import {
  LEGACY_EPOCH_FLOOR,
  RoomSnapshotError,
  validateRoomSnapshot,
  type RoomSnapshotV1,
} from '../src/multiplayer/roomSnapshot';
import {
  RESTORE_EPOCH_ADVANCE,
  RoomMatch,
  restoreRoomMatch,
  type RoomSeatDefinition,
  type RoomSocket,
} from '../src/multiplayer/roomMatch';
import { SnapshotAssembler } from '../src/multiplayer/snapshotAssembler';
import { RESYNC_MIN_INTERVAL_MS } from '../src/multiplayer/protocol';
import { validatePersistedMeta } from '../src/multiplayer/roomDurableObject';
import { applyOk, canonicalState, newAssembler } from './phase2a4-helpers';
import { ownUnit } from './phase1-helpers';
import { TILE_SIZE } from '../src/sim/constants';

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

  take(): string[] {
    return this.sent.splice(0);
  }
}

function seats(): RoomSeatDefinition[] {
  return [
    { seatId: 0, playerId: 0, team: 0, token: 'seat-zero-token-000000000000' },
    { seatId: 1, playerId: 1, team: 1, token: 'seat-one-token-0000000000000' },
  ];
}

function makeRoom(
  options: { abandonAfterMs?: number; deadlineAt?: number; durationMs?: number; now?: number } = {},
): RoomMatch {
  return new RoomMatch({
    roomId: 'phase2a11-room',
    mode: '1v1',
    seats: seats(),
    matchDurationMs: options.durationMs ?? 600_000,
    matchDeadlineAt: options.deadlineAt ?? 601_000,
    now: options.now ?? 1000,
    // Pre-2B1 in-process fixture: this room is created already past its lobby.
    promoteOnConnect: true,
    abandonAfterMs: options.abandonAfterMs,
  });
}

function command(room: RoomMatch, body: Record<string, unknown>): string {
  void room;
  return JSON.stringify({ type: 'command', v: 2, command: body });
}

function connectBoth(room: RoomMatch, now = 1000): { zero: FakeSocket; one: FakeSocket } {
  const zero = new FakeSocket();
  const one = new FakeSocket();
  expect(room.connect(0, seats()[0].token, zero, now).ok).toBe(true);
  expect(room.connect(1, seats()[1].token, one, now).ok).toBe(true);
  expect(room.currentPhase).toBe('playing');
  return { zero, one };
}

function clientFrom(socket: FakeSocket, roomId: string, team: number): SnapshotAssembler {
  const assembler = newAssembler(team, roomId);
  for (const message of socket.messages()) {
    if (message.type === 'sync' || message.type === 'delta') applyOk(assembler, message);
  }
  return assembler;
}

function reference(room: RoomMatch, team: number) {
  return createTeamSnapshot(
    room.game,
    team,
    room.game.state.eventSeq,
    room.currentResult,
  );
}

function expectRejected(raw: unknown, code: string): void {
  try {
    validateRoomSnapshot(raw);
    throw new Error('Expected snapshot validation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(RoomSnapshotError);
    expect((error as RoomSnapshotError).code).toBe(code);
  }
}

function legacyFrom(snapshot: ReturnType<RoomMatch['snapshot']>): RoomSnapshotV1 {
  return {
    format: snapshot.format,
    version: 1,
    source: snapshot.source,
    roomId: snapshot.roomId,
    createdAt: snapshot.createdAt,
    tick: snapshot.tick,
    seats: snapshot.seats.map((seat) => ({
      seatId: seat.seatId,
      playerId: seat.playerId,
      team: seat.team,
      connected: seat.connected,
      abandoned: seat.abandoned,
    })),
    result: snapshot.result,
    simulation: snapshot.simulation,
  };
}

describe('Phase 2A.11 restart recovery', () => {
  it('restores durable epochs and timing for both occupied seats', () => {
    const room = makeRoom();
    const { zero, one } = connectBoth(room);
    room.tick(1050);
    room.receive(0, zero, JSON.stringify({ type: 'resync', v: 2 }), 1100);
    room.tick(1150);
    const before = room.status();
    const snapshot = room.snapshot(1200);

    expect(snapshot.version).toBe(2);
    expect(snapshot.timing.startedAtMs).toBe(1000);
    expect(snapshot.timing.finishedAtMs).toBeNull();
    expect(snapshot.seats.map((seat) => seat.epoch)).toEqual([2, 1]);
    expect(snapshot.seats.every((seat) => seat.everConnected)).toBe(true);

    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot,
      now: 5000,
      restoredAtMs: 5000,
      startedAtMs: before.startedAtMs,
    });

    expect(restored.startedAt).toBe(1000);
    expect(restored.matchDeadlineAt).toBe(601_000);
    expect(restored.status().startedAtDerived).toBe(false);
    expect(restored.status().tick).toBe(room.game.state.tick);
    expect(restored.status().seats.map((seat) => seat.epoch)).toEqual([
      2 + RESTORE_EPOCH_ADVANCE,
      1 + RESTORE_EPOCH_ADVANCE,
    ]);
    expect(restored.status().seats.map((seat) => seat.seq)).toEqual(
      snapshot.seats.map((seat) => seat.seq),
    );
    expect(restored.status().seats.every((seat) => !seat.connected)).toBe(true);

    // A client that preserved its pre-restart reducer accepts the first
    // restored baseline and the following delta.
    const oldClient = clientFrom(zero, room.roomId, 0);
    const epochBefore = oldClient.epoch;
    const replacement = new FakeSocket();
    expect(restored.connect(0, seats()[0].token, replacement, 5000).ok).toBe(true);
    for (const message of replacement.take()) {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      if (parsed.type === 'sync' || parsed.type === 'delta') applyOk(oldClient, parsed);
    }
    expect(oldClient.epoch).toBeGreaterThan(epochBefore);
    expect(canonicalState(oldClient.state()!)).toBe(canonicalState(reference(restored, 0)));

    let receivedUpdate = false;
    for (let step = 0; step < 4 && !receivedUpdate; step++) {
      restored.tick(5050 + step * 50);
      for (const message of replacement.take()) {
        const parsed = JSON.parse(message) as Record<string, unknown>;
        if (parsed.type === 'sync' || parsed.type === 'delta') {
          applyOk(oldClient, parsed);
          receivedUpdate = true;
        }
      }
    }
    expect(receivedUpdate).toBe(true);
    expect(canonicalState(oldClient.state()!)).toBe(canonicalState(reference(restored, 0)));

    // The old pre-restart generation cannot become authority again.
    const oldSync = zero.messages().find((message) => message.type === 'sync')!;
    expect(oldClient.apply(oldSync)).toMatchObject({
      ok: false,
      reason: 'epoch-mismatch',
    });
    const oldDelta = zero.messages().find((message) => message.type === 'delta');
    if (oldDelta) {
      expect(oldClient.apply(oldDelta)).toMatchObject({
        ok: false,
        reason: 'epoch-mismatch',
      });
    }

    const unit = ownUnit(restored.game, 0);
    restored.receive(0, zero, command(restored, { type: 'stop', ids: [unit.id] }), 5100);
    expect(restored.game.pending).toHaveLength(0);
    restored.receive(
      0,
      replacement,
      command(restored, { type: 'stop', ids: [unit.id] }),
      5200,
    );
    expect(restored.game.pending).toHaveLength(1);
    expect(one.messages().some((message) => message.type === 'hello')).toBe(true);
  });

  it('keeps duplicate and delayed pre-restart messages out of the restored stream', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);
    room.tick(1050);
    const snapshot = room.snapshot(1100);
    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot,
      now: 2000,
      restoredAtMs: 2000,
    });
    const client = newAssembler(0, room.roomId);
    const oldSync = zero.messages().find((message) => message.type === 'sync')!;
    const oldEpoch = oldSync.epoch as number;

    const replacement = new FakeSocket();
    expect(restored.connect(0, seats()[0].token, replacement, 2000).ok).toBe(true);
    const newSync = replacement.messages().find((message) => message.type === 'sync')!;
    applyOk(client, newSync);
    expect(newSync.epoch as number).toBeGreaterThan(oldEpoch);
    expect(client.apply(oldSync)).toMatchObject({ ok: false, reason: 'epoch-mismatch' });
    expect(client.apply(newSync)).toMatchObject({ ok: false, reason: 'epoch-mismatch' });

    const oldUnit = ownUnit(room.game, 0);
    restored.receive(0, zero, command(restored, { type: 'stop', ids: [oldUnit.id] }), 2100);
    expect(restored.game.pending).toHaveLength(0);
    expect(zero.messages().at(-1)).toMatchObject({
      type: 'error',
      code: 'seat-inactive',
    });
  });

  it('does not move a durable start when a waiting restore accepts its first seats', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);
    // Snapshot before the first authoritative tick: start is set, tick is 0.
    const snapshot = room.snapshot(1000);
    expect(snapshot.timing.startedAtMs).toBe(1000);
    expect(snapshot.tick).toBe(0);
    void zero;
    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot,
      phase: 'waiting',
      promoteOnConnect: true,
      now: 5000,
      restoredAtMs: 5000,
    });
    expect(restored.startedAt).toBe(1000);
    const replacement = new FakeSocket();
    const secondReplacement = new FakeSocket();
    expect(restored.connect(0, seats()[0].token, replacement, 5000).ok).toBe(true);
    expect(restored.connect(1, seats()[1].token, secondReplacement, 5001).ok).toBe(true);
    expect(restored.currentPhase).toBe('playing');
    expect(restored.startedAt).toBe(1000);
  });

  it('preserves the original deadline and finishes correctly when restored near it', () => {
    const room = makeRoom({ durationMs: 10_000, deadlineAt: 11_000 });
    const { zero, one } = connectBoth(room);
    room.tick(1050);
    const snapshot = room.snapshot(1100);
    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot,
      now: 10_990,
      restoredAtMs: 10_990,
    });
    expect(restored.startedAt).toBe(1000);
    expect(restored.matchDeadlineAt).toBe(11_000);

    restored.tick(10_999);
    expect(restored.currentPhase).toBe('playing');
    restored.tick(11_000);
    expect(restored.currentPhase).toBe('finished');
    expect(restored.finishedAt).toBe(11_000);
    expect(restored.currentResult.phase).toBe('finished');
    expect(['time-limit', 'draw']).toContain(restored.currentResult.reason);
    expect(zero.messages().some((message) => message.type === 'result')).toBe(false);
    expect(one.messages().some((message) => message.type === 'result')).toBe(false);
  });

  it('uses the durable disconnect timestamp for the abandonment grace period', () => {
    const room = makeRoom({ abandonAfterMs: 500, deadlineAt: 601_000 });
    const { zero } = connectBoth(room);
    room.tick(1100);
    room.disconnect(0, zero, 1500);
    room.tick(1600);
    const snapshot = room.snapshot(1600);
    expect(snapshot.seats[0].disconnectedAt).toBe(1500);

    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot,
      now: 1800,
      restoredAtMs: 1800,
      abandonAfterMs: 500,
    });
    restored.tick(1900);
    expect(restored.currentPhase).toBe('playing');
    restored.tick(2000);
    expect(restored.currentPhase).toBe('finished');
    expect(restored.currentResult.reason).toBe('abandoned');
  });

  it('advances the generation again on a repeated restart without resetting timing', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);
    room.tick(1050);
    const firstSnapshot = room.snapshot(1100);
    const firstRestore = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot: firstSnapshot,
      now: 2000,
      restoredAtMs: 2000,
    });
    const firstEpoch = firstRestore.status().seats[0].epoch;
    const secondSnapshot = firstRestore.snapshot(2100);
    const secondRestore = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot: secondSnapshot,
      now: 3000,
      restoredAtMs: 3000,
    });
    expect(secondRestore.startedAt).toBe(1000);
    expect(secondRestore.status().seats[0].epoch).toBeGreaterThan(firstEpoch);
    expect(secondRestore.status().startedAtDerived).toBe(false);
    // The old client's stream from before the first restart is still rejected.
    const oldSync = zero.messages().find((message) => message.type === 'sync')!;
    const client = newAssembler(0, room.roomId);
    const replacement = new FakeSocket();
    secondRestore.connect(0, seats()[0].token, replacement, 3000);
    const currentSync = replacement.messages().find((message) => message.type === 'sync')!;
    applyOk(client, currentSync);
    expect(client.apply(oldSync)).toMatchObject({ ok: false, reason: 'epoch-mismatch' });
  });

  it('migrates a version 1 snapshot with a safe epoch generation and derives timing', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);
    room.tick(1050);
    room.receive(0, zero, JSON.stringify({ type: 'resync', v: 2 }), 1100);
    const snapshot = room.snapshot(1200);
    const legacy = legacyFrom(snapshot);

    const migrated = validateRoomSnapshot(legacy, {
      matchDeadlineAt: room.matchDeadlineAt,
      matchDurationMs: room.matchDurationMs,
    });
    expect(migrated.version).toBe(2);
    expect(migrated.timing.startedAtMs).toBeNull();
    expect(migrated.seats[0].epoch).toBe(LEGACY_EPOCH_FLOOR);
    expect(migrated.seats[1].epoch).toBe(LEGACY_EPOCH_FLOOR);
    expect(migrated.seats.every((seat) => seat.everConnected)).toBe(true);

    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot: legacy,
      now: 5000,
      restoredAtMs: 5000,
    });
    expect(restored.startedAt).toBe(1000);
    expect(restored.status().startedAtDerived).toBe(true);
    expect(restored.status().seats[0].epoch).toBe(
      LEGACY_EPOCH_FLOOR + RESTORE_EPOCH_ADVANCE,
    );
    expect(restored.game.state.tick).toBe(room.game.state.tick);

    // The migrated room writes the new schema on the next checkpoint.
    expect(restored.snapshot(5100).version).toBe(2);
  });

  it('rejects missing, malformed and regressing recovery fields', () => {
    const room = makeRoom();
    connectBoth(room);
    room.tick(1050);
    const snapshot = room.snapshot(1100);

    const missingTiming = JSON.parse(JSON.stringify(snapshot));
    delete missingTiming.timing;
    expectRejected(missingTiming, 'invalid-timing');

    const missingEpoch = JSON.parse(JSON.stringify(snapshot));
    missingEpoch.seats[0].epoch = 0;
    expectRejected(missingEpoch, 'invalid-seats');

    const negativeEpoch = JSON.parse(JSON.stringify(snapshot));
    negativeEpoch.seats[0].epoch = -1;
    expectRejected(negativeEpoch, 'invalid-seats');

    const zeroSequence = JSON.parse(JSON.stringify(snapshot));
    zeroSequence.seats[0].seq = 0;
    expectRejected(zeroSequence, 'invalid-seats');

    const impossibleDisconnect = JSON.parse(JSON.stringify(snapshot));
    impossibleDisconnect.seats[0].disconnectedAt = 1000;
    expectRejected(impossibleDisconnect, 'invalid-seats');

    const futureFinish = JSON.parse(JSON.stringify(snapshot));
    futureFinish.timing.finishedAtMs = 1200;
    expectRejected(futureFinish, 'invalid-timing');

    const badFinish = JSON.parse(JSON.stringify(snapshot));
    badFinish.result.phase = 'finished';
    badFinish.timing.finishedAtMs = 900;
    expectRejected(badFinish, 'invalid-timing');

    const unsupported = JSON.parse(JSON.stringify(snapshot));
    unsupported.version = 3;
    expectRejected(unsupported, 'unsupported-version');
  });

  it('recovers both seats into the same authoritative state', () => {
    const room = makeRoom();
    const { zero, one } = connectBoth(room);
    room.tick(1050);
    room.tick(1100);
    const snapshot = room.snapshot(1150);
    const oldZero = clientFrom(zero, room.roomId, 0);
    const oldOne = clientFrom(one, room.roomId, 1);
    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot,
      now: 5000,
      restoredAtMs: 5000,
    });
    const nextZero = new FakeSocket();
    const nextOne = new FakeSocket();
    expect(restored.connect(0, seats()[0].token, nextZero, 5000).ok).toBe(true);
    expect(restored.connect(1, seats()[1].token, nextOne, 5000).ok).toBe(true);
    for (const [socket, client] of [
      [nextZero, oldZero],
      [nextOne, oldOne],
    ] as const) {
      for (const message of socket.take()) {
        const parsed = JSON.parse(message) as Record<string, unknown>;
        if (parsed.type === 'sync' || parsed.type === 'delta') applyOk(client, parsed);
      }
    }
    expect(canonicalState(oldZero.state()!)).toBe(canonicalState(reference(restored, 0)));
    expect(canonicalState(oldOne.state()!)).toBe(canonicalState(reference(restored, 1)));

    const unitZero = ownUnit(restored.game, 0);
    const unitOne = ownUnit(restored.game, 1);
    restored.receive(0, nextZero, command(restored, { type: 'stop', ids: [unitZero.id] }), 5200);
    restored.receive(1, nextOne, command(restored, { type: 'stop', ids: [unitOne.id] }), 5200);
    expect(restored.game.pending).toHaveLength(2);
    expect(restored.status().seats.map((seat) => seat.connected)).toEqual([true, true]);
  });

  it('delivers one final result to each restored seat at the original deadline', () => {
    const room = makeRoom({ durationMs: 10_000, deadlineAt: 11_000 });
    connectBoth(room);
    room.tick(1050);
    const snapshot = room.snapshot(1100);
    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot,
      now: 10_990,
      restoredAtMs: 10_990,
    });
    const zero = new FakeSocket();
    const one = new FakeSocket();
    restored.connect(0, seats()[0].token, zero, 10_990);
    restored.connect(1, seats()[1].token, one, 10_990);
    expect(restored.currentPhase).toBe('playing');
    expect(restored.matchDeadlineAt).toBe(11_000);

    restored.tick(11_000);
    expect(restored.currentPhase).toBe('finished');
    expect(restored.finishedAt).toBe(11_000);
    const resultsZero = zero.messages().filter((message) => message.type === 'result');
    const resultsOne = one.messages().filter((message) => message.type === 'result');
    expect(resultsZero).toHaveLength(1);
    expect(resultsOne).toHaveLength(1);
    const resultZero = resultsZero[0] as { outcome: string; result: Record<string, unknown> };
    const resultOne = resultsOne[0] as { outcome: string; result: Record<string, unknown> };
    expect(resultZero.result.winnerTeam).toBe(resultOne.result.winnerTeam);
    expect(resultZero.result.reason).toBe(resultOne.result.reason);
    expect(resultZero.result.tick).toBe(resultOne.result.tick);
    expect(resultZero.outcome).toBe(resultOne.outcome);
    expect(resultZero.outcome).toBe('draw');
    expect(zero.closed?.code).toBe(1000);
    expect(one.closed?.code).toBe(1000);

    // A second deadline path or completion call cannot duplicate the result.
    restored.tick(11_050);
    expect(zero.messages().filter((message) => message.type === 'result')).toHaveLength(1);
    expect(one.messages().filter((message) => message.type === 'result')).toHaveLength(1);
  });

  it('allows the first legitimate resync after recovery and then rate-limits it', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);
    room.tick(1050);
    const snapshot = room.snapshot(1100);
    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot,
      now: 4000,
      restoredAtMs: 4000,
    });
    const client = clientFrom(zero, room.roomId, 0);
    const replacement = new FakeSocket();
    restored.connect(0, seats()[0].token, replacement, 4000);
    for (const message of replacement.take()) {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      if (parsed.type === 'sync' || parsed.type === 'delta') applyOk(client, parsed);
    }
    const beforeEpoch = client.epoch;
    restored.receive(0, replacement, JSON.stringify({ type: 'resync', v: 2 }), 4100);
    for (const message of replacement.take()) {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      if (parsed.type === 'sync' || parsed.type === 'delta') applyOk(client, parsed);
    }
    expect(client.epoch).toBeGreaterThan(beforeEpoch);
    restored.receive(0, replacement, JSON.stringify({ type: 'resync', v: 2 }), 4101);
    expect(replacement.messages().at(-1)).toMatchObject({
      type: 'error',
      code: 'resync-rate-limited',
    });
    restored.receive(
      0,
      replacement,
      JSON.stringify({ type: 'resync', v: 2 }),
      4100 + RESYNC_MIN_INTERVAL_MS,
    );
    expect(
      replacement.messages().filter((message) => message.type === 'sync').length,
    ).toBe(1);
  });

  it('refuses an active seat with no durable generation and an exhausted epoch', () => {
    const room = makeRoom();
    connectBoth(room);
    room.tick(1050);
    const snapshot = room.snapshot(1100);

    const missingGeneration = JSON.parse(JSON.stringify(snapshot));
    missingGeneration.seats[1].everConnected = false;
    missingGeneration.seats[1].connected = false;
    missingGeneration.seats[1].epoch = 0;
    missingGeneration.seats[1].seq = 0;
    expect(() =>
      restoreRoomMatch({
        roomId: room.roomId,
        seats: seats(),
        matchDurationMs: room.matchDurationMs,
        matchDeadlineAt: room.matchDeadlineAt,
        snapshot: missingGeneration,
        now: 5000,
        restoredAtMs: 5000,
      }),
    ).toThrow(/no sync generation/);

    const exhausted = JSON.parse(JSON.stringify(snapshot));
    exhausted.seats[0].epoch = 0x7fffffff;
    expect(() =>
      restoreRoomMatch({
        roomId: room.roomId,
        seats: seats(),
        matchDurationMs: room.matchDurationMs,
        matchDeadlineAt: room.matchDeadlineAt,
        snapshot: exhausted,
        now: 5000,
        restoredAtMs: 5000,
      }),
    ).toThrow(/exhausted its sync generation/);
  });

  it('rejects corrupt durable room metadata before it can supply timing', () => {
    const valid = {
      version: 1,
      roomId: 'phase2a11-room',
      mode: '1v1',
      seats: [
        { seatId: 0, playerId: 0, team: 0, token: 'seat-zero-token-000000000000' },
        { seatId: 1, playerId: 1, team: 1, token: 'seat-one-token-0000000000000' },
      ],
      reservation: { status: 'active', hardDeadlineAt: 601_000 },
      createdAt: 1000,
      matchDurationMs: 600_000,
      started: true,
      startedAtMs: 1000,
      finishedAtMs: null,
      totalTicks: 20,
      closed: false,
      closedReason: null,
      closedAt: null,
      finalResult: null,
    };
    expect(validatePersistedMeta(valid, 'phase2a11-room')).toBeNull();

    expect(
      validatePersistedMeta(
        { ...valid, startedAtMs: 601_001 },
        'phase2a11-room',
      ),
    ).toMatch(/start is invalid/);
    expect(
      validatePersistedMeta(
        { ...valid, reservation: { status: 'released', hardDeadlineAt: 601_000 } },
        'phase2a11-room',
      ),
    ).toMatch(/released before closure/);
    expect(
      validatePersistedMeta(
        { ...valid, seats: [{ ...valid.seats[0], token: 'short' }, valid.seats[1]] },
        'phase2a11-room',
      ),
    ).toMatch(/seat identity/);
    expect(
      validatePersistedMeta(
        { ...valid, finishedAtMs: 999 },
        'phase2a11-room',
      ),
    ).toMatch(/finish precedes/);
    expect(
      validatePersistedMeta(
        { ...valid, totalTicks: -1 },
        'phase2a11-room',
      ),
    ).toMatch(/tick total/);
    expect(validatePersistedMeta({ ...valid, roomId: 'other-room' }, 'phase2a11-room')).toMatch(
      /identity/,
    );
  });

  it('restores an exact team view, map and fog baseline', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);
    let now = 1000;
    for (let step = 0; step < 20; step++) {
      now += 50;
      room.tick(now);
    }
    const snapshot = room.snapshot(now);
    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot,
      now: now + 5000,
      restoredAtMs: now + 5000,
    });
    const replacement = new FakeSocket();
    expect(restored.connect(0, seats()[0].token, replacement, now + 5000).ok).toBe(true);
    const client = newAssembler(0, room.roomId);
    for (const message of replacement.messages()) {
      if (message.type === 'sync' || message.type === 'delta') applyOk(client, message);
    }
    const state = client.state()!;
    expect(state.tick).toBe(restored.game.state.tick);
    expect(state.map.terrain.length).toBe(
      restored.game.state.scenario.width * restored.game.state.scenario.height,
    );
    expect(state.fog.length).toBe(state.map.width * state.map.height);
    expect(canonicalState(state)).toBe(canonicalState(reference(restored, 0)));
    expect(replacement.messages().some((message) => message.type === 'sync')).toBe(true);
    expect(zero.messages().some((message) => message.type === 'hello')).toBe(true);
    // A restored movement command still advances deterministically.
    const unit = ownUnit(restored.game, 0);
    restored.receive(
      0,
      replacement,
      command(restored, {
        type: 'move',
        ids: [unit.id],
        x: unit.x + TILE_SIZE * 2,
        z: unit.z,
      }),
      now + 5200,
    );
    restored.tick(now + 5250);
    expect(restored.game.state.tick).toBeGreaterThan(snapshot.tick);
  });
});
