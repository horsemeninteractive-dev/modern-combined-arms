import { ELEVATION_HEIGHT, TILE_SIZE } from './constants';
import { buildingDef } from '../data/buildings';
import { TERRAIN, inBounds, tileIndex, type TerrainId } from './terrain';
import type { RuntimeMap } from './types';
import type { Scenario as AuthoredScenario } from './scenario';

export function createRuntimeMap(scenario: AuthoredScenario): RuntimeMap {
  const size = scenario.width * scenario.height;
  const terrain = new Uint8Array(size);
  const elevation = new Uint8Array(size);
  const ore = new Uint16Array(size);
  const maxOre = new Uint16Array(size);
  // The surface layer is carried alongside the base terrain, never folded into
  // it: a tile's terrain id keeps meaning exactly the same thing it always did.
  const overlay = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    terrain[i] = scenario.tiles[i].t;
    elevation[i] = scenario.tiles[i].e;
    ore[i] = scenario.tiles[i].o;
    maxOre[i] = scenario.tiles[i].o;
    overlay[i] = scenario.tiles[i].v ?? 0;
  }
  return { width: scenario.width, height: scenario.height, terrain, elevation, ore, maxOre, overlay };
}

export function mapHeightAt(map: RuntimeMap, x: number, z: number): number {
  const tx = Math.floor(x / TILE_SIZE);
  const tz = Math.floor(z / TILE_SIZE);
  if (!inBounds(map.width, map.height, tx, tz)) return 0;
  return map.elevation[tileIndex(map.width, tx, tz)] * ELEVATION_HEIGHT;
}

export function terrainAtWorld(map: RuntimeMap, x: number, z: number): number {
  const tx = Math.floor(x / TILE_SIZE);
  const tz = Math.floor(z / TILE_SIZE);
  if (!inBounds(map.width, map.height, tx, tz)) return -1;
  return map.terrain[tileIndex(map.width, tx, tz)];
}

export function isWaterAtWorld(map: RuntimeMap, x: number, z: number): boolean {
  const t = terrainAtWorld(map, x, z);
  return t >= 0 && TERRAIN[t as TerrainId].water;
}

export function oreAtWorld(map: RuntimeMap, x: number, z: number): number {
  const tx = Math.floor(x / TILE_SIZE);
  const tz = Math.floor(z / TILE_SIZE);
  if (!inBounds(map.width, map.height, tx, tz)) return 0;
  return map.ore[tileIndex(map.width, tx, tz)];
}

/** Stamp a structure footprint into a blocking grid. */
export function stampFootprint(
  grid: Uint8Array,
  map: RuntimeMap,
  defId: string,
  tileX: number,
  tileZ: number,
  value: number,
): void {
  const def = buildingDef(defId);
  for (let dz = 0; dz < def.footprint.h; dz++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const x = tileX + dx;
      const z = tileZ + dz;
      if (!inBounds(map.width, map.height, x, z)) continue;
      grid[tileIndex(map.width, x, z)] = value;
    }
  }
}

/** Determine top-left tile for a footprint centred on a point. */
export function footprintOrigin(defId: string, tileX: number, tileZ: number): { x: number; z: number } {
  const def = buildingDef(defId);
  return { x: tileX - Math.floor((def.footprint.w - 1) / 2), z: tileZ - Math.floor((def.footprint.h - 1) / 2) };
}

export function footprintCenter(defId: string, tileX: number, tileZ: number): { x: number; z: number } {
  const def = buildingDef(defId);
  return {
    x: (tileX + def.footprint.w / 2) * TILE_SIZE,
    z: (tileZ + def.footprint.h / 2) * TILE_SIZE,
  };
}

/** World-space rebuild used by saves. */
export function runtimeMapFromSave(data: {
  width: number;
  height: number;
  terrain: number[];
  elevation: number[];
  ore: number[];
  maxOre: number[];
  overlay?: number[];
}): RuntimeMap {
  return {
    width: data.width,
    height: data.height,
    terrain: Uint8Array.from(data.terrain),
    elevation: Uint8Array.from(data.elevation),
    ore: Uint16Array.from(data.ore),
    maxOre: Uint16Array.from(data.maxOre),
    // A save written before the surface layer existed simply has none.
    ...(data.overlay ? { overlay: Uint8Array.from(data.overlay) } : {}),
  };
}

export function runtimeMapToSave(map: RuntimeMap): {
  width: number;
  height: number;
  terrain: number[];
  elevation: number[];
  ore: number[];
  maxOre: number[];
  overlay: number[];
} {
  return {
    width: map.width,
    height: map.height,
    terrain: Array.from(map.terrain),
    elevation: Array.from(map.elevation),
    ore: Array.from(map.ore),
    maxOre: Array.from(map.maxOre),
    overlay: map.overlay ? Array.from(map.overlay) : new Array<number>(map.terrain.length).fill(0),
  };
}

/** True if any unit is within `radius` world units of the point. */
export function isAreaFreeOfUnits(
  entities: ReadonlyArray<{ x: number; z: number; kind: string; hp: number }>,
  x: number,
  z: number,
  radius: number,
  ignoreId?: number,
): boolean {
  const r2 = radius * radius;
  for (const e of entities) {
    if (e.hp <= 0) continue;
    if (e.kind !== 'unit') continue;
    if (ignoreId !== undefined && (e as { id?: number }).id === ignoreId) continue;
    const dx = e.x - x;
    const dz = e.z - z;
    if (dx * dx + dz * dz < r2) return false;
  }
  return true;
}

