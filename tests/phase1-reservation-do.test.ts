import { CapacityCoordinator, type CapacityCoordinatorState, type DurableObjectStorageLike } from '../src/multiplayer/reservationDurableObject';
import type { ReservationStorage } from '../src/multiplayer/reservation';

class MemoryStorage implements DurableObjectStorageLike, ReservationStorage {
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
    return callback();
  }
}

const TOKEN = 'phase1-test-token';
const NOW = Date.now();

function coordinator(storage = new MemoryStorage()) {
  const state: CapacityCoordinatorState = { storage };
  return { storage, object: new CapacityCoordinator(state, { MCA_RESERVATION_TOKEN: TOKEN }) };
}

function reserveRequest(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'do-request-1',
    roomId: 'do-room-1',
    mode: '1v1',
    seats: 2,
    matchDurationMs: 1_800_000,
    nowMs: NOW,
    ...overrides,
  };
}

function post(object: CapacityCoordinator, path: string, body: unknown, token = TOKEN) {
  return object.fetch(
    new Request(`https://capacity${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-mca-reservation-token': token } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

describe('Phase 1 capacity Durable Object adapter', () => {
  it('fails closed when its secret is missing or wrong', async () => {
    const state: CapacityCoordinatorState = { storage: new MemoryStorage() };
    const unconfigured = new CapacityCoordinator(state, {});
    const missing = await unconfigured.fetch(new Request('https://capacity/status'));
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ ok: false, code: 'reservation-not-configured' });

    const { object } = coordinator();
    const unauthorized = await post(object, '/reserve', reserveRequest(), 'wrong');
    expect(unauthorized.status).toBe(403);
    expect(await unauthorized.json()).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('reserves through the HTTP boundary and exposes global status', async () => {
    const { object } = coordinator();
    const reserved = await post(object, '/reserve', reserveRequest());
    expect(reserved.status).toBe(200);
    const body = (await reserved.json()) as { ok: boolean; reservation?: { reservationId: string } };
    expect(body.ok).toBe(true);
    expect(body.reservation?.reservationId).toBeTruthy();

    const status = await object.fetch(
      new Request('https://capacity/status', {
        headers: { 'x-mca-reservation-token': TOKEN },
      }),
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ ok: true, activeRooms: 1 });
  });

  it('serialises concurrent attempts at the capacity boundary', async () => {
    const { object } = coordinator();
    // The default policy allows two active rooms. Four room starts race for
    // those two slots through the same object.
    const responses = await Promise.all(
      [1, 2, 3, 4].map((index) =>
        post(
          object,
          '/reserve',
          reserveRequest({
            requestId: `concurrent-${index}`,
            roomId: `concurrent-room-${index}`,
          }),
        ),
      ),
    );
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const accepted = bodies.filter((body) => (body as { ok?: boolean }).ok === true);
    const rejected = bodies.filter((body) => (body as { ok?: boolean }).ok === false);
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(2);
    for (const body of rejected) {
      expect(body).toMatchObject({ code: 'capacity-full' });
    }

    const status = await object.fetch(
      new Request('https://capacity/status', {
        headers: { 'x-mca-reservation-token': TOKEN },
      }),
    );
    expect(await status.json()).toMatchObject({ ok: true, activeRooms: 2 });
  });

  it('returns a fail-closed response when the ledger transaction throws', async () => {
    const storage = new MemoryStorage();
    const { object } = coordinator(storage);
    storage.failNextTransaction = true;
    const response = await post(object, '/reserve', reserveRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: 'reservation-store-unavailable',
    });
  });

  it('rejects malformed or unauthorized paths without creating a room', async () => {
    const { object } = coordinator();
    const wrongMethod = await object.fetch(
      new Request('https://capacity/reserve', {
        headers: { 'x-mca-reservation-token': TOKEN },
      }),
    );
    expect(wrongMethod.status).toBe(404);
    const missingBody = await post(object, '/reserve', [], TOKEN);
    expect(missingBody.status).toBe(400);
  });
});
