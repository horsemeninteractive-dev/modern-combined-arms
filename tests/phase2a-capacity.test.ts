import {
  CapacityClient,
  activateReservedRoom,
  type CapacityTransport,
} from '../src/multiplayer/reservationClient';
import {
  DEFAULT_RESERVATION_POLICY,
  type ReservationPolicy,
} from '../src/multiplayer/reservationPolicy';
import {
  ReservationLedger,
  type ReservationRequest,
  type ReservationStorage,
} from '../src/multiplayer/reservation';

class MemoryStorage implements ReservationStorage {
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

function transportFor(ledger: ReservationLedger): CapacityTransport {
  return {
    async request(path: string, body?: unknown): Promise<unknown> {
      if (path === '/reserve') {
        return ledger.reserve(body as ReservationRequest);
      }
      if (path === '/heartbeat') {
        const input = body as { reservationId: string };
        return ledger.heartbeat(input.reservationId, 2000);
      }
      if (path === '/release') {
        const input = body as { reservationId: string; actualDurationMs?: number };
        return ledger.release(
          input.reservationId,
          { actualDurationMs: input.actualDurationMs },
          3000,
        );
      }
      return { ok: false, code: 'not-found', message: 'not found' };
    },
  };
}

function request(id: string, durationMs = 60_000): ReservationRequest {
  return {
    requestId: `request-${id}`,
    roomId: `room-${id}`,
    mode: '1v1',
    seats: 2,
    matchDurationMs: durationMs,
    nowMs: 1000,
  };
}

function makeLedger(policy: Partial<ReservationPolicy> = {}): {
  ledger: ReservationLedger;
  client: CapacityClient;
} {
  const storage = new MemoryStorage();
  const ledger = new ReservationLedger(storage, {
    ...DEFAULT_RESERVATION_POLICY,
    ...policy,
  });
  return { ledger, client: new CapacityClient(transportFor(ledger)) };
}

describe('Phase 2A global capacity activation', () => {
  it('allows only one of two simultaneous activations at the final slot', async () => {
    const { client } = makeLedger({ maxActiveRooms: 1 });
    let activated = 0;
    const decisions = await Promise.all([
      activateReservedRoom(client, request('a'), () => {
        activated++;
      }),
      activateReservedRoom(client, request('b'), () => {
        activated++;
      }),
    ]);
    expect(decisions.filter((decision) => decision.ok)).toHaveLength(1);
    expect(decisions.find((decision) => !decision.ok)).toMatchObject({
      ok: false,
      code: 'capacity-full',
    });
    expect(activated).toBe(1);
  });

  it('makes duplicate reservation retries idempotent and releases idempotently', async () => {
    const { client, ledger } = makeLedger();
    let activated = 0;
    const first = await activateReservedRoom(client, request('dup'), () => {
      activated++;
    });
    const second = await activateReservedRoom(client, request('dup'), () => {
      activated++;
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(activated).toBe(2);
    if (!first.ok || !second.ok) return;
    expect(second.lease.reservation.reservationId).toBe(first.lease.reservation.reservationId);

    const releaseFirst = await first.lease.release({ actualDurationMs: 5000, actualRequests: 12 });
    const releaseSecond = await second.lease.release({ actualDurationMs: 5000, actualRequests: 12 });
    expect(releaseFirst).toMatchObject({ ok: true, alreadyReleased: false });
    expect(releaseSecond).toMatchObject({ ok: true, alreadyReleased: true });
    expect((await ledger.status(3000)).ok).toBe(true);
  });

  it('fails closed if the reservation store cannot be reached', async () => {
    const client = new CapacityClient({
      async request(): Promise<unknown> {
        throw new Error('coordinator unavailable');
      },
    });
    let activated = 0;
    const decision = await activateReservedRoom(client, request('down'), () => {
      activated++;
    });
    expect(decision).toMatchObject({
      ok: false,
      code: 'reservation-store-unavailable',
    });
    expect(activated).toBe(0);
  });

  it('does not activate when capacity is already exhausted', async () => {
    const { client } = makeLedger({ maxActiveRooms: 1 });
    let activated = 0;
    const first = await activateReservedRoom(client, request('one'), () => {
      activated++;
    });
    const second = await activateReservedRoom(client, request('two'), () => {
      activated++;
    });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, code: 'capacity-full' });
    expect(activated).toBe(1);
    if (first.ok) await first.lease.release();
  });

  it('releases a lease when activation throws and refuses heartbeat after release', async () => {
    const { client, ledger } = makeLedger();
    await expect(
      activateReservedRoom(client, request('throw'), async () => {
        throw new Error('storage failed during activation');
      }),
    ).rejects.toThrow('storage failed during activation');
    const afterFailure = await ledger.status(3000);
    expect(afterFailure).toMatchObject({ ok: true, activeRooms: 0 });

    const active = await activateReservedRoom(client, request('release'), () => undefined);
    expect(active.ok).toBe(true);
    if (!active.ok) return;
    expect((await active.lease.release()).ok).toBe(true);
    expect(await active.lease.heartbeat()).toMatchObject({
      ok: false,
      code: 'reservation-not-active',
    });
  });

  it('rejects durations above the configured hard maximum before allocation', async () => {
    const { client } = makeLedger({ maxMatchDurationMs: 10_000 });
    let activated = 0;
    const decision = await activateReservedRoom(client, request('long', 10_001), () => {
      activated++;
    });
    expect(decision).toMatchObject({ ok: false, code: 'match-too-long' });
    expect(activated).toBe(0);
  });
});
