import { describe, expect, it } from 'vitest';
import { createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS } from '../src/data/buildings';
import { ELEVATION_HEIGHT, MAX_ELEVATION, TILE_SIZE } from '../src/sim/constants';
import { Terrain, TERRAIN, tileIndex, type TerrainId } from '../src/sim/terrain';
import {
  ORE_NODES_PER_TILE,
  buildPropInstances,
  buildTerrainGeometry,
  oreNodesInTile,
} from '../src/render/terrainMesh';
import { terrainCornerHeight } from '../src/render/terrainSurface';
import { buildBushMesh, buildOreMesh, buildShrubMesh } from '../src/render/geometry';
import { MATERIAL } from '../src/render/materials';

const scenario = createIslandAssault();
const W = scenario.width;
const H = scenario.height;

function tileAt(x: number, z: number) {
  return scenario.tiles[tileIndex(W, x, z)];
}

function tileOf(worldX: number, worldZ: number) {
  return { x: Math.floor(worldX / TILE_SIZE), z: Math.floor(worldZ / TILE_SIZE) };
}

function isWater(x: number, z: number): boolean {
  return TERRAIN[tileAt(x, z).t as TerrainId].water;
}

/** Every tile covered by an authored structure, so props can be kept out. */
const footprint = new Uint8Array(W * H);
for (const structure of scenario.structures) {
  const def = BUILDINGS[structure.defId];
  if (!def) continue;
  for (let dz = 0; dz < def.footprint.h; dz++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const x = structure.x + dx;
      const z = structure.z + dz;
      if (x >= 0 && z >= 0 && x < W && z < H) footprint[tileIndex(W, x, z)] = 1;
    }
  }
}

describe('material deposits', () => {
  it('are faceted gold crystal nodes, not a tree-sized cone fan', () => {
    const mesh = buildOreMesh();
    const ys: number[] = [];
    for (let i = 1; i < mesh.positions.length; i += 3) ys.push(mesh.positions[i]);
    // A node is a single shard: five of them fill a tile, so one must not stand
    // tall enough to pass for a tree.
    expect(Math.max(...ys)).toBeGreaterThan(1.0);
    expect(Math.max(...ys)).toBeLessThan(1.35);
    expect(Math.min(...ys)).toBeLessThan(0);
    // Crystal, not painted metal: the facets need the glossy material to read.
    expect(new Set(mesh.materials)).toEqual(new Set([MATERIAL.glass]));
  });

  it('stands five nodes in an ore tile, one for each fifth of the seam', () => {
    const ore = new Uint16Array(W * H);
    const maxOre = new Uint16Array(W * H);
    let tile = -1;
    for (let i = 0; i < scenario.tiles.length; i++) {
      if (scenario.tiles[i].o > 0) {
        tile = i;
        break;
      }
    }
    expect(tile).toBeGreaterThanOrEqual(0);
    maxOre[tile] = 500;
    ore[tile] = 500;
    const full = buildPropInstances(scenario, ore, maxOre).ore;
    expect(full).toHaveLength(ORE_NODES_PER_TILE);
    // One pool of ground glow per seam, not one per node.
    expect(full.filter((node) => node.glow > 0)).toHaveLength(1);
    // The nodes sit inside their own tile instead of spilling into a neighbour.
    const tx = tile % W;
    const tz = Math.floor(tile / W);
    for (const node of full) {
      expect(node.x).toBeGreaterThan(tx * TILE_SIZE);
      expect(node.x).toBeLessThan((tx + 1) * TILE_SIZE);
      expect(node.z).toBeGreaterThan(tz * TILE_SIZE);
      expect(node.z).toBeLessThan((tz + 1) * TILE_SIZE);
    }

    // 20% gathered is exactly one node gone.
    ore[tile] = 400;
    expect(buildPropInstances(scenario, ore, maxOre).ore).toHaveLength(4);

    // 10% gathered leaves the fifth node standing at half its size.
    ore[tile] = 450;
    const half = buildPropInstances(scenario, ore, maxOre).ore;
    expect(half).toHaveLength(5);
    const shares = half.map((node) => node.scale);
    const smallest = Math.min(...shares) / Math.max(...shares);
    // Half a node left, plus the per-node size jitter of a tenth either way.
    expect(smallest).toBeGreaterThan(0.4);
    expect(smallest).toBeLessThan(0.62);

    // A fully mined tile leaves no crystal behind.
    ore[tile] = 0;
    expect(buildPropInstances(scenario, ore, maxOre).ore).toHaveLength(0);
  });

  it('leaves the last standing node as the one being cut', () => {
    let tile = -1;
    for (let i = 0; i < scenario.tiles.length; i++) {
      if (scenario.tiles[i].o > 0) {
        tile = i;
        break;
      }
    }
    const x = tile % W;
    const z = Math.floor(tile / W);
    // Ten per cent already taken: four nodes are whole, the fifth is half cut.
    const nodes = oreNodesInTile(scenario, x, z, 450, 500);
    expect(nodes).toHaveLength(5);
    for (const node of nodes.slice(0, -1)) expect(node.share).toBe(1);
    const cutting = nodes[nodes.length - 1];
    expect(cutting.share).toBeCloseTo(0.5, 5);
    expect(cutting.scale).toBeLessThan(nodes[0].scale * 0.62);
    // A whole fifth gone leaves the next node as the target, not a ghost.
    const after = oreNodesInTile(scenario, x, z, 390, 500);
    expect(after).toHaveLength(4);
    expect(after[after.length - 1].share).toBeCloseTo(0.9, 5);
  });
});

describe('battlefield props', () => {
  const props = buildPropInstances(scenario);

  it('is deterministic for the same scenario', () => {
    const again = buildPropInstances(createIslandAssault());
    expect(again.bushes).toEqual(props.bushes);
    expect(again.shrubs).toEqual(props.shrubs);
    expect(again.tufts).toEqual(props.tufts);
    expect(again.fences).toEqual(props.fences);
    expect(again.lamps).toEqual(props.lamps);
  });

  it('decorates the island with mixed scrub, boundary fencing and street lamps', () => {
    expect(props.bushes.length).toBeGreaterThan(80);
    expect(props.shrubs.length).toBeGreaterThan(20);
    expect(props.tufts.length).toBeGreaterThan(80);
    expect(props.fences.length).toBeGreaterThan(20);
    expect(props.lamps.length).toBeGreaterThan(5);
  });

  it('keeps scrub on open ground and off deposits and structures', () => {
    for (const bush of props.bushes) {
      const { x, z } = tileOf(bush.x, bush.z);
      const tile = tileAt(x, z);
      const terrain = tile.t as TerrainId;
      expect(terrain === Terrain.Grass || terrain === Terrain.Sand).toBe(true);
      expect(tile.o).toBe(0);
      expect(footprint[tileIndex(W, x, z)]).toBe(0);
    }
  });

  it('runs every fence along a field edge beside a road', () => {
    for (const fence of props.fences) {
      const { x, z } = tileOf(fence.x, fence.z);
      const tile = tileAt(x, z);
      expect(tile.t as TerrainId).toBe(Terrain.Grass);
      expect(footprint[tileIndex(W, x, z)]).toBe(0);
      // A quarter-turned fence runs with a north/south road; an unrotated one
      // runs with an east/west road.
      const alongX = Math.abs(fence.rotation) < 0.001;
      const roadX = tileAt(x + 1, z).t === Terrain.Road || tileAt(x - 1, z).t === Terrain.Road;
      const roadZ = tileAt(x, z + 1).t === Terrain.Road || tileAt(x, z - 1).t === Terrain.Road;
      expect(alongX ? roadZ : roadX).toBe(true);
    }
  });

  it('stands lamps on the carriageway with an aim across the kerb', () => {
    for (const lamp of props.lamps) {
      const { x, z } = tileOf(lamp.x, lamp.z);
      expect(tileAt(x, z).t as TerrainId).toBe(Terrain.Road);
      const neighbours = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const;
      const kerb = neighbours.some(
        ([dx, dz]) =>
          !isWater(x + dx, z + dz) && tileAt(x + dx, z + dz).t !== Terrain.Road,
      );
      expect(kerb).toBe(true);
      expect(Number.isFinite(lamp.rotation)).toBe(true);
    }
  });
});

describe('elevation ceiling', () => {
  it('supports mountains rather than the old two-height ground', () => {
    expect(MAX_ELEVATION).toBeGreaterThanOrEqual(8);
    expect(MAX_ELEVATION * ELEVATION_HEIGHT).toBeGreaterThan(TILE_SIZE * 2);
  });

  it('lifts a plateau to the full authored height', () => {
    const raised = createIslandAssault();
    // The first all-land 2x2 block away from water and roads.
    let found: { x: number; z: number } | null = null;
    for (let z = 1; z < H - 2 && !found; z++) {
      for (let x = 1; x < W - 2; x++) {
        const block = [
          [x, z],
          [x + 1, z],
          [x, z + 1],
          [x + 1, z + 1],
        ] as const;
        const usable = block.every(([bx, bz]) => {
          const tile = raised.tiles[tileIndex(W, bx, bz)];
          return !TERRAIN[tile.t as TerrainId].water && tile.t !== Terrain.Road;
        });
        if (usable) {
          found = { x, z };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    const { x, z } = found!;
    for (const [bx, bz] of [
      [x, z],
      [x + 1, z],
      [x, z + 1],
      [x + 1, z + 1],
    ] as const) {
      raised.tiles[tileIndex(W, bx, bz)].e = MAX_ELEVATION;
    }
    // The corner inside the block touches only raised tiles, so it reaches the
    // full height instead of being averaged back down.
    expect(terrainCornerHeight(raised, x + 1, z + 1)).toBeCloseTo(
      MAX_ELEVATION * ELEVATION_HEIGHT,
      5,
    );

    const geometry = buildTerrainGeometry(raised);
    let highest = 0;
    for (let i = 1; i < geometry.positions.length; i += 3) {
      highest = Math.max(highest, geometry.positions[i]);
    }
    expect(highest).toBeCloseTo(MAX_ELEVATION * ELEVATION_HEIGHT, 1);
  });
});

describe('vegetation readability', () => {
  const props = buildPropInstances(createIslandAssault());

  /** Colour families, bucketed by the ratio of green to the other channels. */
  function family(color: readonly [number, number, number]): string {
    const total = color[0] + color[1] + color[2] || 1;
    return `${(color[0] / total).toFixed(2)}|${(color[1] / total).toFixed(2)}`;
  }

  it('lifts scrub above the field instead of leaving black spots', () => {
    // Foliage only: the woody stem of a bush is allowed to stay dark.
    const foliageLuma = (colors: Float32Array): number[] => {
      const out: number[] = [];
      for (let i = 0; i < colors.length; i += 3) {
        const r = colors[i];
        const g = colors[i + 1];
        const b = colors[i + 2];
        if (!(g > r && g > b)) continue;
        out.push(r * 0.299 + g * 0.587 + b * 0.114);
      }
      return out;
    };
    const bush = foliageLuma(buildBushMesh().colors);
    expect(bush.length).toBeGreaterThan(0);
    // The old ramp started at 0.12 and read as a hole in the grass. Every
    // foliage vertex now clears a readable value while keeping a shaded base
    // and a lit crown.
    expect(Math.min(...bush)).toBeGreaterThan(0.16);
    expect(Math.max(...bush)).toBeGreaterThan(0.4);
    expect(Math.max(...bush)).toBeLessThan(0.75);

    const shrub = foliageLuma(buildShrubMesh().colors);
    expect(shrub.length).toBeGreaterThan(0);
    expect(Math.min(...shrub)).toBeGreaterThan(0.16);
  });

  it('scatters more than one green family across the brush', () => {
    const families = new Set<string>();
    for (const bush of props.bushes) families.add(family(bush.color));
    const shrubs = new Set<string>();
    for (const shrub of props.shrubs) shrubs.add(family(shrub.color));
    // Three authored families means a thicket mixes tones rather than
    // stamping one repeated dot across the field.
    expect(families.size).toBeGreaterThanOrEqual(3);
    expect(shrubs.size).toBeGreaterThanOrEqual(3);
    // Green still leads in every family: these are green variants, not a
    // recolour of the terrain.
    for (const bush of props.bushes) expect(bush.color[1]).toBeGreaterThan(bush.color[2]);
  });
});
