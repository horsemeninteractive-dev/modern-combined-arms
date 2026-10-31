import {
  durationGbSeconds,
  projectedRequestCost,
  validatePolicy,
  type ReservationPolicy,
  type RoomMode,
  ROOM_MODE_SEATS,
} from './reservationPolicy';

/**
 * Global capacity ledger.
 *
 * All rooms address one Durable Object instance. The object's synchronous
 * storage transaction wraps every read/check/write below, so two room starts
 * cannot both observe the last free slot. This class has no per-room counter
 * and no in-memory fallback: if the storage transaction throws, the caller gets
 * `reservation-store-unavailable` and must not activate the room.
 */

export const RESERVATION_LEDGER_KEY = 'mca-capacity-ledger-v1';
export const RESERVATION_LEDGER_VERSION = 1;

export type ReservationCode =
  | 'invalid-request'
  | 'match-too-long'
  | 'match-mode-mismatch'
  | 'room-already-active'
  | 'idempotency-mismatch'
  | 'reservation-released'
  | 'capacity-full'
  | 'daily-duration-budget'
  | 'daily-request-budget'
  | 'reservation-store-unavailable'
  | 'reservation-not-found'
  | 'reservation-not-active'
  | 'match-expired'
  | 'reservation-expired';

export interface ReservationRequest {
  requestId: string;
  roomId: string;
  mode: RoomMode;
  seats: number;
  matchDurationMs: number;
  nowMs?: number;
}

export interface ActualRoomUsage {
  actualDurationMs?: number;
  actualRequests?: number;
}

export interface ReservationRecord {
  reservationId: string;
  requestId: string;
  roomId: string;
  mode: RoomMode;
  seats: number;
  day: string;
  createdAt: number;
  matchDurationMs: number;
  hardDeadlineAt: number;
  expiresAt: number;
  lastHeartbeatAt: number;
  durationGbSeconds: number;
  projectedRequests: number;
  status: 'active' | 'released';
  releasedAt: number | null;
  releaseReason: 'normal' | 'stale' | null;
  actualDurationMs: number | null;
  actualRequests: number | null;
}

export interface DailyUsage {
  day: string;
  usedDurationGbSeconds: number;
  usedRequests: number;
}

interface Ledger {
  version: typeof RESERVATION_LEDGER_VERSION;
  nextId: number;
  reservations: ReservationRecord[];
  days: Record<string, DailyUsage>;
}

export interface ReservationStorage {
  transactionSync<T>(callback: () => T): T;
  kv: {
    get<T = unknown>(key: string): T | undefined;
    put<T = unknown>(key: string, value: T): void;
  };
}

export type ReserveDecision =
  | { ok: true; created: boolean; reservation: ReservationRecord }
  | { ok: false; code: ReservationCode; message: string };

export type ReservationDecision =
  | { ok: true; reservation: ReservationRecord }
  | { ok: false; code: ReservationCode; message: string };

export type ReleaseDecision =
  | { ok: true; alreadyReleased: boolean; reservation: ReservationRecord }
  | { ok: false; code: ReservationCode; message: string };

export type StatusDecision =
  | {
      ok: true;
      day: string;
      activeRooms: number;
      activeReservedDurationGbSeconds: number;
      activeReservedRequests: number;
      usedDurationGbSeconds: number;
      usedRequests: number;
      remainingDurationGbSeconds: number;
      remainingRequests: number;
      policy: ReservationPolicy;
    }
  | { ok: false; code: ReservationCode; message: string };

export type ReconcileDecision =
  | { ok: true; released: ReservationRecord[]; activeRooms: number }
  | { ok: false; code: ReservationCode; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function reject(code: ReservationCode, message: string): {
  ok: false;
  code: ReservationCode;
  message: string;
} {
  return { ok: false, code, message };
}

function emptyLedger(): Ledger {
  return { version: RESERVATION_LEDGER_VERSION, nextId: 1, reservations: [], days: {} };
}

function readLedger(storage: ReservationStorage): Ledger {
  const raw = storage.kv.get<unknown>(RESERVATION_LEDGER_KEY);
  if (raw === undefined) return emptyLedger();
  if (!isRecord(raw) || raw.version !== RESERVATION_LEDGER_VERSION) {
    throw new Error('Reservation ledger is missing or has an unsupported version.');
  }
  if (!Number.isInteger(raw.nextId) || !Array.isArray(raw.reservations) || !isRecord(raw.days)) {
    throw new Error('Reservation ledger is corrupted.');
  }
  return raw as unknown as Ledger;
}

function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function ensureDay(ledger: Ledger, day: string): DailyUsage {
  const existing = ledger.days[day];
  if (existing) return existing;
  const created: DailyUsage = { day, usedDurationGbSeconds: 0, usedRequests: 0 };
  ledger.days[day] = created;
  return created;
}

function cloneRecord(record: ReservationRecord): ReservationRecord {
  return { ...record };
}

function fingerprint(input: ReservationRequest): string {
  return `${input.roomId}|${input.mode}|${input.seats}|${input.matchDurationMs}`;
}

function validateRequest(
  input: ReservationRequest,
  policy: ReservationPolicy,
): { ok: true; nowMs: number; durationMs: number } | ReturnType<typeof reject> {
  if (
    typeof input.requestId !== 'string' ||
    input.requestId.length === 0 ||
    input.requestId.length > 128 ||
    typeof input.roomId !== 'string' ||
    input.roomId.length === 0 ||
    input.roomId.length > 128
  ) {
    return reject('invalid-request', 'Room and request ids are required.');
  }
  if (input.mode !== '1v1' && input.mode !== '2v2') {
    return reject('invalid-request', 'Unknown room mode.');
  }
  if (input.seats !== ROOM_MODE_SEATS[input.mode]) {
    return reject('match-mode-mismatch', 'Seat count does not match the room mode.');
  }
  if (
    !Number.isInteger(input.matchDurationMs) ||
    input.matchDurationMs <= 0 ||
    input.matchDurationMs > policy.maxMatchDurationMs
  ) {
    return reject('match-too-long', 'Requested match duration is outside the configured maximum.');
  }
  const nowMs = input.nowMs ?? Date.now();
  if (!isFinitePositive(nowMs)) return reject('invalid-request', 'Reservation clock is invalid.');
  return { ok: true, nowMs, durationMs: input.matchDurationMs };
}

function releaseStale(record: ReservationRecord, nowMs: number, ledger: Ledger, reason: 'stale'): ReservationRecord {
  // Charge the day in which the stale lease is observed. A room that crossed
  // midnight must not consume today's budget invisibly.
  const usage = ensureDay(ledger, dayKey(nowMs));
  usage.usedDurationGbSeconds += record.durationGbSeconds;
  usage.usedRequests += record.projectedRequests;
  record.status = 'released';
  record.releasedAt = nowMs;
  record.releaseReason = reason;
  record.actualDurationMs = record.matchDurationMs;
  record.actualRequests = record.projectedRequests;
  return record;
}

function reconcileLedger(ledger: Ledger, nowMs: number, policy: ReservationPolicy): ReservationRecord[] {
  const released: ReservationRecord[] = [];
  for (const record of ledger.reservations) {
    if (record.status !== 'active') continue;
    const stale = nowMs - record.lastHeartbeatAt > policy.staleAfterMs;
    const expired = nowMs >= record.expiresAt;
    if (stale || expired) released.push(releaseStale(record, nowMs, ledger, 'stale'));
  }
  return released;
}

function activeRecords(ledger: Ledger): ReservationRecord[] {
  return ledger.reservations.filter((record) => record.status === 'active');
}

function reservedForDay(ledger: Ledger): { duration: number; requests: number } {
  // An active room is consuming wall time now even if it was reserved just
  // before midnight. Count every active lease against today's remaining
  // budget; the release/stale charge is booked to the observation day.
  let duration = 0;
  let requests = 0;
  for (const record of activeRecords(ledger)) {
    duration += record.durationGbSeconds;
    requests += record.projectedRequests;
  }
  return { duration, requests };
}

export class ReservationLedger {
  constructor(
    private readonly storage: ReservationStorage,
    private readonly policy: ReservationPolicy,
  ) {
    validatePolicy(policy);
  }

  reserve(input: ReservationRequest): ReserveDecision {
    const checked = validateRequest(input, this.policy);
    if (!checked.ok) return checked;
    try {
      return this.mutate((ledger) => this.reserveInLedger(ledger, input, checked.nowMs));
    } catch {
      return reject(
        'reservation-store-unavailable',
        'The capacity ledger could not be read or written safely.',
      );
    }
  }

  heartbeat(reservationId: string, nowMs = Date.now()): ReservationDecision {
    if (typeof reservationId !== 'string' || !isFinitePositive(nowMs)) {
      return reject('invalid-request', 'Reservation heartbeat is invalid.');
    }
    try {
      return this.mutate((ledger) => {
        const record = ledger.reservations.find((entry) => entry.reservationId === reservationId);
        if (!record) return reject('reservation-not-found', 'Reservation does not exist.');
        if (record.status !== 'active') {
          return reject('reservation-not-active', 'Reservation is no longer active.');
        }
        if (nowMs >= record.hardDeadlineAt) {
          return reject('match-expired', 'The match has reached its hard duration limit.');
        }
        if (nowMs >= record.expiresAt) {
          releaseStale(record, nowMs, ledger, 'stale');
          return reject('reservation-expired', 'Reservation lease expired before heartbeat.');
        }
        record.lastHeartbeatAt = nowMs;
        return { ok: true as const, reservation: cloneRecord(record) };
      });
    } catch {
      return reject('reservation-store-unavailable', 'The capacity ledger is unavailable.');
    }
  }

  release(
    reservationId: string,
    usage: ActualRoomUsage = {},
    nowMs = Date.now(),
  ): ReleaseDecision {
    if (typeof reservationId !== 'string' || !isFinitePositive(nowMs)) {
      return reject('invalid-request', 'Reservation release is invalid.');
    }
    try {
      return this.mutate((ledger) => {
        const record = ledger.reservations.find((entry) => entry.reservationId === reservationId);
        if (!record) return reject('reservation-not-found', 'Reservation does not exist.');
        if (record.status === 'released') {
          return { ok: true as const, alreadyReleased: true, reservation: cloneRecord(record) };
        }

        const rawDuration = usage.actualDurationMs ?? record.matchDurationMs;
        const rawRequests = usage.actualRequests ?? record.projectedRequests;
        const actualDurationMs = Number.isFinite(rawDuration)
          ? Math.min(record.matchDurationMs, Math.max(0, Math.floor(rawDuration)))
          : record.matchDurationMs;
        const actualRequests = Number.isFinite(rawRequests)
          ? Math.max(0, Math.floor(rawRequests))
          : record.projectedRequests;
        const day = ensureDay(ledger, dayKey(nowMs));
        day.usedDurationGbSeconds +=
          (actualDurationMs / 1000) * (this.policy.durationMb / 1000);
        day.usedRequests += actualRequests;
        record.status = 'released';
        record.releasedAt = nowMs;
        record.releaseReason = 'normal';
        record.actualDurationMs = actualDurationMs;
        record.actualRequests = actualRequests;
        return { ok: true as const, alreadyReleased: false, reservation: cloneRecord(record) };
      });
    } catch {
      return reject('reservation-store-unavailable', 'The capacity ledger is unavailable.');
    }
  }

  reconcile(nowMs = Date.now()): ReconcileDecision {
    if (!isFinitePositive(nowMs)) return reject('invalid-request', 'Reconcile clock is invalid.');
    try {
      return this.mutate((ledger) => {
        const released = reconcileLedger(ledger, nowMs, this.policy);
        return {
          ok: true as const,
          released: released.map(cloneRecord),
          activeRooms: activeRecords(ledger).length,
        };
      });
    } catch {
      return reject('reservation-store-unavailable', 'The capacity ledger is unavailable.');
    }
  }

  status(nowMs = Date.now()): StatusDecision {
    if (!isFinitePositive(nowMs)) return reject('invalid-request', 'Status clock is invalid.');
    try {
      return this.mutate((ledger) => {
        reconcileLedger(ledger, nowMs, this.policy);
        const day = dayKey(nowMs);
        const usage = ensureDay(ledger, day);
        const reserved = reservedForDay(ledger);
        const active = activeRecords(ledger);
        return {
          ok: true as const,
          day,
          activeRooms: active.length,
          activeReservedDurationGbSeconds: reserved.duration,
          activeReservedRequests: reserved.requests,
          usedDurationGbSeconds: usage.usedDurationGbSeconds,
          usedRequests: usage.usedRequests,
          remainingDurationGbSeconds: Math.max(
            0,
            this.policy.maxDailyDurationGbSeconds - usage.usedDurationGbSeconds - reserved.duration,
          ),
          remainingRequests: Math.max(
            0,
            this.policy.maxDailyRequests - usage.usedRequests - reserved.requests,
          ),
          policy: { ...this.policy },
        };
      });
    } catch {
      return reject('reservation-store-unavailable', 'The capacity ledger is unavailable.');
    }
  }

  private mutate<T>(callback: (ledger: Ledger) => T): T {
    return this.storage.transactionSync(() => {
      const ledger = readLedger(this.storage);
      const result = callback(ledger);
      this.storage.kv.put(RESERVATION_LEDGER_KEY, ledger);
      return result;
    });
  }

  private reserveInLedger(
    ledger: Ledger,
    input: ReservationRequest,
    nowMs: number,
  ): ReserveDecision {
    reconcileLedger(ledger, nowMs, this.policy);

    const existing = ledger.reservations.find((record) => record.requestId === input.requestId);
    if (existing) {
      if (
        fingerprint(input) !==
        `${existing.roomId}|${existing.mode}|${existing.seats}|${existing.matchDurationMs}`
      ) {
        return reject('idempotency-mismatch', 'Request id was already used for another room.');
      }
      if (existing.status === 'released') {
        return reject('reservation-released', 'Request id belongs to an already released reservation.');
      }
      return { ok: true as const, created: false, reservation: cloneRecord(existing) };
    }

    const active = activeRecords(ledger);
    if (active.some((record) => record.roomId === input.roomId)) {
      return reject('room-already-active', 'That room already has an active reservation.');
    }
    if (active.length >= this.policy.maxActiveRooms) {
      return reject('capacity-full', 'No active room slots are available.');
    }

    const durationMs = input.matchDurationMs;
    const day = dayKey(nowMs);
    const usage = ensureDay(ledger, day);
    const reserved = reservedForDay(ledger);
    const duration = durationGbSeconds(durationMs, this.policy);
    const requests = projectedRequestCost(input.seats, durationMs, this.policy);

    if (
      usage.usedDurationGbSeconds + reserved.duration + duration >
      this.policy.maxDailyDurationGbSeconds + 1e-9
    ) {
      return reject('daily-duration-budget', 'Daily Durable Object duration budget is exhausted.');
    }
    if (usage.usedRequests + reserved.requests + requests > this.policy.maxDailyRequests) {
      return reject('daily-request-budget', 'Daily request budget is exhausted.');
    }

    const record: ReservationRecord = {
      reservationId: `r${ledger.nextId++}`,
      requestId: input.requestId,
      roomId: input.roomId,
      mode: input.mode,
      seats: input.seats,
      day,
      createdAt: nowMs,
      matchDurationMs: durationMs,
      hardDeadlineAt: nowMs + durationMs,
      expiresAt: nowMs + durationMs + this.policy.staleAfterMs,
      lastHeartbeatAt: nowMs,
      durationGbSeconds: duration,
      projectedRequests: requests,
      status: 'active',
      releasedAt: null,
      releaseReason: null,
      actualDurationMs: null,
      actualRequests: null,
    };
    ledger.reservations.push(record);
    return { ok: true as const, created: true, reservation: cloneRecord(record) };
  }
}
