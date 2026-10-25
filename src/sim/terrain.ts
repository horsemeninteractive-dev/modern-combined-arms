import { TILE_SIZE } from './constants';
import type { MoveClass } from './types';

export const Terrain = {
  DeepWater: 0,
  ShallowWater: 1,
  Sand: 2,
  Grass: 3,
  Forest: 4,
  Rock: 5,
  Road: 6,
  Urban: 7,
} as const;

export type TerrainId = (typeof Terrain)[keyof typeof Terrain];

/** Editor paint order and swatch labels. */
export const TERRAIN_ORDER: TerrainId[] = [
  Terrain.Sand,
  Terrain.Grass,
  Terrain.Forest,
  Terrain.Rock,
  Terrain.Road,
  Terrain.Urban,
  Terrain.ShallowWater,
  Terrain.DeepWater,
];

export interface TerrainProps {
  id: TerrainId;
  name: string;
  color: [number, number, number];
  /** Additional color variation for the renderer. */
  variation: number;
  buildable: boolean;
  water: boolean;
  deep: boolean;
  cover: number;
  concealment: number;
  blocksSight: boolean;
  oreAllowed: boolean;
  costs: Record<MoveClass, number>;
}

const impassable = Number.POSITIVE_INFINITY;

export const TERRAIN: Record<TerrainId, TerrainProps> = {
  [Terrain.DeepWater]: {
    id: Terrain.DeepWater,
    name: 'Deep water',
    color: [0.055, 0.145, 0.21],
    variation: 0.02,
    buildable: false,
    water: true,
    deep: true,
    cover: 0,
    concealment: 0,
    blocksSight: false,
    oreAllowed: false,
    costs: { foot: impassable, wheeled: impassable, tracked: impassable, naval: 1, air: 1 },
  },
  [Terrain.ShallowWater]: {
    id: Terrain.ShallowWater,
    name: 'Shallows',
    color: [0.12, 0.34, 0.39],
    variation: 0.03,
    buildable: false,
    water: true,
    deep: false,
    cover: 0,
    concealment: 0,
    blocksSight: false,
    oreAllowed: false,
    costs: { foot: 1.9, wheeled: 2.4, tracked: 1.7, naval: 1.55, air: 1 },
  },
  [Terrain.Sand]: {
    id: Terrain.Sand,
    name: 'Beach',
    color: [0.62, 0.56, 0.4],
    variation: 0.035,
    buildable: true,
    water: false,
    deep: false,
    cover: 0.05,
    concealment: 0.02,
    blocksSight: false,
    oreAllowed: true,
    costs: { foot: 1.15, wheeled: 1.55, tracked: 1.25, naval: impassable, air: 1 },
  },
  [Terrain.Grass]: {
    id: Terrain.Grass,
    name: 'Open ground',
    color: [0.31, 0.4, 0.24],
    variation: 0.04,
    buildable: true,
    water: false,
    deep: false,
    cover: 0.1,
    concealment: 0.05,
    blocksSight: false,
    oreAllowed: true,
    costs: { foot: 1, wheeled: 1.25, tracked: 1.05, naval: impassable, air: 1 },
  },
  [Terrain.Forest]: {
    id: Terrain.Forest,
    name: 'Forest',
    color: [0.16, 0.26, 0.17],
    variation: 0.04,
    buildable: false,
    water: false,
    deep: false,
    cover: 0.35,
    concealment: 0.75,
    blocksSight: true,
    oreAllowed: false,
    costs: { foot: 1.65, wheeled: 2.6, tracked: 1.85, naval: impassable, air: 1 },
  },
  [Terrain.Rock]: {
    id: Terrain.Rock,
    name: 'Ridge',
    color: [0.4, 0.39, 0.36],
    variation: 0.05,
    buildable: false,
    water: false,
    deep: false,
    cover: 0.25,
    concealment: 0.05,
    blocksSight: true,
    oreAllowed: false,
    costs: { foot: impassable, wheeled: impassable, tracked: impassable, naval: impassable, air: 1 },
  },
  [Terrain.Road]: {
    id: Terrain.Road,
    name: 'Road',
    color: [0.36, 0.35, 0.32],
    variation: 0.015,
    buildable: true,
    water: false,
    deep: false,
    cover: 0,
    concealment: 0,
    blocksSight: false,
    oreAllowed: false,
    costs: { foot: 0.8, wheeled: 0.7, tracked: 0.8, naval: impassable, air: 1 },
  },
  [Terrain.Urban]: {
    id: Terrain.Urban,
    name: 'Rubble / urban',
    color: [0.34, 0.32, 0.3],
    variation: 0.03,
    buildable: true,
    water: false,
    deep: false,
    cover: 0.3,
    concealment: 0.25,
    blocksSight: false,
    oreAllowed: false,
    costs: { foot: 1.05, wheeled: 1.15, tracked: 1.2, naval: impassable, air: 1 },
  },
};

/** Maximum elevation change a movement class can traverse in one tile step. */
export const ELEVATION_STEP: Record<MoveClass, number> = {
  foot: 2,
  wheeled: 1,
  tracked: 1,
  naval: 0,
  air: 99,
};

export function inBounds(width: number, height: number, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < width && z < height;
}

export function tileIndex(width: number, x: number, z: number): number {
  return z * width + x;
}

export function worldToTile(world: number): number {
  return Math.floor(world / TILE_SIZE);
}

export function tileCenter(tile: number): number {
  return (tile + 0.5) * TILE_SIZE;
}

export function isWaterTerrain(t: TerrainId): boolean {
  return TERRAIN[t].water;
}

export function moveCost(
  width: number,
  height: number,
  terrain: Uint8Array,
  elevation: Uint8Array,
  tx: number,
  tz: number,
  fromX: number,
  fromZ: number,
  moveClass: MoveClass,
): number {
  if (!inBounds(width, height, tx, tz)) return Number.POSITIVE_INFINITY;
  const i = tileIndex(width, tx, tz);
  const t = terrain[i] as TerrainId;
  const base = TERRAIN[t].costs[moveClass];
  if (!Number.isFinite(base)) return Number.POSITIVE_INFINITY;
  if (moveClass === 'air') return 1;
  const step = Math.abs(elevation[i] - elevation[tileIndex(width, fromX, fromZ)]);
  if (step > ELEVATION_STEP[moveClass]) return Number.POSITIVE_INFINITY;
  // Uphill costs extra; downhill is slightly cheaper.
  const e0 = elevation[tileIndex(width, fromX, fromZ)];
  const e1 = elevation[i];
  let modifier = 1;
  if (e1 > e0) modifier += (e1 - e0) * 0.22;
  else if (e1 < e0) modifier -= Math.min(0.18, (e0 - e1) * 0.12);
  return base * modifier;
}

export function canStandOn(
  width: number,
  height: number,
  terrain: Uint8Array,
  tile: number,
  moveClass: MoveClass,
): boolean {
  if (tile < 0 || tile >= width * height) return false;
  return Number.isFinite(TERRAIN[terrain[tile] as TerrainId].costs[moveClass]);
}

export function terrainName(t: number): string {
  return TERRAIN[t as TerrainId]?.name ?? 'Unknown';
}

/** Navigable for vessels (deep or shallow water). */
export function isNavigable(t: number): boolean {
  return t === Terrain.DeepWater || t === Terrain.ShallowWater;
}
