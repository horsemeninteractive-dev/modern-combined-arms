import { matchIdFor } from '../accounts/matchCareer';
import { identitySnapshot, type IdentitySnapshot } from '../accounts/identity';
import { defaultScenarioId, scenarioById } from '../data/scenarioCatalog';
import { Game } from '../sim/game';
import { CommandGate, type GateRejection } from './commandGate';
import {
  evaluateMatchResult,
  type NeutralMatchResult,
} from './matchResult';
import {
  KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_MIN_INTERVAL_MS,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_CLIENT_MESSAGES_PER_SECOND,
  MAX_DELTA_CHAIN,
  MAX_KEEPALIVE_MESSAGE_BYTES,
  MAX_RESYNC_MESSAGE_BYTES,
  MAX_SYNC_BYTES,
  RESYNC_MIN_INTERVAL_MS,
  ROOM_PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  TICK_HZ,
  parseClientMessage,
  resultMessageFor,
  type CommandAcceptedMessage,
  type CommandRejectedMessage,
  type DeltaChanges,
  type DeltaMessage,
  type ErrorMessage,
  type HelloMessage,
  type KeepaliveAckMessage,
  type RoomClosedMessage,
  type RoomGameMode,
  type RoomPhase,
  type SyncMessage,
  type SyncState,
} from './protocol';
import {
  createTeamSnapshot,
  createTeamState,
  projectMap,
  type ProjectedMap,
  type ProjectedMatchResult,
  type ProjectedTeamState,
  type TeamSnapshot,
} from './projection';
import { buildDelta, createBaseline, type SyncBaseline } from './teamDelta';
import { buildLobbyScenario, defaultOutbreakLobbyConfig } from './lobbyConfig';
import {
  createRoomSnapshot,
  restoreRoomSnapshot,
  validateRoomSnapshot,
  type RoomSeatSnapshot,
  type RoomSnapshot,
  type RoomSnapshotV1,
} from './roomSnapshot';
import {
  RoomDiagnostics,
  monotonicNow,
  type RoomDiagnosticsSummary,
} from './roomDiagnostics';

/**
 * One authoritative room, independent of the Cloudflare transport.
 *
 * The Durable Object owns the clock and storage; this class owns the Game,
 * seat table, CommandGate, snapshots and neutral result. Tests can drive it
 * with deterministic clocks and a structural socket, while the production
 * adapter is the only code that creates a WebSocketPair.
 */

export interface RoomSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly bufferedAmount?: number;
}

export interface RoomSeatDefinition {
  seatId: number;
  playerId: number;
  team: number;
  token: string;
  /**
   * Verified MCA account for this seat, set only from a ticket the room Worker
   * validated. It is server-side identity: never sent to the opponent, and
   * never trusted from a client-supplied id. `null`/absent means guest.
   */
  accountId?: string | null;
  /**
   * The seat's presentable identity, captured from the signed ticket when the
   * seat was claimed. It is a snapshot on purpose: a player who renames mid-match
   * keeps the name the match was played under, and the lobby shows one name for
   * the whole match rather than one that changes under the opponent.
   */
  identity?: SeatIdentity | null;
}

import type { FlagComposition } from '../identity/flag';

export interface SeatIdentity {
  callsign: string;
  avatar: IdentitySnapshot['avatar'];
  /** Career rank id the signed ticket carried, for the lobby's badge. */
  rank?: string;
  /**
   * Command flag carried by the signed ticket, captured with the seat. A
   * validated composition; the room never renders it itself and never accepts
   * one from a socket message.
   */
  flag?: FlagComposition;
  /** Equipped profile frame catalogue id from the signed ticket. */
  frame?: string;
  /** Equipped profile background catalogue id from the signed ticket. */
  background?: string;
}

/** One seat's frozen match-start presentation. Guest seats carry null. */
export interface MatchSeatIdentity {
  seatId: number;
  identity: SeatIdentity | null;
}

interface SeatState extends RoomSeatDefinition {
  connected: boolean;
  everConnected: boolean;
  socket: RoomSocket | null;
  disconnectedAt: number | null;
  abandoned: boolean;
  lastMessageAt: number;
  messageWindowStart: number;
  messageCount: number;
  /** Last protocol message that changed something (command accepted or keepalive acked). */
  lastActivityAt: number;
  /** Last accepted keepalive, used for the per-seat keepalive rate limit. */
  lastKeepaliveAt: number | null;
  /** Last keepalive acknowledgement actually sent on this socket. */
  lastAckAt: number | null;
  /** Current sync generation and last sequence issued on this seat's stream. */
  epoch: number;
  seq: number;
  /** Updates since the last full sync, bounded by MAX_DELTA_CHAIN. */
  chain: number;
  /** Baseline that this seat has already been sent, or null before first sync. */
  sync: SyncBaseline | null;
  /** Per-seat resync request rate limit. */
  lastResyncAt: number | null;
}

export interface RoomMatchOptions {
  roomId: string;
  mode: RoomGameMode;
  seats: readonly RoomSeatDefinition[];
  matchDurationMs: number;
  matchDeadlineAt: number;
  now?: number;
  game?: Game;
  result?: NeutralMatchResult;
  phase?: RoomPhase;
  abandonAfterMs?: number;
  startedAtMs?: number | null;
  startedAtDerived?: boolean;
  finishedAtMs?: number | null;
  /**
   * Compatibility shim for the pre-2B1 in-process fixtures, which build a room
   * directly rather than through a lobby. It makes `connect()` promote a
   * `waiting` room to `playing` on the second socket, as Phase 2A did. The
   * Durable Object never sets it: a room that has not started is a lobby with no
   * `Game`, so production cannot start a match by connecting to it.
   */
  promoteOnConnect?: boolean;
  /** Durable per-seat recovery state from the validated room snapshot. */
  restoredSeats?: readonly RoomSeatSnapshot[];
  /** Frozen match-start identities; supplied on restore, captured otherwise. */
  identities?: readonly MatchSeatIdentity[];
  /** Test/ops hook: force a checkpoint after this many updates since a sync. */
  maxDeltaChain?: number;
  /** Test hook for sequence-overflow behaviour; production uses 2^31-1. */
  maxSequence?: number;
  /** Shared with the Durable Object so persistence can join the same summary. */
  diagnostics?: RoomDiagnostics;
}

export type ConnectResult =
  | { ok: true; hello: HelloMessage }
  | { ok: false; code: string; message: string };

export interface TickResult {
  ticked: boolean;
  snapshotDue: boolean;
  finished: boolean;
}

export interface RoomMatchStatus {
  roomId: string;
  mode: RoomGameMode;
  protocol: typeof ROOM_PROTOCOL_VERSION;
  phase: RoomPhase;
  tick: number;
  matchDeadlineAt: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  /** Start was reconstructed from durable deadline/duration rather than the snapshot. */
  startedAtDerived: boolean;
  closedReason: string | null;
  seats: Array<{
    seatId: number;
    playerId: number;
    team: number;
    connected: boolean;
    abandoned: boolean;
    lastActivityAt: number;
    lastKeepaliveAt: number | null;
    lastAckAt: number | null;
    bufferedBytes: number;
    epoch: number;
    seq: number;
    chain: number;
    /** Identity frozen when this match started; never current account state. */
    identity: SeatIdentity | null;
  }>;
  result: NeutralMatchResult;
  diagnostics: RoomDiagnosticsSummary;
  /**
   * Bounded, admin-only counts of the long-lived simulation collections.
   * Used to distinguish retained game state from runtime/allocator growth; it
   * is never sent to a seat and never persisted per tick.
   */
  census: {
    entities: number;
    units: number;
    buildings: number;
    projectiles: number;
    contacts: number;
    charted: number;
    events: number;
    pendingCommands: number;
    fogTiles: number;
    lastEventSeq: number;
    bufferedBytes: number[];
  };
  stats: {
    /** Whole-match authoritative ticks from the restored Game state. */
    ticks: number;
    /** Ticks executed by this Durable Object process since load. */
    processTicks: number;
    snapshots: number;
    syncs: number;
    deltas: number;
    outboundBytes: number;
    inboundMessages: number;
    connectionsAccepted: number;
    commandsAccepted: number;
    commandsRejected: number;
    heartbeatCount: number;
    approxRequests: number;
  };
}

const MAX_SOCKET_BUFFER_BYTES = 512 * 1024;
const SNAPSHOT_EVERY_TICKS = Math.max(1, Math.round(TICK_HZ / SNAPSHOT_HZ));
/**
 * A restored room advances every occupied seat's generation by this fence so a
 * sync sent before the latest persisted snapshot cannot collide with a client
 * that already observed it. The gap is many times the number of syncs that can
 * be issued inside one 15 s persistence interval, and repeated restarts remain
 * far below the protocol's 31-bit epoch ceiling.
 */
export const RESTORE_EPOCH_ADVANCE = 1024;

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Constant-time seat-token comparison, shared with the lobby so both halves of
 * a room authenticate a seat through exactly one implementation.
 */
export function seatTokenMatches(supplied: string, expected: string): boolean {
  return sameToken(supplied, expected);
}

function assertSeatTable(seats: readonly RoomSeatDefinition[], mode: RoomGameMode): void {
  if (seats.length !== 2) throw new Error('Phase 2A rooms require exactly two seats.');
  if (seats.some((seat) => seat.seatId !== 0 && seat.seatId !== 1)) {
    throw new Error('Seat ids must be 0 or 1.');
  }
  if (seats.some((seat) => seat.team !== 0 && seat.team !== 1)) {
    throw new Error('Seat team must be 0 or 1.');
  }
  if (mode === 'outbreak') {
    // Co-op is two commanders on one army: both seats speak for player 0, so
    // the ownership rules in the command gate need no co-op branch at all.
    if (seats.some((seat) => seat.playerId !== 0 || seat.team !== 0)) {
      throw new Error('Outbreak seats both command the defending player.');
    }
  } else if (new Set(seats.map((seat) => seat.playerId)).size !== seats.length) {
    throw new Error('Seat player ids must be unique.');
  }
  if (seats.some((seat) => !seat.token)) throw new Error('Every seat needs a token.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class RoomMatch {
  readonly roomId: string;
  readonly mode: RoomGameMode;
  readonly protocol = ROOM_PROTOCOL_VERSION;
  readonly game: Game;
  readonly matchDeadlineAt: number;
  readonly matchDurationMs: number;

  private readonly seats: SeatState[];
  private readonly gate: CommandGate;
  private readonly abandonAfterMs: number;
  private readonly maxDeltaChain: number;
  private readonly maxSequence: number;
  private readonly promoteOnConnect: boolean;
  private startedAtMs: number | null;
  private startedAtDerived = false;
  readonly diagnostics: RoomDiagnostics;

  private phase: RoomPhase;
  private result: NeutralMatchResult;
  private closedReason: string | null = null;
  private finishedAtMs: number | null = null;
  private lastEventSeq = 0;
  private readonly map: ProjectedMap;
  private ticks = 0;
  private snapshots = 0;
  private syncs = 0;
  private deltas = 0;
  private outboundBytes = 0;
  private inboundMessages = 0;
  private connectionsAccepted = 0;
  private commandsAccepted = 0;
  private commandsRejected = 0;
  private heartbeatCount = 0;
  private readonly matchIdentities: MatchSeatIdentity[];

  constructor(options: RoomMatchOptions) {
    assertSeatTable(options.seats, options.mode);
    // Campaign missions are single-player in this stage. A room is an
    // authoritative 1v1 construct, so a mission-bearing scenario is refused at
    // this boundary rather than quietly hosting a runtime nobody owns.
    if (options.game?.state.scenario.mission) {
      throw new Error('Multiplayer rooms cannot host a mission scenario.');
    }
    this.roomId = options.roomId;
    this.mode = options.mode;
    this.matchDurationMs = options.matchDurationMs;
    this.matchDeadlineAt = options.matchDeadlineAt;
    this.abandonAfterMs = options.abandonAfterMs ?? 30_000;
    this.maxDeltaChain = Math.max(1, options.maxDeltaChain ?? MAX_DELTA_CHAIN);
    this.maxSequence = Math.max(2, options.maxSequence ?? 0x7fffffff);
    this.promoteOnConnect = options.promoteOnConnect ?? false;
    const createdAtNow = options.now ?? Date.now();
    this.startedAtMs =
      options.startedAtMs !== undefined
        ? options.startedAtMs
        : options.phase === 'playing'
          ? createdAtNow
          : null;
    this.startedAtDerived = options.startedAtDerived ?? false;
    if (this.startedAtMs !== null && this.startedAtMs > this.matchDeadlineAt) {
      throw new Error('Match start is after the durable deadline.');
    }
    if (
      options.restoredSeats &&
      (options.phase === 'playing' || options.phase === 'finished') &&
      this.startedAtMs === null
    ) {
      throw new Error('Restored room is missing its durable match start.');
    }
    this.diagnostics = options.diagnostics ?? new RoomDiagnostics();

    if (options.game) {
      this.game = options.game;
    } else {
      // No game was handed in, so build the catalogue's default multiplayer
      // battlefield rather than a campaign theatre a lobby cannot choose.
      const scenario =
        options.mode === 'outbreak'
          ? buildLobbyScenario(defaultOutbreakLobbyConfig(options.matchDurationMs))
          : scenarioById(defaultScenarioId('multiplayer'))!.create();
      if (scenario.mission) {
        throw new Error('The multiplayer battlefield catalogue cannot carry a mission.');
      }
      scenario.settings.fog = true;
      // Outbreak is endless: it has no match clock to lose on, only the
      // Command Post. A 1v1 room still ends on its duration.
      if (options.mode !== 'outbreak') {
        scenario.settings.timeLimitSec = Math.max(1, Math.ceil(options.matchDurationMs / 1000));
      }
      scenario.players[0].isAI = false;
      scenario.players[1].isAI = false;
      this.game = new Game(scenario, { localPlayerId: -1, enableAI: false });
      // The single-player opening notice is stamped for PLAYER. A server room
      // has no local player, so discard that presentation-only event before the
      // first projected snapshot.
      this.game.state.events = [];
      this.game.state.eventSeq = 1;
    }

    this.map = projectMap(this.game);
    this.phase = options.phase ?? 'waiting';
    this.result = options.result ?? evaluateMatchResult(this.game);
    if (this.phase === 'finished' && this.result.phase !== 'finished') {
      throw new Error('A finished room needs a finished match result.');
    }
    if (this.phase === 'finished' || (this.phase === 'closed' && this.result.phase === 'finished')) {
      this.finishedAtMs = options.finishedAtMs ?? this.startedAtMs ?? createdAtNow;
      if (this.startedAtMs !== null && this.finishedAtMs < this.startedAtMs) {
        throw new Error('Match finish precedes its start.');
      }
    }

    this.seats = options.seats.map((seat) => {
      const restored = options.restoredSeats?.find((entry) => entry.seatId === seat.seatId);
      const everConnected = restored?.everConnected ?? false;
      const epoch = restored?.epoch ?? 0;
      // An active room implies both seats held a socket before the snapshot
      // was written. Refuse to default an occupied seat to generation zero if
      // a malformed or partially-written record says otherwise. The one
      // exception is the opening snapshot an explicit start persists before it
      // admits a socket: at tick zero with generation and sequence zero nothing
      // was ever sent, so there is no earlier baseline to collide with. An
      // advanced snapshot that lost a generation is still refused.
      const unplayedOpening =
        this.game.state.tick === 0 && (restored?.epoch ?? 0) === 0 && (restored?.seq ?? 0) === 0;
      if (
        restored &&
        !everConnected &&
        !unplayedOpening &&
        (this.phase === 'playing' || this.phase === 'finished')
      ) {
        throw new Error(`Restored active seat ${seat.seatId} has no sync generation.`);
      }
      // The restored snapshot is a durable high-water mark, not the live
      // generation. Open a fence above it so an unpersisted sync cannot make a
      // reconnecting client reject the first restored baseline. Refuse to
      // restore if the fence could wrap the protocol's 31-bit epoch.
      let nextEpoch = epoch;
      if (restored && everConnected) {
        if (epoch > 0x7fffffff - RESTORE_EPOCH_ADVANCE - 1) {
          throw new Error(`Restored seat ${seat.seatId} has exhausted its sync generation.`);
        }
        nextEpoch = epoch + RESTORE_EPOCH_ADVANCE;
      }
      let disconnectedAt: number | null = null;
      if (this.phase === 'playing' || this.phase === 'waiting') {
        if (!restored) {
          // A brand new room has no socket history, so no seat is inside a
          // reconnect grace period yet. The opening snapshot an explicit start
          // persists depends on this: a never-connected seat must carry no
          // recovery state, and `connect()` stamps the grace period the moment
          // a real socket is admitted or a send fails.
          disconnectedAt = null;
        } else if (restored.connected) {
          // The runtime restart closed every socket. The reconnect grace period
          // starts now for a seat that was connected when the snapshot was taken.
          disconnectedAt = createdAtNow;
        } else {
          disconnectedAt = restored.disconnectedAt;
        }
      }
      return {
        ...seat,
        connected: false,
        everConnected,
        socket: null,
        disconnectedAt,
        abandoned: restored?.abandoned ?? false,
        lastMessageAt: 0,
        messageWindowStart: 0,
        messageCount: 0,
        lastActivityAt: 0,
        lastKeepaliveAt: null,
        lastAckAt: null,
        epoch: nextEpoch,
        seq: restored?.seq ?? 0,
        chain: 0,
        sync: null,
        lastResyncAt: null,
      };
    });
    // The constructor is the authoritative start boundary. A restored room
    // supplies the durable snapshot, while a newly started room captures the
    // identity verified before start. Cloning keeps the snapshot immutable even
    // if a caller mutates the metadata object it passed in.
    this.matchIdentities = options.seats.map((seat) => {
      const supplied = options.identities?.find((entry) => entry.seatId === seat.seatId);
      const source =
        options.identities !== undefined
          ? (supplied?.identity ?? null)
          : (seat.identity ?? null);
      return { seatId: seat.seatId, identity: cloneSeatIdentity(source) };
    });
    this.gate = new CommandGate(
      this.game,
      this.seats.map((seat) => ({
        seatId: seat.seatId,
        playerId: seat.playerId,
        team: seat.team,
        active: true,
      })),
      {
        minCommandIntervalMs: 100,
        maxPayloadBytes: MAX_CLIENT_MESSAGE_BYTES,
        maxIds: 64,
      },
    );
    if (this.phase === 'finished' || this.phase === 'closed') this.gate.endMatch();
  }

  get currentPhase(): RoomPhase {
    return this.phase;
  }

  get currentResult(): NeutralMatchResult {
    return this.result;
  }

  get startedAt(): number | null {
    return this.startedAtMs;
  }

  get finishedAt(): number | null {
    return this.finishedAtMs;
  }

  get closed(): boolean {
    return this.phase === 'finished' || this.phase === 'closed';
  }

  /** The immutable identity this match started with for a seat. */
  identityFor(seatId: number): SeatIdentity | null {
    return this.matchIdentities.find((entry) => entry.seatId === seatId)?.identity ?? null;
  }

  /** Check a seat token without reserving the socket (used before a 101). */
  authorizeSeat(seatId: number, token: string): { ok: true } | { ok: false; code: string; message: string } {
    if (this.phase === 'finished' || this.phase === 'closed') {
      return { ok: false, code: 'room-closed', message: 'This room is closed.' };
    }
    const seat = this.seats[seatId];
    if (!seat) return { ok: false, code: 'invalid-seat', message: 'Seat is not valid.' };
    if (!sameToken(token, seat.token)) {
      return { ok: false, code: 'unauthorized', message: 'Seat token is not valid.' };
    }
    if (seat.abandoned) {
      return { ok: false, code: 'seat-abandoned', message: 'This seat has been abandoned.' };
    }
    if (seat.socket) {
      return { ok: false, code: 'seat-occupied', message: 'This seat is already connected.' };
    }
    return { ok: true };
  }

  /** Whether this seat has ever held a socket in this room process. */
  hasSeatConnected(seatId: number): boolean {
    return this.seats[seatId]?.everConnected ?? false;
  }

  /** Connect one already-authenticated seat. The token is the only authority. */
  connect(
    seatId: number,
    token: string,
    socket: RoomSocket,
    now = Date.now(),
  ): ConnectResult {
    const authorized = this.authorizeSeat(seatId, token);
    if (!authorized.ok) return authorized;
    const seat = this.seats[seatId];
    const reconnect = seat.everConnected;
    if (reconnect) this.diagnostics.recordReconnectAttempt();

    seat.socket = socket;
    seat.connected = true;
    seat.everConnected = true;
    seat.disconnectedAt = null;
    seat.lastMessageAt = now;
    seat.messageWindowStart = now;
    seat.messageCount = 0;
    seat.lastActivityAt = now;
    seat.lastKeepaliveAt = null;
    seat.lastAckAt = null;
    // A reconnect must never resume the previous socket's baseline.
    seat.sync = null;
    seat.chain = 0;
    seat.lastResyncAt = null;
    this.connectionsAccepted++;
    this.diagnostics.recordConnect(seatId, reconnect);

    if (this.phase === 'waiting' && this.promoteOnConnect && this.seats.every((entry) => entry.connected)) {
      this.phase = 'playing';
      // A restore can carry a durable start even when the room metadata still
      // says waiting (for example a crash between the snapshot and meta
      // writes). Never move an already-authoritative start on the first
      // connection after that recovery.
      if (this.startedAtMs === null) this.startedAtMs = now;
    }

    const hello = this.helloFor(seat);
    if (!this.sendJson(seat, hello)) {
      this.disconnect(seatId, socket, now);
      return { ok: false, code: 'send-failed', message: 'Could not establish the room socket.' };
    }
    this.openSync(seat, false);
    return { ok: true, hello };
  }

  /** The close event must not clear a newer replacement socket. */
  disconnect(seatId: number, socket: RoomSocket, now = Date.now()): void {
    const seat = this.seats[seatId];
    if (!seat || seat.socket !== socket) return;
    if (seat.connected) this.diagnostics.recordDisconnect(seatId);
    seat.socket = null;
    seat.connected = false;
    if (this.phase === 'playing' || this.phase === 'waiting') seat.disconnectedAt = now;
  }

  /**
   * One fixed simulation step. The Durable Object scheduler decides how many
   * times to call this; network arrival never changes the step size.
   */
  tick(now: number): TickResult {
    const measure = this.diagnostics.enabled;
    const startedAt = measure ? monotonicNow() : 0;
    let simulationMs = 0;
    let ticked = false;
    try {
      if (this.phase !== 'playing') {
        return { ticked: false, snapshotDue: false, finished: this.closed };
      }
      if (now >= this.matchDeadlineAt) {
        this.finishAtDeadline(now);
        return { ticked: false, snapshotDue: false, finished: true };
      }

      const simulationStartedAt = measure ? monotonicNow() : 0;
      this.game.tick();
      simulationMs = measure ? monotonicNow() - simulationStartedAt : 0;
      ticked = true;
      this.ticks++;
      this.checkAbandonment(now);
      if (this.closed) return { ticked: true, snapshotDue: false, finished: true };

      const result = evaluateMatchResult(this.game);
      if (result.phase === 'finished') {
        this.finish(result, now);
        return { ticked: true, snapshotDue: false, finished: true };
      }
      this.result = result;

      const snapshotDue = this.game.state.tick % SNAPSHOT_EVERY_TICKS === 0;
      if (snapshotDue) this.broadcast();
      return { ticked: true, snapshotDue, finished: false };
    } catch (error) {
      this.diagnostics.recordTickError(error);
      throw error;
    } finally {
      if (ticked && measure) this.diagnostics.recordTick(monotonicNow() - startedAt, simulationMs);
    }
  }

  /** Apply a reservation's hard deadline even if the tick clock was paused. */
  finishAtDeadline(now = Date.now()): void {
    if (this.closed) return;
    this.diagnostics.recordDeadline();
    // A co-op run has no winning side to award at the reservation's deadline:
    // the horde holding more hit points is not a victory for anybody. The room
    // closes the run as abandoned, which every seat reads as a draw.
    const result: NeutralMatchResult =
      this.mode === 'outbreak'
        ? {
            ...evaluateMatchResult(this.game),
            phase: 'finished',
            winnerTeam: null,
            reason: 'abandoned',
            tick: this.game.state.tick,
          }
        : evaluateMatchResult(this.game, { forceTimeLimit: true });
    this.finish(result, now);
  }

  /**
   * Fail closed for reservation, storage or operator shutdown.
   *
   * This is an abort, not a match finish. The neutral result stays whatever
   * the last tick produced, so no finish time may be attached to it: a
   * snapshot pairs timing with that result, and `playing` plus a finish time
   * is exactly the mixed lifecycle state its validator rejects. Room closure
   * time is recorded separately in the Durable Object metadata.
   */
  fail(reason: string, _now = Date.now(), code = 'room-closed'): void {
    if (this.closed) return;
    this.phase = 'closed';
    this.closedReason = reason;
    this.gate.endMatch();
    this.sendClosed(reason, code);
  }

  /** Handle one client text frame. The socket identity is supplied by the DO. */
  receive(seatId: number, socket: RoomSocket, text: string, now = Date.now()): void {
    const seat = this.seats[seatId];
    if (!seat || seat.socket !== socket) {
      this.sendErrorToSocket(socket, 'seat-inactive', 'This seat is not active.');
      return;
    }
    if (this.phase === 'finished' || this.phase === 'closed') {
      this.sendError(seat, 'room-closed', 'This room is closed.');
      return;
    }

    if (now - seat.messageWindowStart >= 1000) {
      seat.messageWindowStart = now;
      seat.messageCount = 0;
    }
    seat.messageCount++;
    seat.lastMessageAt = now;
    this.inboundMessages++;
    if (seat.messageCount > MAX_CLIENT_MESSAGES_PER_SECOND) {
      this.dropSeat(seat, 1008, 'message rate exceeded', now);
      return;
    }

    const parsed = parseClientMessage(text, MAX_CLIENT_MESSAGE_BYTES);
    if (!parsed.ok) {
      this.sendError(seat, parsed.code, parsed.message);
      return;
    }

    // Keepalive is transport bookkeeping: allowed while waiting or playing,
    // rejected after finish/close above, and never routed through CommandGate.
    if (parsed.message.type === 'keepalive') {
      this.handleKeepalive(seat, text, now);
      return;
    }

    if (parsed.message.type === 'resync') {
      this.handleResync(seat, text, now);
      return;
    }

    // Readiness and nation/colour belong to the lobby. Refuse them by name here
    // so a client cannot believe it is still in a pre-match state, and so the
    // gate never sees them.
    if (parsed.message.type === 'ready') {
      this.sendError(seat, 'match-already-started', 'The match has already started.');
      return;
    }
    if (parsed.message.type === 'lobbySet') {
      this.sendError(seat, 'match-already-started', 'The match configuration is locked.');
      return;
    }

    if (this.phase === 'waiting') {
      this.sendError(seat, 'match-not-started', 'The match has not started yet.');
      return;
    }

    // The gate's internal envelope is a separate, transport-independent
    // contract and stays at version 1; only the wire protocol moved to v2.
    const gateResult = this.gate.submitText(
      seatId,
      JSON.stringify({ v: 1, command: parsed.message.command }),
      now,
    );
    if (!gateResult.ok) {
      this.commandsRejected++;
      this.sendJson(seat, this.rejection(gateResult));
      return;
    }
    this.commandsAccepted++;
    seat.lastActivityAt = now;
    const accepted: CommandAcceptedMessage = {
      type: 'commandAccepted',
      v: ROOM_PROTOCOL_VERSION,
      tick: this.game.state.tick,
      commandType: gateResult.command.type,
    };
    this.sendJson(seat, accepted);
  }

  /**
   * Client-requested recovery. A resync is transport bookkeeping: it never
   * enters the gate, the tick or persistence, and it is rate limited per seat
   * so a broken client cannot force an unbounded stream of full projections.
   */
  private handleResync(seat: SeatState, text: string, now: number): void {
    if (text.length > MAX_RESYNC_MESSAGE_BYTES) {
      this.diagnostics.recordResyncRejected('payload-too-large');
      this.sendError(seat, 'payload-too-large', 'Resync request is too large.');
      return;
    }
    if (seat.lastResyncAt !== null && now - seat.lastResyncAt < RESYNC_MIN_INTERVAL_MS) {
      this.diagnostics.recordResyncRejected('resync-rate-limited');
      this.sendError(seat, 'resync-rate-limited', 'Resync requests are too frequent.');
      return;
    }
    seat.lastResyncAt = now;
    this.diagnostics.recordResyncAccepted();
    this.openSync(seat, true);
  }

  /**
   * Acknowledge transport aliveness without touching the gate, the tick, the
   * persistence cycle or the match deadline. A too-frequent keepalive is
   * rejected and does not become activity.
   */
  private handleKeepalive(seat: SeatState, text: string, now: number): void {
    if (text.length > MAX_KEEPALIVE_MESSAGE_BYTES) {
      this.sendError(seat, 'payload-too-large', 'Keepalive is too large.');
      return;
    }
    if (seat.lastKeepaliveAt !== null && now - seat.lastKeepaliveAt < KEEPALIVE_MIN_INTERVAL_MS) {
      this.diagnostics.recordKeepaliveRateLimited();
      this.sendError(seat, 'keepalive-rate-limited', 'Keepalive is too frequent.');
      return;
    }
    seat.lastKeepaliveAt = now;
    this.diagnostics.recordKeepalive();
    const ack: KeepaliveAckMessage = { type: 'keepaliveAck', v: ROOM_PROTOCOL_VERSION };
    if (!this.sendJson(seat, ack)) return;
    seat.lastActivityAt = now;
    seat.lastAckAt = now;
    this.diagnostics.recordKeepaliveAck();
  }

  /** Room-owned recovery record; tokens are stored separately by the DO. */
  snapshot(now = Date.now()): RoomSnapshot {
    return createRoomSnapshot(this.game, {
      roomId: this.roomId,
      seats: this.seatSnapshots(),
      timing: { startedAtMs: this.startedAtMs, finishedAtMs: this.finishedAtMs },
      now,
      result: this.result,
      identities: this.matchIdentities,
    });
  }

  status(): RoomMatchStatus {
    return {
      roomId: this.roomId,
      mode: this.mode,
      protocol: this.protocol,
      phase: this.phase,
      tick: this.game.state.tick,
      matchDeadlineAt: this.matchDeadlineAt,
      startedAtMs: this.startedAtMs,
      finishedAtMs: this.finishedAtMs,
      startedAtDerived: this.startedAtDerived,
      closedReason: this.closedReason,
      seats: this.seats.map((seat) => ({
        seatId: seat.seatId,
        playerId: seat.playerId,
        team: seat.team,
        connected: seat.connected,
        abandoned: seat.abandoned,
        lastActivityAt: seat.lastActivityAt,
        lastKeepaliveAt: seat.lastKeepaliveAt,
        lastAckAt: seat.lastAckAt,
        bufferedBytes: seat.socket?.bufferedAmount ?? 0,
        epoch: seat.epoch,
        seq: seat.seq,
        chain: seat.chain,
        identity: cloneSeatIdentity(this.identityFor(seat.seatId)),
      })),
      result: this.result,
      diagnostics: this.diagnostics.summary(),
      census: this.census(),
      stats: {
        ticks: this.game.state.tick,
        processTicks: this.ticks,
        snapshots: this.snapshots,
        syncs: this.syncs,
        deltas: this.deltas,
        outboundBytes: this.outboundBytes,
        inboundMessages: this.inboundMessages,
        connectionsAccepted: this.connectionsAccepted,
        commandsAccepted: this.commandsAccepted,
        commandsRejected: this.commandsRejected,
        heartbeatCount: this.heartbeatCount,
        approxRequests: this.approxRequests(),
      },
    };
  }

  private census(): RoomMatchStatus['census'] {
    const state = this.game.state;
    let units = 0;
    let buildings = 0;
    for (const entity of state.entities) {
      if (entity.kind === 'unit') units++;
      else if (entity.kind === 'building') buildings++;
    }
    return {
      entities: state.entities.length,
      units,
      buildings,
      projectiles: state.projectiles.length,
      contacts: state.contacts.length,
      charted: state.charted.length,
      events: state.events.length,
      pendingCommands: this.game.pending.length,
      fogTiles: state.fog.reduce((total, layer) => total + layer.length, 0),
      lastEventSeq: this.lastEventSeq,
      bufferedBytes: this.seats.map((seat) => seat.socket?.bufferedAmount ?? 0),
    };
  }

  /** Called by the lease owner after a successful coordinator heartbeat. */
  noteHeartbeat(): void {
    this.heartbeatCount++;
  }

  private helloFor(seat: SeatState): HelloMessage {
    return {
      type: 'hello',
      v: ROOM_PROTOCOL_VERSION,
      protocol: ROOM_PROTOCOL_VERSION,
      roomId: this.roomId,
      seat: seat.seatId,
      playerId: seat.playerId,
      team: seat.team,
      mode: this.mode,
      phase: this.phase,
      tick: this.game.state.tick,
      tickHz: TICK_HZ,
      snapshotHz: SNAPSHOT_HZ,
      keepaliveMs: KEEPALIVE_INTERVAL_MS,
      matchDeadlineAt: this.matchDeadlineAt,
      identities: this.matchIdentities.map((entry) => ({
        seatId: entry.seatId,
        identity: cloneSeatIdentity(entry.identity),
      })),
    };
  }

  private checkAbandonment(now: number): void {
    if (this.closed) return;
    const abandonedTeams = new Set<number>();
    for (const seat of this.seats) {
      if (seat.connected || seat.abandoned || seat.disconnectedAt === null) continue;
      if (now - seat.disconnectedAt < this.abandonAfterMs) continue;
      seat.abandoned = true;
      abandonedTeams.add(seat.team);
    }
    if (abandonedTeams.size === 0) return;
    this.finish(
      evaluateMatchResult(this.game, { abandonedTeams: [...abandonedTeams] }),
      now,
    );
  }

  /**
   * One 10 Hz update per team. The projected dynamic state is built once per
   * team and shared by its seats; each seat then gets only its own differences.
   * The immutable map is never part of a delta.
   */
  private broadcast(): void {
    const sinceSeq = this.lastEventSeq;
    for (const team of [0, 1]) {
      const recipients = this.seats.filter((seat) => seat.team === team && seat.connected);
      if (recipients.length === 0) continue;
      let state: ProjectedTeamState;
      try {
        state = createTeamState(this.game, team, sinceSeq, this.result, false);
      } catch (error) {
        this.diagnostics.recordTickError(error);
        throw error;
      }
      const map = this.game.state.map;
      const fog = this.game.state.fog[team] ?? new Uint8Array(map.width * map.height);
      for (const seat of recipients) this.publish(seat, state, fog);
    }
    this.lastEventSeq = Math.max(0, this.game.state.eventSeq - 1);
  }

  /**
   * Monotonic per-seat sequence. Dispatch must never call this at the limit:
   * a wrapped delta would be older than the client's applied sequence, so
   * `publish` starts a new sync generation instead. `sendSync` is the only
   * place allowed to reset the counter.
   */
  private nextSeq(seat: SeatState): number {
    seat.seq += 1;
    return seat.seq;
  }

  /**
   * Start a new synchronisation generation. The map is included only when the
   * recipient needs a new static baseline: first connect, reconnect or an
   * explicit resync. Periodic checkpoints retain the client's existing map.
   */
  private openSync(seat: SeatState, checkpoint: boolean, includeMap = true): void {
    if (!seat.socket) return;
    this.sendSync(
      seat,
      createTeamSnapshot(this.game, seat.team, this.game.state.eventSeq, this.result, this.map),
      checkpoint,
      includeMap,
    );
  }

  private sendSync(
    seat: SeatState,
    state: TeamSnapshot,
    checkpoint: boolean,
    includeMap: boolean,
  ): void {
    if (!seat.socket) return;
    if (seat.seq >= this.maxSequence) seat.seq = 0;
    seat.epoch += 1;
    const seq = this.nextSeq(seat);
    const wireState: SyncState = includeMap
      ? state
      : (() => {
          const { map: _map, ...dynamic } = state;
          return dynamic;
        })();
    const message: SyncMessage = {
      type: 'sync',
      v: ROOM_PROTOCOL_VERSION,
      roomId: this.roomId,
      epoch: seat.epoch,
      seq,
      tick: this.game.state.tick,
      team: seat.team,
      checkpoint,
      state: wireState,
    };
    const measure = this.diagnostics.enabled;
    const serializationStartedAt = measure ? monotonicNow() : 0;
    let text: string;
    try {
      text = JSON.stringify(message);
    } catch {
      this.diagnostics.recordSnapshotSerializationFailure();
      this.dropSeat(seat, 1011, 'serialization-failed', Date.now());
      return;
    }
    if (text.length > MAX_SYNC_BYTES) {
      this.diagnostics.recordSnapshotSerializationFailure();
      this.dropSeat(seat, 1011, 'sync-too-large', Date.now());
      return;
    }
    const serializationMs = measure ? monotonicNow() - serializationStartedAt : 0;
    const bytes = this.sendText(seat, text, 'snapshot');
    if (bytes === 0) return;
    seat.sync = createBaseline(state);
    seat.chain = 0;
    this.snapshots++;
    this.syncs++;
    this.diagnostics.recordSnapshot(seat.seatId, serializationMs, bytes);
    this.diagnostics.recordSync(seat.seatId, bytes);
  }

  /** Send only what changed for this seat, or force a checkpoint when due. */
  private publish(seat: SeatState, state: ProjectedTeamState, fog: Uint8Array): void {
    if (!seat.socket || !seat.connected) return;
    if (!seat.sync || seat.chain >= this.maxDeltaChain || seat.seq >= this.maxSequence) {
      // The recipient already has the immutable map; do not repeat it. A
      // missing baseline cannot reach this branch: connect() always sends the
      // initial map-bearing sync before the seat is considered publishable.
      this.openSync(seat, true, false);
      return;
    }
    const base = seat.seq;
    const seq = this.nextSeq(seat);
    let changes: DeltaChanges;
    try {
      changes = buildDelta(seat.sync, state, fog);
    } catch {
      // A changed fog shape cannot be expressed as a delta; recover with a sync.
      this.openSync(seat, true);
      return;
    }
    const message: DeltaMessage = {
      type: 'delta',
      v: ROOM_PROTOCOL_VERSION,
      roomId: this.roomId,
      epoch: seat.epoch,
      seq,
      base,
      tick: this.game.state.tick,
      team: seat.team,
      changes,
    };
    const measure = this.diagnostics.enabled;
    const serializationStartedAt = measure ? monotonicNow() : 0;
    let text: string;
    try {
      text = JSON.stringify(message);
    } catch {
      this.diagnostics.recordSnapshotSerializationFailure();
      this.dropSeat(seat, 1011, 'serialization-failed', Date.now());
      return;
    }
    const serializationMs = measure ? monotonicNow() - serializationStartedAt : 0;
    const bytes = this.sendText(seat, text, 'snapshot');
    if (bytes === 0) return;
    seat.sync = createBaseline(state, fog);
    seat.chain += 1;
    this.snapshots++;
    this.deltas++;
    this.diagnostics.recordSnapshot(seat.seatId, serializationMs, bytes);
    this.diagnostics.recordDelta(seat.seatId, bytes);
  }

  private finish(result: NeutralMatchResult, now: number): void {
    if (this.closed) return;
    this.phase = 'finished';
    this.result = result;
    this.finishedAtMs = now;
    this.gate.endMatch();

    // The final state is useful to a client that wants to show the map behind
    // the result. It is still built through the team projection, never raw
    // GameState, and it is delivered as a final checkpoint sync.
    for (const team of [0, 1]) {
      const recipients = this.seats.filter((seat) => seat.team === team && seat.connected);
      if (recipients.length === 0) continue;
      const snapshot = createTeamSnapshot(this.game, team, this.lastEventSeq, result, this.map);
      for (const seat of recipients) this.sendSync(seat, snapshot, true, false);
    }
    this.lastEventSeq = Math.max(0, this.game.state.eventSeq - 1);

    for (const seat of this.seats) {
      if (!seat.socket || !seat.connected) continue;
      const message = resultMessageFor(
        result,
        projectedResultForTeam(result, seat.team),
        seat.team,
        matchIdFor(this.roomId, this.startedAt ?? now),
        this.matchIdentities.map((entry) => ({
          seatId: entry.seatId,
          identity: cloneSeatIdentity(entry.identity),
        })),
      );
      this.sendJson(seat, message);
      this.closeSeat(seat, 1000, 'match-finished');
    }
  }

  private sendClosed(reason: string, code: string): void {
    for (const seat of this.seats) {
      if (!seat.socket || !seat.connected) continue;
      const message: RoomClosedMessage = {
        type: 'roomClosed',
        v: ROOM_PROTOCOL_VERSION,
        reason,
        code,
      };
      this.sendJson(seat, message);
      this.closeSeat(seat, 1012, reason);
    }
  }

  private rejection(result: GateRejection): CommandRejectedMessage {
    const message: CommandRejectedMessage = {
      type: 'commandRejected',
      v: ROOM_PROTOCOL_VERSION,
      code: result.code,
      message: result.message,
    };
    if (result.detail !== undefined) message.detail = result.detail;
    return message;
  }

  private sendError(seat: SeatState, code: string, message: string): void {
    const error: ErrorMessage = {
      type: 'error',
      v: ROOM_PROTOCOL_VERSION,
      code,
      message,
    };
    this.sendJson(seat, error);
  }

  private sendErrorToSocket(socket: RoomSocket, code: string, message: string): void {
    const error: ErrorMessage = {
      type: 'error',
      v: ROOM_PROTOCOL_VERSION,
      code,
      message,
    };
    try {
      socket.send(JSON.stringify(error));
    } catch {
      /* the socket is already gone */
    }
  }

  private sendJson(seat: SeatState, message: unknown): boolean {
    if (!seat.socket) return false;
    let text: string;
    try {
      text = JSON.stringify(message);
    } catch {
      this.diagnostics.recordControlSendFailure();
      this.dropSeat(seat, 1011, 'serialization-failed', Date.now());
      return false;
    }
    return this.sendText(seat, text, 'control') > 0;
  }

  private sendText(seat: SeatState, text: string, kind: 'snapshot' | 'control'): number {
    if (!seat.socket) return 0;
    try {
      if (typeof seat.socket.bufferedAmount === 'number') {
        this.diagnostics.recordBufferedAmount(seat.seatId, seat.socket.bufferedAmount);
      }
      if (
        typeof seat.socket.bufferedAmount === 'number' &&
        seat.socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES
      ) {
        this.diagnostics.recordSlowClient();
        this.dropSeat(seat, 1009, 'slow-client', Date.now());
        return 0;
      }
      seat.socket.send(text);
      // UTF-16 code-unit count. The protocol JSON is ASCII today, so this is
      // also its UTF-8 byte count, and it avoids a second O(payload) scan on
      // every 10 Hz snapshot. Client evidence records exact UTF-8 bytes.
      const bytes = text.length;
      this.outboundBytes += bytes;
      return bytes;
    } catch {
      if (kind === 'snapshot') this.diagnostics.recordSnapshotSendFailure();
      else this.diagnostics.recordControlSendFailure();
      this.dropSeat(seat, 1011, 'send-failed', Date.now());
      return 0;
    }
  }

  private dropSeat(seat: SeatState, code: number, reason: string, now: number): void {
    const socket = seat.socket;
    if (!socket) return;
    if (seat.connected) this.diagnostics.recordDisconnect(seat.seatId);
    seat.socket = null;
    seat.connected = false;
    if (this.phase === 'playing') seat.disconnectedAt = now;
    try {
      socket.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  private closeSeat(seat: SeatState, code: number, reason: string): void {
    if (!seat.socket) return;
    if (seat.connected) this.diagnostics.recordDisconnect(seat.seatId);
    const socket = seat.socket;
    seat.socket = null;
    seat.connected = false;
    try {
      socket.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  private seatSnapshots(): RoomSeatSnapshot[] {
    return this.seats.map((seat) => ({
      seatId: seat.seatId,
      playerId: seat.playerId,
      team: seat.team,
      connected: seat.connected,
      abandoned: seat.abandoned,
      everConnected: seat.everConnected,
      disconnectedAt: seat.disconnectedAt,
      epoch: seat.epoch,
      seq: seat.seq,
    }));
  }

  private approxRequests(): number {
    // WebSocket upgrade + incoming messages at 20:1 + coordinator heartbeats
    // and create/release lifecycle. This is an accounting estimate, reported
    // separately from Cloudflare's own metrics.
    return (
      this.connectionsAccepted +
      Math.ceil(this.inboundMessages / 20) +
      this.heartbeatCount +
      4
    );
  }
}

/** Rebuild a room from a validated server snapshot and its seat token table. */
export function restoreRoomMatch(options: {
  roomId: string;
  /** What the room hosted; absent means the legacy 1v1 room. */
  mode?: RoomGameMode;
  seats: readonly RoomSeatDefinition[];
  matchDurationMs: number;
  matchDeadlineAt: number;
  snapshot: RoomSnapshot | RoomSnapshotV1;
  phase?: RoomPhase;
  now?: number;
  abandonAfterMs?: number;
  diagnostics?: RoomDiagnostics;
  /** Durable metadata fallback if the snapshot predates its first start write. */
  startedAtMs?: number | null;
  finishedAtMs?: number | null;
  /** Restart time, used to begin reconnect grace for seats that were connected. */
  restoredAtMs?: number;
  /** Legacy fixture shim; see `RoomMatchOptions.promoteOnConnect`. */
  promoteOnConnect?: boolean;
}): RoomMatch {
  const now = options.restoredAtMs ?? options.now ?? Date.now();
  const snapshot = validateRoomSnapshot(options.snapshot, {
    now,
    matchDeadlineAt: options.matchDeadlineAt,
    matchDurationMs: options.matchDurationMs,
    startedAtMs: options.startedAtMs,
  });
  const phase =
    options.phase ??
    (snapshot.result.phase === 'finished' ? 'finished' : 'playing');
  let startedAtMs = snapshot.timing.startedAtMs ?? options.startedAtMs ?? null;
  let startedAtDerived = false;
  if (startedAtMs === null && (phase === 'playing' || phase === 'finished')) {
    // The reservation deadline and fixed duration are both durable. Their
    // difference is the planned start and is only used when neither the
    // snapshot nor the room metadata persisted an actual start.
    const plannedStart = options.matchDeadlineAt - options.matchDurationMs;
    if (!Number.isInteger(plannedStart) || plannedStart < 0) {
      throw new Error('Restored room has no durable match start.');
    }
    startedAtMs = plannedStart;
    startedAtDerived = true;
  }
  // Re-validate while rebuilding the simulation. A migrated v1 record has
  // already become a v2 envelope with a null start, so the derived start must
  // be supplied again or the strict v2 validator would reject it.
  const game = restoreRoomSnapshot(snapshot, {
    startedAtMs,
    matchDeadlineAt: options.matchDeadlineAt,
    matchDurationMs: options.matchDurationMs,
  });
  return new RoomMatch({
    roomId: options.roomId,
    mode: options.mode ?? '1v1',
    seats: options.seats,
    matchDurationMs: options.matchDurationMs,
    matchDeadlineAt: options.matchDeadlineAt,
    game,
    promoteOnConnect: options.promoteOnConnect,
    result: snapshot.result,
    phase,
    now,
    startedAtMs,
    startedAtDerived,
    finishedAtMs: snapshot.timing.finishedAtMs ?? options.finishedAtMs ?? null,
    restoredSeats: snapshot.seats,
    identities: snapshot.identities,
    abandonAfterMs: options.abandonAfterMs,
    diagnostics: options.diagnostics,
  });
}

function cloneSeatIdentity(identity: SeatIdentity | null | undefined): SeatIdentity | null {
  if (!identity) return null;
  // Re-validate the presentation on every boundary. The frame/background are
  // catalogue ids, and an unknown one is dropped rather than rendered.
  return identitySnapshot(identity) as SeatIdentity | null;
}

/** Narrow helper for the Durable Object's stored status. */
export function projectedResultForTeam(
  result: NeutralMatchResult,
  team: number,
): ProjectedMatchResult {
  // The room uses TeamSnapshot.result for the wire; this export keeps tests and
  // diagnostics from reconstructing an unredacted object.
  if (!isRecord(result)) throw new Error('Invalid match result.');
  return {
    phase: result.phase,
    winnerTeam: result.winnerTeam,
    reason: result.reason,
    tick: result.tick,
    teams: result.teams.map((entry) => ({
      team: entry.team,
      playerIds: [...entry.playerIds],
      defeated: entry.defeated,
      score: entry.team === team ? entry.score : null,
    })),
  };
}
