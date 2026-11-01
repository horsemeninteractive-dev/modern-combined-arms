import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { BUILDINGS } from '../src/data/buildings';
import { TILE_SIZE } from '../src/sim/constants';
import { clearOreUnderStructures, type Scenario } from '../src/sim/scenario';
import { tileIndex } from '../src/sim/terrain';
import type { Entity } from '../src/sim/types';

/**
 * Traffic, tight destinations and deposits nobody can mine.
 *
 * These are the paths a soldier walks: a group ordered into a pocket beside a
 * structure, a vehicle whose lane is held by a parked friendly hull, and a
 * harvester that must not drive at material it can never reach. Each of them
 * used to end with a unit standing still and the commander told "no route".
 */

function arena(width = 40, height = 40): Scenario {
  const scenario = createEmptyScenario(width, height);
  scenario.settings.fog = false;
  // A match with no command posts is decided on its first tick, and a decided
  // match freezes every unit before any of this code runs.
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: 'commandPost', owner: 1, x: width - 5, z: height - 5 },
  );
  return scenario;
}

function footprintOf(defId: string): { w: number; h: number } {
  return BUILDINGS[defId].footprint;
}

function unitsOf(game: Game, owner = 0): Entity[] {
  return game.entitiesOf(owner, 'unit');
}

describe('ground that is standable but walled off', () => {
  it('walks out to reachable ground instead of refusing the unit', () => {
    const scenario = arena(48, 48);
    // A pocket of open ground sealed by rock: a hull can stand on it and can
    // never drive to it. Aim there and the unit used to be told "no route".
    const px = 30;
    const pz = 24;
    scenario.tiles[px + pz * scenario.width] = { t: 2, e: 1, o: 0 };
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        scenario.tiles[px + dx + (pz + dz) * scenario.width] = { t: 5, e: 1, o: 0 };
      }
    }
    scenario.units.push({ defId: 'tank', owner: 0, x: 20, z: 24 });
    const game = new Game(scenario, { enableAI: false });
    const tank = unitsOf(game)[0];

    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [tank.id],
      x: (px + 0.5) * TILE_SIZE,
      z: (pz + 0.5) * TILE_SIZE,
    });
    game.tick();

    expect(game.state.events.filter((e) => e.type === 'orderFailed')).toHaveLength(0);
    expect(tank.order?.type).toBe('move');
    expect(tank.path.length).toBeGreaterThan(0);
  });
});

describe('group orders into a tight space', () => {
  it('stands a squad down beside a structure instead of refusing the move', () => {
    const scenario = arena();
    const { w, h } = footprintOf('barracks');
    const bx = 16;
    const bz = 16;
    scenario.structures.push({ defId: 'barracks', owner: 0, x: bx, z: bz });
    for (let i = 0; i < 8; i++) {
      scenario.units.push({
        defId: 'rifle',
        owner: 0,
        x: 26 + (i % 4),
        z: 18 + Math.floor(i / 4),
      });
    }
    const game = new Game(scenario, { enableAI: false });
    const ids = unitsOf(game).map((e) => e.id);

    // Aim at the strip of ground immediately south of the block: the formation
    // grid puts several slots inside the footprint.
    const target = {
      x: (bx + Math.floor(w / 2) + 0.5) * TILE_SIZE,
      z: (bz + h + 0.5) * TILE_SIZE,
    };
    game.enqueueCommand({ type: 'move', team: 0, ids, x: target.x, z: target.z });
    game.tick();

    const refused = game.state.events.filter((e) => e.type === 'orderFailed');
    expect(refused).toHaveLength(0);
    // Every squad took the order and started walking. Some were walked out to
    // the nearest open tile, which is the whole point.
    const moving = unitsOf(game).filter((e) => e.order?.type === 'move' || e.state === 'moving');
    expect(moving.length).toBe(ids.length);
  });

  it('walks a single unit to the nearest open ground when the aim is blocked', () => {
    const scenario = arena();
    const { w, h } = footprintOf('barracks');
    scenario.structures.push({ defId: 'barracks', owner: 0, x: 18, z: 18 });
    scenario.units.push({ defId: 'tank', owner: 0, x: 30, z: 24 });
    const game = new Game(scenario, { enableAI: false });
    const tank = unitsOf(game)[0];

    // Straight into the middle of the building.
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [tank.id],
      x: (18 + Math.floor(w / 2) + 0.5) * TILE_SIZE,
      z: (18 + Math.floor(h / 2) + 0.5) * TILE_SIZE,
    });
    game.tick();

    expect(game.state.events.filter((e) => e.type === 'orderFailed')).toHaveLength(0);
    expect(tank.order?.type).toBe('move');
    expect(tank.path.length).toBeGreaterThan(0);
  });
});

describe('traffic makes way', () => {
  it('drives through ground a parked squad is holding, without refusing the order', () => {
    const scenario = arena();
    scenario.units.push({ defId: 'tank', owner: 0, x: 10, z: 20 });
    scenario.units.push({ defId: 'rifle', owner: 0, x: 15, z: 20 });
    const game = new Game(scenario, { enableAI: false });
    const tank = unitsOf(game).find((e) => e.defId === 'tank')!;
    const parked = unitsOf(game).find((e) => e.defId === 'rifle')!;
    const parkedX = parked.x;

    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [tank.id],
      x: 26.5 * TILE_SIZE,
      z: 20.5 * TILE_SIZE,
    });
    game.advance(20 * 20);

    // In the open a hull can steer around a squad, so nobody has to be moved:
    // the vehicle reaches its ground and the order is never refused.
    expect(tank.x).toBeGreaterThan(parkedX + 4);
    expect(game.state.events.filter((e) => e.type === 'orderFailed')).toHaveLength(0);
  });

  it('steps a parked unit out of a defile under its own power, not by teleporting', () => {
    const scenario = arena();
    // Rock either side of row 20: a one-tile lane with no shoulder to use.
    for (let x = 6; x < 32; x++) {
      for (const z of [17, 18, 19, 21, 22, 23]) scenario.tiles[x + z * scenario.width] = { t: 5, e: 1, o: 0 };
    }
    scenario.units.push({ defId: 'tank', owner: 0, x: 10, z: 20 });
    scenario.units.push({ defId: 'rifle', owner: 0, x: 18, z: 20 });
    const game = new Game(scenario, { enableAI: false });
    const tank = unitsOf(game).find((e) => e.defId === 'tank')!;
    const parked = unitsOf(game).find((e) => e.defId === 'rifle')!;
    const parkedStart = { x: parked.x, z: parked.z };

    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [tank.id],
      x: 30.5 * TILE_SIZE,
      z: 20.5 * TILE_SIZE,
    });
    let biggestStep = 0;
    let lastX = parked.x;
    let lastZ = parked.z;
    for (let t = 0; t < 20 * 60; t++) {
      game.tick();
      biggestStep = Math.max(biggestStep, Math.hypot(parked.x - lastX, parked.z - lastZ));
      lastX = parked.x;
      lastZ = parked.z;
    }

    // The vehicle got through the lane the squad was holding...
    expect(tank.x).toBeGreaterThan(26 * TILE_SIZE);
    // ...because the squad made way, and it walked there a frame at a time.
    expect(Math.hypot(parked.x - parkedStart.x, parked.z - parkedStart.z)).toBeGreaterThan(2);
    expect(biggestStep).toBeLessThan(TILE_SIZE);
    expect(game.state.events.filter((e) => e.type === 'orderFailed')).toHaveLength(0);
  });

  it('leaves a unit holding position where it was put', () => {
    const scenario = arena();
    scenario.units.push({ defId: 'tank', owner: 0, x: 10, z: 20 });
    scenario.units.push({ defId: 'rifle', owner: 0, x: 15, z: 20 });
    const game = new Game(scenario, { enableAI: false });
    const tank = unitsOf(game).find((e) => e.defId === 'tank')!;
    const holder = unitsOf(game).find((e) => e.defId === 'rifle')!;
    holder.stance = 'hold';
    const holderX = holder.x;
    const holderZ = holder.z;

    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [tank.id],
      x: 24.5 * TILE_SIZE,
      z: 20.5 * TILE_SIZE,
    });
    game.advance(20 * 14);

    // A unit told to hold its ground is not traffic: it stays exactly put.
    expect(holder.x).toBe(holderX);
    expect(holder.z).toBe(holderZ);
  });
});

describe('deposits nobody can mine', () => {
  it('clears authored ore that sits under a structure footprint', () => {
    const scenario = arena();
    const { w, h } = footprintOf('barracks');
    scenario.structures.push({ defId: 'barracks', owner: 0, x: 19, z: 19 });
    const buried = tileIndex(scenario.width, 19 + Math.floor(w / 2), 19 + Math.floor(h / 2));
    scenario.tiles[buried].o = 300;

    expect(clearOreUnderStructures(scenario)).toBe(1);
    expect(scenario.tiles[buried].o).toBe(0);
  });

  it('never sends a harvester at a deposit buried under a building', () => {
    const scenario = arena();
    const { w, h } = footprintOf('commandPost');
    scenario.structures.push({ defId: 'commandPost', owner: 0, x: 19, z: 19 });
    const buried = tileIndex(scenario.width, 19 + Math.floor(w / 2), 19 + Math.floor(h / 2));
    scenario.tiles[buried].o = 300;
    scenario.units.push({ defId: 'harvester', owner: 0, x: 26, z: 24 });
    const game = new Game(scenario, { enableAI: false });
    const harvester = unitsOf(game).find((e) => e.harvester)!;
    const start = { x: harvester.x, z: harvester.z };

    game.advance(20 * 8);

    // It stays parked looking for work rather than driving at a seam it can
    // never stand on and waiting there for the rest of the battle.
    expect(harvester.harvester!.phase).not.toBe('toOre');
    expect(Math.hypot(harvester.x - start.x, harvester.z - start.z)).toBeLessThan(1);
  });

  it('still sends a harvester at open ground that holds material', () => {
    const scenario = arena();
    scenario.tiles[tileIndex(scenario.width, 24, 24)].o = 300;
    scenario.units.push({ defId: 'harvester', owner: 0, x: 30, z: 24 });
    const game = new Game(scenario, { enableAI: false });
    const harvester = unitsOf(game).find((e) => e.harvester)!;

    game.advance(20 * 6);

    expect(harvester.harvester!.phase).not.toBe('seek');
    expect(harvester.x).toBeLessThan(30 * TILE_SIZE);
  });
});
