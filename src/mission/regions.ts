/**
 * Mission-region geometry.
 *
 * Regions are authored in the scenario's tile convention: `x`/`z` is the
 * top-left tile and `width`/`height` count tiles, so the rectangle covers
 * [x, x + width) by [z, z + height). Everything here is pure and bounds-aware
 * so the map interactions and the numeric fields agree on one model, and so the
 * drag maths can be tested without a browser.
 */
import type { MissionRegionDoc } from './types';

/** One tile rectangle, independent of any id or authoring metadata. */
export interface TileRect {
  x: number;
  z: number;
  width: number;
  height: number;
}

export interface MapBounds {
  width: number;
  height: number;
}

/** Validator minimum: a region must cover at least one whole tile. */
export const MIN_REGION_SIZE = 1;

/** Resize grips, named by the edge or corner they move. */
export type RegionHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const REGION_HANDLES: readonly RegionHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function whole(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

export function sameRect(a: TileRect, b: TileRect): boolean {
  return a.x === b.x && a.z === b.z && a.width === b.width && a.height === b.height;
}

/** Inclusive tile containment; the bottom and right edges are exclusive. */
export function rectContains(rect: TileRect, x: number, z: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && z >= rect.z && z < rect.z + rect.height;
}

/**
 * Rectangle spanned by two inclusive tile corners.
 *
 * The drag may run in any direction, so the endpoints are normalised rather
 * than assumed to be top-left and bottom-right. Both corners are clamped to the
 * map first, which keeps a drag that leaves the viewport honest instead of
 * producing a rectangle that validation would reject.
 */
export function rectFromTiles(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  bounds: MapBounds,
): TileRect {
  const maxX = Math.max(0, bounds.width - 1);
  const maxZ = Math.max(0, bounds.height - 1);
  const x1 = clamp(whole(ax), 0, maxX);
  const z1 = clamp(whole(az), 0, maxZ);
  const x2 = clamp(whole(bx), 0, maxX);
  const z2 = clamp(whole(bz), 0, maxZ);
  const x = Math.min(x1, x2);
  const z = Math.min(z1, z2);
  return {
    x,
    z,
    width: Math.max(MIN_REGION_SIZE, Math.abs(x2 - x1) + 1),
    height: Math.max(MIN_REGION_SIZE, Math.abs(z2 - z1) + 1),
  };
}

/** Keep a rectangle inside the map without changing its size where possible. */
export function clampRectToBounds(rect: TileRect, bounds: MapBounds): TileRect {
  const width = clamp(whole(rect.width), MIN_REGION_SIZE, Math.max(MIN_REGION_SIZE, bounds.width));
  const height = clamp(whole(rect.height), MIN_REGION_SIZE, Math.max(MIN_REGION_SIZE, bounds.height));
  return {
    width,
    height,
    x: clamp(whole(rect.x), 0, Math.max(0, bounds.width - width)),
    z: clamp(whole(rect.z), 0, Math.max(0, bounds.height - height)),
  };
}

/** Translate by whole tiles, keeping the size and the map bounds. */
export function moveRegion(rect: TileRect, dx: number, dz: number, bounds: MapBounds): TileRect {
  return clampRectToBounds(
    { x: whole(rect.x) + whole(dx), z: whole(rect.z) + whole(dz), width: rect.width, height: rect.height },
    bounds,
  );
}

/**
 * Move one edge or corner by whole tiles.
 *
 * Opposite edges stay put: a drag that crosses an edge stops at the minimum
 * size instead of inverting the rectangle, which is what authors expect from a
 * map tool and keeps the stored document always valid.
 */
export function resizeRegion(
  rect: TileRect,
  handle: RegionHandle,
  dx: number,
  dz: number,
  bounds: MapBounds,
): TileRect {
  let left = whole(rect.x);
  let top = whole(rect.z);
  let right = left + Math.max(MIN_REGION_SIZE, whole(rect.width));
  let bottom = top + Math.max(MIN_REGION_SIZE, whole(rect.height));
  const mx = whole(dx);
  const mz = whole(dz);

  if (handle.includes('w')) {
    left = clamp(left + mx, 0, right - MIN_REGION_SIZE);
  }
  if (handle.includes('e')) {
    right = clamp(right + mx, left + MIN_REGION_SIZE, bounds.width);
  }
  if (handle.includes('n')) {
    top = clamp(top + mz, 0, bottom - MIN_REGION_SIZE);
  }
  if (handle.includes('s')) {
    bottom = clamp(bottom + mz, top + MIN_REGION_SIZE, bounds.height);
  }

  // A west/north drag can start inside a map edge and still be clamped above;
  // clamp the untouched side too so an oversized region is pulled in.
  left = clamp(left, 0, Math.max(0, bounds.width - MIN_REGION_SIZE));
  top = clamp(top, 0, Math.max(0, bounds.height - MIN_REGION_SIZE));
  right = clamp(right, left + MIN_REGION_SIZE, bounds.width);
  bottom = clamp(bottom, top + MIN_REGION_SIZE, bounds.height);

  return { x: left, z: top, width: right - left, height: bottom - top };
}

/** The topmost region covering a tile, or null. Later entries win, as drawn. */
export function regionAt<T extends TileRect>(regions: readonly T[], x: number, z: number): T | null {
  for (let i = regions.length - 1; i >= 0; i--) {
    if (rectContains(regions[i], x, z)) return regions[i];
  }
  return null;
}

/** Regions whose rectangles share at least one tile with `rect`. */
export function overlappingRegions<T extends TileRect>(
  regions: readonly T[],
  rect: TileRect,
  excludeId?: string,
): T[] {
  return regions.filter((region) => {
    if (excludeId !== undefined && (region as { id?: string }).id === excludeId) return false;
    return (
      region.x < rect.x + rect.width &&
      rect.x < region.x + region.width &&
      region.z < rect.z + rect.height &&
      rect.z < region.z + region.height
    );
  });
}

/** `x, z · w×h` in tiles, the label authors use while drawing. */
export function regionBoundsLabel(rect: TileRect): string {
  return `${rect.x}, ${rect.z} · ${rect.width}×${rect.height}`;
}

/** A fresh rectangle centred in the map, used when no drag has happened yet. */
export function defaultRegionRect(bounds: MapBounds): TileRect {
  const width = Math.max(MIN_REGION_SIZE, Math.floor(bounds.width / 4));
  const height = Math.max(MIN_REGION_SIZE, Math.floor(bounds.height / 4));
  return {
    x: Math.floor((bounds.width - width) / 2),
    z: Math.floor((bounds.height - height) / 2),
    width,
    height,
  };
}

/** Rectangle as authored, without the id: what a drag actually edits. */
export function rectOfRegion(region: MissionRegionDoc): TileRect {
  return { x: region.x, z: region.z, width: region.width, height: region.height };
}

/** Write a dragged rectangle back onto the authored region, keeping its id. */
export function applyRect(region: MissionRegionDoc, rect: TileRect): void {
  region.x = rect.x;
  region.z = rect.z;
  region.width = rect.width;
  region.height = rect.height;
}
