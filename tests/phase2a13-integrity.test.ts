import { describe, expect, it } from 'vitest';
import {
  createRoomSnapshot,
  restoreRoomSnapshot,
  RoomSnapshotError,
  validateRoomSnapshot,
} from '../src/multiplayer/roomSnapshot';
import {
  RoomMatch,
  restoreRoomMatch,
  type RoomSeatDefinition,
  type RoomSocket,
} from '../src/multiplayer/roomMatch';
import { TILE_SIZE } from '../src/sim/constants';
import type { Game } from '../src/sim/game';
import { ownUnit, serverGame, twoSeats } from './phase1-helpers';

const STARTED_AT = Date.UTC(2026, 9, 30, 22, 0, 0);

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
}

function seats(): RoomSeatDefinition[] {
  return [
    { seatId: 0, playerId: 0, team: 0, token: 'seat-zero-token-000000000000' },
    { seatId: 1, playerId: 1, team: 1, token: 'seat-one-token-0000000000000' },
  ];
}

function makeRoom(): RoomMatch {
  return new RoomMatch({
    roomId: 'phase2a13-room',
    mode: '1v1',
    seats: seats(),
    matchDurationMs: 600_000,
    matchDeadlineAt: 601_000,
    now: 1000,
    // Pre-2B1 in-process fixture: this room is created already past its lobby.
    promoteOnConnect: true,
  });
}

function connectBoth(room: RoomMatch): { zero: FakeSocket; one: FakeSocket } {
  const zero = new FakeSocket();
  const one = new FakeSocket();
  expect(room.connect(0, seats()[0].token, zero, 1000).ok).toBe(true);
  expect(room.connect(1, seats()[1].token, one, 1000).ok).toBe(true);
  expect(room.currentPhase).toBe('playing');
  return { zero, one };
}

function snapshotSeats() {
  return twoSeats().map((seat) => ({
    seatId: seat.seatId,
    playerId: seat.playerId,
    team: seat.team,
    connected: true,
    abandoned: false,
    everConnected: true,
    disconnectedAt: null,
    epoch: 3,
    seq: 42,
  }));
}

function snapshotFor(game: Game, now = STARTED_AT + 30_000) {
  return createRoomSnapshot(game, {
    roomId: 'phase2a13-snapshot',
    seats: snapshotSeats(),
    timing: { startedAtMs: STARTED_AT, finishedAtMs: null },
    now,
  });
}

function assertSnapshotRestores(game: Game): void {
  const raw = JSON.parse(JSON.stringify(snapshotFor(game))) as unknown;
  expect(() => validateRoomSnapshot(raw)).not.toThrow();
  const restored = restoreRoomSnapshot(raw);
  expect(restored.stateHash()).toBe(game.stateHash());
}

function duel(): { game: Game; attacker: ReturnType<typeof ownUnit>; victim: ReturnType<typeof ownUnit> } {
  const game = serverGame();
  const attacker = ownUnit(game, 0, 'tank');
  const victim = ownUnit(game, 1, 'tank');
  // Keep the pair out of weapon range so auto-engagement cannot re-populate
  // presentation aim during the command tick.
  attacker.x = 26 * TILE_SIZE;
  attacker.z = 38 * TILE_SIZE;
  victim.x = 74 * TILE_SIZE;
  victim.z = 30 * TILE_SIZE;
  attacker.order = null;
  attacker.path = [];
  attacker.targetId = 0;
  attacker.aimTargetId = 0;
  victim.order = null;
  victim.path = [];
  return { game, attacker, victim };
}

function directAttack(game: Game, attacker: ReturnType<typeof ownUnit>, victim: ReturnType<typeof ownUnit>): void {
  game.enqueueCommand({ type: 'attack', team: 0, ids: [attacker.id], targetId: victim.id });
  game.advance(1);
}

describe('Phase 2A.13 target-reference integrity', () => {
  it('clears a direct target when a move order replaces a combat order', () => {
    const { game, attacker, victim } = duel();
    directAttack(game, attacker, victim);
    expect(attacker.order).toMatchObject({ type: 'attack', targetId: victim.id });
    expect(attacker.targetId).toBe(victim.id);
    expect(attacker.aimTargetId).toBe(victim.id);

    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [attacker.id],
      x: attacker.x + TILE_SIZE * 2,
      z: attacker.z,
    });
    game.advance(1);

    expect(attacker.targetId).toBe(0);
    expect(attacker.aimTargetId).toBe(0);
    expect(attacker.order?.targetId).toBeUndefined();
    expect(attacker.order?.type).toBe('move');
  });

  it('clears a direct target when an attack-move order replaces a combat order', () => {
    const { game, attacker, victim } = duel();
    directAttack(game, attacker, victim);

    game.enqueueCommand({
      type: 'move',
      attackMove: true,
      team: 0,
      ids: [attacker.id],
      x: attacker.x + TILE_SIZE * 2,
      z: attacker.z,
    });
    game.advance(1);

    expect(attacker.targetId).toBe(0);
    expect(attacker.aimTargetId).toBe(0);
    expect(attacker.order?.targetId).toBeUndefined();
    expect(attacker.order?.type).toBe('attackMove');
  });

  it('keeps a direct attack order and its target functional', () => {
    const { game, attacker, victim } = duel();
    directAttack(game, attacker, victim);

    expect(attacker.targetId).toBe(victim.id);
    expect(attacker.aimTargetId).toBe(victim.id);
    expect(attacker.order).toMatchObject({ type: 'attack', targetId: victim.id });
    expect(game.state.events.some((event) => event.type === 'orderAck' && event.code === 'attackOrder')).toBe(
      true,
    );
  });

  it('clears a stale direct target after target removal under a move order', () => {
    const { game, attacker, victim } = duel();
    attacker.order = { type: 'move', x: attacker.x + TILE_SIZE * 2, z: attacker.z };
    attacker.targetId = victim.id;
    attacker.aimTargetId = victim.id;
    victim.hp = 0;

    game.advance(1);

    expect(game.getEntity(victim.id)).toBeUndefined();
    expect(attacker.targetId).toBe(0);
    expect(attacker.aimTargetId).toBe(0);
  });

  it('clears a stale direct target after target removal under an attack-move order', () => {
    const { game, attacker, victim } = duel();
    attacker.order = { type: 'attackMove', x: attacker.x + TILE_SIZE * 2, z: attacker.z };
    attacker.targetId = victim.id;
    attacker.aimTargetId = victim.id;
    victim.hp = 0;

    game.advance(1);

    expect(game.getEntity(victim.id)).toBeUndefined();
    expect(attacker.targetId).toBe(0);
    expect(attacker.aimTargetId).toBe(0);
    expect(attacker.order?.targetId).toBeUndefined();
  });

  it('clears the direct attack order and target when the target is destroyed', () => {
    const { game, attacker, victim } = duel();
    directAttack(game, attacker, victim);
    victim.hp = 0;

    game.advance(1);

    expect(game.getEntity(victim.id)).toBeUndefined();
    expect(attacker.order).toBeNull();
    expect(attacker.targetId).toBe(0);
    expect(attacker.aimTargetId).toBe(0);
  });

  it('does not leave any target reference behind when an order is replaced', () => {
    const { game, attacker, victim } = duel();
    directAttack(game, attacker, victim);

    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [attacker.id],
      x: attacker.x + TILE_SIZE * 2,
      z: attacker.z,
    });
    game.advance(1);

    expect(attacker.order?.type).toBe('move');
    expect(attacker.order?.targetId).toBeUndefined();
    expect(attacker.targetId).toBe(0);
    expect(attacker.aimTargetId).toBe(0);
  });

  it('serialises and restores a snapshot after move-order replacement', () => {
    const { game, attacker, victim } = duel();
    directAttack(game, attacker, victim);
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [attacker.id],
      x: attacker.x + TILE_SIZE * 2,
      z: attacker.z,
    });
    game.advance(1);

    assertSnapshotRestores(game);
  });

  it('reproduces the Phase 2A.12 failure sequence and restores the resulting room', () => {
    const { game, attacker, victim } = duel();
    directAttack(game, attacker, victim);
    // The target is removed in the same authoritative tick in which the player
    // replaces the attack with a move. Before the fix the direct targetId
    // survived order replacement and the checkpoint failed strict validation.
    victim.hp = 0;
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [attacker.id],
      x: attacker.x + TILE_SIZE * 2,
      z: attacker.z,
    });
    game.advance(1);

    expect(game.getEntity(victim.id)).toBeUndefined();
    expect(attacker.targetId).toBe(0);
    assertSnapshotRestores(game);
  });

  it('still rejects the stale reference the fix removes', () => {
    const { game, attacker, victim } = duel();
    directAttack(game, attacker, victim);
    victim.hp = 0;
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [attacker.id],
      x: attacker.x + TILE_SIZE * 2,
      z: attacker.z,
    });
    game.advance(1);

    const stale = JSON.parse(JSON.stringify(snapshotFor(game))) as {
      simulation: { state: { entities: Array<{ id: number; targetId: number }> } };
    };
    const savedAttacker = stale.simulation.state.entities.find((entity) => entity.id === attacker.id);
    expect(savedAttacker).toBeDefined();
    savedAttacker!.targetId = victim.id;

    try {
      validateRoomSnapshot(stale);
      throw new Error('Expected the old stale reference to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(RoomSnapshotError);
      expect((error as RoomSnapshotError).code).toBe('invalid-references');
    }
  });
});

describe('Phase 2A.13 finalisation snapshot integrity', () => {
  it('never attaches a finish time to a playing snapshot', () => {
    const room = makeRoom();
    connectBoth(room);
    room.tick(1050);
    const snapshot = room.snapshot(1100);

    expect(snapshot.result.phase).toBe('playing');
    expect(snapshot.timing.finishedAtMs).toBeNull();
    expect(() => validateRoomSnapshot(JSON.parse(JSON.stringify(snapshot)))).not.toThrow();
  });

  it('persists a valid playing checkpoint when an active room is aborted', () => {
    const room = makeRoom();
    connectBoth(room);
    room.tick(1050);
    room.fail('operator-shutdown', 30_000);

    expect(room.currentPhase).toBe('closed');
    expect(room.currentResult.phase).toBe('playing');
    const snapshot = room.snapshot(30_000);
    expect(snapshot.result.phase).toBe('playing');
    expect(snapshot.timing.finishedAtMs).toBeNull();
    expect(() => validateRoomSnapshot(JSON.parse(JSON.stringify(snapshot)))).not.toThrow();
  });

  it('keeps repeated abort finalisation idempotent and valid', () => {
    const room = makeRoom();
    connectBoth(room);
    room.tick(1050);
    room.fail('operator-shutdown', 30_000);
    const first = room.snapshot(30_000);
    room.fail('operator-shutdown', 31_000);
    const second = room.snapshot(31_000);

    expect(room.currentPhase).toBe('closed');
    expect(second.result).toEqual(first.result);
    expect(second.timing).toEqual(first.timing);
    expect(() => validateRoomSnapshot(JSON.parse(JSON.stringify(second)))).not.toThrow();
  });

  it('transitions a completed match to a coherent finished result and finish time', () => {
    const room = makeRoom();
    const { zero, one } = connectBoth(room);
    room.tick(1050);
    room.finishAtDeadline(601_000);

    expect(room.currentPhase).toBe('finished');
    expect(room.currentResult.phase).toBe('finished');
    expect(room.currentResult.reason).not.toBeNull();
    expect(room.finishedAt).toBe(601_000);
    const snapshot = room.snapshot(601_000);
    expect(snapshot.result.phase).toBe('finished');
    expect(snapshot.timing.finishedAtMs).toBe(601_000);
    expect(() => validateRoomSnapshot(JSON.parse(JSON.stringify(snapshot)))).not.toThrow();
    expect(zero.messages().filter((message) => message.type === 'result')).toHaveLength(1);
    expect(one.messages().filter((message) => message.type === 'result')).toHaveLength(1);

    // A repeated completion keeps the same result and finish instant.
    room.finishAtDeadline(601_100);
    const repeat = room.snapshot(601_100);
    expect(repeat.result).toEqual(snapshot.result);
    expect(repeat.timing).toEqual(snapshot.timing);
    expect(zero.messages().filter((message) => message.type === 'result')).toHaveLength(1);
    expect(one.messages().filter((message) => message.type === 'result')).toHaveLength(1);
  });

  it('restores a finished room with its result, lifecycle and timing intact', () => {
    const room = makeRoom();
    connectBoth(room);
    room.tick(1050);
    room.finishAtDeadline(601_000);
    const snapshot = room.snapshot(601_000);
    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot,
      now: 601_001,
      restoredAtMs: 601_001,
    });

    expect(restored.currentPhase).toBe('finished');
    expect(restored.finishedAt).toBe(601_000);
    expect(restored.currentResult).toEqual(room.currentResult);
    expect(restored.startedAt).toBe(1000);
    expect(restored.matchDeadlineAt).toBe(601_000);
  });

  it('keeps checkpoints valid when a write straddles finalisation', () => {
    const room = makeRoom();
    connectBoth(room);
    room.tick(1050);
    const before = room.snapshot(1100);
    room.fail('reservation-failure', 30_000);
    const after = room.snapshot(30_000);

    for (const snapshot of [before, after]) {
      expect(snapshot.result.phase).toBe('playing');
      expect(snapshot.timing.finishedAtMs).toBeNull();
      expect(() => validateRoomSnapshot(JSON.parse(JSON.stringify(snapshot)))).not.toThrow();
    }
  });
});

describe('Phase 2A.13 combined persistence and lifecycle regression', () => {
  it('restores a combat room with a removed target, then persists and restores its finish', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);
    const attacker = ownUnit(room.game, 0, 'tank');
    const victim = ownUnit(room.game, 1, 'tank');

    room.game.enqueueCommand({
      type: 'attack',
      team: 0,
      ids: [attacker.id],
      targetId: victim.id,
    });
    room.tick(1050);
    expect(attacker.targetId).toBe(victim.id);
    expect(attacker.order).toMatchObject({ type: 'attack', targetId: victim.id });

    victim.hp = 0;
    room.game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [attacker.id],
      x: attacker.x + TILE_SIZE * 2,
      z: attacker.z,
    });
    room.tick(1100);
    room.tick(1150);

    expect(room.game.getEntity(victim.id)).toBeUndefined();
    expect(attacker.targetId).toBe(0);

    const playing = room.snapshot(1200);
    expect(playing.result.phase).toBe('playing');
    expect(playing.timing.finishedAtMs).toBeNull();
    expect(() => validateRoomSnapshot(JSON.parse(JSON.stringify(playing)))).not.toThrow();

    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot: playing,
      now: 5000,
      restoredAtMs: 5000,
    });
    expect(restored.currentPhase).toBe('playing');
    expect(restored.game.getEntity(victim.id)).toBeUndefined();
    expect(restored.startedAt).toBe(1000);

    const replacement = new FakeSocket();
    expect(restored.connect(0, seats()[0].token, replacement, 5000).ok).toBe(true);
    expect(replacement.messages().some((message) => message.type === 'sync')).toBe(true);
    expect(zero.messages().some((message) => message.type === 'hello')).toBe(true);

    restored.finishAtDeadline(601_000);
    const finished = restored.snapshot(601_000);
    expect(finished.result.phase).toBe('finished');
    expect(finished.timing.finishedAtMs).toBe(601_000);
    expect(() => validateRoomSnapshot(JSON.parse(JSON.stringify(finished)))).not.toThrow();

    const finalRoom = restoreRoomMatch({
      roomId: restored.roomId,
      seats: seats(),
      matchDurationMs: restored.matchDurationMs,
      matchDeadlineAt: restored.matchDeadlineAt,
      snapshot: finished,
      now: 601_001,
      restoredAtMs: 601_001,
    });
    expect(finalRoom.currentPhase).toBe('finished');
    expect(finalRoom.currentResult).toEqual(restored.currentResult);
    expect(finalRoom.finishedAt).toBe(601_000);
    expect(finalRoom.matchDeadlineAt).toBe(601_000);
  });
});
