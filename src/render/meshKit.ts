import type { MeshBuilder } from './geometry';
import { shade, type Color } from './geometry';
import type { Vec3 } from './math';

/**
 * Rectangular limb between two points. Boxes only rotate in yaw, so angled
 * limbs, aerials, booms and struts need a small oriented prism rather than a
 * chain of axis-aligned blocks. The winding keeps every face outward as the
 * limb changes direction.
 *
 * Lives here rather than in `unitMeshes` so the per-family model modules can
 * share it without each re-deriving the frame maths.
 */
export function beam(
  b: MeshBuilder,
  from: Vec3,
  to: Vec3,
  width: number,
  height: number,
  color: Color,
  team = 0,
): void {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-5) return;
  const d: Vec3 = [dx / length, dy / length, dz / length];
  const ref: Vec3 = Math.abs(d[1]) > 0.85 ? [0, 0, 1] : [0, 1, 0];
  const sx = d[1] * ref[2] - d[2] * ref[1];
  const sy = d[2] * ref[0] - d[0] * ref[2];
  const sz = d[0] * ref[1] - d[1] * ref[0];
  const sl = Math.hypot(sx, sy, sz) || 1;
  const s: Vec3 = [sx / sl, sy / sl, sz / sl];
  const u: Vec3 = [
    s[1] * d[2] - s[2] * d[1],
    s[2] * d[0] - s[0] * d[2],
    s[0] * d[1] - s[1] * d[0],
  ];
  const sw = width / 2;
  const uh = height / 2;
  const at = (p: Vec3, side: number, up: number): Vec3 => [
    p[0] + s[0] * sw * side + u[0] * uh * up,
    p[1] + s[1] * sw * side + u[1] * uh * up,
    p[2] + s[2] * sw * side + u[2] * uh * up,
  ];
  const a0 = at(from, -1, -1);
  const a1 = at(from, 1, -1);
  const a2 = at(from, 1, 1);
  const a3 = at(from, -1, 1);
  const b0 = at(to, -1, -1);
  const b1 = at(to, 1, -1);
  const b2 = at(to, 1, 1);
  const b3 = at(to, -1, 1);
  b.addQuad(a0, a3, a2, a1, color, team);
  b.addQuad(b0, b1, b2, b3, color, team);
  b.addQuad(a0, a1, b1, b0, shade(color, 0.72), team);
  b.addQuad(a3, b3, b2, a2, color, team);
  b.addQuad(a0, b0, b3, a3, shade(color, 0.86), team);
  b.addQuad(a1, a2, b2, b1, shade(color, 0.94), team);
}
