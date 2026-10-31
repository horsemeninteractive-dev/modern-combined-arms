import type {
  ActualRoomUsage,
  ReconcileDecision,
  ReleaseDecision,
  ReservationCode,
  ReservationDecision,
  ReservationRecord,
  ReservationRequest,
  ReserveDecision,
  StatusDecision,
} from './reservation';

/**
 * Room-side reservation client.
 *
 * The room must call `reserve` before loading the Game or accepting sockets,
 * heartbeat while active, and release on every normal exit path. A transport
 * error or a non-OK decision is final: there is no local-counter fallback and
 * no paid path.
 */

export interface CapacityTransport {
  request(path: string, body?: unknown): Promise<unknown>;
}

export class ServiceBindingCapacityTransport implements CapacityTransport {
  constructor(
    private readonly binding: {
      fetch(input: string, init?: RequestInit): Promise<Response>;
    },
    private readonly token: string,
  ) {}

  async request(path: string, body?: unknown): Promise<unknown> {
    const response = await this.binding.fetch(`https://capacity${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'x-mca-reservation-token': this.token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    try {
      return await response.json();
    } catch {
      return { ok: false, code: 'reservation-store-unavailable', message: 'Invalid capacity response.' };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(raw: unknown, fallback = 'Capacity service unavailable.'): {
  ok: false;
  code: ReservationCode;
  message: string;
} {
  if (isRecord(raw) && raw.ok === false && typeof raw.code === 'string') {
    return {
      ok: false,
      code: raw.code as ReservationCode,
      message: typeof raw.message === 'string' ? raw.message : fallback,
    };
  }
  return { ok: false, code: 'reservation-store-unavailable', message: fallback };
}

function readReservation(value: unknown): ReservationRecord | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.reservationId !== 'string' ||
    typeof value.requestId !== 'string' ||
    typeof value.roomId !== 'string' ||
    (value.mode !== '1v1' && value.mode !== '2v2') ||
    typeof value.matchDurationMs !== 'number' ||
    typeof value.expiresAt !== 'number' ||
    (value.status !== 'active' && value.status !== 'released')
  ) {
    return null;
  }
  return value as unknown as ReservationRecord;
}

export class CapacityClient {
  constructor(private readonly transport: CapacityTransport) {}

  async reserve(input: ReservationRequest): Promise<ReserveDecision> {
    try {
      const raw = await this.transport.request('/reserve', input);
      if (isRecord(raw) && raw.ok === true) {
        const reservation = readReservation(raw.reservation);
        if (!reservation) {
          return {
            ok: false,
            code: 'reservation-store-unavailable',
            message: 'Capacity service returned an invalid reservation.',
          };
        }
        return { ok: true, created: raw.created === true, reservation };
      }
      return failure(raw);
    } catch {
      return {
        ok: false,
        code: 'reservation-store-unavailable',
        message: 'Capacity service could not be reached.',
      };
    }
  }

  async heartbeat(reservationId: string): Promise<ReservationDecision> {
    try {
      const raw = await this.transport.request('/heartbeat', { reservationId });
      if (isRecord(raw) && raw.ok === true) {
        const reservation = readReservation(raw.reservation);
        if (!reservation) {
          return {
            ok: false,
            code: 'reservation-store-unavailable',
            message: 'Capacity service returned an invalid reservation.',
          };
        }
        return { ok: true, reservation };
      }
      return failure(raw);
    } catch {
      return {
        ok: false,
        code: 'reservation-store-unavailable',
        message: 'Capacity service could not be reached.',
      };
    }
  }

  async release(
    reservationId: string,
    usage: ActualRoomUsage = {},
  ): Promise<ReleaseDecision> {
    try {
      const raw = await this.transport.request('/release', { reservationId, ...usage });
      if (isRecord(raw) && raw.ok === true) {
        const reservation = readReservation(raw.reservation);
        if (!reservation) {
          return {
            ok: false,
            code: 'reservation-store-unavailable',
            message: 'Capacity service returned an invalid reservation.',
          };
        }
        return {
          ok: true,
          alreadyReleased: raw.alreadyReleased === true,
          reservation,
        };
      }
      return failure(raw);
    } catch {
      return {
        ok: false,
        code: 'reservation-store-unavailable',
        message: 'Capacity service could not be reached.',
      };
    }
  }

  async status(): Promise<StatusDecision> {
    try {
      const raw = await this.transport.request('/status');
      if (isRecord(raw) && raw.ok === true && typeof raw.activeRooms === 'number') {
        return raw as unknown as StatusDecision;
      }
      return failure(raw);
    } catch {
      return {
        ok: false,
        code: 'reservation-store-unavailable',
        message: 'Capacity service could not be reached.',
      };
    }
  }

  async reconcile(): Promise<ReconcileDecision> {
    try {
      const raw = await this.transport.request('/reconcile', {});
      if (isRecord(raw) && raw.ok === true && Array.isArray(raw.released)) {
        return raw as unknown as ReconcileDecision;
      }
      return failure(raw);
    } catch {
      return {
        ok: false,
        code: 'reservation-store-unavailable',
        message: 'Capacity service could not be reached.',
      };
    }
  }
}

export class ReservationLease {
  private released = false;

  constructor(
    private readonly client: CapacityClient,
    readonly reservation: ReservationRecord,
  ) {}

  async heartbeat(): Promise<ReservationDecision> {
    if (this.released) {
      return {
        ok: false,
        code: 'reservation-not-active',
        message: 'Reservation has already been released.',
      };
    }
    return this.client.heartbeat(this.reservation.reservationId);
  }

  async release(usage: ActualRoomUsage = {}): Promise<ReleaseDecision> {
    if (this.released) {
      return { ok: true, alreadyReleased: true, reservation: this.reservation };
    }
    const result = await this.client.release(this.reservation.reservationId, usage);
    if (result.ok) this.released = true;
    return result;
  }

  get isReleased(): boolean {
    return this.released;
  }
}

export type StartRoomDecision =
  | { ok: true; lease: ReservationLease; reservation: ReservationRecord }
  | { ok: false; code: ReservationCode; message: string };

/**
 * Reserve first, activate second. If activation throws, the lease is released
 * with the conservative full reservation charge (the room has no trustworthy
 * actual usage at that point), and the activation error is rethrown.
 */
export async function activateReservedRoom(
  client: CapacityClient,
  input: ReservationRequest,
  activate: (lease: ReservationLease) => Promise<void> | void,
): Promise<StartRoomDecision> {
  const decision = await client.reserve(input);
  if (!decision.ok) return decision;
  const lease = new ReservationLease(client, decision.reservation);
  try {
    await activate(lease);
  } catch (error) {
    await lease.release();
    throw error;
  }
  return { ok: true, lease, reservation: decision.reservation };
}
