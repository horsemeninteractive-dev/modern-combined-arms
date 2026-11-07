import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/data/scenarioCatalog';
import { BUILDINGS } from '../src/data/buildings';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { clearOreFootprint, createRuntimeMap } from '../src/sim/map';
import { TILE_SIZE } from '../src/sim/constants';
import { Terrain, tileIndex } from '../src/sim/terrain';
import {
  buildPropInstances,
  clearSitesFrom,
  onSite,
  structureRects,
} from '../src/render/terrainMesh';
import type { PropInstance } from '../src/render/gl';

/**
 * Scatter and structures.
 *
 * Scatter is placed by tile and then nudged, and a seam's crystal nodes stand on
 * a ring inside their own tile, so a tile test is not the same question as "is
 * this standing on the paving". Anything that answers that question wrongly
 * shows up as a tree through a hangar or a crystal on a flight line, which is
 * what these suites pin down.
 */

/** The paved ground of every authored structure, in world units. */
function footprintRects(scenario: ReturnType<(typeof SCENARIOS)[number]['create']>) {
  return structureRects(scenario.structures);
}

describe('props on structures', () => {
  it('stages no tree, rock, crystal or brush on a shipped map footprint', () => {
    for (const entry of SCENARIOS) {
      const scenario = entry.create();
      const map = createRuntimeMap(scenario);
      const rects = footprintRects(scenario);
      const props = buildPropInstances(scenario, map.ore, map.maxOre);
      const lists: Array<[string, PropInstance[]]> = [
        ['trees', props.trees],
        ['rocks', props.rocks],
        ['ore', props.ore],
        ['bushes', props.bushes],
        ['shrubs', props.shrubs],
        ['tufts', props.tufts],
        ['fences', props.fences],
        ['lamps', props.lamps],
        ['signs', props.signs],
        ['rubble', props.rubble],
        ['reeds', props.reeds],
        ['poles', props.poles],
      ];
      for (const [kind, list] of lists) {
        const intruders = list.filter((p) => onSite(rects, p.x, p.z));
        expect(intruders.length, `${entry.id}: ${kind} on a structure`).toBe(0);
      }
    }
  });

  it('clears a structure raised during the match out of the staged scatter', () => {
    const scenario = createIslandAssault();
    const props = buildPropInstances(scenario);
    // Stand in for a barracks built mid-match, centred in world units as a live
    // entity carries its position.
    const def = BUILDINGS.barracks;
    const site = {
      defId: 'barracks',
      x: (40 + def.footprint.w / 2) * TILE_SIZE,
      z: (40 + def.footprint.h / 2) * TILE_SIZE,
    };
    const rects = structureRects([site], true);
    expect(rects).toHaveLength(1);
    const inside = props.bushes.filter((p) => onSite(rects, p.x, p.z)).length;
    // Put a prop in the middle of that ground, then take the pad back.
    props.bushes.push({ x: site.x, y: 0, z: site.z, rotation: 0, scale: 1, color: [1, 1, 1] });
    const before = props.bushes.length;
    let removed = 0;
    for (const list of [props.trees, props.bushes, props.tufts, props.rocks]) {
      removed += clearSitesFrom(list, rects);
    }
    expect(props.bushes.length).toBe(before - inside - 1);
    expect(removed).toBeGreaterThanOrEqual(inside + 1);
    // Nothing outside the footprint is touched.
    expect(props.bushes.every((p) => !onSite(rects, p.x, p.z))).toBe(true);
  });

  it('leaves the rest of the map alone', () => {
    const scenario = createIslandAssault();
    const rects = structureRects(scenario.structures);
    const props = buildPropInstances(scenario);
    // A map with no scatter at all would pass the footprint test vacuously, so
    // the fields have to still be furnished.
    expect(props.trees.length + props.bushes.length + props.tufts.length).toBeGreaterThan(200);
    expect(rects.length).toBeGreaterThan(5);
    // Ore seams away from the bases are still staged.
    expect(props.ore.length).toBeGreaterThan(0);
  });
});

type Props = ReturnType<typeof buildPropInstances>;

/** Every instanced scatter batch, as one list. */
function scatter(props: Props): PropInstance[] {
  return [
    ...props.trees,
    ...props.rocks,
    ...props.bushes,
    ...props.shrubs,
    ...props.tufts,
    ...props.fences,
    ...props.lamps,
    ...props.signs,
    ...props.rubble,
    ...props.reeds,
    ...props.poles,
  ];
}

/** A live building's own position, which the renderer carries centred in world units. */
function liveSite(structure: { defId: string; x: number; z: number }) {
  const footprint = BUILDINGS[structure.defId].footprint;
  return {
    defId: structure.defId,
    x: (structure.x + footprint.w / 2) * TILE_SIZE,
    z: (structure.z + footprint.h / 2) * TILE_SIZE,
  };
}

/** The first authored structure whose ground would otherwise carry scenery. */
function furnishedSite(scenario: ReturnType<(typeof SCENARIOS)[number]['create']>) {
  for (const structure of scenario.structures) {
    const def = BUILDINGS[structure.defId];
    if (!def) continue;
    let soft = true;
    for (let dz = 0; dz < def.footprint.h && soft; dz++) {
      for (let dx = 0; dx < def.footprint.w && soft; dx++) {
        const terrain = scenario.tiles[tileIndex(scenario.width, structure.x + dx, structure.z + dz)].t;
        soft =
          terrain === Terrain.Forest ||
          terrain === Terrain.Grass ||
          terrain === Terrain.Farmland ||
          terrain === Terrain.Scrub;
      }
    }
    if (soft) return structure;
  }
  return null;
}

describe('ground a destroyed structure gives back', () => {
  it('grows the scenery back where a structure no longer stands', () => {
    const scenario = createIslandAssault();
    const map = createRuntimeMap(scenario);
    const site = furnishedSite(scenario);
    expect(site, 'a structure on open ground to raze').not.toBeNull();
    const standing = scenario.structures.map(liveSite);
    const index = scenario.structures.indexOf(site!);
    const razed = standing.filter((_, i) => i !== index);
    const rect = structureRects([standing[index]], true);

    const held = buildPropInstances(scenario, map.ore, map.maxOre, standing, standing);
    const freed = buildPropInstances(scenario, map.ore, map.maxOre, razed, razed);

    // While it stands, the footprint is bare — the authored answer.
    expect(scatter(held).filter((p) => onSite(rect, p.x, p.z))).toHaveLength(0);
    // Once it is gone, the landscape takes that square back.
    const grown = scatter(freed).filter((p) => onSite(rect, p.x, p.z));
    expect(grown.length).toBeGreaterThan(0);
    // Nothing is taken from anywhere else: the rebuild only ever adds the
    // scenery the footprint was holding back.
    expect(scatter(freed).length).toBeGreaterThan(scatter(held).length);
  });

  it('takes the ground away again when a structure is raised on it', () => {
    const scenario = createIslandAssault();
    const map = createRuntimeMap(scenario);
    const site = furnishedSite(scenario);
    expect(site, 'a structure on open ground').not.toBeNull();
    const live = liveSite(site!);
    const rect = structureRects([live], true);

    // Nothing holds ground: the landscape as it would be with no buildings at all.
    const open = buildPropInstances(scenario, map.ore, map.maxOre, [], []);
    expect(scatter(open).filter((p) => onSite(rect, p.x, p.z)).length).toBeGreaterThan(0);
    const built = buildPropInstances(scenario, map.ore, map.maxOre, [live], [live]);
    expect(scatter(built).filter((p) => onSite(rect, p.x, p.z))).toHaveLength(0);
  });

  it('still refuses a seam on the ground of a building that is standing', () => {
    const scenario = createIslandAssault();
    const site = furnishedSite(scenario);
    expect(site, 'a structure on open ground').not.toBeNull();
    const def = BUILDINGS[site!.defId];
    const map = createRuntimeMap(scenario);
    // Material under a depot raised against a seam: the simulation sweeps the
    // deposit on placement, but the draw must not depend on that having run.
    for (let dz = 0; dz < def.footprint.h; dz++) {
      for (let dx = 0; dx < def.footprint.w; dx++) {
        map.ore[tileIndex(map.width, site!.x + dx, site!.z + dz)] = 90;
      }
    }
    const live = liveSite(site!);
    const rect = structureRects([live], true);
    const props = buildPropInstances(scenario, map.ore, map.maxOre, [live], [live]);
    expect(props.ore.filter((node) => onSite(rect, node.x, node.z))).toHaveLength(0);
  });
});

describe('deposits under structures', () => {
  it('strips a deposit from the footprint it is given', () => {
    const scenario = createIslandAssault();
    const map = createRuntimeMap(scenario);
    const footprint = BUILDINGS.barracks.footprint;
    // Every tile of the 2x2 holds material.
    for (let dz = 0; dz < footprint.h; dz++) {
      for (let dx = 0; dx < footprint.w; dx++) {
        map.ore[tileIndex(map.width, 30 + dx, 30 + dz)] = 90;
      }
    }
    // A neighbour keeps its own.
    map.ore[tileIndex(map.width, 33, 33)] = 40;
    expect(clearOreFootprint(map, 'barracks', 30, 30)).toBe(footprint.w * footprint.h);
    for (let dz = 0; dz < footprint.h; dz++) {
      for (let dx = 0; dx < footprint.w; dx++) {
        expect(map.ore[tileIndex(map.width, 30 + dx, 30 + dz)]).toBe(0);
      }
    }
    expect(map.ore[tileIndex(map.width, 33, 33)]).toBe(40);
    // Sweeping ground that is already clear is not an error.
    expect(clearOreFootprint(map, 'barracks', 30, 30)).toBe(0);
  });

  it('gives a structure spawned into a running match the ground it stands on', () => {
    const scenario = createIslandAssault();
    // A depot authored on a tile that still holds material, as a mission script
    // might place one: assembly clears it, but this one arrives afterwards.
    const map = createRuntimeMap(scenario);
    const def = BUILDINGS.barracks;
    const spot = { defId: 'barracks', owner: 0, x: 30, z: 30 };
    for (let dz = 0; dz < def.footprint.h; dz++) {
      for (let dx = 0; dx < def.footprint.w; dx++) {
        map.ore[tileIndex(map.width, spot.x + dx, spot.z + dz)] = 120;
      }
    }
    scenario.structures.push(spot);
    const game = new Game(scenario, { enableAI: false });
    const centreX = (spot.x + def.footprint.w / 2) * TILE_SIZE;
    const built = game
      .entitiesOf(0, 'building')
      .find((e) => e.defId === 'barracks' && Math.abs(e.x - centreX) < 1);
    expect(built, 'the structure was raised').toBeDefined();
    for (let dz = 0; dz < def.footprint.h; dz++) {
      for (let dx = 0; dx < def.footprint.w; dx++) {
        expect(game.state.map.ore[tileIndex(game.state.map.width, spot.x + dx, spot.z + dz)]).toBe(0);
      }
    }
  });
});
