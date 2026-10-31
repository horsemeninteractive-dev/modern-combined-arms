import {
  ReservationLedger,
  type ReservationRecord,
  type ReservationRequest,
  type ReservationStorage,
} from '../src/multiplayer/reservation';
import {
  DEFAULT_RESERVATION_POLICY,
  durationGbSeconds,
  projectedRequestCost,
  type ReservationPolicy,
} from '../src/multiplayer/reservationPolicy';
import {
  CapacityClient,
  activateReservedRoom,
  type CapacityTransport,
} from '../src/multiplayer/reservationClient';

class MemoryStorage implements ReservationStorage {
  data = new Map<string, unknown>();
  failNextTransaction = false;

  kv = {
    get: <T,>(key: string): T | undefined => {
      const value = this.data.get(key);
      return value === undefined ? undefined : (structuredClone(value) as T);
    },
    put: <T,>(key: string, value: T): void => {
      this.data.set(key, structuredClone(value));
    },
  };

  transactionSync<T>(callback: () => T): T {
    if (this.failNextTransaction) {
      this.failNextTransaction = false;
      throw new Error('storage unavailable');
    }
    const backup = new Map(this.data);
    try {
      return callback();
    } catch (error) {
      this.data = backup;
      throw error;
    }
  }
}

function policy(overrides: Partial<ReservationPolicy> = {}): ReservationPolicy {
  return { ...DEFAULT_RESERVATION_POLICY, ...overrides };
}

function request(overrides: Partial<ReservationRequest> = {}): ReservationRequest {
  return {
    requestId: 'request-1',
    roomId: 'room-1',
    mode: '1v1',
    seats: 2,
    matchDurationMs: 1_800_000,
    nowMs: Date.UTC(2026, 9, 29, 12, 0, 0),
    ...overrides,
  };
}

function setup(overrides: Partial<ReservationPolicy> = {}) {
  const storage = new MemoryStorage();
  const ledger = new ReservationLedger(storage, policy(overrides));
  return { storage, ledger };
}

function reserved(ledger: ReservationLedger, overrides: Partial<ReservationRequest> = {}) {
  const decision = ledger.reserve(request(overrides));
  if (!decision.ok) throw new Error(`Reservation failed: ${decision.code}`);
  return decision.reservation;
}

class FakeTransport implements CapacityTransport {
  calls: Array<{ path: string; body?: unknown }> = [];

  constructor(private readonly handler: (path: string, body?: unknown) => unknown) {}

  async request(path: string, body?: unknown): Promise<unknown> {
    this.calls.push({ path, body });
    return this.handler(path, body);
  }
}

function recordForClient(): ReservationRecord {
  return reserved(setup().ledger);
}

describe('Phase 1 global reservations', () => {
  it('uses the documented conservative cost model', () => {
    expect(durationGbSeconds(1_800_000, DEFAULT_RESERVATION_POLICY)).toBeCloseTo(230.4);
    expect(projectedRequestCost(2, 1_800_000, DEFAULT_RESERVATION_POLICY)).toBe(1991);
    expect(projectedRequestCost(4, 1_800_000, DEFAULT_RESERVATION_POLICY)).toBe(3974);
    expect(DEFAULT_RESERVATION_POLICY.maxActiveRooms).toBe(2);
  });

  it('reserves atomically at the capacity boundary and deduplicates retries', () => {
    const { ledger } = setup({ maxActiveRooms: 1 });
    const first = ledger.reserve(request());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);

    const duplicate = ledger.reserve(request());
    expect(duplicate).toMatchObject({ ok: true, created: false });
    if (duplicate.ok) expect(duplicate.reservation.reservationId).toBe(first.reservation.reservationId);

    const second = ledger.reserve(request({ requestId: 'request-2', roomId: 'room-2' }));
    expect(second).toMatchObject({ ok: false, code: 'capacity-full' });
    expect(ledger.status(first.reservation.createdAt)).toMatchObject({ ok: true, activeRooms: 1 });
  });

  it('rejects a request id reused for a different room', () => {
    const { ledger } = setup();
    reserved(ledger);
    expect(
      ledger.reserve(request({ roomId: 'another-room' })),
    ).toMatchObject({ ok: false, code: 'idempotency-mismatch' });
  });

  it('releases idempotently and frees the slot', () => {
    const { ledger } = setup({ maxActiveRooms: 1 });
    const reservation = reserved(ledger);
    const released = ledger.release(
      reservation.reservationId,
      { actualDurationMs: 600_000, actualRequests: 1000 },
      reservation.createdAt + 600_000,
    );
    expect(released).toMatchObject({ ok: true, alreadyReleased: false });
    expect(
      ledger.release(reservation.reservationId, {}, reservation.createdAt + 600_001),
    ).toMatchObject({ ok: true, alreadyReleased: true });

    const next = ledger.reserve(
      request({
        requestId: 'request-2',
        roomId: 'room-2',
        nowMs: reservation.createdAt + 600_002,
      }),
    );
    expect(next.ok).toBe(true);
  });

  it('reclaims stale reservations rather than leaking capacity', () => {
    const { ledger } = setup({ staleAfterMs: 500, maxActiveRooms: 1 });
    const reservation = reserved(ledger);
    expect(
      ledger.reconcile(reservation.createdAt + 2000),
    ).toMatchObject({ ok: true, activeRooms: 0 });
    const status = ledger.status(reservation.createdAt + 2000);
    expect(status).toMatchObject({ ok: true, activeRooms: 0 });
    if (status.ok) expect(status.usedDurationGbSeconds).toBeCloseTo(230.4);
  });

  it('fails closed when the ledger store throws', () => {
    const { storage, ledger } = setup();
    storage.failNextTransaction = true;
    expect(ledger.reserve(request())).toMatchObject({
      ok: false,
      code: 'reservation-store-unavailable',
    });
    expect(storage.data.size).toBe(0);
  });

  it('rejects requests over the daily request or duration budget', () => {
    const requestBudget = setup({ maxDailyRequests: 100 }).ledger;
    expect(requestBudget.reserve(request())).toMatchObject({
      ok: false,
      code: 'daily-request-budget',
    });

    const durationBudget = setup({ maxDailyDurationGbSeconds: 100 }).ledger;
    expect(durationBudget.reserve(request())).toMatchObject({
      ok: false,
      code: 'daily-duration-budget',
    });
  });

  it('enforces the match-duration cap and heartbeat deadline', () => {
    const { ledger } = setup({ maxActiveRooms: 1, maxMatchDurationMs: 5000 });
    expect(
      ledger.reserve(request({ matchDurationMs: 5001 })),
    ).toMatchObject({ ok: false, code: 'match-too-long' });

    const reservation = reserved(ledger, {
      requestId: 'request-heartbeat',
      matchDurationMs: 5000,
    });
    expect(
      ledger.heartbeat(reservation.reservationId, reservation.createdAt + 1000),
    ).toMatchObject({ ok: true });
    expect(
      ledger.heartbeat(reservation.reservationId, reservation.createdAt + 5000),
    ).toMatchObject({ ok: false, code: 'match-expired' });
  });

  it('requires activation to happen only after reservation success', async () => {
    const reservation = recordForClient();
    const successTransport = new FakeTransport((path) =>
      path === '/reserve'
        ? { ok: true, created: true, reservation }
        : { ok: false, code: 'reservation-store-unavailable', message: 'unexpected' },
    );
    let activated = false;
    const result = await activateReservedRoom(
      new CapacityClient(successTransport),
      request(),
      () => {
        activated = true;
      },
    );
    expect(result.ok).toBe(true);
    expect(activated).toBe(true);

    const failureTransport = new FakeTransport(() => ({
      ok: false,
      code: 'capacity-full',
      message: 'No room slots.',
    }));
    let blockedActivation = false;
    const failure = await activateReservedRoom(
      new CapacityClient(failureTransport),
      request({ requestId: 'request-2' }),
      () => {
        blockedActivation = true;
      },
    );
    expect(failure).toMatchObject({ ok: false, code: 'capacity-full' });
    expect(blockedActivation).toBe(false);
  });

  it('treats transport failure as capacity unavailability', async () => {
    const transport: CapacityTransport = {
      async request() {
        throw new Error('network down');
      },
    };
    const client = new CapacityClient(transport);
    expect(await client.reserve(request())).toMatchObject({
      ok: false,
      code: 'reservation-store-unavailable',
    });
  });
});
