import {
  createRoomSnapshot,
  restoreRoomSnapshot,
  RoomSnapshotError,
  ROOM_SNAPSHOT_FORMAT,
} from '../src/multiplayer/roomSnapshot';
import { TILE_SIZE } from '../src/sim/constants';
import { ownUnit, serverGame, twoSeats } from './phase1-helpers';

const STARTED_AT = Date.UTC(2026, 9, 29, 11, 30, 0);

function seats() {
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

function snapshotFor(game = serverGame()) {
  return createRoomSnapshot(game, {
    roomId: 'room-test',
    seats: seats(),
    timing: { startedAtMs: STARTED_AT, finishedAtMs: null },
    now: Date.UTC(2026, 9, 29, 12, 0, 0),
  });
}

function expectSnapshotError(raw: unknown, code: string) {
  try {
    restoreRoomSnapshot(raw);
    throw new Error('Expected restore to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(RoomSnapshotError);
    expect((error as RoomSnapshotError).code).toBe(code);
  }
}

describe('Phase 1 room snapshots', () => {
  it('restores a deterministic continuation', () => {
    const original = serverGame();
    original.advance(80);
    const unit = ownUnit(original, 0, 'tank');
    const snapshot = snapshotFor(original);
    const restored = restoreRoomSnapshot(JSON.parse(JSON.stringify(snapshot)));

    expect(snapshot.format).toBe(ROOM_SNAPSHOT_FORMAT);
    expect(restored.localPlayerId).toBe(-1);
    expect(restored.ai).toBeNull();
    expect(restored.stateHash()).toBe(original.stateHash());

    const command = {
      type: 'move' as const,
      team: 0,
      ids: [unit.id],
      x: unit.x + TILE_SIZE * 2,
      z: unit.z,
    };
    original.enqueueCommand(command);
    restored.enqueueCommand(command);
    original.advance(40);
    restored.advance(40);
    expect(restored.stateHash()).toBe(original.stateHash());
  });

  it('rejects an unsupported room snapshot version', () => {
    const raw = JSON.parse(JSON.stringify(snapshotFor()));
    raw.version = 3;
    expectSnapshotError(raw, 'unsupported-version');
  });

  it('rejects a client-authored or wrong-format envelope', () => {
    const client = JSON.parse(JSON.stringify(snapshotFor()));
    client.source = 'client';
    expectSnapshotError(client, 'invalid-source');

    const wrong = JSON.parse(JSON.stringify(snapshotFor()));
    wrong.format = 'iron-tide-save';
    expectSnapshotError(wrong, 'unsupported-format');
  });

  it('rejects malformed map arrays and duplicate entity ids', () => {
    const badMap = JSON.parse(JSON.stringify(snapshotFor()));
    badMap.simulation.state.map.terrain.pop();
    expectSnapshotError(badMap, 'invalid-map');

    const duplicate = JSON.parse(JSON.stringify(snapshotFor()));
    duplicate.simulation.state.entities[1].id = duplicate.simulation.state.entities[0].id;
    expectSnapshotError(duplicate, 'invalid-entities');
  });

  it('rejects unknown entity references and mismatched ticks', () => {
    const badRef = JSON.parse(JSON.stringify(snapshotFor()));
    badRef.simulation.state.entities[0].targetId = 999999;
    expectSnapshotError(badRef, 'invalid-references');

    const badTick = JSON.parse(JSON.stringify(snapshotFor()));
    badTick.tick += 1;
    expectSnapshotError(badTick, 'invalid-tick');
  });

  it('rejects malformed seat authority', () => {
    const raw = JSON.parse(JSON.stringify(snapshotFor()));
    raw.seats[0].team = 1;
    expectSnapshotError(raw, 'invalid-seats');
  });
});
