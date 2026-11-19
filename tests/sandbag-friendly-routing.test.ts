import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { TILE_SIZE } from '../src/sim/constants';
import type { Scenario } from '../src/sim/scenario';
import type { Entity } from '../src/sim/types';

/**
 * A sandbag line is the position the infantry are holding, not a speed bump for
 * the armour parked behind them. A tracked hull routes around its own bags, and
 * only an *enemy* line is ground it grinds flat.
 */

function arena(width = 44, height = 30): Scenario {
  const scenario = createEmptyScenario(width, height);
  scenario.settings.fog = false;
  // A match with no command posts is decided on its first tick.
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: 'commandPost', owner: 1, x: width - 5, z: height - 5 },
  );
  return scenario;
}

function moveTo(game: Game, entity: Entity, tileX: number, tileZ: number): void {
  game.enqueueCommand({
    type: 'move',
    team: 0,
    ids: [entity.id],
    x: (tileX + 0.5) * TILE_SIZE,
    z: (tileZ + 0.5) * TILE_SIZE,
  });
}

function bagsOf(game: Game): Entity[] {
  return game.state.entities.filter((e) => e.kind === 'building' && e.defId === 'sandbagWall');
}

function tileOf(entity: Entity): [number, number] {
  return [Math.floor(entity.x / TILE_SIZE), Math.floor(entity.z / TILE_SIZE)];
}

describe('friendly sandbag lines', () => {
  it('routes a tracked hull around its own bags instead of flattening them', () => {
    const scenario = arena();
    scenario.structures.push({ defId: 'sandbagWall', owner: 0, x: 22, z: 15 });
    scenario.units.push({ defId: 'tank', owner: 0, x: 8, z: 15 });
    const game = new Game(scenario, { enableAI: false });
    const tank = game.entitiesOf(0, 'unit')[0];
    const bags = bagsOf(game)[0];
    const [bagX, bagZ] = tileOf(bags);
    expect(bagX).toBe(22);
    expect(bagZ).toBe(15);
    const fullHp = bags.hp;

    moveTo(game, tank, 38, 15);
    expect(game.state.events.filter((e) => e.type === 'orderFailed')).toHaveLength(0);

    let crossedTheLine = false;
    for (let step = 0; step < 400; step++) {
      game.tick();
      const [tx, tz] = tileOf(tank);
      // The hull never stands on the line: the route bends around it.
      expect([tx, tz]).not.toEqual([bagX, bagZ]);
      if (tx > bagX + 4) {
        crossedTheLine = true;
        break;
      }
    }
    expect(crossedTheLine).toBe(true);
    // The line is untouched: no crush damage, no stray shell.
    expect(bags.hp).toBe(fullHp);
    expect(bags.hp).toBeGreaterThan(0);
  });

  it('lets a hull sealed in by its own bags cross the line rather than strand', () => {
    const scenario = arena();
    // A full ring of the crew's own bags around the hull: with the avoidance
    // overlay treated as a wall there is no route out at all, so the order used
    // to fail and the tank sat there. It must instead be allowed to drive over
    // its own line — and the bags must survive being driven over.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        scenario.structures.push({ defId: 'sandbagWall', owner: 0, x: 16 + dx, z: 15 + dz });
      }
    }
    scenario.units.push({ defId: 'tank', owner: 0, x: 16, z: 15 });
    const game = new Game(scenario, { enableAI: false });
    const tank = game.entitiesOf(0, 'unit')[0];
    const bags = bagsOf(game);
    expect(bags).toHaveLength(8);
    const hp = bags.map((bag) => bag.hp);

    moveTo(game, tank, 26, 15);
    expect(game.state.events.filter((e) => e.type === 'orderFailed')).toHaveLength(0);

    let escaped = false;
    for (let step = 0; step < 400; step++) {
      game.tick();
      if (tileOf(tank)[0] > 18) {
        escaped = true;
        break;
      }
    }
    expect(escaped).toBe(true);
    // Crossing the ring is allowed; consigning it to the scrap heap is not.
    expect(bags.map((bag) => bag.hp)).toEqual(hp);
  });

  it('does not crush its own line even when a hull is standing on it', () => {
    const scenario = arena();
    scenario.structures.push({ defId: 'sandbagWall', owner: 0, x: 22, z: 15 });
    // Dropped straight onto the line: a hull shoved there by traffic or a line
    // raised around it must leave the bags standing on the way out.
    scenario.units.push({ defId: 'tank', owner: 0, x: 22, z: 15 });
    const game = new Game(scenario, { enableAI: false });
    const tank = game.entitiesOf(0, 'unit')[0];
    const bags = bagsOf(game)[0];

    moveTo(game, tank, 28, 15);
    for (let step = 0; step < 12; step++) game.tick();

    expect(bags.hp).toBeGreaterThan(0);
  });

  it('still grinds an enemy sandbag line flat', () => {
    const scenario = arena();
    scenario.structures.push({ defId: 'sandbagWall', owner: 1, x: 22, z: 15 });
    scenario.units.push({ defId: 'tank', owner: 0, x: 16, z: 15 });
    const game = new Game(scenario, { enableAI: false });
    const tank = game.entitiesOf(0, 'unit')[0];
    const bags = bagsOf(game)[0];

    moveTo(game, tank, 28, 15);
    for (let step = 0; step < 80; step++) game.tick();

    // An enemy line is not an obstacle a tracked crew respects.
    expect(bags.hp).toBeLessThanOrEqual(0);
    expect(tileOf(tank)[0]).toBeGreaterThan(22);
  });
});
