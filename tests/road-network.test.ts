import { describe, expect, it } from 'vitest';
import { createScenario, type Scenario } from '../src/sim/scenario';
import { Terrain, TERRAIN, tileIndex } from '../src/sim/terrain';
import { TILE_SIZE } from '../src/sim/constants';
import { buildRoadDetails, roadSegments } from '../src/render/terrainMesh';
import { terrainVisualHeight } from '../src/render/terrainSurface';
import { createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS } from '../src/data/buildings';

function roadTiles(scenario: Scenario): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (let z = 0; z < scenario.height; z++) {
    for (let x = 0; x < scenario.width; x++) {
      if (scenario.tiles[tileIndex(scenario.width, x, z)].t === Terrain.Road) out.push({ x, z });
    }
  }
  return out;
}

describe('road surface conformance', () => {
  it('never sinks a road vertex below the ground it lies on', () => {
    const scenario = createIslandAssault();
    const mesh = buildRoadDetails(scenario);
    expect(mesh.positions.length).toBeGreaterThan(0);
    let sloped = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i];
      const y = mesh.positions[i + 1];
      const z = mesh.positions[i + 2];
      const ground = terrainVisualHeight(scenario, x, z);
      if (Math.abs(ground - Math.round(ground)) > 0.05) sloped++;
      expect(y, `vertex at ${x},${z}`).toBeGreaterThanOrEqual(ground - 1e-6);
      // Nothing floats: a road vertex sits a few centimetres over the ground,
      // never a ribbon's worth of air.
      expect(y - ground, `vertex at ${x},${z}`).toBeLessThan(0.12);
    }
    // The fixture has to actually exercise slopes, or the assertion is vacuous.
    expect(sloped).toBeGreaterThan(0);
  });

  it('builds asphalt on a sloped tile that matches the terrain facet', () => {
    // A single road tile dropped in a step in the terrain, so its corners are
    // averaged across two elevations and both of its triangles are inclined.
    const s = createScenario(8, 8, 'Slope fixture');
    for (let z = 0; z < 8; z++) {
      for (let x = 0; x < 8; x++) s.tiles[tileIndex(s.width, x, z)].e = x < 4 ? 1 : 3;
    }
    s.tiles[tileIndex(s.width, 3, 3)].t = Terrain.Road;
    const mesh = buildRoadDetails(s);
    const ys: number[] = [];
    for (let i = 1; i < mesh.positions.length; i += 3) ys.push(mesh.positions[i]);
    // Four corners at four different heights: the tile is not drawn flat.
    const unique = [...new Set(ys.map((y) => y.toFixed(3)))];
    expect(unique.length).toBeGreaterThan(2);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const ground = terrainVisualHeight(s, mesh.positions[i], mesh.positions[i + 2]);
      expect(mesh.positions[i + 1] - ground).toBeGreaterThanOrEqual(-1e-6);
      expect(mesh.positions[i + 1] - ground).toBeLessThan(0.12);
    }
  });

  it('draws carriageway for a straight run without overlapping duplicate strips', () => {
    const s = createScenario(8, 8, 'Run fixture');
    for (let x = 2; x <= 5; x++) s.tiles[tileIndex(s.width, x, 4)].t = Terrain.Road;
    const mesh = buildRoadDetails(s);
    // Four tiles of two triangles each, before verges and joins.
    expect(roadSegments(s)).toHaveLength(3);
    // The four carriageway tiles plus verges and two wheel-wear ribbons. The
    // ceiling still catches the old per-adjacency strip duplication multiplied
    // by two layers; the road now carries bounded surface detail, not a second
    // road surface for every connection.
    expect(mesh.positions.length / 3).toBeLessThan(340);
  });
});

describe('Kestrel Bay road network', () => {
  const scenario = createIslandAssault();
  const roads = roadTiles(scenario);

  it('keeps every road tile on land', () => {
    for (const t of roads) {
      const terrain = scenario.tiles[tileIndex(scenario.width, t.x, t.z)].t;
      expect(TERRAIN[terrain as keyof typeof TERRAIN].water, `${t.x},${t.z}`).toBe(false);
    }
  });

  it('forms one connected network', () => {
    expect(roads.length).toBeGreaterThan(0);
    const key = (x: number, z: number) => `${x},${z}`;
    const set = new Set(roads.map((t) => key(t.x, t.z)));
    const seen = new Set<string>();
    const start = roads[0];
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      const k = key(cur.x, cur.z);
      if (seen.has(k)) continue;
      seen.add(k);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nk = key(cur.x + dx, cur.z + dz);
          if (set.has(nk) && !seen.has(nk)) queue.push({ x: cur.x + dx, z: cur.z + dz });
        }
      }
    }
    expect(seen.size).toBe(set.size);
  });

  it('keeps the carriageway clear of authored structures', () => {
    for (const s of scenario.structures) {
      const def = BUILDINGS[s.defId];
      for (const t of roads) {
        const inside =
          t.x >= s.x && t.x < s.x + def.footprint.w && t.z >= s.z && t.z < s.z + def.footprint.h;
        expect(inside, `${s.defId} at ${s.x},${s.z} overlaps road ${t.x},${t.z}`).toBe(false);
      }
    }
  });

  it('carries a road through the ridge pass and to every objective', () => {
    const has = (x: number, z: number) =>
      scenario.tiles[tileIndex(scenario.width, x, z)].t === Terrain.Road;
    let pass = 0;
    for (let x = 47; x <= 59; x++) if (has(x, 36) || has(x, 35)) pass++;
    expect(pass).toBeGreaterThanOrEqual(12);

    const near = (x: number, z: number, r: number) =>
      roads.some((t) => Math.abs(t.x - x) <= r && Math.abs(t.z - z) <= r);
    for (const s of scenario.structures) {
      const def = BUILDINGS[s.defId];
      if (!['relay', 'supplyDepot'].includes(s.defId)) continue;
      expect(
        near(s.x + Math.floor(def.footprint.w / 2), s.z + Math.floor(def.footprint.h / 2), 3),
        `${s.defId} at ${s.x},${s.z}`,
      ).toBe(true);
    }
    for (const p of scenario.players) expect(near(p.startX, p.startZ, 3), p.name).toBe(true);
  });

  it('does not pave the whole pass gap', () => {
    // The pass is six tiles deep; the road through it is two lanes, not a slab.
    let paved = 0;
    for (let z = 33; z <= 38; z++) {
      for (let x = 47; x <= 59; x++) {
        if (scenario.tiles[tileIndex(scenario.width, x, z)].t === Terrain.Road) paved++;
      }
    }
    expect(paved).toBeLessThanOrEqual(32);
    expect(paved / TILE_SIZE).toBeGreaterThan(0);
  });

  it('only crosses the ridge through the pass, never over the rock', () => {
    for (const t of roads) {
      const inRidge = t.x >= 48 && t.x <= 58 && t.z >= 17 && t.z <= 47;
      if (!inRidge) continue;
      expect(t.z === 35 || t.z === 36, `road over ridge at ${t.x},${t.z}`).toBe(true);
    }
  });
});
