import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { RoomMatch, type RoomSeatDefinition, type RoomSocket } from '../src/multiplayer/roomMatch';
import {
  buildLobbyScenario,
  defaultLobbyConfig,
  defaultOutbreakLobbyConfig,
  validateLobbyConfig,
} from '../src/multiplayer/lobbyConfig';
import { OUTBREAK_MAP_ID } from '../src/outbreak/scenario';
import { INFECTED_FACTION_ID } from '../src/data/zombies';
import { resultForTeam } from '../src/multiplayer/matchResult';
import { createTeamSnapshot, createTeamState } from '../src/multiplayer/projection';
import { buildDelta, createBaseline } from '../src/multiplayer/teamDelta';
import { SnapshotAssembler } from '../src/multiplayer/snapshotAssembler';
import { defaultLobbyConfig as lobbyConfigFor } from '../src/multiplayer/lobbyConfig';

class FakeSocket implements RoomSocket {
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  bufferedAmount = 0;
  send(data: string): void {
    this.sent.push(data);
  }
  close(code = 1000, reason = ''): void {
    this.closed = { code, reason };
  }
  messages(): Array<Record<string, unknown>> {
    return this.sent.map((text) => JSON.parse(text) as Record<string, unknown>);
  }
}

function coopSeats(): RoomSeatDefinition[] {
  return [
    { seatId: 0, playerId: 0, team: 0, token: 'coop-seat-zero-token-00000000' },
    { seatId: 1, playerId: 0, team: 0, token: 'coop-seat-one-token-000000000' },
  ];
}

function coopGame(): Game {
  const config = defaultOutbreakLobbyConfig(600_000, 'normal');
  const scenario = buildLobbyScenario(config);
  return new Game(scenario, { localPlayerId: -1, enableAI: false });
}

function makeRoom(seats: RoomSeatDefinition[] = coopSeats()): RoomMatch {
  return new RoomMatch({
    roomId: 'coop-room',
    mode: 'outbreak',
    seats,
    matchDurationMs: 600_000,
    matchDeadlineAt: 10_000_000,
    now: 1_000,
    game: coopGame(),
    promoteOnConnect: true,
  });
}

function command(body: Record<string, unknown>): string {
  return JSON.stringify({ type: 'command', v: 2, command: body });
}

function connectBoth(room: RoomMatch): { zero: FakeSocket; one: FakeSocket } {
  const zero = new FakeSocket();
  const one = new FakeSocket();
  const first = room.connect(0, coopSeats()[0].token, zero, 1_000);
  const second = room.connect(1, coopSeats()[1].token, one, 1_000);
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
  return { zero, one };
}

describe('Outbreak co-op rooms', () => {
  it('opens a lobby pinned to the basin with the host difficulty', () => {
    const config = defaultOutbreakLobbyConfig(600_000, 'hard');
    const parsed = validateLobbyConfig(config);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.mapId).toBe(OUTBREAK_MAP_ID);
    expect(parsed.config.outbreak).toEqual({ difficulty: 'hard' });
    // The deck's own default opens a co-op room, not a skirmish map.
    expect(defaultLobbyConfig(undefined, undefined, 'outbreak').outbreak).toEqual({
      difficulty: 'normal',
    });
    // An Outbreak lobby cannot be pointed at a skirmish theatre, and a room
    // cannot smuggle in a difficulty the horde does not know.
    expect(validateLobbyConfig({ ...config }).ok).toBe(true);
    expect(validateLobbyConfig({ ...config, mapId: 'open-front' })).toMatchObject({
      ok: false,
      problem: { code: 'invalid-map' },
    });
    expect(
      validateLobbyConfig({ ...config, outbreak: { difficulty: 'impossible' } }),
    ).toMatchObject({ ok: false, problem: { code: 'invalid-outbreak' } });
  });

  it('builds the same basin for both seats with the horde as the only opponent', () => {
    const config = defaultOutbreakLobbyConfig(600_000, 'nightmare');
    const parsed = validateLobbyConfig(config);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const scenario = buildLobbyScenario(parsed.config);
    expect(scenario.meta.outbreak).toMatchObject({ mode: 'coop', difficulty: 'nightmare' });
    expect(scenario.settings.timeLimitSec).toBeNull();
    // Seat 0 configures the army; seat 1 commands that same army, so the second
    // player is the infected and is never overwritten by the guest's nation.
    expect(scenario.players.map((player) => player.id)).toEqual([0, 1]);
    expect(scenario.players[0].factionId).toBe(config.seats[0].nation);
    expect(scenario.players[1].factionId).toBe(INFECTED_FACTION_ID);
    // Deterministic ground: the room builds it once, both peers must agree.
    expect(buildLobbyScenario(parsed.config).tiles).toEqual(scenario.tiles);
  });

  it('seats both commanders on player 0 and refuses the other shapes', () => {
    expect(() => makeRoom()).not.toThrow();
    // A co-op seat may not be given its own player: there is only one army.
    expect(() =>
      makeRoom([
        { seatId: 0, playerId: 0, team: 0, token: 'coop-seat-zero-token-00000000' },
        { seatId: 1, playerId: 1, team: 1, token: 'coop-seat-one-token-000000000' },
      ]),
    ).toThrow(/defending player/);
    // And the 1v1 shape still rejects two seats on one player.
    expect(
      () =>
        new RoomMatch({
          roomId: 'duel-room',
          mode: '1v1',
          seats: coopSeats(),
          matchDurationMs: 600_000,
          matchDeadlineAt: 10_000_000,
          game: coopGame(),
        }),
    ).toThrow(/unique/);
  });

  it('tells both seats the mode and lets either one command the defence', () => {
    const room = makeRoom();
    const zero = new FakeSocket();
    const hello = room.connect(0, coopSeats()[0].token, zero, 1_000);
    expect(hello.ok).toBe(true);
    if (!hello.ok) return;
    expect(hello.hello.mode).toBe('outbreak');
    expect(hello.hello.team).toBe(0);

    const one = new FakeSocket();
    expect(room.connect(1, coopSeats()[1].token, one, 1_000).ok).toBe(true);

    const soldier = room.game.state.entities.find((e) => e.owner === 0 && e.kind === 'unit')!;
    // The guest commands the host's army: the seat table grants it, and the
    // gate stamps player 0 on the command.
    for (const [seat, socket] of [
      [0, zero],
      [1, one],
    ] as const) {
      room.game.pending.length = 0;
      room.receive(seat, socket, command({ type: 'stop', ids: [soldier.id] }), 2_000 + seat * 500);
      expect(room.game.pending, `seat ${seat}`).toHaveLength(1);
      expect(room.game.pending[0]).toMatchObject({ team: 0, ids: [soldier.id] });
    }
  });

  it('ends the run when the Command Post falls, as a defeat for both seats', () => {
    const room = makeRoom();
    connectBoth(room);
    const post = room.game.state.entities.find((e) => e.defId === 'commandPost')!;
    post.hp = 0;
    room.tick(2_000);
    const result = room.currentResult;
    expect(result.phase).toBe('finished');
    expect(result.winnerTeam).toBe(1);
    // Both seats hold the same army, so both read the same ending.
    expect(resultForTeam(result, 0)).toBe('defeat');
  });

  it('streams the survival readout so a remote seat reads the room\u2019s own numbers', () => {
    const room = makeRoom();
    connectBoth(room);
    room.tick(2_000);
    const snapshot = createTeamSnapshot(room.game, 0);
    expect(snapshot.outbreak).toMatchObject({
      wave: 1,
      mode: 'coop',
      players: 2,
      difficulty: 'normal',
    });

    const assembler = new SnapshotAssembler({ roomId: 'coop-room', team: 0 });
    expect(
      assembler.apply({
        type: 'sync',
        v: 2,
        epoch: 1,
        seq: 1,
        tick: snapshot.tick,
        team: 0,
        roomId: 'coop-room',
        checkpoint: false,
        state: snapshot,
      }).ok,
    ).toBe(true);

    // The wave clock and the kill tally change on the server only; the seat
    // must receive both rather than reading a director that never ticked.
    const baseline = createBaseline(snapshot);
    // The room steps one tick per call; run the opening preparation forward far
    // enough that the assault clock and the survival ledger actually moved.
    for (let step = 0; step < 1_200; step++) room.tick(2_100 + step);
    const next = createTeamState(room.game, 0, 0, undefined, false);
    expect(next.outbreak).not.toEqual(snapshot.outbreak);
    const fog = Uint8Array.from(room.game.state.fog[0]);
    const changes = buildDelta(baseline, next, fog);
    expect(changes.outbreak).toEqual(next.outbreak);
    expect(
      assembler.apply({
        type: 'delta',
        v: 2,
        epoch: 1,
        seq: 2,
        base: 1,
        tick: next.tick,
        team: 0,
        roomId: 'coop-room',
        changes,
      }).ok,
    ).toBe(true);
    expect(assembler.state()?.outbreak).toEqual(next.outbreak);

    // A 1v1 room carries no survival readout at all.
    const duel = new RoomMatch({
      roomId: 'duel-room',
      mode: '1v1',
      seats: [
        { seatId: 0, playerId: 0, team: 0, token: 'duel-seat-zero-token-0000000' },
        { seatId: 1, playerId: 1, team: 1, token: 'duel-seat-one-token-00000000' },
      ],
      matchDurationMs: 600_000,
      matchDeadlineAt: 10_000_000,
      game: new Game(buildLobbyScenario(lobbyConfigFor('open-front', 600_000)), {
        localPlayerId: -1,
        enableAI: false,
      }),
    });
    expect(createTeamState(duel.game, 0, 0, undefined, false).outbreak).toBeUndefined();
  });

  it('closes a co-op run at the reservation deadline as abandoned, not a score win', () => {
    const room = makeRoom();
    connectBoth(room);
    room.finishAtDeadline(2_000);
    const result = room.currentResult;
    expect(result.phase).toBe('finished');
    // Outbreak is endless: the horde holding more hit points is not a victory
    // for anyone, so the room reports the run as abandoned for both seats.
    expect(result.winnerTeam).toBeNull();
    expect(result.reason).toBe('abandoned');
    expect(resultForTeam(result, 0)).toBe('draw');
  });
});
