import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { TILE_SIZE } from '../src/sim/constants';
import { TERRAIN, Terrain, tileIndex } from '../src/sim/terrain';
import type { Scenario, ScenarioUnit } from '../src/sim/scenario';

/**
 * Performance harness. Numbers are logged rather than hidden, because the
 * provisional targets in docs/PLAN.md are based on these measurements.
 * Thresholds are deliberately loose enough not to flake on shared CI hosts.
 */

function ms(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

function landTilesNear(scenario: Scenario, cx: number, cz: number, radius: number): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (let z = cz - radius; z <= cz + radius; z++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 1 || z < 1 || x >= scenario.width - 1 || z >= scenario.height - 1) continue;
      const tile = scenario.tiles[tileIndex(scenario.width, x, z)];
      const props = TERRAIN[tile.t as keyof typeof TERRAIN];
      if (!props || props.water) continue;
      if (!Number.isFinite(props.costs.tracked)) continue;
      out.push({ x, z });
    }
  }
  return out;
}

function stressScenario(perSide: number): Scenario {
  const scenario = createIslandAssault();
  const roster = ['rifle', 'rifle', 'atgm', 'tank'];
  for (const player of scenario.players) {
    const tiles = landTilesNear(scenario, player.startX, player.startZ, 26);
    for (let i = 0; i < perSide && tiles.length > 0; i++) {
      const tile = tiles[(i * 37) % tiles.length];
      const unit: ScenarioUnit = {
        defId: roster[i % roster.length],
        owner: player.id,
        x: tile.x,
        z: tile.z,
      };
      scenario.units.push(unit);
    }
  }
  return scenario;
}

describe('measured simulation performance', () => {
  it('reports baseline tick cost for the authored scenario', () => {
    const game = new Game(createIslandAssault(), { enableAI: true });
    game.advance(20); // warm up caches and path grids
    const entities = game.state.entities.length;
    const total = ms(() => game.advance(600)); // 30 simulated seconds
    const perTick = total / 600;
    console.log(
      `[perf] baseline: ${entities} entities, 600 ticks in ${total.toFixed(1)}ms (${perTick.toFixed(3)}ms/tick)`,
    );
    expect(Number.isFinite(perTick)).toBe(true);
    expect(perTick).toBeLessThan(20);
  });

  it('reports tick cost at representative large-army entity counts', () => {
    const scenario = stressScenario(70);
    const game = new Game(scenario, { enableAI: true });
    const entities = game.state.entities.length;
    expect(entities).toBeGreaterThan(120);
    for (const p of scenario.players) {
      const ids = game
        .entitiesOf(p.id, 'unit')
        .filter((e) => e.defId !== 'harvester')
        .map((e) => e.id);
      const enemy = scenario.players.find((q) => q.team !== p.team)!;
      game.enqueueCommand({
        type: 'move',
        team: p.id,
        ids,
        x: enemy.startX * TILE_SIZE,
        z: enemy.startZ * TILE_SIZE,
        attackMove: true,
      });
    }
    const total = ms(() => game.advance(300)); // 15 simulated seconds of contact
    const perTick = total / 300;
    console.log(
      `[perf] stress: ${entities} entities, 300 ticks in ${total.toFixed(1)}ms (${perTick.toFixed(3)}ms/tick)`,
    );
    expect(Number.isFinite(perTick)).toBe(true);
    expect(perTick).toBeLessThan(40); // provisional ceiling, see docs/PLAN.md
  });

  it('reports pathfinding batch cost for a 100-order attack move', () => {
    const scenario = stressScenario(100);
    const game = new Game(scenario, { enableAI: false });
    const ids = game.entitiesOf(0, 'unit').map((e) => e.id).slice(0, 100);
    const target = scenario.players[1];
    const total = ms(() => {
      game.enqueueCommand({
        type: 'move',
        team: 0,
        ids,
        x: target.startX * TILE_SIZE,
        z: target.startZ * TILE_SIZE,
        attackMove: true,
      });
      game.tick();
    });
    console.log(`[perf] pathfinding: ${ids.length} orders in ${total.toFixed(1)}ms`);
    expect(ids.length).toBe(100);
    expect(total).toBeLessThan(1500);
  });

  it('reports save serialisation and restore cost', () => {
    const game = new Game(stressScenario(55), { enableAI: false });
    game.advance(100);
    let json = '';
    const saveMs = ms(() => {
      json = JSON.stringify(game.toSave());
    });
    const loadMs = ms(() => {
      const restored = Game.fromSave(JSON.parse(json));
      expect(restored.state.entities.length).toBe(game.state.entities.length);
    });
    console.log(
      `[perf] save/load: ${game.state.entities.length} entities, serialise ${saveMs.toFixed(1)}ms, restore ${loadMs.toFixed(1)}ms, ${(json.length / 1024).toFixed(0)}KiB`,
    );
    expect(saveMs).toBeLessThan(500);
    expect(loadMs).toBeLessThan(1000);
  });

  it('keeps far more land than water on the authored island', () => {
    const scenario = createIslandAssault();
    let land = 0;
    let water = 0;
    for (const tile of scenario.tiles) {
      if (tile.t === Terrain.DeepWater || tile.t === Terrain.ShallowWater) water++;
      else land++;
    }
    const total = land + water;
    console.log(
      `[perf] map: ${scenario.width}x${scenario.height}, ${land} land tiles (${((land / total) * 100).toFixed(0)}%), ${water} water tiles (${((water / total) * 100).toFixed(0)}%)`,
    );
    // An island map should have meaningful amounts of both, not one token lake.
    expect(land).toBeGreaterThan(total * 0.3);
    expect(water).toBeGreaterThan(total * 0.3);
  });
});
