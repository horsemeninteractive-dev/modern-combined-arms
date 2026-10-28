/**
 * Shared material classes for the mesh and prop programs.
 *
 * The renderer has no UV or tangent path, so materials are identified per
 * vertex and evaluated procedurally in world space. The table is deliberately
 * small: these are the surface families the roster actually uses, not a general
 * PBR framework. Keep ids stable; the meshes bake them into a vertex attribute.
 */
export const MATERIAL = {
  painted: 0,
  bareMetal: 1,
  concrete: 2,
  asphalt: 3,
  rock: 4,
  glass: 5,
  canvas: 6,
  track: 7,
} as const;

export type MaterialId = (typeof MATERIAL)[keyof typeof MATERIAL];

export const MATERIAL_COUNT = 8;

export interface MaterialDef {
  id: MaterialId;
  name: string;
  /** 0 mirror-smooth, 1 fully diffuse. */
  roughness: number;
  /** 0 dielectric, 1 bare metal. */
  metalness: number;
  /** Strength of the procedural albedo/roughness break-up. */
  detail: number;
  /** Scale of the highlight returned by the material. */
  specular: number;
}

/**
 * The values are visual targets for the RTS camera, not measured physical
 * constants. They are shared by buildings, units, roads and props so a piece of
 * concrete reads consistently wherever it appears.
 */
export const MATERIAL_DEFS: readonly MaterialDef[] = [
  { id: MATERIAL.painted, name: 'painted metal', roughness: 0.58, metalness: 0.06, detail: 0.55, specular: 0.34 },
  { id: MATERIAL.bareMetal, name: 'bare metal', roughness: 0.34, metalness: 0.78, detail: 0.4, specular: 0.8 },
  { id: MATERIAL.concrete, name: 'concrete', roughness: 0.9, metalness: 0.0, detail: 0.62, specular: 0.08 },
  { id: MATERIAL.asphalt, name: 'asphalt', roughness: 0.94, metalness: 0.0, detail: 0.68, specular: 0.06 },
  { id: MATERIAL.rock, name: 'rock', roughness: 0.92, metalness: 0.0, detail: 0.82, specular: 0.05 },
  { id: MATERIAL.glass, name: 'glass', roughness: 0.14, metalness: 0.28, detail: 0.04, specular: 1.0 },
  { id: MATERIAL.canvas, name: 'canvas and foliage', roughness: 0.94, metalness: 0.0, detail: 0.3, specular: 0.05 },
  { id: MATERIAL.track, name: 'track and rubber', roughness: 0.86, metalness: 0.16, detail: 0.36, specular: 0.12 },
];

/**
 * One row per material: roughness, metalness, detail and specular, encoded as
 * bytes. A 8x1 texture is cheaper to bind than four uniform arrays and keeps
 * the shader's material lookup data-driven.
 */
export function materialLut(): Uint8Array {
  const data = new Uint8Array(MATERIAL_COUNT * 4);
  for (const def of MATERIAL_DEFS) {
    const o = def.id * 4;
    data[o] = Math.round(def.roughness * 255);
    data[o + 1] = Math.round(def.metalness * 255);
    data[o + 2] = Math.round(def.detail * 255);
    data[o + 3] = Math.round(def.specular * 255);
  }
  return data;
}
