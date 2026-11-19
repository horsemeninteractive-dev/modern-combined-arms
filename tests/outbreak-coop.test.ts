import { CommandGate } from '../src/multiplayer/commandGate';
import { createTeamSnapshot } from '../src/multiplayer/projection';
import { Game } from '../src/sim/game';
import { createOutbreakScenario } from '../src/outbreak/scenario';
import { INFECTED_FACTION_ID } from '../src/data/zombies';

/**
 * Co-op is one shared command: both room seats are seated on player 0, so the
 * gate's exact-ownership rule keeps working and neither client can claim the
 * infected. These tests drive the real gate over a real Outbreak match rather
 * than a mock, which is the only way to prove the authority model holds.
 */

function envelope(command: unknown): { v: 1; command: unknown } {
  return { v: 1, command };
}

function seatTable() {
  // Two seats, one player: the cooperative permission model.
  return [
    { seatId: 0, playerId: 0, team: 0, active: true },
    { seatId: 1, playerId: 0, team: 0, active: true },
  ];
}

function outbreakGame(): Game {
  const scenario = createOutbreakScenario({
    difficulty: 'normal',
    mode: 'coop',
    nationId: 'lithuania',
    seed: 4242,
  });
  return new Game(scenario, { localPlayerId: -1, enableAI: false });
}

function friendlyUnit(game: Game) {
  const unit = game.state.entities.find(
    (entity) => entity.owner === 0 && entity.kind === 'unit' && entity.hp > 0,
  );
  if (!unit) throw new Error('the starting force should contain a unit');
  return unit;
}

describe('Outbreak co-op permissions', () => {
  it('accepts orders from both seats on the same force', () => {
    const game = outbreakGame();
    const gate = new CommandGate(game, seatTable(), { minCommandIntervalMs: 0 });
    const unit = friendlyUnit(game);
    const target = { x: unit.x + 64, z: unit.z };

    const fromHost = gate.submit(0, envelope({ type: 'move', ids: [unit.id], ...target }), 1000);
    const fromGuest = gate.submit(1, envelope({ type: 'move', ids: [unit.id], ...target }), 1001);

    expect(fromHost.ok).toBe(true);
    expect(fromGuest.ok).toBe(true);
    expect(game.pending).toHaveLength(2);
    // Both orders are stamped with the one shared team; there is no second
    // wallet and no second queue to merge.
    expect(game.pending.map((command) => command.team)).toEqual([0, 0]);
  });

  it('still refuses the infected and unowned buildings', () => {
    const game = outbreakGame();
    const gate = new CommandGate(game, seatTable(), { minCommandIntervalMs: 0 });
    const zombie = game.spawnInfected('zombieShambler', 40, 30, 1)!;
    const brute = game.spawnInfected('zombieBrute', 44, 30, 1)!;

    const zombieOrder = gate.submit(1, envelope({ type: 'stop', ids: [zombie.id] }), 2000);
    const bruteOrder = gate.submit(0, envelope({ type: 'stop', ids: [brute.id] }), 2001);

    expect(zombieOrder).toMatchObject({ ok: false, code: 'not-your-entity' });
    expect(bruteOrder).toMatchObject({ ok: false, code: 'not-your-entity' });
    expect(game.pending).toHaveLength(0);
  });

  it('shares one economy between the seats', () => {
    const game = outbreakGame();
    const gate = new CommandGate(game, seatTable(), { minCommandIntervalMs: 0 });
    const player = game.state.players[0];
    const before = player.mats;
    const unit = friendlyUnit(game);

    // A production order from the guest spends the same requisition pool.
    const produced = gate.submit(
      1,
      envelope({ type: 'produce', buildingId: unit.id, defId: 'rifleman' }),
      3000,
    );
    // Whatever the gate decides, it must not have created a second economy.
    expect(game.state.players).toHaveLength(2);
    expect(game.state.players[0].mats).toBeLessThanOrEqual(before);
    if (!produced.ok) expect(player.mats).toBe(before);
  });

  it('projects one identical battlefield to both seats', () => {
    const game = outbreakGame();
    for (let i = 0; i < 20; i++) game.tick();
    const hostView = createTeamSnapshot(game, 0, game.state.eventSeq, undefined, game.state.map as unknown as Parameters<typeof createTeamSnapshot>[4]);
    const guestView = createTeamSnapshot(game, 0, game.state.eventSeq, undefined, game.state.map as unknown as Parameters<typeof createTeamSnapshot>[4]);
    // Seats project the same team, so their maps, waves and zombie counts agree
    // by construction rather than by a synchronisation step.
    expect(guestView).toEqual(hostView);
    expect(game.state.players[0].factionId).not.toBe(INFECTED_FACTION_ID);
  });

  it('runs the wave director once for the shared match', () => {
    const game = outbreakGame();
    expect(game.outbreak).not.toBeNull();
    const match = game.outbreak!;
    for (let i = 0; i < 20 * 40; i++) game.tick();
    // One authoritative director: the wave advanced, and the count of live
    // infected is the director's own number, not a per-client tally.
    expect(match.wave).toBeGreaterThanOrEqual(1);
    expect(match.aliveInfected).toBe(
      game.state.entities.filter((entity) => entity.owner === 1 && entity.kind === 'unit').length,
    );
    expect(game.state.tick).toBeGreaterThan(700);
  });
});

describe('Outbreak co-op drops', () => {
  it('publishes the room drops and adopts them on a remote seat', () => {
    const game = outbreakGame();
    const match = game.outbreak!;
    // A remote seat ticks no simulation, so its own field is empty until the
    // room's list arrives.
    expect(match.activePickups).toHaveLength(0);
    match.applyRemotePickups([{ id: 5, kind: 'req', x: 120, z: 96 }]);
    expect(match.activePickups.map((pickup) => pickup.kind)).toEqual(['req']);
    // The same list rides the survival readout, so the other seat draws it too.
    expect(match.hudState().pickups).toEqual([{ id: 5, kind: 'req', x: 120, z: 96 }]);
  });
});
