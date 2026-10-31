/**
 * Browser lobby client: create, join, nation/colour, readiness and start.
 *
 * The client is the only thing between the menu deck and the room, so these
 * tests drive it the way the panel does and assert what actually goes on the
 * wire. Every authority decision is the room's; the client must never claim a
 * seat, a start or a configuration the room did not grant.
 */
import { LobbyClient, makeRoomCode, type LobbyView } from '../src/multiplayer/lobbyClient';
import { defaultLobbyConfig } from '../src/multiplayer/lobbyConfig';
import { PLAYABLE_NATION_IDS } from '../src/data/factions';
import { Game } from '../src/sim/game';
import { builtinScenario } from '../src/data/scenarios';
import { cloneScenario } from '../src/sim/scenario';
import { createTeamSnapshot } from '../src/multiplayer/projection';
import type { Command } from '../src/sim/types';
import { canStart, clampDuration, startHint } from '../src/ui/multiplayerPanel';
import type { LobbySeatView } from '../src/multiplayer/lobbyClient';

class FakeSocket {
  readyState = 1;
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  readonly listeners: Record<string, Array<(event: never) => void>> = {};
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.closed = { code, reason };
    this.emit('close', { code, reason } as never);
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener(event as never);
  }

  receive(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  messages(): Array<Record<string, unknown>> {
    return this.sent.map((entry) => JSON.parse(entry) as Record<string, unknown>);
  }
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
  authorization: string | null;
}

function lobbyMessage(overrides: {
  seat: number;
  seats: Array<Partial<LobbySeatView>>;
  mapId?: string;
  matchDurationMs?: number;
}): Record<string, unknown> {
  return {
    type: 'lobby',
    v: 2,
    roomId: 'kestrel',
    seat: overrides.seat,
    phase: 'lobby',
    hostSeat: 0,
    matchDeadlineAt: 0,
    config: {
      version: 1,
      mapId: overrides.mapId ?? 'island-assault',
      matchDurationMs: overrides.matchDurationMs ?? 600_000,
      seats: overrides.seats.map((seat, index) => ({
        nation: seat.nation ?? (index === 0 ? 'lithuania' : 'russia'),
        color: seat.color ?? (index === 0 ? '#3f8fd2' : '#c8503f'),
        ready: seat.ready ?? false,
        host: index === 0,
        connected: seat.connected ?? false,
      })),
    },
  };
}

function harness(): {
  client: LobbyClient;
  views: LobbyView[];
  calls: Call[];
  sockets: FakeSocket[];
  reply: (response: { status: number; body: Record<string, unknown> }) => void;
} {
  const calls: Call[] = [];
  const sockets: FakeSocket[] = [];
  let nextResponse: { status: number; body: Record<string, unknown> } = {
    status: 200,
    body: { ok: true },
  };
  const views: LobbyView[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      authorization: headers.get('Authorization'),
    });
    const reply = nextResponse;
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
    } as unknown as Response;
  }) as typeof fetch;

  const client = new LobbyClient({
    origin: 'https://rooms.example/',
    fetch: fakeFetch,
    createSocket: ((url: string, protocols: string[]) => {
      const socket = new FakeSocket(url, protocols);
      sockets.push(socket);
      return socket;
    }) as never,
    onChange: (view) => views.push(view),
  });

  return {
    client,
    views,
    calls,
    sockets,
    reply: (response) => {
      nextResponse = response;
    },
  };
}

describe('lobby client — hosting', () => {
  it('opens a room, keeps the seat token private and dials the room socket', async () => {
    const { client, calls, sockets, views } = harness();
    await client.createRoom(600_000, 'kestrel');

    expect(calls[0].url).toBe('https://rooms.example/api/multiplayer/rooms/kestrel/open');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toMatchObject({ roomId: 'kestrel', mode: '1v1', matchDurationMs: 600_000 });

    // A refused room never opens a socket.
    expect(sockets).toHaveLength(0);
    expect(views.at(-1)?.phase).toBe('failed');
  });

  it('becomes the host seat and renders the room state the room sent', async () => {
    const { client, reply, sockets, views } = harness();
    reply({ status: 200, body: { ok: true, seat: 0, token: 'tok-0', joinCode: 'ABCD2345' } });
    await client.createRoom(600_000, 'kestrel');

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe(
      'wss://rooms.example/api/multiplayer/rooms/kestrel/ws?seat=0',
    );
    expect(sockets[0].protocols).toEqual(['mca.v2', 'mca.token.tok-0']);
    // The token is transport state, never part of the view the panel renders.
    expect(JSON.stringify(views.at(-1))).not.toContain('tok-0');
    expect(views.at(-1)).toMatchObject({ phase: 'lobby', seat: 0, joinCode: 'ABCD2345' });
  });

  it('shows the refusal code and message instead of a seat', async () => {
    const { client, reply, views } = harness();
    reply({
      status: 503,
      body: { ok: false, code: 'capacity-exhausted', message: 'Both room slots are taken.' },
    });
    const ok = await client.createRoom(600_000, 'kestrel');

    expect(ok).toBe(false);
    expect(views.at(-1)).toMatchObject({
      phase: 'failed',
      error: { code: 'capacity-exhausted', message: 'Both room slots are taken.' },
    });
  });
});

describe('lobby client — joining', () => {
  it('normalises the codes and joins with the join code only', async () => {
    const { client, calls, reply, sockets } = harness();
    reply({ status: 200, body: { ok: true, seat: 1, token: 'tok-1' } });
    const ok = await client.joinRoom('  Kestrel  ', 'abcd2345');

    expect(ok).toBe(true);
    expect(calls[0].url).toBe('https://rooms.example/api/multiplayer/rooms/kestrel/join');
    expect(calls[0].body).toEqual({ code: 'ABCD2345' });
    expect(sockets[0].protocols[1]).toBe('mca.token.tok-1');
  });

  it('reports a wrong join code as an error, not a lobby', async () => {
    const { client, reply, views } = harness();
    reply({ status: 403, body: { ok: false, code: 'invalid-code', message: 'That join code is not valid.' } });
    expect(await client.joinRoom('kestrel', 'WRONG234')).toBe(false);
    expect(views.at(-1)?.phase).toBe('failed');
    expect(views.at(-1)?.error?.code).toBe('invalid-code');
  });
});

describe('lobby client — configuration', () => {
  async function lobbyClient(): Promise<{
    client: LobbyClient;
    socket: FakeSocket;
  }> {
    const harnessed = harness();
    harnessed.reply({ status: 200, body: { ok: true, seat: 1, token: 'tok-1' } });
    await harnessed.client.joinRoom('kestrel', 'ABCD2345');
    const socket = harnessed.sockets[0];
    socket.receive(
      lobbyMessage({
        seat: 1,
        seats: [{ connected: true }, { connected: true }],
      }),
    );
    // The join code is the host's secret; a guest is never shown it.
    expect(harnessed.views.at(-1)?.joinCode).toBeNull();
    return { client: harnessed.client, socket };
  }

  it('sends a nation change only when it differs from the room state', async () => {
    const { client, socket } = await lobbyClient();
    // The room seated this client as Russia, so choosing Russia is a no-op.
    client.setNation('russia');
    expect(socket.sent).toHaveLength(0);

    client.setNation('lithuania');
    expect(socket.messages().at(-1)).toEqual({ type: 'lobbySet', v: 2, nation: 'lithuania' });

    const before = socket.sent.length;
    client.setNation('lithuania');
    expect(socket.sent).toHaveLength(before);
  });

  it('sends colour changes and refuses to send once the match started', async () => {
    const { client, socket } = await lobbyClient();
    client.setColor('#4fae72');
    expect(socket.messages().at(-1)).toEqual({ type: 'lobbySet', v: 2, color: '#4fae72' });

    socket.receive(lobbyMessage({ seat: 1, seats: [{ connected: true }, { connected: true }] }));
    socket.receive({ type: 'hello', v: 2, roomId: 'kestrel', seat: 1, team: 1, phase: 'playing' });
    expect(client.state.phase).toBe('playing');

    const before = socket.sent.length;
    client.setNation('lithuania');
    expect(socket.sent).toHaveLength(before);
    expect(client.state.notice).toMatch(/already started/i);
  });

  it('surfaces a readiness rejection from the room', async () => {
    const { client, socket } = await lobbyClient();
    client.setReady(true);
    expect(socket.messages().at(-1)).toEqual({ type: 'ready', v: 2, ready: true });
    socket.receive({ type: 'error', v: 2, code: 'rate-limited', message: 'Too many messages.' });
    expect(client.state.noticeKind).toBe('error');
    expect(client.state.notice).toBe('Too many messages.');
  });
});

describe('lobby client — explicit start', () => {
  it('starts with the seat token and reports a refused start without pretending', async () => {
    const { client, calls, reply } = harness();
    reply({ status: 200, body: { ok: true, seat: 0, token: 'tok-0', joinCode: 'ABCD2345' } });
    await client.createRoom(600_000, 'kestrel');

    reply({ status: 200, body: { ok: true } });
    expect(await client.startMatch()).toBe(true);
    expect(calls.at(-1)?.url).toBe('https://rooms.example/api/multiplayer/rooms/kestrel/start');
    expect(calls.at(-1)?.authorization).toBe('Room tok-0');

    reply({
      status: 409,
      body: { ok: false, code: 'not-ready', message: 'Both players must be ready.' },
    });
    expect(await client.startMatch()).toBe(false);
    expect(client.state.phase).toBe('lobby');
    expect(client.state.noticeKind).toBe('error');
    expect(client.state.notice).toBe('Both players must be ready.');
  });

  it('cannot start without a seat of its own', async () => {
    const { client } = harness();
    expect(await client.startMatch()).toBe(false);
  });
});

describe('lobby client — leaving and liveness', () => {
  it('closes the socket and returns to an empty deck on leave', async () => {
    const { client, reply, sockets } = harness();
    reply({ status: 200, body: { ok: true, seat: 0, token: 'tok-0', joinCode: 'ABCD2345' } });
    await client.createRoom(600_000, 'kestrel');
    client.leave();
    expect(sockets[0].closed).toEqual({ code: 1000, reason: 'left-lobby' });
    expect(client.state).toMatchObject({ phase: 'idle', roomId: null, seat: null });
  });

  it('marks a closed socket as a closed lobby', async () => {
    const { client, reply, sockets } = harness();
    reply({ status: 200, body: { ok: true, seat: 0, token: 'tok-0', joinCode: 'ABCD2345' } });
    await client.createRoom(600_000, 'kestrel');
    sockets[0].close(1001, 'room-closed');
    expect(client.state.phase).toBe('closed');
    expect(client.state.socket).toBe('closed');
  });
});

describe('lobby client — the match stream', () => {
  async function inMatch(): Promise<{
    client: LobbyClient;
    socket: FakeSocket;
  }> {
    const harnessed = harness();
    harnessed.reply({ status: 200, body: { ok: true, seat: 1, token: 'tok-1' } });
    await harnessed.client.joinRoom('kestrel', 'ABCD2345');
    const socket = harnessed.sockets[0];
    socket.receive(lobbyMessage({ seat: 1, seats: [{ connected: true }, { connected: true }] }));
    socket.receive({ type: 'hello', v: 2, roomId: 'kestrel', seat: 1, team: 1, phase: 'playing' });
    return { client: harnessed.client, socket };
  }

  it('sends orders only once the room says the match started', async () => {
    const { client, socket } = await inMatch();
    const order: Command = { type: 'move', team: 1, ids: [7], x: 40, z: 40 };
    expect(client.sendCommand(order)).toBe(true);
    expect(socket.messages().at(-1)).toEqual({ type: 'command', v: 2, command: order });
    expect(client.commandStats).toEqual({ sent: 1, accepted: 0, rejected: 0 });
  });

  it('refuses an order in the lobby instead of queueing it', async () => {
    const harnessed = harness();
    harnessed.reply({ status: 200, body: { ok: true, seat: 0, token: 'tok-0', joinCode: 'ABCD2345' } });
    await harnessed.client.createRoom(600_000, 'kestrel');
    const before = harnessed.sockets[0].sent.length;
    expect(harnessed.client.sendCommand({ type: 'stop', team: 0, ids: [1] })).toBe(false);
    expect(harnessed.sockets[0].sent).toHaveLength(before);
    expect(harnessed.client.state.notice).toMatch(/has not started/i);
  });

  it('publishes the reconstructed world and counts room refusals', async () => {
    const { client, socket } = await inMatch();
    const seen: number[] = [];
    client.onSnapshot((snapshot) => seen.push(snapshot.tick));

    const map = builtinScenario('rust-valley').create();
    const truth = new Game(cloneScenario(map), { localPlayerId: 0, enableAI: false });
    truth.state.tick = 640;
    const snapshot = createTeamSnapshot(truth, 1);
    socket.receive({
      type: 'sync',
      v: 2,
      epoch: 1,
      seq: 1,
      tick: snapshot.tick,
      team: 1,
      roomId: 'kestrel',
      checkpoint: true,
      state: snapshot,
    });

    expect(seen).toEqual([640]);
    expect(client.snapshot?.tick).toBe(640);
    expect(client.snapshot?.team).toBe(1);

    socket.receive({ type: 'commandRejected', v: 2, code: 'not-your-unit', message: 'That unit is not yours.' });
    expect(client.commandStats.rejected).toBe(1);
    expect(client.state.noticeKind).toBe('error');
  });
});

describe('lobby client — the seat survives a real match', () => {
  async function inMatch(): Promise<{ client: LobbyClient; sockets: FakeSocket[] }> {
    const harnessed = harness();
    harnessed.reply({ status: 200, body: { ok: true, seat: 1, token: 'tok-1' } });
    await harnessed.client.joinRoom('kestrel', 'ABCD2345');
    const socket = harnessed.sockets[0];
    socket.emit('open', {});
    socket.receive({ type: 'hello', v: 2, roomId: 'kestrel', seat: 1, team: 1, phase: 'playing' });
    return { client: harnessed.client, sockets: harnessed.sockets };
  }

  it('keeps a live socket open by only trusting an unanswered keepalive', async () => {
    vi.useFakeTimers();
    try {
      const { client, sockets } = await inMatch();
      for (let round = 0; round < 4; round++) {
        vi.advanceTimersByTime(20_000);
        expect(sockets[0].messages().filter((m) => m.type === 'keepalive')).toHaveLength(round + 1);
        sockets[0].receive({ type: 'keepaliveAck', v: 2 });
      }
      expect(sockets[0].closed).toBeNull();
      expect(client.state).toMatchObject({ socket: 'open', phase: 'playing' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reopens the same seat after the socket drops mid-match', async () => {
    vi.useFakeTimers();
    try {
      const { client, sockets } = await inMatch();
      sockets[0].close(1006, 'network-gone');
      expect(client.state.notice).toMatch(/reconnecting/i);
      expect(client.state.phase).toBe('playing');

      vi.advanceTimersByTime(600);
      expect(sockets).toHaveLength(2);
      expect(sockets[1].url).toContain('seat=1');
      expect(sockets[1].protocols).toContain('mca.token.tok-1');

      sockets[1].emit('open', {});
      sockets[1].receive({ type: 'hello', v: 2, roomId: 'kestrel', seat: 1, team: 1, phase: 'playing' });
      expect(client.state).toMatchObject({ socket: 'open', phase: 'playing' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not kill a healthy socket from a throttled background tab', async () => {
    vi.useFakeTimers();
    const scope = globalThis as { document?: unknown };
    const previous = scope.document;
    scope.document = { visibilityState: 'hidden' };
    try {
      const { client, sockets } = await inMatch();
      // Two minutes of throttled timers with no ack: the room is still there and
      // the tab simply had no CPU, so the seat must not close itself.
      vi.advanceTimersByTime(120_000);
      expect(sockets[0].closed).toBeNull();
      expect(client.state.socket).toBe('open');

      // Back in the foreground, a keepalive that still goes unanswered is a
      // genuine dead link and the client reattaches instead of hanging.
      scope.document = { visibilityState: 'visible' };
      vi.advanceTimersByTime(60_000);
      vi.advanceTimersByTime(60_000);
      expect(sockets[0].closed?.code).toBe(4001);
      expect(client.state.notice).toMatch(/reconnecting/i);
    } finally {
      scope.document = previous;
      vi.useRealTimers();
    }
  });
});

describe('default lobby', () => {
  it('seats both players in nations the picker can actually show', () => {
    // Built-in maps declare alliance presets; a seat must not start on one,
    // because the nation field can only display real nations.
    for (const mapId of ['island-assault', 'rust-valley', 'kestrel-straits', 'foundry-district']) {
      const config = defaultLobbyConfig(mapId, 600_000);
      for (const seat of config.seats) {
        expect(PLAYABLE_NATION_IDS).toContain(seat.nation);
      }
      expect(config.seats[0].nation).not.toBe(config.seats[1].nation);
      expect(config.seats[0].color).not.toBe(config.seats[1].color);
      expect(config.seats.every((seat) => seat.ready === false)).toBe(true);
    }
  });
});

describe('start gating and codes', () => {
  const seat = (over: Partial<LobbySeatView>): LobbySeatView => ({
    nation: 'lithuania',
    color: '#3f8fd2',
    ready: false,
    host: false,
    connected: true,
    ...over,
  });

  const view = (over: Partial<LobbyView>): LobbyView =>
    ({
      phase: 'lobby',
      socket: 'open',
      roomId: 'kestrel',
      seat: 0,
      joinCode: 'ABCD2345',
      mapId: 'island-assault',
      matchDurationMs: 600_000,
      hostSeat: 0,
      seats: [seat({ host: true, ready: true }), seat({ ready: true })],
      ready: true,
      nation: 'lithuania',
      color: '#3f8fd2',
      isHost: true,
      match: null,
      notice: null,
      noticeKind: 'info',
      error: null,
      ...over,
    }) as LobbyView;

  it('enables start only for a host with two connected, ready players', () => {
    expect(canStart(view({}))).toBe(true);
    expect(canStart(view({ isHost: false }))).toBe(false);
    expect(canStart(view({ seats: [seat({ host: true, ready: true })] }))).toBe(false);
    expect(canStart(view({ seats: [seat({ host: true, ready: true }), seat({ ready: false })] }))).toBe(false);
    expect(
      canStart(view({ seats: [seat({ host: true, ready: true }), seat({ ready: true, connected: false })] })),
    ).toBe(false);
    expect(startHint(view({ seats: [seat({ host: true, ready: true }), seat({ ready: false })] }))).toMatch(
      /must be ready/i,
    );
    expect(startHint(view({ isHost: false }))).toMatch(/host/i);
  });

  it('clamps a duration into the supported window', () => {
    expect(clampDuration(600_000)).toBe(600_000);
    expect(clampDuration(1_000)).toBe(60_000);
    expect(clampDuration(60 * 60_000)).toBe(30 * 60_000);
    expect(clampDuration(Number.NaN)).toBe(600_000);
  });

  it('makes room codes that are short, readable and unambiguous', () => {
    const code = makeRoomCode(() => 0.5);
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
  });
});
