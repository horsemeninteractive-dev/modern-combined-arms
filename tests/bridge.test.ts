import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { TILE_SIZE } from '../src/sim/constants';
import { Terrain, tileIndex } from '../src/sim/terrain';
import { BUILDINGS } from '../src/data/buildings';
import type { Scenario } from '../src/sim/scenario';

/**
 * A channel down the middle of the map with one road bridge over it. Everything
 * either side of the water is open ground, so the only thing that can stop a
 * wheeled column crossing is the span itself.
 */
function channelledScenario(): Scenario {
  const scenario = createEmptyScenario(40, 40);
  scenario.settings.startingMats = 0;
  scenario.settings.startingReq = 0;
  scenario.settings.fog = false;
  for (let z = 0; z < 40; z++) {
    for (const x of [18, 19]) {
      const tile = scenario.tiles[tileIndex(40, x, z)];
      tile.t = Terrain.DeepWater;
      tile.e = 0;
    }
  }
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: 'commandPost', owner: 1, x: 34, z: 34 },
    // 4x4 span: the deck covers the two water tiles plus one abutment each side.
    { defId: 'bridge', owner: -1, x: 17, z: 18 },
  ];
  scenario.units = [
    { defId: 'tank', owner: 0, x: 14, z: 20 },
    { defId: 'engineer', owner: 0, x: 13, z: 22 },
    { defId: 'tank', owner: 1, x: 24, z: 20 },
  ];
  scenario.players[0].startX = 14;
  scenario.players[0].startZ = 20;
  scenario.players[1].startX = 24;
  scenario.players[1].startZ = 20;
  return scenario;
}

function span(game: Game) {
  return game.state.entities.find((e) => e.kind === 'building' && e.defId === 'bridge')!;
}

function unit(game: Game, defId: string, owner: number) {
  return game.state.entities.find((e) => e.kind === 'unit' && e.defId === defId && e.owner === owner)!;
}

function blockedAt(game: Game, x: number, z: number): number {
  return game.blocked[tileIndex(game.state.map.width, x, z)];
}

describe('road bridge', () => {
  it('carries ground traffic across water while it stands', () => {
    const game = new Game(channelledScenario(), { enableAI: false });
    const tank = unit(game, 'tank', 0);
    game.enqueueCommand({ type: 'move', team: 0, ids: [tank.id], x: 26 * TILE_SIZE, z: 20.5 * TILE_SIZE });
    game.advance(40 * 20);
    // It is on the far bank: no ford on this map, so the only route is the deck.
    expect(tank.x).toBeGreaterThan(22 * TILE_SIZE);
  });

  it('keeps its own tiles out of the blocked grid', () => {
    const game = new Game(channelledScenario(), { enableAI: false });
    expect(blockedAt(game, 18, 20)).toBe(0);
    expect(blockedAt(game, 19, 20)).toBe(0);
  });

  it('drops the deck when shot out, closes the crossing and can be re-decked', () => {
    const game = new Game(channelledScenario(), { enableAI: false });
    const bridge = span(game);
    const gunner = unit(game, 'tank', 1);
    game.enqueueCommand({ type: 'attack', team: 1, ids: [gunner.id], targetId: bridge.id });

    // Anti-structure fire on a 900 hp span; bounded so a stalled engagement
    // fails the test instead of hanging.
    for (let i = 0; i < 60 && bridge.hp > 0; i++) game.advance(40);
    expect(bridge.hp).toBe(0);

    // The wreckage stays on the map and the crossing is closed from both sides.
    expect(game.state.entities).toContain(bridge);
    expect(blockedAt(game, 18, 20)).toBe(1);
    expect(blockedAt(game, 19, 20)).toBe(1);

    const engineer = unit(game, 'engineer', 0);
    game.enqueueCommand({ type: 'repair', team: 0, ids: [engineer.id], targetId: bridge.id });
    for (let i = 0; i < 200 && bridge.hp <= 0; i++) game.advance(20);
    expect(bridge.hp).toBeGreaterThan(0);
    // Traffic can use the span again as soon as the deck is whole enough.
    expect(blockedAt(game, 18, 20)).toBe(0);
    expect(blockedAt(game, 19, 20)).toBe(0);
  });

  it('is authored as a deck, not a wall', () => {
    const def = BUILDINGS.bridge;
    expect(def.walkable).toBe(true);
    expect(def.waterStructure).toBe(true);
    expect(def.footprint.w).toBe(def.footprint.h);
  });
});
