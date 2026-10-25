import { ELEVATION_HEIGHT, TILE_SIZE } from '../sim/constants';
import { TERRAIN, inBounds, tileIndex, type TerrainId } from '../sim/terrain';
import type { Scenario } from '../sim/scenario';
import type { Vec3 } from './math';

/** Flat water surface; land slopes meet this plane at the shoreline. */
export const WATER_LEVEL = 0.12;

const EPSILON = 1e-6;

export interface TerrainRay {
  origin: Vec3;
  direction: Vec3;
}

export interface TerrainHit {
  x: number;
  z: number;
  y: number;
  tileX: number;
  tileZ: number;
  water: boolean;
}

/**
 * Height at a grid corner, averaged from the up-to-four tiles touching it.
 * This is the single source of truth for the rendered slope surface: the
 * terrain mesh, props, entities, editor overlays and picking all sample it.
 */
export function terrainCornerHeight(scenario: Scenario, cornerX: number, cornerZ: number): number {
  let sum = 0;
  let count = 0;
  let touchesWater = false;
  for (let z = cornerZ - 1; z <= cornerZ; z++) {
    for (let x = cornerX - 1; x <= cornerX; x++) {
      if (!inBounds(scenario.width, scenario.height, x, z)) continue;
      const tile = scenario.tiles[tileIndex(scenario.width, x, z)];
      if (!tile) continue;
      sum += tile.e;
      count++;
      if (TERRAIN[tile.t as TerrainId]?.water) touchesWater = true;
    }
  }
  if (count === 0) return 0;
  // Shoreline corners meet the water plane so the land ramps into the sea
  // instead of leaving a cliff gap against the translucent water surface.
  if (touchesWater) return WATER_LEVEL;
  return (sum / count) * ELEVATION_HEIGHT;
}

/**
 * Height of the sloped land surface at a world position. Each terrain tile is
 * split along the (x0,z0)-(x1,z1) diagonal exactly as the mesh is built, so a
 * sampled height agrees with the visible triangle under the point.
 */
export function terrainSurfaceHeight(scenario: Scenario, x: number, z: number): number {
  const worldW = scenario.width * TILE_SIZE;
  const worldH = scenario.height * TILE_SIZE;
  if (x < 0 || z < 0 || x > worldW || z > worldH) return 0;
  const tx = Math.min(scenario.width - 1, Math.floor(x / TILE_SIZE));
  const tz = Math.min(scenario.height - 1, Math.floor(z / TILE_SIZE));
  const tile = scenario.tiles[tileIndex(scenario.width, tx, tz)];
  if (TERRAIN[tile.t as TerrainId]?.water) return 0;
  const u = Math.min(1, Math.max(0, x / TILE_SIZE - tx));
  const v = Math.min(1, Math.max(0, z / TILE_SIZE - tz));
  const h00 = terrainCornerHeight(scenario, tx, tz);
  const h10 = terrainCornerHeight(scenario, tx + 1, tz);
  const h01 = terrainCornerHeight(scenario, tx, tz + 1);
  const h11 = terrainCornerHeight(scenario, tx + 1, tz + 1);
  if (v >= u) {
    // Triangle (x0,z0)-(x1,z1)-(x0,z1).
    return h00 + (h01 - h00) * v + (h11 - h01) * u;
  }
  // Triangle (x0,z0)-(x1,z0)-(x1,z1).
  return h00 + (h10 - h00) * u + (h11 - h10) * v;
}

/** Surface height including the flat water plane, for overlays and outlines. */
export function terrainVisualHeight(scenario: Scenario, x: number, z: number): number {
  const tx = Math.floor(x / TILE_SIZE);
  const tz = Math.floor(z / TILE_SIZE);
  if (!inBounds(scenario.width, scenario.height, tx, tz)) return 0;
  const tile = scenario.tiles[tileIndex(scenario.width, tx, tz)];
  if (TERRAIN[tile.t as TerrainId]?.water) return WATER_LEVEL;
  return terrainSurfaceHeight(scenario, x, z);
}

function triangleHit(
  origin: Vec3,
  direction: Vec3,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const denominator = nx * direction[0] + ny * direction[1] + nz * direction[2];
  if (Math.abs(denominator) < EPSILON) return NaN;
  const t =
    (nx * (ax - origin[0]) + ny * (ay - origin[1]) + nz * (az - origin[2])) /
    denominator;
  if (!Number.isFinite(t)) return NaN;

  const px = origin[0] + direction[0] * t;
  const pz = origin[2] + direction[2] * t;
  const v0x = bx - ax;
  const v0z = bz - az;
  const v1x = cx - ax;
  const v1z = cz - az;
  const v2x = px - ax;
  const v2z = pz - az;
  const area = v0x * v1z - v1x * v0z;
  if (Math.abs(area) < EPSILON) return NaN;
  const v = (v2x * v1z - v1x * v2z) / area;
  const w = (v0x * v2z - v2x * v0z) / area;
  const u = 1 - v - w;
  if (u < -EPSILON || v < -EPSILON || w < -EPSILON) return NaN;
  return t;
}

/**
 * Intersect an orthographic view ray with the sloped terrain or flat water
 * surface. Returns null rather than a fallback point when the ray misses the
 * map, so callers can decline an order instead of issuing it somewhere wrong.
 */
export function pickTerrain(scenario: Scenario, ray: TerrainRay): TerrainHit | null {
  const origin = ray.origin;
  const direction = ray.direction;
  if (
    !Number.isFinite(origin[0]) ||
    !Number.isFinite(origin[1]) ||
    !Number.isFinite(origin[2]) ||
    !Number.isFinite(direction[0]) ||
    !Number.isFinite(direction[1]) ||
    !Number.isFinite(direction[2]) ||
    direction[1] > -EPSILON
  ) {
    return null;
  }

  const worldW = scenario.width * TILE_SIZE;
  const worldH = scenario.height * TILE_SIZE;

  // Clip the ray to the map's XZ rectangle.
  let tEnter = 0;
  let tExit = Infinity;
  for (const [o, d, size] of [
    [origin[0], direction[0], worldW],
    [origin[2], direction[2], worldH],
  ] as const) {
    if (Math.abs(d) < EPSILON) {
      if (o < 0 || o > size) return null;
      continue;
    }
    let a = (0 - o) / d;
    let b = (size - o) / d;
    if (a > b) [a, b] = [b, a];
    tEnter = Math.max(tEnter, a);
    tExit = Math.min(tExit, b);
  }

  let maxElevation = 0;
  for (const tile of scenario.tiles) {
    if (tile.e > maxElevation) maxElevation = tile.e;
  }
  const ceiling = Math.max(WATER_LEVEL, maxElevation * ELEVATION_HEIGHT) + 0.001;
  const tCeiling = (ceiling - origin[1]) / direction[1];
  tEnter = Math.max(tEnter, tCeiling);
  const tWater = (WATER_LEVEL - origin[1]) / direction[1];
  tExit = Math.min(tExit, tWater);
  if (tEnter > tExit + EPSILON) return null;

  let t = Math.max(0, tEnter);
  const startX = origin[0] + direction[0] * t;
  const startZ = origin[2] + direction[2] * t;
  let tileX = Math.max(0, Math.min(scenario.width - 1, Math.floor(startX / TILE_SIZE)));
  let tileZ = Math.max(0, Math.min(scenario.height - 1, Math.floor(startZ / TILE_SIZE)));
  const stepX = direction[0] > EPSILON ? 1 : direction[0] < -EPSILON ? -1 : 0;
  const stepZ = direction[2] > EPSILON ? 1 : direction[2] < -EPSILON ? -1 : 0;
  let tMaxX =
    stepX === 0
      ? Infinity
      : ((stepX > 0 ? (tileX + 1) * TILE_SIZE : tileX * TILE_SIZE) - origin[0]) / direction[0];
  let tMaxZ =
    stepZ === 0
      ? Infinity
      : ((stepZ > 0 ? (tileZ + 1) * TILE_SIZE : tileZ * TILE_SIZE) - origin[2]) / direction[2];
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(TILE_SIZE / direction[0]);
  const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(TILE_SIZE / direction[2]);

  // Amanatides-Woo traversal: one test per crossed tile, never the whole mesh.
  for (let guard = 0; guard <= (scenario.width + scenario.height) * 2 + 8; guard++) {
    if (t > tExit + EPSILON) return null;
    const cellExit = Math.min(tMaxX, tMaxZ, tExit);
    const tile = scenario.tiles[tileIndex(scenario.width, tileX, tileZ)];
    if (!tile) return null;

    if (TERRAIN[tile.t as TerrainId]?.water) {
      if (tWater >= t - EPSILON && tWater <= cellExit + EPSILON) {
        return {
          x: origin[0] + direction[0] * tWater,
          z: origin[2] + direction[2] * tWater,
          y: WATER_LEVEL,
          tileX,
          tileZ,
          water: true,
        };
      }
    } else {
      const x0 = tileX * TILE_SIZE;
      const x1 = x0 + TILE_SIZE;
      const z0 = tileZ * TILE_SIZE;
      const z1 = z0 + TILE_SIZE;
      const h00 = terrainCornerHeight(scenario, tileX, tileZ);
      const h10 = terrainCornerHeight(scenario, tileX + 1, tileZ);
      const h01 = terrainCornerHeight(scenario, tileX, tileZ + 1);
      const h11 = terrainCornerHeight(scenario, tileX + 1, tileZ + 1);
      const first = triangleHit(
        origin,
        direction,
        x0, h00, z0,
        x1, h11, z1,
        x0, h01, z1,
      );
      const second = triangleHit(
        origin,
        direction,
        x0, h00, z0,
        x1, h10, z0,
        x1, h11, z1,
      );
      let hitT = NaN;
      if (Number.isFinite(first) && Number.isFinite(second)) hitT = Math.min(first, second);
      else if (Number.isFinite(first)) hitT = first;
      else if (Number.isFinite(second)) hitT = second;
      if (Number.isFinite(hitT) && hitT >= t - EPSILON && hitT <= cellExit + EPSILON) {
        return {
          x: origin[0] + direction[0] * hitT,
          z: origin[2] + direction[2] * hitT,
          y: origin[1] + direction[1] * hitT,
          tileX,
          tileZ,
          water: false,
        };
      }
    }

    if (cellExit >= tExit - EPSILON) return null;
    if (tMaxX <= tMaxZ) {
      t = tMaxX;
      tileX += stepX;
      tMaxX += tDeltaX;
    } else {
      t = tMaxZ;
      tileZ += stepZ;
      tMaxZ += tDeltaZ;
    }
    if (!inBounds(scenario.width, scenario.height, tileX, tileZ)) return null;
  }

  return null;
}
