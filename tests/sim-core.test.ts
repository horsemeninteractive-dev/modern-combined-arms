import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { HARVESTER_CAPACITY, TILE_SIZE } from '../src/sim/constants';
import { dist } from '../src/core/math';
import { islandWith } from './helpers';
import { createEmptyScenario } from '../src/data/scenarios';

/** Flat grass map with two riflemen the test can place by hand. */
function openGroundGame(units: Array<{ defId: string; owner: number; x: number; z: number }>) {
  const scenario = createEmptyScenario(48, 40);
  scenario.settings.startingMats = 0;
  scenario.settings.startingReq = 0;
  // Both sides need a command post, or the battle is already decided and the
  // simulation stops before anything moves.
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: 'commandPost', owner: 1, x: 42, z: 34 },
  ];
  scenario.units = units;
  return new Game(scenario, { enableAI: false });
}

function newGame(seed?: number, ai = false) {
  const scenario = islandWith({});
  if (seed !== undefined) scenario.settings.seed = seed;
  return new Game(scenario, { enableAI: ai });
}

/** Facilities and extra units a specific test needs, authored as fixtures. */
function fixtureGame(extra: Parameters<typeof islandWith>[0], ai = false) {
  return new Game(islandWith(extra), { enableAI: ai });
}

function playerUnit(game: Game, defId: string, owner = 0) {
  return game.state.entities.find((e) => e.kind === 'unit' && e.defId === defId && e.owner === owner);
}

describe('game startup', () => {
  it('lands each side with a command post, an engineer, two MBTs and five riflemen', () => {
    const game = newGame();
    expect(game.state.players).toHaveLength(2);
    for (const owner of [0, 1]) {
      const structures = game.entitiesOf(owner, 'building');
      expect(structures.map((e) => e.defId)).toEqual(['commandPost']);
      const units = game.entitiesOf(owner, 'unit').map((e) => e.defId).sort();
      expect(units.filter((d) => d === 'engineer')).toHaveLength(1);
      expect(units.filter((d) => d === 'tank')).toHaveLength(2);
      expect(units.filter((d) => d === 'rifle')).toHaveLength(5);
      expect(units).toHaveLength(8);
    }
  });

  it('homes aircraft at an airfield and assigns naval units a shipyard', () => {
    const game = fixtureGame({
      structures: [
        { defId: 'airfield', owner: 0, x: 24, z: 24 },
        { defId: 'shipyard', owner: 0, x: 12, z: 37 },
      ],
      units: [
        { defId: 'fighter', owner: 0, x: 30, z: 27 },
        { defId: 'corvette', owner: 0, x: 9, z: 42 },
      ],
    });
    const fighter = playerUnit(game, 'fighter');
    const corvette = playerUnit(game, 'corvette');
    expect(fighter).toBeDefined();
    expect(corvette).toBeDefined();
    const airfield = game.getEntity(fighter!.homeId);
    const shipyard = game.getEntity(corvette!.homeId);
    expect(airfield?.defId).toBe('airfield');
    expect(shipyard?.defId).toBe('shipyard');
    expect(fighter!.aircraft?.landed).toBe(true);
    expect(fighter!.state).toBe('grounded');
    expect(fighter!.fuel).toBe(fighter!.maxFuel);
    expect(corvette!.x / TILE_SIZE).toBeLessThan(12);
  });

  it('does not crash over a minute of autonomous simulation', () => {
    const game = newGame();
    game.advance(20 * 60);
    expect(game.state.tick).toBe(1200);
    expect(Number.isFinite(game.state.players[0].mats)).toBe(true);
    for (const e of game.state.entities) {
      expect(Number.isFinite(e.x)).toBe(true);
      expect(Number.isFinite(e.z)).toBe(true);
      expect(e.hp).toBeGreaterThan(0);
    }
  });

  it('harvests and delivers materials automatically', () => {
    const game = fixtureGame({
      structures: [{ defId: 'refinery', owner: 0, x: 21, z: 32 }],
      units: [{ defId: 'harvester', owner: 0, x: 26, z: 34 }],
    });
    const start = game.player(0)!.stats.matsGathered;
    game.advance(20 * 45);
    expect(game.player(0)!.stats.matsGathered).toBeGreaterThan(start);
    expect(game.player(0)!.mats).toBeGreaterThan(0);
  });

  it('returns a full harvester to the refinery without being ordered', () => {
    const game = fixtureGame({
      structures: [{ defId: 'refinery', owner: 0, x: 21, z: 32 }],
      units: [{ defId: 'harvester', owner: 0, x: 26, z: 34 }],
    });
    const harvester = playerUnit(game, 'harvester')!;
    harvester.harvester!.ore = HARVESTER_CAPACITY;
    harvester.harvester!.phase = 'seek';
    // A load is tipped at a delivery mouth, so the round trip is a drive to the
    // apron plus the unloading run — not an instant deposit from anywhere in
    // the compound.
    for (let i = 0; i < 20 * 40 && game.player(0)!.stats.matsGathered === 0; i++) game.advance(1);
    expect(game.player(0)!.stats.matsGathered).toBeCloseTo(HARVESTER_CAPACITY, 5);
  });
});

describe('orders and movement', () => {
  it('moves a tank toward a reachable destination and reports no failure', () => {
    const game = newGame();
    const tank = playerUnit(game, 'tank')!;
    const startX = tank.x;
    const startZ = tank.z;
    const destination = { x: 34 * TILE_SIZE, z: 38 * TILE_SIZE };
    game.enqueueCommand({ type: 'move', team: 0, ids: [tank.id], x: destination.x, z: destination.z });
    game.advance(20 * 12);
    expect(dist(tank.x, tank.z, startX, startZ)).toBeGreaterThan(8);
    expect(Number.isFinite(tank.x)).toBe(true);
    expect(game.state.events.some((e) => e.type === 'orderFailed' && e.team === 0)).toBe(false);
  });

  it('reports unreachable destinations instead of silently ignoring them', () => {
    const game = newGame();
    const tank = playerUnit(game, 'tank')!;
    const deepWater = { x: 3 * TILE_SIZE, z: 30 * TILE_SIZE };
    game.enqueueCommand({ type: 'move', team: 0, ids: [tank.id], x: deepWater.x, z: deepWater.z });
    game.tick();
    expect(game.state.events.some((e) => e.type === 'orderFailed')).toBe(true);
  });

  it('refuses to command enemy units', () => {
    const game = newGame();
    const enemy = playerUnit(game, 'tank', 1)!;
    const start = { x: enemy.x, z: enemy.z };
    game.enqueueCommand({ type: 'move', team: 0, ids: [enemy.id], x: 20 * TILE_SIZE, z: 20 * TILE_SIZE });
    game.advance(20);
    expect(enemy.order).toBeNull();
    expect(enemy.path).toHaveLength(0);
    expect(dist(enemy.x, enemy.z, start.x, start.z)).toBeLessThan(1);
  });

  it('walks around an idle unit instead of shoving it out of position', () => {
    const game = openGroundGame([
      { defId: 'rifle', owner: 0, x: 20, z: 23 },
      { defId: 'rifle', owner: 0, x: 20, z: 26 },
    ]);
    const [idle, mover] = game.entitiesOf(0, 'unit').filter((e) => e.defId === 'rifle');
    // Park the idle rifleman directly on the mover's line and let the mover
    // cross the same spot.
    idle.x = 20.5 * TILE_SIZE;
    idle.z = 23.5 * TILE_SIZE;
    mover.x = 20.5 * TILE_SIZE;
    mover.z = 26.5 * TILE_SIZE;
    const parked = { x: idle.x, z: idle.z };
    const goal = { x: 20.5 * TILE_SIZE, z: 19.5 * TILE_SIZE };
    game.enqueueCommand({ type: 'move', team: 0, ids: [mover.id], x: goal.x, z: goal.z });
    let closest = Infinity;
    for (let i = 0; i < 20 * 8; i++) {
      game.tick();
      closest = Math.min(closest, dist(mover.x, mover.z, idle.x, idle.z));
      if (dist(mover.x, mover.z, goal.x, goal.z) < TILE_SIZE) break;
    }
    expect(dist(mover.x, mover.z, goal.x, goal.z)).toBeLessThan(TILE_SIZE);
    expect(dist(idle.x, idle.z, parked.x, parked.z)).toBeLessThan(0.5 * TILE_SIZE);
    // It walked around the obstacle rather than through it.
    expect(closest).toBeGreaterThan(0.9 * TILE_SIZE);
  });

  it('lets a moving unit leave an overlap without displacing the one holding still', () => {
    const game = openGroundGame([
      { defId: 'rifle', owner: 0, x: 20, z: 20 },
      { defId: 'rifle', owner: 0, x: 20, z: 20 },
    ]);
    const [a, b] = game.entitiesOf(0, 'unit').filter((e) => e.defId === 'rifle');
    a.x = 20.5 * TILE_SIZE;
    a.z = 20.5 * TILE_SIZE;
    b.x = 20.6 * TILE_SIZE;
    b.z = 20.6 * TILE_SIZE;
    const held = { x: a.x, z: a.z };
    game.enqueueCommand({ type: 'move', team: 0, ids: [b.id], x: 26 * TILE_SIZE, z: 20.5 * TILE_SIZE });
    game.advance(20 * 3);
    // Ten centimetres, not a shove: the mover does all the separating.
    expect(dist(a.x, a.z, held.x, held.z)).toBeLessThan(0.05 * TILE_SIZE);
    expect(dist(b.x, b.z, held.x, held.z)).toBeGreaterThan(2 * TILE_SIZE);
  });

  it('keeps naval units on navigable water', () => {
    const game = fixtureGame({
      structures: [{ defId: 'shipyard', owner: 0, x: 12, z: 37 }],
      units: [{ defId: 'corvette', owner: 0, x: 9, z: 42 }],
    });
    const ship = playerUnit(game, 'corvette')!;
    game.enqueueCommand({ type: 'move', team: 0, ids: [ship.id], x: 60 * TILE_SIZE, z: 50 * TILE_SIZE });
    game.advance(20 * 25);
    const tile = Math.floor(ship.z / TILE_SIZE);
    const col = Math.floor(ship.x / TILE_SIZE);
    const terrain = game.state.map.terrain[tile * game.state.map.width + col];
    expect(terrain === 0 || terrain === 1).toBe(true);
  });
});

describe('production and economy', () => {
  function barracksGame() {
    return fixtureGame({ structures: [{ defId: 'barracks', owner: 0, x: 20, z: 38 }] });
  }

  it('queues, pays for and deploys a rifleman', () => {
    const game = barracksGame();
    const barracks = game.state.entities.find((e) => e.owner === 0 && e.defId === 'barracks')!;
    const matsBefore = game.player(0)!.mats;
    const unitsBefore = game.player(0)!.stats.unitsBuilt;
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: barracks.id, defId: 'rifle' });
    game.tick();
    expect(barracks.queue).toHaveLength(1);
    // The cost is taken up front; one tick of the headquarters trickle lands too.
    expect(game.player(0)!.mats).toBeCloseTo(
      matsBefore - 130 + game.passiveMatsRate(0) / 20,
      6,
    );
    game.advance(20 * 8);
    expect(barracks.queue).toHaveLength(0);
    expect(game.player(0)!.stats.unitsBuilt).toBe(unitsBefore + 1);
  });

  it('refuses production without an appropriate facility', () => {
    const game = barracksGame();
    const barracks = game.state.entities.find((e) => e.owner === 0 && e.defId === 'barracks')!;
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: barracks.id, defId: 'tank' });
    game.tick();
    expect(barracks.queue).toHaveLength(0);
    expect(game.state.events.some((e) => e.type === 'orderFailed')).toBe(true);
  });

  it('cancels production and refunds the cost', () => {
    const game = barracksGame();
    const barracks = game.state.entities.find((e) => e.owner === 0 && e.defId === 'barracks')!;
    const before = game.player(0)!.mats;
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: barracks.id, defId: 'rifle' });
    game.tick();
    game.enqueueCommand({ type: 'cancelProduction', team: 0, buildingId: barracks.id, index: 0 });
    game.tick();
    expect(barracks.queue).toHaveLength(0);
    // Full refund across two ticks, plus two ticks of the headquarters trickle.
    expect(game.player(0)!.mats).toBeCloseTo(
      before + (2 * game.passiveMatsRate(0)) / 20,
      6,
    );
  });
});
