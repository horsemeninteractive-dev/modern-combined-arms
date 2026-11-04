import { defaultScenarioId } from '../data/scenarioCatalog';
import { Game } from '../sim/game';
import {
  RoomMatch,
  restoreRoomMatch,
  seatTokenMatches,
  type RoomSeatDefinition,
  type RoomSocket,
} from './roomMatch';
import { RoomLobby } from './roomLobby';
import {
  buildLobbyScenario,
  defaultLobbyConfig,
  lobbyConfigProblem,
  startConditions,
  validateLobbyConfig,
  type LobbyConfigV1,
} from './lobbyConfig';
import { ROOM_PROTOCOL_VERSION, type RoomPhase } from './protocol';
import {
  CapacityClient,
  ReservationLease,
  ServiceBindingCapacityTransport,
  activateReservedRoom,
} from './reservationClient';
import {
  CAPACITY_COORDINATOR_NAME,
} from './reservationDurableObject';
import type { NeutralMatchResult } from './matchResult';
import type { ReservationRecord } from './reservation';
import type { RoomSnapshot } from './roomSnapshot';
import {
  RoomDiagnostics,
  monotonicNow,
  utf8ByteLength,
  type RoomDiagnosticsSummary,
} from './roomDiagnostics';
import { runClockProbe } from './clockProbe';
import { originPermitted } from './originPolicy';
import { inspectStoredSnapshot, readbackMeta } from './snapshotReadback';
import {
  isCalibrationBatch,
  isCalibrationProfile,
  runBatchCalibration,
} from './batchCalibration';

/**
 * Cloudflare Durable Object adapter for one authoritative room.
 *
 * The Worker is the only public route. Admin requests require MP_ADMIN_TOKEN.
 * A room reserves the global capacity ledger before it allocates a Game, and
 * every close path releases the lease idempotently.
 */

const META_KEY = 'mca-mp-room-meta-v1';
const DIAGNOSTICS_KEY = 'mca-mp-room-diagnostics-v1';
const SNAPSHOT_INDEX_KEY = 'mca-mp-room-snapshot-index-v1';
const SNAPSHOT_CHUNK_PREFIX = 'mca-mp-room-snapshot-v1:';
const SNAPSHOT_CHUNK_CHARS = 48_000;
const MAX_SNAPSHOT_CHUNKS = 128;
/** Storage layout, exported so evidence tooling and tests read the real keys. */
export const ROOM_STORAGE_KEYS = {
  meta: META_KEY,
  diagnostics: DIAGNOSTICS_KEY,
  snapshotIndex: SNAPSHOT_INDEX_KEY,
  snapshotChunkPrefix: SNAPSHOT_CHUNK_PREFIX,
  snapshotChunkChars: SNAPSHOT_CHUNK_CHARS,
} as const;
const DEFAULT_HEARTBEAT_MS = 20_000;
const PERSIST_MS = 15_000;
/**
 * Wall-clock time a lobby may occupy before its match starts.
 *
 * A room holds its capacity reservation from creation, so the wait before the
 * host starts is real reserved time. The room therefore reserves the match
 * duration *plus* this allowance, and the match deadline is still derived from
 * the configured duration alone at start. The allowance is clamped by the
 * existing 30-minute cap, so a maximum-length match simply has no lobby
 * headroom rather than exceeding the policy.
 */
const LOBBY_ALLOWANCE_MS = 5 * 60 * 1000;
const TICK_WAKE_MS = 50;
const MAX_CATCHUP_TICKS = 3;

export interface MatchRoomEnv {
  CAPACITY: DurableObjectNamespace;
  MCA_RESERVATION_TOKEN?: string;
  MP_ONLINE_ENABLED?: string;
  MP_ADMIN_TOKEN?: string;
  MP_ALLOWED_ORIGINS?: string;
  MP_ALLOW_NO_ORIGIN?: string;
  MP_DEFAULT_MATCH_SECONDS?: string;
  MP_MAX_MATCH_SECONDS?: string;
  MP_ABANDON_AFTER_MS?: string;
  MP_HEARTBEAT_MS?: string;
  MP_DEV_MODE?: string;
  /**
   * Shared secret for verifying MCA account identity tickets. Optional: with no
   * secret the room is guest-only, exactly as it was before accounts existed.
   * The ticket is verified in the Worker, never in this Durable Object.
   */
  MCA_IDENTITY_TICKET_SECRET?: string;
  ROOMS: DurableObjectNamespace;
}

interface PersistedMeta {
  version: 1;
  roomId: string;
  mode: '1v1';
  seats: RoomSeatDefinition[];
  reservation: ReservationRecord;
  createdAt: number;
  matchDurationMs: number;
  started: boolean;
  /** Durable match timing. Optional on rooms created before Phase 2A.11. */
  startedAtMs?: number | null;
  /**
   * Authoritative match deadline, fixed once at the explicit start as
   * `startedAtMs + matchDurationMs`. It is persisted so a restored match keeps
   * its original deadline, and it is `null` for a room that has not started.
   */
  matchDeadlineAt?: number | null;
  /**
   * Lobby configuration, present from creation until the match starts. A room
   * with `started: false` is restored from this and its seat table alone, with
   * no snapshot and no `Game`.
   */
  lobbyConfig?: LobbyConfigV1 | null;
  /**
   * Short secret a guest must present to claim seat 1. It is never returned by
   * the status route, only by the create/join responses for the caller's own
   * seat, so knowing a room id is not enough to take the guest seat.
   */
  joinCode?: string | null;
  finishedAtMs?: number | null;
  totalTicks?: number;
  closed: boolean;
  closedReason: string | null;
  closedAt: number | null;
  finalResult: NeutralMatchResult | null;
}

interface SnapshotIndex {
  version: 1;
  generation: string;
  chunks: number;
  length: number;
  tick: number;
  updatedAt: number;
}

interface CreateBody {
  roomId?: unknown;
  mode?: unknown;
  matchDurationMs?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function envNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Validate the small durable room envelope before it can supply a deadline or
 * a start-time fallback. The recovery snapshot remains the authority for the
 * world; this check exists so corrupt metadata cannot silently widen a match
 * or install a nonsensical fallback. Older rooms may omit the timing fields.
 */
export function validatePersistedMeta(meta: unknown, roomId: string): string | null {
  if (!isRecord(meta)) return 'metadata is not an object';
  if (meta.version !== 1 || meta.roomId !== roomId) return 'metadata identity is invalid';
  if (meta.mode !== '1v1') return 'metadata mode is invalid';
  if (!isInteger(meta.createdAt) || meta.createdAt < 0) return 'metadata creation time is invalid';
  if (
    !isInteger(meta.matchDurationMs) ||
    meta.matchDurationMs < 1 ||
    meta.matchDurationMs > 24 * 60 * 60 * 1000
  ) {
    return 'metadata match duration is invalid';
  }
  if (typeof meta.started !== 'boolean' || typeof meta.closed !== 'boolean') {
    return 'metadata lifecycle flags are invalid';
  }
  if (!isRecord(meta.reservation)) return 'metadata reservation is missing';
  const deadline = meta.reservation.hardDeadlineAt;
  if (!isInteger(deadline) || deadline < meta.createdAt) {
    return 'metadata reservation deadline is invalid';
  }
  if (meta.reservation.status === 'released' && !meta.closed) {
    return 'metadata reservation was released before closure';
  }
  if (!Array.isArray(meta.seats) || meta.seats.length !== 2) {
    return 'metadata seat table is invalid';
  }
  const seatIds = new Set<number>();
  const playerIds = new Set<number>();
  for (const seat of meta.seats) {
    if (!isRecord(seat)) return 'metadata seat entry is invalid';
    if (
      !isInteger(seat.seatId) ||
      (seat.seatId !== 0 && seat.seatId !== 1) ||
      seatIds.has(seat.seatId) ||
      !isInteger(seat.playerId) ||
      seat.playerId < 0 ||
      seat.playerId > 7 ||
      playerIds.has(seat.playerId) ||
      (seat.team !== 0 && seat.team !== 1) ||
      typeof seat.token !== 'string' ||
      seat.token.length < 16 ||
      seat.token.length > 128
    ) {
      return 'metadata seat identity is invalid';
    }
    if (
      seat.accountId !== undefined &&
      seat.accountId !== null &&
      (typeof seat.accountId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(seat.accountId))
    ) {
      return 'metadata seat account is invalid';
    }
    seatIds.add(seat.seatId);
    playerIds.add(seat.playerId);
  }
  if (meta.startedAtMs !== undefined && meta.startedAtMs !== null) {
    if (!isInteger(meta.startedAtMs) || meta.startedAtMs < 0 || meta.startedAtMs > deadline) {
      return 'metadata match start is invalid';
    }
    if (!meta.started) return 'metadata has a match start but never started';
  }
  if (meta.matchDeadlineAt !== undefined && meta.matchDeadlineAt !== null) {
    if (!isInteger(meta.matchDeadlineAt) || meta.matchDeadlineAt < meta.createdAt) {
      return 'metadata match deadline is invalid';
    }
    if (meta.matchDeadlineAt > deadline) {
      return 'metadata match deadline exceeds its reservation';
    }
    if (meta.startedAtMs !== undefined && meta.startedAtMs !== null && meta.matchDeadlineAt < meta.startedAtMs) {
      return 'metadata match deadline precedes its start';
    }
    if (!meta.started) return 'metadata has a match deadline but never started';
  }
  if (meta.lobbyConfig !== undefined && meta.lobbyConfig !== null) {
    const lobbyProblem = lobbyConfigProblem(meta.lobbyConfig);
    if (lobbyProblem) return `metadata lobby configuration is invalid (${lobbyProblem})`;
  }
  if (meta.joinCode !== undefined && meta.joinCode !== null) {
    if (typeof meta.joinCode !== 'string' || !/^[A-Za-z0-9]{8,32}$/.test(meta.joinCode)) {
      return 'metadata join code is invalid';
    }
  }
  if (meta.finishedAtMs !== undefined && meta.finishedAtMs !== null) {
    if (!isInteger(meta.finishedAtMs) || meta.finishedAtMs < 0) {
      return 'metadata match finish is invalid';
    }
    if (
      meta.startedAtMs !== undefined &&
      meta.startedAtMs !== null &&
      meta.finishedAtMs < meta.startedAtMs
    ) {
      return 'metadata match finish precedes its start';
    }
  }
  if (meta.totalTicks !== undefined && (!isInteger(meta.totalTicks) || meta.totalTicks < 0)) {
    return 'metadata tick total is invalid';
  }
  if (meta.closedAt !== null && meta.closedAt !== undefined && !isInteger(meta.closedAt)) {
    return 'metadata close time is invalid';
  }
  return null;
}

function adminTokenMatches(expected: string | undefined, supplied: string | null): boolean {
  if (!expected || !supplied) return false;
  if (expected.length !== supplied.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}

function securityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...securityHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function failure(code: string, message: string, status = 400): Response {
  return json({ ok: false, code, message }, status);
}

function extractRoomId(pathname: string): string | null {
  const match = /\/rooms\/([A-Za-z0-9_-]{1,64})(?:\/|$)/.exec(pathname);
  return match ? match[1] : null;
}

function protocolToken(header: string | null): { version: boolean; token: string | null } {
  if (!header) return { version: false, token: null };
  let version = false;
  let token: string | null = null;
  for (const raw of header.split(',')) {
    const value = raw.trim();
    if (value === `mca.v${ROOM_PROTOCOL_VERSION}`) version = true;
    if (value.startsWith('mca.token.')) {
      if (token !== null) return { version, token: null };
      token = value.slice('mca.token.'.length);
    }
  }
  return { version, token: token && token.length >= 16 && token.length <= 128 ? token : null };
}

function chunkText(value: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += SNAPSHOT_CHUNK_CHARS) {
    chunks.push(value.slice(offset, offset + SNAPSHOT_CHUNK_CHARS));
  }
  return chunks;
}

function originAllowed(request: Request, env: MatchRoomEnv): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return env.MP_ALLOW_NO_ORIGIN === '1';
  if (origin === new URL(request.url).origin) return true;
  // Development only: a loopback page may open a socket on a local room worker.
  // The worker grants the same admission for its HTTP surface, so a local
  // lobby does not work over POST and then fail at the upgrade.
  if (env.MP_DEV_MODE === '1' && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(origin)) {
    return true;
  }
  return originPermitted(origin, env.MP_ALLOWED_ORIGINS);
}

function onlineEnabled(env: MatchRoomEnv): boolean {
  return env.MP_ONLINE_ENABLED === '1';
}

/**
 * The class is stateless across eviction. `load()` reconstructs the Game from
 * a validated room snapshot before any socket is allowed in.
 */
export class MatchRoomDurableObject {
  private readonly env: MatchRoomEnv;
  private readonly state: DurableObjectState;
  private readonly storage: DurableObjectStorage;
  private meta: PersistedMeta | null = null;
  private match: RoomMatch | null = null;
  /** Pre-match half of the room. Mutually exclusive with `match`. */
  private lobby: RoomLobby | null = null;
  private lease: ReservationLease | null = null;
  private roomId: string | null = null;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private fatal: string | null = null;
  private closed = false;
  private creating: Promise<Response> | null = null;
  /** Serialises explicit starts so two host requests cannot build two games. */
  private starting: Promise<Response> | null = null;
  private finishing: Promise<void> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  /** Serialises full-snapshot writes so a later generation cannot be indexed
   * and then overwritten by an older writer that was still awaiting storage. */
  private snapshotWrite: Promise<void> = Promise.resolve();
  private nextTickAt: number | null = null;
  private lastHeartbeatAt = 0;
  private readonly diagnostics = new RoomDiagnostics();
  private finalDiagnostics: RoomDiagnosticsSummary | null = null;

  constructor(state: DurableObjectState, env: MatchRoomEnv) {
    this.state = state;
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomId = extractRoomId(url.pathname);
    if (!roomId) return failure('not-found', 'Room route is not valid.', 404);
    if (this.roomId && this.roomId !== roomId) {
      return failure('room-mismatch', 'This object belongs to another room.', 409);
    }
    this.roomId = roomId;
    // Read-only inspection is dispatched before ensureLoaded() on purpose: it
    // must not restore a Game, arm a timer, take a lease or write storage. A
    // closed room would skip restore anyway, but an active one would not, and
    // "inspect" must never be a lifecycle action.
    const inspectAction = request.headers.get('X-MCA-Room-Action');
    if (
      (inspectAction === 'snapshot' || url.pathname.endsWith('/internal/snapshot')) &&
      request.method === 'GET'
    ) {
      return this.handleSnapshotReadback(request, url);
    }
    try {
      await this.ensureLoaded();
    } catch {
      return failure('room-state-unavailable', 'Room state could not be loaded.', 503);
    }
    if (this.fatal) return failure('room-state-unavailable', this.fatal, 503);

    if (url.pathname.endsWith('/ws')) return this.handleWebSocket(request, url);
    const action = request.headers.get('X-MCA-Room-Action');
    if ((action === 'create' || url.pathname.endsWith('/internal/create')) && request.method === 'POST') {
      return this.handleCreate(request);
    }
    if ((action === 'open' || url.pathname.endsWith('/internal/open')) && request.method === 'POST') {
      return this.handleOpen(request);
    }
    if ((action === 'join' || url.pathname.endsWith('/internal/join')) && request.method === 'POST') {
      return this.handleJoin(request);
    }
    if ((action === 'status' || url.pathname.endsWith('/internal/status')) && request.method === 'GET') {
      return this.handleStatus(request);
    }
    if ((action === 'start' || url.pathname.endsWith('/internal/start')) && request.method === 'POST') {
      return this.handleStart(request);
    }
    if ((action === 'shutdown' || url.pathname.endsWith('/internal/shutdown')) && request.method === 'POST') {
      return this.handleShutdown(request);
    }
    if ((action === 'restart' || url.pathname.endsWith('/internal/restart')) && request.method === 'POST') {
      return this.handleRestart(request);
    }
    return failure('not-found', 'Room route is not valid.', 404);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loaded = true;
      });
    }
    await this.loading;
  }

  private async load(): Promise<void> {
    const metaReadStartedAt = monotonicNow();
    const storedMeta = await this.storage.get<unknown>(META_KEY);
    this.diagnostics.recordPersistenceOperation('read', monotonicNow() - metaReadStartedAt);
    if (!storedMeta) return;
    const metaProblem = validatePersistedMeta(storedMeta, this.roomId ?? '');
    if (metaProblem) {
      this.fatal = `Persisted room metadata is invalid: ${metaProblem}.`;
      return;
    }
    const meta = storedMeta as PersistedMeta;
    this.meta = meta;
    this.closed = meta.closed;
    this.diagnostics.markActivated(meta.createdAt);
    if (meta.closed) {
      this.diagnostics.markClosed(meta.closedReason ?? 'room-closed', meta.closedAt ?? Date.now());
      const diagnosticsReadStartedAt = monotonicNow();
      const storedDiagnostics = await this.storage.get<RoomDiagnosticsSummary>(DIAGNOSTICS_KEY);
      this.diagnostics.recordPersistenceOperation(
        'read',
        monotonicNow() - diagnosticsReadStartedAt,
      );
      if (
        storedDiagnostics &&
        isRecord(storedDiagnostics) &&
        storedDiagnostics.version === 1
      ) {
        this.finalDiagnostics = storedDiagnostics as unknown as RoomDiagnosticsSummary;
      }
      return;
    }

    let snapshot: RoomSnapshot;
    try {
      // A room that has never started is restored from durable metadata alone.
      // No snapshot is read, no Game is constructed and no match clock exists,
      // so a lobby survives eviction without inventing an authoritative world.
      if (!meta.started) {
        this.restoreLobby(meta);
        return;
      }
      snapshot = await this.loadSnapshot();
      const restoredAtMs = Date.now();
      this.match = restoreRoomMatch({
        roomId: meta.roomId,
        seats: meta.seats,
        matchDurationMs: meta.matchDurationMs,
        matchDeadlineAt: meta.matchDeadlineAt ?? meta.reservation.hardDeadlineAt,
        snapshot,
        phase:
          snapshot.result.phase === 'finished'
            ? 'finished'
            : 'playing',
        now: restoredAtMs,
        restoredAtMs,
        startedAtMs: meta.startedAtMs ?? null,
        finishedAtMs: meta.finishedAtMs ?? null,
        abandonAfterMs: this.abandonAfterMs(),
        diagnostics: this.diagnostics,
      });
      // Persist the fenced generation and resolved timing before any socket is
      // admitted. A second restart must not restore the same pre-fence epoch
      // and then collide with a client that already accepted the fence.
      try {
        await this.persistSnapshot(restoredAtMs);
      } catch (error) {
        // Without the fenced generation on disk, a second restart could
        // restore a lower epoch than a client already accepted. Refuse to
        // admit sockets until an operator can inspect or retry storage.
        this.fatal = 'Restored room epoch could not be persisted.';
        console.error('MP room restore checkpoint failed', error);
        return;
      }
      this.armTimers();
      if (this.match.currentPhase === 'finished') void this.finalize();
    } catch (error) {
      this.fatal = 'Room snapshot could not be restored.';
      console.error('MP room restore failed', error);
    }
  }

  private capacityClient(): CapacityClient {
    const namespace = this.env.CAPACITY;
    const token = String(this.env.MCA_RESERVATION_TOKEN ?? '');
    const binding = {
      fetch: (input: string, init?: RequestInit): Promise<Response> => {
        const id = namespace.idFromName(CAPACITY_COORDINATOR_NAME);
        return namespace.get(id).fetch(input, init);
      },
    };
    return new CapacityClient(new ServiceBindingCapacityTransport(binding, token));
  }

  private abandonAfterMs(): number {
    return Math.max(5000, envNumber(this.env.MP_ABANDON_AFTER_MS, 30_000));
  }

  private heartbeatMs(): number {
    return Math.max(1000, envNumber(this.env.MP_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS));
  }

  private durationBounds(): { min: number; max: number; fallback: number } {
    const max = Math.max(
      10_000,
      Math.min(30 * 60 * 1000, envNumber(this.env.MP_MAX_MATCH_SECONDS, 1800) * 1000),
    );
    const fallback = Math.min(max, Math.max(10_000, envNumber(this.env.MP_DEFAULT_MATCH_SECONDS, 60) * 1000));
    return { min: 10_000, max, fallback };
  }

  private async handleCreate(request: Request): Promise<Response> {
    if (!onlineEnabled(this.env)) return failure('online-disabled', 'Online rooms are disabled.', 503);
    if (!this.adminAllowed(request)) return failure('unauthorized', 'Admin token is not valid.', 403);
    if (!this.roomId) return failure('not-found', 'Room id is missing.', 404);
    if (this.meta) {
      if (this.meta.closed) return failure('room-closed', 'This room has already closed.', 410);
      return json(this.roomInfo(true));
    }
    if (this.creating) {
      return failure('room-starting', 'This room is already being created.', 409);
    }
    const operation = this.createRoom(request);
    this.creating = operation;
    try {
      return await operation;
    } finally {
      if (this.creating === operation) this.creating = null;
    }
  }

  /**
   * Public lobby creation: the caller becomes the host and receives only its
   * own seat token plus the join code for the other seat. A browser therefore
   * never sees seat 1's authority.
   */
  private async handleOpen(request: Request): Promise<Response> {
    if (!onlineEnabled(this.env)) return failure('online-disabled', 'Online rooms are disabled.', 503);
    if (!this.roomId) return failure('not-found', 'Room id is missing.', 404);
    if (this.meta) return failure('room-exists', 'That room code is already in use.', 409);
    if (this.creating) return failure('room-starting', 'This room is already being created.', 409);
    const operation = this.createRoom(request, true);
    this.creating = operation;
    try {
      return await operation;
    } finally {
      if (this.creating === operation) this.creating = null;
    }
  }

  /**
   * Claim seat 1 with the join code.
   *
   * The code is the only secret the guest has, and it is compared in constant
   * time. A started or closed room cannot be joined, and the response never
   * contains the host's token.
   */
  private async handleJoin(request: Request): Promise<Response> {
    if (!onlineEnabled(this.env)) return failure('online-disabled', 'Online rooms are disabled.', 503);
    if (!this.meta) return failure('room-not-found', 'That room code does not exist.', 404);
    if (this.meta.closed) return failure('room-closed', 'That room has closed.', 410);
    if (this.starting) {
      try {
        await this.starting;
      } catch {
        /* the start request reports its own failure */
      }
    }
    if (this.match) return failure('match-started', 'That match has already started.', 409);
    const code = await this.readJoinCode(request);
    if (!code.ok) return failure(code.code, code.message, 400);
    if (!this.meta.joinCode || !seatTokenMatches(code.code, this.meta.joinCode)) {
      return failure('invalid-join-code', 'That join code is not valid for this room.', 403);
    }
    const lobby = this.lobby;
    if (!lobby) return failure('room-not-found', 'That room does not exist.', 404);
    // Joining is the only moment seat 1's identity can be established, so the
    // verified account is recorded before the token is handed out.
    const joinerAccount = this.verifiedAccount(request);
    if (joinerAccount && this.meta.seats[1].accountId !== joinerAccount) {
      this.meta.seats[1] = { ...this.meta.seats[1], accountId: joinerAccount };
      try {
        await this.persistMeta();
      } catch {
        return failure('room-state-unavailable', 'Seat identity could not be recorded.', 503);
      }
    }
    return json({
      ok: true,
      roomId: this.meta.roomId,
      seat: 1,
      token: this.meta.seats[1].token,
      protocol: ROOM_PROTOCOL_VERSION,
      matchDurationMs: this.meta.matchDurationMs,
      lobby: lobby.state(1),
    });
  }

  private async readJoinCode(
    request: Request,
  ): Promise<{ ok: true; code: string } | { ok: false; code: string; message: string }> {
    let text: string;
    try {
      text = await request.text();
    } catch {
      return { ok: false, code: 'invalid-request', message: 'Request body is missing.' };
    }
    if (text.length > 512) {
      return { ok: false, code: 'payload-too-large', message: 'Request body is too large.' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, code: 'invalid-request', message: 'Request body is not valid JSON.' };
    }
    if (!isRecord(parsed) || typeof parsed.code !== 'string') {
      return { ok: false, code: 'invalid-request', message: 'A join code is required.' };
    }
    if (!/^[A-Za-z0-9]{8,32}$/.test(parsed.code)) {
      return { ok: false, code: 'invalid-request', message: 'A join code is required.' };
    }
    return { ok: true, code: parsed.code };
  }

  private async createRoom(request: Request, publicView = false): Promise<Response> {
    const roomId = this.roomId;
    if (!roomId) return failure('not-found', 'Room id is missing.', 404);
    const body = await this.readCreateBody(request);
    if (!body.ok) return failure(body.code, body.message, 400);
    const bounds = this.durationBounds();
    const matchDurationMs =
      body.matchDurationMs === undefined
        ? bounds.fallback
        : Number(body.matchDurationMs);
    if (
      !Number.isInteger(matchDurationMs) ||
      matchDurationMs < bounds.min ||
      matchDurationMs > bounds.max
    ) {
      return failure('invalid-duration', 'Match duration is outside the allowed range.', 400);
    }
    if (body.mode !== '1v1') return failure('mode-unavailable', 'Only 1v1 rooms are available.', 400);

    const now = Date.now();
    const requestId = `mp2a:${roomId}`;
    const joinCode = this.newJoinCode();
    let lease: ReservationLease | null = null;
    let createdLobby: RoomLobby | null = null;
    let createdMeta: PersistedMeta | null = null;

    try {
      const decision = await activateReservedRoom(
        this.capacityClient(),
        {
          requestId,
          roomId,
          mode: '1v1',
          seats: 2,
          // Reserve the lobby wait as well as the match, bounded by the
          // unchanged 30-minute cap. `meta.matchDurationMs` stays the duration
          // the host actually chose.
          matchDurationMs: Math.min(bounds.max, matchDurationMs + LOBBY_ALLOWANCE_MS),
        },
        async (activeLease) => {
          lease = activeLease;
          const seats: RoomSeatDefinition[] = [
            {
              seatId: 0,
              playerId: 0,
              team: 0,
              token: this.seatToken(),
              accountId: this.verifiedAccount(request),
            },
            { seatId: 1, playerId: 1, team: 1, token: this.seatToken(), accountId: null },
          ];
          // Creation makes a lobby, not a match: no scenario, no Game and no
          // snapshot. The authoritative world is built only by an accepted
          // start, which keeps a waiting room cheap and restorable.
          const config = defaultLobbyConfig(defaultScenarioId('multiplayer'), matchDurationMs);
          const lobby = new RoomLobby({
            roomId,
            seats,
            config,
            hardDeadlineAt: activeLease.reservation.hardDeadlineAt,
            now,
            onChanged: () => void this.persistLobbyMeta(),
          });
          createdMeta = {
            version: 1,
            roomId,
            mode: '1v1',
            seats,
            reservation: activeLease.reservation,
            createdAt: now,
            matchDurationMs,
            started: false,
            startedAtMs: null,
            matchDeadlineAt: null,
            lobbyConfig: config,
            joinCode,
            finishedAtMs: null,
            totalTicks: 0,
            closed: false,
            closedReason: null,
            closedAt: null,
            finalResult: null,
          };
          createdLobby = lobby;
          this.lobby = lobby;
          this.meta = createdMeta;
          await this.persistMeta();
        },
      );
      if (!decision.ok) {
        this.lobby = null;
        this.meta = null;
        return failure(decision.code, decision.message, 503);
      }
      if (!lease || !createdLobby || !createdMeta) {
        this.lobby = null;
        this.meta = null;
        return failure('reservation-store-unavailable', 'Room reservation did not complete.', 503);
      }
      this.lease = lease;
      this.lastHeartbeatAt = now;
      this.diagnostics.markActivated(now);
      this.armTimers();
      return json(publicView ? this.publicRoomInfo() : this.roomInfo(false));
    } catch {
      this.match = null;
      this.lobby = null;
      this.meta = null;
      this.lease = null;
      return failure('reservation-store-unavailable', 'Room could not be created safely.', 503);
    }
  }

  private async readCreateBody(request: Request): Promise<
    | { ok: true; mode: unknown; matchDurationMs: unknown }
    | { ok: false; code: string; message: string }
  > {
    let text: string;
    try {
      text = await request.text();
    } catch {
      return { ok: false, code: 'invalid-request', message: 'Request body is missing.' };
    }
    if (text.length > 2048) {
      return { ok: false, code: 'payload-too-large', message: 'Request body is too large.' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, code: 'invalid-request', message: 'Request body is not valid JSON.' };
    }
    if (!isRecord(parsed)) {
      return { ok: false, code: 'invalid-request', message: 'Request body must be an object.' };
    }
    const body = parsed as CreateBody;
    if (body.roomId !== undefined && body.roomId !== this.roomId) {
      return { ok: false, code: 'room-mismatch', message: 'Room id does not match the route.' };
    }
    return { ok: true, mode: body.mode, matchDurationMs: body.matchDurationMs };
  }

  private roomInfo(already: boolean): Record<string, unknown> {
    if (!this.meta) throw new Error('Room has no metadata.');
    return {
      ok: true,
      already,
      roomId: this.meta.roomId,
      mode: this.meta.mode,
      protocol: ROOM_PROTOCOL_VERSION,
      phase: this.match?.currentPhase ?? (this.meta.closed ? 'closed' : 'lobby'),
      matchDurationMs: this.meta.matchDurationMs,
      matchDeadlineAt: this.meta.reservation.hardDeadlineAt,
      seats: this.meta.seats.map((seat) => ({
        seatId: seat.seatId,
        playerId: seat.playerId,
        team: seat.team,
        token: seat.token,
        // Both seats read this document, so it reports only whether the seat is
        // a verified account. The account id stays server-side until Stage 2's
        // profile presentation decides what is public.
        verified: Boolean(seat.accountId),
      })),
    };
  }

  private seatToken(): string {
    return crypto.randomUUID().replace(/-/g, '');
  }

  /**
   * The account this request was verified as, if any.
   *
   * This header is set by the room Worker after it has verified a signed
   * identity ticket. The Durable Object never reads a ticket itself and never
   * accepts an account id from a request body, so an unverified caller cannot
   * name itself. A guest simply has no header.
   */
  private verifiedAccount(request: Request): string | null {
    const value = request.headers.get('X-MCA-Verified-Account');
    return value && /^[A-Za-z0-9_-]{16,64}$/.test(value) ? value : null;
  }

  /** Human-shareable secret for the guest seat. Ambiguous characters are out. */
  private newJoinCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    let code = '';
    for (const byte of bytes) code += alphabet[byte % alphabet.length];
    return code;
  }

  /** What the host receives for its own seat, and nothing else. */
  private publicRoomInfo(): Record<string, unknown> {
    if (!this.meta) throw new Error('Room has no metadata.');
    return {
      ok: true,
      roomId: this.meta.roomId,
      seat: 0,
      token: this.meta.seats[0].token,
      joinCode: this.meta.joinCode ?? null,
      protocol: ROOM_PROTOCOL_VERSION,
      mode: this.meta.mode,
      matchDurationMs: this.meta.matchDurationMs,
      matchDeadlineAt: this.meta.reservation.hardDeadlineAt,
      lobby: this.lobby?.state(0) ?? null,
    };
  }

  /**
   * Restore a room that has not started.
   *
   * Only durable metadata is used: the seat table (tokens, ids, teams), the
   * reservation identity and deadline, and the lobby configuration. No snapshot
   * is read and no `Game` is constructed, so a lobby cannot be mistaken for a
   * match and an evicted pre-match room costs nothing to bring back.
   */
  private restoreLobby(meta: PersistedMeta): void {
    const stored = meta.lobbyConfig;
    let config: LobbyConfigV1;
    if (stored === undefined || stored === null) {
      // A room created before Phase 2B.1 persisted a tick-zero snapshot instead
      // of a lobby configuration. Its reservation duration and the default map
      // are the only durable facts available, so adopt them explicitly. A
      // stored-but-malformed configuration is still fatal below.
      config = defaultLobbyConfig(defaultScenarioId('multiplayer'), meta.matchDurationMs);
      console.warn('MP room lobby configuration upgraded from legacy metadata', meta.roomId);
    } else {
      const parsed = validateLobbyConfig(stored);
      if (!parsed.ok) {
        this.fatal = `Persisted lobby configuration is invalid: ${parsed.problem.message}`;
        return;
      }
      config = parsed.config;
    }
    this.meta = { ...meta, lobbyConfig: config };
    this.lease = new ReservationLease(this.capacityClient(), this.meta.reservation);
    this.lobby = new RoomLobby({
      roomId: meta.roomId,
      seats: meta.seats,
      config,
      hardDeadlineAt: meta.reservation.hardDeadlineAt,
      now: meta.createdAt,
      onChanged: () => void this.persistLobbyMeta(),
    });
    this.diagnostics.markActivated(meta.createdAt);
    this.armTimers();
  }

  /** Readiness is lobby state, so it is persisted with the rest of the lobby. */
  private persistLobbyMeta(): Promise<void> {
    const lobby = this.lobby;
    if (!lobby || !this.meta || this.meta.closed) return Promise.resolve();
    this.meta.lobbyConfig = lobby.lobbyConfig;
    return this.persistMeta().catch((error: unknown) => {
      console.error('MP room lobby persistence failed', error);
    });
  }

  /**
   * Resolve the calling seat from its own token. Nothing in the request body
   * says who the caller is, so a client cannot claim to be the host.
   */
  private seatFromAuthorization(request: Request): number | null {
    const header = request.headers.get('Authorization') ?? '';
    if (!header.startsWith('Room ')) return null;
    const token = header.slice('Room '.length).trim();
    if (!this.meta || token.length < 16 || token.length > 128) return null;
    for (const seat of this.meta.seats) {
      if (seatTokenMatches(token, seat.token)) return seat.seatId;
    }
    return null;
  }

  /**
   * Explicit match start.
   *
   * The caller authenticates with its own seat token and the room decides which
   * seat that is, so no client flag, team id, seat id or player id can grant
   * start authority. Everything after the authority check is validation; the
   * transition itself is a single durable commit in `beginMatch`.
   */
  private async handleStart(request: Request): Promise<Response> {
    if (!this.meta) return failure('room-not-found', 'Room does not exist.', 404);
    const caller = this.seatFromAuthorization(request);
    if (caller === null) return failure('unauthorized', 'A valid seat token is required.', 401);
    if (this.meta.closed) return failure('room-closed', 'This room has already closed.', 410);
    // Wait out any start already in flight, then answer from the settled state.
    if (this.starting) {
      try {
        await this.starting;
      } catch {
        /* the request that owns the transition reports its own failure */
      }
    }
    if (this.match) {
      // A duplicate start is a no-op: never a second game, never a new timer.
      return json({
        ok: true,
        alreadyStarted: true,
        phase: this.match.currentPhase,
        startedAtMs: this.match.startedAt,
        matchDeadlineAt: this.match.matchDeadlineAt,
        tick: this.match.game.state.tick,
      });
    }
    const lobby = this.lobby;
    if (!lobby) return failure('room-not-found', 'Room does not exist.', 404);
    if (caller !== lobby.hostSeatId) {
      return failure('not-host', 'Only the host can start the match.', 403);
    }
    const problems = startConditions({
      seats: lobby.occupancy(),
      config: lobby.lobbyConfig,
      hardDeadlineAt: this.meta.reservation.hardDeadlineAt,
      released: this.lease?.isReleased ?? false,
      now: Date.now(),
    });
    const first = problems[0];
    if (first) return failure(first.code, first.message, 409);

    const operation = this.beginMatch(lobby, caller, Date.now());
    this.starting = operation;
    try {
      return await operation;
    } finally {
      if (this.starting === operation) this.starting = null;
    }
  }

  /**
   * The start transition.
   *
   * Ordering is the whole point: build the world, persist it, commit the
   * lifecycle, and only then let a seat see `playing`. A failure before the
   * metadata commit leaves a lobby the host can start again; a failure after it
   * leaves a restorable active match with its original deadline. There is no
   * window in which the room reports `playing` with no recoverable game.
   */
  private async beginMatch(lobby: RoomLobby, startedBy: number, startedAt: number): Promise<Response> {
    const meta = this.meta;
    if (!meta) return failure('room-not-found', 'Room does not exist.', 404);
    const config = lobby.lobbyConfig;
    const matchDeadlineAt = startedAt + config.matchDurationMs;
    const previous = {
      started: meta.started,
      startedAtMs: meta.startedAtMs,
      matchDeadlineAt: meta.matchDeadlineAt,
      matchDurationMs: meta.matchDurationMs,
      totalTicks: meta.totalTicks,
    };

    let match: RoomMatch;
    try {
      const scenario = buildLobbyScenario(config);
      const game = new Game(scenario, { localPlayerId: -1, enableAI: false });
      // The single-player opening notice belongs to a local player; a room has
      // none, so drop that presentation-only event before the first projection.
      game.state.events = [];
      game.state.eventSeq = 1;
      match = new RoomMatch({
        roomId: meta.roomId,
        mode: '1v1',
        seats: meta.seats,
        matchDurationMs: config.matchDurationMs,
        matchDeadlineAt,
        now: startedAt,
        game,
        phase: 'playing',
        startedAtMs: startedAt,
        abandonAfterMs: this.abandonAfterMs(),
        diagnostics: this.diagnostics,
      });
    } catch (error) {
      console.error('MP room match construction failed', error);
      return failure('match-build-failed', 'The match could not be built from this lobby.', 500);
    }

    this.match = match;
    meta.started = true;
    meta.startedAtMs = startedAt;
    meta.matchDeadlineAt = matchDeadlineAt;
    meta.matchDurationMs = config.matchDurationMs;
    meta.totalTicks = 0;
    try {
      await this.persistSnapshot(startedAt);
      await this.persistMeta();
    } catch (error) {
      console.error('MP room start persistence failed', error);
      this.match = null;
      meta.started = previous.started;
      meta.startedAtMs = previous.startedAtMs;
      meta.matchDeadlineAt = previous.matchDeadlineAt;
      meta.matchDurationMs = previous.matchDurationMs;
      meta.totalTicks = previous.totalTicks;
      return failure(
        'match-start-not-durable',
        'The match could not be started safely. Retry the start.',
        503,
      );
    }

    // Commit: the sockets the seats already hold become match sockets, and each
    // seat is told the match is playing by the match hello and baseline sync.
    this.lobby = null;
    const now = Date.now();
    for (const seat of meta.seats) {
      const socket = lobby.socketFor(seat.seatId);
      if (!socket) continue;
      match.connect(seat.seatId, seat.token, socket, now);
    }
    lobby.clearSockets();
    this.armTimers();
    return json({
      ok: true,
      started: true,
      startedBy,
      phase: match.currentPhase,
      startedAtMs: startedAt,
      matchDeadlineAt,
      durationMs: config.matchDurationMs,
      tick: match.game.state.tick,
    });
  }

  private adminAllowed(request: Request): boolean {
    const header = request.headers.get('Authorization') ?? '';
    const supplied = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    return adminTokenMatches(this.env.MP_ADMIN_TOKEN, supplied);
  }

  private async handleStatus(request: Request): Promise<Response> {
    if (!this.adminAllowed(request)) return failure('unauthorized', 'Admin token is not valid.', 403);
    if (!this.meta) return failure('not-found', 'Room does not exist.', 404);
    const url = new URL(request.url);
    const probe = url.searchParams.get('probe');
    const calibrate = url.searchParams.get('calibrate');
    if (probe !== null && calibrate !== null) {
      return failure('invalid-diagnostics', 'Only one diagnostic mode may be requested.', 400);
    }
    if (probe !== null && probe !== 'timing') {
      return failure('invalid-probe', 'The requested diagnostic probe is not available.', 400);
    }
    if (calibrate !== null) {
      if (this.env.MP_DEV_MODE !== '1') {
        return failure('calibration-disabled', 'Calibration is available only in staging.', 404);
      }
      if (!isCalibrationProfile(calibrate)) {
        return failure('invalid-calibration', 'Unknown calibration profile.', 400);
      }
      const rawBatch = url.searchParams.get('batch') ?? '';
      const batch = Number(rawBatch);
      if (!/^\d{1,3}$/.test(rawBatch) || !isCalibrationBatch(batch)) {
        return failure('invalid-calibration', 'Unsupported calibration batch size.', 400);
      }
      const rawRun = url.searchParams.get('run');
      const runId = rawRun === null ? null : rawRun;
      if (runId !== null && !/^[A-Za-z0-9_-]{1,48}$/.test(runId)) {
        return failure('invalid-calibration', 'Invalid calibration run id.', 400);
      }
      try {
        return json({
          ok: true,
          calibration: runBatchCalibration(calibrate, batch, runId),
        });
      } catch {
        return failure('calibration-failed', 'Calibration workload could not run.', 500);
      }
    }
    const timingProbe = probe === 'timing' ? await runClockProbe() : undefined;
    const matchStatus = this.match?.status() ?? null;
    return json({
      ok: true,
      diagnostics: matchStatus?.diagnostics ?? this.finalDiagnostics ?? this.diagnostics.summary(),
      persistenceIntervalMs: PERSIST_MS,
      roomId: this.meta.roomId,
      mode: this.meta.mode,
      protocol: ROOM_PROTOCOL_VERSION,
      closed: this.meta.closed,
      closedReason: this.meta.closedReason,
      closedAt: this.meta.closedAt,
      started: this.meta.started,
      phase: this.match?.currentPhase ?? (this.meta.closed ? 'closed' : 'lobby'),
      lobby: this.lobby ? this.lobby.state(0) : null,
      createdAt: this.meta.createdAt,
      matchDurationMs: this.meta.matchDurationMs,
      matchDeadlineAt: this.meta.reservation.hardDeadlineAt,
      startedMatchDeadlineAt: this.meta.matchDeadlineAt ?? null,
      reservation: {
        reservationId: this.meta.reservation.reservationId,
        status: this.meta.reservation.status,
        hardDeadlineAt: this.meta.reservation.hardDeadlineAt,
      },
      lastHeartbeatAt: this.lastHeartbeatAt,
      heartbeatIntervalMs: this.heartbeatMs(),
      matchTiming: {
        startedAtMs: matchStatus?.startedAtMs ?? this.meta.startedAtMs ?? null,
        finishedAtMs: matchStatus?.finishedAtMs ?? this.meta.finishedAtMs ?? null,
        totalTicks: matchStatus?.stats.ticks ?? this.meta.totalTicks ?? null,
        processTicks: matchStatus?.stats.processTicks ?? 0,
        startedAtDerived: matchStatus?.startedAtDerived ?? false,
      },
      match: matchStatus,
      finalResult: this.meta.finalResult,
      ...(timingProbe ? { timingProbe } : {}),
    });
  }

  /**
   * Staging-only evidence action: assemble the persisted snapshot exactly as
   * stored and run it through the strict restore validator.
   *
   * Requires both the admin token and MP_DEV_MODE, so a production deployment
   * refuses it even if a token were configured by mistake. It only reads:
   * no storage write, no restore, no match start or finish, no reservation
   * release, no change to the room's closed state or final result.
   */
  private async handleSnapshotReadback(request: Request, url: URL): Promise<Response> {
    if (!this.adminAllowed(request)) return failure('unauthorized', 'Admin token is not valid.', 403);
    if (this.env.MP_DEV_MODE !== '1') return failure('not-found', 'Room route is not valid.', 404);
    const roomId = this.roomId;
    if (!roomId) return failure('not-found', 'Room id is missing.', 404);
    const includeText = url.searchParams.get('include') === 'text';
    if (url.searchParams.has('include') && !includeText) {
      return failure('invalid-readback', 'Unsupported read-back option.', 400);
    }

    let storedMeta: unknown;
    let storedIndex: unknown;
    let parts: unknown[];
    try {
      storedMeta = await this.storage.get<unknown>(META_KEY);
      if (!storedMeta) return failure('not-found', 'Room does not exist.', 404);
      const metaProblem = validatePersistedMeta(storedMeta, roomId);
      if (metaProblem) {
        return json(
          {
            ok: false,
            code: 'metadata-invalid',
            message: `Persisted room metadata is invalid: ${metaProblem}.`,
            stage: 'meta',
            problems: [metaProblem],
          },
          500,
        );
      }
      storedIndex = await this.storage.get<unknown>(SNAPSHOT_INDEX_KEY);
      if (!storedIndex) return failure('not-found', 'Room has no persisted snapshot.', 404);
      const chunks = isRecord(storedIndex) ? Number(storedIndex.chunks) : 0;
      const expected =
        Number.isInteger(chunks) && chunks > 0 && chunks <= MAX_SNAPSHOT_CHUNKS ? chunks : 0;
      const generation =
        isRecord(storedIndex) && typeof storedIndex.generation === 'string'
          ? storedIndex.generation
          : '';
      parts = [];
      for (let chunk = 0; chunk < expected; chunk++) {
        parts.push(
          await this.storage.get<unknown>(`${SNAPSHOT_CHUNK_PREFIX}${generation}:${chunk}`),
        );
      }
    } catch (error) {
      console.error('MP room snapshot read-back failed', error);
      return failure('storage-unavailable', 'Stored room state could not be read.', 503);
    }

    const result = await inspectStoredSnapshot({
      roomId,
      meta: readbackMeta(storedMeta as Record<string, unknown>, roomId),
      index: storedIndex,
      parts,
      includeText,
    });
    // A read-back of a broken snapshot is an integrity failure, not a bad
    // request: answer 500 so a client cannot mistake it for "no such room".
    return json(result, result.ok ? 200 : result.status);
  }

  private async handleShutdown(request: Request): Promise<Response> {
    if (!this.adminAllowed(request)) return failure('unauthorized', 'Admin token is not valid.', 403);
    if (!this.meta) return failure('not-found', 'Room does not exist.', 404);
    if (this.meta.closed) return json({ ok: true, alreadyClosed: true });
    if (!this.match) this.meta.closedReason = 'room-shutdown';
    this.match?.fail('shutdown', Date.now(), 'room-shutdown');
    await this.finalize();
    return json({ ok: true, closed: true });
  }

  /**
   * Staging-only fault injection: reset this Durable Object in place while
   * preserving its storage and reservation. The next request reloads the room
   * from the last persisted snapshot exactly as a platform restart would.
   * Admin token and MP_DEV_MODE are both required; production has neither.
   */
  private handleRestart(request: Request): Response {
    if (!this.adminAllowed(request)) return failure('unauthorized', 'Admin token is not valid.', 403);
    if (this.env.MP_DEV_MODE !== '1') return failure('not-found', 'Room route is not valid.', 404);
    if (!this.meta) return failure('not-found', 'Room does not exist.', 404);
    if (this.meta.closed) return failure('room-closed', 'This room is already closed.', 410);
    // Let the HTTP response flush before the reset closes every socket.
    setTimeout(() => this.state.abort(), 50);
    return json({ ok: true, restarting: true, roomId: this.meta.roomId });
  }

  private async handleWebSocket(request: Request, url: URL): Promise<Response> {
    if (!onlineEnabled(this.env)) return failure('online-disabled', 'Online rooms are disabled.', 503);
    if (!this.meta) return failure('room-not-found', 'Room does not exist.', 404);
    if (this.closed || this.meta.closed) return failure('room-closed', 'This room is closed.', 410);
    // A start may be mid-flight. Admit nothing against a half-committed
    // transition: wait for it to settle, then serve whichever half exists.
    if (this.starting) {
      try {
        await this.starting;
      } catch {
        /* the start request reports its own failure */
      }
    }
    if (Date.now() >= this.meta.reservation.hardDeadlineAt) {
      if (this.match) this.match.finishAtDeadline(Date.now());
      void this.finalize();
      return failure('room-closed', 'This room has reached its hard deadline.', 410);
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return failure('upgrade-required', 'A WebSocket upgrade is required.', 426);
    }
    if (!originAllowed(request, this.env)) {
      return failure('origin-rejected', 'Origin is not allowed.', 403);
    }
    const seatId = Number(url.searchParams.get('seat'));
    if (!Number.isInteger(seatId) || seatId < 0 || seatId > 1) {
      this.diagnostics.recordSocketRejection('invalid-seat');
      return failure('invalid-seat', 'Seat is not valid.', 400);
    }
    const protocols = protocolToken(request.headers.get('Sec-WebSocket-Protocol'));
    if (!protocols.version || !protocols.token) {
      this.diagnostics.recordSocketRejection('unauthorized');
      return failure('unauthorized', 'A room token is required.', 401);
    }
    // A room that has not started admits lobby sockets; it has no match to
    // join, and connecting is never what starts the match.
    if (!this.match) return this.openLobbySocket(seatId, protocols.token);
    const authorized = this.match.authorizeSeat(seatId, protocols.token);
    if (!authorized.ok) {
      if (this.match.hasSeatConnected(seatId)) {
        this.diagnostics.recordReconnectRejection(authorized.code);
      } else {
        this.diagnostics.recordSocketRejection(authorized.code);
      }
      const status =
        authorized.code === 'room-closed'
          ? 410
          : authorized.code === 'seat-occupied'
            ? 409
            : 401;
      return failure(authorized.code, authorized.message, status);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const connected = this.match.connect(seatId, protocols.token, server as unknown as RoomSocket);
    if (!connected.ok) {
      this.diagnostics.recordSocketRejection(connected.code);
      try {
        server.close(1008, connected.code);
      } catch {
        /* already closed */
      }
      return failure(connected.code, connected.message, 409);
    }

    server.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        try {
          server.close(1003, 'text-only');
        } catch {
          /* already closed */
        }
        return;
      }
      this.match?.receive(seatId, server as unknown as RoomSocket, event.data, Date.now());
    });
    server.addEventListener('close', () => {
      this.match?.disconnect(seatId, server as unknown as RoomSocket, Date.now());
    });
    server.addEventListener('error', () => {
      this.match?.disconnect(seatId, server as unknown as RoomSocket, Date.now());
    });

    // Timers armed during the create request can be cleared when that request
    // finishes in workerd. Re-arm them now that a live socket keeps the room
    // object active; this is also the heartbeat's lifetime anchor.
    this.armTimers();

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': `mca.v${ROOM_PROTOCOL_VERSION}` },
    });
  }

  /**
   * Admit one seat into the lobby. The seat is authenticated with the existing
   * token authority, and the lobby answers with its own state instead of a
   * match hello: no tick, no entities and no simulation clock, because none of
   * those exist until the host starts.
   */
  /**
   * Route one message from a seat's socket to whoever owns that seat now.
   *
   * A socket is opened in the lobby and handed to the match when the host
   * starts, so ownership is looked up per message. Capturing the lobby at open
   * time would silently drop every command, keepalive and resync a seat sent
   * after the start — the seat would still receive updates and never be able
   * to give an order.
   */
  private receiveFromSeat(seatId: number, socket: RoomSocket, text: string, now = Date.now()): void {
    const match = this.match;
    if (match) {
      match.receive(seatId, socket, text, now);
      return;
    }
    this.lobby?.receive(seatId, socket, text, now);
  }

  /** The seat socket closed: tell the lifecycle that currently owns it. */
  private disconnectSeat(seatId: number, socket: RoomSocket): void {
    const match = this.match;
    if (match) {
      match.disconnect(seatId, socket, Date.now());
      return;
    }
    this.lobby?.disconnect(seatId, socket);
  }

  private openLobbySocket(seatId: number, token: string): Response {
    const lobby = this.lobby;
    if (!lobby) return failure('room-not-found', 'Room does not exist.', 404);
    const authorized = lobby.authorizeSeat(seatId, token);
    if (!authorized.ok) {
      this.diagnostics.recordSocketRejection(authorized.code);
      const status = authorized.code === 'seat-occupied' ? 409 : 401;
      return failure(authorized.code, authorized.message, status);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const socket = server as unknown as RoomSocket;
    const connected = lobby.connect(seatId, token, socket);
    if (!connected.ok) {
      this.diagnostics.recordSocketRejection(connected.code ?? 'send-failed');
      try {
        server.close(1008, connected.code ?? 'send-failed');
      } catch {
        /* already closed */
      }
      return failure(connected.code ?? 'send-failed', connected.message ?? 'Lobby socket failed.', 409);
    }

    // A socket opened in the lobby outlives the lobby: the start transition
    // hands it to the match, so routing is resolved per message.
    server.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        try {
          server.close(1003, 'text-only');
        } catch {
          /* already closed */
        }
        return;
      }
      this.receiveFromSeat(seatId, socket, event.data);
    });
    server.addEventListener('close', () => {
      this.disconnectSeat(seatId, socket);
    });
    server.addEventListener('error', () => {
      this.disconnectSeat(seatId, socket);
    });
    this.armTimers();

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': `mca.v${ROOM_PROTOCOL_VERSION}` },
    });
  }

  private startTickLoop(): void {
    if (this.tickTimer || this.closed || !this.match || this.match.currentPhase !== 'playing') return;
    this.nextTickAt = Date.now() + TICK_WAKE_MS;
    this.tickTimer = setInterval(() => this.runTick(), TICK_WAKE_MS);
  }

  private stopTickLoop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.nextTickAt = null;
  }

  private runTick(): void {
    if (this.closed || !this.match) {
      this.stopTickLoop();
      return;
    }
    const now = Date.now();
    if (this.nextTickAt === null) this.nextTickAt = now + TICK_WAKE_MS;
    let ticks = 0;
    while (now >= this.nextTickAt && ticks < MAX_CATCHUP_TICKS) {
      const tickAt = this.nextTickAt;
      this.nextTickAt += TICK_WAKE_MS;
      ticks++;
      this.match.tick(tickAt);
      if (this.match.closed) break;
    }
    if (this.nextTickAt !== null && now - this.nextTickAt > 250) {
      this.nextTickAt = now + TICK_WAKE_MS;
    }
    if (this.match.closed) {
      this.stopTickLoop();
      void this.finalize();
    }
  }

  private armTimers(): void {
    this.stopTimers();
    if (this.closed || !this.meta || this.meta.closed) return;
    this.deadlineTimer = setTimeout(
      () => {
        if (this.match && !this.match.closed) this.match.finishAtDeadline(Date.now());
        void this.finalize();
      },
      Math.max(0, this.meta.reservation.hardDeadlineAt - Date.now()),
    );
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), this.heartbeatMs());
    this.persistTimer = setInterval(() => void this.persistPeriodic(), PERSIST_MS);
    if (this.match?.currentPhase === 'playing') this.startTickLoop();
  }

  private stopTimers(): void {
    this.stopTickLoop();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.heartbeatTimer = null;
    this.deadlineTimer = null;
    this.persistTimer = null;
  }

  private async heartbeat(): Promise<void> {
    // A lobby holds the reservation for its whole wait, so it must keep the
    // capacity heartbeat alive even though it has no match yet.
    if (this.closed || !this.lease) return;
    const result = await this.lease.heartbeat();
    this.lastHeartbeatAt = Date.now();
    this.diagnostics.recordHeartbeat(result.ok, result.ok ? undefined : result.code);
    if (!result.ok) {
      console.error('MP room heartbeat failed', this.roomId, result.code);
      const match = this.match;
      if (!match) {
        void this.finalize();
      } else if (result.code === 'match-expired' || result.code === 'reservation-expired') {
        match.finishAtDeadline(Date.now());
        void this.finalize();
      } else {
        match.fail(`reservation-${result.code}`, Date.now(), 'reservation-failure');
        void this.finalize();
      }
      return;
    }
    this.match?.noteHeartbeat();
    if (this.meta) {
      this.meta.reservation = result.reservation;
      void this.persistMeta();
    }
  }

  private async persistPeriodic(): Promise<void> {
    if (this.closed || !this.match || !this.meta || this.meta.closed) return;
    try {
      await this.persistSnapshot(Date.now());
      this.meta.started = this.match.currentPhase !== 'waiting';
      this.meta.startedAtMs = this.match.startedAt;
      this.meta.finishedAtMs = this.match.finishedAt;
      this.meta.totalTicks = this.match.game.state.tick;
      await this.persistMeta();
    } catch (error) {
      console.error('MP room periodic persistence failed', error);
    }
  }

  private persistSnapshot(now: number): Promise<void> {
    const run = this.snapshotWrite.then(
      () => this.writeSnapshot(now),
      () => this.writeSnapshot(now),
    );
    this.snapshotWrite = run.catch(() => undefined);
    return run;
  }

  private async writeSnapshot(now: number): Promise<void> {
    if (!this.match) throw new Error('No match to persist.');
    const cycleStartedAt = monotonicNow();
    let bytes = 0;
    let chunkCount = 0;
    try {
      const text = JSON.stringify(this.match.snapshot(now));
      const chunks = chunkText(text);
      chunkCount = chunks.length;
      if (chunks.length > MAX_SNAPSHOT_CHUNKS) throw new Error('Room snapshot is too large.');
      bytes = utf8ByteLength(text);
      const generation = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const previousReadStartedAt = monotonicNow();
      const previous = await this.storage.get<SnapshotIndex>(SNAPSHOT_INDEX_KEY);
      this.diagnostics.recordPersistenceOperation(
        'read',
        monotonicNow() - previousReadStartedAt,
      );
      for (let index = 0; index < chunks.length; index++) {
        const writeStartedAt = monotonicNow();
        await this.storage.put(`${SNAPSHOT_CHUNK_PREFIX}${generation}:${index}`, chunks[index]);
        this.diagnostics.recordPersistenceOperation('write', monotonicNow() - writeStartedAt);
      }
      const snapshotIndex: SnapshotIndex = {
        version: 1,
        generation,
        chunks: chunks.length,
        length: text.length,
        tick: this.match.game.state.tick,
        updatedAt: now,
      };
      const indexWriteStartedAt = monotonicNow();
      await this.storage.put(SNAPSHOT_INDEX_KEY, snapshotIndex);
      this.diagnostics.recordPersistenceOperation(
        'write',
        monotonicNow() - indexWriteStartedAt,
      );
      if (previous && previous.generation !== generation) {
        for (let index = 0; index < previous.chunks; index++) {
          const deleteStartedAt = monotonicNow();
          await this.storage.delete(`${SNAPSHOT_CHUNK_PREFIX}${previous.generation}:${index}`);
          this.diagnostics.recordPersistenceOperation('delete', monotonicNow() - deleteStartedAt);
        }
      }
      this.diagnostics.recordPersistenceCycle({
        kind: 'snapshot',
        durationMs: monotonicNow() - cycleStartedAt,
        bytes,
        chunks: chunkCount,
        ok: true,
      });
    } catch (error) {
      this.diagnostics.recordPersistenceCycle({
        kind: 'snapshot',
        durationMs: monotonicNow() - cycleStartedAt,
        bytes,
        chunks: chunkCount,
        ok: false,
        error: String(error),
      });
      throw error;
    }
  }

  private async loadSnapshot(): Promise<RoomSnapshot> {
    const cycleStartedAt = monotonicNow();
    let bytes = 0;
    let chunkCount = 0;
    try {
      const indexReadStartedAt = monotonicNow();
      const index = await this.storage.get<SnapshotIndex>(SNAPSHOT_INDEX_KEY);
      this.diagnostics.recordPersistenceOperation(
        'read',
        monotonicNow() - indexReadStartedAt,
      );
      if (
        !index ||
        index.version !== 1 ||
        typeof index.generation !== 'string' ||
        !Number.isInteger(index.chunks) ||
        index.chunks < 1 ||
        index.chunks > MAX_SNAPSHOT_CHUNKS
      ) {
        throw new Error('Room snapshot index is missing or invalid.');
      }
      chunkCount = index.chunks;
      let text = '';
      for (let chunk = 0; chunk < index.chunks; chunk++) {
        const readStartedAt = monotonicNow();
        const part = await this.storage.get<string>(
          `${SNAPSHOT_CHUNK_PREFIX}${index.generation}:${chunk}`,
        );
        const readDuration = monotonicNow() - readStartedAt;
        if (typeof part !== 'string') throw new Error('Room snapshot chunk is missing.');
        this.diagnostics.recordPersistenceRead(part.length, readDuration);
        text += part;
      }
      if (text.length !== index.length) throw new Error('Room snapshot length is invalid.');
      bytes = utf8ByteLength(text);
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) throw new Error('Room snapshot is not an object.');
      if (parsed.tick !== index.tick) throw new Error('Room snapshot tick does not match its index.');
      this.diagnostics.recordPersistenceCycle({
        kind: 'load',
        durationMs: monotonicNow() - cycleStartedAt,
        bytes,
        chunks: chunkCount,
        ok: true,
      });
      return parsed as unknown as RoomSnapshot;
    } catch (error) {
      this.diagnostics.recordPersistenceCycle({
        kind: 'load',
        durationMs: monotonicNow() - cycleStartedAt,
        bytes,
        chunks: chunkCount,
        ok: false,
        error: String(error),
      });
      throw error;
    }
  }

  private async persistMeta(): Promise<void> {
    if (!this.meta) return;
    const cycleStartedAt = monotonicNow();
    let bytes = 0;
    try {
      bytes = utf8ByteLength(JSON.stringify(this.meta));
      const writeStartedAt = monotonicNow();
      await this.storage.put(META_KEY, this.meta);
      this.diagnostics.recordPersistenceOperation('write', monotonicNow() - writeStartedAt);
      this.diagnostics.recordPersistenceCycle({
        kind: 'meta',
        durationMs: monotonicNow() - cycleStartedAt,
        bytes,
        chunks: 1,
        ok: true,
      });
    } catch (error) {
      this.diagnostics.recordPersistenceCycle({
        kind: 'meta',
        durationMs: monotonicNow() - cycleStartedAt,
        bytes,
        chunks: 1,
        ok: false,
        error: String(error),
      });
      throw error;
    }
  }

  private finalize(): Promise<void> {
    if (this.finishing) return this.finishing;
    this.finishing = this.doFinalize();
    return this.finishing;
  }

  private async doFinalize(): Promise<void> {
    if (this.meta?.closed) {
      this.closed = true;
      this.stopTimers();
      return;
    }
    this.closed = true;
    this.stopTimers();
    const match = this.match;
    const meta = this.meta;
    if (!meta) return;
    if (!match) {
      // Closing a lobby. There is no world, so there is no final snapshot and
      // no result; only the reservation has to go back, exactly once.
      const now = Date.now();
      meta.closed = true;
      meta.closedReason = meta.closedReason ?? 'lobby-expired';
      meta.closedAt = now;
      meta.finalResult = null;
      if (this.lease && !this.lease.isReleased) {
        const released = await this.lease.release({
          actualDurationMs: Math.max(0, now - meta.createdAt),
          actualRequests: 0,
        });
        this.diagnostics.recordRelease(released.ok, released.ok ? undefined : released.code);
        if (released.ok) meta.reservation = released.reservation;
        else console.error('MP lobby reservation release failed', released.code);
        this.lease = null;
      }
      try {
        await this.persistMeta();
      } catch (error) {
        console.error('MP lobby final metadata failed', error);
      }
      this.diagnostics.markClosed(meta.closedReason, now);
      this.finalDiagnostics = this.diagnostics.summary();
      try {
        await this.storage.put(DIAGNOSTICS_KEY, this.finalDiagnostics);
      } catch (error) {
        console.error('MP lobby final diagnostics failed', error);
      }
      this.lobby = null;
      return;
    }
    if (match.currentPhase === 'playing') {
      match.fail('room-stopped', Date.now(), 'room-stopped');
    }
    const now = Date.now();
    try {
      await this.persistSnapshot(now);
    } catch (error) {
      console.error('MP room final snapshot failed', error);
    }
    meta.closed = true;
    meta.closedReason = match.status().closedReason ?? (match.currentPhase === 'finished' ? 'match-finished' : 'room-closed');
    meta.closedAt = match.status().finishedAtMs ?? now;
    meta.finalResult = match.currentResult;
    meta.started = match.currentPhase !== 'waiting';
    meta.startedAtMs = match.startedAt;
    meta.finishedAtMs = match.finishedAt;
    meta.totalTicks = match.game.state.tick;
    if (this.lease && !this.lease.isReleased) {
      const released = await this.lease.release({
        actualDurationMs: Math.max(0, now - meta.createdAt),
        actualRequests: match.status().stats.approxRequests,
      });
      this.diagnostics.recordRelease(released.ok, released.ok ? undefined : released.code);
      if (released.ok) meta.reservation = released.reservation;
      else console.error('MP room reservation release failed', released.code);
      this.lease = null;
    }
    try {
      await this.persistMeta();
    } catch (error) {
      console.error('MP room final metadata failed', error);
    }
    this.diagnostics.markClosed(meta.closedReason ?? 'room-closed', now);
    const finalSummary = this.diagnostics.summary();
    this.finalDiagnostics = finalSummary;
    try {
      const diagnosticsWriteStartedAt = monotonicNow();
      await this.storage.put(DIAGNOSTICS_KEY, finalSummary);
      this.diagnostics.recordPersistenceOperation(
        'write',
        monotonicNow() - diagnosticsWriteStartedAt,
      );
    } catch (error) {
      console.error('MP room final diagnostics failed', error);
    }
    console.log('MP room diagnostics', JSON.stringify(finalSummary));
  }
}

export type { RoomPhase };
