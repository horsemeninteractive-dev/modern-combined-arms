import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';
import {
  SHORE_LEVEL,
  WATER_LEVEL,
  terrainCornerHeight,
  terrainSurfaceHeight,
  terrainVisualHeight,
  pickTerrain,
} from '../src/render/terrainSurface';
import { constructionGridVisible } from '../src/render/gridVisibility';
import { buildTerrainGeometry } from '../src/render/terrainMesh';
import { createIslandAssault } from '../src/data/scenarios';
import { createScenario, type Scenario } from '../src/sim/scenario';
import { Terrain, TERRAIN, inBounds, tileIndex, type TerrainId } from '../src/sim/terrain';
import { ELEVATION_HEIGHT, TILE_SIZE } from '../src/sim/constants';

function camera(): Camera {
  const cam = new Camera();
  cam.setViewport(1280, 720);
  cam.setMap(16, 16);
  cam.centerOn(32, 32);
  cam.setZoom(40);
  return cam;
}

function scenario(): Scenario {
  return createScenario(16, 16, 'Picking fixture');
}

function setBlock(s: Scenario, x0: number, z0: number, x1: number, z1: number, e: number): void {
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      if (!inBounds(s.width, s.height, x, z)) continue;
      s.tiles[tileIndex(s.width, x, z)].e = e;
    }
  }
}

function pickWorld(s: Scenario, cam: Camera, x: number, z: number, y = terrainVisualHeight(s, x, z)) {
  const screen = cam.worldToScreen(x, y, z);
  return pickTerrain(s, cam.screenRay(screen.x, screen.y));
}

describe('sloped terrain surface', () => {
  it('keeps flat ground at its elevation', () => {
    const s = scenario();
    expect(terrainSurfaceHeight(s, 32, 32)).toBeCloseTo(ELEVATION_HEIGHT, 6);
    expect(terrainSurfaceHeight(s, 8, 40)).toBeCloseTo(ELEVATION_HEIGHT, 6);
  });

  it('builds a ramp between different tile heights and stays continuous', () => {
    const s = scenario();
    setBlock(s, 4, 4, 11, 11, 3);
    expect(terrainSurfaceHeight(s, 32, 32)).toBeCloseTo(3 * ELEVATION_HEIGHT, 6);
    const edgeCorner = terrainCornerHeight(s, 4, 8);
    expect(edgeCorner).toBeCloseTo(2 * ELEVATION_HEIGHT, 6);
    expect(terrainSurfaceHeight(s, 16, 32)).toBeCloseTo(edgeCorner, 6);
    // Approaching the same boundary from either tile converges on one height.
    const lowSide = terrainSurfaceHeight(s, 15.99, 32);
    const highSide = terrainSurfaceHeight(s, 16.01, 32);
    expect(Math.abs(lowSide - highSide)).toBeLessThan(0.02);
    expect(lowSide).toBeGreaterThan(terrainSurfaceHeight(s, 12, 32));
    expect(highSide).toBeGreaterThan(edgeCorner);
  });

  it('ramps shoreline corners just under the water plane instead of into it', () => {
    const s = scenario();
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 4; x++) s.tiles[tileIndex(s.width, x, z)].t = Terrain.ShallowWater;
    }
    // A shared plane is what made every coast z-fight: the land edge must finish
    // below the sea surface, close enough to read as a waterline.
    const shore = terrainCornerHeight(s, 4, 8);
    expect(shore).toBeLessThan(WATER_LEVEL);
    expect(shore).toBeGreaterThan(WATER_LEVEL - 0.1);
    expect(terrainVisualHeight(s, 8, 32)).toBeCloseTo(WATER_LEVEL, 6);
    expect(TERRAIN[Terrain.ShallowWater].buildable).toBe(false);
  });
});

describe('terrain ray picking', () => {
  it('hits the same world point that was projected on flat ground', () => {
    const s = scenario();
    const cam = camera();
    const hit = pickWorld(s, cam, 32, 32);
    expect(hit).not.toBeNull();
    if (!hit) return;
    expect(hit.x).toBeCloseTo(32, 3);
    expect(hit.z).toBeCloseTo(32, 3);
    expect(hit.y).toBeCloseTo(ELEVATION_HEIGHT, 3);
    expect(hit.tileX).toBe(8);
    expect(hit.tileZ).toBe(8);
    expect(hit.water).toBe(false);
  });

  it('resolves elevated ground and both slope triangles', () => {
    const s = scenario();
    setBlock(s, 4, 4, 11, 11, 3);
    const cam = camera();
    const plateau = pickWorld(s, cam, 34, 30);
    expect(plateau?.y).toBeCloseTo(3 * ELEVATION_HEIGHT, 3);
    // Points on either side of the tile diagonal must agree with the surface.
    for (const [x, z] of [[21.5, 20.5], [22.8, 20.4], [20.3, 22.9]]) {
      const y = terrainSurfaceHeight(s, x, z);
      const hit = pickWorld(s, cam, x, z, y);
      expect(hit).not.toBeNull();
      if (!hit) continue;
      expect(hit.x).toBeCloseTo(x, 2);
      expect(hit.z).toBeCloseTo(z, 2);
      expect(hit.y).toBeCloseTo(y, 2);
    }
  });

  it('keeps working after panning and zooming', () => {
    const s = scenario();
    setBlock(s, 4, 4, 11, 11, 2);
    const cam = camera();
    cam.setZoom(58);
    cam.centerOn(24, 28);
    const hit = pickWorld(s, cam, 22, 26);
    expect(hit).not.toBeNull();
    if (!hit) return;
    expect(hit.x).toBeCloseTo(22, 2);
    expect(hit.z).toBeCloseTo(26, 2);
    expect(hit.y).toBeCloseTo(terrainSurfaceHeight(s, 22, 26), 2);
  });

  it('returns the flat water plane and its tile', () => {
    const s = scenario();
    for (const tile of s.tiles) {
      tile.t = Terrain.ShallowWater;
      tile.e = 0;
    }
    const cam = camera();
    const hit = pickWorld(s, cam, 32, 32, WATER_LEVEL);
    expect(hit).not.toBeNull();
    if (!hit) return;
    expect(hit.water).toBe(true);
    expect(hit.y).toBeCloseTo(WATER_LEVEL, 6);
    expect(hit.tileX).toBe(8);
    expect(hit.tileZ).toBe(8);
  });

  it('returns null for rays that miss the map or point upward', () => {
    const s = scenario();
    expect(pickTerrain(s, { origin: [-20, 50, -20], direction: [0, -1, 0] })).toBeNull();
    expect(pickTerrain(s, { origin: [32, 50, 32], direction: [0, 1, 0] })).toBeNull();
    expect(pickTerrain(s, { origin: [32, 50, 32], direction: [0, 0, 0] })).toBeNull();
  });

  it('clamps tile indices at the map boundary without falling back outside', () => {
    const s = scenario();
    const cam = camera();
    const hit = pickWorld(s, cam, TILE_SIZE / 2, TILE_SIZE / 2);
    expect(hit).not.toBeNull();
    if (!hit) return;
    expect(hit.tileX).toBe(0);
    expect(hit.tileZ).toBe(0);
    expect(hit.x).toBeGreaterThanOrEqual(0);
    expect(hit.z).toBeGreaterThanOrEqual(0);
  });
});

describe('rendered terrain geometry', () => {
  it('draws the sloped surface that picking samples, apart from the shoreline step', () => {
    const s = createIslandAssault();
    const geo = buildTerrainGeometry(s);
    // The one deliberate disagreement is the shoreline: the mesh finishes the
    // land ramp just under the sea plane so the two are never coplanar, while a
    // sample taken inside a water tile still answers with the sea plane. Every
    // other vertex must match the picked surface exactly.
    const step = WATER_LEVEL - SHORE_LEVEL;
    let onLand = 0;
    let onCoast = 0;
    for (let i = 0; i < geo.positions.length; i += 3) {
      const x = geo.positions[i];
      const y = geo.positions[i + 1];
      const z = geo.positions[i + 2];
      const tx = Math.min(s.width - 1, Math.max(0, Math.floor(x / TILE_SIZE)));
      const tz = Math.min(s.height - 1, Math.max(0, Math.floor(z / TILE_SIZE)));
      const wet = TERRAIN[s.tiles[tileIndex(s.width, tx, tz)].t as TerrainId].water;
      const delta = Math.abs(y - terrainVisualHeight(s, x, z));
      if (wet) {
        // A vertex at a corner the sea shares with land: the sampled point is on
        // the water plane, the drawn corner is on the waterline ramp.
        expect(delta, `coast vertex ${x},${z}`).toBeLessThanOrEqual(step + 0.03);
        onCoast++;
        continue;
      }
      expect(delta, `vertex ${x},${z}`).toBeLessThan(1e-3);
      onLand++;
    }
    expect(onCoast).toBeGreaterThan(0);
    expect(onLand).toBeGreaterThan(onCoast);
  });

  it('ramps between elevations instead of stacking vertical steps', () => {
    const s = createIslandAssault();
    const geo = buildTerrainGeometry(s);
    let sloped = 0;
    for (let i = 0; i < geo.indices.length; i += 3) {
      const a = geo.indices[i] * 3;
      const b = geo.indices[i + 1] * 3;
      const c = geo.indices[i + 2] * 3;
      const ys = [geo.positions[a + 1], geo.positions[b + 1], geo.positions[c + 1]];
      const drop = Math.max(...ys) - Math.min(...ys);
      // No facet may jump more than the largest authored height step; a
      // vertical wall would show up as a degenerate footprint with a big drop.
      expect(drop).toBeLessThanOrEqual(3 * ELEVATION_HEIGHT);
      if (drop > 0.05) {
        const foot = Math.max(
          Math.hypot(geo.positions[a] - geo.positions[b], geo.positions[a + 2] - geo.positions[b + 2]),
          Math.hypot(geo.positions[b] - geo.positions[c], geo.positions[b + 2] - geo.positions[c + 2]),
          Math.hypot(geo.positions[c] - geo.positions[a], geo.positions[c + 2] - geo.positions[a + 2]),
        );
        expect(foot).toBeGreaterThan(0.5);
        sloped++;
      }
    }
    expect(sloped).toBeGreaterThan(0);
  });
});

describe('construction grid visibility', () => {
  it('is absent in ordinary play and present only while placing', () => {
    expect(constructionGridVisible('battle', 'none')).toBe(false);
    expect(constructionGridVisible('battle', 'attack')).toBe(false);
    expect(constructionGridVisible('battle', 'place')).toBe(true);
    expect(constructionGridVisible('menu', 'none')).toBe(false);
    expect(constructionGridVisible('editor', 'none')).toBe(false);
  });
});
