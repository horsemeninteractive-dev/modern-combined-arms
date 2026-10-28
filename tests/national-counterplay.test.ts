import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import type { Scenario } from '../src/sim/scenario';

/**
 * Small, controlled counterplay fixtures for Phase 5. These are deliberately
 * not full battles: each test places one specialist and one answer on open
 * ground, disables fog and AI, and asks only whether the interaction the roster
 * claims actually occurs in the simulation.
 */

function arena(westNation: string, eastNation: string): Scenario {
  const size = 48;
  const scenario = createEmptyScenario(size, size);
  scenario.meta.id = 'national-counterplay';
  scenario.settings.seed = 9001;
  scenario.settings.startingMats = 6000;
  scenario.settings.startingReq = 1000;
  scenario.settings.fog = false;
  scenario.settings.victory = 'destroyHQ';
  scenario.players[0].factionId = westNation;
  scenario.players[0].startX = 4;
  scenario.players[0].startZ = 4;
  scenario.players[0].isAI = false;
  scenario.players[1].factionId = eastNation;
  scenario.players[1].startX = 44;
  scenario.players[1].startZ = 44;
  scenario.players[1].isAI = false;
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 4, z: 4 },
    { defId: 'commandPost', owner: 1, x: 42, z: 42 },
  );
  return scenario;
}

function gameFor(scenario: Scenario): Game {
  return new Game(scenario, { enableAI: false });
}

function findUnit(game: Game, defId: string, owner: number) {
  return game.state.entities.find(
    (e) => e.kind === 'unit' && e.defId === defId && e.owner === owner && e.hp > 0,
  )!;
}

function findBuilding(game: Game, defId: string, owner: number) {
  return game.state.entities.find(
    (e) => e.kind === 'building' && e.defId === defId && e.owner === owner && e.hp > 0,
  )!;
}

function attack(game: Game, team: number, attackerId: number, targetId: number): void {
  game.enqueueCommand({ type: 'attack', team, ids: [attackerId], targetId });
}

describe('national counterplay', () => {
  it('lets mobile armour exploit the MLRS dead zone without taking return fire', () => {
    const scenario = arena('uk', 'lithuania');
    scenario.units.push(
      { defId: 'mlrs', owner: 0, x: 20, z: 24 },
      { defId: 'tank', owner: 1, x: 25, z: 24 },
    );
    const game = gameFor(scenario);
    const mlrs = findUnit(game, 'mlrs', 0);
    const tank = findUnit(game, 'tank', 1);
    const mlrsHp = mlrs.hp;
    // Five tiles: inside the six-tile minimum range, inside the tank's reach.
    attack(game, 1, tank.id, mlrs.id);
    game.advance(20 * 12);
    expect(mlrs.hp).toBeLessThan(mlrsHp);
    // The MLRS cannot answer a target inside its dead zone.
    expect(tank.hp).toBe(tank.maxHp);
  });

  it('makes the bunker survive anti-structure fire that kills an MG nest', () => {
    const make = (defId: 'bunker' | 'mgNest') => {
      const scenario = arena('russia', 'hungary');
      scenario.structures.push({ defId, owner: 1, x: 28, z: 24 });
      scenario.units.push({ defId: 'heavyHowitzer', owner: 0, x: 15, z: 24 });
      const game = gameFor(scenario);
      const target = findBuilding(game, defId, 1);
      // Both structures take the same fire. Under the doubled structure
      // durability the nest falls at about 45 s and the bunker at about 75 s,
      // so 50 s is the window that still separates them.
      game.advance(20 * 50);
      return { game, target };
    };
    const bunker = make('bunker');
    const nest = make('mgNest');
    expect(bunker.target.hp).toBeGreaterThan(0);
    expect(nest.target.hp).toBeLessThanOrEqual(0);
    expect(bunker.target.hp).toBeGreaterThan(nest.target.hp);
  });

  it('lets a spearhead bypass a bunker while the bunker cannot stop it', () => {
    const scenario = arena('poland', 'hungary');
    scenario.structures.push({ defId: 'bunker', owner: 1, x: 28, z: 24 });
    scenario.units.push({ defId: 'spearhead', owner: 0, x: 23, z: 24 });
    const game = gameFor(scenario);
    const bunker = findBuilding(game, 'bunker', 1);
    const spearhead = findUnit(game, 'spearhead', 0);
    const hp = bunker.hp;
    attack(game, 0, spearhead.id, bunker.id);
    game.advance(20 * 20);
    expect(bunker.hp).toBeLessThan(hp);
    // The heavy MG is an anti-infantry weapon; it barely scratches heavy armour.
    expect(spearhead.hp).toBeGreaterThan(spearhead.maxHp * 0.95);
  });

  it('trades the unarmed Pathfinder for an armed scout that catches it', () => {
    const scenario = arena('baltic', 'lithuania');
    scenario.units.push(
      { defId: 'recon', owner: 0, x: 18, z: 24 },
      { defId: 'pathfinder', owner: 1, x: 24, z: 24 },
    );
    const game = gameFor(scenario);
    const recon = findUnit(game, 'recon', 0);
    const pathfinder = findUnit(game, 'pathfinder', 1);
    attack(game, 0, recon.id, pathfinder.id);
    game.advance(20 * 15);
    expect(pathfinder.hp).toBeLessThanOrEqual(0);
    expect(recon.hp).toBe(recon.maxHp);
  });

  it('wins most head-on tank duels with the Spearhead', () => {
    // A single duel is decided by one 86%-accuracy shell: across twelve seeds
    // the Spearhead wins nine and loses the tail where both late shells miss.
    // Assert the aggregate advantage rather than one coin-flip.
    const duel = (seed: number) => {
      const scenario = arena('poland', 'uk');
      scenario.settings.seed = seed;
      scenario.units.push(
        { defId: 'spearhead', owner: 0, x: 18, z: 24 },
        { defId: 'tank', owner: 1, x: 25, z: 24 },
      );
      const game = gameFor(scenario);
      const spearhead = findUnit(game, 'spearhead', 0);
      const tank = findUnit(game, 'tank', 1);
      attack(game, 0, spearhead.id, tank.id);
      attack(game, 1, tank.id, spearhead.id);
      game.advance(20 * 40);
      return { tankHp: tank.hp, spearheadHp: spearhead.hp };
    };
    const results = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(duel);
    const spearheadWins = results.filter((r) => r.tankHp <= 0 && r.spearheadHp > 0).length;
    expect(spearheadWins).toBeGreaterThanOrEqual(8);
    // The tank never wins cleanly: in its three wins it survives on one tier of
    // health, so the exchange is close rather than a runaway.
    for (const r of results) {
      if (r.tankHp > 0) expect(r.tankHp).toBeLessThan(20);
    }
  });

  it('punishes a Spearhead with guided anti-tank fire before it can close', () => {
    const scenario = arena('uk', 'poland');
    scenario.units.push(
      { defId: 'atgm', owner: 0, x: 18, z: 24 },
      { defId: 'spearhead', owner: 1, x: 28, z: 24 },
    );
    const game = gameFor(scenario);
    const atgm = findUnit(game, 'atgm', 0);
    const spearhead = findUnit(game, 'spearhead', 1);
    const hp = spearhead.hp;
    // Ten tiles: outside the Spearhead's eight-tile gun, inside ATGM range.
    attack(game, 0, atgm.id, spearhead.id);
    game.advance(20 * 6);
    expect(spearhead.hp).toBeLessThan(hp);
    expect(atgm.hp).toBeGreaterThan(0);
  });

  it('kills an exposed heavy howitzer with mobile armour inside its reload cycle', () => {
    const scenario = arena('russia', 'uk');
    scenario.units.push(
      { defId: 'heavyHowitzer', owner: 0, x: 18, z: 24 },
      { defId: 'tank', owner: 1, x: 24, z: 24 },
    );
    const game = gameFor(scenario);
    const howitzer = findUnit(game, 'heavyHowitzer', 0);
    const tank = findUnit(game, 'tank', 1);
    attack(game, 1, tank.id, howitzer.id);
    game.advance(20 * 20);
    expect(howitzer.hp).toBeLessThanOrEqual(0);
    expect(tank.hp).toBeGreaterThan(0);
  });

  it('removes a Deep Recon UAV with the existing SAM battery', () => {
    const scenario = arena('belarus', 'uk');
    scenario.structures.push({ defId: 'samBattery', owner: 1, x: 26, z: 24 });
    scenario.units.push({ defId: 'deepReconUAV', owner: 0, x: 18, z: 24 });
    const game = gameFor(scenario);
    const uav = findUnit(game, 'deepReconUAV', 0);
    const hp = uav.hp;
    game.advance(20 * 12);
    expect(uav.hp).toBeLessThan(hp);
  });
});
