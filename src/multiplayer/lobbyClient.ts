/**
 * Browser lobby client.
 *
 * Owns exactly one seat of one room: it creates or joins a room over HTTP,
 * holds the lobby socket, expresses readiness and nation/colour choices, and
 * asks the room to start. It never decides anything authoritative: the lobby
 * state it renders is the room's own message, and the match state it exposes
 * comes from the shared `SnapshotAssembler` applied to the server's sync/delta
 * stream.
 *
 * No DOM: the panel in `src/ui/multiplayerPanel.ts` renders this object's view
 * and calls its methods, which keeps the whole handshake testable without a
 * browser.
 */
import { SnapshotAssembler } from './snapshotAssembler';
import type { TeamSnapshot } from './projection';

export const LOBBY_PROTOCOL_VERSION = 2;
const KEEPALIVE_MS = 20_000;

/**
 * A hidden tab throttles timers, so its clock cannot prove a socket is dead.
 * Anything driving a connection check must consult this rather than assume the
 * page is running on time.
 */
function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

import { parseFlagComposition, type FlagComposition } from '../identity/flag';

export type LobbyPhase = 'idle' | 'creating' | 'joining' | 'lobby' | 'playing' | 'closed' | 'failed';
export type SocketPhase = 'idle' | 'connecting' | 'open' | 'closed';

export interface LobbyIdentityView {
  callsign: string;
  avatar: string;
  /** Career rank id carried by the signed ticket, when present. */
  rank?: string;
  /** Equipped command flag carried by the signed ticket, if any. */
  flag?: FlagComposition;
  /** Equipped profile frame catalogue id. */
  frame?: string;
  /** Equipped profile background catalogue id. */
  background?: string;
}

export interface LobbySeatView {
  nation: string;
  color: string;
  ready: boolean;
  host: boolean;
  connected: boolean;
  /**
   * Presentable identity the room was given at seat claim or before start;
   * null for a guest. Optional fields keep older tickets readable.
   */
  identity?: LobbyIdentityView | null;
  /** True when the seat presents a verified account. */
  verified?: boolean;
}

/** One seat's immutable match-start identity, as delivered by the room. */
export interface LobbySeatIdentityView {
  seatId: number;
  identity: LobbyIdentityView | null;
}

export interface LobbyMatchView {
  tick: number;
  mats: number;
  req: number;
  units: number;
  visibleEnemies: number;
  ownStructureCount: number;
  phase: 'playing' | 'finished';
  startedAtMs: number | null;
  deadlineAt: number | null;
}

export interface LobbyView {
  phase: LobbyPhase;
  socket: SocketPhase;
  roomId: string | null;
  seat: number | null;
  joinCode: string | null;
  mapId: string | null;
  /** Authoritative start hour both seats will fight at, 0..24. */
  startHour: number;
  /** Authoritative weather kind both seats will fight in. */
  weather: string;
  matchDurationMs: number;
  hostSeat: number;
  seats: LobbySeatView[];
  /** Frozen identities for the running match; empty before the start message. */
  matchIdentities: LobbySeatIdentityView[];
  ready: boolean;
  nation: string | null;
  color: string | null;
  isHost: boolean;
  match: LobbyMatchView | null;
  /**
   * The authoritative result once the room announces it. `matchId` is the
   * reference the account service uses to answer "what did this match pay?",
   * so the end screen reads the award instead of submitting one.
   */
  matchResult: { outcome: 'victory' | 'defeat' | 'draw'; matchId: string | null } | null;
  /** Most recent rejection or informational line, for the panel footer. */
  notice: string | null;
  noticeKind: 'info' | 'error';
  error: { code: string; message: string } | null;
}

export interface LobbyTransport {
  /** Absolute worker origin, no trailing slash. */
  origin: string;
  fetch: typeof fetch;
  createSocket: (url: string, protocols: string[]) => LobbySocket;
}

export interface LobbySocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { code: number; reason: string }) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
}

const SOCKET_OPEN = 1;

function emptyView(): LobbyView {
  return {
    phase: 'idle',
    socket: 'idle',
    roomId: null,
    seat: null,
    joinCode: null,
    mapId: null,
    startHour: 18,
    weather: 'clear',
    matchDurationMs: 0,
    hostSeat: 0,
    seats: [],
    matchIdentities: [],
    ready: false,
    nation: null,
    color: null,
    isHost: false,
    match: null,
    matchResult: null,
    notice: null,
    noticeKind: 'info',
    error: null,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Identity as the room reported it. Shape check only; the room verified it. */
function seatIdentity(value: unknown): LobbyIdentityView | null {
  if (!record(value)) return null;
  const callsign = typeof value.callsign === 'string' ? value.callsign.trim() : '';
  if (!callsign) return null;
  const rank = typeof value.rank === 'string' && /^[a-z-]{2,24}$/.test(value.rank) ? value.rank : undefined;
  const flag = parseFlagComposition(value.flag);
  const frame =
    typeof value.frame === 'string' && /^frame-[a-z-]{2,24}$/.test(value.frame)
      ? value.frame
      : undefined;
  const background =
    typeof value.background === 'string' && /^bg-[a-z-]{2,24}$/.test(value.background)
      ? value.background
      : undefined;
  return {
    callsign: callsign.slice(0, 32),
    avatar: typeof value.avatar === 'string' ? value.avatar.slice(0, 16) : 'insignia',
    ...(rank ? { rank } : {}),
    // Parsed, never trusted: a flag this build cannot render is simply absent.
    ...(flag.ok ? { flag: flag.composition } : {}),
    ...(frame ? { frame } : {}),
    ...(background ? { background } : {}),
  };
}

/** Parse the immutable match identity table, ignoring malformed entries. */
function matchIdentities(value: unknown): LobbySeatIdentityView[] {
  if (!Array.isArray(value)) return [];
  const result: LobbySeatIdentityView[] = [];
  const seen = new Set<number>();
  for (const entry of value) {
    if (!record(entry)) continue;
    const seatId = entry.seatId;
    if (typeof seatId !== 'number' || !Number.isInteger(seatId) || seatId < 0 || seatId > 1) continue;
    if (seen.has(seatId)) continue;
    seen.add(seatId);
    result.push({ seatId, identity: seatIdentity(entry.identity) });
  }
  return result.sort((a, b) => a.seatId - b.seatId);
}

/** A room id a human can read out: no ambiguous characters, no separators. */
export function makeRoomCode(random: () => number = Math.random): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let index = 0; index < 8; index++) {
    code += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  }
  return code;
}

export class LobbyClient {
  private readonly transport: LobbyTransport;
  private readonly notify: (view: LobbyView) => void;
  private view: LobbyView = emptyView();
  private token: string | null = null;
  /**
   * The last nation/colour already asked for, so a second click on the same
   * value does not repeat the intent before the room has echoed it. It is
   * cleared by any room reply, so a rejected change can be retried.
   */
  private sentNation: string | null = null;
  private sentColor: string | null = null;
  private sentMapId: string | null = null;
  private sentStartHour: number | null = null;
  private sentWeather: string | null = null;
  private socket: LobbySocket | null = null;
  private assembler: SnapshotAssembler | null = null;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  /**
   * When the keepalive still awaiting its acknowledgement was sent. A live room
   * answers in milliseconds, so one unanswered keepalive is the only evidence
   * of a half-open socket we trust — never "no ack since the socket opened".
   */
  private awaitingAckAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private leaving = false;
  /** Latest reconstructed team view, or null before the match stream starts. */
  private snapshotValue: TeamSnapshot | null = null;
  private snapshotListener: ((snapshot: TeamSnapshot) => void) | null = null;
  private commandsSent = 0;
  private commandsAccepted = 0;
  private commandsRejected = 0;
  /**
   * Supplies a short-lived, server-signed identity ticket for opening or
   * joining a room. Optional: without it the seat is a guest, exactly as
   * before accounts existed. The ticket is fetched per action rather than
   * cached, because it expires in two minutes.
   */
  private readonly identityTicket: (() => Promise<string | null>) | null;

  constructor(options: {
    origin: string;
    onChange: (view: LobbyView) => void;
    fetch?: typeof fetch;
    createSocket?: (url: string, protocols: string[]) => LobbySocket;
    identityTicket?: () => Promise<string | null>;
  }) {
    this.identityTicket = options.identityTicket ?? null;
    this.transport = {
      origin: options.origin.replace(/\/+$/, ''),
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
      createSocket:
        options.createSocket ??
        ((url, protocols) =>
          new WebSocket(url, protocols) as unknown as LobbySocket),
    };
    this.notify = options.onChange;
  }

  get state(): LobbyView {
    return this.view;
  }

  /** The reconstructed team view the battlefield draws, or null before start. */
  get snapshot(): TeamSnapshot | null {
    return this.snapshotValue;
  }

  get commandStats(): { sent: number; accepted: number; rejected: number } {
    return {
      sent: this.commandsSent,
      accepted: this.commandsAccepted,
      rejected: this.commandsRejected,
    };
  }

  /**
   * Hand the match stream to the battle view. The listener is called for every
   * accepted sync or delta, which is also the only place the client learns the
   * authoritative tick.
   */
  onSnapshot(listener: ((snapshot: TeamSnapshot) => void) | null): void {
    this.snapshotListener = listener;
    if (listener && this.snapshotValue) listener(this.snapshotValue);
  }

  /**
   * Send one command to the room. Authority, ownership and rate are the room's
   * call: this only refuses when there is no match to command.
   */
  sendCommand(command: Record<string, unknown>): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) {
      this.note('Not connected to the match.', 'error');
      return false;
    }
    if (this.view.phase !== 'playing') {
      this.note('The match has not started.', 'error');
      return false;
    }
    socket.send(JSON.stringify({ type: 'command', v: LOBBY_PROTOCOL_VERSION, command }));
    this.commandsSent++;
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* HTTP surface                                                      */
  /* ---------------------------------------------------------------- */

  async createRoom(matchDurationMs: number, roomCode = makeRoomCode()): Promise<boolean> {
    this.view = { ...emptyView(), phase: 'creating', roomId: roomCode };
    this.emit();
    const response = await this.post(`/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/open`, {
      body: { roomId: roomCode, mode: '1v1', matchDurationMs },
    });
    if (!response.ok) return this.fail(response.status, response.body);
    const seat = typeof response.body.seat === 'number' ? response.body.seat : null;
    const token = typeof response.body.token === 'string' ? response.body.token : null;
    const joinCode = typeof response.body.joinCode === 'string' ? response.body.joinCode : null;
    if (seat === null || !token) {
      return this.fail(500, { code: 'invalid-response', message: 'The room did not return a seat.' });
    }
    this.view = {
      ...this.view,
      phase: 'lobby',
      roomId: roomCode,
      seat,
      joinCode,
      // The room's own message carries the authoritative duration; this keeps
      // the first frame from reading "Lobby —" before it arrives.
      matchDurationMs,
      matchIdentities: [],
    };
    // The seat token lives only here, never in the rendered view.
    this.token = token;
    this.openSocket();
    return true;
  }

  async joinRoom(roomId: string, code: string): Promise<boolean> {
    const cleanRoom = roomId.trim().toLowerCase();
    const cleanCode = code.trim().toUpperCase();
    this.view = { ...emptyView(), phase: 'joining', roomId: cleanRoom };
    this.emit();
    const response = await this.post(`/api/multiplayer/rooms/${encodeURIComponent(cleanRoom)}/join`, {
      body: { code: cleanCode },
    });
    if (!response.ok) return this.fail(response.status, response.body);
    const seat = typeof response.body.seat === 'number' ? response.body.seat : null;
    const token = typeof response.body.token === 'string' ? response.body.token : null;
    if (seat === null || !token) {
      return this.fail(500, { code: 'invalid-response', message: 'The room did not return a seat.' });
    }
    this.view = { ...this.view, phase: 'lobby', roomId: cleanRoom, seat, joinCode: null, matchIdentities: [] };
    this.token = token;
    this.openSocket();
    return true;
  }

  /** Host-only. The room re-validates every precondition and answers 409/403. */
  async startMatch(): Promise<boolean> {
    if (!this.token || !this.view.roomId) return false;
    // Capture the latest verified cosmetics before the immutable match
    // snapshot is taken. A guest or an expired session simply keeps what the
    // room already has; the start itself remains the host's decision.
    await this.refreshIdentity();
    const response = await this.post(
      `/api/multiplayer/rooms/${encodeURIComponent(this.view.roomId)}/start`,
      { body: {}, roomToken: this.token },
    );
    if (!response.ok) {
      this.note(String(response.body.message ?? 'The match could not start.'), 'error');
      return false;
    }
    if (response.body.alreadyStarted !== true) this.note('Starting the match…', 'info');
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Lobby intents                                                     */
  /* ---------------------------------------------------------------- */

  setNation(nation: string): void {
    if (nation === this.view.nation || nation === this.sentNation) return;
    if (this.sendLobbySet({ nation })) this.sentNation = nation;
  }

  setColor(color: string): void {
    if (color === this.view.color || color === this.sentColor) return;
    if (this.sendLobbySet({ color })) this.sentColor = color;
  }

  /**
   * Ask the room for a different battlefield. The room decides whether this
   * seat may ask (host only) and whether the map exists (catalogue), so a
   * refusal arrives as the room's own error instead of a silent no-op.
   */
  setMap(mapId: string): void {
    if (mapId === this.view.mapId || mapId === this.sentMapId) return;
    if (this.sendLobbySet({ mapId })) this.sentMapId = mapId;
  }

  setStartHour(startHour: number): void {
    if (startHour === this.view.startHour || startHour === this.sentStartHour) return;
    if (this.sendLobbySet({ startHour })) this.sentStartHour = startHour;
  }

  /** Ask the room for different weather; the room decides whether this seat may. */
  setWeather(weather: string): void {
    if (weather === this.view.weather || weather === this.sentWeather) return;
    if (this.sendLobbySet({ weather })) this.sentWeather = weather;
  }

  setReady(ready: boolean): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) {
      this.note('Not connected to the room.', 'error');
      return;
    }
    if (ready) void this.refreshIdentity();
    socket.send(JSON.stringify({ type: 'ready', v: LOBBY_PROTOCOL_VERSION, ready }));
  }

  /**
   * Ask the room to re-read this seat's signed identity. This is deliberately
   * a token-authorised HTTP action, not a socket message: a client can never
   * place callsign, rank or cosmetics into the room protocol directly.
   */
  async refreshIdentity(): Promise<boolean> {
    if (!this.identityTicket || !this.token || !this.view.roomId) return false;
    if (this.view.phase !== 'lobby') return false;
    const response = await this.post(
      `/api/multiplayer/rooms/${encodeURIComponent(this.view.roomId)}/identity`,
      { body: {}, roomToken: this.token },
    );
    return response.ok;
  }

  leave(): void {
    this.leaving = true;
    this.snapshotListener = null;
    this.snapshotValue = null;
    this.stopKeepalive();
    try {
      this.socket?.close(1000, 'left-lobby');
    } catch {
      /* already closed */
    }
    this.socket = null;
    this.assembler = null;
    this.token = null;
    this.view = emptyView();
    this.emit();
    this.leaving = false;
  }

  private sendLobbySet(patch: {
    nation?: string;
    color?: string;
    mapId?: string;
    startHour?: number;
    weather?: string;
  }): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) {
      this.note('Not connected to the room.', 'error');
      return false;
    }
    if (this.view.phase !== 'lobby') {
      this.note('The match has already started.', 'error');
      return false;
    }
    socket.send(JSON.stringify({ type: 'lobbySet', v: LOBBY_PROTOCOL_VERSION, ...patch }));
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Socket                                                            */
  /* ---------------------------------------------------------------- */

  private openSocket(): void {
    if (!this.token || !this.view.roomId || this.view.seat === null) return;
    const origin = this.transport.origin;
    const wsOrigin = origin.replace(/^http/, 'ws');
    const url = `${wsOrigin}/api/multiplayer/rooms/${encodeURIComponent(this.view.roomId)}/ws?seat=${this.view.seat}`;
    this.view = { ...this.view, socket: 'connecting' };
    this.emit();
    const socket = this.transport.createSocket(url, [
      `mca.v${LOBBY_PROTOCOL_VERSION}`,
      `mca.token.${this.token}`,
    ]);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.view = { ...this.view, socket: 'open' };
      this.awaitingAckAt = null;
      this.reconnectAttempts = 0;
      this.startKeepalive();
      this.emit();
      // Reconnecting before start is also a chance to refresh identity from
      // the account service. During a match the snapshot is immutable, so the
      // method refuses at that point.
      if (this.view.phase === 'lobby') void this.refreshIdentity();
    });
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (record(message)) this.handleMessage(message);
    });
    socket.addEventListener('close', (event) => {
      this.stopKeepalive();
      if (this.socket === socket) this.socket = null;
      if (this.leaving) return;
      if (this.view.phase === 'playing' && this.scheduleReconnect()) {
        this.view = {
          ...this.view,
          socket: 'closed',
          notice: `Lost the room connection (${event.code}). Reconnecting…`,
          noticeKind: 'error',
        };
        this.emit();
        return;
      }
      this.view = {
        ...this.view,
        socket: 'closed',
        ...(this.view.phase === 'playing' ? {} : { phase: 'closed' as LobbyPhase }),
        notice:
          this.view.phase === 'playing'
            ? `Disconnected from the match (${event.code}). Rejoin the room to reconnect.`
            : 'The room connection closed.',
        noticeKind: 'error',
      };
      this.emit();
    });
    socket.addEventListener('error', () => {
      if (this.view.socket === 'connecting') {
        this.note('Could not open the room socket. Is the multiplayer worker reachable?', 'error');
      }
    });
  }

  private handleMessage(message: Record<string, unknown>): void {
    const type = message.type;
    if (type === 'lobby') {
      this.applyLobbyMessage(message);
      return;
    }
    if (type === 'hello') {
      const started = type === 'hello' && message.phase === 'playing';
      const frozenIdentities = matchIdentities(message.identities);
      const seats =
        frozenIdentities.length > 0
          ? this.view.seats.map((seat, index) => {
              const frozen = frozenIdentities.find((entry) => entry.seatId === index);
              return frozen
                ? { ...seat, identity: frozen.identity, verified: frozen.identity !== null }
                : seat;
            })
          : this.view.seats;
      this.assembler = new SnapshotAssembler({
        roomId: String(message.roomId ?? this.view.roomId ?? ''),
        team: typeof message.team === 'number' ? message.team : (this.view.seat ?? 0),
      });
      this.view = {
        ...this.view,
        phase: started ? 'playing' : 'lobby',
        seat: typeof message.seat === 'number' ? message.seat : this.view.seat,
        seats,
        ...(frozenIdentities.length > 0 ? { matchIdentities: frozenIdentities } : {}),
        match: started
          ? {
              tick: 0,
              mats: 0,
              req: 0,
              units: 0,
              visibleEnemies: 0,
              ownStructureCount: 0,
              phase: 'playing',
              startedAtMs: null,
              deadlineAt:
                typeof message.matchDeadlineAt === 'number' ? message.matchDeadlineAt : null,
            }
          : null,
      };
      if (started) this.note('Match started. The room is now authoritative.', 'info');
      this.emit();
      return;
    }
    if (type === 'sync' || type === 'delta') {
      const assembler = this.assembler;
      if (!assembler) return;
      const applied = assembler.apply(message);
      if (!applied.ok) {
        // Any gap is answered with a full resync, never a guess.
        if (this.socket?.readyState === SOCKET_OPEN) {
          this.socket.send(JSON.stringify({ type: 'resync', v: LOBBY_PROTOCOL_VERSION }));
        }
        this.note(`Resynchronising (${applied.reason}).`, 'info');
        return;
      }
      this.applySnapshot(assembler.state());
      return;
    }
    if (type === 'keepaliveAck') {
      this.awaitingAckAt = null;
      return;
    }
    if (type === 'commandAccepted') {
      // Acceptance only means the gate took the order; the next authoritative
      // update is the proof that it had an effect.
      this.commandsAccepted++;
      return;
    }
    if (type === 'commandRejected') {
      this.commandsRejected++;
      this.note(String(message.message ?? 'The room refused that order.'), 'error');
      return;
    }
    if (type === 'result') {
      const outcome = message.outcome;
      const frozenIdentities = matchIdentities(message.identities);
      this.view = {
        ...this.view,
        ...(frozenIdentities.length > 0 ? { matchIdentities: frozenIdentities } : {}),
        matchResult: {
          outcome: outcome === 'victory' || outcome === 'defeat' || outcome === 'draw' ? outcome : 'draw',
          matchId: typeof message.matchId === 'string' && message.matchId.length > 0 ? message.matchId : null,
        },
      };
      this.note(`Match finished: ${String(message.outcome ?? 'result')}.`, 'info');
      this.emit();
      return;
    }
    if (type === 'roomClosed') {
      this.view = { ...this.view, phase: 'closed', notice: 'The room closed.', noticeKind: 'info' };
      this.emit();
      return;
    }
    if (type === 'error') {
      // A rejected change must be retryable, so drop the pending intent.
      this.sentNation = null;
      this.sentColor = null;
      this.sentMapId = null;
      this.sentStartHour = null;
      this.sentWeather = null;
      this.note(String(message.message ?? 'The room rejected that.'), 'error');
    }
  }

  private applyLobbyMessage(message: Record<string, unknown>): void {
    this.sentNation = null;
    this.sentColor = null;
    this.sentMapId = null;
    this.sentStartHour = null;
    this.sentWeather = null;
    const config = record(message.config) ? message.config : null;
    const seatsRaw = config && Array.isArray(config.seats) ? config.seats : [];
    const seats: LobbySeatView[] = seatsRaw.filter(record).map((seat) => ({
      nation: String(seat.nation ?? ''),
      color: String(seat.color ?? ''),
      ready: seat.ready === true,
      host: seat.host === true,
      connected: seat.connected === true,
      identity: seatIdentity(seat.identity),
      verified: seat.verified === true,
    }));
    const seat = typeof message.seat === 'number' ? message.seat : (this.view.seat ?? 0);
    const mine = seats[seat];
    this.view = {
      ...this.view,
      phase: this.view.phase === 'playing' ? 'playing' : 'lobby',
      seat,
      hostSeat: typeof message.hostSeat === 'number' ? message.hostSeat : 0,
      mapId: config && typeof config.mapId === 'string' ? config.mapId : null,
      startHour:
        config && typeof config.startHour === 'number' ? config.startHour : this.view.startHour,
      weather:
        config && typeof config.weather === 'string' ? config.weather : this.view.weather,
      matchDurationMs:
        config && typeof config.matchDurationMs === 'number'
          ? config.matchDurationMs
          : this.view.matchDurationMs,
      seats,
      ready: mine?.ready ?? false,
      nation: mine?.nation ?? null,
      color: mine?.color ?? null,
      isHost: seat === (typeof message.hostSeat === 'number' ? message.hostSeat : 0),
    };
    this.emit();
  }

  private applySnapshot(state: TeamSnapshot | null): void {
    if (!state) return;
    this.snapshotValue = state;
    this.snapshotListener?.(state);
    const team = state.team;
    const player = state.players.find((entry) => entry.team === team);
    const own = state.entities.filter((entity) => entity.team === team);
    const match: LobbyMatchView = {
      tick: state.tick,
      mats: player?.mats ?? 0,
      req: player?.req ?? 0,
      units: own.filter((entity) => entity.kind === 'unit').length,
      ownStructureCount: own.filter((entity) => entity.kind === 'building').length,
      visibleEnemies: state.entities.filter((entity) => entity.team !== team).length,
      phase: state.result?.phase === 'finished' ? 'finished' : 'playing',
      startedAtMs: this.view.match?.startedAtMs ?? null,
      deadlineAt: this.view.match?.deadlineAt ?? null,
    };
    this.view = { ...this.view, phase: 'playing', match };
    this.emit();
  }

  /* ---------------------------------------------------------------- */
  /* Plumbing                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Keep the seat alive without ever closing a healthy socket.
   *
   * A background tab has its timers throttled to roughly one tick a minute, so
   * a watchdog that measures *time since the last ack* fires on a live match and
   * strands the seat in a frozen battle. Instead, only a keepalive that the
   * room failed to answer for a full interval counts as a dead link, and the
   * check is skipped while the tab is hidden, where the interval itself is
   * unreliable. The room still drops sockets that really are gone.
   */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepalive = setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.readyState !== SOCKET_OPEN) return;
      const now = Date.now();
      if (documentHidden()) {
        // Nothing observed while hidden can be timed, so judge nothing: the
        // next foreground tick starts a fresh window.
        this.awaitingAckAt = null;
        socket.send(JSON.stringify({ type: 'keepalive', v: LOBBY_PROTOCOL_VERSION }));
        return;
      }
      const unanswered =
        this.awaitingAckAt !== null && now - this.awaitingAckAt > KEEPALIVE_MS;
      if (unanswered) {
        this.note('The room stopped acknowledging. Reconnecting…', 'error');
        this.stopKeepalive();
        try {
          socket.close(4001, 'keepalive-timeout');
        } catch {
          /* already closed */
        }
        return;
      }
      // Keep the send time of a keepalive that is still outstanding, so a
      // repeating timer cannot keep resetting the deadline it is checking.
      if (this.awaitingAckAt === null) this.awaitingAckAt = now;
      socket.send(JSON.stringify({ type: 'keepalive', v: LOBBY_PROTOCOL_VERSION }));
    }, KEEPALIVE_MS);
  }

  /**
   * Re-open the same seat after a dropped socket. The room authenticates the
   * seat by token and answers a reconnect with a fresh hello and full sync, so
   * this restores authority rather than guessing at what was missed.
   */
  private scheduleReconnect(): boolean {
    if (!this.token || !this.view.roomId || this.view.seat === null) return false;
    if (this.reconnectTimer !== null) return true;
    if (this.reconnectAttempts >= 6) return false;
    const delay = Math.min(8_000, 500 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.leaving || this.socket) return;
      this.openSocket();
    }, delay);
    return true;
  }

  private stopKeepalive(): void {
    if (this.keepalive !== null) clearInterval(this.keepalive);
    this.keepalive = null;
  }

  private async post(
    path: string,
    options: { body: unknown; roomToken?: string },
  ): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
    // Seat-establishing and pre-start refresh routes carry identity. Every
    // other action is authorised by the seat token and needs no ticket.
    const wantsIdentity = /\/(open|join|identity)$/.test(path);
    let ticket: string | null = null;
    if (wantsIdentity && this.identityTicket) {
      try {
        ticket = await this.identityTicket();
      } catch {
        ticket = null;
      }
    }
    try {
      const response = await this.transport.fetch(`${this.transport.origin}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ticket ? { 'X-MCA-Identity-Ticket': ticket } : {}),
          ...(options.roomToken ? { Authorization: `Room ${options.roomToken}` } : {}),
        },
        body: JSON.stringify(options.body),
      });
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = await response.json();
        if (record(parsed)) body = parsed;
      } catch {
        body = { code: 'invalid-response', message: 'The room sent an unreadable reply.' };
      }
      return { ok: response.ok && body.ok !== false, status: response.status, body };
    } catch {
      return {
        ok: false,
        status: 0,
        body: {
          code: 'room-unreachable',
          message: 'The multiplayer service could not be reached.',
        },
      };
    }
  }

  private fail(status: number, body: Record<string, unknown>): false {
    this.view = {
      ...this.view,
      phase: 'failed',
      error: {
        code: String(body.code ?? `http-${status}`),
        message: String(body.message ?? 'The room refused that request.'),
      },
    };
    this.emit();
    return false;
  }

  private note(message: string, kind: 'info' | 'error'): void {
    this.view = { ...this.view, notice: message, noticeKind: kind };
    this.emit();
  }

  private emit(): void {
    this.notify(this.view);
  }
}
