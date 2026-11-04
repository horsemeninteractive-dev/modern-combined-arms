import { BUILDINGS } from '../data/buildings';
import { TILE_SIZE } from '../sim/constants';
import { MeshBuilder, PALETTE } from './geometry';
import { buildingTopHeight } from './buildingMeshes';
import type { MeshBuffers } from './gl';

/**
 * Battle damage as a real model state.
 *
 * A structure's health has to reach the model, not only its bar. Each structure
 * gains a deterministic rubble field around its base as it is worn down, and the
 * renderer chars its tint toward sooty grey. Debris spills just outside the
 * footprint so it is never buried inside the building it fell from; it is
 * presentation only and never changes the data footprint, collision or picking.
 *
 * Geometry is generated from the definition's footprint and a fixed hash of its
 * id, so two command posts look alike and the same command post looks the same
 * after a save round-trip. Nothing here is random at runtime.
 */

export type BuildingDamageStage = 0 | 1 | 2 | 3;

/** Fractions at which the model gains its next layer of damage. */
export const DAMAGE_STAGE_THRESHOLDS: ReadonlyArray<number> = Object.freeze([0.8, 0.5, 0.22]);

/** How far debris may spill outside the data footprint, in world units. */
export const DAMAGE_SPILL = 0.85;

/** Structures whose damage story is already told by another mesh. */
const NO_DAMAGE_MESH = new Set(['ruin', 'bridge']);

export function buildingDamageStage(fraction: number): BuildingDamageStage {
  if (!Number.isFinite(fraction)) return 0;
  const f = Math.max(0, Math.min(1, fraction));
  if (f >= DAMAGE_STAGE_THRESHOLDS[0]) return 0;
  if (f >= DAMAGE_STAGE_THRESHOLDS[1]) return 1;
  if (f >= DAMAGE_STAGE_THRESHOLDS[2]) return 2;
  return 3;
}

/**
 * Char factor applied to the whole structure. Team-coloured panels darken with
 * the walls they are painted on, which is the point: a captured objective at 8%
 * should not still wear a bright ownership band.
 */
export function buildingDamageTint(fraction: number): [number, number, number] {
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 1;
  const burn = Math.max(0, Math.min(1, (0.9 - f) / 0.75));
  return [1 - 0.3 * burn, 1 - 0.36 * burn, 1 - 0.43 * burn];
}

function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Small deterministic generator so a model's debris does not reshuffle. */
function seeded(seed: number): () => number {
  let s = seed || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const MESHES = new Map<string, MeshBuffers | null>();
const ANCHORS = new Map<string, ReadonlyArray<readonly [number, number, number]>>();

interface Extents {
  halfX: number;
  halfZ: number;
  top: number;
}

function extentsFor(defId: string): Extents | null {
  const def = BUILDINGS[defId];
  if (!def) return null;
  return {
    halfX: (def.footprint.w * TILE_SIZE) / 2,
    halfZ: (def.footprint.h * TILE_SIZE) / 2,
    top: Math.max(1.5, buildingTopHeight(defId)),
  };
}

/**
 * A local-space point on one of the four perimeter sides. `along` is signed
 * distance from the side's centre, `out` is distance outside the footprint.
 */
function sidePoint(
  side: number,
  along: number,
  out: number,
  extents: Extents,
): { x: number; z: number; yaw: number } {
  switch (side & 3) {
    case 0:
      return { x: along, z: extents.halfZ + out, yaw: 0 };
    case 1:
      return { x: extents.halfX + out, z: along, yaw: Math.PI / 2 };
    case 2:
      return { x: along, z: -extents.halfZ - out, yaw: 0 };
    default:
      return { x: -extents.halfX - out, z: along, yaw: Math.PI / 2 };
  }
}

/**
 * Deterministic damage geometry for one structure and stage. Stage 0 has no
 * mesh; callers draw the undamaged body alone.
 */
export function buildingDamageMesh(
  defId: string,
  stage: BuildingDamageStage,
): MeshBuffers | undefined {
  if (stage <= 0 || NO_DAMAGE_MESH.has(defId)) return undefined;
  const key = `${defId}:${stage}`;
  const cached = MESHES.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const extents = extentsFor(defId);
  if (!extents) {
    MESHES.set(key, null);
    return undefined;
  }

  const rand = seeded(hashString(`${defId}:${stage}`));
  const b = new MeshBuilder();
  const sideA = Math.floor(rand() * 4);
  const sideB = (sideA + 1 + Math.floor(rand() * 3)) % 4;
  const stages: ReadonlyArray<{ chunks: number; beams: number; rods: number; lift: number }> = [
    { chunks: 0, beams: 0, rods: 0, lift: 0 },
    { chunks: 3, beams: 1, rods: 0, lift: 0.34 },
    { chunks: 7, beams: 2, rods: 2, lift: 0.72 },
    { chunks: 13, beams: 3, rods: 5, lift: 1.2 },
  ];
  const plan = stages[stage];
  const sides = stage >= 2 ? [sideA, sideB] : [sideA];

  for (let index = 0; index < sides.length; index++) {
    const side = sides[index];
    const alongLimit = Math.max(0.8, (side % 2 === 0 ? extents.halfX : extents.halfZ) * 0.66);
    const centreAlong = (rand() * 2 - 1) * alongLimit * 0.45;

    // Scorched ground under the collapse. A hand-thin plate at y=0.02 reads as
    // burnt earth from the tactical camera without competing with terrain.
    const scorch = sidePoint(side, centreAlong, 0.2, extents);
    b.box(scorch.x, 0.02, scorch.z, 2.4 + rand() * 1.4, 0.04, 1.3 + rand() * 0.8, PALETTE.track);

    const share = Math.max(2, Math.round(plan.chunks / sides.length));
    for (let i = 0; i < share; i++) {
      const along = centreAlong + (rand() * 2 - 1) * alongLimit;
      // Debris spills from the base outward: the inner half overlaps the plinth,
      // the outer half reaches just past the footprint edge.
      const out = -0.25 + rand() * (0.4 + DAMAGE_SPILL * (stage / 3));
      const point = sidePoint(side, along, out, extents);
      const size = 0.32 + rand() * (0.26 + stage * 0.16);
      const tall = size * (0.45 + rand() * 0.35);
      // Debris rests on the ground. A settle of a few centimetres keeps the
      // pile from reading as one flat plate without leaving chunks in mid-air.
      const lift = rand() * Math.min(0.1, plan.lift * 0.12);
      const palette = [PALETTE.concreteDark, PALETTE.concrete, PALETTE.hullDark, PALETTE.track];
      b.boxRot(
        point.x,
        lift + tall / 2,
        point.z,
        size,
        tall,
        size * (0.7 + rand() * 0.6),
        (rand() - 0.5) * 0.9,
        palette[Math.floor(rand() * palette.length)],
      );
    }

    // Fallen structural members: long, dark and clearly not terrain clutter.
    for (let i = 0; i < Math.ceil(plan.beams / sides.length); i++) {
      const along = centreAlong + (rand() * 2 - 1) * alongLimit * 0.8;
      const point = sidePoint(side, along, 0.05 + rand() * 0.6, extents);
      const length = 1.2 + rand() * (0.8 + stage * 0.35);
      b.boxRot(
        point.x,
        0.08 + rand() * 0.04,
        point.z,
        length,
        0.12,
        0.14,
        point.yaw + (rand() - 0.5) * 1.1,
        rand() > 0.5 ? PALETTE.darkMetal : PALETTE.hullDark,
      );
    }

    // Exposed reinforcement, only once the structure is failing. It is capped
    // below the structure's own top band so the health-bar anchor still clears
    // the debris it stands in.
    const maxRod = Math.max(0.6, Math.min(extents.top - 0.15, 2.4));
    for (let i = 0; i < Math.ceil(plan.rods / sides.length); i++) {
      const along = centreAlong + (rand() * 2 - 1) * alongLimit;
      const point = sidePoint(side, along, 0.05 + rand() * 0.35, extents);
      const height = Math.min(maxRod, 0.9 + rand() * (0.7 + stage * 0.3));
      b.box(
        point.x,
        height / 2,
        point.z,
        0.06,
        height,
        0.06,
        PALETTE.metal,
      );
    }

    // A slab that has come off the roof and is leaning on the debris pile.
    if (stage >= 2 && index === 0) {
      const point = sidePoint(side, centreAlong, 0.3 + rand() * 0.3, extents);
      b.boxRot(
        point.x,
        0.09 + rand() * 0.05,
        point.z,
        1.1 + rand() * 0.7,
        0.14,
        0.8 + rand() * 0.4,
        (rand() - 0.5) * 0.8,
        PALETTE.concrete,
      );
    }
  }

  const mesh = b.build();
  MESHES.set(key, mesh);
  return mesh;
}

/**
 * Where fire and smoke leave the structure at a given stage. These are local
 * points; the renderer rotates them with the building and adds the terrain
 * height. Stage 1 only gains debris; the plume starts once the structure is
 * failing, so an intact-looking roof is not smoking on its own.
 */
export function buildingDamageAnchors(
  defId: string,
  stage: BuildingDamageStage,
): ReadonlyArray<readonly [number, number, number]> {
  if (stage < 2 || NO_DAMAGE_MESH.has(defId)) return [];
  const key = `${defId}:${stage}`;
  const cached = ANCHORS.get(key);
  if (cached) return cached;
  const extents = extentsFor(defId);
  if (!extents) return [];
  const rand = seeded(hashString(`${defId}:fire:${stage}`));
  const sideA = Math.floor(rand() * 4);
  const sideB = (sideA + 2) % 4;
  const main = sidePoint(sideA, (rand() * 2 - 1) * extents.halfX * 0.3, 0.45, extents);
  const points: Array<readonly [number, number, number]> = [
    [main.x, 0.55 + rand() * 0.45, main.z],
  ];
  if (stage >= 3) {
    const second = sidePoint(sideB, (rand() * 2 - 1) * extents.halfX * 0.35, 0.35, extents);
    points.push([second.x, 0.4 + rand() * 0.3, second.z]);
  }
  const frozen = Object.freeze(points);
  ANCHORS.set(key, frozen);
  return frozen;
}

/** Test and probe hook: the cache must not hide a change in stage geometry. */
export function clearDamageMeshCache(): void {
  MESHES.clear();
  ANCHORS.clear();
}
