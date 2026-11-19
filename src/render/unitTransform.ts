import { rotateLocalOffset } from '../core/math';
import {
  multiply,
  rotationX,
  rotationY,
  rotationZ,
  scaling,
  translation,
  type Vec3,
} from './math';
import type { InfectedGaitPose } from './infectedGait';

/**
 * Heading the body mesh is drawn on. A turreted hull keeps its own heading
 * while the turret lays on a target. A turretless ground unit aims with the
 * whole body, so it follows the weapon heading. An airframe always follows its
 * flight heading: aircraft have no traversing turret in the update loop, and
 * using the stale turret angle left them flying sideways.
 */
export function unitBodyHeading(
  hasTurret: boolean,
  isAirframe: boolean,
  facing: number,
  turretFacing: number,
): number {
  return hasTurret || isAirframe ? facing : turretFacing;
}

/**
 * Heading the hull mesh is actually drawn on, including the travel correction.
 *
 * A driving vehicle is drawn on the direction it is moving rather than the
 * simulated heading it is still easing toward. Every pass that draws the hull —
 * the lit model and its shadow — must ask this same question, or one of them
 * turns early and the shadow slides out from under the vehicle.
 */
export function unitDrawnBodyHeading(
  hasTurret: boolean,
  isAirframe: boolean,
  moveClass: string | undefined,
  facing: number,
  turretFacing: number,
  motion: number,
  moving: boolean,
): number {
  if (!isAirframe && moving && moveClass !== 'foot') return motion;
  return unitBodyHeading(hasTurret, isAirframe, facing, turretFacing);
}

/**
 * Model matrix for an infected body in mid-stride.
 *
 * The origin of every unit mesh sits on the ground, so rotating about it rocks
 * the body on its feet rather than swinging it around a waist it does not have.
 * Local +X is forward: the wobble is a yaw sway, the roll turns the trunk about
 * its own spine, and the stoop and lurch tip it about the lateral axis. Positive
 * `lean`/`pitch` mean "leans forward", so the Z rotation is negated — a
 * positive `rotationZ` raises +X toward +Y, which is leaning back.
 *
 * Presentation only: the renderer calls this for a unit whose style carries an
 * infected gait, and the simulation never learns the body moved.
 */
export function gaitModelMatrix(
  x: number,
  y: number,
  z: number,
  facing: number,
  uniform: number,
  pose: InfectedGaitPose,
): Float32Array {
  const base = translation(x, y + pose.bob, z);
  const stoop = rotationZ(-(pose.lean + pose.pitch));
  return multiply(
    base,
    multiply(
      rotationY(-facing + pose.sway),
      multiply(rotationX(pose.roll), multiply(stoop, scaling(uniform, uniform, uniform))),
    ),
  );
}

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

/**
 * Model matrix for a rotor mounted on an airframe.
 *
 * Same mount convention as a turret — the offset is rotated by the hull heading
 * and the part then spins about its own centre — but the spin axis is the
 * rotor's, not the gun's. A main rotor turns about local +Y; a tail rotor turns
 * about local +Z, the tail boom's lateral axis, so its disc sits in the fin
 * plane instead of lying flat.
 */
export function rotorModelMatrix(
  x: number,
  y: number,
  z: number,
  facing: number,
  offset: Vec3,
  spin: number,
  uniform: number,
  axis: 'y' | 'z' = 'y',
): Float32Array {
  const mount = rotateLocalOffset(offset[0] * uniform, offset[2] * uniform, facing);
  const base = translation(x + mount.x, y + offset[1] * uniform, z + mount.z);
  const spinM = axis === 'y' ? rotationY(spin) : rotationZ(spin);
  return multiply(base, multiply(rotationY(-facing), multiply(spinM, scaling(uniform, uniform, uniform))));
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
  pitch = 0,
  pivot: Vec3 = [0, 0, 0],
): Float32Array {
  const mount = rotateLocalOffset(offset[0], offset[2], facing);
  const yaw = -turretFacing;
  const ct = Math.cos(yaw);
  const st = Math.sin(yaw);
  const m = new Float32Array(16);
  if (pitch === 0) {
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
  // T(mount) * Ry(yaw) * T(pivot) * Rz(pitch) * T(-pivot) * S.
  // The pivot is expressed in the same mesh-local units as the turret geometry,
  // so the launcher hinges at its cradle instead of at the unit origin.
  const base = translation(
    x + mount.x * uniform,
    y + offset[1] * scaleY,
    z + mount.z * uniform,
  );
  const pivotM = translation(pivot[0] * uniform, pivot[1] * scaleY, pivot[2] * uniform);
  const invPivot = translation(-pivot[0] * uniform, -pivot[1] * scaleY, -pivot[2] * uniform);
  const model = multiply(
    base,
    multiply(
      rotationY(yaw),
      multiply(
        pivotM,
        multiply(rotationZ(pitch), multiply(invPivot, scaling(uniform, scaleY, uniform))),
      ),
    ),
  );
  return model;
}
