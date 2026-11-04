import { MeshBuilder, PALETTE } from './geometry';
import type { MeshBuffers } from './gl';

/**
 * Physical retrofits, not badges.
 *
 * A researched module is installed on one individual structure, so the model
 * has to change on that structure alone. Each module owns a compact piece of
 * hardware authored inside the building's existing footprint: the Advanced
 * Turbine adds a second turbine skid, intake and exhaust to the power plant's
 * roof. Nothing here moves the footprint, the flag mount, the turret hardpoint
 * or the health-bar anchor, and no new draw call is added when no module is
 * installed.
 */

const CACHE = new Map<string, MeshBuffers | null>();

/**
 * The Advanced Turbine skid sits on the unused rear corner of the turbine hall
 * roof, mirrors the plant's existing steel/olive palette, and stays below the
 * exhaust stacks that define the structure's top band.
 */
function buildAdvancedTurbine(): MeshBuffers {
  const b = new MeshBuilder();
  // Mounting plinth bedded onto the roof plate.
  b.box(-4.25, 4.02, -3.45, 2.4, 0.16, 2.2, PALETTE.hullDark);
  b.box(-4.25, 4.12, -3.45, 2.2, 0.1, 2.0, PALETTE.darkMetal);
  // Turbine enclosure with a louvered intake facing the yard.
  b.box(-4.25, 4.78, -3.45, 2.2, 1.5, 1.9, PALETTE.oliveDark);
  b.box(-4.25, 5.55, -3.45, 2.32, 0.12, 2.02, PALETTE.olive);
  for (let i = 0; i < 5; i++) {
    b.box(-4.25, 4.24 + i * 0.2, -4.42, 1.7, 0.11, 0.07, PALETTE.metal);
  }
  // Exhaust stack and its banded cap, kept under the plant's own stack tops.
  b.cylinder(-3.25, 5.35, -4.05, 0.3, 1.0, 8, PALETTE.hullLight);
  b.cylinder(-3.25, 5.78, -4.05, 0.34, 0.14, 8, PALETTE.metal);
  b.box(-3.25, 5.15, -4.05, 0.72, 0.1, 0.72, PALETTE.warning);
  // Feed duct and insulated pipe tying the skid back into the hall.
  b.box(-2.85, 4.45, -2.9, 1.2, 0.5, 0.62, PALETTE.metal);
  b.box(-2.85, 4.72, -2.9, 1.28, 0.08, 0.7, PALETTE.darkMetal);
  b.cylinderX(-2.0, 4.18, -4.35, 0.16, 1.7, 6, PALETTE.darkMetal);
  b.box(-4.45, 5.68, -3.45, 0.26, 0.12, 0.26, PALETTE.amber);
  return b.build();
}

/**
 * Geometry for one installed module on one structure, or undefined when that
 * module has no authored retrofit there. Callers draw nothing in that case, so
 * an unsupported pairing can never hoist unrelated geometry onto a building.
 */
export function buildingModuleMesh(defId: string, moduleId: string): MeshBuffers | undefined {
  const key = `${defId}:${moduleId}`;
  const cached = CACHE.get(key);
  if (cached !== undefined) return cached ?? undefined;
  let mesh: MeshBuffers | null = null;
  if (defId === 'powerPlant' && moduleId === 'advancedTurbine') {
    mesh = buildAdvancedTurbine();
  }
  CACHE.set(key, mesh);
  return mesh ?? undefined;
}

/** Test hook: the module cache must not hide an authored geometry change. */
export function clearBuildingModuleCache(): void {
  CACHE.clear();
}
