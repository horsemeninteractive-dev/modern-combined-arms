/**
 * Conservative free-plan reservation policy.
 *
 * Every value is an input, not a measured guarantee. The comments explain the
 * published allowance or workload assumption behind it. The Phase 0 report's
 * single-room figures are evidence for the shape of the load, not a claim that
 * the free plan supports an uncapped directory.
 */

export type RoomMode = '1v1' | '2v2';

export interface ReservationPolicy {
  /** Hard global concurrency of active room objects. */
  maxActiveRooms: number;
  /** Deliberately below Cloudflare's 13,000 GB-s/day free duration allowance. */
  maxDailyDurationGbSeconds: number;
  /** Below the shared Workers/Pages 100,000 request/day free allowance. */
  maxDailyRequests: number;
  /** Hard cap on one match; the room must stop at this point. */
  maxMatchDurationMs: number;
  /** Multiplier applied to projected incoming-request cost. */
  safetyMargin: number;
  /** Missed heartbeats after which a reservation is reclaimed. */
  staleAfterMs: number;
  /** Conservative command cap used by the server gate. */
  commandHzPerSeat: number;
  /** Snapshot rate is documented but snapshots are outgoing and not billed. */
  snapshotHz: number;
  /** Cloudflare bills Durable Object duration as 128 MB per object. */
  durationMb: number;
  /** One WebSocket upgrade request per connected seat. */
  upgradeRequestsPerSeat: number;
  /** Reserve/heartbeat/release/retry calls to the coordinator and room lifecycle. */
  lifecycleRequests: number;
  /** Incoming WebSocket messages are billed at 20:1. */
  requestsPerIncomingMessage: number;
}

/**
 * 80% of the published free allowances is the safety envelope:
 *   13,000 GB-s/day × 0.8 = 10,400 GB-s/day
 *   100,000 requests/day × 0.8 = 80,000 requests/day
 * A 30-minute four-seat room is 230.4 GB-s. The request estimate uses the
 * 100 ms command cap and does not assume snapshot acknowledgements.
 */
export const DEFAULT_RESERVATION_POLICY: ReservationPolicy = Object.freeze({
  maxActiveRooms: 2,
  maxDailyDurationGbSeconds: 10_400,
  maxDailyRequests: 80_000,
  maxMatchDurationMs: 30 * 60 * 1000,
  safetyMargin: 1.1,
  staleAfterMs: 90_000,
  commandHzPerSeat: 10,
  snapshotHz: 10,
  durationMb: 128,
  upgradeRequestsPerSeat: 1,
  lifecycleRequests: 8,
  requestsPerIncomingMessage: 20,
});

export const ROOM_MODE_SEATS: Readonly<Record<RoomMode, number>> = Object.freeze({
  '1v1': 2,
  '2v2': 4,
});

export function durationGbSeconds(durationMs: number, policy: ReservationPolicy): number {
  return (durationMs / 1000) * (policy.durationMb / 1000);
}

/**
 * Projection for one room:
 *   command messages = seats × command Hz × duration
 *   billed requests = command messages / 20
 *   + upgrades + lifecycle
 *   × safety margin
 *
 * Snapshot acknowledgements are intentionally absent. Outgoing snapshots and
 * WebSocket protocol pings are not billed.
 */
export function projectedRequestCost(
  seats: number,
  durationMs: number,
  policy: ReservationPolicy,
): number {
  const seconds = durationMs / 1000;
  const incoming = seats * policy.commandHzPerSeat * seconds;
  const billedMessages = Math.ceil(incoming / policy.requestsPerIncomingMessage);
  const upgrades = seats * policy.upgradeRequestsPerSeat;
  // Subtract a tiny epsilon so binary floating-point noise (1810 × 1.1 =
  // 1991.0000000000002) does not round a boundary case up by a whole request.
  return Math.ceil(
    (billedMessages + upgrades + policy.lifecycleRequests) * policy.safetyMargin - 1e-9,
  );
}

export function validatePolicy(policy: ReservationPolicy): ReservationPolicy {
  const integerFields: Array<keyof ReservationPolicy> = [
    'maxActiveRooms',
    'maxMatchDurationMs',
    'commandHzPerSeat',
    'snapshotHz',
    'durationMb',
    'upgradeRequestsPerSeat',
    'lifecycleRequests',
    'requestsPerIncomingMessage',
  ];
  for (const field of integerFields) {
    const value = policy[field];
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Reservation policy ${field} must be a positive integer.`);
    }
  }
  for (const field of ['maxDailyDurationGbSeconds', 'maxDailyRequests', 'safetyMargin', 'staleAfterMs'] as const) {
    if (!Number.isFinite(policy[field]) || policy[field] <= 0) {
      throw new Error(`Reservation policy ${field} must be positive.`);
    }
  }
  if (policy.safetyMargin < 1) throw new Error('Reservation policy safety margin must be at least 1.');
  return policy;
}

function envNumber(env: Record<string, unknown>, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Reservation policy ${key} is not a number.`);
  return value;
}

/** Parse only explicitly configured overrides; malformed overrides fail closed. */
export function policyFromEnv(env: Record<string, unknown>): ReservationPolicy {
  return validatePolicy({
    maxActiveRooms: envNumber(env, 'MCA_MAX_ACTIVE_ROOMS', DEFAULT_RESERVATION_POLICY.maxActiveRooms),
    maxDailyDurationGbSeconds: envNumber(
      env,
      'MCA_MAX_DAILY_DURATION_GB_S',
      DEFAULT_RESERVATION_POLICY.maxDailyDurationGbSeconds,
    ),
    maxDailyRequests: envNumber(env, 'MCA_MAX_DAILY_REQUESTS', DEFAULT_RESERVATION_POLICY.maxDailyRequests),
    maxMatchDurationMs: envNumber(
      env,
      'MCA_MAX_MATCH_DURATION_MS',
      DEFAULT_RESERVATION_POLICY.maxMatchDurationMs,
    ),
    safetyMargin: envNumber(env, 'MCA_SAFETY_MARGIN', DEFAULT_RESERVATION_POLICY.safetyMargin),
    staleAfterMs: envNumber(env, 'MCA_STALE_AFTER_MS', DEFAULT_RESERVATION_POLICY.staleAfterMs),
    commandHzPerSeat: envNumber(
      env,
      'MCA_COMMAND_HZ_PER_SEAT',
      DEFAULT_RESERVATION_POLICY.commandHzPerSeat,
    ),
    snapshotHz: envNumber(env, 'MCA_SNAPSHOT_HZ', DEFAULT_RESERVATION_POLICY.snapshotHz),
    durationMb: envNumber(env, 'MCA_DURATION_MB', DEFAULT_RESERVATION_POLICY.durationMb),
    upgradeRequestsPerSeat: envNumber(
      env,
      'MCA_UPGRADE_REQUESTS_PER_SEAT',
      DEFAULT_RESERVATION_POLICY.upgradeRequestsPerSeat,
    ),
    lifecycleRequests: envNumber(
      env,
      'MCA_LIFECYCLE_REQUESTS',
      DEFAULT_RESERVATION_POLICY.lifecycleRequests,
    ),
    requestsPerIncomingMessage: envNumber(
      env,
      'MCA_REQUESTS_PER_INCOMING_MESSAGE',
      DEFAULT_RESERVATION_POLICY.requestsPerIncomingMessage,
    ),
  });
}
