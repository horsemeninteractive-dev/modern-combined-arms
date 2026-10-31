import { describe, expect, it } from 'vitest';
import { RoomMatch, type RoomSeatDefinition, type RoomSocket } from '../src/multiplayer/roomMatch';
import { TILE_SIZE } from '../src/sim/constants';
import { createTeamSnapshot, type TeamSnapshot } from '../src/multiplayer/projection';
import { SnapshotAssembler } from '../src/multiplayer/snapshotAssembler';
import { applyOk, canonicalState, newAssembler } from './phase2a4-helpers';
import { hiddenEnemyBuilding, hiddenEnemyUnit, ownUnit } from './phase1-helpers';

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

interface SeatClient {
  seat: number;
  socket: FakeSocket;
  assembler: SnapshotAssembler;
  syncs: number;
  deltas: number;
  results: Array<Record<string, unknown>>;
  lastSyncBytes: number;
  /** Every message this seat has received, for leak checks. */
  history: string[];
}

function seats(): RoomSeatDefinition[] {
  return [
    { seatId: 0, playerId: 0, team: 0, token: 'seat-zero-token-000000000000' },
    { seatId: 1, playerId: 1, team: 1, token: 'seat-one-token-0000000000000' },
  ];
}

function makeRoom(
  options: { maxDeltaChain?: number; maxSequence?: number; roomId?: string } = {},
): RoomMatch {
  return new RoomMatch({
    roomId: options.roomId ?? 'phase2a4-room',
    mode: '1v1',
    seats: seats(),
    matchDurationMs: 600_000,
    matchDeadlineAt: 1_000_000,
    now: 1000,
    // Pre-2B1 in-process fixture: this room is created already past its lobby.
    promoteOnConnect: true,
    maxDeltaChain: options.maxDeltaChain,
    maxSequence: options.maxSequence,
  });
}

function clientFor(seat: number, roomId = 'phase2a4-room'): SeatClient {
  return {
    seat,
    socket: new FakeSocket(),
    assembler: newAssembler(seat, roomId),
    syncs: 0,
    deltas: 0,
    results: [],
    lastSyncBytes: 0,
    history: [],
  };
}

function connect(room: RoomMatch, client: SeatClient, now = 1000): void {
  const seat = seats()[client.seat];
  const result = room.connect(client.seat, seat.token, client.socket, now);
  expect(result.ok).toBe(true);
  consume(client);
}

function connectBoth(room: RoomMatch): [SeatClient, SeatClient] {
  const zero = clientFor(0, room.roomId);
  const one = clientFor(1, room.roomId);
  connect(room, zero);
  connect(room, one);
  expect(room.currentPhase).toBe('playing');
  return [zero, one];
}

/** Feed this seat's new wire messages into its reducer. */
function consume(client: SeatClient): void {
  const texts = client.socket.sent.splice(0);
  client.history.push(...texts);
  for (const text of texts) {
    const message = JSON.parse(text) as Record<string, unknown>;
    if (message.type === 'sync' || message.type === 'delta') {
      if (message.type === 'sync') {
        client.syncs++;
        client.lastSyncBytes = new TextEncoder().encode(text).byteLength;
      } else {
        client.deltas++;
      }
      applyOk(client.assembler, message);
    } else if (message.type === 'result') {
      client.results.push(message);
    }
  }
}

function drain(clients: SeatClient[]): void {
  for (const client of clients) consume(client);
}

function reference(room: RoomMatch, team: number): TeamSnapshot {
  return createTeamSnapshot(
    room.game,
    team,
    room.game.state.eventSeq,
    room.currentResult,
  );
}

function expectExact(room: RoomMatch, clients: SeatClient[]): void {
  for (const client of clients) {
    const state = client.assembler.state();
    expect(state, `seat ${client.seat} has no reconstructed state`).not.toBeNull();
    expect(canonicalState(state!)).toBe(canonicalState(reference(room, client.seat)));
  }
}

function command(client: SeatClient, room: RoomMatch, body: Record<string, unknown>, now: number): void {
  room.receive(
    client.seat,
    client.socket,
    JSON.stringify({ type: 'command', v: 2, command: body }),
    now,
  );
}

function moveOwnUnit(room: RoomMatch, client: SeatClient, now: number): void {
  const unit = ownUnit(room.game, client.seat);
  command(
    client,
    room,
    { type: 'move', ids: [unit.id], x: unit.x + TILE_SIZE * 2, z: unit.z + TILE_SIZE },
    now,
  );
}

describe('Phase 2A.4 room sync/delta transport', () => {
  it('sends the immutable map once and then only dynamic deltas', () => {
    const room = makeRoom();
    const [zero, one] = connectBoth(room);
    expect(zero.syncs).toBe(1);
    expect(one.syncs).toBe(1);
    const initialSync = zero.lastSyncBytes;
    const initialState = zero.assembler.state()!;
    expect(initialState.map.terrain).toHaveLength(
      initialState.map.width * initialState.map.height,
    );

    let now = 1000;
    for (let step = 0; step < 40; step++) {
      now += 50;
      room.tick(now);
    }
    const stream = zero.socket.sent.slice();
    const received = stream.map((text) => JSON.parse(text) as Record<string, unknown>);
    consume(zero);
    consume(one);

    const syncsToZero = received.filter((message) => message.type === 'sync');
    expect(syncsToZero).toHaveLength(0);
    expect(received.filter((message) => message.type === 'delta').length).toBeGreaterThan(0);
    expect(zero.deltas).toBe(received.length);
    const deltaBytes = stream.map((text) => new TextEncoder().encode(text).byteLength);
    expect(Math.max(...deltaBytes, 0)).toBeLessThan(initialSync / 3);
    for (const text of stream) {
      expect(text).not.toContain('"map"');
      expect(text).not.toContain('"terrain"');
      expect(text).not.toContain('"elevation"');
      expect(text).not.toContain('"ore"');
    }
    expectExact(room, [zero, one]);
  });

  it('reconstructs both seats exactly through movement, combat and ticks', () => {
    const room = makeRoom();
    const [zero, one] = connectBoth(room);
    let now = 1000;
    for (let step = 0; step < 120; step++) {
      now += 50;
      if (step % 20 === 0) {
        moveOwnUnit(room, zero, now);
        moveOwnUnit(room, one, now);
      }
      room.tick(now);
      drain([zero, one]);
      if (room.game.state.tick % 2 === 0) expectExact(room, [zero, one]);
    }
    expect(zero.assembler.epoch).toBe(1);
    expect(zero.deltas).toBeGreaterThan(50);
    expectExact(room, [zero, one]);
  });

  it('never serialises hidden enemies, opposing economy, scenario or AI state', () => {
    const room = makeRoom();
    const hiddenOneUnit = hiddenEnemyUnit(room.game, 0);
    const hiddenOneBuilding = hiddenEnemyBuilding(room.game, 0);
    const hiddenZeroUnit = hiddenEnemyUnit(room.game, 1);
    const playerZero = room.game.player(0)!;
    const playerOne = room.game.player(1)!;
    playerZero.name = 'ZERO-SECRET';
    playerZero.mats = 666_666;
    playerZero.req = 666_667;
    playerOne.name = 'ONE-SECRET';
    playerOne.mats = 777_777;
    playerOne.req = 777_778;
    const projectile = (
      id: number,
      owner: number,
      shooterId: number,
      weaponId: string,
      x: number,
      z: number,
    ) => ({
      id,
      owner,
      shooterId,
      weaponId,
      x,
      y: 0,
      z,
      tx: x,
      ty: 0,
      tz: z,
      targetId: 0,
      speed: 1,
      splash: 0,
      kind: 'shell' as const,
      homing: false,
      damage: 1,
      armourMul: {},
      suppression: 0,
      seed: 1,
    });
    room.game.state.projectiles.push(
      projectile(987_656, 1, hiddenOneUnit.id, 'secret-one', hiddenOneUnit.x, hiddenOneUnit.z),
      projectile(987_657, 0, hiddenZeroUnit.id, 'secret-zero', hiddenZeroUnit.x, hiddenZeroUnit.z),
    );

    const [zero, one] = connectBoth(room);
    let now = 1000;
    for (let step = 0; step < 20; step++) {
      now += 50;
      room.tick(now);
    }
    drain([zero, one]);

    const zeroText = zero.history.join('\n');
    const oneText = one.history.join('\n');
    for (const secret of ['ONE-SECRET', '777777', '777778', '987656', 'secret-one']) {
      expect(zeroText).not.toContain(secret);
    }
    for (const secret of ['ZERO-SECRET', '666666', '666667', '987657', 'secret-zero']) {
      expect(oneText).not.toContain(secret);
    }

    // Neither seat reconstructs an entity or projectile it cannot see.
    const zeroState = zero.assembler.state()!;
    const oneState = one.assembler.state()!;
    expect(zeroState.entities.some((entity) => entity.id === hiddenOneUnit.id)).toBe(false);
    expect(zeroState.entities.some((entity) => entity.id === hiddenOneBuilding.id)).toBe(false);
    expect(zeroState.projectiles.some((entry) => entry.id === 987_656)).toBe(false);
    expect(oneState.entities.some((entity) => entity.id === hiddenZeroUnit.id)).toBe(false);
    expect(oneState.projectiles.some((entry) => entry.id === 987_657)).toBe(false);
    for (const state of [zeroState, oneState]) {
      for (const entity of state.entities) {
        if (entity.team !== state.team && !entity.remembered) {
          expect(room.game.isVisibleTo(state.team, entity.id)).toBe(true);
        }
      }
      for (const row of state.players) expect(row.team).toBe(state.team);
    }

    // Every message in the stream remains a plain sync/delta/control message:
    // raw GameState, scenario or AI state never appears as a top-level key.
    for (const text of [...zero.history, ...one.history]) {
      const message = JSON.parse(text) as Record<string, unknown>;
      expect(message).not.toHaveProperty('scenario');
      expect(message).not.toHaveProperty('game');
      if (message.type === 'sync') {
        expect(message.state).not.toHaveProperty('scenario');
        expect(message.state).not.toHaveProperty('ai');
      }
      if (message.type === 'delta') {
        expect(message.changes).not.toHaveProperty('scenario');
        expect(message.changes).not.toHaveProperty('ai');
      }
    }
    expectExact(room, [zero, one]);
  });

  it('establishes a fresh baseline and exact state on reconnect', () => {
    const room = makeRoom();
    const [zero, one] = connectBoth(room);
    let now = 1000;
    for (let step = 0; step < 40; step++) {
      now += 50;
      moveOwnUnit(room, zero, now);
      room.tick(now);
    }
    drain([zero, one]);
    const oldEpoch = zero.assembler.epoch;
    const oldSeq = zero.assembler.seq;

    room.disconnect(0, zero.socket, now);
    const replacement = new FakeSocket();
    expect(room.connect(0, seats()[0].token, replacement, now + 100).ok).toBe(true);

    const messages = replacement.messages();
    const hello = messages.find((message) => message.type === 'hello');
    const sync = messages.find((message) => message.type === 'sync');
    expect(hello).toBeDefined();
    expect(sync).toMatchObject({ type: 'sync', checkpoint: false, team: 0 });
    expect((sync?.epoch as number) > oldEpoch).toBe(true);
    expect(sync?.seq).not.toBe(oldSeq);

    const replacementClient: SeatClient = {
      seat: 0,
      socket: replacement,
      assembler: newAssembler(0),
      syncs: 0,
      deltas: 0,
      results: [],
      lastSyncBytes: 0,
      history: [],
    };
    consume(replacementClient);
    expectExact(room, [replacementClient, one]);

    for (let step = 0; step < 20; step++) {
      now += 50;
      room.tick(now);
    }
    drain([replacementClient, one]);
    expectExact(room, [replacementClient, one]);
  });

  it('recovers after a dropped update only through a validated resync', () => {
    const room = makeRoom();
    const [zero, one] = connectBoth(room);
    expect(zero.assembler.seq).toBe(1);
    room.tick(1050);
    room.tick(1100);
    consume(zero);
    const seqAfterFirst = zero.assembler.seq;
    expect(seqAfterFirst).toBe(2);

    // Produce seq 3 and drop it, then produce seq 4 against base 3. The client
    // must not apply seq 4 to its seq 2 baseline.
    room.tick(1150);
    room.tick(1200);
    zero.socket.sent.splice(0);
    room.tick(1250);
    room.tick(1300);
    const following = JSON.parse(zero.socket.sent.splice(0)[0]) as Record<string, unknown>;
    expect(following).toMatchObject({ type: 'delta', seq: 4, base: 3 });
    expect(zero.assembler.apply(following)).toMatchObject({
      ok: false,
      reason: 'base-mismatch',
      needsResync: true,
    });
    expect(zero.assembler.seq).toBe(seqAfterFirst);

    room.receive(0, zero.socket, JSON.stringify({ type: 'resync', v: 2 }), 1400);
    const resync = zero.socket.messages().find((message) => message.type === 'sync');
    expect(resync).toMatchObject({ type: 'sync', checkpoint: true, team: 0 });
    drain([zero, one]);
    expectExact(room, [zero, one]);

    room.receive(0, zero.socket, JSON.stringify({ type: 'resync', v: 2 }), 1500);
    const limited = zero.socket.messages().find((message) => message.type === 'error');
    expect(limited).toMatchObject({ code: 'resync-rate-limited' });
    consume(zero);
  });

  it('forces a bounded checkpoint after the delta-chain limit', () => {
    const room = makeRoom({ maxDeltaChain: 3 });
    const [zero, one] = connectBoth(room);
    let now = 1000;
    let checkpoints = 0;
    for (let step = 0; step < 8; step++) {
      now += 50;
      room.tick(now);
      for (const message of zero.socket.messages()) {
        if (message.type === 'sync' && message.checkpoint === true) checkpoints++;
      }
      drain([zero, one]);
      if (room.game.state.tick % 2 === 0) expectExact(room, [zero, one]);
    }
    expect(checkpoints).toBe(1);
    expect(zero.assembler.epoch).toBe(2);
    expect(zero.deltas).toBe(3);

    const checkpointMessage = zero.history
      .map((text) => JSON.parse(text) as Record<string, unknown>)
      .find((message) => message.type === 'sync' && message.checkpoint === true);
    expect(checkpointMessage).toBeDefined();
    expect((checkpointMessage!.state as Record<string, unknown>).map).toBeUndefined();
    expect(zero.assembler.state()?.map.terrain.length).toBeGreaterThan(0);
  });

  it('rejects a map-less checkpoint without a verified static baseline', () => {
    const room = makeRoom();
    const [zero] = connectBoth(room);
    const baseline = zero.assembler.state()!;
    const { map: _map, ...dynamic } = baseline;
    const mapLess = {
      type: 'sync' as const,
      v: 2 as const,
      roomId: room.roomId,
      epoch: 2,
      seq: 2,
      tick: baseline.tick,
      team: 0,
      checkpoint: true,
      state: { ...dynamic, tick: baseline.tick },
    };
    expect(new SnapshotAssembler({ roomId: room.roomId, team: 0 }).apply(mapLess)).toMatchObject({
      ok: false,
      reason: 'not-ready',
      needsResync: true,
    });
    // The connected recipient already has the map and can apply the checkpoint.
    expect(zero.assembler.apply(mapLess)).toMatchObject({ ok: true, kind: 'sync' });
    expect(zero.assembler.state()?.map).toEqual(baseline.map);
  });

  it('forces a new sync generation when the per-seat sequence would wrap', () => {
    const room = makeRoom({ maxSequence: 3 });
    const [zero, one] = connectBoth(room);
    let now = 1000;
    for (let step = 0; step < 6; step++) {
      now += 50;
      room.tick(now);
      drain([zero, one]);
      if (room.game.state.tick % 2 === 0) expectExact(room, [zero, one]);
    }
    expect(zero.assembler.epoch).toBe(2);
    expect(zero.syncs).toBe(2);
    expect(zero.assembler.seq).toBe(1);
    expect(zero.deltas).toBe(2);
  });

  it('delivers the final result to both seats after a final team checkpoint', () => {
    const room = makeRoom();
    const [zero, one] = connectBoth(room);
    room.tick(1050);
    drain([zero, one]);
    room.finishAtDeadline(1100);
    drain([zero, one]);

    expect(zero.results).toHaveLength(1);
    expect(one.results).toHaveLength(1);
    const zeroResult = zero.results[0];
    const oneResult = one.results[0];
    const winner = (zeroResult.result as { winnerTeam: number | null }).winnerTeam;
    expect(zeroResult.outcome).toBe(
      winner === null ? 'draw' : winner === 0 ? 'victory' : 'defeat',
    );
    expect(oneResult.outcome).toBe(
      winner === null ? 'draw' : winner === 1 ? 'victory' : 'defeat',
    );
    const zeroTeams = (zeroResult.result as { teams: Array<{ team: number; score: number | null }> })
      .teams;
    const oneTeams = (oneResult.result as { teams: Array<{ team: number; score: number | null }> })
      .teams;
    expect(zeroTeams.find((team) => team.team === 1)?.score).toBeNull();
    expect(oneTeams.find((team) => team.team === 0)?.score).toBeNull();
    expect(zero.socket.closed).toMatchObject({ code: 1000, reason: 'match-finished' });
    expect(one.socket.closed).toMatchObject({ code: 1000, reason: 'match-finished' });
    expectExact(room, [zero, one]);
  });
});
