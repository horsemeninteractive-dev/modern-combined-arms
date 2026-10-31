import {
  RoomMatch,
  restoreRoomMatch,
  type RoomSeatDefinition,
  type RoomSocket,
} from '../src/multiplayer/roomMatch';
import { TILE_SIZE } from '../src/sim/constants';
import { hiddenEnemyUnit, ownUnit } from './phase1-helpers';

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

function makeRoom(options: { abandonAfterMs?: number; now?: number } = {}): RoomMatch {
  return new RoomMatch({
    roomId: 'room-a',
    mode: '1v1',
    seats: seats(),
    matchDurationMs: 120_000,
    matchDeadlineAt: 1_000_000,
    now: options.now ?? 1000,
    // Pre-2B1 in-process fixture: this room is created already past its lobby.
    promoteOnConnect: true,
    abandonAfterMs: options.abandonAfterMs,
  });
}

function command(body: Record<string, unknown>): string {
  return JSON.stringify({ type: 'command', v: 2, command: body });
}

function last(socket: FakeSocket): Record<string, unknown> {
  const all = socket.messages();
  return all[all.length - 1];
}

function connectBoth(room: RoomMatch): { zero: FakeSocket; one: FakeSocket } {
  const zero = new FakeSocket();
  const one = new FakeSocket();
  expect(room.connect(0, seats()[0].token, zero, 1000).ok).toBe(true);
  expect(room.connect(1, seats()[1].token, one, 1000).ok).toBe(true);
  expect(room.currentPhase).toBe('playing');
  return { zero, one };
}

describe('Phase 2A room runtime', () => {
  it('assigns seats from the room table and never from the client message', () => {
    const room = makeRoom();
    expect(room.authorizeSeat(0, seats()[0].token).ok).toBe(true);
    expect(room.authorizeSeat(0, seats()[1].token)).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
    expect(room.authorizeSeat(2, seats()[0].token)).toMatchObject({
      ok: false,
      code: 'invalid-seat',
    });

    const { zero } = connectBoth(room);
    const unit = ownUnit(room.game, 0);
    room.receive(0, zero, command({ type: 'stop', ids: [unit.id] }), 2000);
    expect(room.game.pending).toHaveLength(1);
    // The gate stamps the server's player/team, not a client-supplied one.
    expect(room.game.pending[0]).toMatchObject({ team: 0, ids: [unit.id] });
  });

  it('rejects forged authority and cross-seat submissions before the queue', () => {
    const room = makeRoom();
    const { zero, one } = connectBoth(room);
    const unit = ownUnit(room.game, 0);

    room.receive(0, zero, command({ type: 'stop', ids: [unit.id], team: 1 }), 2000);
    expect(last(zero)).toMatchObject({ type: 'commandRejected', code: 'forbidden-field' });

    room.receive(0, zero, command({ type: 'stop', ids: [unit.id], playerId: 1 }), 2200);
    expect(last(zero)).toMatchObject({ type: 'commandRejected', code: 'forbidden-field' });

    // A socket owned by seat 1 cannot submit as seat 0, even with a valid body.
    room.receive(0, one, command({ type: 'stop', ids: [unit.id] }), 2400);
    expect(last(one)).toMatchObject({ type: 'error', code: 'seat-inactive' });
    expect(room.game.pending).toHaveLength(0);
  });

  it('keeps hidden targets and opposing projections out of every outbound payload', () => {
    const room = makeRoom();
    const { zero, one } = connectBoth(room);
    const hidden = hiddenEnemyUnit(room.game, 0);
    const attacker = ownUnit(room.game, 0, 'tank');

    room.receive(0, zero, command({ type: 'attack', ids: [attacker.id], targetId: hidden.id }), 2000);
    expect(last(zero)).toMatchObject({ type: 'commandRejected', code: 'target-hidden' });
    expect(JSON.stringify(last(zero))).not.toContain(String(hidden.id));

    const sentToZero = zero.sent.join('\n');
    const sentToOne = one.sent.join('\n');
    const enemyPlayer = room.game.player(1)!;
    enemyPlayer.name = 'SECRET OPPONENT';
    enemyPlayer.mats = 777777;
    room.tick(2100);
    room.tick(2200);

    const zeroSnapshots = zero.messages().filter((message) => message.type === 'sync');
    const oneSnapshots = one.messages().filter((message) => message.type === 'sync');
    expect(zeroSnapshots.length).toBeGreaterThan(0);
    expect(oneSnapshots.length).toBeGreaterThan(0);
    for (const sync of zeroSnapshots) {
      const state = sync.state as { team: number; players: Array<{ team: number }> };
      expect(state.team).toBe(0);
      expect(state.players.every((player) => player.team === 0)).toBe(true);
    }
    for (const sync of oneSnapshots) {
      const state = sync.state as { team: number; players: Array<{ team: number }> };
      expect(state.team).toBe(1);
      expect(state.players.every((player) => player.team === 1)).toBe(true);
    }
    expect(sentToZero).not.toContain('SECRET OPPONENT');
    expect(sentToZero).not.toContain('777777');
    expect(sentToOne).not.toContain('SECRET OPPONENT');
    expect(sentToOne).not.toContain('777777');
  });

  it('rejects duplicate sockets and supports a clean reconnect', () => {
    const room = makeRoom();
    const zero = new FakeSocket();
    expect(room.connect(0, seats()[0].token, zero, 1000).ok).toBe(true);
    expect(room.connect(0, seats()[0].token, new FakeSocket(), 1100)).toMatchObject({
      ok: false,
      code: 'seat-occupied',
    });

    room.disconnect(0, zero, 2000);
    const replacement = new FakeSocket();
    expect(room.connect(0, seats()[0].token, replacement, 3000).ok).toBe(true);
    // The old socket's late close event must not clear the replacement.
    room.disconnect(0, zero, 3100);
    expect(room.status().seats.find((seat) => seat.seatId === 0)?.connected).toBe(true);
    expect(replacement.messages().some((message) => message.type === 'hello')).toBe(true);
  });

  it('ends the match for the surviving team after abandonment grace', () => {
    const room = makeRoom({ abandonAfterMs: 500 });
    const { zero, one } = connectBoth(room);
    room.disconnect(0, zero, 2000);
    room.tick(2600);

    expect(room.currentPhase).toBe('finished');
    expect(room.currentResult).toMatchObject({
      winnerTeam: 1,
      reason: 'abandoned',
    });
    const result = one.messages().find((message) => message.type === 'result');
    expect(result).toMatchObject({ outcome: 'victory' });
    expect(zero.messages().some((message) => message.type === 'result')).toBe(false);
  });

  it('finishes at the hard deadline with a result every connected seat can interpret', () => {
    const room = new RoomMatch({
      roomId: 'deadline-room',
      mode: '1v1',
      seats: seats(),
      matchDurationMs: 10_000,
      matchDeadlineAt: 12_000,
      now: 1000,
      // Pre-2B1 fixture: this room is already past its lobby.
      promoteOnConnect: true,
    });
    const { zero, one } = connectBoth(room);
    room.finishAtDeadline(12_000);

    const zeroResult = zero.messages().find((message) => message.type === 'result');
    const oneResult = one.messages().find((message) => message.type === 'result');
    expect(zeroResult).toBeDefined();
    expect(oneResult).toBeDefined();
    expect(['victory', 'defeat', 'draw']).toContain(zeroResult?.outcome);
    expect(['victory', 'defeat', 'draw']).toContain(oneResult?.outcome);
    expect(zeroResult?.result).toMatchObject({
      phase: 'finished',
      winnerTeam: (oneResult?.result as { winnerTeam?: unknown } | undefined)?.winnerTeam,
    });
    expect(zero.closed).toMatchObject({ code: 1000, reason: 'match-finished' });
    expect(one.closed).toMatchObject({ code: 1000, reason: 'match-finished' });

    room.receive(0, zero, command({ type: 'stop', ids: [ownUnit(room.game, 0).id] }), 13_000);
    expect(zero.closed).not.toBeNull();
    expect(room.game.pending).toHaveLength(0);
  });

  it('restores a room snapshot and continues deterministically', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);
    room.tick(1100);
    room.tick(1200);
    const unit = ownUnit(room.game, 0, 'tank');
    room.receive(
      0,
      zero,
      command({ type: 'move', ids: [unit.id], x: unit.x + TILE_SIZE * 2, z: unit.z }),
      1300,
    );
    room.tick(1400);
    room.tick(1500);
    const snapshot = room.snapshot(1600);
    const restored = restoreRoomMatch({
      roomId: room.roomId,
      seats: seats(),
      matchDurationMs: room.matchDurationMs,
      matchDeadlineAt: room.matchDeadlineAt,
      snapshot,
      now: 1600,
    });

    const next = {
      type: 'move' as const,
      team: 0,
      ids: [unit.id],
      x: unit.x + TILE_SIZE * 3,
      z: unit.z + TILE_SIZE,
    };
    room.game.enqueueCommand(next);
    restored.game.enqueueCommand(next);
    for (let tick = 0; tick < 40; tick++) {
      room.tick(1700 + tick * 50);
      restored.tick(1700 + tick * 50);
    }
    expect(restored.game.stateHash()).toBe(room.game.stateHash());
  });
});
