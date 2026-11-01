import { rotatePoint, rotateRect } from '../data/competitiveMaps';

/**
 * Authoring symmetry for the Scenario Forge.
 *
 * Three modes, matching the three kinds of battlefield the game ships:
 *
 *   - `single`  one-way. Every stroke lands exactly where it is painted.
 *   - `mirror`  two-way. A stroke is repeated across the vertical axis, the way
 *               the three legacy theatres in `src/data/maps.ts` are built.
 *   - `rotate`  four-way. A stroke is repeated at 90°, 180° and 270° about the
 *               map centre, the way the eight competitive maps in
 *               `src/data/competitiveMaps.ts` are built.
 *
 * The geometry is deliberately the *same* code the shipped rosters use:
 * `mirrorTileX` is the mirror `maps.ts` paints with, and `rotate` reuses the
 * competitive catalogue's own `rotatePoint`/`rotateRect`. An authored map
 * therefore lands on the same tiles as a hand-built one, which is what lets the
 * symmetry audits in `src/data/mapValidation.ts` pass on authored content.
 *
 * Four-way has two arrangements, because a rectangle admits only one of them:
 *
 *   - on a square map the copies are quarter turns, exactly like the
 *     competitive roster, so an authored map can pass its symmetry audit;
 *   - on a rectangular map a 90° turn has nowhere to put its tiles, so the
 *     copies are the two mirrors combined — the far column, the far row and the
 *     diagonal corner. That is still one stroke per quadrant, so the mode stays
 *     useful for the campaign-sized theatres, which are not square.
 */

export type SymmetryMode = 'single' | 'mirror' | 'rotate';

export interface SymmetryModeDef {
  id: SymmetryMode;
  label: string;
  /** One-line description used in the tool note and the hint bar. */
  note: string;
}

export const SYMMETRY_MODES: readonly SymmetryModeDef[] = [
  {
    id: 'single',
    label: '1-WAY',
    note: 'One-way: every stroke lands only where it is painted.',
  },
  {
    id: 'mirror',
    label: '2-WAY',
    note: 'Two-way: each stroke is mirrored across the vertical centre line.',
  },
  {
    id: 'rotate',
    label: '4-WAY',
    note: 'Four-way: each stroke is repeated into all four quadrants.',
  },
];

export interface SymmetryTile {
  x: number;
  z: number;
}

export interface SymmetryRect extends SymmetryTile {
  w: number;
  h: number;
}

/**
 * Whether four-way copies are quarter turns rather than combined mirrors.
 * Both are four-way; only a square grid can turn.
 */
export function symmetryRotates(width: number, height: number): boolean {
  return width === height;
}

/** What a mode does on this map, for the tool note and its tooltip. */
export function symmetryNote(mode: SymmetryMode, width: number, height: number): string {
  if (mode === 'rotate') {
    return symmetryRotates(width, height)
      ? 'Four-way: each stroke is repeated in all four rotations about the centre.'
      : 'Four-way: each stroke is mirrored across both centre lines on a rectangular map.';
  }
  return SYMMETRY_MODES.find((entry) => entry.id === mode)?.note ?? '';
}

/** The vertical mirror the legacy theatres are authored with. */
export function mirrorTileX(width: number, x: number): number {
  return width - 1 - x;
}

/** The horizontal mirror, used on a rectangular map's four-way copies. */
export function mirrorTileZ(height: number, z: number): number {
  return height - 1 - z;
}

/**
 * Origin of a mirrored footprint. A W-wide footprint at `x` spans `[x, x + W)`;
 * its mirror spans `[width - x - W, width - x)`, so the origin is `width - x - W`.
 * Mirroring the *origin* instead of the footprint would shift every building by
 * its own width.
 */
export function mirrorOriginX(width: number, x: number, footprintWidth: number): number {
  return width - (x + footprintWidth);
}

/** The same rule on the other axis. */
export function mirrorOriginZ(height: number, z: number, footprintHeight: number): number {
  return height - (z + footprintHeight);
}

/** 0 = north-west, 1 = north-east, 2 = south-east, 3 = south-west. */
export function quadrantOf(width: number, height: number, x: number, z: number): number {
  const east = x >= width / 2;
  const south = z >= height / 2;
  if (!east && !south) return 0;
  if (east && !south) return 1;
  if (east && south) return 2;
  return 3;
}

/**
 * The extra tiles a stroke lands on, excluding the painted tile itself.
 * Duplicates (a tile painted on the mirror line, or a rotation that maps a
 * point onto itself) are dropped so a stroke is never applied twice.
 */
export function symmetryTiles(
  mode: SymmetryMode,
  width: number,
  height: number,
  x: number,
  z: number,
): SymmetryTile[] {
  if (mode === 'single') return [];
  const out: SymmetryTile[] = [];
  const seen = new Set<string>([`${x},${z}`]);
  const push = (tileX: number, tileZ: number): void => {
    const key = `${tileX},${tileZ}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ x: tileX, z: tileZ });
  };
  if (mode === 'mirror') {
    push(mirrorTileX(width, x), z);
    return out;
  }
  if (!symmetryRotates(width, height)) {
    // A rectangle cannot turn, so its four-way copies are the combined mirrors:
    // the far column, the far row and the diagonal corner.
    const mx = mirrorTileX(width, x);
    const mz = mirrorTileZ(height, z);
    push(mx, z);
    push(x, mz);
    push(mx, mz);
    return out;
  }
  for (let k = 1; k <= 3; k++) {
    const p = rotatePoint(width, k as 1 | 2 | 3, x, z);
    push(p.x, p.z);
  }
  return out;
}

/**
 * The other footprints a placed structure is repeated into, excluding the
 * placed one. Quarter turns swap the footprint's width and height, so a 4×2
 * depot becomes 2×4 in the side quadrants — exactly what `rotateRect` does for
 * the authored roster.
 */
export function symmetryRects(
  mode: SymmetryMode,
  width: number,
  height: number,
  x: number,
  z: number,
  w: number,
  h: number,
): SymmetryRect[] {
  if (mode === 'single') return [];
  const out: SymmetryRect[] = [];
  const seen = new Set<string>([`${x},${z},${w},${h}`]);
  const push = (rect: SymmetryRect): void => {
    const key = `${rect.x},${rect.z},${rect.w},${rect.h}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(rect);
  };
  if (mode === 'mirror') {
    push({ x: mirrorOriginX(width, x, w), z, w, h });
    return out;
  }
  if (!symmetryRotates(width, height)) {
    const mx = mirrorOriginX(width, x, w);
    const mz = mirrorOriginZ(height, z, h);
    push({ x: mx, z, w, h });
    push({ x, z: mz, w, h });
    push({ x: mx, z: mz, w, h });
    return out;
  }
  for (let k = 1; k <= 3; k++) {
    push(rotateRect(width, k as 1 | 2 | 3, x, z, w, h));
  }
  return out;
}

/**
 * Which seat owns a symmetric copy.
 *
 * Neutral ground stays neutral. On a two-way map the far side belongs to the
 * other commander, which is how the legacy theatres are authored both ways at
 * once. On a four-way map ownership follows the quadrant — one seat per
 * quadrant with four commanders, and the roster's 1v1 convention with two: the
 * opposite quadrant is the opponent's and the two flanking quadrants are
 * neutral ground both players can expand into.
 */
export function symmetryOwner(
  mode: SymmetryMode,
  owner: number,
  players: number,
  x: number,
  z: number,
  width: number,
  height: number,
): number {
  if (owner < 0 || mode === 'single') return owner;
  if (mode === 'mirror') {
    if (players === 2) return owner === 0 ? 1 : owner === 1 ? 0 : owner;
    return owner;
  }
  const quadrant = quadrantOf(width, height, x, z);
  if (players >= 4) return quadrant % players;
  if (players === 2) return quadrant % 2 === 0 ? quadrant / 2 : -1;
  return -1;
}

/**
 * Start tile for a seat when the deployment marker is moved with symmetry on.
 *
 * Seat 0 keeps the tile the author clicked. On a two-way map the other seat is
 * mirrored onto the far side; on a four-way map each seat takes its own
 * quadrant (a half turn per seat with two commanders, so 1v1 keeps the roster's
 * opposite-corner convention).
 */
export function symmetryStart(
  mode: SymmetryMode,
  seatId: number,
  players: number,
  clickedX: number,
  clickedZ: number,
  width: number,
  height: number,
): SymmetryTile {
  if (mode === 'single') return { x: clickedX, z: clickedZ };
  if (mode === 'mirror') {
    if (seatId === 1 && players === 2) return { x: mirrorTileX(width, clickedX), z: clickedZ };
    return { x: clickedX, z: clickedZ };
  }
  if (symmetryRotates(width, height)) {
    const k = ((players === 2 ? seatId * 2 : seatId) % 4) as 0 | 1 | 2 | 3;
    return rotatePoint(width, k, clickedX, clickedZ);
  }
  // A rectangular map keeps the same seat order — east, then south-east, then
  // south — using the combined mirrors the tiles use.
  const k = (players === 2 ? seatId * 2 : seatId) % 4;
  const east = k === 1 || k === 2 ? mirrorTileX(width, clickedX) : clickedX;
  const south = k === 2 || k === 3 ? mirrorTileZ(height, clickedZ) : clickedZ;
  return { x: east, z: south };
}
