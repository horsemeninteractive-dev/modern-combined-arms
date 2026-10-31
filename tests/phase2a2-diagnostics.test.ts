import {
  RoomMatch,
  type RoomSeatDefinition,
  type RoomSocket,
} from '../src/multiplayer/roomMatch';
import {
  RoomDiagnostics,
  utf8ByteLength,
} from '../src/multiplayer/roomDiagnostics';

class FakeSocket implements RoomSocket {
  readonly sent: string[] = [];
  bufferedAmount = 0;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    /* the test harness does not model close events */
  }
}

function seats(): RoomSeatDefinition[] {
  return [
    { seatId: 0, playerId: 0, team: 0, token: 'seat-zero-token-000000000000' },
    { seatId: 1, playerId: 1, team: 1, token: 'seat-one-token-0000000000000' },
  ];
}

function makeRoom(diagnostics?: RoomDiagnostics): RoomMatch {
  return new RoomMatch({
    roomId: 'diagnostics-room',
    mode: '1v1',
    seats: seats(),
    matchDurationMs: 120_000,
    matchDeadlineAt: 1_000_000,
    now: 1000,
    // Pre-2B1 in-process fixture: this room is created already past its lobby.
    promoteOnConnect: true,
    diagnostics,
  });
}

function connectBoth(room: RoomMatch): void {
  expect(room.connect(0, seats()[0].token, new FakeSocket(), 1000).ok).toBe(true);
  expect(room.connect(1, seats()[1].token, new FakeSocket(), 1000).ok).toBe(true);
}

describe('Phase 2A.2 room diagnostics', () => {
  it('records bounded tick and snapshot aggregates without changing the wire format', () => {
    const room = makeRoom();
    connectBoth(room);
    for (let index = 0; index < 40; index++) room.tick(1100 + index * 50);

    const summary = room.status().diagnostics;
    expect(summary.enabled).toBe(true);
    expect(summary.clockAdvanced).toBe(true);
    expect(summary.tick.durationsAvailable).toBe(true);
    expect(summary.tick.count).toBe(40);
    expect(summary.tick.duration.count).toBe(40);
    expect(summary.tick.duration.p50).not.toBeNull();
    expect(summary.tick.duration.max).not.toBeNull();
    expect(summary.tick.duration.max!).toBeGreaterThanOrEqual(summary.tick.duration.p50!);
    expect(summary.tick.simulationMs).toBeGreaterThan(0);
    expect(summary.tick.otherWorkMs).toBeGreaterThanOrEqual(0);
    expect(summary.snapshots.total).toBeGreaterThan(0);
    expect(summary.snapshots.bytes).toBeGreaterThan(0);
    expect(summary.snapshots.perSeat[0].count).toBeGreaterThan(0);
    expect(summary.snapshots.perSeat[1].count).toBeGreaterThan(0);
    expect(summary.snapshots.perSeat[0].size.p50).toBeGreaterThan(0);
    expect(summary.snapshots.perSeat[0].serialization.count).toBe(
      summary.snapshots.perSeat[0].count,
    );
    expect(summary.lifecycle.connectionsAccepted).toBe(2);
    expect(summary.lifecycle.seatConnects).toEqual([1, 1]);

    // The instrumentation must not add fields to the actual team snapshot.
    const snapshotText = (room as unknown as { seats: Array<{ socket: FakeSocket }> })
      .seats[0].socket.sent.find((text) => text.includes('"type":"snapshot"'));
    expect(snapshotText).toBeTruthy();
    expect(JSON.parse(snapshotText!)).not.toHaveProperty('diagnostics');
  });

  it('does not alter authoritative simulation when enabled and is inert when disabled', () => {
    const enabledRoom = makeRoom(new RoomDiagnostics());
    const disabledRoom = makeRoom(new RoomDiagnostics({ enabled: false }));
    connectBoth(enabledRoom);
    connectBoth(disabledRoom);
    for (let index = 0; index < 120; index++) {
      enabledRoom.tick(1100 + index * 50);
      disabledRoom.tick(1100 + index * 50);
    }

    expect(enabledRoom.game.stateHash()).toBe(disabledRoom.game.stateHash());
    expect(enabledRoom.status().diagnostics.tick.count).toBe(120);
    expect(disabledRoom.status().diagnostics.enabled).toBe(false);
    expect(disabledRoom.status().diagnostics.clockAdvanced).toBe(false);
    expect(disabledRoom.status().diagnostics.tick.count).toBe(0);
  });

  it('accounts for persistence, reservation and lifecycle aggregates', () => {
    const diagnostics = new RoomDiagnostics();
    diagnostics.markActivated(1000);
    diagnostics.recordPersistenceOperation('read', 1.25);
    diagnostics.recordPersistenceOperation('write', 2.5);
    diagnostics.recordPersistenceRead(400, 1.5);
    diagnostics.recordPersistenceCycle({
      kind: 'snapshot',
      durationMs: 25,
      bytes: 60_000,
      chunks: 2,
      ok: true,
    });
    diagnostics.recordPersistenceCycle({
      kind: 'meta',
      durationMs: 3,
      bytes: 512,
      chunks: 1,
      ok: true,
    });
    diagnostics.recordPersistenceCycle({
      kind: 'load',
      durationMs: 8,
      bytes: 60_512,
      chunks: 2,
      ok: false,
      error: 'storage unavailable',
    });
    diagnostics.recordHeartbeat(true);
    diagnostics.recordHeartbeat(false, 'reservation-store-unavailable');
    diagnostics.recordRelease(true);
    diagnostics.recordReconnectAttempt();
    diagnostics.recordConnect(0, true);
    diagnostics.recordReconnectRejection('seat-occupied');
    diagnostics.recordDeadline();
    diagnostics.recordAbnormalShutdown();
    diagnostics.markClosed('match-finished', 2000);

    const now = Date.now();
    const summary = diagnostics.summary(now + 40_000, 15_000);
    expect(summary.activatedAt).toBe(1000);
    expect(summary.closedAt).toBe(2000);
    expect(summary.closedReason).toBe('match-finished');
    expect(summary.persistence.reads).toBe(2);
    expect(summary.persistence.writes).toBe(1);
    expect(summary.persistence.readBytes).toBe(400);
    expect(summary.persistence.writeBytes).toBe(60_512);
    expect(summary.persistence.snapshotCycles).toBe(1);
    expect(summary.persistence.metaCycles).toBe(1);
    expect(summary.persistence.loadCycles).toBe(0);
    expect(summary.persistence.failures).toBe(1);
    expect(summary.persistence.lastFailureKind).toBe('load');
    expect(summary.persistence.lastFailure).toContain('storage unavailable');
    expect(summary.persistence.chunksWritten).toBe(2);
    expect(summary.persistence.maxSnapshotBytes).toBe(60_000);
    expect(summary.persistence.behind).toBe(true);
    expect(summary.clockAdvanced).toBe(true);
    expect(summary.persistence.durationsAvailable).toBe(true);
    expect(summary.reservations.heartbeatSuccesses).toBe(1);
    expect(summary.reservations.heartbeatFailures).toBe(1);
    expect(summary.reservations.releaseSuccesses).toBe(1);
    expect(summary.lifecycle.reconnectAttempts).toBe(1);
    expect(summary.lifecycle.reconnectSuccesses).toBe(1);
    expect(summary.lifecycle.reconnectRejections).toBe(1);
    expect(summary.lifecycle.socketRejections['seat-occupied']).toBe(1);
    expect(summary.lifecycle.deadlineHits).toBe(1);
    expect(summary.lifecycle.abnormalShutdowns).toBe(1);
    expect(JSON.stringify(summary)).not.toMatch(/token/i);
  });

  it('measures UTF-8 payload size without allocating an encoder result', () => {
    expect(utf8ByteLength('plain')).toBe(5);
    expect(utf8ByteLength('café')).toBe(5);
    expect(utf8ByteLength('tank 😀')).toBe(9);
    expect(utf8ByteLength('中文地图')).toBe(12);
  });
});
