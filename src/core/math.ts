export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(dist2(ax, az, bx, bz));
}

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function angleTo(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(bz - az, bx - ax);
}

/**
 * Rotate a unit-local XZ offset into world XZ.
 *
 * Conventions used everywhere in the project: world +X is east, world +Z is
 * south, a heading points along (cos heading, sin heading), and local +X is
 * forward with local +Z to the unit's right. Radians throughout. The renderer
 * builds its matrices from this same rotation, so a hardpoint cannot drift off
 * its unit body as the body turns.
 */
export function rotateLocalOffset(
  localX: number,
  localZ: number,
  heading: number,
): { x: number; z: number } {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return { x: localX * c - localZ * s, z: localX * s + localZ * c };
}

/** Rotate `current` toward `target` by at most `maxStep` radians. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const diff = normalizeAngle(target - current);
  if (Math.abs(diff) <= maxStep) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(diff) * maxStep);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function manhattan(ax: number, az: number, bx: number, bz: number): number {
  return Math.abs(ax - bx) + Math.abs(az - bz);
}
