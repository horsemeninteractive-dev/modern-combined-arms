import {
  RoomMatch,
  type RoomSeatDefinition,
  type RoomSocket,
} from '../src/multiplayer/roomMatch';
import {
  KEEPALIVE_MIN_INTERVAL_MS,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_KEEPALIVE_MESSAGE_BYTES,
  parseClientMessage,
} from '../src/multiplayer/protocol';

class FakeSocket implements RoomSocket {
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  bufferedAmount = 0;
  /** Set to simulate a transport that has gone away without a close event. */
  failSends = false;

  send(data: string): void {
    if (this.failSends) throw new Error('socket is gone');
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.closed = { code, reason };
  }

  messages(): Array<Record<string, unknown>> {
    return this.sent.map((text) => JSON.parse(text) as Record<string, unknown>);
  }

  acks(): Array<Record<string, unknown>> {
    return this.messages().filter((message) => message.type === 'keepaliveAck');
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
    roomId: 'keepalive-room',
    mode: '1v1',
    seats: seats(),
    matchDurationMs: 120_000,
    matchDeadlineAt: 1_000_000,
    now: 1000,
    // Pre-2B1 in-process fixture: this room is created already past its lobby.
    promoteOnConnect: true,
  });
}

function keepalive(): string {
  return JSON.stringify({ type: 'keepalive', v: 2 });
}

function connectBoth(room: RoomMatch): { zero: FakeSocket; one: FakeSocket } {
  const zero = new FakeSocket();
  const one = new FakeSocket();
  expect(room.connect(0, seats()[0].token, zero, 1000).ok).toBe(true);
  expect(room.connect(1, seats()[1].token, one, 1000).ok).toBe(true);
  expect(room.currentPhase).toBe('playing');
  return { zero, one };
}

describe('Phase 2A.3 application keepalive', () => {
  it('parses a dedicated keepalive and rejects command or extra fields', () => {
    expect(parseClientMessage(keepalive())).toMatchObject({
      ok: true,
      message: { type: 'keepalive', v: 2 },
    });
    expect(
      parseClientMessage(JSON.stringify({ type: 'keepalive', v: 2, command: { type: 'stop' } })),
    ).toMatchObject({ ok: false, code: 'unknown-field' });
    expect(
      parseClientMessage(JSON.stringify({ type: 'keepalive', v: 2, seat: 0 })),
    ).toMatchObject({ ok: false, code: 'unknown-field' });
    expect(parseClientMessage(JSON.stringify({ type: 'keepalive', v: 3 }))).toMatchObject({
      ok: false,
      code: 'unsupported-version',
    });
    expect(parseClientMessage('x'.repeat(MAX_CLIENT_MESSAGE_BYTES + 1))).toMatchObject({
      ok: false,
      code: 'payload-too-large',
    });
    expect(
      parseClientMessage(keepalive(), MAX_KEEPALIVE_MESSAGE_BYTES).ok,
    ).toBe(true);
  });

  it('acknowledges an idle seat without touching the command queue or the tick', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);
    const tickBefore = room.game.state.tick;
    const pendingBefore = room.game.pending.length;
    const acceptedBefore = room.status().stats.commandsAccepted;

    room.receive(0, zero, keepalive(), 20_000);

    const ack = zero.acks().at(-1);
    expect(ack).toEqual({ type: 'keepaliveAck', v: 2 });
    expect(Object.keys(ack ?? {}).sort()).toEqual(['type', 'v']);
    expect(room.game.state.tick).toBe(tickBefore);
    expect(room.game.pending.length).toBe(pendingBefore);
    expect(room.status().stats.commandsAccepted).toBe(acceptedBefore);
    expect(room.status().diagnostics.keepalive).toMatchObject({ received: 1, acked: 1 });
    expect(room.status().seats[0].lastAckAt).toBe(20_000);
  });

  it('accepts keepalive while waiting for the second seat', () => {
    const room = makeRoom();
    const zero = new FakeSocket();
    expect(room.connect(0, seats()[0].token, zero, 1000).ok).toBe(true);
    expect(room.currentPhase).toBe('waiting');

    room.receive(0, zero, keepalive(), 20_000);
    expect(zero.acks()).toHaveLength(1);
    expect(room.currentPhase).toBe('waiting');
  });

  it('rate limits keepalives without counting the rejected frame as activity', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);

    room.receive(0, zero, keepalive(), 20_000);
    room.receive(0, zero, keepalive(), 20_000 + KEEPALIVE_MIN_INTERVAL_MS - 1);
    const limited = zero.messages().at(-1);
    expect(limited).toMatchObject({ type: 'error', code: 'keepalive-rate-limited' });
    expect(zero.acks()).toHaveLength(1);
    expect(room.status().diagnostics.keepalive).toMatchObject({ received: 1, rateLimited: 1 });
    expect(room.status().seats[0].lastAckAt).toBe(20_000);

    room.receive(0, zero, keepalive(), 20_000 + KEEPALIVE_MIN_INTERVAL_MS);
    expect(zero.acks()).toHaveLength(2);
  });

  it('rejects malformed and oversized keepalives without acknowledging', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);

    room.receive(0, zero, JSON.stringify({ type: 'keepalive', v: 2, command: {} }), 20_000);
    expect(zero.acks()).toHaveLength(0);
    expect(zero.messages().at(-1)).toMatchObject({ type: 'error', code: 'unknown-field' });

    // Valid JSON shape, but larger than the keepalive budget: trailing whitespace
    // keeps the parsed object legal while the frame exceeds 256 bytes.
    const padded = keepalive() + ' '.repeat(MAX_KEEPALIVE_MESSAGE_BYTES);
    expect(padded.length).toBeGreaterThan(MAX_KEEPALIVE_MESSAGE_BYTES);
    expect(padded.length).toBeLessThan(MAX_CLIENT_MESSAGE_BYTES);
    expect(parseClientMessage(padded)).toMatchObject({ ok: true, message: { type: 'keepalive' } });
    room.receive(0, zero, padded, 40_000);
    expect(zero.acks()).toHaveLength(0);
    expect(zero.messages().at(-1)).toMatchObject({ type: 'error', code: 'payload-too-large' });
  });

  it('does not let one seat keepalive delay abandonment of the other', () => {
    const room = makeRoom();
    const { zero, one } = connectBoth(room);
    room.disconnect(1, one, 2000);

    for (let at = 5000; at < 31_000; at += 5000) {
      room.receive(0, zero, keepalive(), at);
    }
    expect(room.currentPhase).toBe('playing');

    room.tick(40_000);
    expect(room.currentPhase).toBe('finished');
    expect(room.currentResult).toMatchObject({ reason: 'abandoned', winnerTeam: 0 });
    expect(room.status().diagnostics.keepalive.acked).toBeGreaterThan(0);
  });

  it('never extends the hard deadline and rejects keepalive after completion', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);

    room.receive(0, zero, keepalive(), 990_000);
    expect(zero.acks()).toHaveLength(1);
    room.tick(1_000_000);
    expect(room.currentPhase).toBe('finished');
    expect(['time-limit', 'draw']).toContain(room.currentResult.reason);
    expect(room.matchDeadlineAt).toBe(1_000_000);

    room.receive(0, zero, keepalive(), 1_000_001);
    const afterClose = zero.messages().at(-1);
    expect(afterClose).toMatchObject({ type: 'error' });
    expect(['seat-inactive', 'room-closed']).toContain(afterClose?.code);
    expect(zero.acks()).toHaveLength(1);
  });

  it('does not treat an undeliverable acknowledgement as seat activity', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);
    const activityBefore = room.status().seats[0].lastActivityAt;

    zero.failSends = true;
    room.receive(0, zero, keepalive(), 20_000);

    const status = room.status();
    expect(status.seats[0].lastActivityAt).toBe(activityBefore);
    expect(status.seats[0].lastAckAt).toBeNull();
    expect(status.diagnostics.keepalive).toMatchObject({ received: 1, acked: 0 });
    expect(status.diagnostics.snapshots.failures.controlSend).toBe(1);
    expect(status.seats[0].connected).toBe(false);
    expect(zero.closed).toMatchObject({ code: 1011, reason: 'send-failed' });
  });

  it('rejects keepalive after a controlled room shutdown', () => {
    const room = makeRoom();
    const { zero } = connectBoth(room);
    room.receive(0, zero, keepalive(), 20_000);
    expect(zero.acks()).toHaveLength(1);

    room.fail('operator-shutdown', 30_000);
    expect(room.currentPhase).toBe('closed');
    expect(zero.messages().at(-1)).toMatchObject({
      type: 'roomClosed',
      reason: 'operator-shutdown',
    });

    room.receive(0, zero, keepalive(), 60_000);
    const afterShutdown = zero.messages().at(-1);
    expect(afterShutdown).toMatchObject({ type: 'error' });
    expect(['seat-inactive', 'room-closed']).toContain(afterShutdown?.code);
    expect(zero.acks()).toHaveLength(1);
    expect(room.status().diagnostics.keepalive).toMatchObject({ received: 1, acked: 1 });
  });

  it('keeps keepalive state bounded and supports a clean reconnect', () => {
    const room = makeRoom();
    const { zero, one } = connectBoth(room);

    for (let index = 1; index <= 100; index++) {
      room.receive(0, zero, keepalive(), 20_000 + index * KEEPALIVE_MIN_INTERVAL_MS);
    }
    const summary = room.status();
    expect(summary.diagnostics.keepalive).toMatchObject({ received: 100, acked: 100 });
    expect(JSON.stringify(summary.diagnostics).length).toBeLessThan(8192);
    expect(summary.seats[0].lastAckAt).not.toBeNull();

    room.disconnect(1, one, 30_000);
    const replacement = new FakeSocket();
    expect(room.connect(1, seats()[1].token, replacement, 40_000).ok).toBe(true);
    expect(room.currentPhase).toBe('playing');
    room.receive(1, replacement, keepalive(), 60_000);
    expect(replacement.acks()).toHaveLength(1);

    const duplicate = new FakeSocket();
    expect(room.connect(1, seats()[1].token, duplicate, 61_000)).toMatchObject({
      ok: false,
      code: 'seat-occupied',
    });
  });
});
