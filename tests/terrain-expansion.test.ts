import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  OVERLAYS,
  Overlay,
  TERRAIN,
  TERRAIN_GROUPS,
  TERRAIN_IDS,
  TERRAIN_ID_MAX,
  TERRAIN_ORDER,
  Terrain,
  moveCost,
  overlayAllowedOn,
  overlayCostMul,
  overlayDensityOf,
  overlayIdOf,
  overlayLabel,
  packOverlay,
  tileBuildable,
  tileConcealment,
  tileCover,
  tileIndex,
  tileOreAllowed,
  tileSight,
  type TerrainId,
} from '../src/sim/terrain';
import { hasLineOfSight, coverFactor } from '../src/sim/combat';
import { createRuntimeMap } from '../src/sim/map';
import { createScenario, parseScenario, validateScenario } from '../src/sim/scenario';
import { auditCompetitiveMap, auditCompetitiveRoster } from '../src/data/mapValidation';
import { COMPETITIVE_SCENARIO_IDS, scenarioById, SCENARIOS } from '../src/data/scenarioCatalog';
import { BUILDINGS } from '../src/data/buildings';
import { TILE_SIZE } from '../src/sim/constants';
import type { MoveClass } from '../src/sim/types';

const read = (path: string): string => readFileSync(path, 'utf8');

/** A one-tile map whose only tile is the terrain/overlay under test. */
function costOf(terrain: TerrainId, moveClass: MoveClass, overlay = 0): number {
  const tiles = 4;
  const terrainArr = new Uint8Array(tiles).fill(terrain);
  const elevationArr = new Uint8Array(tiles).fill(1);
  const overlayArr = new Uint8Array(tiles).fill(overlay);
  return moveCost(1, tiles, terrainArr, elevationArr, 0, 0, 0, 0, moveClass, overlayArr);
}

describe('terrain catalogue', () => {
  it('carries sixteen base terrains and keeps the original eight ids', () => {
    expect(TERRAIN_IDS).toHaveLength(16);
    expect(TERRAIN_ID_MAX).toBe(15);
    // Ids 0-7 are the shipped eight: renumbering them would repaint every
    // existing scenario, save and network snapshot.
    expect(Terrain.DeepWater).toBe(0);
    expect(Terrain.Urban).toBe(7);
    expect(Terrain.Marsh).toBe(8);
    expect(Terrain.Industrial).toBe(15);
  });

  it('gives every terrain a name, a colour and a full movement table', () => {
    const names = new Set<string>();
    for (const id of TERRAIN_IDS) {
      const props = TERRAIN[id];
      expect(props, `terrain ${id}`).toBeDefined();
      expect(props.id).toBe(id);
      expect(props.name.length).toBeGreaterThan(2);
      expect(props.color).toHaveLength(3);
      for (const cls of ['foot', 'wheeled', 'tracked', 'naval', 'air'] as MoveClass[]) {
        expect(typeof props.costs[cls], `${props.name} ${cls}`).toBe('number');
      }
      names.add(props.name);
    }
    expect(names.size).toBe(16);
  });

  it('paints every terrain exactly once across the grouped palette', () => {
    expect(new Set(TERRAIN_ORDER).size).toBe(16);
    expect([...TERRAIN_ORDER].sort((a, b) => a - b)).toEqual([...TERRAIN_IDS]);
    const grouped = TERRAIN_GROUPS.flatMap((group) => [...group.terrains]);
    expect(new Set(grouped).size).toBe(16);
    expect(TERRAIN_GROUPS.map((group) => group.name)).toEqual([
      'Natural',
      'Agricultural',
      'Surface conditions',
      'Built environment',
      'Water',
    ]);
  });

  it('describes what a tile carries, base and surface together', () => {
    expect(overlayLabel(undefined)).toBe('');
    expect(overlayLabel(packOverlay(Overlay.Crop, 2))).toContain('crop');
    expect(overlayLabel(packOverlay(Overlay.Reeds, 3))).toContain('dense reeds');
    expect(overlayLabel(packOverlay(Overlay.Reeds, 1))).toContain('light reeds');
  });
});

describe('surface layer', () => {
  it('packs an overlay id and density into one byte and reads them back', () => {
    for (const id of [Overlay.Mud, Overlay.Crop, Overlay.Reeds, Overlay.Crater, Overlay.Hedge, Overlay.Snow]) {
      for (const density of [1, 2, 3]) {
        const packed = packOverlay(id, density);
        expect(overlayIdOf(packed)).toBe(id);
        expect(overlayDensityOf(packed)).toBe(density);
        expect(packed).toBeLessThanOrEqual(31);
        expect(OVERLAYS[id].name.length).toBeGreaterThan(2);
      }
    }
  });

  it('leaves the base terrain alone when its ground cannot carry the layer', () => {
    expect(overlayAllowedOn(packOverlay(Overlay.Crop, 2), Terrain.Farmland)).toBe(true);
    expect(overlayAllowedOn(packOverlay(Overlay.Crop, 2), Terrain.Grass)).toBe(true);
    expect(overlayAllowedOn(packOverlay(Overlay.Crop, 2), Terrain.DeepWater)).toBe(false);
    expect(overlayAllowedOn(packOverlay(Overlay.Reeds, 1), Terrain.Marsh)).toBe(true);
    expect(overlayAllowedOn(packOverlay(Overlay.Reeds, 1), Terrain.Road)).toBe(false);
    // Overlays with no restriction (craters, snow) go anywhere.
    expect(overlayAllowedOn(packOverlay(Overlay.Crater, 1), Terrain.Road)).toBe(true);
    // Clearing a layer is always legal: it is the base terrain that remains.
    expect(overlayAllowedOn(0, Terrain.DeepWater)).toBe(true);
  });

  it('scales its movement penalty with density', () => {
    const light = overlayCostMul(packOverlay(Overlay.Mud, 1), 'wheeled');
    const dense = overlayCostMul(packOverlay(Overlay.Mud, 3), 'wheeled');
    expect(light).toBeGreaterThan(1);
    expect(dense).toBeGreaterThan(light);
    expect(overlayCostMul(0, 'wheeled')).toBe(1);
  });
});

describe('movement costs', () => {
  it('makes marsh and mud cost vehicles far more than infantry', () => {
    const marshFoot = costOf(Terrain.Marsh, 'foot');
    const marshWheeled = costOf(Terrain.Marsh, 'wheeled');
    const marshTracked = costOf(Terrain.Marsh, 'tracked');
    expect(marshWheeled).toBeGreaterThan(marshTracked);
    expect(marshTracked).toBeGreaterThan(marshFoot);
    // Infantry cross the fen at a cost, but never at a vehicle's cost.
    expect(marshWheeled / marshFoot).toBeGreaterThan(1.6);

    const mudFoot = costOf(Terrain.Mud, 'foot');
    expect(costOf(Terrain.Mud, 'wheeled') / mudFoot).toBeGreaterThan(1.3);
    expect(costOf(Terrain.Mud, 'tracked')).toBeGreaterThan(mudFoot);
  });

  it('punishes wheels on rock and dunes more than tracks', () => {
    expect(costOf(Terrain.Rocks, 'wheeled')).toBeGreaterThan(costOf(Terrain.Rocks, 'tracked'));
    expect(costOf(Terrain.Dune, 'wheeled')).toBeGreaterThan(costOf(Terrain.Dune, 'tracked'));
    expect(costOf(Terrain.Dune, 'foot')).toBeLessThan(costOf(Terrain.Dune, 'tracked'));
    // Tracks cope better than wheels, but are not immune.
    expect(costOf(Terrain.Rocks, 'tracked')).toBeGreaterThan(costOf(Terrain.Grass, 'tracked'));
  });

  it('keeps industrial hardstanding fast for everyone and scrub slow', () => {
    expect(costOf(Terrain.Industrial, 'wheeled')).toBeLessThan(costOf(Terrain.Grass, 'wheeled'));
    expect(costOf(Terrain.Industrial, 'tracked')).toBeLessThan(costOf(Terrain.Grass, 'tracked'));
    expect(costOf(Terrain.Scrub, 'wheeled')).toBeGreaterThan(costOf(Terrain.Grass, 'wheeled'));
    expect(costOf(Terrain.Farmland, 'tracked')).toBeLessThan(costOf(Terrain.Forest, 'tracked'));
  });

  it('keeps ridges impassable and roads the fastest ground', () => {
    for (const cls of ['foot', 'wheeled', 'tracked'] as MoveClass[]) {
      expect(Number.isFinite(costOf(Terrain.Rock, cls)), cls).toBe(false);
    }
    expect(costOf(Terrain.Road, 'wheeled')).toBeLessThan(costOf(Terrain.Industrial, 'wheeled'));
  });

  it('charges the surface layer on top of the ground underneath it', () => {
    const plain = costOf(Terrain.Grass, 'wheeled');
    const waterlogged = costOf(Terrain.Grass, 'wheeled', packOverlay(Overlay.Mud, 2));
    expect(waterlogged).toBeGreaterThan(plain);
    const crater = costOf(Terrain.Grass, 'wheeled', packOverlay(Overlay.Crater, 1));
    expect(crater).toBeGreaterThan(plain);
    // A layer does not change who may enter the tile, only what it costs.
    expect(Number.isFinite(costOf(Terrain.Grass, 'foot', packOverlay(Overlay.Reeds, 3)))).toBe(true);
    expect(Number.isFinite(costOf(Terrain.DeepWater, 'wheeled', packOverlay(Overlay.Snow, 1)))).toBe(false);
  });
});

describe('cover and concealment stay separate', () => {
  it('gives crops and reeds concealment with no cover', () => {
    const crops = tileConcealment(Terrain.Farmland, packOverlay(Overlay.Crop, 3));
    const cropCover = tileCover(Terrain.Farmland, packOverlay(Overlay.Crop, 3));
    expect(crops).toBeGreaterThan(0.6);
    expect(cropCover).toBeLessThan(0.15);

    const reeds = tileConcealment(Terrain.Marsh, packOverlay(Overlay.Reeds, 3));
    const reedCover = tileCover(Terrain.Marsh, packOverlay(Overlay.Reeds, 3));
    expect(reeds).toBeGreaterThan(0.8);
    expect(reedCover).toBeLessThan(0.2);
  });

  it('gives boulders, hedgerows and craters cover', () => {
    expect(tileCover(Terrain.Rocks, 0)).toBeCloseTo(0.35, 5);
    // A bank at full density is real protection; a thin one is only a scrape.
    expect(tileCover(Terrain.Grass, packOverlay(Overlay.Hedge, 3))).toBeGreaterThan(0.5);
    expect(tileCover(Terrain.Grass, packOverlay(Overlay.Hedge, 1))).toBeGreaterThan(0.2);
    expect(tileCover(Terrain.Grass, packOverlay(Overlay.Crater, 1))).toBeGreaterThan(0.1);
    // Scrub conceals far more than it protects.
    expect(tileConcealment(Terrain.Scrub, 0)).toBeGreaterThan(tileCover(Terrain.Scrub, 0) * 2);
  });

  it('stacks the layer onto the ground without exceeding full concealment', () => {
    const base = tileConcealment(Terrain.Marsh, 0);
    expect(tileConcealment(Terrain.Marsh, packOverlay(Overlay.Reeds, 1))).toBeGreaterThan(base);
    expect(tileConcealment(Terrain.Marsh, packOverlay(Overlay.Reeds, 3))).toBeLessThanOrEqual(1);
    expect(tileCover(Terrain.Urban, packOverlay(Overlay.Hedge, 3))).toBeLessThanOrEqual(1);
  });

  it('only reduces direct fire into infantry, never into vehicles or under shellfire', () => {
    const scenario = createScenario(16, 16);
    scenario.tiles[tileIndex(16, 3, 3)].t = Terrain.Urban;
    const map = createRuntimeMap(scenario);
    const x = 3.5 * TILE_SIZE;
    const z = 3.5 * TILE_SIZE;
    // Direct fire into an urban tile finds cover...
    expect(coverFactor(map, x, z, { indirect: false })).toBeGreaterThan(0.25);
    // ...and indirect fire finds none: it arcs over the wall.
    expect(coverFactor(map, x, z, { indirect: true })).toBe(0);
    // Open ground offers almost none.
    expect(coverFactor(map, 0.5 * TILE_SIZE, 0.5 * TILE_SIZE, { indirect: false })).toBeLessThan(0.12);
  });
});

describe('line of sight', () => {
  function losScenario(line: Array<{ x: number; z: number; t?: TerrainId; v?: number }>): ReturnType<
    typeof createRuntimeMap
  > {
    const scenario = createScenario(16, 16);
    for (const tile of line) {
      const target = scenario.tiles[tileIndex(16, tile.x, tile.z)];
      if (tile.t !== undefined) target.t = tile.t;
      if (tile.v !== undefined) target.v = tile.v;
    }
    return createRuntimeMap(scenario);
  }

  const at = (tile: number): number => (tile + 0.5) * TILE_SIZE;

  it('sees across open ground and one belt of trees', () => {
    const clear = losScenario([]);
    expect(hasLineOfSight(clear, at(1), at(4), at(9), at(4))).toBe(true);
    const single = losScenario([{ x: 5, z: 1, t: Terrain.Forest }]);
    expect(hasLineOfSight(single, at(1), at(4), at(9), at(4))).toBe(true);
  });

  it('closes a line through three soft tiles', () => {
    const belt = losScenario([
      { x: 5, z: 4, t: Terrain.Forest },
      { x: 6, z: 4, t: Terrain.Forest },
      { x: 7, z: 4, t: Terrain.Forest },
    ]);
    expect(hasLineOfSight(belt, at(1), at(4), at(9), at(4))).toBe(false);
    // Scrub obscures the same way canopy does.
    const scrub = losScenario([
      { x: 5, z: 4, t: Terrain.Scrub },
      { x: 6, z: 4, t: Terrain.Scrub },
      { x: 7, z: 4, t: Terrain.Scrub },
    ]);
    expect(hasLineOfSight(scrub, at(1), at(4), at(9), at(4))).toBe(false);
  });

  it('stops at a ridge, at a hedgerow and at boulder fields', () => {
    const ridge = losScenario([{ x: 6, z: 4, t: Terrain.Rock }]);
    expect(hasLineOfSight(ridge, at(1), at(4), at(9), at(4))).toBe(false);
    const hedge = losScenario([{ x: 6, z: 4, t: Terrain.Grass, v: packOverlay(Overlay.Hedge, 1) }]);
    expect(hasLineOfSight(hedge, at(1), at(4), at(9), at(4))).toBe(false);
    const rocks = losScenario([
      { x: 5, z: 4, t: Terrain.Rocks },
      { x: 6, z: 4, t: Terrain.Rocks },
      { x: 7, z: 4, t: Terrain.Rocks },
    ]);
    expect(hasLineOfSight(rocks, at(1), at(4), at(9), at(4))).toBe(false);
    expect(tileSight(Terrain.Rock, 0)).toBeGreaterThanOrEqual(2);
    expect(tileSight(Terrain.Rocks, 0)).toBe(1);
  });
});

describe('construction and deposits', () => {
  it('refuses foundations on marsh, mud, dunes, rock and dense city', () => {
    for (const terrain of [Terrain.Marsh, Terrain.Mud, Terrain.Dune, Terrain.Rocks, Terrain.DenseUrban, Terrain.Rock]) {
      expect(tileBuildable(terrain, 0), TERRAIN[terrain].name).toBe(false);
    }
    for (const terrain of [Terrain.Grass, Terrain.Sand, Terrain.Farmland, Terrain.Urban, Terrain.Industrial]) {
      expect(tileBuildable(terrain, 0), TERRAIN[terrain].name).toBe(true);
    }
  });

  it('lets crops stay buildable while waterlogging and banks do not', () => {
    expect(tileBuildable(Terrain.Farmland, packOverlay(Overlay.Crop, 2))).toBe(true);
    expect(tileBuildable(Terrain.Grass, packOverlay(Overlay.Mud, 1))).toBe(false);
    expect(tileBuildable(Terrain.Grass, packOverlay(Overlay.Hedge, 1))).toBe(false);
  });

  it('keeps deposits off overlays and off ground that cannot hold them', () => {
    expect(tileOreAllowed(Terrain.Grass, 0)).toBe(true);
    expect(tileOreAllowed(Terrain.Dune, 0)).toBe(true);
    expect(tileOreAllowed(Terrain.Grass, packOverlay(Overlay.Crop, 1))).toBe(false);
    expect(tileOreAllowed(Terrain.Marsh, 0)).toBe(false);
    expect(tileOreAllowed(Terrain.Forest, 0)).toBe(false);
  });
});

describe('scenario data', () => {
  it('carries the surface layer through a save/load round trip', () => {
    const scenario = createScenario(32, 32, 'Layer round trip');
    scenario.tiles[tileIndex(32, 4, 5)].t = Terrain.Farmland;
    scenario.tiles[tileIndex(32, 4, 5)].v = packOverlay(Overlay.Crop, 3);
    scenario.tiles[tileIndex(32, 6, 5)].v = packOverlay(Overlay.Crater, 1);
    const reloaded = parseScenario(JSON.parse(JSON.stringify(scenario)));
    expect(reloaded.tiles[tileIndex(32, 4, 5)].t).toBe(Terrain.Farmland);
    expect(reloaded.tiles[tileIndex(32, 4, 5)].v).toBe(packOverlay(Overlay.Crop, 3));
    expect(reloaded.tiles[tileIndex(32, 6, 5)].v).toBe(packOverlay(Overlay.Crater, 1));
    // A tile that never had a layer stays without one, rather than gaining a
    // zero that would change every existing file's serialization.
    expect('v' in reloaded.tiles[tileIndex(32, 9, 9)]).toBe(false);
  });

  it('hands the layer to the runtime map', () => {
    const scenario = createScenario(24, 24);
    scenario.tiles[tileIndex(24, 2, 2)].v = packOverlay(Overlay.Reeds, 2);
    scenario.tiles[tileIndex(24, 2, 2)].t = Terrain.Marsh;
    const map = createRuntimeMap(scenario);
    expect(map.overlay?.[tileIndex(24, 2, 2)]).toBe(packOverlay(Overlay.Reeds, 2));
    expect(map.terrain[tileIndex(24, 2, 2)]).toBe(Terrain.Marsh);
    expect(map.overlay?.length).toBe(24 * 24);
  });

  it('warns when a layer is painted on ground that cannot carry it', () => {
    const scenario = createScenario(24, 24, 'Mismatched layer');
    scenario.tiles[tileIndex(24, 3, 3)].t = Terrain.DeepWater;
    scenario.tiles[tileIndex(24, 3, 3)].v = packOverlay(Overlay.Crop, 2);
    const issues = validateScenario(scenario);
    expect(issues.some((issue) => issue.code === 'overlay-unsupported')).toBe(true);
    expect(issues.find((issue) => issue.code === 'overlay-unsupported')?.severity).toBe('warning');
  });

  it('reports a layer and its ground in the tile description', () => {
    expect(overlayLabel(0)).toBe('');
    expect(overlayLabel(packOverlay(Overlay.Hedge, 1))).toContain('hedgerow');
  });
});

describe('competitive roster after the expansion', () => {
  it('offers seventeen competitive maps and a bespoke theatre per campaign operation', () => {
    expect(COMPETITIVE_SCENARIO_IDS).toHaveLength(17);
    const campaign = SCENARIOS.filter((entry) => !entry.modes.includes('skirmish'));
    expect(campaign).toHaveLength(28);
    for (const id of COMPETITIVE_SCENARIO_IDS) {
      const entry = scenarioById(id)!;
      expect(entry.modes).toEqual(['skirmish', 'multiplayer']);
      expect(entry.width).toBe(entry.height);
    }
  });

  it('uses the expanded terrain across the pool', () => {
    const used = new Set<number>();
    for (const id of COMPETITIVE_SCENARIO_IDS) {
      const scenario = scenarioById(id)!.create();
      for (const tile of scenario.tiles) {
        used.add(tile.t);
        if (tile.v) used.add(100 + overlayIdOf(tile.v));
      }
    }
    // Every new base terrain earns its place on at least one battlefield.
    for (const terrain of [
      Terrain.Marsh,
      Terrain.Mud,
      Terrain.Farmland,
      Terrain.Scrub,
      Terrain.Rocks,
      Terrain.Dune,
      Terrain.DenseUrban,
      Terrain.Industrial,
    ]) {
      expect(used.has(terrain), TERRAIN[terrain].name).toBe(true);
    }
    // And so does every surface layer.
    for (const overlay of [Overlay.Mud, Overlay.Crop, Overlay.Reeds, Overlay.Crater]) {
      expect(used.has(100 + overlay), OVERLAYS[overlay].name).toBe(true);
    }
  });

  it('leaves every competitive map passing its own audit', () => {
    const reports = auditCompetitiveRoster();
    expect(reports).toHaveLength(17);
    for (const report of reports) {
      expect(report.problems, report.diagnostics.id).toEqual([]);
    }
  });

  it('gives every battlefield somewhere for infantry to hold', () => {
    // A map without a single garrisonable shelter turns every infantry fight
    // into an open-field exchange; the roster is meant to read as places, not
    // as the same arena in different colours.
    for (const id of COMPETITIVE_SCENARIO_IDS) {
      const scenario = scenarioById(id)!.create();
      const shelters = scenario.structures.filter((s) => BUILDINGS[s.defId]?.garrison);
      expect(shelters.length, id).toBeGreaterThan(0);
      // Stamped four times, so the count is a multiple of the quadrant stamp.
      expect(shelters.length % 4, id).toBe(0);
    }
  });

  it('keeps the expanded terrain reachable and buildable on the maps that use it', () => {
    for (const id of COMPETITIVE_SCENARIO_IDS) {
      const entry = scenarioById(id)!;
      const report = auditCompetitiveMap(entry);
      expect(report.problems, id).toEqual([]);
      const scenario = entry.create();
      // Every slot stands on ground a base can actually be founded on.
      for (const slot of scenario.slots ?? []) {
        const tile = scenario.tiles[tileIndex(scenario.width, slot.x, slot.z)];
        expect(tileBuildable(tile.t, tile.v ?? 0), `${id} slot ${slot.x},${slot.z}`).toBe(true);
      }
    }
  });
});

describe('Scenario Forge wiring', () => {
  it('exposes the grouped palette, the surface brushes and their notes', () => {
    const editor = read('src/ui/editor.ts');
    expect(editor).toContain('TERRAIN_GROUPS');
    expect(editor).toContain('OVERLAY_PALETTE');
    expect(editor).toContain("data-overlay=");
    expect(editor).toContain("toolBtn('overlayClear'");
    expect(editor).toContain('ed-overlay-density');
    expect(editor).toContain('packOverlay(this.overlayId, this.overlayDensity)');
    expect(editor).toContain('overlayAllowedOn(packed, tile.t)');
    // The tool the overlay brush uses must be reachable from the tool row.
    expect(editor).toContain("this.toolBtn('overlayClear', 'erase', 'UNLAY')");
  });

  it('previews the layer in its own colour and names it under the cursor', () => {
    const render = read('src/ui/editorRender.ts');
    expect(render).toContain('overlayTint');
    expect(render).toContain('overlayLabel(tile.v)');
  });

  it('tints the ground mesh with the layer instead of replacing the terrain', () => {
    const mesh = read('src/render/terrainMesh.ts');
    expect(mesh).toContain('function surfaceColor');
    expect(mesh).toContain('surfaceColor(terrain, tile.v ?? 0)');
    expect(mesh).toContain('OVERLAYS');
  });
});
