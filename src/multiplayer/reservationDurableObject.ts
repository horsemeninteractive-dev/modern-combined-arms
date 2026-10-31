import {
  ReservationLedger,
  type ReservationRequest,
  type ReservationStorage,
} from './reservation';
import { policyFromEnv } from './reservationPolicy';

/**
 * Cloudflare Durable Object adapter for the single global capacity ledger.
 *
 * The room-side service binding must route every room to the same instance
 * (for example `CAPACITY.get('global')`). Durable Object input gates serialise
 * events, and the ledger wraps its read/check/write in
 * `storage.transactionSync`, so a crash or retry cannot create two reservations
 * for the same slot. No deployment is performed by this phase.
 */

export interface DurableObjectKv {
  get<T = unknown>(key: string): T | undefined;
  put<T = unknown>(key: string, value: T): void;
}

export interface DurableObjectStorageLike {
  transactionSync<T>(callback: () => T): T;
  kv: DurableObjectKv;
}

/**
 * Every room must address this one object name. A per-room or random name
 * would create an independent ledger and defeat the global limit.
 */
export const CAPACITY_COORDINATOR_NAME = 'global';

export interface CapacityCoordinatorState {
  storage: DurableObjectStorageLike;
}

interface EnvLike {
  [key: string]: unknown;
  MCA_RESERVATION_TOKEN?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The Durable Object class. It is deliberately not imported by the browser
 * application; a future room Worker imports it and binds the namespace.
 */
export class CapacityCoordinatorDurableObject {
  private readonly ledger: ReservationLedger | null;
  private readonly configurationError: string | null;
  private readonly token: string;

  constructor(state: CapacityCoordinatorState, env: EnvLike) {
    this.token = String(env.MCA_RESERVATION_TOKEN ?? '');
    let ledger: ReservationLedger | null = null;
    let configurationError: string | null = null;
    try {
      const policy = policyFromEnv(env);
      ledger = new ReservationLedger(state.storage as ReservationStorage, policy);
    } catch (error) {
      configurationError = error instanceof Error ? error.message : 'Invalid reservation policy.';
    }
    this.ledger = ledger;
    this.configurationError = configurationError;
  }

  async fetch(request: Request): Promise<Response> {
    // A missing token is a configuration failure, not an open endpoint.
    if (!this.token) {
      return json(
        {
          ok: false,
          code: 'reservation-not-configured',
          message: 'Reservation token is not configured.',
        },
        503,
      );
    }
    if (request.headers.get('x-mca-reservation-token') !== this.token) {
      return json({ ok: false, code: 'unauthorized', message: 'Unauthorized.' }, 403);
    }
    if (!this.ledger) {
      return json(
        {
          ok: false,
          code: 'reservation-store-unavailable',
          message: this.configurationError ?? 'Reservation coordinator is not configured.',
        },
        503,
      );
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    try {
      if (path.endsWith('/status') && request.method === 'GET') {
        return json(this.ledger.status());
      }
      if (path.endsWith('/reconcile') && request.method === 'POST') {
        return json(this.ledger.reconcile());
      }
      if (path.endsWith('/reserve') && request.method === 'POST') {
        const body = await readBody(request);
        if (!body) return json({ ok: false, code: 'invalid-request', message: 'Body is not an object.' }, 400);
        // The coordinator's clock is authoritative. A room may supply a
        // duration but never the time used for leases or daily accounting.
        return json(
          this.ledger.reserve({
            ...(body as unknown as ReservationRequest),
            nowMs: Date.now(),
          }),
        );
      }
      if (path.endsWith('/heartbeat') && request.method === 'POST') {
        const body = await readBody(request);
        if (!body || typeof body.reservationId !== 'string') {
          return json({ ok: false, code: 'invalid-request', message: 'Reservation id is required.' }, 400);
        }
        return json(this.ledger.heartbeat(body.reservationId));
      }
      if (path.endsWith('/release') && request.method === 'POST') {
        const body = await readBody(request);
        if (!body || typeof body.reservationId !== 'string') {
          return json({ ok: false, code: 'invalid-request', message: 'Reservation id is required.' }, 400);
        }
        return json(
          this.ledger.release(body.reservationId, {
            actualDurationMs:
              typeof body.actualDurationMs === 'number' ? body.actualDurationMs : undefined,
            actualRequests:
              typeof body.actualRequests === 'number' ? body.actualRequests : undefined,
          }),
        );
      }
      return json({ ok: false, code: 'not-found', message: 'Unknown reservation endpoint.' }, 404);
    } catch {
      // Do not leak storage/parser internals. The room must fail closed.
      return json(
        { ok: false, code: 'reservation-store-unavailable', message: 'Capacity ledger is unavailable.' },
        503,
      );
    }
  }
}

/** Phase 1 name retained for the existing adapter tests and interface note. */
export { CapacityCoordinatorDurableObject as CapacityCoordinator };
