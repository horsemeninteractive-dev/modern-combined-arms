import { TILE_SIZE } from './constants';
import type { MoveClass } from './types';

/**
 * Base terrain.
 *
 * A tile's base terrain decides the physical facts: movement costs, movement
 * restrictions, buildability, cover, concealment, sight obstruction and the
 * ground's appearance. Ids 0-7 are the original eight theatres and are never
 * renumbered — authored maps, saves and the multiplayer projection all carry
 * the number, so reusing one would silently repaint existing content.
 */
export const Terrain = {
  DeepWater: 0,
  ShallowWater: 1,
  Sand: 2,
  Grass: 3,
  Forest: 4,
  Rock: 5,
  Road: 6,
  Urban: 7,
  /** Waterlogged reed beds and saturated ground: slow, concealing, unstable. */
  Marsh: 8,
  /** Deep mud and churned earth: passable, bad for wheels, no protection. */
  Mud: 9,
  /** Cultivated fields: good going, crops add concealment through the overlay. */
  Farmland: 10,
  /** Brush and rough grass: infantry concealment, light cover. */
  Scrub: 11,
  /** Exposed stone and boulders: rough on wheels, good cover, interrupts sight. */
  Rocks: 12,
  /** Deep dune sand: elevation country that punishes heavy vehicles. */
  Dune: 13,
  /** Dense built-up blocks: infantry ground with hard cover streets. */
  DenseUrban: 14,
  /** Concrete hardstanding and yards: fast going, cover from the structures. */
  Industrial: 15,
} as const;

export type TerrainId = (typeof Terrain)[keyof typeof Terrain];

/** Highest valid base-terrain id: what a scenario file may carry. */
export const TERRAIN_ID_MAX = 15;

/** Highest valid packed overlay byte (id * 4 + density). */
export const OVERLAY_BYTE_MAX = 31;

/** Every base terrain id, in catalogue order. */
export const TERRAIN_IDS: readonly TerrainId[] = [
  Terrain.DeepWater,
  Terrain.ShallowWater,
  Terrain.Sand,
  Terrain.Grass,
  Terrain.Forest,
  Terrain.Rock,
  Terrain.Road,
  Terrain.Urban,
  Terrain.Marsh,
  Terrain.Mud,
  Terrain.Farmland,
  Terrain.Scrub,
  Terrain.Rocks,
  Terrain.Dune,
  Terrain.DenseUrban,
  Terrain.Industrial,
];

/**
 * Editor paint order and swatch labels, grouped the way the palette is.
 * Natural ground reads first, then agricultural, then the built environment,
 * then water: the same order the Forge shows.
 */
export const TERRAIN_GROUPS: ReadonlyArray<{ name: string; terrains: readonly TerrainId[] }> = [
  {
    name: 'Natural',
    terrains: [
      Terrain.Sand,
      Terrain.Grass,
      Terrain.Forest,
      Terrain.Rock,
      Terrain.Marsh,
      Terrain.Scrub,
      Terrain.Rocks,
      Terrain.Dune,
    ],
  },
  { name: 'Agricultural', terrains: [Terrain.Farmland] },
  { name: 'Surface conditions', terrains: [Terrain.Mud] },
  { name: 'Built environment', terrains: [Terrain.Road, Terrain.Urban, Terrain.DenseUrban, Terrain.Industrial] },
  { name: 'Water', terrains: [Terrain.ShallowWater, Terrain.DeepWater] },
];

/** Flat paint order, derived from the groups so the two cannot drift apart. */
export const TERRAIN_ORDER: TerrainId[] = TERRAIN_GROUPS.flatMap((group) => [...group.terrains]);

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
  /**
   * How much this tile obscures a sight line that passes through it. 0 is
   * clear, 1 is a soft obscuration (three of them block), 2 or more is a hard
   * block. Defaults to `blocksSight ? Infinity : concealment >= 0.5 ? 1 : 0`,
   * so the original eight terrains keep the behaviour they shipped with.
   */
  sight?: number;
  /** One-line mechanical note shown in the Forge palette tooltip. */
  note?: string;
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
    note: 'Open water. Only vessels and aircraft cross it.',
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
    note: 'Wadeable water. Slow for everyone, and no cover.',
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
    note: 'Firm sand and shingle. Buildable, slightly slow on wheels.',
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
    note: 'Baseline going. Buildable, minimal cover, no concealment.',
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
    sight: 1,
    note: 'Canopy: conceals infantry, blocks sight lines, blocks construction.',
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
    note: 'Impassable ridge line. Blocks movement and sight completely.',
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
    note: 'Metalled road: the fastest ground, and completely exposed.',
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
    note: 'Broken masonry and cleared lots. Cover, some concealment, buildable.',
  },
  [Terrain.Marsh]: {
    id: Terrain.Marsh,
    name: 'Marshland',
    color: [0.235, 0.305, 0.235],
    variation: 0.045,
    buildable: false,
    water: false,
    deep: false,
    cover: 0.05,
    concealment: 0.55,
    blocksSight: false,
    oreAllowed: false,
    costs: { foot: 1.75, wheeled: 3.4, tracked: 2.6, naval: impassable, air: 1 },
    sight: 1,
    note: 'Reed beds and saturated ground. Conceals, slows, cannot be built on.',
  },
  [Terrain.Mud]: {
    id: Terrain.Mud,
    name: 'Mud',
    color: [0.27, 0.225, 0.175],
    variation: 0.05,
    buildable: false,
    water: false,
    deep: false,
    cover: 0,
    concealment: 0.05,
    blocksSight: false,
    oreAllowed: false,
    costs: { foot: 1.45, wheeled: 2.1, tracked: 1.75, naval: impassable, air: 1 },
    note: 'Waterlogged earth. Slows vehicles, gives no protection, no foundations.',
  },
  [Terrain.Farmland]: {
    id: Terrain.Farmland,
    name: 'Farmland',
    color: [0.44, 0.42, 0.24],
    variation: 0.045,
    buildable: true,
    water: false,
    deep: false,
    cover: 0.05,
    concealment: 0.15,
    blocksSight: false,
    oreAllowed: true,
    costs: { foot: 1.05, wheeled: 1.3, tracked: 1.1, naval: impassable, air: 1 },
    note: 'Cultivated fields. Good going; crops raise concealment where painted.',
  },
  [Terrain.Scrub]: {
    id: Terrain.Scrub,
    name: 'Scrubland',
    color: [0.31, 0.335, 0.195],
    variation: 0.05,
    buildable: false,
    water: false,
    deep: false,
    cover: 0.15,
    concealment: 0.5,
    blocksSight: false,
    oreAllowed: false,
    costs: { foot: 1.4, wheeled: 2.0, tracked: 1.55, naval: impassable, air: 1 },
    sight: 1,
    note: 'Brush and rough grass. Hides infantry, mild cover, slow on vehicles.',
  },
  [Terrain.Rocks]: {
    id: Terrain.Rocks,
    name: 'Rocky ground',
    color: [0.435, 0.42, 0.375],
    variation: 0.055,
    buildable: false,
    water: false,
    deep: false,
    cover: 0.35,
    concealment: 0.1,
    blocksSight: false,
    oreAllowed: false,
    costs: { foot: 1.8, wheeled: 3.2, tracked: 1.9, naval: impassable, air: 1 },
    sight: 1,
    note: 'Boulder fields. Passable but hard on wheels, good cover, cuts sight lines.',
  },
  [Terrain.Dune]: {
    id: Terrain.Dune,
    name: 'Dunes',
    color: [0.71, 0.62, 0.43],
    variation: 0.05,
    buildable: false,
    water: false,
    deep: false,
    cover: 0.05,
    concealment: 0.05,
    blocksSight: false,
    oreAllowed: true,
    costs: { foot: 1.35, wheeled: 2.3, tracked: 1.9, naval: impassable, air: 1 },
    note: 'Deep wind-blown sand. Punishes heavy vehicles; no foundations.',
  },
  [Terrain.DenseUrban]: {
    id: Terrain.DenseUrban,
    name: 'Dense urban',
    color: [0.305, 0.29, 0.28],
    variation: 0.035,
    buildable: false,
    water: false,
    deep: false,
    cover: 0.35,
    concealment: 0.35,
    blocksSight: false,
    oreAllowed: false,
    costs: { foot: 1.1, wheeled: 1.35, tracked: 1.5, naval: impassable, air: 1 },
    note: 'Built-up blocks. Hard cover for infantry, tight for armour.',
  },
  [Terrain.Industrial]: {
    id: Terrain.Industrial,
    name: 'Industrial ground',
    color: [0.4, 0.4, 0.385],
    variation: 0.03,
    buildable: true,
    water: false,
    deep: false,
    cover: 0.2,
    concealment: 0.1,
    blocksSight: false,
    oreAllowed: false,
    costs: { foot: 0.95, wheeled: 0.85, tracked: 0.9, naval: impassable, air: 1 },
    note: 'Concrete hardstanding. Fast for every class, buildable, some cover.',
  },
};

/**
 * Surface and vegetation overlays.
 *
 * An overlay is a second, independent layer on a tile: it changes what the
 * ground looks like and how it behaves without replacing the base terrain, so
 * "open ground + crater", "farmland + dense crops" and "marsh + reeds" are all
 * expressible without inventing a terrain id per combination. The layer is
 * deterministic, serializable and safe to leave absent (`0`), which is what
 * keeps every existing scenario and save loading unchanged.
 */
export const Overlay = {
  None: 0,
  /** Churned, waterlogged surface over any ground. */
  Mud: 1,
  /** Crop rows: infantry concealment while standing or prone in them. */
  Crop: 2,
  /** Standing reeds and marsh grass. */
  Reeds: 3,
  /** Shell crater: a scrape to fight from, harder for wheels to cross. */
  Crater: 4,
  /** Hedgerow and embankment: a linear bank that breaks sight and gives cover. */
  Hedge: 5,
  /** Snow cover: presentation and a small wheel penalty. */
  Snow: 6,
} as const;

export type OverlayId = (typeof Overlay)[keyof typeof Overlay];

export interface OverlayProps {
  id: OverlayId;
  name: string;
  /** Renderer tint and strength. */
  tint: [number, number, number];
  strength: number;
  /** Added to the base terrain's cover. */
  cover: number;
  /** Added to the base terrain's concealment, capped at 1. */
  concealment: number;
  /** Tile sight obscuration, replacing the base terrain's when non-zero. */
  sight: number;
  /** Multiplier per movement class; 1 is no change. */
  costMul: Record<MoveClass, number>;
  /** Overlays that make a tile unbuildable (a scrape or a bank is not a pad). */
  blocksBuild: boolean;
  /** Base terrains this overlay is meaningful on; empty means any. */
  allows: readonly TerrainId[];
}

export const OVERLAYS: Record<OverlayId, OverlayProps> = {
  [Overlay.None]: {
    id: Overlay.None,
    name: 'None',
    tint: [0, 0, 0],
    strength: 0,
    cover: 0,
    concealment: 0,
    sight: 0,
    costMul: { foot: 1, wheeled: 1, tracked: 1, naval: 1, air: 1 },
    blocksBuild: false,
    allows: [],
  },
  [Overlay.Mud]: {
    id: Overlay.Mud,
    name: 'Waterlogged',
    tint: [0.2, 0.15, 0.1],
    strength: 0.35,
    cover: 0,
    concealment: 0,
    sight: 0,
    costMul: { foot: 1.15, wheeled: 1.4, tracked: 1.3, naval: 1, air: 1 },
    blocksBuild: true,
    allows: [Terrain.Grass, Terrain.Road, Terrain.Farmland, Terrain.Sand, Terrain.Urban, Terrain.Industrial, Terrain.Mud],
  },
  [Overlay.Crop]: {
    id: Overlay.Crop,
    name: 'Crop rows',
    tint: [0.52, 0.5, 0.24],
    strength: 0.5,
    cover: 0,
    concealment: 0.45,
    sight: 1,
    costMul: { foot: 1.05, wheeled: 1, tracked: 1, naval: 1, air: 1 },
    blocksBuild: false,
    allows: [Terrain.Farmland, Terrain.Grass],
  },
  [Overlay.Reeds]: {
    id: Overlay.Reeds,
    name: 'Reeds',
    tint: [0.3, 0.4, 0.26],
    strength: 0.5,
    cover: 0,
    concealment: 0.3,
    sight: 1,
    costMul: { foot: 1.1, wheeled: 1, tracked: 1.1, naval: 1, air: 1 },
    blocksBuild: true,
    allows: [Terrain.Marsh, Terrain.ShallowWater, Terrain.Mud, Terrain.Grass],
  },
  [Overlay.Crater]: {
    id: Overlay.Crater,
    name: 'Crater',
    tint: [0.22, 0.19, 0.16],
    strength: 0.4,
    cover: 0.15,
    concealment: 0.1,
    sight: 0,
    costMul: { foot: 1, wheeled: 1.15, tracked: 1.1, naval: 1, air: 1 },
    blocksBuild: false,
    allows: [],
  },
  [Overlay.Hedge]: {
    id: Overlay.Hedge,
    name: 'Hedgerow',
    tint: [0.24, 0.32, 0.2],
    strength: 0.55,
    cover: 0.35,
    concealment: 0.35,
    sight: 2,
    costMul: { foot: 1.2, wheeled: 1.35, tracked: 1.25, naval: 1, air: 1 },
    blocksBuild: true,
    allows: [Terrain.Grass, Terrain.Farmland, Terrain.Scrub, Terrain.Mud],
  },
  [Overlay.Snow]: {
    id: Overlay.Snow,
    name: 'Snow cover',
    // Snow is close to opaque in the real world: a 30% tint over green grass
    // reads as frozen ground, which is exactly what the old value looked like.
    tint: [0.88, 0.91, 0.95],
    strength: 0.9,
    cover: 0,
    concealment: 0,
    sight: 0,
    costMul: { foot: 1.05, wheeled: 1.15, tracked: 1.1, naval: 1, air: 1 },
    blocksBuild: false,
    allows: [],
  },
};

/** Overlays offered by the Forge palette, in painting order. */
export const OVERLAY_PALETTE: readonly OverlayId[] = [
  Overlay.Crop,
  Overlay.Reeds,
  Overlay.Hedge,
  Overlay.Mud,
  Overlay.Crater,
  Overlay.Snow,
];

/** One-line mechanical note for an overlay, used as its palette tooltip. */
export function overlayNote(id: OverlayId): string {
  switch (id) {
    case Overlay.Crop:
      return 'Crop rows: concealment only. Hides infantry, stops no rounds, still buildable.';
    case Overlay.Reeds:
      return 'Reeds: concealment over marsh or shallows. Blocks construction.';
    case Overlay.Hedge:
      return 'Hedgerow: cover and concealment, and a hard break in sight lines.';
    case Overlay.Mud:
      return 'Waterlogged: slows every vehicle and blocks foundations.';
    case Overlay.Crater:
      return 'Crater: a scrape to fight from, harder going for wheels.';
    case Overlay.Snow:
      return 'Snow cover: presentation, with a light penalty on wheels and tracks.';
    default:
      return 'No surface layer.';
  }
}

/** Display suffix naming a tile's overlay, or nothing when it has none. */
export function overlayLabel(value: number | undefined): string {
  const v = value ?? 0;
  if (v <= 0) return '';
  const props = OVERLAYS[overlayIdOf(v)];
  if (!props || props.id === Overlay.None) return '';
  const density = overlayDensityOf(v);
  return ` under ${density >= 3 ? 'dense ' : density === 1 ? 'light ' : ''}${props.name.toLowerCase()}`;
}

/** Overlay densities, so a marsh can be sparse or dense without new ids. */
export const OVERLAY_DENSITY_MAX = 3;

/** Pack an overlay id and density into the single byte a tile stores. */
export function packOverlay(id: OverlayId, density = 1): number {
  return id * 4 + Math.max(0, Math.min(OVERLAY_DENSITY_MAX, Math.round(density)));
}

export function overlayIdOf(value: number): OverlayId {
  return Math.floor(value / 4) as OverlayId;
}

export function overlayDensityOf(value: number): number {
  return value % 4;
}

/** How much of an overlay's effect is in force: density 1..3 as 0.5/1/1.5. */
function overlayScale(value: number): number {
  return overlayDensityOf(value) * 0.5;
}

/* ------------------------------------------------------------------ */
/* Tile queries                                                        */
/* ------------------------------------------------------------------ */

/** Obscuration of a sight line through one tile: 0 clear, 1 soft, 2+ hard. */
export function terrainSight(t: TerrainId): number {
  const props = TERRAIN[t];
  if (props.sight !== undefined) return props.sight;
  if (props.blocksSight) return 2;
  return props.concealment >= 0.5 ? 1 : 0;
}

export function tileSight(terrain: number, overlay: number): number {
  const base = terrainSight(terrain as TerrainId);
  if (base >= 2) return base;
  if (overlay <= 0) return base;
  const props = OVERLAYS[overlayIdOf(overlay)];
  return Math.max(base, props.sight);
}

/**
 * Concealment on a tile, in 0..1. The base terrain and the overlay stack, and
 * a denser overlay conceals more, all the way to full concealment.
 */
export function tileConcealment(terrain: number, overlay: number): number {
  const base = TERRAIN[terrain as TerrainId]?.concealment ?? 0;
  if (overlay <= 0) return base;
  const props = OVERLAYS[overlayIdOf(overlay)];
  return Math.min(1, base + props.concealment * overlayScale(overlay));
}

/** Cover on a tile, in 0..1. Only physical protection counts, never crops. */
export function tileCover(terrain: number, overlay: number): number {
  const base = TERRAIN[terrain as TerrainId]?.cover ?? 0;
  if (overlay <= 0) return base;
  const props = OVERLAYS[overlayIdOf(overlay)];
  return Math.min(1, base + props.cover * overlayScale(overlay));
}

/** Whether a structure may be founded on this tile. */
export function tileBuildable(terrain: number, overlay: number): boolean {
  if (!(TERRAIN[terrain as TerrainId]?.buildable ?? false)) return false;
  if (overlay <= 0) return true;
  return !OVERLAYS[overlayIdOf(overlay)].blocksBuild;
}

/** Whether a material deposit may be stamped on this tile. */
export function tileOreAllowed(terrain: number, overlay: number): boolean {
  if (!(TERRAIN[terrain as TerrainId]?.oreAllowed ?? false)) return false;
  return overlay <= 0;
}

/** Combined movement multiplier from the overlay alone. */
export function overlayCostMul(overlay: number, moveClass: MoveClass): number {
  if (overlay <= 0) return 1;
  const props = OVERLAYS[overlayIdOf(overlay)];
  return 1 + (props.costMul[moveClass] - 1) * overlayScale(overlay);
}

/** Whether an overlay may be painted on a base terrain. */
export function overlayAllowedOn(overlay: number, terrain: number): boolean {
  if (overlay <= 0) return true;
  const props = OVERLAYS[overlayIdOf(overlay)];
  return props.allows.length === 0 || props.allows.includes(terrain as TerrainId);
}

/* ------------------------------------------------------------------ */
/* Movement                                                            */
/* ------------------------------------------------------------------ */

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

/**
 * Cost of entering a tile. `overlay` is optional so a caller that only has the
 * base terrain (an older save, the projection, a probe) keeps working; a map
 * that carries the layer gets the surface penalty with it.
 */
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
  overlay?: Uint8Array,
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
  const surface = overlay && overlay.length > i ? overlayCostMul(overlay[i], moveClass) : 1;
  return base * modifier * surface;
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
