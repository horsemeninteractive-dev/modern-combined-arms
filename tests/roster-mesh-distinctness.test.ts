import { describe, expect, it } from 'vitest';
import { UNITS } from '../src/data/units';
import { unitStyle } from '../src/render/unitMeshes';
import type { MeshBuffers } from '../src/render/gl';

/**
 * Roster silhouette audit.
 *
 * Two units may differ in gun, armour and price and still be unreadable on the
 * battlefield if they draw the same shape, so this test treats a shared mesh as
 * a defect: every unit in the roster has to own its hull and its turret. It also
 * compares normalised occupancy grids, which catches the case that exact mesh
 * comparison misses — a "new" model that is really the old one with a box moved.
 */

function bbox(part: MeshBuffers) {
  const p = part.positions;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]);
    maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]);
    maxY = Math.max(maxY, p[i + 1]);
    minZ = Math.min(minZ, p[i + 2]);
    maxZ = Math.max(maxZ, p[i + 2]);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/** Position digest of a part, used to prove two units are not the same mesh. */
function digest(part: MeshBuffers): string {
  const p = part.positions;
  let hash = 0;
  for (let i = 0; i < p.length; i++) {
    // Quantised so float noise cannot split two identical meshes.
    hash = (hash * 31 + Math.round(p[i] * 1000)) | 0;
  }
  return `${p.length}:${hash}`;
}

const N = 10;

/** Coarse occupancy grid over a part's own bounding box. */
function occupancy(part: MeshBuffers): Uint8Array {
  const b = bbox(part);
  const grid = new Uint8Array(N * N * N);
  const p = part.positions;
  const spanX = b.maxX - b.minX || 1;
  const spanY = b.maxY - b.minY || 1;
  const spanZ = b.maxZ - b.minZ || 1;
  for (let i = 0; i < p.length; i += 3) {
    const ix = Math.min(N - 1, Math.floor(((p[i] - b.minX) / spanX) * N));
    const iy = Math.min(N - 1, Math.floor(((p[i + 1] - b.minY) / spanY) * N));
    const iz = Math.min(N - 1, Math.floor(((p[i + 2] - b.minZ) / spanZ) * N));
    grid[(ix * N + iy) * N + iz] = 1;
  }
  return grid;
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let shared = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) union++;
    if (a[i] && b[i]) shared++;
  }
  return union === 0 ? 1 : shared / union;
}

/**
 * Ceiling for "these read as the same vehicle". A family upgrade (a heavier
 * tank built on the same doctrinal shape) legitimately lands around 0.6; a hull
 * reused from another unit lands at 1.0, and a hull that only had its turret
 * swapped lands far above this bound.
 */
const MAX_HULL_OVERLAP = 0.78;

describe('roster mesh distinctness', () => {
  const ids = Object.keys(UNITS);

  it('gives every unit its own hull mesh', () => {
    const owners = new Map<string, string[]>();
    for (const id of ids) {
      const style = unitStyle(id);
      expect(style, `${id} has no style`).toBeDefined();
      const key = digest(style!.body);
      owners.set(key, [...(owners.get(key) ?? []), id]);
    }
    const shared = [...owners.values()].filter((group) => group.length > 1);
    expect(shared, `shared hulls: ${shared.map((g) => g.join(' = ')).join('; ')}`).toEqual([]);
  });

  it('gives every turreted unit its own turret mesh', () => {
    const owners = new Map<string, string[]>();
    for (const id of ids) {
      const turret = unitStyle(id)?.turret;
      if (!turret) continue;
      const key = digest(turret);
      owners.set(key, [...(owners.get(key) ?? []), id]);
    }
    const shared = [...owners.values()].filter((group) => group.length > 1);
    expect(shared, `shared turrets: ${shared.map((g) => g.join(' = ')).join('; ')}`).toEqual([]);
  });

  it('does not ship two hulls that read as the same silhouette', () => {
    const grids = ids.map((id) => ({ id, grid: occupancy(unitStyle(id)!.body) }));
    const clones: string[] = [];
    for (let i = 0; i < grids.length; i++) {
      for (let j = i + 1; j < grids.length; j++) {
        const score = iou(grids[i].grid, grids[j].grid);
        if (score >= MAX_HULL_OVERLAP) {
          clones.push(`${grids[i].id} ~ ${grids[j].id} (${score.toFixed(2)})`);
        }
      }
    }
    expect(clones).toEqual([]);
  });

  it('keeps every land and naval hull inside its collision footprint', () => {
    for (const id of ids) {
      const def = UNITS[id];
      if (def.domain === 'air') continue;
      const b = bbox(unitStyle(id)!.body);
      // Naval hulls are authored at slipway scale and drawn at 0.7, so compare
      // against the presented footprint rather than the raw mesh.
      const scale = def.domain === 'naval' ? 0.7 : 1;
      const reachX = Math.max(Math.abs(b.minX), Math.abs(b.maxX)) * scale;
      const reachZ = Math.max(Math.abs(b.minZ), Math.abs(b.maxZ)) * scale;
      expect(reachX, `${id} overhangs its footprint in X`).toBeLessThan(def.radius * 1.35);
      expect(reachZ, `${id} overhangs its footprint in Z`).toBeLessThan(def.radius * 1.35);
    }
  });
});
