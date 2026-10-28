import { TILE_SIZE } from './constants';
import { inBounds, ELEVATION_STEP, moveCost, tileIndex, type TerrainId } from './terrain';
import type { MoveClass, PathPoint } from './types';

export interface NavGrid {
  width: number;
  height: number;
  terrain: Uint8Array;
  elevation: Uint8Array;
  moveClass: MoveClass;
  /** 1 = blocked by a structure (or impassable for this mover). */
  occupied?: Uint8Array;
  /**
   * 1 = traffic worth avoiding, but passable. Idle friendly units are marked
   * here so a route prefers the open lane around a formation instead of
   * ploughing through it and relying on collision separation.
   */
  soft?: Uint8Array;
}

const NEIGHBOURS: Array<[number, number, number]> = [
  [1, 0, 1],
  [0, 1, 1],
  [-1, 0, 1],
  [0, -1, 1],
  [1, 1, 1.41421356],
  [1, -1, 1.41421356],
  [-1, 1, 1.41421356],
  [-1, -1, 1.41421356],
];

interface HeapNode {
  index: number;
  f: number;
}

class MinHeap {
  private items: HeapNode[] = [];

  push(node: HeapNode): void {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].f <= items[i].f) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): HeapNode | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && items[l].f < items[smallest].f) smallest = l;
        if (r < items.length && items[r].f < items[smallest].f) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }

  get size(): number {
    return this.items.length;
  }
}

function passable(nav: NavGrid, index: number): boolean {
  if (nav.occupied?.[index]) return false;
  const t = nav.terrain[index] as TerrainId;
  // Avoid importing the full terrain table here for hot-path clarity: use moveCost
  // with the tile's own coordinates in the caller.
  void t;
  return true;
}

function stepCost(nav: NavGrid, from: number, to: number, diagonal: boolean): number {
  if (!passable(nav, to)) return Number.POSITIVE_INFINITY;
  const fx = from % nav.width;
  const fz = (from / nav.width) | 0;
  const tx = to % nav.width;
  const tz = (to / nav.width) | 0;
  if (Math.abs(nav.elevation[to] - nav.elevation[from]) > ELEVATION_STEP[nav.moveClass]) {
    return Number.POSITIVE_INFINITY;
  }
  const cost = moveCost(
    nav.width,
    nav.height,
    nav.terrain,
    nav.elevation,
    tx,
    tz,
    fx,
    fz,
    nav.moveClass,
  );
  if (!Number.isFinite(cost)) return Number.POSITIVE_INFINITY;
  // Traffic is a preference, not a wall: a corridor packed with friendly
  // units must still be usable, just less attractive than an open lane.
  const traffic = nav.soft?.[to] ? 2.5 : 1;
  return cost * (diagonal ? 1.41421356 : 1) * traffic;
}

/** True if diagonal movement between two tiles would clip a blocked corner. */
function diagonalBlocked(nav: NavGrid, from: number, to: number): boolean {
  const fx = from % nav.width;
  const fz = (from / nav.width) | 0;
  const tx = to % nav.width;
  const tz = (to / nav.width) | 0;
  const a = tileIndex(nav.width, tx, fz);
  const b = tileIndex(nav.width, fx, tz);
  if (!Number.isFinite(stepCost(nav, from, a, false))) return true;
  if (!Number.isFinite(stepCost(nav, from, b, false))) return true;
  return false;
}

function heuristic(nav: NavGrid, a: number, b: number): number {
  const ax = a % nav.width;
  const az = (a / nav.width) | 0;
  const bx = b % nav.width;
  const bz = (b / nav.width) | 0;
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz);
}

/** Find the closest usable tile around a goal, searching outward deterministically. */
export function nearestWalkable(
  nav: NavGrid,
  gx: number,
  gz: number,
  maxRadius = 8,
): number | null {
  if (!inBounds(nav.width, nav.height, gx, gz)) return null;
  const startIndex = tileIndex(nav.width, gx, gz);
  if (
    Number.isFinite(
      moveCost(
        nav.width,
        nav.height,
        nav.terrain,
        nav.elevation,
        gx,
        gz,
        gx,
        gz,
        nav.moveClass,
      ),
    ) &&
    !nav.occupied?.[startIndex]
  ) {
    return startIndex;
  }
  for (let radius = 1; radius <= maxRadius; radius++) {
    let best: number | null = null;
    let bestDist = Infinity;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = gx + dx;
        const z = gz + dz;
        if (!inBounds(nav.width, nav.height, x, z)) continue;
        const i = tileIndex(nav.width, x, z);
        if (nav.occupied?.[i]) continue;
        const cost = moveCost(
          nav.width,
          nav.height,
          nav.terrain,
          nav.elevation,
          x,
          z,
          x,
          z,
          nav.moveClass,
        );
        if (!Number.isFinite(cost)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
    }
    if (best !== null) return best;
  }
  return null;
}

/**
 * Deterministic A*. Returns tile-centre waypoints, or null if unreachable.
 * The start tile itself is omitted from the result.
 */
export function findPath(
  nav: NavGrid,
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
  maxNodes = 12000,
): PathPoint[] | null {
  const { width, height } = nav;
  if (!inBounds(width, height, startX, startZ)) return null;
  const start = tileIndex(width, startX, startZ);
  const goal = nearestWalkable(nav, goalX, goalZ);
  if (goal === null) return null;
  if (start === goal) return [];

  const total = width * height;
  const gScore = new Float32Array(total);
  gScore.fill(Infinity);
  const cameFrom = new Int32Array(total);
  cameFrom.fill(-1);
  const closed = new Uint8Array(total);
  const open = new MinHeap();
  gScore[start] = 0;
  open.push({ index: start, f: heuristic(nav, start, goal) });
  let expanded = 0;
  let found = false;

  while (open.size > 0) {
    const current = open.pop()!;
    const cur = current.index;
    if (closed[cur]) continue;
    if (cur === goal) {
      found = true;
      break;
    }
    closed[cur] = 1;
    if (++expanded > maxNodes) break;
    const cx = cur % width;
    const cz = (cur / width) | 0;
    for (const [dx, dz, diag] of NEIGHBOURS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!inBounds(width, height, nx, nz)) continue;
      const ni = tileIndex(width, nx, nz);
      if (closed[ni]) continue;
      const cost = stepCost(nav, cur, ni, diag === 1.41421356);
      if (!Number.isFinite(cost)) continue;
      if (diag === 1.41421356 && diagonalBlocked(nav, cur, ni)) continue;
      const tentative = gScore[cur] + cost;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        cameFrom[ni] = cur;
        open.push({ index: ni, f: tentative + heuristic(nav, ni, goal) });
      }
    }
  }

  if (!found) return null;
  const tiles: number[] = [];
  let cur = goal;
  while (cur !== start && cur >= 0) {
    tiles.push(cur);
    cur = cameFrom[cur];
  }
  if (cur !== start) return null;
  tiles.reverse();
  return smoothPath(nav, start, tiles);
}

function lineClear(nav: NavGrid, fromTile: number, toTile: number): boolean {
  let x0 = fromTile % nav.width;
  let z0 = (fromTile / nav.width) | 0;
  const x1 = toTile % nav.width;
  const z1 = (toTile / nav.width) | 0;
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  let prev = fromTile;
  while (true) {
    if (x0 === x1 && z0 === z1) return true;
    const e2 = 2 * err;
    let nextX = x0;
    let nextZ = z0;
    if (e2 > -dz) {
      err -= dz;
      nextX += sx;
    }
    if (e2 < dx) {
      err += dx;
      nextZ += sz;
    }
    const next = tileIndex(nav.width, nextX, nextZ);
    const diagonal = nextX !== x0 && nextZ !== z0;
    if (diagonal && diagonalBlocked(nav, prev, next)) return false;
    if (!Number.isFinite(stepCost(nav, prev, next, diagonal))) return false;
    prev = next;
    x0 = nextX;
    z0 = nextZ;
  }
}

function smoothPath(nav: NavGrid, start: number, tiles: number[]): PathPoint[] {
  const anchors = [start, ...tiles];
  const kept: number[] = [];
  let i = 0;
  while (i < anchors.length - 1) {
    let next = i + 1;
    // Look ahead as far as line of sight allows (bounded for predictable cost).
    for (let j = Math.min(anchors.length - 1, i + 12); j > i + 1; j--) {
      if (lineClear(nav, anchors[i], anchors[j])) {
        next = j;
        break;
      }
    }
    kept.push(anchors[next]);
    i = next;
  }
  return kept.map((tile) => ({
    x: ((tile % nav.width) + 0.5) * TILE_SIZE,
    z: (((tile / nav.width) | 0) + 0.5) * TILE_SIZE,
  }));
}

/** Path length in world units, for diagnostics and AI evaluation. */
export function pathLength(path: PathPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  }
  return total;
}
