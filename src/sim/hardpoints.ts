import { rotateLocalOffset } from '../core/math';
import type { UnitDef } from './types';

/**
 * Weapon hardpoint geometry.
 *
 * Convention: world +X east, world +Z south, heading θ along (cos θ, sin θ).
 * A unit's mesh has its nose on local +X and its right side on local +Z, and
 * every muzzle offset in the data files is authored in those local units.
 * Turreted hardpoints are laid along `turretFacing`; fixed-forward ones follow
 * the hull heading. Directions are radians at every boundary.
 */

/** Forward reach used when a unit has no authored hardpoint. */
export function muzzleReach(def: UnitDef | undefined): number {
  return def?.muzzle?.forward ?? 2 + (def?.radius ?? 2) * 0.8;
}

/**
 * Muzzle offset from the entity origin in world XZ. This is the one place the
 * hardpoint is rotated, shared by projectile spawning and any caller that needs
 * to know where the barrel ends.
 */
export function muzzleWorldOffset(
  def: UnitDef | undefined,
  facing: number,
  turretFacing: number,
): { x: number; z: number } {
  const hp = def?.muzzle;
  const heading = hp?.turreted ? turretFacing : facing;
  return rotateLocalOffset(hp?.forward ?? muzzleReach(def), hp?.lateral ?? 0, heading);
}

/** Height of the barrel above the entity's ground position. */
export function muzzleHeight(def: UnitDef | undefined): number {
  return def?.muzzle?.height ?? 1.5;
}
