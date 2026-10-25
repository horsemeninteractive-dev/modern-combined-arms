import { rotateLocalOffset } from '../core/math';
import type { Vec3 } from './math';

/**
 * Model matrix for a turret sitting on a unit body.
 *
 * The body mesh is drawn with `modelFor(x, y, z, -facing, …)`, which is exactly
 * a rotation of the local axes by +facing (local +X forward, local +Z right).
 * The mount therefore has to use that same rotation: rotating the offset the
 * other way would slide the turret around the hull as the body turns, which is
 * the naval turret defect this function replaces. The turret then yaws about
 * its own pivot by `turretFacing`, in the same angle convention as the hull.
 */
/**
 * Model matrix for a limb hinged at `hip` (local mesh units) and swinging
 * `swing` radians about the local Z axis, which makes the leg travel forward
 * and back along the unit's local +X forward direction.
 */
export function limbModelMatrix(
  x: number,
  y: number,
  z: number,
  facing: number,
  hip: Vec3,
  swing: number,
  uniform: number,
): Float32Array {
  const mount = rotateLocalOffset(hip[0] * uniform, hip[2] * uniform, facing);
  const yaw = -facing;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const c = Math.cos(swing);
  const s = Math.sin(swing);
  const m = new Float32Array(16);
  // Ry(yaw) * S(uniform) * Rz(swing)
  m[0] = uniform * cy * c;
  m[1] = uniform * s;
  m[2] = -uniform * sy * c;
  m[4] = -uniform * cy * s;
  m[5] = uniform * c;
  m[6] = uniform * sy * s;
  m[8] = uniform * sy;
  m[9] = 0;
  m[10] = uniform * cy;
  m[12] = x + mount.x;
  m[13] = y + hip[1] * uniform;
  m[14] = z + mount.z;
  m[15] = 1;
  return m;
}

export function turretModelMatrix(
  x: number,
  y: number,
  z: number,
  facing: number,
  turretFacing: number,
  offset: Vec3,
  uniform: number,
  scaleY: number,
): Float32Array {
  const mount = rotateLocalOffset(offset[0], offset[2], facing);
  const yaw = -turretFacing;
  const ct = Math.cos(yaw);
  const st = Math.sin(yaw);
  const m = new Float32Array(16);
  m[0] = ct * uniform;
  m[2] = -st * uniform;
  m[5] = scaleY;
  m[8] = st * uniform;
  m[10] = ct * uniform;
  m[12] = x + mount.x * uniform;
  m[13] = y + offset[1] * scaleY;
  m[14] = z + mount.z * uniform;
  m[15] = 1;
  return m;
}
