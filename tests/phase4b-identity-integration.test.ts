import { describe, expect, it } from 'vitest';
import {
  RoomMatch,
  restoreRoomMatch,
  type RoomSeatDefinition,
  type RoomSocket,
  type SeatIdentity,
} from '../src/multiplayer/roomMatch';
import {
  RoomSnapshotError,
  validateRoomSnapshot,
  type RoomSnapshot,
} from '../src/multiplayer/roomSnapshot';
import { defaultComposition } from '../src/identity/flag';

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

  lastOfType(type: string): Record<string, unknown> | undefined {
    const messages = this.messages();
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.type === type) return message;
    }
    return undefined;
  }
}

const TOKEN_ZERO = 'phase4b-seat-zero-token-000000000';
const TOKEN_ONE = 'phase4b-seat-one-token-00000000000';

function seats(host: SeatIdentity | null, guest: SeatIdentity | null): RoomSeatDefinition[] {
  return [
    {
      seatId: 0,
      playerId: 0,
      team: 0,
      token: TOKEN_ZERO,
      accountId: host ? 'phase4b-host-account-00000000' : null,
      identity: host,
    },
    {
      seatId: 1,
      playerId: 1,
      team: 1,
      token: TOKEN_ONE,
      accountId: guest ? 'phase4b-guest-account-0000000' : null,
      identity: guest,
    },
  ];
}

function playingRoom(host: SeatIdentity | null, guest: SeatIdentity | null): RoomMatch {
  return new RoomMatch({
    roomId: 'phase4b-room',
    mode: '1v1',
    seats: seats(host, guest),
    matchDurationMs: 199_000,
    matchDeadlineAt: 200_000,
    now: 1_000,
    phase: 'playing',
    startedAtMs: 1_000,
  });
}

describe('Phase 4B match identity snapshot', () => {
  it('freezes the start identities through hello, status, reconnect and snapshot restore', () => {
    const host: SeatIdentity = {
      callsign: 'Sable',
      avatar: 'eagle',
      rank: 'corporal',
      flag: defaultComposition(),
      frame: 'frame-brass',
      background: 'bg-deep',
    };
    const guest: SeatIdentity = {
      callsign: 'Vesper',
      avatar: 'bolt',
      rank: 'private',
      frame: 'frame-steel',
    };
    const room = playingRoom(host, guest);
    const zero = new FakeSocket();
    const connected = room.connect(0, TOKEN_ZERO, zero, 1_000);
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;

    expect(connected.hello.identities).toMatchObject([
      { seatId: 0, identity: { callsign: 'Sable', frame: 'frame-brass', background: 'bg-deep' } },
      { seatId: 1, identity: { callsign: 'Vesper', frame: 'frame-steel' } },
    ]);
    expect(room.status().seats[0].identity?.callsign).toBe('Sable');
    expect(room.status().seats[1].identity?.callsign).toBe('Vesper');

    const snapshot = room.snapshot(2_000);
    expect(snapshot.identities).toHaveLength(2);
    expect(snapshot.identities?.[0]?.identity?.background).toBe('bg-deep');

    // A mutable account object passed at start cannot alter the running match.
    host.callsign = 'Renamed';
    host.frame = 'frame-laurel';
    guest.callsign = 'Changed';
    guest.background = 'bg-parade';
    expect(room.identityFor(0)).toMatchObject({
      callsign: 'Sable',
      frame: 'frame-brass',
      background: 'bg-deep',
    });
    expect(room.identityFor(1)).toMatchObject({ callsign: 'Vesper', frame: 'frame-steel' });

    // Reconnect and restore use the durable snapshot, not the newer account
    // metadata passed alongside it.
    const restored = restoreRoomMatch({
      roomId: 'phase4b-room',
      seats: seats(host, guest),
      matchDurationMs: 199_000,
      matchDeadlineAt: 200_000,
      snapshot,
      phase: 'playing',
      now: 3_000,
      restoredAtMs: 3_000,
      startedAtMs: 1_000,
    });
    const reconnected = new FakeSocket();
    const reconnect = restored.connect(0, TOKEN_ZERO, reconnected, 3_000);
    expect(reconnect.ok).toBe(true);
    if (!reconnect.ok) return;
    expect(reconnect.hello.identities?.[0]?.identity?.callsign).toBe('Sable');
    expect(reconnect.hello.identities?.[0]?.identity?.frame).toBe('frame-brass');
    expect(reconnect.hello.identities?.[1]?.identity?.callsign).toBe('Vesper');
  });

  it('sends the frozen identities with the match result', () => {
    const host: SeatIdentity = { callsign: 'Sable', avatar: 'eagle', frame: 'frame-brass' };
    const guest: SeatIdentity = { callsign: 'Vesper', avatar: 'bolt', background: 'bg-dusk' };
    const room = playingRoom(host, guest);
    const zero = new FakeSocket();
    const one = new FakeSocket();
    expect(room.connect(0, TOKEN_ZERO, zero, 1_000).ok).toBe(true);
    expect(room.connect(1, TOKEN_ONE, one, 1_000).ok).toBe(true);

    room.finishAtDeadline(200_000);
    const result = zero.lastOfType('result') as
      | { identities?: Array<{ seatId: number; identity: SeatIdentity | null }> }
      | undefined;
    expect(result?.identities).toMatchObject([
      { seatId: 0, identity: { callsign: 'Sable', frame: 'frame-brass' } },
      { seatId: 1, identity: { callsign: 'Vesper', background: 'bg-dusk' } },
    ]);
    expect(one.lastOfType('result')).toMatchObject({ type: 'result' });
  });

  it('rejects a partial identity table but safely drops unknown cosmetics', () => {
    const host: SeatIdentity = {
      callsign: 'Sable',
      avatar: 'eagle',
      frame: 'frame-brass',
      background: 'bg-deep',
    };
    const room = playingRoom(host, { callsign: 'Vesper', avatar: 'bolt' });
    const snapshot = JSON.parse(JSON.stringify(room.snapshot(2_000))) as RoomSnapshot;

    const partial = JSON.parse(JSON.stringify(snapshot)) as RoomSnapshot;
    partial.identities = partial.identities ? [partial.identities[0]] : [];
    try {
      validateRoomSnapshot(partial);
      throw new Error('Expected a partial identity table to be refused.');
    } catch (error) {
      expect(error).toBeInstanceOf(RoomSnapshotError);
      expect((error as RoomSnapshotError).code).toBe('invalid-identities');
    }

    const unknown = JSON.parse(JSON.stringify(snapshot)) as RoomSnapshot;
    if (!unknown.identities?.[0]?.identity) throw new Error('Fixture identity is missing.');
    unknown.identities[0].identity.frame = 'frame-not-real';
    unknown.identities[0].identity.background = 'bg-not-real';
    const validated = validateRoomSnapshot(unknown);
    expect(validated.identities?.[0]?.identity?.callsign).toBe('Sable');
    expect(validated.identities?.[0]?.identity?.frame).toBeUndefined();
    expect(validated.identities?.[0]?.identity?.background).toBeUndefined();
  });
});
