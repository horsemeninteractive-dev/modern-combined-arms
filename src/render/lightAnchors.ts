import { BUILDINGS } from '../data/buildings';
import { TILE_SIZE } from '../sim/constants';
import { buildingMesh } from './buildingMeshes';
import { unitStyle, unitVisualScale } from './unitMeshes';

/**
 * Headlamp mounts taken from the vehicle models themselves.
 *
 * Model space is local +X forward, so the front face of the hull is simply the
 * largest local X in the body mesh, the half-width the largest |Z|, and the lamp
 * height a fraction of the model's own height. Anchoring to those numbers means
 * each vehicle shows its lights where its model actually has lamps — a truck's
 * bumper lamps, a tank's headlight boxes — instead of at a fixed offset that
 * happens to suit one hull and floats outside the next.
 *
 * Bounds are read once per unit type and cached; the models are static.
 */

export interface LampAnchor {
  /** Distance from the hull centre to the lamp, along the hull's forward axis. */
  forward: number;
  /** Half the lamp separation, along the hull's lateral axis. */
  lateral: number;
  /** Height above the ground, in world units. */
  height: number;
}

const cache = new Map<string, LampAnchor | null>();

export function headlampAnchor(defId: string): LampAnchor | null {
  const hit = cache.get(defId);
  if (hit !== undefined) return hit;
  const style = unitStyle(defId);
  const positions = style?.body.positions;
  if (!positions || positions.length < 3) {
    cache.set(defId, null);
    return null;
  }
  let maxX = -Infinity;
  let maxZ = 0;
  let maxY = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    if (positions[i] > maxX) maxX = positions[i];
    const z = Math.abs(positions[i + 2]);
    if (z > maxZ) maxZ = z;
    if (positions[i + 1] > maxY) maxY = positions[i + 1];
  }
  if (!Number.isFinite(maxX) || maxX <= 0) {
    cache.set(defId, null);
    return null;
  }
  const scale = unitVisualScale(defId);
  const anchor: LampAnchor = {
    // Just inside the front face, so the lens sits on the bodywork.
    forward: maxX * scale * 0.96,
    lateral: Math.max(0.08, maxZ * scale * 0.32),
    height: Math.max(0.2, maxY * scale * 0.42),
  };
  cache.set(defId, anchor);
  return anchor;
}

/** Half-extents of a structure model, in world units, read from its mesh. */
export interface StructureAnchor {
  halfX: number;
  halfZ: number;
  height: number;
}

const structureCache = new Map<string, StructureAnchor>();

/**
 * Where a structure's walls actually are.
 *
 * Structures are drawn at unit scale, so their mesh extents are already world
 * units. Anchoring lamps and windows to those extents is what stops a corner
 * light hanging in the air beside a small model, or sitting inside a large one.
 * The data footprint is only a fallback for a structure with no mesh.
 */
export function structureAnchor(defId: string): StructureAnchor {
  const hit = structureCache.get(defId);
  if (hit) return hit;
  const mesh = buildingMesh(defId);
  const positions = mesh?.positions;
  if (positions && positions.length >= 3) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const heights: number[] = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      heights.push(positions[i + 1]);
    }
    if (Number.isFinite(minX) && maxX > minX && maxZ > minZ) {
      // Wall height, not overall height: a flag mast or an antenna is a handful
      // of vertices on top of a boxy body, and using the topmost one would hang
      // the windows in the air above the roof.
      heights.sort((a, b) => a - b);
      const wallTop = heights[Math.min(heights.length - 1, Math.floor(heights.length * 0.82))];
      const anchor: StructureAnchor = {
        halfX: (maxX - minX) * 0.5,
        halfZ: (maxZ - minZ) * 0.5,
        height: Math.max(1, wallTop),
      };
      structureCache.set(defId, anchor);
      return anchor;
    }
  }
  const footprint = BUILDINGS[defId]?.footprint;
  const fallback: StructureAnchor = {
    halfX: ((footprint?.w ?? 2) * TILE_SIZE) * 0.5,
    halfZ: ((footprint?.h ?? 2) * TILE_SIZE) * 0.5,
    height: 4,
  };
  structureCache.set(defId, fallback);
  return fallback;
}
