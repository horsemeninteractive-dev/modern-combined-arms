/**
 * The pre-match half of a room: seats, sockets, readiness and configuration.
 *
 * A lobby is not a match. It owns no `Game`, no snapshot and no simulation
 * clock, so a room that has not started can be restored from its durable
 * metadata alone and cannot be mistaken for a playing room. The moment the host
 * starts, the Durable Object builds the authoritative `Game`, persists it and
 * hands these sockets to a `RoomMatch`; this object is then discarded.
 *
 * Wire surface is deliberately tiny: one server state message (`lobby`) and one
 * client intent (`ready`). Match start is not a socket message; it is an
 * authenticated host action on the room's HTTP surface, so the room can never
 * start because of something a socket happened to send.
 */
import {
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_CLIENT_MESSAGES_PER_SECOND,
  MAX_KEEPALIVE_MESSAGE_BYTES,
  KEEPALIVE_MIN_INTERVAL_MS,
  ROOM_PROTOCOL_VERSION,
  parseClientMessage,
  type KeepaliveAckMessage,
  type LobbyMessage,
} from './protocol';
import { seatTokenMatches, type RoomSeatDefinition, type RoomSocket } from './roomMatch';
import {
  isLobbyColor,
  isLobbyNation,
  isPlayableMapId,
  validateLobbyConfig,
  type LobbyConfigV1,
} from './lobbyConfig';
import { isWeatherKind } from '../sim/weather';

export interface LobbyChangeResult {
  ok: boolean;
  code?: string;
  message?: string;
}

export interface LobbySeatState extends RoomSeatDefinition {
  connected: boolean;
  everConnected: boolean;
  socket: RoomSocket | null;
  lastKeepaliveAt: number | null;
  messageWindowStart: number;
  messageCount: number;
}

export interface RoomLobbyOptions {
  roomId: string;
  seats: readonly RoomSeatDefinition[];
  config: LobbyConfigV1;
  /** Reservation hard deadline: the lobby may not outlive its capacity. */
  hardDeadlineAt: number;
  now?: number;
  onChanged?: () => void;
}

export interface LobbyConnectResult {
  ok: boolean;
  code?: string;
  message?: string;
  hello?: LobbyMessage;
}

/** Seat 0 is the host: it created the room and holds its reservation. */
export const LOBBY_HOST_SEAT = 0;

export class RoomLobby {
  readonly roomId: string;
  readonly mode = '1v1' as const;
  readonly protocol = ROOM_PROTOCOL_VERSION;
  readonly hostSeatId = LOBBY_HOST_SEAT;
  readonly hardDeadlineAt: number;
  readonly createdAt: number;
  private readonly seats: LobbySeatState[];
  private readonly config: LobbyConfigV1;
  private readonly onChanged: (() => void) | null;

  constructor(options: RoomLobbyOptions) {
    this.roomId = options.roomId;
    this.hardDeadlineAt = options.hardDeadlineAt;
    this.createdAt = options.now ?? Date.now();
    this.config = options.config;
    this.onChanged = options.onChanged ?? null;
    this.seats = options.seats.map((seat) => ({
      ...seat,
      connected: false,
      everConnected: false,
      socket: null,
      lastKeepaliveAt: null,
      messageWindowStart: 0,
      messageCount: 0,
    }));
  }

  get phase(): 'lobby' {
    return 'lobby';
  }

  /** Live configuration. Only the room mutates it, and only after validation. */
  get lobbyConfig(): LobbyConfigV1 {
    return this.config;
  }

  seatConnected(seatId: number): boolean {
    return this.seats[seatId]?.connected ?? false;
  }

  /**
   * A seat is occupied once its player has claimed it with a socket; the tokens
   * exist from creation, so minting them is not the same as a player joining.
   */
  occupancy(): Array<{ joined: boolean; connected: boolean }> {
    return this.seats.map((seat) => ({ joined: seat.everConnected, connected: seat.connected }));
  }

  socketFor(seatId: number): RoomSocket | null {
    return this.seats[seatId]?.socket ?? null;
  }

  /** Hand every socket to the match; the lobby must not close them itself. */
  clearSockets(): void {
    for (const seat of this.seats) seat.socket = null;
  }

  authorizeSeat(seatId: number, token: string): { ok: true } | { ok: false; code: string; message: string } {
    const seat = this.seats[seatId];
    if (!seat) return { ok: false, code: 'invalid-seat', message: 'Seat is not valid.' };
    if (!seatTokenMatches(token, seat.token)) {
      return { ok: false, code: 'unauthorized', message: 'Seat token is not valid.' };
    }
    if (seat.socket) return { ok: false, code: 'seat-occupied', message: 'This seat is already connected.' };
    return { ok: true };
  }

  connect(seatId: number, token: string, socket: RoomSocket, now = Date.now()): LobbyConnectResult {
    const authorized = this.authorizeSeat(seatId, token);
    if (!authorized.ok) return authorized;
    const seat = this.seats[seatId];
    seat.socket = socket;
    seat.connected = true;
    seat.everConnected = true;
    seat.lastKeepaliveAt = null;
    seat.messageWindowStart = now;
    seat.messageCount = 0;
    // Connecting never starts anything: the lobby stays a lobby until the host's
    // explicit, validated start action arrives on the HTTP surface.
    const hello = this.helloFor(seatId);
    if (!this.sendJson(seat, hello)) {
      seat.socket = null;
      seat.connected = false;
      return { ok: false, code: 'send-failed', message: 'Could not establish the lobby socket.' };
    }
    this.broadcast();
    return { ok: true, hello };
  }

  disconnect(seatId: number, socket: RoomSocket): void {
    const seat = this.seats[seatId];
    if (!seat || seat.socket !== socket) return;
    seat.socket = null;
    seat.connected = false;
    this.broadcast();
  }

  setReady(seatId: number, ready: boolean): boolean {
    const seat = this.config.seats[seatId];
    if (!seat || seat.ready === ready) return false;
    seat.ready = ready;
    this.broadcast();
    this.onChanged?.();
    return true;
  }

  /**
   * Replace a seat's verified presentation before start. Nation and colour are
   * not touched: they are match selections, not personal identity. The caller
   * has already validated ownership and persistence.
   */
  setSeatIdentity(
    seatId: number,
    accountId: string | null,
    identity: RoomSeatDefinition['identity'],
  ): boolean {
    const seat = this.seats[seatId];
    if (!seat) return false;
    if (seat.accountId && accountId && seat.accountId !== accountId) return false;
    if (accountId) seat.accountId = accountId;
    if (identity) seat.identity = identity;
    this.broadcast();
    return true;
  }

  /**
   * Change only the calling seat's own nation or colour.
   *
   * The patch is validated against the same catalogue the start uses, and the
   * merged result must still be a legal lobby (which is what rejects a second
   * seat choosing the colour the other already holds). A change clears that
   * seat's readiness: the other player agreed to a configuration, not to this
   * one.
   */
  setSeatConfig(
    seatId: number,
    patch: { nation?: string; color?: string },
  ): LobbyChangeResult {
    const current = this.config.seats[seatId];
    if (!current) return { ok: false, code: 'invalid-seat', message: 'Seat is not valid.' };
    const next = { ...current, ...patch, ready: false };
    if (patch.nation !== undefined && !isLobbyNation(patch.nation)) {
      return { ok: false, code: 'invalid-nation', message: 'That nation is not available.' };
    }
    if (patch.color !== undefined && !isLobbyColor(patch.color)) {
      return { ok: false, code: 'invalid-colour', message: 'That colour is not in the palette.' };
    }
    if (patch.color !== undefined && this.config.seats[1 - seatId]?.color === patch.color) {
      return { ok: false, code: 'duplicate-colour', message: 'The other player already holds that colour.' };
    }
    const candidate: LobbyConfigV1 = {
      ...this.config,
      seats: this.config.seats.map((seat, index) => (index === seatId ? next : seat)),
    };
    const parsed = validateLobbyConfig(candidate);
    if (!parsed.ok) return { ok: false, code: parsed.problem.code, message: parsed.problem.message };
    this.config.seats[seatId] = { ...next };
    this.broadcast();
    this.onChanged?.();
    return { ok: true };
  }

  /**
   * Change the battlefield.
   *
   * Host only, and only to an id the scenario catalogue marks available for
   * multiplayer: the room never accepts a client-supplied scenario, just an
   * identifier it resolves itself. Both seats lose their ready state, because
   * the other player agreed to a different map.
   */
  setMapId(seatId: number, mapId: string): LobbyChangeResult {
    if (seatId !== this.hostSeatId) {
      return { ok: false, code: 'host-only', message: 'Only the host can change the battlefield.' };
    }
    if (!isPlayableMapId(mapId)) {
      return { ok: false, code: 'invalid-map', message: 'That battlefield is not available for multiplayer.' };
    }
    if (this.config.mapId === mapId) return { ok: true };
    const candidate: LobbyConfigV1 = {
      ...this.config,
      mapId,
      seats: this.config.seats.map((seat) => ({ ...seat, ready: false })),
    };
    const parsed = validateLobbyConfig(candidate);
    if (!parsed.ok) return { ok: false, code: parsed.problem.code, message: parsed.problem.message };
    this.config.mapId = parsed.config.mapId;
    this.config.seats = parsed.config.seats;
    this.broadcast();
    this.onChanged?.();
    return { ok: true };
  }

  /**
   * Change the match start hour. Host only, validated, and both seats lose
   * readiness because the other player agreed to a different battle.
   */
  setStartHour(seatId: number, startHour: number): LobbyChangeResult {
    if (seatId !== this.hostSeatId) {
      return { ok: false, code: 'host-only', message: 'Only the host can change the start time.' };
    }
    if (!Number.isFinite(startHour) || startHour < 0 || startHour >= 24) {
      return { ok: false, code: 'invalid-time', message: 'Start hour must be between 00:00 and 23:59.' };
    }
    if (this.config.startHour === startHour) return { ok: true };
    const candidate: LobbyConfigV1 = {
      ...this.config,
      startHour,
      seats: this.config.seats.map((seat) => ({ ...seat, ready: false })),
    };
    const parsed = validateLobbyConfig(candidate);
    if (!parsed.ok) return { ok: false, code: parsed.problem.code, message: parsed.problem.message };
    this.config.startHour = parsed.config.startHour;
    this.config.seats = parsed.config.seats;
    this.broadcast();
    this.onChanged?.();
    return { ok: true };
  }

  /**
   * Change the weather. Host only, and only to a kind the simulation defines:
   * the profile's numbers reach detection and mobility, so the room resolves it
   * from its own catalogue rather than trusting a client's description. Both
   * seats lose readiness, because the other player agreed to different ground.
   */
  setWeather(seatId: number, weather: string): LobbyChangeResult {
    if (seatId !== this.hostSeatId) {
      return { ok: false, code: 'host-only', message: 'Only the host can change the weather.' };
    }
    if (!isWeatherKind(weather)) {
      return { ok: false, code: 'invalid-weather', message: 'That weather is not a known profile.' };
    }
    if (this.config.weather === weather) return { ok: true };
    const candidate: LobbyConfigV1 = {
      ...this.config,
      weather,
      seats: this.config.seats.map((seat) => ({ ...seat, ready: false })),
    };
    const parsed = validateLobbyConfig(candidate);
    if (!parsed.ok) return { ok: false, code: parsed.problem.code, message: parsed.problem.message };
    this.config.weather = parsed.config.weather;
    this.config.seats = parsed.config.seats;
    this.broadcast();
    this.onChanged?.();
    return { ok: true };
  }

  /**
   * A lobby accepts only transport keepalive and readiness. A gameplay command
   * or a resync is rejected by name so a client cannot believe the match began.
   */
  receive(seatId: number, socket: RoomSocket, text: string, now = Date.now()): void {
    const seat = this.seats[seatId];
    if (!seat || seat.socket !== socket) return;
    if (typeof text !== 'string' || text.length > MAX_CLIENT_MESSAGE_BYTES) {
      this.sendError(seat, 'payload-too-large', 'Message is too large.');
      return;
    }
    if (seat.messageWindowStart === 0 || now - seat.messageWindowStart >= 1000) {
      seat.messageWindowStart = now;
      seat.messageCount = 0;
    }
    seat.messageCount++;
    if (seat.messageCount > MAX_CLIENT_MESSAGES_PER_SECOND) {
      this.sendError(seat, 'rate-limited', 'Too many messages.');
      return;
    }
    const parsed = parseClientMessage(text, MAX_CLIENT_MESSAGE_BYTES);
    if (!parsed.ok) {
      this.sendError(seat, parsed.code, parsed.message);
      return;
    }
    if (parsed.message.type === 'keepalive') {
      if (text.length > MAX_KEEPALIVE_MESSAGE_BYTES) {
        this.sendError(seat, 'payload-too-large', 'Keepalive is too large.');
        return;
      }
      if (seat.lastKeepaliveAt !== null && now - seat.lastKeepaliveAt < KEEPALIVE_MIN_INTERVAL_MS) {
        this.sendError(seat, 'keepalive-rate-limited', 'Keepalive is too frequent.');
        return;
      }
      seat.lastKeepaliveAt = now;
      const ack: KeepaliveAckMessage = { type: 'keepaliveAck', v: ROOM_PROTOCOL_VERSION };
      this.sendJson(seat, ack);
      return;
    }
    if (parsed.message.type === 'ready') {
      this.setReady(seatId, parsed.message.ready);
      return;
    }
    if (parsed.message.type === 'lobbySet') {
      // A map change is a host-only room action, not a seat configuration; a
      // client may not smuggle a scenario id through the seat patch.
      if (parsed.message.mapId !== undefined) {
        const mapResult = this.setMapId(seatId, parsed.message.mapId);
        if (!mapResult.ok) {
          this.sendError(seat, mapResult.code ?? 'invalid-map', mapResult.message ?? 'Map change rejected.');
        }
        return;
      }
      if (parsed.message.startHour !== undefined) {
        const timeResult = this.setStartHour(seatId, parsed.message.startHour);
        if (!timeResult.ok) {
          this.sendError(seat, timeResult.code ?? 'invalid-time', timeResult.message ?? 'Time change rejected.');
        }
        return;
      }
      if (parsed.message.weather !== undefined) {
        const weatherResult = this.setWeather(seatId, parsed.message.weather);
        if (!weatherResult.ok) {
          this.sendError(
            seat,
            weatherResult.code ?? 'invalid-weather',
            weatherResult.message ?? 'Weather change rejected.',
          );
        }
        return;
      }
      const result = this.setSeatConfig(seatId, {
        ...(parsed.message.nation === undefined ? {} : { nation: parsed.message.nation }),
        ...(parsed.message.color === undefined ? {} : { color: parsed.message.color }),
      });
      if (!result.ok) {
        this.sendError(seat, result.code ?? 'invalid-lobby', result.message ?? 'Lobby change rejected.');
      }
      return;
    }
    this.sendError(
      seat,
      'match-not-started',
      parsed.message.type === 'resync'
        ? 'There is nothing to resynchronise before the match starts.'
        : 'The match has not started yet.',
    );
  }

  /** The lobby state message for one recipient. */
  state(seatId: number): LobbyMessage {
    return {
      type: 'lobby',
      v: ROOM_PROTOCOL_VERSION,
      roomId: this.roomId,
      seat: seatId,
      phase: 'lobby',
      hostSeat: this.hostSeatId,
      matchDeadlineAt: this.hardDeadlineAt,
      config: {
        version: this.config.version,
        mapId: this.config.mapId,
        matchDurationMs: this.config.matchDurationMs,
        startHour: this.config.startHour,
        weather: this.config.weather,
        seats: this.config.seats.map((seat, index) => ({
          nation: seat.nation,
          color: seat.color,
          ready: seat.ready,
          host: index === this.hostSeatId,
          connected: this.seats[index]?.connected ?? false,
          // Presentable identity only: the account id stays server-side, so a
          // lobby cannot be used to enumerate accounts.
          identity: this.seats[index]?.identity ?? null,
          verified: Boolean(this.seats[index]?.accountId),
        })),
      },
    };
  }

  private helloFor(seatId: number): LobbyMessage {
    return this.state(seatId);
  }

  private broadcast(): void {
    for (const seat of this.seats) {
      if (seat.socket) this.sendJson(seat, this.state(seat.seatId));
    }
  }

  private sendJson(seat: LobbySeatState, message: unknown): boolean {
    if (!seat.socket) return false;
    try {
      seat.socket.send(JSON.stringify(message));
      return true;
    } catch {
      seat.socket = null;
      seat.connected = false;
      return false;
    }
  }

  private sendError(seat: LobbySeatState, code: string, message: string): void {
    this.sendJson(seat, { type: 'error', v: ROOM_PROTOCOL_VERSION, code, message });
  }
}
