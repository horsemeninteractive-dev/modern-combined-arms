import type { NeutralMatchResult } from './matchResult';
import type {
  ProjectedEntity,
  ProjectedMap,
  ProjectedMatchResult,
  ProjectedPlayer,
  ProjectedProjectile,
  TeamSnapshot,
} from './projection';
import type { ContactRecord, SimEvent } from '../sim/types';

/**
 * Phase 2A wire protocol.
 *
 * The browser never sends a team, player, owner or seat. It sends one command
 * body inside a versioned transport envelope; the room combines that body with
 * its trusted seat table before CommandGate sees it.
 */

export const ROOM_PROTOCOL_VERSION = 2 as const;
export const MAX_CLIENT_MESSAGE_BYTES = 4096;
/** A full sync is bounded so one seat can never be sent an unbounded payload. */
export const MAX_SYNC_BYTES = 256 * 1024;
/** Force a fresh checkpoint sync before a delta chain grows without bound. */
export const MAX_DELTA_CHAIN = 3_000;
/** Resync requests are transport bookkeeping, not a gameplay command. */
export const RESYNC_MIN_INTERVAL_MS = 5_000;
export const MAX_RESYNC_MESSAGE_BYTES = 128;
export const MAX_CLIENT_MESSAGES_PER_SECOND = 20;
export const SNAPSHOT_HZ = 10;
export const TICK_HZ = 20;
/**
 * Application keepalive cadence. 20 s is well inside common NAT idle windows
 * and far below the 30 s abandonment grace, so it cannot mask a dead socket.
 */
export const KEEPALIVE_INTERVAL_MS = 20_000;
/** One accepted keepalive per seat per interval; measured from the last ack. */
export const KEEPALIVE_MIN_INTERVAL_MS = 5_000;
export const MAX_KEEPALIVE_MESSAGE_BYTES = 256;

export type RoomPhase = 'waiting' | 'playing' | 'finished' | 'closed';

export interface ClientCommandMessage {
  type: 'command';
  v: typeof ROOM_PROTOCOL_VERSION;
  command: Record<string, unknown>;
}

/**
 * Transport aliveness only: no command, no team, no seat, no game state. It is
 * handled before CommandGate and never reaches the simulation queue.
 */
export interface ClientKeepaliveMessage {
  type: 'keepalive';
  v: typeof ROOM_PROTOCOL_VERSION;
}

/** Ask for a fresh full team projection after a detected gap. */
export interface ClientResyncMessage {
  type: 'resync';
  v: typeof ROOM_PROTOCOL_VERSION;
}

/**
 * Pre-match intent. Readiness carries no identity at all; a settings message
 * may name a nation or colour, but only for the seat that sent it, and only
 * values from the authoritative catalogues the room already validates. Neither
 * can start the match.
 */
export interface ClientReadyMessage {
  type: 'ready';
  v: typeof ROOM_PROTOCOL_VERSION;
  ready: boolean;
}

export interface ClientLobbySetMessage {
  type: 'lobbySet';
  v: typeof ROOM_PROTOCOL_VERSION;
  nation?: string;
  color?: string;
}

export type ClientMessage =
  | ClientCommandMessage
  | ClientKeepaliveMessage
  | ClientResyncMessage
  | ClientReadyMessage
  | ClientLobbySetMessage;

export type ClientParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse and bound-check one client message before it reaches CommandGate. */
export function parseClientMessage(
  text: string,
  maxBytes = MAX_CLIENT_MESSAGE_BYTES,
): ClientParseResult {
  if (typeof text !== 'string') {
    return { ok: false, code: 'malformed-message', message: 'Message must be text.' };
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { ok: false, code: 'payload-too-large', message: 'Message is too large.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: 'malformed-message', message: 'Message is not valid JSON.' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, code: 'malformed-message', message: 'Message must be an object.' };
  }
  if (
    parsed.type !== 'command' &&
    parsed.type !== 'keepalive' &&
    parsed.type !== 'resync' &&
    parsed.type !== 'ready' &&
    parsed.type !== 'lobbySet'
  ) {
    return {
      ok: false,
      code: typeof parsed.type === 'string' ? 'unsupported-message-type' : 'malformed-message',
      message: 'Unsupported room message type.',
    };
  }
  const keepalive = parsed.type === 'keepalive';
  const resync = parsed.type === 'resync';
  const ready = parsed.type === 'ready';
  const lobbySet = parsed.type === 'lobbySet';
  // Field-level allowlist per type: transport frames may not smuggle a command,
  // and a command may not carry transport bookkeeping.
  const allowed = ready
    ? ['type', 'v', 'ready']
    : lobbySet
      ? ['type', 'v', 'nation', 'color']
      : keepalive || resync
        ? ['type', 'v']
        : ['type', 'v', 'command'];
  for (const key of Object.keys(parsed)) {
    if (!allowed.includes(key)) {
      return { ok: false, code: 'unknown-field', message: 'Message has an unknown field.' };
    }
  }
  if (parsed.v !== ROOM_PROTOCOL_VERSION) {
    return {
      ok: false,
      code: typeof parsed.v === 'number' ? 'unsupported-version' : 'malformed-message',
      message: 'Unsupported room protocol version.',
    };
  }
  if (keepalive) {
    return { ok: true, message: { type: 'keepalive', v: ROOM_PROTOCOL_VERSION } };
  }
  if (resync) {
    return { ok: true, message: { type: 'resync', v: ROOM_PROTOCOL_VERSION } };
  }
  if (ready) {
    if (typeof parsed.ready !== 'boolean') {
      return { ok: false, code: 'malformed-message', message: 'Readiness must be a boolean.' };
    }
    return { ok: true, message: { type: 'ready', v: ROOM_PROTOCOL_VERSION, ready: parsed.ready } };
  }
  if (lobbySet) {
    if (parsed.nation === undefined && parsed.color === undefined) {
      return { ok: false, code: 'malformed-message', message: 'Nothing to change.' };
    }
    if (parsed.nation !== undefined && typeof parsed.nation !== 'string') {
      return { ok: false, code: 'malformed-message', message: 'Nation must be a string.' };
    }
    if (parsed.color !== undefined && typeof parsed.color !== 'string') {
      return { ok: false, code: 'malformed-message', message: 'Colour must be a string.' };
    }
    return {
      ok: true,
      message: {
        type: 'lobbySet',
        v: ROOM_PROTOCOL_VERSION,
        ...(parsed.nation === undefined ? {} : { nation: parsed.nation }),
        ...(parsed.color === undefined ? {} : { color: parsed.color }),
      },
    };
  }
  if (!isRecord(parsed.command)) {
    return { ok: false, code: 'malformed-command', message: 'Command body must be an object.' };
  }
  return {
    ok: true,
    message: {
      type: 'command',
      v: ROOM_PROTOCOL_VERSION,
      command: parsed.command,
    },
  };
}

export interface HelloMessage {
  type: 'hello';
  v: typeof ROOM_PROTOCOL_VERSION;
  protocol: typeof ROOM_PROTOCOL_VERSION;
  roomId: string;
  seat: number;
  playerId: number;
  team: number;
  mode: '1v1';
  phase: RoomPhase;
  tick: number;
  tickHz: number;
  snapshotHz: number;
  keepaliveMs: number;
  matchDeadlineAt: number;
}

/**
 * Pre-match room state. It carries no entities, no tick, no simulation clock
 * and no other seat's authority, because a lobby has no authoritative world to
 * describe yet.
 */
export interface LobbyMessage {
  type: 'lobby';
  v: typeof ROOM_PROTOCOL_VERSION;
  roomId: string;
  seat: number;
  phase: 'lobby';
  hostSeat: number;
  /** Reservation window end; the match timer starts only at explicit start. */
  matchDeadlineAt: number;
  config: {
    version: number;
    mapId: string;
    matchDurationMs: number;
    /** Seat order, so index 0 is always the host. */
    seats: Array<{
      nation: string;
      color: string;
      ready: boolean;
      host: boolean;
      connected: boolean;
    }>;
  };
}

export interface CommandAcceptedMessage {
  type: 'commandAccepted';
  v: typeof ROOM_PROTOCOL_VERSION;
  tick: number;
  commandType: string;
}

export interface CommandRejectedMessage {
  type: 'commandRejected';
  v: typeof ROOM_PROTOCOL_VERSION;
  code: string;
  message: string;
  detail?: string;
}

export interface ResultMessage {
  type: 'result';
  v: typeof ROOM_PROTOCOL_VERSION;
  outcome: 'victory' | 'defeat' | 'draw';
  result: ProjectedMatchResult;
}

export interface ErrorMessage {
  type: 'error';
  v: typeof ROOM_PROTOCOL_VERSION;
  code: string;
  message: string;
}

export interface RoomClosedMessage {
  type: 'roomClosed';
  v: typeof ROOM_PROTOCOL_VERSION;
  reason: string;
  code: string;
}

/**
 * Acknowledgement carries only the protocol version. It does not echo the
 * client clock, reveal the server tick, or expose room diagnostics.
 */
export interface KeepaliveAckMessage {
  type: 'keepaliveAck';
  v: typeof ROOM_PROTOCOL_VERSION;
}

/**
 * Fog changes only: indices are tile indices in row-major order and values are
 * 0 unexplored, 1 explored, 2 visible. Unchanged tiles are never repeated.
 */
export interface FogDelta {
  set: Array<[number, number]>;
}

/**
 * One ordered incremental update. Every field is optional and present only when
 * the recipient's projected view changed. Entity objects are complete projected
 * records: a visibility loss is either a removal or a `remembered` replacement.
 */
export interface DeltaChanges {
  fog?: FogDelta;
  contacts?: ContactRecord[];
  charted?: number[];
  players?: { upsert: ProjectedPlayer[] };
  entities?: { upsert: ProjectedEntity[]; remove: number[] };
  projectiles?: { upsert: ProjectedProjectile[]; remove: number[] };
  events?: SimEvent[];
  result?: ProjectedMatchResult;
}

/**
 * A sync state always carries complete dynamic state. `map` is optional: an
 * initial connect, reconnect or explicit resync includes it, while a periodic
 * checkpoint omits it because the recipient already holds the immutable map.
 */
export type SyncState = Omit<TeamSnapshot, 'map'> & { map?: ProjectedMap };

export interface SyncMessage {
  type: 'sync';
  v: typeof ROOM_PROTOCOL_VERSION;
  /** Sync generation. Any delta with another epoch belongs to an older baseline. */
  epoch: number;
  /** Per-seat sequence that never resets for the life of the room. */
  seq: number;
  tick: number;
  team: number;
  roomId: string;
  /**
   * True for a checkpoint or client-requested resync, false for a fresh seat.
   * The sync itself is the completion marker: it carries complete fog and
   * dynamic state atomically, and it is the only message after which the
   * client may apply deltas. `map` is present only when the recipient needs a
   * new static baseline (first sync, reconnect or explicit resync).
   */
  checkpoint: boolean;
  state: SyncState;
}

export interface DeltaMessage {
  type: 'delta';
  v: typeof ROOM_PROTOCOL_VERSION;
  epoch: number;
  seq: number;
  /** Exact sequence this delta applies to. */
  base: number;
  tick: number;
  team: number;
  roomId: string;
  changes: DeltaChanges;
}

export type ServerMessage =
  | HelloMessage
  | LobbyMessage
  | KeepaliveAckMessage
  | SyncMessage
  | DeltaMessage
  | CommandAcceptedMessage
  | CommandRejectedMessage
  | ResultMessage
  | ErrorMessage
  | RoomClosedMessage;

/** Team-relative result view. The final result has no opposing live totals. */
export function resultMessageFor(
  result: NeutralMatchResult,
  projected: ProjectedMatchResult,
  team: number,
): ResultMessage {
  const outcome =
    result.phase !== 'finished'
      ? null
      : result.winnerTeam === null
        ? 'draw'
        : result.winnerTeam === team
          ? 'victory'
          : 'defeat';
  if (!outcome) throw new Error('Cannot build a result message for a live match.');
  return {
    type: 'result',
    v: ROOM_PROTOCOL_VERSION,
    outcome,
    result: projected,
  };
}
