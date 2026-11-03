import { MeshBuilder, PALETTE, shade, type Color } from './geometry';
import type { MeshBuffers } from './gl';
import type { Vec3 } from './math';

export interface EntityStyle {
  body: MeshBuffers;
  turret?: MeshBuffers;
  turretOffset: Vec3;
  /** Optional cargo mesh scaled vertically by a 0..1 fill fraction. */
  load?: MeshBuffers;
  /**
   * Visual-only launcher hinge. The turret mesh pitches about this local point
   * when `launcherElevation` is non-zero; simulation hardpoints are unaffected.
   */
  launcherPivot?: Vec3;
  /** Maximum deployment pitch in radians, reached while laying on a target. */
  launcherElevation?: number;
  /**
   * Infantry legs, kept separate from the torso so the renderer can swing them
   * about the hip while the soldier walks. The mesh origin is the hip joint and
   * the geometry hangs down to local Y = 0, which puts the boots on the ground.
   */
  infantry?: { leg: MeshBuffers; hip: Vec3; hipOffset: number };
  /** Periscope and mast shown instead of the hull while the boat is dived. */
  periscope?: MeshBuffers;
  periscopeOffset?: Vec3;
}

const SKIN: Color = [0.55, 0.44, 0.33];
// A lighter khaki than the old dark olive: it separates the human silhouette
// from the Phase 3 grass without relying on team colour alone.
const INFANTRY_UNIFORM: Color = [0.43, 0.43, 0.31];

/**
 * Rectangular limb between two points. Boxes only rotate in yaw, so arms need
 * a small oriented prism rather than a chain of axis-aligned blocks. The
 * winding keeps every face outward as the limb changes direction.
 */
function beam(
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

interface InfantryOptions {
  helmet?: Color;
  pack?: boolean;
  antenna?: boolean;
}

/**
 * Shared anatomy for the two infantry roles in this pass. The old `soldier()`
 * stays in place for the medic, so this silhouette work does not silently
 * restyle a fourth unit.
 */
/**
 * Shared human anatomy, authored in world units. One full figure is 1.2 world
 * units tall (about 2.4 m at the presentation reference of 2 m per world unit),
 * with 47 % of that height in the legs. The deliberate height exaggeration over
 * a 1.8 m adult keeps a rifleman legible at the battle camera; the proportions
 * remain human rather than tank-sized.
 */
function addInfantryBase(
  b: MeshBuilder,
  uniform: Color,
  options: InfantryOptions = {},
): void {
  const helmet = options.helmet ?? PALETTE.canvas;
  // Pelvis, belt and a torso that widens from waist to chest instead of one slab.
  b.box(0, 0.58, 0, 0.16, 0.12, 0.22, PALETTE.oliveDark);
  b.box(0, 0.65, 0, 0.17, 0.05, 0.24, PALETTE.darkMetal);
  b.box(0, 0.74, 0, 0.17, 0.16, 0.24, uniform);
  b.box(0.01, 0.88, 0, 0.19, 0.18, 0.29, uniform);
  // Chest rig, front plate and pouches sit proud of the torso.
  b.box(0.105, 0.88, 0, 0.035, 0.18, 0.24, PALETTE.oliveDark);
  b.box(0.125, 0.84, 0.10, 0.045, 0.07, 0.07, PALETTE.canvas);
  b.box(0.125, 0.84, -0.10, 0.045, 0.07, 0.07, PALETTE.canvas);
  b.box(0.125, 0.96, 0, 0.025, 0.045, 0.12, PALETTE.darkMetal);
  // Shoulder caps, neck and head. The caps share the helmet's team colour so
  // the silhouette reads as one ownership marker from above.
  b.box(0, 0.97, 0.15, 0.15, 0.12, 0.11, uniform, 0.9);
  b.box(0, 0.97, -0.15, 0.15, 0.12, 0.11, uniform, 0.9);
  b.box(0, 1.02, 0, 0.065, 0.05, 0.075, SKIN);
  b.sphere(0.01, 1.08, 0, 0.095, 4, 7, SKIN);
  // A rounded helmet shell with a separate brim, ear covers, NVG mount and
  // goggle strip; the crown is a sphere, not another square block. At battle
  // zoom this crown is the largest readable part of a rifleman, so it carries
  // the full team colour; the shoulder caps below add a second coloured mass
  // without turning the uniform into a flat marker.
  b.sphere(0.005, 1.13, 0, 0.095, 3, 7, helmet, 1);
  b.box(0.085, 1.10, 0, 0.05, 0.035, 0.19, helmet, 1);
  b.box(0.005, 1.08, 0.105, 0.09, 0.06, 0.025, helmet, 0.9);
  b.box(0.005, 1.08, -0.105, 0.09, 0.06, 0.025, helmet, 0.9);
  b.box(0.085, 1.17, 0, 0.03, 0.035, 0.045, PALETTE.darkMetal);
  b.box(0.08, 1.07, 0, 0.02, 0.03, 0.13, PALETTE.glassDark);
  // A raised, team-tinted shoulder patch; the overlay carries the primary
  // team marker, so this is an additional cue rather than the only one.
  b.box(0.005, 0.98, -0.21, 0.075, 0.045, 0.015, uniform, 0.9);
  if (options.pack !== false) {
    b.box(-0.12, 0.82, 0, 0.10, 0.26, 0.19, PALETTE.oliveDark);
    // A painted flap on top of the pack catches the isometric camera even when
    // the helmet is partly hidden by terrain or a nearby vehicle.
    b.box(-0.12, 0.958, 0, 0.105, 0.018, 0.185, PALETTE.canvas, 0.95);
    b.cylinderZ(-0.16, 0.94, 0, 0.05, 0.14, 5, PALETTE.canvas);
    b.box(-0.16, 0.82, 0.09, 0.06, 0.14, 0.06, PALETTE.oliveDark);
    b.box(-0.16, 0.82, -0.09, 0.06, 0.14, 0.06, PALETTE.oliveDark);
    b.box(-0.07, 0.88, 0.13, 0.015, 0.18, 0.015, PALETTE.darkMetal);
    b.box(-0.07, 0.88, -0.13, 0.015, 0.18, 0.015, PALETTE.darkMetal);
  }
  if (options.antenna) {
    b.box(-0.14, 1.08, -0.08, 0.018, 0.34, 0.018, PALETTE.metal);
  }
}

function addArm(
  b: MeshBuilder,
  shoulder: Vec3,
  elbow: Vec3,
  hand: Vec3,
  uniform: Color,
): void {
  beam(b, shoulder, elbow, 0.075, 0.075, uniform);
  beam(b, elbow, hand, 0.065, 0.065, uniform);
  b.box(hand[0], hand[1], hand[2], 0.075, 0.06, 0.07, PALETTE.darkMetal);
}

function addRifle(b: MeshBuilder): void {
  // A 1.0 m rifle: stock, receiver, handguard, magazine, optic and muzzle.
  // The tip lands on `muzzle.forward` (0.30 world) without a visual-only offset.
  b.box(-0.15, 0.935, 0.25, 0.10, 0.045, 0.045, PALETTE.oliveDark);
  b.box(-0.03, 0.96, 0.25, 0.14, 0.055, 0.055, PALETTE.darkMetal);
  b.box(0.11, 0.96, 0.25, 0.14, 0.045, 0.05, PALETTE.oliveDark);
  b.box(-0.06, 0.92, 0.25, 0.035, 0.08, 0.04, PALETTE.darkMetal);
  b.box(0.00, 0.90, 0.25, 0.035, 0.09, 0.04, PALETTE.darkMetal);
  b.box(0.06, 1.00, 0.25, 0.05, 0.025, 0.03, PALETTE.darkMetal);
  b.box(0.075, 1.005, 0.25, 0.018, 0.018, 0.022, PALETTE.glass);
  b.cylinderX(0.23, 0.96, 0.25, 0.012, 0.10, 5, PALETTE.darkMetal);
  b.box(0.285, 0.96, 0.25, 0.02, 0.032, 0.032, PALETTE.darkMetal);
  b.box(0.14, 0.935, 0.27, 0.08, 0.025, 0.018, PALETTE.oliveDark);
  b.box(0.16, 0.985, 0.27, 0.06, 0.012, 0.012, PALETTE.darkMetal);
}

function addAtgmLauncher(b: MeshBuilder): void {
  // A carried 1.5 m tube. Its tip is the authored 0.45 world hardpoint; the
  // launcher is deliberately shorter than the old 3 m prop.
  b.cylinderX(0.05, 0.90, 0.24, 0.045, 0.72, 8, PALETTE.hullDark);
  b.cylinderX(-0.33, 0.90, 0.24, 0.060, 0.06, 8, PALETTE.darkMetal);
  b.cylinderX(-0.37, 0.90, 0.24, 0.040, 0.02, 8, PALETTE.track);
  b.cylinderX(0.43, 0.90, 0.24, 0.050, 0.04, 8, PALETTE.darkMetal);
  b.cylinderX(0.455, 0.90, 0.24, 0.032, 0.05, 5, PALETTE.warning);
  b.box(0.04, 1.00, 0.24, 0.08, 0.045, 0.05, PALETTE.darkMetal);
  b.box(0.055, 1.005, 0.24, 0.018, 0.018, 0.028, PALETTE.glass);
  b.box(-0.10, 0.82, 0.24, 0.035, 0.08, 0.04, PALETTE.darkMetal);
  b.box(0.20, 0.82, 0.24, 0.035, 0.08, 0.04, PALETTE.darkMetal);
  b.box(-0.04, 0.86, 0.17, 0.16, 0.035, 0.08, PALETTE.oliveDark);
  b.box(0.15, 0.92, 0.24, 0.06, 0.03, 0.06, PALETTE.darkMetal);
  b.box(0.28, 0.95, 0.27, 0.05, 0.025, 0.025, PALETTE.oliveDark);
}

/** One leg, origin at the hip joint, boot sole at local Y = -HIP_Y. */
function buildInfantryLeg(): MeshBuffers {
  const b = new MeshBuilder();
  // Thigh, knee pad, shin, ankle and a forward boot; the sole is exactly on
  // the terrain plane when the hip is mounted at HIP_Y.
  b.box(0, -0.14, 0, 0.11, 0.26, 0.12, PALETTE.oliveDark);
  b.box(0.03, -0.29, 0.005, 0.10, 0.06, 0.13, PALETTE.hullDark);
  b.box(0.04, -0.29, 0.065, 0.09, 0.06, 0.025, PALETTE.hullDark);
  b.box(0.01, -0.39, 0, 0.095, 0.18, 0.11, PALETTE.olive);
  b.box(0.02, -0.49, 0, 0.08, 0.08, 0.10, PALETTE.oliveDark);
  b.box(0.06, -0.535, 0, 0.18, 0.07, 0.11, PALETTE.darkMetal);
  b.box(0.145, -0.535, 0, 0.045, 0.05, 0.09, PALETTE.darkMetal);
  return b.build();
}

// Hip height in the torso mesh, and how far apart the legs sit.
const HIP_Y = 0.57;
const HIP_Z = 0.09;
const LEG_MESH = buildInfantryLeg();

function infantryRig(): NonNullable<EntityStyle['infantry']> {
  return { leg: LEG_MESH, hip: [0, HIP_Y, HIP_Z], hipOffset: HIP_Y };
}function buildRifle(): MeshBuffers {
  const b = new MeshBuilder();
  addInfantryBase(b, INFANTRY_UNIFORM);
  addRifle(b);
  // Rear hand on the pistol grip, support hand under the handguard. The
  // weapon sits outside the torso so its profile is visible from the tactical
  // camera instead of being buried in the chest.
  addArm(b, [0, 0.97, 0.14], [0.03, 0.86, 0.15], [-0.04, 0.94, 0.25], INFANTRY_UNIFORM);
  addArm(b, [0, 0.97, -0.14], [0.10, 0.90, 0.06], [0.16, 0.95, 0.25], INFANTRY_UNIFORM);
  return b.build();
}

function buildAtgm(): MeshBuffers {
  const b = new MeshBuilder();
  addInfantryBase(b, INFANTRY_UNIFORM, { antenna: true });
  addAtgmLauncher(b);
  // Trigger hand and forward support hand under the tube.
  addArm(b, [0, 0.97, 0.14], [0.04, 0.84, 0.18], [0.15, 0.83, 0.24], INFANTRY_UNIFORM);
  addArm(b, [0, 0.97, -0.14], [0.08, 0.92, 0.08], [0.03, 0.98, 0.21], INFANTRY_UNIFORM);
  return b.build();
}

function buildMedic(): MeshBuffers {
  const b = new MeshBuilder();
  addInfantryBase(b, INFANTRY_UNIFORM, { pack: false });
  // White helmet band and a medical satchel with a red cross make the medic
  // read apart from a rifleman at RTS zoom, using the same anatomy.
  b.box(0.005, 1.155, 0, 0.18, 0.03, 0.20, PALETTE.white);
  b.box(-0.10, 0.76, 0.13, 0.10, 0.20, 0.09, PALETTE.white);
  b.box(-0.155, 0.76, 0.13, 0.02, 0.10, 0.03, PALETTE.red);
  b.box(-0.155, 0.76, 0.13, 0.02, 0.03, 0.07, PALETTE.red);
  addArm(b, [0, 0.97, 0.14], [0.02, 0.80, 0.16], [0.04, 0.68, 0.16], INFANTRY_UNIFORM);
  addArm(b, [0, 0.97, -0.14], [0.02, 0.80, -0.16], [0.04, 0.68, -0.16], INFANTRY_UNIFORM);
  return b.build();
}

/**
 * Armoured combat engineer. A tracked carrier with a full-width dozer blade,
 * a rear A-frame crane and a cab that sits over the front track section. The
 * blade and crane make the construction role readable without a turret.
 */
function buildEngineer(): MeshBuffers {
  const b = new MeshBuilder();
  addTrackedRunningGear(b, {
    front: 2.25,
    rear: -1.95,
    halfTrack: 0.61,
    trackWidth: 0.30,
    wheelCount: 6,
    wheelStart: -1.28,
    wheelEnd: 1.70,
    wheelRadius: 0.20,
  });
  b.box(0.05, 0.51, 0, 3.55, 0.32, 1.16, PALETTE.hullDark);
  b.box(0.00, 0.72, 0, 3.44, 0.18, 1.26, PALETTE.hull);
  b.box(-0.50, 0.83, 0, 2.25, 0.05, 1.18, PALETTE.hullDark);
  b.addQuad(
    [1.28, 0.82, -0.63],
    [1.28, 0.82, 0.63],
    [1.55, 0.56, 0.54],
    [1.55, 0.56, -0.54],
    PALETTE.hullLight,
  );
  // Cab, raked glazing, roof hatch and brush bar. The cab is supported by the
  // front track section rather than overhanging it.
  b.box(1.02, 1.01, 0, 0.82, 0.42, 1.10, PALETTE.hullLight);
  b.box(1.02, 1.26, 0, 0.92, 0.14, 1.18, PALETTE.hull);
  b.box(1.45, 1.02, 0, 0.04, 0.27, 0.94, PALETTE.glassDark);
  b.box(1.47, 1.03, 0, 0.02, 0.20, 0.82, PALETTE.glass);
  b.box(1.12, 1.36, 0, 0.34, 0.05, 0.34, PALETTE.hullDark);
  b.box(1.02, 1.392, 0, 0.68, 0.018, 0.72, PALETTE.hull, 0.9);
  b.box(1.10, 1.42, 0, 0.10, 0.07, 0.12, PALETTE.darkMetal);
  b.box(-0.50, 0.865, 0, 1.45, 0.02, 1.00, PALETTE.hull, 0.88);
  for (const z of [-0.34, 0.34]) {
    b.box(1.43, 0.82, z, 0.04, 0.12, 0.16, PALETTE.glassDark);
    b.box(1.50, 0.55, z * 1.15, 0.12, 0.12, 0.13, PALETTE.metal);
  }
  for (const z of [-0.44, 0.44]) {
    b.box(1.49, 0.96, z, 0.035, 0.52, 0.035, PALETTE.metal);
  }
  b.box(1.49, 1.21, 0, 0.035, 0.035, 0.98, PALETTE.metal);
  // Replaceable dozer blade, arms and cutting edge. The blade is wider than the
  // hull and sits low enough to read as earthmoving equipment.
  b.addQuad(
    [2.18, 0.20, -1.24],
    [2.18, 0.20, 1.24],
    [2.52, 0.60, 1.12],
    [2.52, 0.60, -1.12],
    PALETTE.metal,
  );
  b.addQuad(
    [2.18, 0.20, 1.24],
    [2.18, 0.20, -1.24],
    [2.18, 0.60, -1.12],
    [2.18, 0.60, 1.12],
    PALETTE.hullDark,
  );
  b.box(2.52, 0.15, 0, 0.10, 0.10, 2.30, PALETTE.darkMetal);
  for (const z of [-0.82, 0.82]) {
    b.box(1.96, 0.43, z, 0.62, 0.15, 0.14, PALETTE.darkMetal);
    b.box(2.20, 0.41, z, 0.12, 0.26, 0.12, PALETTE.metal);
  }
  // Rear winch and A-frame crane with a boom, cable and hook.
  b.box(-1.40, 0.98, 0, 0.56, 0.50, 0.86, PALETTE.hullDark);
  b.cylinderZ(-1.42, 0.92, 0, 0.20, 0.52, 8, PALETTE.darkMetal);
  beam(b, [-1.18, 1.12, -0.42], [-1.48, 2.30, -0.42], 0.16, 0.16, PALETTE.metal);
  beam(b, [-1.18, 1.12, 0.42], [-1.48, 2.30, 0.42], 0.16, 0.16, PALETTE.metal);
  beam(b, [-1.28, 2.12, 0], [-2.18, 2.38, 0], 0.18, 0.18, PALETTE.warning);
  b.box(-1.32, 2.26, 0, 0.16, 0.10, 0.16, PALETTE.darkMetal);
  b.box(-2.15, 1.98, 0, 0.025, 0.72, 0.025, PALETTE.metal);
  b.box(-2.15, 1.58, 0, 0.22, 0.18, 0.22, PALETTE.metal);
  b.box(-2.15, 1.47, 0, 0.10, 0.06, 0.10, PALETTE.darkMetal);
  // Side lockers, pioneer tools, spare track and team recognition panels.
  for (const z of [-0.565, 0.565]) {
    b.box(-0.30, 0.78, z, 1.55, 0.16, 0.025, PALETTE.hull, 0.85);
    b.box(-0.42, 0.72, z * 1.05, 0.48, 0.22, 0.10, PALETTE.oliveDark);
    b.box(0.54, 0.74, z * 1.04, 0.44, 0.24, 0.08, PALETTE.oliveDark);
    b.cylinderX(0.08, 0.93, z * 1.03, 0.035, 0.70, 5, PALETTE.canvas);
    b.box(-0.88, 0.78, z * 1.04, 0.36, 0.10, 0.30, PALETTE.track);
  }
  for (const z of [-0.58, 0.58]) {
    b.box(-1.92, 0.70, z, 0.03, 0.09, 0.12, PALETTE.red);
  }
  b.box(-1.92, 0.62, 0, 0.08, 0.12, 0.60, PALETTE.darkMetal);
  b.box(-1.92, 0.30, 0, 0.22, 0.08, 0.98, PALETTE.metal);
  b.cylinderZ(-1.72, 0.88, 0.44, 0.16, 0.26, 8, PALETTE.oliveDark);
  return b.build();
}

/**
 * Polish national MBT turret. The hull is the shared MBT hull, which is a
 * genuine common component; the wedge-shaped add-on armour, larger gun and
 * commander's remote sight make the variant's silhouette distinct.
 */
function buildSpearheadTurret(): MeshBuffers {
  const b = new MeshBuilder();
  // Faceted turret shell with a wider rear bustle and narrow front cheeks.
  const y0 = 0.02;
  const y1 = 0.31;
  b.addQuad([-0.82, y0, -0.52], [0.50, y0, -0.52], [0.38, y1, -0.40], [-0.72, y1, -0.40], PALETTE.hull);
  b.addQuad([-0.82, y0, 0.52], [-0.72, y1, 0.40], [0.38, y1, 0.40], [0.50, y0, 0.52], PALETTE.hull);
  b.addQuad([-0.82, y0, -0.52], [-0.82, y0, 0.52], [-0.72, y1, 0.40], [-0.72, y1, -0.40], PALETTE.hullDark);
  b.addQuad([0.50, y0, -0.52], [0.38, y1, -0.40], [0.38, y1, 0.40], [0.50, y0, 0.52], PALETTE.hullDark);
  b.addQuad([-0.72, y1, -0.40], [0.38, y1, -0.40], [0.38, y1, 0.40], [-0.72, y1, 0.40], PALETTE.hullLight);
  b.box(-0.18, y1 + 0.015, 0, 0.78, 0.03, 0.70, PALETTE.hull, 0.9);
  // Wedge add-on armour across the cheeks and flanks.
  for (const z of [-0.40, 0.40]) {
    b.addQuad([0.50, 0.04, z], [0.08, 0.04, z * 1.25], [0.14, 0.28, z * 1.30], [0.52, 0.26, z], PALETTE.hullDark);
    b.addQuad([0.08, 0.04, z * 1.25], [0.06, 0.32, z * 1.33], [0.14, 0.28, z * 1.30], [0.08, 0.04, z * 1.25], PALETTE.oliveDark);
  }
  for (const z of [-0.53, 0.53]) {
    for (let i = 0; i < 3; i++) {
      b.box(-0.55 + i * 0.34, 0.20, z, 0.30, 0.22, 0.035, PALETTE.oliveDark);
    }
    b.box(-0.10, 0.19, z * 1.03, 0.88, 0.055, 0.02, PALETTE.hull, 0.82);
  }
  // Breech, thermal-sleeved gun and muzzle brake. Tip lands on 2.20 local.
  b.box(0.50, 0.20, 0, 0.48, 0.40, 0.52, PALETTE.hullDark);
  b.cylinderX(1.34, 0.20, 0, 0.070, 1.28, 8, PALETTE.darkMetal);
  b.cylinderX(1.48, 0.20, 0, 0.095, 0.58, 8, PALETTE.hullDark);
  b.cylinderX(2.12, 0.20, 0, 0.085, 0.14, 8, PALETTE.darkMetal);
  b.cylinderX(2.18, 0.20, 0, 0.045, 0.035, 8, PALETTE.track);
  // Commander's independent sight, gunner's optic and hatch.
  b.box(-0.30, 0.43, 0.24, 0.16, 0.22, 0.18, PALETTE.hullDark);
  b.box(-0.25, 0.47, 0.24, 0.08, 0.08, 0.10, PALETTE.glassDark);
  b.cylinder(-0.38, 0.38, -0.24, 0.14, 0.08, 10, PALETTE.hull);
  b.cylinder(-0.38, 0.44, -0.24, 0.10, 0.035, 10, PALETTE.hullDark);
  b.box(0.10, 0.345, -0.30, 0.16, 0.055, 0.10, PALETTE.glassDark);
  for (const z of [-0.50, 0.50]) {
    for (const dz of [-0.05, 0.05]) {
      b.cylinderX(0.43, 0.30, z + dz, 0.028, 0.12, 4, PALETTE.darkMetal);
    }
  }
  // Bustle stowage and a tall antenna.
  b.box(-0.82, 0.22, 0, 0.34, 0.26, 0.86, PALETTE.oliveDark);
  b.box(-0.96, 0.42, -0.26, 0.012, 0.42, 0.012, PALETTE.metal);
  return b.build();
}

/**
 * Main-battle-tank hull, authored in world units at 1:1. The 3.4-unit hull is
 * 6.8 m at the 2 m/world-unit reference; the 1.86-unit track span is 3.7 m.
 * The legacy `buildTankBody()` stays in place for the artillery and national
 * variants, so this pass does not silently reskin four other vehicles.
 */
function buildMbtBody(): MeshBuffers {
  const b = new MeshBuilder();
  for (const side of [-1, 1]) {
    const z = 0.70 * side;
    b.box(0, 0.18, z, 3.30, 0.36, 0.28, PALETTE.track);
    // Segmented top run and six road wheels; the track is still one mesh.
    for (let i = 0; i < 8; i++) {
      b.box(-1.45 + i * 0.414, 0.37, z, 0.32, 0.05, 0.28, PALETTE.darkMetal);
    }
    for (let i = 0; i < 6; i++) {
      b.cylinderZ(-1.25 + i * 0.50, 0.19, z, 0.18, 0.28, 8, PALETTE.darkMetal);
    }
    b.cylinderZ(-1.55, 0.20, z, 0.20, 0.28, 8, PALETTE.track);
    b.cylinderZ(1.55, 0.20, z, 0.20, 0.28, 8, PALETTE.track);
    // Side skirt over the top run, leaving the suspension visible below.
    b.box(0, 0.54, z * 1.14, 3.0, 0.20, 0.06, PALETTE.hullDark);
    b.box(0, 0.70, z * 1.08, 3.2, 0.06, 0.24, PALETTE.hullDark);
  }
  b.box(0, 0.50, 0, 3.0, 0.34, 1.30, PALETTE.hullDark);
  b.box(0, 0.78, 0, 2.92, 0.28, 1.42, PALETTE.hull);
  // Sloped glacis and rear plate, with the lower front plate closing the nose.
  b.addQuad(
    [1.46, 0.92, -0.71],
    [1.46, 0.92, 0.71],
    [1.68, 0.68, 0.68],
    [1.68, 0.68, -0.68],
    PALETTE.hullLight,
  );
  b.box(1.56, 0.54, 0, 0.24, 0.28, 1.30, PALETTE.hullDark);
  b.addQuad(
    [-1.46, 0.92, -0.71],
    [-1.46, 0.92, 0.71],
    [-1.70, 0.72, 0.66],
    [-1.70, 0.72, -0.66],
    PALETTE.hullDark,
  );
  // Engine deck with cooling louvres.
  b.box(-1.15, 0.94, 0, 0.64, 0.05, 1.26, PALETTE.hullDark);
  for (let i = 0; i < 4; i++) {
    b.box(-1.38 + i * 0.15, 0.975, 0, 0.045, 0.035, 1.04, PALETTE.darkMetal);
  }
  b.box(-1.40, 0.88, 0.62, 0.32, 0.18, 0.26, PALETTE.metal);
  // Headlights, tow hooks and stowage on the fenders.
  for (const z of [-0.52, 0.52]) {
    b.box(1.63, 0.78, z, 0.08, 0.12, 0.18, PALETTE.glassDark);
    b.box(1.73, 0.42, z * 0.92, 0.16, 0.14, 0.14, PALETTE.metal);
  }
  b.box(0.42, 0.79, 0.76, 0.46, 0.14, 0.22, PALETTE.oliveDark);
  b.box(-0.35, 0.79, -0.78, 0.52, 0.14, 0.20, PALETTE.oliveDark);
  b.cylinderZ(-1.28, 0.82, 0, 0.065, 0.46, 5, PALETTE.canvas);
  for (const z of [-0.90, 0.90]) {
    b.box(-1.60, 0.66, z, 0.28, 0.12, 0.025, PALETTE.hull, 0.75);
  }
  // Turret ring, slightly proud of the roof.
  b.cylinder(0, 0.96, 0, 0.50, 0.06, 16, PALETTE.hullDark);
  return b.build();
}

/**
 * Low, narrow turret at the world-unit reference. The tube tip is exactly
 * local X = 2.2 / Y = 0.20 above the 0.98 turret mount, so the visible muzzle
 * lands on the unchanged 1.18 world hardpoint height and 2.2 forward reach.
 */
function buildMbtTurret(): MeshBuffers {
  const b = new MeshBuilder();
  // Tapered turret sides: a wide lower shell narrows toward the roof instead
  // of reading as one upright rectangular block.
  const y0 = 0.02;
  const y1 = 0.29;
  const b0: [number, number, number] = [-0.75, y0, -0.50];
  const b1: [number, number, number] = [0.55, y0, -0.50];
  const b2: [number, number, number] = [0.55, y0, 0.50];
  const b3: [number, number, number] = [-0.75, y0, 0.50];
  const t0: [number, number, number] = [-0.66, y1, -0.42];
  const t1: [number, number, number] = [0.42, y1, -0.42];
  const t2: [number, number, number] = [0.42, y1, 0.42];
  const t3: [number, number, number] = [-0.66, y1, 0.42];
  b.addQuad(t0, t3, t2, t1, PALETTE.hull);
  b.addQuad(b1, t1, t2, b2, PALETTE.hull);
  b.addQuad(b3, t3, t0, b0, PALETTE.hull);
  b.addQuad(b0, t0, t1, b1, PALETTE.hull);
  b.addQuad(b3, b2, t2, t3, PALETTE.hull);
  // A restrained lighter roof panel keeps the turret readable without a
  // large flat highlight that reads as a white box from the battle camera.
  b.box(-0.22, 0.30, 0, 0.78, 0.02, 0.72, PALETTE.hullLight);
  // A broad painted recognition panel on the turret roof. The old team trim
  // was only on the flanks, which the isometric camera foreshortens into a
  // couple of pixels; the roof is the one surface every tank shows in play.
  b.box(-0.22, 0.316, 0, 0.62, 0.02, 0.52, PALETTE.hull, 0.9);
  b.box(-0.80, 0.13, 0, 0.42, 0.26, 0.92, PALETTE.hullDark);
  b.box(0.72, 0.17, 0, 0.34, 0.28, 0.52, PALETTE.hullDark);
  // Main gun: thermal sleeve, muzzle brake and a 2.20 tip.
  b.cylinderX(1.45, 0.20, 0, 0.055, 1.20, 8, PALETTE.darkMetal);
  b.cylinderX(1.75, 0.20, 0, 0.075, 0.50, 8, PALETTE.hullDark);
  b.cylinderX(2.10, 0.20, 0, 0.075, 0.12, 8, PALETTE.darkMetal);
  b.cylinderX(2.18, 0.20, 0, 0.04, 0.04, 8, PALETTE.track);
  // Commander's cupola, loader hatch, periscopes and sights.
  b.cylinder(-0.38, 0.36, 0.30, 0.16, 0.08, 8, PALETTE.hull);
  b.cylinder(-0.38, 0.41, 0.30, 0.12, 0.035, 8, PALETTE.hullDark);
  b.box(-0.38, 0.43, 0.30, 0.10, 0.018, 0.10, PALETTE.darkMetal);
  b.cylinder(-0.38, 0.31, -0.30, 0.14, 0.06, 8, PALETTE.hullDark);
  b.box(0.15, 0.32, 0.28, 0.10, 0.05, 0.06, PALETTE.glassDark);
  b.box(0.15, 0.32, -0.28, 0.10, 0.05, 0.06, PALETTE.glassDark);
  b.box(-0.62, 0.33, 0.18, 0.12, 0.06, 0.08, PALETTE.darkMetal);
  // Smoke dischargers on both turret cheeks.
  for (const z of [-0.46, 0.46]) {
    for (const dz of [-0.05, 0.05]) {
      b.cylinderX(0.50, 0.27, z + dz, 0.028, 0.12, 4, PALETTE.darkMetal);
    }
  }
  // Antenna and bustle stowage.
  b.box(-0.82, 0.49, -0.36, 0.012, 0.40, 0.012, PALETTE.metal);
  b.box(-0.66, 0.30, 0.40, 0.30, 0.10, 0.10, PALETTE.oliveDark);
  b.box(-0.66, 0.30, -0.40, 0.30, 0.10, 0.10, PALETTE.oliveDark);
  // Team trim along both turret sides, above the tracks.
  for (const z of [-0.445, 0.445]) {
    b.box(-0.08, 0.20, z, 0.90, 0.025, 0.025, PALETTE.hull, 0.85);
  }
  return b.build();
}

/**
 * 155 mm self-propelled howitzer hull. It is deliberately a tracked artillery
 * carrier rather than the legacy near-square tank hull: a long, narrow track
 * envelope, engine-forward deck, driver's station and a rear turret ring.
 */
function buildSpgBody(): MeshBuffers {
  const b = new MeshBuilder();
  addTrackedRunningGear(b, {
    front: 2.16,
    rear: -1.80,
    halfTrack: 0.63,
    trackWidth: 0.28,
    wheelCount: 6,
    wheelStart: -1.22,
    wheelEnd: 1.50,
    wheelRadius: 0.205,
    wheelWidth: 0.28,
  });
  // Lower and upper hull, with the deck rising toward the rear turret ring.
  b.box(0.10, 0.49, 0, 3.50, 0.34, 1.18, PALETTE.hullDark);
  b.box(0.02, 0.72, 0, 3.44, 0.18, 1.30, PALETTE.hull);
  b.box(-0.62, 0.83, 0, 1.86, 0.05, 1.18, PALETTE.hullDark);
  // Sloped glacis and the engine access deck ahead of the driver.
  b.addQuad(
    [1.72, 0.81, -0.65],
    [1.72, 0.81, 0.65],
    [1.98, 0.60, 0.58],
    [1.98, 0.60, -0.58],
    PALETTE.hullLight,
  );
  b.box(1.80, 0.43, 0, 0.22, 0.20, 1.18, PALETTE.hullDark);
  for (let i = 0; i < 4; i++) {
    b.box(1.10 + i * 0.15, 0.835, 0, 0.055, 0.03, 1.04, PALETTE.darkMetal);
  }
  // Driver's station: raised hatch, vision blocks and a brush bar.
  b.box(1.38, 0.96, 0, 0.56, 0.22, 0.72, PALETTE.hullLight);
  b.box(1.64, 0.98, 0, 0.035, 0.14, 0.60, PALETTE.glassDark);
  b.box(1.63, 1.10, 0, 0.32, 0.035, 0.66, PALETTE.hull);
  for (const z of [-0.32, 0.32]) {
    b.box(1.67, 0.96, z, 0.03, 0.08, 0.13, PALETTE.glass);
    b.box(1.88, 0.56, z * 1.30, 0.12, 0.12, 0.12, PALETTE.glassDark);
    b.box(1.94, 0.52, z * 1.10, 0.06, 0.16, 0.18, PALETTE.metal);
  }
  // Hull sides: fender stowage, team panels and pioneer tools.
  for (const z of [-0.665, 0.665]) {
    b.box(-0.10, 0.77, z, 2.70, 0.04, 0.02, PALETTE.hull, 0.78);
    b.box(0.28, 0.85, z * 1.02, 0.74, 0.22, 0.045, PALETTE.oliveDark);
    b.box(-1.18, 0.85, z * 1.02, 0.50, 0.16, 0.045, PALETTE.canvas);
  }
  b.box(0.00, 0.90, 0.666, 0.46, 0.035, 0.035, PALETTE.darkMetal);
  b.box(-0.26, 0.90, 0.666, 0.12, 0.15, 0.04, PALETTE.metal);
  // Rear spade, outriggers, taillights and tow points.
  b.box(-1.82, 0.34, 0, 0.24, 0.46, 0.88, PALETTE.darkMetal);
  b.box(-2.02, 0.09, 0, 0.42, 0.10, 1.16, PALETTE.metal);
  for (const z of [-0.62, 0.62]) {
    b.box(-1.50, 0.30, z, 0.34, 0.22, 0.20, PALETTE.metal);
    b.box(-1.72, 0.12, z, 0.22, 0.28, 0.20, PALETTE.darkMetal);
    b.box(-1.88, 0.61, z * 0.82, 0.03, 0.09, 0.11, PALETTE.red);
  }
  // Turret ring and the ammunition bustle support under the casemate.
  b.cylinder(-0.30, 0.86, 0, 0.72, 0.10, 16, PALETTE.hullDark);
  b.box(-0.30, 0.90, 0, 1.14, 0.06, 1.10, PALETTE.hull);
  return b.build();
}

/**
 * 155 mm casemate. The long tube is the primary role cue, but the tall,
 * slab-sided fighting compartment and recoil gear keep it distinct from the
 * MBT. The barrel tip lands on the authored 2.30 hardpoint after the turret
 * mount offset; the mount height puts it at the authored 1.30 height.
 */
function buildSpgTurret(): MeshBuffers {
  const b = new MeshBuilder();
  const y0 = 0.02;
  const y1 = 0.60;
  const y2 = 0.92;
  const b0: [number, number, number] = [-1.10, y0, -0.68];
  const b1: [number, number, number] = [0.62, y0, -0.68];
  const b2: [number, number, number] = [0.62, y0, 0.68];
  const b3: [number, number, number] = [-1.10, y0, 0.68];
  const m0: [number, number, number] = [-1.05, y1, -0.62];
  const m1: [number, number, number] = [0.72, y1, -0.60];
  const m2: [number, number, number] = [0.72, y1, 0.60];
  const m3: [number, number, number] = [-1.05, y1, 0.62];
  const t0: [number, number, number] = [-0.98, y2, -0.53];
  const t1: [number, number, number] = [0.54, y2, -0.52];
  const t2: [number, number, number] = [0.54, y2, 0.52];
  const t3: [number, number, number] = [-0.98, y2, 0.53];
  b.addQuad(b3, b2, m2, m3, PALETTE.hull);
  b.addQuad(b0, m0, m1, b1, PALETTE.hull);
  b.addQuad(m3, m2, t2, t3, shade(PALETTE.hull, 0.94));
  b.addQuad(m0, t0, t1, m1, shade(PALETTE.hull, 0.94));
  b.addQuad(t0, t3, t2, t1, PALETTE.hullLight);
  b.addQuad(b1, m1, m2, b2, PALETTE.hullLight);
  b.addQuad(b0, b3, m3, m0, PALETTE.hullDark);
  b.box(-0.30, y2 + 0.015, 0, 1.40, 0.03, 0.94, PALETTE.hullLight);
  // The casemate roof is the SPG's largest camera-facing surface; paint it so
  // the battery reads as friendly or hostile without hunting for a flank panel.
  b.box(-0.30, y2 + 0.035, 0, 1.10, 0.02, 0.62, PALETTE.hull, 0.9);
  // Sloped front plate and mantlet around the tube.
  b.addQuad(
    [0.62, y0, -0.68],
    [0.72, y1, -0.60],
    [0.72, y1, 0.60],
    [0.62, y0, 0.68],
    PALETTE.hull,
  );
  b.box(0.58, 0.35, 0, 0.40, 0.46, 0.74, PALETTE.hullDark);
  // 155 mm tube, bore evacuator and muzzle brake. The tip is local 2.60.
  b.cylinderX(1.48, 0.35, 0, 0.082, 1.86, 8, PALETTE.darkMetal);
  b.cylinderX(1.30, 0.35, 0, 0.125, 0.30, 8, PALETTE.hullDark);
  b.cylinderX(2.46, 0.35, 0, 0.12, 0.22, 8, PALETTE.hullDark);
  b.cylinderX(2.59, 0.35, 0, 0.075, 0.02, 8, PALETTE.track);
  // Recoil cylinders above the tube, plus the gunner's sight.
  for (const z of [-0.14, 0.14]) {
    b.cylinderX(0.90, 0.53, z, 0.045, 0.78, 7, PALETTE.metal);
  }
  b.box(0.24, 0.80, 0.27, 0.26, 0.13, 0.24, PALETTE.hullDark);
  b.box(0.24, 0.865, 0.27, 0.15, 0.035, 0.14, PALETTE.glassDark);
  // Commander's cupola, loader hatch, periscopes, smoke and bustle stowage.
  b.cylinder(-0.50, 0.98, 0.26, 0.15, 0.08, 10, PALETTE.hull);
  b.cylinder(-0.50, 1.04, 0.26, 0.11, 0.04, 10, PALETTE.hullDark);
  b.box(-0.50, 1.06, 0.26, 0.09, 0.02, 0.09, PALETTE.darkMetal);
  b.cylinder(-0.56, 0.98, -0.26, 0.13, 0.06, 10, PALETTE.hullDark);
  for (const z of [-0.30, 0.30]) {
    b.box(-0.82, 0.96, z, 0.10, 0.05, 0.06, PALETTE.glassDark);
  }
  for (const z of [-0.50, 0.50]) {
    b.cylinderX(0.34, 0.78, z, 0.035, 0.13, 5, PALETTE.darkMetal);
  }
  b.box(-1.23, 0.78, 0, 0.28, 0.34, 0.92, PALETTE.oliveDark);
  b.box(-1.49, 0.66, 0, 0.14, 0.22, 0.66, PALETTE.hullDark);
  b.box(-1.44, 0.86, 0, 0.012, 0.36, 0.012, PALETTE.metal);
  // Painted team panels on the casemate flanks.
  for (const z of [-0.625, 0.625]) {
    b.box(-0.30, 0.38, z, 0.92, 0.28, 0.02, PALETTE.hull, 0.80);
  }
  return b.build();
}

/**
 * Common running gear for the two national artillery carriers. The chassis is
 * deliberately lower and narrower than the legacy tank hull: six road wheels
 * and a flat deck leave room for a weapon system without reading as an MBT.
 */
function addArtilleryRunningGear(
  b: MeshBuilder,
  length: number,
  halfTrack: number,
  wheelCount: number,
): void {
  for (const side of [-1, 1]) {
    const z = halfTrack * side;
    b.box(0, 0.17, z, length, 0.34, 0.28, PALETTE.track);
    for (let i = 0; i < wheelCount; i++) {
      const x = -length / 2 + 0.35 + (i * (length - 0.7)) / Math.max(1, wheelCount - 1);
      b.cylinderZ(x, 0.18, z, 0.18, 0.28, 8, PALETTE.darkMetal);
    }
    // A low fender and a short side skirt give the track a carrier profile.
    b.box(0, 0.46, z * 1.10, length * 0.94, 0.06, 0.22, PALETTE.hullDark);
    b.box(0, 0.34, z * 1.16, length * 0.72, 0.16, 0.05, PALETTE.hullDark);
  }
}

/**
 * Shared tracked running gear. The rocket carrier and the SPG use the same
 * construction: separate lower/return belts, track shoes, road wheels on swing
 * arms, a front sprocket, a rear idler and a fender with mudflaps. Dimensions
 * differ per vehicle, but the parts do not drift apart.
 */
interface TrackGearOptions {
  front: number;
  rear: number;
  halfTrack: number;
  trackWidth: number;
  wheelCount: number;
  wheelStart: number;
  wheelEnd: number;
  wheelRadius?: number;
  wheelWidth?: number;
}

function addTrackedRunningGear(b: MeshBuilder, o: TrackGearOptions): void {
  const length = o.front - o.rear;
  const mid = (o.front + o.rear) / 2;
  const wheelRadius = o.wheelRadius ?? 0.21;
  const wheelWidth = o.wheelWidth ?? 0.30;
  for (const side of [-1, 1]) {
    const z = o.halfTrack * side;
    // Lower and return runs read as separate belts; the gap between them shows
    // the road wheels and suspension rather than one solid black slab.
    b.box(mid, 0.17, z, length, 0.26, o.trackWidth, PALETTE.track);
    b.box(mid, 0.64, z, length, 0.12, o.trackWidth, PALETTE.track);
    for (let i = 0; i < 13; i++) {
      const x = o.rear + 0.16 + (i * (length - 0.32)) / 12;
      b.box(x, 0.705, z, 0.12, 0.04, o.trackWidth + 0.01, PALETTE.darkMetal);
    }
    for (let i = 0; i < o.wheelCount; i++) {
      const t = o.wheelCount === 1 ? 0.5 : i / (o.wheelCount - 1);
      const x = o.wheelStart + (o.wheelEnd - o.wheelStart) * t;
      b.box(x, 0.36, z * 0.72, 0.10, 0.10, 0.12, PALETTE.metal);
      b.cylinderZ(x, wheelRadius - 0.01, z, wheelRadius, wheelWidth, 10, PALETTE.darkMetal);
      b.cylinderZ(x, wheelRadius - 0.01, z, wheelRadius * 0.43, wheelWidth + 0.02, 8, PALETTE.metal);
    }
    b.cylinderZ(o.front - 0.42, 0.23, z, 0.26, o.trackWidth + 0.02, 10, PALETTE.track);
    b.cylinderZ(o.front - 0.42, 0.23, z, 0.10, o.trackWidth + 0.04, 8, PALETTE.darkMetal);
    b.cylinderZ(o.rear + 0.16, 0.23, z, 0.24, o.trackWidth + 0.02, 10, PALETTE.track);
    b.cylinderZ(o.rear + 0.16, 0.23, z, 0.09, o.trackWidth + 0.04, 8, PALETTE.darkMetal);
    // Fender over the track, with a rubber mudflap at each end.
    b.box(mid, 0.75, z * 1.08, length, 0.07, 0.38, PALETTE.hullDark);
    b.box(mid, 0.655, z * 1.20, length * 0.94, 0.16, 0.05, PALETTE.hullDark);
    b.box(o.front - 0.01, 0.47, z * 1.08, 0.07, 0.28, 0.34, PALETTE.track);
    b.box(o.rear + 0.01, 0.47, z * 1.08, 0.07, 0.28, 0.34, PALETTE.track);
  }
}

/**
 * British rocket carrier. The tracked chassis runs the full length of the
 * vehicle and the faceted cab sits on top of the front track section, matching
 * the M270's cab-over running gear. The stowed launcher is flush with the cab
 * roof instead of towering above it.
 */
function buildMlrsBody(): MeshBuffers {
  const b = new MeshBuilder();
  addTrackedRunningGear(b, {
    front: 3.54,
    rear: -2.04,
    halfTrack: 0.72,
    trackWidth: 0.30,
    wheelCount: 6,
    wheelStart: -1.48,
    wheelEnd: 2.12,
  });
  // Hull floor, upper hull and side armour. The cab's rear wall meets the
  // forward edge of the deck, so no part of the cab is unsupported.
  b.box(0.48, 0.51, 0, 5.12, 0.34, 1.26, PALETTE.hullDark);
  b.box(0.42, 0.73, 0, 5.02, 0.16, 1.34, PALETTE.hull);
  b.box(2.10, 0.64, 0, 1.05, 0.26, 1.28, PALETTE.hullDark);
  for (const z of [-0.66, 0.66]) {
    b.box(2.36, 0.78, z, 1.32, 0.12, 0.05, PALETTE.hull);
  }
  // Deck plating, engine access and the forward bulkhead under the cab.
  b.box(-0.40, 0.84, 0, 3.60, 0.05, 1.20, PALETTE.hullDark);
  b.box(1.42, 0.86, 0, 0.82, 0.05, 1.16, PALETTE.hull);
  for (let i = 0; i < 5; i++) {
    b.box(1.12 + i * 0.15, 0.895, 0, 0.055, 0.03, 1.02, PALETTE.darkMetal);
  }
  b.box(2.26, 0.90, 0, 0.14, 0.18, 1.22, PALETTE.hullDark);

  // Cab shell: three rings give the front a raked windscreen and the sides a
  // slight tumblehome, so it is not another upright rectangular block.
  const yB = 0.84;
  const yM = 1.36;
  const yT = 1.975;
  const rb: [number, number, number] = [2.34, yB, -0.72];
  const rbm: [number, number, number] = [2.34, yB, 0.72];
  const fb: [number, number, number] = [3.46, yB, -0.72];
  const fbm: [number, number, number] = [3.46, yB, 0.72];
  const rm: [number, number, number] = [2.38, yM, -0.73];
  const rmm: [number, number, number] = [2.38, yM, 0.73];
  const fm: [number, number, number] = [3.44, yM, -0.73];
  const fmm: [number, number, number] = [3.44, yM, 0.73];
  const rt: [number, number, number] = [2.44, yT, -0.67];
  const rtm: [number, number, number] = [2.44, yT, 0.67];
  const ft: [number, number, number] = [3.32, yT, -0.67];
  const ftm: [number, number, number] = [3.32, yT, 0.67];
  const panel = PALETTE.hull;
  // Lower body sides and front armour.
  b.addQuad(fbm, fmm, rmm, rbm, panel);
  b.addQuad(rb, rm, rmm, rbm, shade(panel, 0.92));
  b.addQuad(fb, fm, fmm, fbm, panel);
  // Upper body sides and the raked windscreen band.
  b.addQuad(fmm, ftm, rtm, rmm, shade(panel, 0.98));
  b.addQuad(rm, rt, rtm, rmm, shade(panel, 0.9));
  b.addQuad(fm, ft, ftm, fmm, panel);
  b.addQuad(rt, rtm, ftm, ft, PALETTE.hull);

  // Glazing sits a few centimetres proud of the shell so the frames read as
  // separate parts rather than decals painted on a flat face.
  b.box(2.82, 1.66, 0.736, 0.66, 0.36, 0.02, PALETTE.glassDark);
  b.box(2.82, 1.66, -0.736, 0.66, 0.36, 0.02, PALETTE.glassDark);
  b.box(2.62, 1.66, 0.748, 0.04, 0.38, 0.03, PALETTE.darkMetal);
  b.box(2.62, 1.66, -0.748, 0.04, 0.38, 0.03, PALETTE.darkMetal);
  b.box(3.04, 1.66, 0.748, 0.05, 0.38, 0.03, PALETTE.darkMetal);
  b.box(3.04, 1.66, -0.748, 0.05, 0.38, 0.03, PALETTE.darkMetal);
  b.addQuad(
    [3.445, 1.40, -0.52],
    [3.40, 1.86, -0.52],
    [3.40, 1.86, 0.52],
    [3.445, 1.40, 0.52],
    PALETTE.glass,
  );
  b.box(3.43, 1.63, 0, 0.035, 0.46, 0.035, PALETTE.darkMetal);
  for (const z of [-0.42, 0.42]) {
    b.box(3.425, 1.63, z, 0.035, 0.46, 0.035, PALETTE.darkMetal);
  }
  // Wipers.
  for (const z of [-0.30, 0.18]) {
    beam(b, [3.455, 1.41, z], [3.425, 1.60, z + 0.14], 0.018, 0.012, PALETTE.darkMetal);
  }

  // Team identification panels: both cab doors and a roof strip. The mask is
  // carried by geometry, so a British and a Russian carrier are distinguished
  // by ownership at battle zoom without replacing the national hull colours.
  for (const z of [-0.748, 0.748]) {
    b.box(2.85, 1.12, z, 0.68, 0.40, 0.025, PALETTE.hull, 0.72);
    b.box(2.85, 1.34, z, 0.72, 0.035, 0.03, PALETTE.darkMetal);
    b.box(2.85, 0.90, z, 0.72, 0.035, 0.03, PALETTE.darkMetal);
    b.box(3.12, 1.12, z, 0.035, 0.42, 0.03, PALETTE.darkMetal);
    b.box(2.56, 1.12, z, 0.035, 0.42, 0.03, PALETTE.darkMetal);
    // Door handle and external grab rail.
    b.box(3.08, 1.18, z * 1.02, 0.11, 0.035, 0.025, PALETTE.metal);
    b.box(2.62, 1.58, z * 1.02, 0.035, 0.32, 0.025, PALETTE.metal);
    // Mirror arm and glass.
    b.box(3.10, 1.71, z * 1.12, 0.22, 0.022, 0.022, PALETTE.darkMetal);
    b.box(3.18, 1.69, z * 1.18, 0.035, 0.19, 0.11, PALETTE.glassDark);
    // Boarding step and mudguard over the front track.
    b.box(2.54, 0.67, z * 1.04, 0.36, 0.05, 0.20, PALETTE.darkMetal);
    b.box(2.54, 0.52, z * 1.04, 0.04, 0.32, 0.18, PALETTE.metal);
    b.box(3.18, 0.45, z * 1.06, 0.18, 0.24, 0.12, PALETTE.track);
  }
  // Roof: shallow hatch, louvred ventilation over the windscreen, lifting eyes
  // and a low antenna base rather than a spike above the vehicle.
  b.box(2.90, 1.985, 0, 0.98, 0.03, 1.22, PALETTE.hull);
  b.box(2.93, 2.01, 0.38, 0.44, 0.035, 0.42, PALETTE.hullDark);
  b.box(2.93, 2.035, 0.38, 0.34, 0.02, 0.32, PALETTE.metal);
  for (let i = 0; i < 4; i++) {
    b.box(2.66 + i * 0.13, 2.015, 0, 0.075, 0.025, 1.04, PALETTE.hullDark);
  }
  b.box(2.49, 2.01, 0.38, 0.12, 0.025, 0.12, PALETTE.metal);
  b.box(2.49, 2.01, -0.38, 0.12, 0.025, 0.12, PALETTE.metal);
  b.box(2.45, 2.01, 0, 1.02, 0.025, 0.025, PALETTE.hull, 0.8);
  b.box(2.58, 2.10, -0.42, 0.014, 0.28, 0.014, PALETTE.metal);

  // Front bumper, headlights, blackout markers and a brush bar. The bar is what
  // gives the front the layered look of the reference rather than one flat slab.
  b.box(3.44, 0.58, 0, 0.16, 0.18, 1.36, PALETTE.hullDark);
  for (const z of [-0.44, 0.44]) {
    b.box(3.47, 0.95, z, 0.035, 0.12, 0.16, PALETTE.glassDark);
    b.box(3.49, 0.95, z, 0.015, 0.10, 0.12, PALETTE.glass);
    b.box(3.47, 0.84, z * 1.12, 0.035, 0.055, 0.09, PALETTE.amber);
    b.box(3.54, 0.58, z * 0.92, 0.13, 0.12, 0.12, PALETTE.metal);
    b.box(3.54, 0.46, z * 0.92, 0.04, 0.16, 0.09, PALETTE.darkMetal);
  }
  for (const z of [-0.55, 0.55]) {
    b.box(3.52, 0.91, z, 0.035, 0.58, 0.035, PALETTE.metal);
  }
  b.box(3.52, 1.19, 0, 0.035, 0.035, 1.14, PALETTE.metal);
  b.box(3.47, 1.02, 0, 0.03, 0.24, 0.96, PALETTE.hullDark);
  for (let i = 0; i < 3; i++) {
    b.box(3.487, 0.94 + i * 0.07, 0, 0.012, 0.025, 0.82, PALETTE.darkMetal);
  }

  // Rear: stabilising spades, taillights, tow points, cable reel and stowage.
  for (const z of [-0.68, 0.68]) {
    b.box(-2.02, 0.34, z, 0.24, 0.46, 0.34, PALETTE.metal);
    b.box(-2.20, 0.08, z, 0.44, 0.10, 0.42, PALETTE.darkMetal);
    b.box(-2.14, 0.46, z, 0.08, 0.10, 0.22, PALETTE.darkMetal);
  }
  b.box(-1.88, 0.58, 0, 0.10, 0.36, 0.92, PALETTE.hullDark);
  for (const z of [-0.40, 0.40]) {
    b.box(-1.94, 0.80, z, 0.04, 0.10, 0.12, PALETTE.red);
  }
  b.cylinder(-1.84, 0.88, 0.52, 0.15, 0.16, 10, PALETTE.metal);
  b.box(-1.55, 0.98, -0.50, 0.55, 0.24, 0.24, PALETTE.oliveDark);
  b.box(-1.55, 0.98, 0.50, 0.55, 0.24, 0.24, PALETTE.oliveDark);
  // Pioneer tools and a tow cable on the right flank: close-inspection detail
  // that also breaks the flat side panel at battle zoom.
  b.box(1.88, 0.99, 0.70, 0.46, 0.035, 0.035, PALETTE.darkMetal);
  b.box(2.14, 0.99, 0.70, 0.13, 0.17, 0.04, PALETTE.metal);
  for (let i = 0; i < 4; i++) {
    b.box(-1.10 + i * 0.38, 0.90, 0.705, 0.035, 0.05, 0.025, PALETTE.darkMetal);
  }
  b.box(-0.72, 0.90, 0.705, 1.22, 0.018, 0.018, PALETTE.metal);

  // Fixed pedestal and cradle. The pack pitches about this mount; the pedestal
  // must stay with the hull so it does not tilt with the launcher.
  b.cylinder(-1.35, 0.90, 0, 0.60, 0.10, 12, PALETTE.hullDark);
  b.box(-1.35, 1.02, 0, 1.16, 0.22, 0.94, PALETTE.metal);
  b.box(-1.35, 1.12, 0, 0.64, 0.22, 0.68, PALETTE.darkMetal);
  for (const z of [-0.56, 0.56]) {
    b.box(-1.35, 1.04, z, 0.72, 0.30, 0.10, PALETTE.metal);
  }
  return b.build();
}

/**
 * Stowed MLRS launcher: a flat six-cell 227 mm pack whose roof is level with
 * the cab. The pack is a separate moving part, so the renderer can keep it flat
 * while idle and pitch it up only when the battery is laying on a target. The
 * tube rims finish on the authored 2.30 hardpoint.
 */
function buildMlrsLauncher(): MeshBuffers {
  const b = new MeshBuilder();
  const front = 2.06;
  const rear = -1.52;
  const mid = (front + rear) / 2;
  const length = front - rear;
  const top = 1.975;
  const bottom = 1.12;
  const shoulder = 1.84;
  const halfBottom = 0.84;
  const halfTop = 0.74;
  // Main pack is a bevelled prism rather than a raw box: the flanks lean in at
  // the shoulder, and the front and rear faces pick up the same chamfer.
  b.addQuad(
    [rear, bottom, halfBottom],
    [front, bottom, halfBottom],
    [front, shoulder, halfBottom],
    [rear, shoulder, halfBottom],
    PALETTE.olive,
  );
  b.addQuad(
    [front, bottom, -halfBottom],
    [rear, bottom, -halfBottom],
    [rear, shoulder, -halfBottom],
    [front, shoulder, -halfBottom],
    PALETTE.olive,
  );
  b.addQuad(
    [rear, shoulder, halfBottom],
    [front, shoulder, halfBottom],
    [front, top, halfTop],
    [rear, top, halfTop],
    shade(PALETTE.olive, 0.93),
  );
  b.addQuad(
    [front, shoulder, -halfBottom],
    [rear, shoulder, -halfBottom],
    [rear, top, -halfTop],
    [front, top, -halfTop],
    shade(PALETTE.olive, 0.93),
  );
  b.addQuad(
    [rear, top, -halfTop],
    [rear, top, halfTop],
    [front, top, halfTop],
    [front, top, -halfTop],
    PALETTE.olive,
  );
  b.addQuad(
    [front, bottom, -halfBottom],
    [front, shoulder, -halfBottom],
    [front, shoulder, halfBottom],
    [front, bottom, halfBottom],
    PALETTE.hullDark,
  );
  b.addQuad(
    [rear, bottom, halfBottom],
    [rear, shoulder, halfBottom],
    [rear, shoulder, -halfBottom],
    [rear, bottom, -halfBottom],
    PALETTE.hullDark,
  );
  // Broad camouflage patches break up the flanks without a texture pipeline.
  // They follow the frame bays rather than random speckle, so the vehicle still
  // reads cleanly at battle zoom.
  const patch = (
    side: number,
    pts: Array<[number, number]>,
    color: Color,
  ): void => {
    const z = 0.846 * side;
    if (side > 0) {
      b.addQuad([pts[0][0], pts[0][1], z], [pts[1][0], pts[1][1], z], [pts[2][0], pts[2][1], z], [pts[3][0], pts[3][1], z], color);
    } else {
      b.addQuad([pts[1][0], pts[1][1], z], [pts[0][0], pts[0][1], z], [pts[3][0], pts[3][1], z], [pts[2][0], pts[2][1], z], color);
    }
  };
  for (const side of [-1, 1]) {
    patch(side, [[rear + 0.18, 1.53], [rear + 0.76, 1.53], [rear + 0.64, 1.81], [rear + 0.27, 1.80]], PALETTE.canvas);
    patch(side, [[rear + 0.95, 1.14], [rear + 1.56, 1.15], [rear + 1.48, 1.27], [rear + 0.90, 1.26]], PALETTE.hullDark);
    patch(side, [[0.58, 1.53], [1.24, 1.55], [1.13, 1.81], [0.75, 1.80]], shade(PALETTE.oliveDark, 1.16));
  }
  // Open front recess and the dark cell bores.
  b.box(front - 0.02, 1.55, 0, 0.08, 0.66, 1.58, PALETTE.hullDark);
  b.box(rear + 0.02, 1.55, 0, 0.08, 0.70, 1.60, PALETTE.hullDark);
  // Side frame rails, vertical ribs and a painted team band. The ribs break up
  // the long flank into panels at close inspection and catch the sun at zoom.
  for (const z of [-0.852, 0.852]) {
    b.box(mid, bottom + 0.02, z, length, 0.07, 0.05, PALETTE.hullDark);
    b.box(mid, 1.66, z, length, 0.055, 0.045, PALETTE.hullDark);
    for (let i = 0; i < 7; i++) {
      b.box(rear + 0.16 + i * 0.53, 1.45, z, 0.055, 0.61, 0.035, PALETTE.hullDark);
    }
    // Panel seams and tie-down lugs keep the flank from reading as one slab.
    b.box(mid - 0.30, 1.24, z * 1.006, 1.82, 0.022, 0.018, shade(PALETTE.olive, 0.8));
    b.box(mid + 0.62, 1.64, z * 1.006, 1.08, 0.020, 0.018, shade(PALETTE.olive, 0.8));
    for (let i = 0; i < 4; i++) {
      b.box(rear + 0.46 + i * 0.72, 1.72, z * 1.01, 0.07, 0.035, 0.025, PALETTE.darkMetal);
    }
    b.box(mid + 0.05, 1.30, z * 1.006, 2.55, 0.09, 0.022, PALETTE.olive, 0.82);
    b.box(mid + 0.05, 1.47, z * 1.006, 2.55, 0.022, 0.018, PALETTE.hullDark);
    b.box(rear + 0.30, 1.78, z * 1.006, 0.30, 0.13, 0.022, PALETTE.amber);
  }
  // Top plate, longitudinal stiffeners, access covers and the lifting lugs.
  b.box(mid, top - 0.012, 0, length - 0.06, 0.04, 1.42, PALETTE.olive);
  b.addQuad(
    [rear + 0.18, top + 0.013, -0.62],
    [rear + 0.18, top + 0.013, 0.06],
    [rear + 0.76, top + 0.013, 0.14],
    [rear + 0.76, top + 0.013, -0.56],
    PALETTE.canvas,
  );
  b.addQuad(
    [0.72, top + 0.013, 0.10],
    [0.72, top + 0.013, 0.62],
    [1.36, top + 0.013, 0.58],
    [1.36, top + 0.013, 0.16],
    shade(PALETTE.oliveDark, 1.16),
  );
  for (const z of [-0.58, -0.20, 0.20, 0.58]) {
    b.box(mid, top + 0.005, z, length - 0.18, 0.035, 0.04, PALETTE.metal);
  }
  b.box(mid - 0.62, top + 0.03, 0, 0.48, 0.025, 0.34, PALETTE.olive, 0.78);
  b.box(mid - 0.62, top + 0.047, 0, 0.30, 0.015, 0.22, PALETTE.hullDark);
  b.box(mid + 0.36, top + 0.035, 0.30, 0.34, 0.02, 0.26, PALETTE.hull, 0.8);
  for (const z of [-0.56, 0.56]) {
    b.box(rear + 0.36, top + 0.01, z, 0.22, 0.03, 0.10, PALETTE.darkMetal);
  }
  // Six 227 mm cells in two rows of three. The lower row sits at the authored
  // 1.30 projectile height; the rim at 2.30 is the simulation hardpoint.
  for (const y of [1.32, 1.66]) {
    for (const z of [-0.48, 0, 0.48]) {
      b.cylinderX(2.18, y, z, 0.195, 0.20, 12, PALETTE.hullDark);
      b.cylinderX(2.285, y, z, 0.215, 0.03, 12, PALETTE.metal);
      b.cylinderX(2.293, y, z, 0.165, 0.018, 12, PALETTE.hullDark);
      b.cylinderX(2.298, y, z, 0.145, 0.012, 12, PALETTE.glassDark);
    }
  }
  // Hinge trunnions, cradle beams and hydraulic rams travel with the pack, so
  // the deployed launcher stays visibly attached to its pedestal.
  for (const z of [-0.58, 0.58]) {
    b.box(-0.35, 1.15, z, 2.05, 0.10, 0.11, PALETTE.metal);
    b.box(-1.16, 1.28, z * 1.38, 0.58, 0.10, 0.075, PALETTE.darkMetal);
    b.cylinderX(-0.78, 1.22, z * 1.38, 0.045, 0.54, 8, PALETTE.metal);
  }
  b.cylinderZ(-1.40, 1.14, 0, 0.10, 1.22, 8, PALETTE.darkMetal);
  b.box(-1.47, 1.54, 0, 0.08, 0.84, 1.62, PALETTE.hullDark);
  b.box(-1.51, 1.58, 0, 0.05, 0.58, 1.34, PALETTE.olive, 0.65);
  b.box(0.38, top + 0.05, 0.58, 0.36, 0.08, 0.22, PALETTE.hullDark);
  b.box(0.38, top + 0.09, 0.58, 0.22, 0.03, 0.14, PALETTE.glassDark);
  b.box(-0.92, top + 0.04, -0.58, 0.018, 0.26, 0.018, PALETTE.metal);
  return b.build();
}

/**
 * Russian 203 mm siege carrier. A long, low engine-forward hull with a rear
 * spade supports a tall fighting compartment, keeping it distinct from the
 * lower, faster MBT hull.
 */
function buildHeavyHowitzerBody(): MeshBuffers {
  const b = new MeshBuilder();
  addArtilleryRunningGear(b, 4.0, 0.70, 6);
  b.box(0, 0.50, 0, 3.70, 0.42, 1.24, PALETTE.hullDark);
  b.box(0, 0.74, 0, 3.55, 0.24, 1.34, PALETTE.hull);
  // Engine-forward deck and driver's cab; the gun house sits behind it.
  b.box(1.10, 0.88, 0, 1.30, 0.06, 1.18, PALETTE.hullDark);
  for (let i = 0; i < 4; i++) {
    b.box(0.60 + i * 0.24, 0.925, 0, 0.10, 0.035, 1.02, PALETTE.darkMetal);
  }
  b.box(1.52, 1.02, 0, 0.82, 0.34, 1.06, PALETTE.hullLight);
  b.box(1.90, 1.04, 0, 0.10, 0.19, 0.84, PALETTE.glassDark);
  b.addQuad(
    [1.98, 0.84, -0.54],
    [1.98, 0.84, 0.54],
    [2.18, 0.64, 0.48],
    [2.18, 0.64, -0.48],
    PALETTE.hullLight,
  );
  // Team identification band along the engine deck; the gun house carries a
  // second panel so ownership reads from either flank.
  for (const z of [-0.685, 0.685]) {
    b.box(0.55, 0.80, z, 2.00, 0.05, 0.02, PALETTE.hull, 0.8);
  }
  // Rear spade and outriggers absorb the recoil of the siege gun.
  b.box(-1.86, 0.34, 0, 0.30, 0.54, 0.92, PALETTE.darkMetal);
  b.box(-2.06, 0.08, 0, 0.46, 0.10, 1.30, PALETTE.metal);
  for (const z of [-0.92, 0.92]) {
    b.box(-1.20, 0.48, z, 0.55, 0.22, 0.20, PALETTE.metal);
    b.box(-1.36, 0.18, z, 0.22, 0.32, 0.22, PALETTE.darkMetal);
  }
  b.cylinder(-0.25, 0.88, 0, 0.60, 0.06, 12, PALETTE.hullDark);
  return b.build();
}

/**
 * 203 mm fighting compartment: a tall casemate with a visibly heavy breech,
 * recuperators and a barrel whose tip lands on the authored 2.40 hardpoint.
 * The mount still traverses through the existing turret contract.
 */
function buildHeavyHowitzerTurret(): MeshBuffers {
  const b = new MeshBuilder();
  // Base ring and slab-sided gun house.
  b.box(-0.55, 0.20, 0, 1.90, 0.36, 1.50, PALETTE.hullDark);
  b.box(-0.55, 0.62, 0, 1.80, 0.80, 1.42, PALETTE.hull);
  b.box(-0.55, 1.04, 0, 1.62, 0.05, 1.28, PALETTE.hullLight);
  // Painted recognition panels on the gun-house flanks and roof.
  for (const z of [-0.718, 0.718]) {
    b.box(-0.55, 0.62, z, 0.86, 0.30, 0.02, PALETTE.hull, 0.76);
  }
  b.box(-0.55, 1.075, 0, 0.66, 0.02, 0.20, PALETTE.hull, 0.82);
  // Sloped front plate around the mantlet.
  b.addQuad(
    [0.34, 0.22, -0.70],
    [0.34, 0.22, 0.70],
    [0.62, 0.58, 0.64],
    [0.62, 0.58, -0.64],
    PALETTE.hullLight,
  );
  // Heavy breech and a broad mantlet, then the long 203 mm tube.
  b.box(0.08, 0.58, 0, 0.78, 0.56, 0.84, PALETTE.hullDark);
  b.box(0.56, 0.54, 0, 0.30, 0.56, 0.96, PALETTE.hullDark);
  b.cylinderX(1.40, 0.50, 0, 0.115, 2.00, 8, PALETTE.metal);
  b.cylinderX(0.98, 0.50, 0, 0.18, 0.90, 8, PALETTE.darkMetal);
  b.cylinderX(1.62, 0.50, 0, 0.14, 0.28, 8, PALETTE.darkMetal);
  b.cylinderX(2.25, 0.50, 0, 0.21, 0.28, 8, PALETTE.hullDark);
  b.cylinderX(2.39, 0.50, 0, 0.10, 0.02, 8, PALETTE.track);
  // Recoil cylinders above the tube and a low sight block on the roof.
  for (const z of [-0.17, 0.17]) {
    b.cylinderX(1.05, 0.72, z, 0.055, 0.86, 7, PALETTE.metal);
  }
  b.box(0.14, 0.96, 0.32, 0.30, 0.12, 0.26, PALETTE.hullDark);
  b.box(0.14, 1.01, 0.32, 0.16, 0.035, 0.14, PALETTE.glassDark);
  // Rear counterweight, hatches, spare track and antenna.
  b.box(-1.48, 0.58, 0, 0.44, 0.54, 1.16, PALETTE.hullDark);
  b.cylinder(-0.92, 1.10, 0.30, 0.15, 0.06, 8, PALETTE.hull);
  b.box(-0.92, 1.14, 0.30, 0.22, 0.02, 0.22, PALETTE.darkMetal);
  b.box(-1.22, 1.15, -0.34, 0.18, 0.08, 0.20, PALETTE.oliveDark);
  b.box(-1.36, 1.22, -0.48, 0.012, 0.34, 0.012, PALETTE.metal);
  return b.build();
}

/**
 * Armoured recovery vehicle. The tracked carrier carries a heavy rear crane,
 * outriggers, a spade and a winch; the forward cab is glazed and the rear
 * workshop body is taller than the hull so it reads as a support vehicle.
 */
function buildRecovery(): MeshBuffers {
  const b = new MeshBuilder();
  addTrackedRunningGear(b, {
    front: 2.35,
    rear: -2.10,
    halfTrack: 0.66,
    trackWidth: 0.32,
    wheelCount: 6,
    wheelStart: -1.42,
    wheelEnd: 1.86,
    wheelRadius: 0.215,
    wheelWidth: 0.32,
  });
  b.box(0.10, 0.52, 0, 3.80, 0.34, 1.22, PALETTE.hullDark);
  b.box(0.04, 0.74, 0, 3.70, 0.18, 1.32, PALETTE.hull);
  b.box(-0.70, 0.85, 0, 2.40, 0.05, 1.24, PALETTE.hullDark);
  b.addQuad(
    [1.30, 0.82, -0.66],
    [1.30, 0.82, 0.66],
    [1.60, 0.56, 0.56],
    [1.60, 0.56, -0.56],
    PALETTE.hullLight,
  );
  // Glazed forward cab, roof hatch and brush bar.
  b.box(1.08, 1.05, 0, 0.84, 0.46, 1.14, PALETTE.hullLight);
  b.box(1.10, 1.31, 0, 0.96, 0.14, 1.20, PALETTE.hull);
  b.box(1.10, 1.385, 0, 0.68, 0.018, 0.84, PALETTE.hull, 0.9);
  b.box(-1.18, 1.60, 0, 1.22, 0.02, 1.18, PALETTE.hull, 0.88);
  b.box(1.51, 1.06, 0, 0.04, 0.28, 0.96, PALETTE.glassDark);
  b.box(1.53, 1.07, 0, 0.02, 0.21, 0.84, PALETTE.glass);
  b.box(1.05, 1.41, 0, 0.34, 0.05, 0.34, PALETTE.hullDark);
  b.box(1.16, 1.47, 0, 0.08, 0.07, 0.08, PALETTE.warning);
  for (const z of [-0.36, 0.36]) {
    b.box(1.48, 0.88, z, 0.04, 0.13, 0.16, PALETTE.glassDark);
    b.box(1.55, 0.58, z * 1.12, 0.12, 0.12, 0.14, PALETTE.metal);
    b.box(1.54, 1.03, z, 0.035, 0.52, 0.035, PALETTE.metal);
  }
  b.box(1.54, 1.28, 0, 0.035, 0.035, 0.98, PALETTE.metal);
  // Rear workshop body and roof lockers.
  b.box(-1.18, 1.16, 0, 1.62, 0.72, 1.52, PALETTE.hullDark);
  b.box(-1.18, 1.54, 0, 1.50, 0.10, 1.42, PALETTE.hull);
  b.box(-1.22, 1.62, 0.42, 0.92, 0.18, 0.42, PALETTE.oliveDark);
  b.box(-1.22, 1.62, -0.42, 0.92, 0.18, 0.42, PALETTE.oliveDark);
  b.box(-0.22, 1.46, 0, 0.22, 0.16, 0.28, PALETTE.warning);
  // Crane turntable, twin A-frame posts and a long jib.
  b.cylinder(-1.06, 1.68, 0, 0.30, 0.10, 10, PALETTE.darkMetal);
  b.box(-1.06, 1.80, 0, 0.52, 0.22, 0.64, PALETTE.metal);
  beam(b, [-1.12, 1.96, -0.40], [-1.44, 2.62, -0.40], 0.17, 0.17, PALETTE.metal);
  beam(b, [-1.12, 1.96, 0.40], [-1.44, 2.62, 0.40], 0.17, 0.17, PALETTE.metal);
  beam(b, [-1.34, 2.48, 0], [-2.40, 2.72, 0], 0.20, 0.20, PALETTE.warning);
  b.box(-1.40, 2.58, 0, 0.14, 0.12, 0.14, PALETTE.darkMetal);
  b.box(-2.36, 2.26, 0, 0.025, 0.94, 0.025, PALETTE.metal);
  b.box(-2.36, 1.76, 0, 0.24, 0.20, 0.24, PALETTE.metal);
  b.box(-2.36, 1.64, 0, 0.12, 0.06, 0.12, PALETTE.darkMetal);
  // Rear spade, outriggers, winch fairlead and recovery markings.
  b.box(-2.02, 0.34, 0, 0.30, 0.54, 1.06, PALETTE.darkMetal);
  b.box(-2.20, 0.09, 0, 0.48, 0.10, 1.42, PALETTE.metal);
  for (const z of [-0.94, 0.94]) {
    b.box(-1.50, 0.46, z, 0.60, 0.18, 0.20, PALETTE.metal);
    b.box(-1.66, 0.18, z, 0.24, 0.34, 0.24, PALETTE.darkMetal);
    b.box(-2.14, 0.72, z, 0.05, 0.12, 0.34, PALETTE.warning);
  }
  b.cylinderZ(-2.05, 0.72, 0, 0.20, 0.74, 8, PALETTE.darkMetal);
  b.box(-2.08, 1.05, 0, 0.24, 0.32, 1.32, PALETTE.hullDark);
  // Team panels on both flanks and the rear body.
  for (const z of [-0.625, 0.625]) {
    b.box(-0.40, 0.78, z, 1.52, 0.15, 0.025, PALETTE.hull, 0.85);
    b.box(-0.80, 1.20, z, 1.10, 0.30, 0.02, PALETTE.hull, 0.80);
    b.box(-0.08, 0.72, z * 1.05, 0.44, 0.22, 0.09, PALETTE.oliveDark);
    b.box(-1.40, 1.52, z * 1.02, 0.90, 0.06, 0.10, PALETTE.amber);
  }
  b.box(-1.99, 1.20, 0, 0.03, 0.28, 1.20, PALETTE.hull, 0.86);
  b.box(0.10, 0.82, 0, 3.20, 0.06, 1.34, PALETTE.hullDark);
  return b.build();
}

/**
 * Strike fighter. The fuselage is built from a tapered nose, cockpit spine and
 * twin engine nacelles, with swept wings, canted tails, pylons and missiles.
 * The silhouette is deliberately heavier than the interceptor's clean delta.
 */
function buildFighter(): MeshBuffers {
  const b = new MeshBuilder();
  const body: Color = [0.43, 0.47, 0.46];
  const panel: Color = [0.36, 0.40, 0.39];
  // Fore/aft fuselage with a tapered nose instead of one long rectangular bar.
  b.box(0.10, 0, 0, 4.40, 0.48, 0.84, body);
  b.addQuad([2.30, 0.22, -0.42], [2.30, 0.22, 0.42], [2.95, 0.08, 0.16], [2.95, 0.08, -0.16], body);
  b.addQuad([2.30, -0.22, -0.42], [2.30, -0.22, 0.42], [2.95, 0.08, 0.16], [2.95, 0.08, -0.16], panel);
  b.addTriangle([2.30, 0.22, -0.42], [2.95, 0.08, -0.16], [2.30, -0.22, -0.42], panel);
  b.addTriangle([2.30, 0.22, 0.42], [2.30, -0.22, 0.42], [2.95, 0.08, 0.16], panel);
  b.box(-1.60, 0.02, 0, 2.10, 0.52, 1.02, body);
  b.box(-2.74, 0.04, 0, 0.52, 0.44, 1.16, panel);
  // Canopy and cockpit spine, split into a windscreen and two side panes.
  b.box(0.94, 0.35, 0, 1.14, 0.30, 0.64, PALETTE.glassDark);
  b.box(0.98, 0.39, 0, 0.98, 0.22, 0.52, PALETTE.glass);
  b.box(1.30, 0.34, 0, 0.34, 0.24, 0.58, PALETTE.glassDark);
  b.box(-0.08, 0.33, 0, 0.82, 0.18, 0.48, panel);
  // Intakes, wing roots and swept wings.
  for (const z of [-0.52, 0.52]) {
    b.box(0.20, -0.10, z, 1.52, 0.40, 0.30, panel);
    b.box(0.96, -0.10, z, 0.10, 0.30, 0.24, PALETTE.darkMetal);
  }
  b.boxRot(-0.30, -0.02, -1.72, 2.90, 0.14, 3.10, 0.40, body);
  b.boxRot(-0.30, -0.02, 1.72, 2.90, 0.14, 3.10, -0.40, body);
  b.boxRot(-0.78, 0.01, -1.30, 1.10, 0.05, 1.60, 0.40, panel);
  b.boxRot(-0.78, 0.01, 1.30, 1.10, 0.05, 1.60, -0.40, panel);
  // Canted twin tails and all-moving stabilators.
  beam(b, [-2.22, 0.16, -0.66], [-2.60, 1.12, -1.02], 0.50, 0.12, body);
  beam(b, [-2.22, 0.16, 0.66], [-2.60, 1.12, 1.02], 0.50, 0.12, body);
  b.boxRot(-2.48, 0.06, -1.30, 0.72, 0.08, 1.10, 0.36, panel);
  b.boxRot(-2.48, 0.06, 1.30, 0.72, 0.08, 1.10, -0.36, panel);
  // Twin afterburner nozzles.
  for (const z of [-0.34, 0.34]) {
    b.cylinderX(-2.94, 0, z, 0.22, 0.56, 8, PALETTE.darkMetal);
    b.cylinderX(-3.16, 0, z, 0.17, 0.12, 8, PALETTE.track);
  }
  // Wing pylons and four missiles; the outboard pair is visibly longer.
  for (const z of [-1.90, -1.28, 1.28, 1.90]) {
    b.box(-0.34, -0.18, z, 0.54, 0.10, 0.10, PALETTE.metal);
    b.cylinderX(0.10, -0.26, z, Math.abs(z) > 1.6 ? 0.075 : 0.095, 1.66, 6, PALETTE.white);
    b.box(0.92, -0.26, z, 0.12, 0.15, 0.15, PALETTE.warning);
  }
  // Team identification panels on both wings and the fin.
  for (const z of [-1.62, 1.62]) {
    b.box(-0.34, 0.06, z, 0.54, 0.02, 0.46, PALETTE.hull, 0.88);
  }
  b.box(-2.52, 0.70, 0, 0.52, 0.36, 0.02, PALETTE.hull, 0.90);
  return b.build();
}

/**
 * Air-superiority interceptor. A clean delta with a long pointed nose, single
 * canted fin and slim missiles, visually lighter and faster than the strike
 * fighter's twin-tail, twin-engine airframe.
 */
function buildInterceptor(): MeshBuffers {
  const b = new MeshBuilder();
  const body: Color = [0.48, 0.51, 0.50];
  const panel: Color = [0.40, 0.44, 0.43];
  b.box(0.00, 0, 0, 4.90, 0.46, 0.78, body);
  b.addQuad([2.45, 0.20, -0.39], [2.45, 0.20, 0.39], [3.45, 0.02, 0.10], [3.45, 0.02, -0.10], body);
  b.addQuad([2.45, -0.20, -0.39], [2.45, -0.20, 0.39], [3.45, 0.02, 0.10], [3.45, 0.02, -0.10], panel);
  b.addTriangle([2.45, 0.20, -0.39], [3.45, 0.02, -0.10], [2.45, -0.20, -0.39], panel);
  b.addTriangle([2.45, 0.20, 0.39], [2.45, -0.20, 0.39], [3.45, 0.02, 0.10], panel);
  b.box(-1.30, 0.02, 0, 2.10, 0.44, 0.94, body);
  b.box(-2.55, 0.04, 0, 0.60, 0.36, 1.02, panel);
  // Long bubble canopy and ventral intake.
  b.box(0.98, 0.33, 0, 1.48, 0.26, 0.58, PALETTE.glassDark);
  b.box(1.00, 0.37, 0, 1.26, 0.18, 0.46, PALETTE.glass);
  b.box(0.38, -0.20, 0, 1.88, 0.22, 0.68, PALETTE.darkMetal);
  b.box(1.22, -0.20, 0, 0.16, 0.14, 0.54, PALETTE.track);
  // Broad delta wings and a single canted fin.
  b.addQuad([0.92, -0.02, -0.36], [1.00, -0.02, -0.36], [-2.18, -0.02, -2.72], [-2.18, -0.02, -2.72], body);
  b.addTriangle([0.98, -0.02, -0.34], [-2.20, -0.02, -2.80], [-2.10, -0.02, -0.38], body);
  b.addTriangle([0.98, -0.02, 0.34], [-2.10, -0.02, 0.38], [-2.20, -0.02, 2.80], body);
  b.addQuad([-0.20, -0.02, -0.38], [-2.18, -0.02, -2.62], [-2.08, 0.06, -2.58], [-0.20, 0.06, -0.38], panel);
  b.addQuad([-0.20, -0.02, 0.38], [-0.20, 0.06, 0.38], [-2.08, 0.06, 2.58], [-2.18, -0.02, 2.62], panel);
  beam(b, [-1.78, 0.16, 0.20], [-2.20, 1.34, 0.30], 0.56, 0.10, body);
  // Tailplanes, nozzle and wingtip missiles.
  b.boxRot(-2.24, 0.02, -0.78, 0.62, 0.07, 0.92, 0.46, panel);
  b.boxRot(-2.24, 0.02, 0.78, 0.62, 0.07, 0.92, -0.46, panel);
  b.cylinderX(-2.80, 0, 0, 0.24, 0.46, 8, PALETTE.darkMetal);
  b.cylinderX(-3.02, 0, 0, 0.19, 0.10, 8, PALETTE.track);
  for (const z of [-1.42, 1.42]) {
    b.box(-0.48, -0.14, z, 0.44, 0.08, 0.09, PALETTE.metal);
    b.cylinderX(-0.10, -0.22, z, 0.065, 1.34, 6, PALETTE.white);
    b.box(0.55, -0.22, z, 0.09, 0.10, 0.10, PALETTE.warning);
  }
  // Team panels: both wing tops and the fin, so ownership reads from above.
  for (const z of [-1.50, 1.50]) {
    b.box(-0.50, -0.005, z, 0.46, 0.02, 0.34, PALETTE.hull, 0.88);
  }
  b.box(-2.12, 0.86, 0.25, 0.34, 0.32, 0.02, PALETTE.hull, 0.90);
  return b.build();
}

/**
 * Tactical reconnaissance drone. A slender fuselage, long straight wing and a
 * ventral sensor turret; the propeller and tail booms keep it visibly slower
 * and lighter than the jet aircraft.
 */
function buildUav(): MeshBuffers {
  const b = new MeshBuilder();
  const airframe: Color = [0.50, 0.53, 0.51];
  b.box(0.00, 0, 0, 2.60, 0.30, 0.56, airframe);
  b.box(1.44, 0, 0, 0.34, 0.23, 0.40, PALETTE.hullDark);
  b.sphere(1.56, 0.02, 0, 0.18, 4, 6, PALETTE.darkMetal);
  // Long straight wing with tip pods and team panels.
  b.box(0.08, 0.035, 0, 0.92, 0.10, 6.10, airframe);
  for (const z of [-1.76, 1.76]) {
    b.box(0.02, 0.10, z, 0.44, 0.014, 0.50, PALETTE.hull, 0.86);
  }
  for (const z of [-2.94, 2.94]) {
    b.box(0.06, 0.02, z, 0.28, 0.18, 0.42, PALETTE.oliveDark);
  }
  // Twin tail booms and a high horizontal stabiliser.
  for (const z of [-0.30, 0.30]) {
    beam(b, [-0.70, 0.02, z], [-2.00, 0.22, z * 1.5], 0.10, 0.10, airframe);
  }
  b.box(-2.04, 0.28, 0, 0.42, 0.07, 2.10, airframe);
  for (const z of [-0.76, 0.76]) {
    b.box(-2.04, 0.40, z, 0.08, 0.40, 0.02, PALETTE.hull, 0.88);
  }
  // Pusher propeller, sensor ball and relay dish.
  b.cylinderX(-1.28, 0.10, 0, 0.05, 0.30, 5, PALETTE.darkMetal);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.boxRot(-1.45, 0.10 + Math.sin(a) * 0.38, Math.cos(a) * 0.38, 0.03, 0.62, 0.10, i * 0.9, PALETTE.darkMetal);
  }
  b.sphere(0.58, -0.24, 0, 0.23, 4, 7, PALETTE.glassDark);
  b.sphere(0.58, -0.24, 0, 0.14, 4, 7, PALETTE.glass);
  b.cylinder(0.62, -0.42, 0, 0.08, 0.14, 7, PALETTE.metal);
  b.cylinder(-0.54, 0.24, 0, 0.14, 0.07, 8, PALETTE.metal);
  b.box(-0.43, 0.31, 0, 0.010, 0.24, 0.010, PALETTE.darkMetal);
  return b.build();
}

/**
 * Belarusian long-endurance drone. It shares the reconnaissance role but not
 * the airframe: a wider wing, twin booms, a satcom dome and a larger sensor
 * package make it distinct from the baseline UAV.
 */
function buildDeepReconUav(): MeshBuffers {
  const b = new MeshBuilder();
  const airframe: Color = [0.45, 0.49, 0.46];
  b.box(0.00, 0, 0, 3.30, 0.36, 0.68, airframe);
  b.box(1.74, 0.02, 0, 0.34, 0.26, 0.46, PALETTE.hullDark);
  b.sphere(1.88, 0.03, 0, 0.20, 4, 6, PALETTE.darkMetal);
  b.box(0.10, 0.04, 0, 1.00, 0.12, 8.20, airframe);
  for (const z of [-2.50, 2.50]) {
    b.box(0.04, 0.11, z, 0.58, 0.016, 0.64, PALETTE.hull, 0.86);
  }
  for (const z of [-3.96, 3.96]) {
    b.box(0.08, 0.02, z, 0.34, 0.20, 0.48, PALETTE.oliveDark);
  }
  for (const z of [-0.42, 0.42]) {
    beam(b, [-0.90, 0.02, z], [-2.42, 0.26, z * 1.6], 0.12, 0.12, airframe);
  }
  b.box(-2.45, 0.32, 0, 0.46, 0.08, 2.62, airframe);
  for (const z of [-0.92, 0.92]) {
    b.box(-2.45, 0.44, z, 0.09, 0.46, 0.02, PALETTE.hull, 0.88);
  }
  // Twin pusher props and a large satcom fairing.
  for (const z of [-0.42, 0.42]) {
    b.cylinderX(-1.52, 0.12, z, 0.06, 0.40, 5, PALETTE.darkMetal);
    b.boxRot(-1.78, 0.12, z, 0.03, 0.72, 0.10, 0.35, PALETTE.darkMetal);
  }
  b.sphere(-0.25, 0.28, 0, 0.30, 5, 8, PALETTE.hull);
  b.sphere(-0.25, 0.28, 0, 0.22, 5, 8, PALETTE.glassDark);
  b.sphere(0.68, -0.27, 0, 0.30, 4, 8, PALETTE.glassDark);
  b.sphere(0.68, -0.27, 0, 0.19, 4, 8, PALETTE.glass);
  b.cylinder(0.74, -0.50, 0, 0.10, 0.20, 7, PALETTE.metal);
  b.box(0.65, -0.50, 0, 0.22, 0.03, 0.04, PALETTE.glass);
  return b.build();
}

/**
 * Shared reconnaissance hull for the armed wheeled scout and the unarmed
 * Pathfinder. Four road wheels, a low armoured body and a rear optics mast; the
 * Pathfinder simply omits the autocannon turret, so its mast is the role cue.
 */
function buildRecon(): MeshBuffers {
  const b = new MeshBuilder();
  // Four wheels with visible hubs and simple fender arches.
  for (const x of [-0.92, 0.92]) {
    for (const z of [-0.63, 0.63]) {
      b.cylinderZ(x, 0.37, z, 0.37, 0.28, 12, PALETTE.rubber);
      b.cylinderZ(x, 0.37, z, 0.155, 0.30, 10, PALETTE.metal);
      b.cylinderZ(x, 0.37, z, 0.075, 0.32, 8, PALETTE.darkMetal);
      b.box(x, 0.79, z * 1.04, 0.86, 0.06, 0.34, PALETTE.hullDark);
      b.box(x, 0.65, z * 1.09, 0.58, 0.20, 0.05, PALETTE.hullDark);
    }
  }
  // Lower hull and upper body. The outline narrows toward the nose instead of
  // reading as a rectangular van.
  b.box(0.02, 0.50, 0, 2.68, 0.34, 1.16, PALETTE.hullDark);
  b.box(-0.02, 0.72, 0, 2.54, 0.18, 1.28, PALETTE.hull);
  b.box(-0.18, 0.86, 0, 2.18, 0.12, 1.18, PALETTE.hull);
  b.addQuad(
    [1.24, 0.84, -0.60],
    [1.24, 0.84, 0.60],
    [1.48, 0.56, 0.50],
    [1.48, 0.56, -0.50],
    PALETTE.hullLight,
  );
  // Front cab, raked windscreen and brush bar.
  b.box(1.02, 0.96, 0, 0.54, 0.26, 1.06, PALETTE.hullLight);
  b.box(1.29, 0.99, 0, 0.035, 0.18, 0.88, PALETTE.glassDark);
  b.box(1.31, 0.73, 0, 0.08, 0.15, 1.14, PALETTE.hullDark);
  for (const z of [-0.38, 0.38]) {
    b.box(1.37, 0.80, z, 0.04, 0.10, 0.13, PALETTE.glass);
    b.box(1.43, 0.54, z * 1.10, 0.10, 0.10, 0.12, PALETTE.metal);
  }
  for (const z of [-0.48, 0.48]) {
    b.box(1.43, 0.92, z, 0.03, 0.44, 0.03, PALETTE.metal);
  }
  b.box(1.43, 1.13, 0, 0.03, 0.03, 0.96, PALETTE.metal);
  // Side doors, glazing and mirrors. The door panel is the main team surface.
  for (const z of [-0.645, 0.645]) {
    b.box(0.56, 1.00, z, 0.48, 0.28, 0.02, PALETTE.glassDark);
    b.box(0.56, 0.82, z, 0.54, 0.30, 0.025, PALETTE.hull, 0.78);
    b.box(0.30, 0.82, z, 0.03, 0.34, 0.03, PALETTE.darkMetal);
    b.box(0.82, 0.82, z, 0.03, 0.34, 0.03, PALETTE.darkMetal);
    b.box(0.02, 0.99, z * 1.01, 0.42, 0.24, 0.02, PALETTE.glassDark);
    b.box(1.18, 1.07, z * 1.07, 0.16, 0.02, 0.02, PALETTE.darkMetal);
    b.box(1.25, 1.05, z * 1.10, 0.03, 0.12, 0.08, PALETTE.glassDark);
    b.box(0.55, 0.58, z * 1.01, 0.42, 0.04, 0.16, PALETTE.darkMetal);
  }
  // Rear optics mast. It stays with the hull, so the Pathfinder's sensor head
  // is visible even though it has no turret or weapon.
  b.box(-0.62, 1.10, 0, 0.09, 0.44, 0.09, PALETTE.metal);
  b.box(-0.62, 1.58, 0, 0.30, 0.16, 0.24, PALETTE.hullDark);
  b.box(-0.62, 1.58, 0.13, 0.20, 0.10, 0.03, PALETTE.glass);
  b.box(-0.62, 1.74, 0, 0.18, 0.10, 0.18, PALETTE.metal);
  b.box(-0.62, 1.75, 0.10, 0.10, 0.06, 0.02, PALETTE.glass);
  // Rear plate, spare wheel, taillights and stowage.
  b.box(-1.38, 0.68, 0, 0.10, 0.40, 1.02, PALETTE.hullDark);
  b.cylinderZ(-1.44, 0.62, 0, 0.34, 0.14, 12, PALETTE.rubber);
  b.cylinderZ(-1.44, 0.62, 0, 0.14, 0.16, 8, PALETTE.metal);
  for (const z of [-0.42, 0.42]) {
    b.box(-1.44, 0.88, z, 0.03, 0.09, 0.11, PALETTE.red);
  }
  b.box(-0.95, 0.88, 0.66, 0.42, 0.20, 0.15, PALETTE.canvas);
  b.box(-0.95, 0.88, -0.66, 0.42, 0.20, 0.15, PALETTE.canvas);
  return b.build();
}

/**
 * Light autocannon turret for the armed scout. The long, slim barrel and the
 * sensor/optics block keep it distinct from both the MBT and the SPG.
 */
function buildReconTurret(): MeshBuffers {
  const b = new MeshBuilder();
  // Base ring and low, faceted cupola.
  b.cylinder(0, 0.02, 0, 0.46, 0.05, 12, PALETTE.hullDark);
  b.box(-0.04, 0.19, 0, 0.82, 0.30, 0.74, PALETTE.hullDark);
  b.box(-0.08, 0.38, 0, 0.68, 0.14, 0.60, PALETTE.hull);
  b.addQuad(
    [0.40, 0.08, -0.37],
    [0.40, 0.08, 0.37],
    [0.30, 0.43, 0.30],
    [0.30, 0.43, -0.30],
    PALETTE.hull,
  );
  // 25 mm autocannon: slim tube, muzzle brake and a visible trunnion.
  b.cylinderX(0.75, 0.20, 0, 0.035, 0.90, 6, PALETTE.darkMetal);
  b.cylinderX(1.205, 0.20, 0, 0.055, 0.09, 6, PALETTE.hullDark);
  b.box(0.37, 0.20, 0, 0.22, 0.14, 0.20, PALETTE.metal);
  b.box(0.10, 0.31, 0.20, 0.12, 0.10, 0.10, PALETTE.metal);
  // Sight head, hatch and smoke dischargers.
  b.box(-0.04, 0.47, 0.18, 0.18, 0.13, 0.22, PALETTE.hullDark);
  b.box(-0.04, 0.515, 0.20, 0.10, 0.03, 0.12, PALETTE.glass);
  b.cylinder(-0.10, 0.47, -0.18, 0.11, 0.06, 10, PALETTE.hullDark);
  for (const z of [-0.28, 0.28]) {
    b.cylinderX(-0.02, 0.40, z, 0.025, 0.10, 4, PALETTE.darkMetal);
  }
  // Team panel on the turret flank, plus antenna and stowage.
  for (const z of [-0.382, 0.382]) {
    b.box(-0.04, 0.23, z, 0.44, 0.16, 0.018, PALETTE.hull, 0.82);
  }
  b.box(-0.34, 0.45, 0, 0.012, 0.22, 0.012, PALETTE.metal);
  b.box(-0.33, 0.21, 0, 0.22, 0.10, 0.18, PALETTE.oliveDark);
  return b.build();
}

/**
 * Wheeled mobile SAM carrier. Three axles, a cab-over front body and a rear
 * launcher deck; the four-round pack is carried above the hull rather than
 * inside a tank-style turret.
 */
function buildAA(): MeshBuffers {
  const b = new MeshBuilder();
  for (const x of [-1.36, 0.00, 1.30]) {
    for (const z of [-0.67, 0.67]) {
      b.cylinderZ(x, 0.38, z, 0.38, 0.30, 12, PALETTE.rubber);
      b.cylinderZ(x, 0.38, z, 0.16, 0.32, 10, PALETTE.metal);
      b.cylinderZ(x, 0.38, z, 0.07, 0.34, 8, PALETTE.darkMetal);
      b.box(x, 0.80, z * 1.04, 0.92, 0.07, 0.38, PALETTE.hullDark);
      b.box(x, 0.64, z * 1.10, 0.64, 0.20, 0.05, PALETTE.hullDark);
    }
  }
  b.box(0.02, 0.52, 0, 3.58, 0.32, 1.22, PALETTE.hullDark);
  b.box(0.00, 0.74, 0, 3.46, 0.18, 1.32, PALETTE.hull);
  b.addQuad(
    [1.52, 0.82, -0.62],
    [1.52, 0.82, 0.62],
    [1.78, 0.56, 0.50],
    [1.78, 0.56, -0.50],
    PALETTE.hullLight,
  );
  // Forward cab with a two-piece windscreen and roof hatch.
  b.box(1.16, 1.03, 0, 0.78, 0.54, 1.18, PALETTE.hullLight);
  b.box(1.15, 1.32, 0, 0.90, 0.12, 1.24, PALETTE.hull, 0.8);
  b.box(1.56, 1.06, 0, 0.04, 0.32, 1.02, PALETTE.glassDark);
  b.box(1.58, 1.07, 0, 0.02, 0.24, 0.88, PALETTE.glass);
  b.box(1.18, 1.41, 0, 0.30, 0.06, 0.34, PALETTE.hullDark);
  b.box(1.18, 1.448, 0, 0.64, 0.018, 0.78, PALETTE.hull, 0.9);
  for (const z of [-0.38, 0.38]) {
    b.box(1.55, 0.94, z, 0.04, 0.13, 0.16, PALETTE.glassDark);
    b.box(1.63, 0.56, z * 1.12, 0.12, 0.12, 0.14, PALETTE.metal);
    b.box(1.58, 1.10, z, 0.035, 0.50, 0.035, PALETTE.metal);
  }
  b.box(1.58, 1.32, 0, 0.035, 0.035, 1.02, PALETTE.metal);
  // Rear launcher deck and fixed radar mast. The mast belongs to the hull, so
  // it does not swing with the turret while the pack tracks an aircraft.
  b.box(-1.05, 0.84, 0, 1.72, 0.06, 1.30, PALETTE.hullDark);
  for (let i = 0; i < 4; i++) {
    b.box(-1.52 + i * 0.30, 0.91, 0, 0.08, 0.04, 1.12, PALETTE.darkMetal);
  }
  beam(b, [-1.22, 1.10, -0.52], [-1.22, 2.02, -0.52], 0.10, 0.10, PALETTE.metal);
  beam(b, [-1.22, 1.10, 0.52], [-1.22, 2.02, 0.52], 0.10, 0.10, PALETTE.metal);
  b.box(-1.22, 2.08, 0, 0.16, 0.13, 1.22, PALETTE.darkMetal);
  b.box(-1.26, 2.08, 0, 0.02, 0.09, 1.06, PALETTE.glassDark);
  // Team bands, side stowage, lights and rear steps.
  for (const z of [-0.585, 0.585]) {
    b.box(-0.10, 0.78, z, 1.44, 0.13, 0.025, PALETTE.hull, 0.86);
    b.box(0.36, 0.70, z * 1.06, 0.50, 0.22, 0.10, PALETTE.oliveDark);
    b.box(-1.66, 0.74, z * 1.04, 0.32, 0.16, 0.08, PALETTE.red);
  }
  b.box(-1.86, 0.62, 0, 0.10, 0.42, 1.10, PALETTE.hullDark);
  b.box(-1.94, 0.34, 0, 0.20, 0.08, 0.92, PALETTE.metal);
  return b.build();
}

function buildAATurret(): MeshBuffers {
  const b = new MeshBuilder();
  // Low mount, yoke and four rectangular launch tubes. The pack is a separate
  // mass from the cab and does not read as a gun turret. The pedestal reaches
  // down to the launcher deck so the pack does not float above the hull.
  b.cylinder(0, -0.15, 0, 0.30, 0.32, 10, PALETTE.darkMetal);
  b.cylinder(0, 0.02, 0, 0.46, 0.06, 12, PALETTE.hullDark);
  b.box(-0.06, 0.16, 0, 0.78, 0.24, 1.16, PALETTE.hullDark);
  b.addQuad(
    [-0.46, 0.04, -0.58],
    [0.36, 0.04, -0.58],
    [0.30, 0.30, -0.52],
    [-0.46, 0.30, -0.52],
    PALETTE.hull,
  );
  b.addQuad(
    [-0.46, 0.04, 0.58],
    [-0.46, 0.30, 0.52],
    [0.30, 0.30, 0.52],
    [0.36, 0.04, 0.58],
    PALETTE.hull,
  );
  b.box(-0.08, 0.33, 0, 0.84, 0.04, 1.10, PALETTE.hullLight);
  for (const z of [-0.48, -0.16, 0.16, 0.48]) {
    b.box(0.55, 0.24, z, 2.42, 0.23, 0.24, PALETTE.hullLight);
    b.box(1.74, 0.24, z, 0.12, 0.25, 0.26, PALETTE.warning);
    b.box(-0.64, 0.24, z, 0.18, 0.26, 0.26, PALETTE.darkMetal);
  }
  // A painted retaining band crosses the pack without hiding the four cells.
  // The cab roof carries the second broad team surface.
  b.box(0.10, 0.24, 0, 0.24, 0.33, 1.24, PALETTE.hull, 0.9);
  b.box(-0.74, 0.24, 0, 0.18, 0.34, 1.24, PALETTE.darkMetal);
  // Sight head, hatch and smoke dischargers.
  b.box(-0.08, 0.48, 0.38, 0.20, 0.16, 0.22, PALETTE.hullDark);
  b.box(-0.08, 0.51, 0.49, 0.12, 0.08, 0.025, PALETTE.glass);
  b.cylinder(-0.28, 0.42, -0.30, 0.12, 0.10, 10, PALETTE.hullDark);
  for (const z of [-0.56, 0.56]) {
    b.box(-0.20, 0.12, z, 0.46, 0.06, 0.02, PALETTE.hull, 0.84);
  }
  b.box(-0.72, 0.54, 0.42, 0.012, 0.30, 0.012, PALETTE.metal);
  return b.build();
}

/**
 * Armoured ore harvester. A long tracked chassis, a forward cutting drum and
 * a high-walled rear hopper. The amber load and the tall hopper make the
 * economy role obvious without relying on the unit label.
 */
function buildHarvester(): MeshBuffers {
  const b = new MeshBuilder();
  addTrackedRunningGear(b, {
    front: 2.58,
    rear: -2.34,
    halfTrack: 0.86,
    trackWidth: 0.38,
    wheelCount: 6,
    wheelStart: -1.62,
    wheelEnd: 2.10,
    wheelRadius: 0.245,
    wheelWidth: 0.38,
  });
  b.box(0.10, 0.56, 0, 4.76, 0.36, 1.54, PALETTE.hullDark);
  b.box(0.06, 0.78, 0, 4.64, 0.18, 1.62, PALETTE.hull);
  b.addQuad(
    [2.20, 0.86, -0.78],
    [2.20, 0.86, 0.78],
    [2.48, 0.56, 0.66],
    [2.48, 0.56, -0.66],
    PALETTE.hullLight,
  );
  // Forward cab with a high glasshouse, roof hatch and brush bar.
  b.box(1.56, 1.14, 0, 0.92, 0.56, 1.34, PALETTE.hullLight);
  b.box(1.48, 1.47, 0, 1.04, 0.14, 1.40, PALETTE.hull);
  b.box(2.03, 1.16, 0, 0.04, 0.34, 1.14, PALETTE.glassDark);
  b.box(2.05, 1.18, 0, 0.02, 0.26, 0.98, PALETTE.glass);
  b.box(-0.06, 1.46, 0, 0.03, 0.20, 0.86, PALETTE.glassDark);
  b.box(1.52, 1.57, 0, 0.34, 0.05, 0.34, PALETTE.hullDark);
  b.box(1.52, 1.558, 0, 0.70, 0.018, 0.82, PALETTE.hull, 0.9);
  b.box(1.52, 1.63, 0, 0.09, 0.07, 0.09, PALETTE.amber);
  for (const z of [-0.42, 0.42]) {
    b.box(1.98, 0.98, z, 0.04, 0.13, 0.16, PALETTE.glassDark);
    b.box(2.07, 0.62, z * 1.10, 0.12, 0.12, 0.14, PALETTE.metal);
    b.box(2.04, 1.20, z, 0.035, 0.56, 0.035, PALETTE.metal);
  }
  b.box(2.04, 1.44, 0, 0.035, 0.035, 1.10, PALETTE.metal);
  // Cutting drum and intake throat. The drum is a separate cylinder so the
  // harvester reads as an industrial machine rather than a tracked box.
  b.box(2.40, 0.60, 0, 0.44, 0.74, 2.08, PALETTE.darkMetal);
  b.cylinderZ(2.54, 0.40, 0, 0.31, 1.94, 12, PALETTE.metal);
  for (let i = 0; i < 7; i++) {
    b.box(2.53, 0.40, -0.82 + i * 0.273, 0.10, 0.54, 0.08, PALETTE.darkMetal);
  }
  b.addQuad(
    [2.22, 0.98, -0.86],
    [2.22, 0.98, 0.86],
    [2.48, 1.02, 0.74],
    [2.48, 1.02, -0.74],
    PALETTE.hullDark,
  );
  // Hopper bed and floor. The floor is at 1.56 so the cargo mesh (drawn from
  // 1.6 upward) sits inside the walls; the bed and side walls reach down to the
  // chassis, so the hopper is carried rather than floating over the tracks.
  b.box(-1.36, 1.10, 0, 2.95, 0.34, 2.38, PALETTE.hullDark);
  b.box(-1.36, 1.56, 0, 2.70, 0.12, 2.34, PALETTE.darkMetal);
  for (const z of [-1.16, 1.16]) {
    b.box(-1.38, 1.85, z, 2.88, 1.50, 0.16, PALETTE.hullDark);
    b.box(-1.38, 2.57, z * 1.04, 2.76, 0.10, 0.22, PALETTE.hull, 0.86);
    // High, bright team panels remain visible over the cargo.
    b.box(-1.36, 1.94, z * 1.02, 1.82, 0.44, 0.03, PALETTE.hull, 0.88);
    b.box(-2.44, 2.18, z, 0.20, 0.62, 0.20, PALETTE.hullDark);
    for (let i = 0; i < 5; i++) {
      b.box(-2.35 + i * 0.55, 1.42, z * 1.03, 0.10, 0.55, 0.04, PALETTE.metal);
    }
  }
  b.box(-2.68, 1.85, 0, 0.18, 1.50, 2.34, PALETTE.hullDark);
  b.box(-2.77, 2.34, 0, 0.04, 0.46, 1.86, PALETTE.hull, 0.88);
  b.box(-0.14, 1.85, 0, 0.16, 1.50, 2.20, PALETTE.hullDark);
  for (const z of [-0.96, 0.96]) {
    b.box(-1.36, 1.40, z, 0.14, 0.52, 0.14, PALETTE.darkMetal);
  }
  // Conveyor/return chute and hydraulic rams at the hopper front.
  beam(b, [0.08, 1.32, -0.88], [-0.86, 1.62, -0.88], 0.24, 0.24, PALETTE.metal);
  beam(b, [0.08, 1.32, 0.88], [-0.86, 1.62, 0.88], 0.24, 0.24, PALETTE.metal);
  for (const z of [-0.70, 0.70]) {
    b.cylinderX(-0.60, 1.70, z, 0.045, 0.72, 6, PALETTE.darkMetal);
  }
  // Roof beacon, rear access ladder and mudguards.
  b.box(-2.10, 2.68, -0.60, 0.28, 0.34, 0.28, PALETTE.darkMetal);
  b.box(-2.10, 2.86, -0.60, 0.12, 0.10, 0.12, PALETTE.warning);
  for (let i = 0; i < 4; i++) {
    b.box(-2.84, 0.55 + i * 0.30, 0.66, 0.06, 0.05, 0.52, PALETTE.metal);
  }
  for (const z of [-0.98, 0.98]) {
    b.box(0.10, 0.95, z, 3.30, 0.07, 0.36, PALETTE.hullDark);
    b.box(-2.16, 0.64, z, 0.05, 0.10, 0.14, PALETTE.red);
  }
  return b.build();
}

function buildHarvesterLoad(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(-1.36, 0.50, 0, 2.26, 1.00, 1.94, PALETTE.amber);
  b.box(-1.36, 1.02, 0, 1.76, 0.18, 1.48, [0.94, 0.68, 0.26]);
  return b.build();
}

/**
 * Coastal missile corvette. A flared hull with a raised bow, full-length deck,
 * bridge, funnel, mast and two three-cell anti-ship missile racks. The deck gun
 * is the separate turret mesh on the foredeck.
 */
function buildCorvetteBody(): MeshBuffers {
  const b = new MeshBuilder();
  const hull: Color = [0.34, 0.38, 0.40];
  const upper: Color = [0.40, 0.44, 0.45];
  // Lower hull, waterline band and flared upper hull.
  b.box(-0.20, 0.42, 0, 9.80, 0.56, 1.94, hull);
  b.box(-0.20, 0.72, 0, 9.40, 0.24, 2.10, upper);
  b.addQuad([4.62, 0.32, -0.97], [4.62, 0.32, 0.97], [5.86, 0.60, 0.10], [5.86, 0.60, -0.10], hull);
  b.addQuad([4.62, 0.84, -1.05], [4.62, 0.84, 1.05], [5.86, 0.64, 0.10], [5.86, 0.64, -0.10], upper);
  b.addQuad([4.62, 0.32, -0.97], [5.86, 0.60, -0.10], [5.86, 0.64, -0.10], [4.62, 0.84, -1.05], PALETTE.hullDark);
  b.addQuad([4.62, 0.32, 0.97], [4.62, 0.84, 1.05], [5.86, 0.64, 0.10], [5.86, 0.60, 0.10], PALETTE.hullDark);
  b.box(-0.20, 0.13, -1.02, 9.80, 0.10, 0.05, PALETTE.track);
  b.box(-0.20, 0.13, 1.02, 9.80, 0.10, 0.05, PALETTE.track);
  // Full deck with a raised forecastle and a small quarterdeck step.
  b.box(-0.20, 0.87, 0, 9.60, 0.10, 1.92, PALETTE.hullDark);
  b.box(3.30, 0.94, 0, 2.40, 0.06, 1.72, upper);
  b.box(3.30, 0.975, 0, 1.40, 0.02, 0.92, PALETTE.hull, 0.88);
  b.box(-3.20, 0.94, 0, 2.10, 0.06, 1.76, upper);
  // Bridge block with raked front, side screens and a pilot house roof.
  b.box(-0.72, 1.46, 0, 2.24, 0.88, 1.46, upper);
  b.addQuad(
    [0.42, 1.02, -0.73],
    [0.42, 1.02, 0.73],
    [0.28, 1.88, 0.64],
    [0.28, 1.88, -0.64],
    PALETTE.hull,
  );
  b.box(-0.74, 1.94, 0, 2.10, 0.12, 1.36, upper);
  b.box(-0.78, 2.06, 0, 1.46, 0.12, 1.06, PALETTE.hull);
  b.box(0.30, 1.53, 0, 0.035, 0.30, 1.28, PALETTE.glassDark);
  b.box(0.32, 1.54, 0, 0.02, 0.22, 1.14, PALETTE.glass);
  for (const z of [-0.76, 0.76]) {
    b.box(-0.60, 1.52, z, 1.18, 0.24, 0.02, PALETTE.glassDark);
    b.box(-0.60, 1.53, z * 1.01, 1.04, 0.17, 0.01, PALETTE.glass);
  }
  // Funnel with a black cap and exhaust louvres.
  b.box(-2.00, 1.64, 0, 0.62, 0.78, 0.72, upper);
  b.box(-2.00, 2.08, 0, 0.68, 0.12, 0.78, PALETTE.darkMetal);
  for (let i = 0; i < 3; i++) {
    b.box(-2.00, 1.54 + i * 0.14, -0.385, 0.46, 0.05, 0.02, PALETTE.track);
  }
  // Mast, yardarm and navigation radar.
  b.box(-1.60, 2.62, 0, 0.10, 1.28, 0.10, PALETTE.metal);
  b.box(-1.60, 3.02, 0, 1.46, 0.07, 0.10, PALETTE.metal);
  b.box(-1.60, 3.32, 0, 0.86, 0.10, 0.22, PALETTE.darkMetal);
  b.box(-1.60, 3.38, 0, 0.62, 0.03, 0.14, PALETTE.glassDark);
  b.box(-1.60, 3.55, 0, 0.04, 0.34, 0.04, PALETTE.metal);
  // Two three-cell anti-ship missile racks, canted outboard on deck pedestals.
  for (const z of [-0.56, 0.56]) {
    b.box(-2.86, 1.06, z, 1.34, 0.22, 0.50, PALETTE.darkMetal);
    for (let i = 0; i < 3; i++) {
      b.cylinderX(-2.74, 1.21 + i * 0.16, z, 0.105, 1.16, 8, PALETTE.oliveDark);
      b.box(-2.14, 1.21 + i * 0.16, z, 0.16, 0.20, 0.18, PALETTE.warning);
    }
  }
  // Deck rail, anchors, cleats, life rafts and team panels.
  for (const z of [-0.94, 0.94]) {
    b.box(0.10, 1.09, z, 8.90, 0.05, 0.035, PALETTE.metal);
    for (let i = 0; i < 9; i++) {
      b.box(-4.20 + i * 1.04, 1.16, z, 0.025, 0.16, 0.025, PALETTE.metal);
    }
    b.box(-0.70, 1.34, z * 1.14, 1.20, 0.10, 0.02, PALETTE.hull, 0.88);
    b.box(3.16, 1.12, z * 1.08, 0.82, 0.16, 0.16, PALETTE.oliveDark);
    b.box(4.92, 0.43, z * 0.70, 0.14, 0.24, 0.18, PALETTE.darkMetal);
  }
  b.box(4.38, 1.08, 0, 0.62, 0.16, 1.30, PALETTE.hullDark);
  b.box(4.76, 0.70, 0, 0.22, 0.22, 0.78, PALETTE.metal);
  // Stern transom, rudder posts and propellers.
  b.box(-4.96, 0.56, 0, 0.36, 0.68, 1.88, PALETTE.hullDark);
  for (const z of [-0.48, 0.48]) {
    b.box(-5.14, 0.26, z, 0.18, 0.34, 0.12, PALETTE.metal);
    b.cylinderX(-5.18, 0.22, z, 0.13, 0.26, 6, PALETTE.darkMetal);
  }
  return b.build();
}

function buildCorvetteTurret(): MeshBuffers {
  const b = new MeshBuilder();
  // Low, faceted 76 mm mount. The local tip is 1.40 and the mount sits at 2.90
  // on a 0.70 visual scale, landing on the authored 3.0 / 0.9 hardpoint. The
  // short pedestal reaches the forecastle deck instead of floating over it.
  b.cylinder(0, -0.16, 0, 0.26, 0.30, 10, PALETTE.darkMetal);
  b.cylinder(0, 0.01, 0, 0.38, 0.04, 12, PALETTE.hullDark);
  b.addQuad([-0.42, 0.03, -0.40], [0.30, 0.03, -0.40], [0.20, 0.30, -0.30], [-0.36, 0.30, -0.32], PALETTE.hull);
  b.addQuad([-0.42, 0.03, 0.40], [-0.36, 0.30, 0.32], [0.20, 0.30, 0.30], [0.30, 0.03, 0.40], PALETTE.hull);
  b.addQuad([-0.42, 0.03, -0.40], [-0.42, 0.03, 0.40], [-0.36, 0.30, 0.32], [-0.36, 0.30, -0.32], PALETTE.hullDark);
  b.box(-0.06, 0.31, 0, 0.48, 0.03, 0.58, PALETTE.hull, 0.9);
  b.box(0.28, 0.13, 0, 0.30, 0.20, 0.34, PALETTE.hullDark);
  b.cylinderX(0.80, 0.22, 0, 0.045, 1.16, 7, PALETTE.darkMetal);
  b.cylinderX(1.32, 0.22, 0, 0.065, 0.12, 7, PALETTE.hullDark);
  b.box(-0.10, 0.42, 0.20, 0.16, 0.13, 0.18, PALETTE.hullDark);
  b.box(-0.08, 0.455, 0.20, 0.09, 0.03, 0.09, PALETTE.glass);
  for (const z of [-0.31, 0.31]) {
    b.cylinderX(0.30, 0.33, z, 0.022, 0.10, 4, PALETTE.darkMetal);
  }
  b.box(-0.38, 0.16, 0, 0.22, 0.05, 0.50, PALETTE.hull, 0.9);
  return b.build();
}

/**
 * Fast attack craft. A short planing hull, low bridge and two light missile
 * canisters: deliberately smaller and flatter than the corvette so a pair reads
 * as a swarm rather than a second capital ship. The deck gun is separate.
 */
function buildMissileBoatBody(): MeshBuffers {
  const b = new MeshBuilder();
  const hull: Color = [0.34, 0.38, 0.40];
  const upper: Color = [0.40, 0.44, 0.45];
  // Planing hull, spray rail and a sharp bow wedge.
  b.box(0.20, 0.38, 0, 6.00, 0.44, 1.52, hull);
  b.box(0.20, 0.64, 0, 5.80, 0.16, 1.64, upper);
  b.addQuad([3.20, 0.16, -0.76], [3.20, 0.16, 0.76], [4.40, 0.46, 0.08], [4.40, 0.46, -0.08], hull);
  b.addQuad([3.20, 0.62, -0.82], [3.20, 0.62, 0.82], [4.40, 0.50, 0.08], [4.40, 0.50, -0.08], upper);
  b.addQuad([3.20, 0.16, -0.76], [4.40, 0.46, -0.08], [4.40, 0.50, -0.08], [3.20, 0.62, -0.82], PALETTE.hullDark);
  b.addQuad([3.20, 0.16, 0.76], [3.20, 0.62, 0.82], [4.40, 0.50, 0.08], [4.40, 0.46, 0.08], PALETTE.hullDark);
  b.box(0.20, 0.12, -0.78, 6.00, 0.08, 0.04, PALETTE.track);
  b.box(0.20, 0.12, 0.78, 6.00, 0.08, 0.04, PALETTE.track);
  // Deck and a short raised foredeck.
  b.box(0.20, 0.75, 0, 5.90, 0.08, 1.50, PALETTE.hullDark);
  b.box(2.55, 0.81, 0, 1.50, 0.05, 1.24, upper);
  b.box(2.55, 0.835, 0, 1.10, 0.02, 0.86, PALETTE.hull, 0.88);
  // Low bridge with a raked screen and a pilot-house roof.
  b.box(0.10, 1.02, 0, 1.70, 0.58, 1.06, upper);
  b.addQuad([0.95, 0.74, -0.53], [0.95, 0.74, 0.53], [0.82, 1.30, 0.46], [0.82, 1.30, -0.46], PALETTE.hull);
  b.box(0.10, 1.34, 0, 1.56, 0.10, 0.96, upper);
  b.box(0.96, 1.06, 0, 0.035, 0.20, 0.84, PALETTE.glassDark);
  b.box(0.98, 1.07, 0, 0.02, 0.15, 0.74, PALETTE.glass);
  for (const z of [-0.54, 0.54]) {
    b.box(0.10, 1.06, z, 1.10, 0.16, 0.02, PALETTE.glassDark);
    b.box(0.10, 1.07, z * 1.01, 0.96, 0.11, 0.01, PALETTE.glass);
  }
  // Short funnel and a light mast.
  b.box(-1.30, 1.02, 0, 0.44, 0.42, 0.56, upper);
  b.box(-1.30, 1.42, 0, 0.48, 0.08, 0.62, PALETTE.darkMetal);
  b.box(-1.72, 1.92, 0, 0.06, 1.02, 0.06, PALETTE.metal);
  b.box(-1.72, 2.20, 0, 0.80, 0.05, 0.06, PALETTE.metal);
  b.box(-1.72, 2.36, 0, 0.42, 0.08, 0.16, PALETTE.darkMetal);
  // Two light anti-ship canisters on angled deck cradles.
  for (const z of [-0.46, 0.46]) {
    b.box(-2.20, 0.94, z, 1.10, 0.18, 0.38, PALETTE.darkMetal);
    b.cylinderX(-2.20, 1.10, z, 0.09, 1.02, 8, PALETTE.oliveDark);
    b.box(-1.18, 1.10, z, 0.14, 0.18, 0.16, PALETTE.warning);
  }
  // Grabrails, life raft and mooring cleats.
  for (const z of [-0.73, 0.73]) {
    b.box(0.20, 0.96, z, 5.70, 0.04, 0.03, PALETTE.metal);
    for (let i = 0; i < 5; i++) {
      b.box(-2.40 + i * 1.20, 1.02, z, 0.02, 0.13, 0.02, PALETTE.metal);
    }
    b.box(2.80, 0.99, z * 1.02, 0.72, 0.13, 0.13, PALETTE.oliveDark);
    b.box(4.00, 0.36, z * 0.58, 0.12, 0.20, 0.14, PALETTE.darkMetal);
  }
  // Stern transom and outdrive propellers.
  b.box(-2.90, 0.50, 0, 0.30, 0.56, 1.44, PALETTE.hullDark);
  for (const z of [-0.40, 0.40]) {
    b.box(-3.04, 0.24, z, 0.16, 0.28, 0.10, PALETTE.metal);
    b.cylinderX(-3.08, 0.20, z, 0.11, 0.22, 6, PALETTE.darkMetal);
  }
  return b.build();
}

/** Compact automatic mount for the fast attack craft. */
function buildMissileBoatTurret(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, -0.10, 0, 0.20, 0.26, 10, PALETTE.darkMetal);
  b.cylinder(0, 0.01, 0, 0.30, 0.04, 12, PALETTE.hullDark);
  b.addQuad([-0.32, 0.03, -0.32], [0.24, 0.03, -0.32], [0.16, 0.26, -0.24], [-0.28, 0.26, -0.25], PALETTE.hull);
  b.addQuad([-0.32, 0.03, 0.32], [-0.28, 0.26, 0.25], [0.16, 0.26, 0.24], [0.24, 0.03, 0.32], PALETTE.hull);
  b.addQuad([-0.32, 0.03, -0.32], [-0.32, 0.03, 0.32], [-0.28, 0.26, 0.25], [-0.28, 0.26, -0.25], PALETTE.hullDark);
  b.box(-0.04, 0.285, 0, 0.40, 0.03, 0.46, PALETTE.hull, 0.9);
  b.box(0.22, 0.20, 0, 0.28, 0.13, 0.28, PALETTE.hullDark);
  b.cylinderX(0.54, 0.20, 0, 0.035, 0.70, 7, PALETTE.darkMetal);
  b.cylinderX(1.24, 0.20, 0, 0.052, 0.08, 7, PALETTE.hullDark);
  b.box(-0.10, 0.35, 0.16, 0.13, 0.10, 0.14, PALETTE.hullDark);
  b.box(-0.08, 0.38, 0.16, 0.07, 0.02, 0.07, PALETTE.glass);
  return b.build();
}

/**
 * Escort frigate. A longer, higher hull than the corvette with a taller bridge,
 * a boxy naval-SAM launcher aft and four anti-ship canisters amidships. The
 * 76 mm mount is the shared corvette turret.
 */
function buildFrigateBody(): MeshBuffers {
  const b = new MeshBuilder();
  const hull: Color = [0.33, 0.37, 0.39];
  const upper: Color = [0.39, 0.43, 0.44];
  // Lower hull, waterline band and flared upper hull.
  b.box(0.40, 0.44, 0, 11.20, 0.60, 2.24, hull);
  b.box(0.40, 0.76, 0, 10.80, 0.24, 2.40, upper);
  b.addQuad([5.60, 0.34, -1.12], [5.60, 0.34, 1.12], [6.96, 0.64, 0.12], [6.96, 0.64, -0.12], hull);
  b.addQuad([5.60, 0.90, -1.20], [5.60, 0.90, 1.20], [6.96, 0.68, 0.12], [6.96, 0.68, -0.12], upper);
  b.addQuad([5.60, 0.34, -1.12], [6.96, 0.64, -0.12], [6.96, 0.68, -0.12], [5.60, 0.90, -1.20], PALETTE.hullDark);
  b.addQuad([5.60, 0.34, 1.12], [5.60, 0.90, 1.20], [6.96, 0.68, 0.12], [6.96, 0.64, 0.12], PALETTE.hullDark);
  b.box(0.40, 0.14, -1.14, 11.20, 0.10, 0.05, PALETTE.track);
  b.box(0.40, 0.14, 1.14, 11.20, 0.10, 0.05, PALETTE.track);
  // Deck with forecastle, waist and quarterdeck.
  b.box(0.40, 0.91, 0, 11.00, 0.10, 2.18, PALETTE.hullDark);
  b.box(4.10, 0.98, 0, 2.60, 0.06, 1.98, upper);
  b.box(4.10, 1.015, 0, 1.50, 0.02, 1.04, PALETTE.hull, 0.88);
  b.box(-3.40, 0.98, 0, 2.60, 0.06, 2.00, upper);
  // Taller bridge and operations block.
  b.box(-0.60, 1.62, 0, 2.80, 1.18, 1.82, upper);
  b.addQuad([0.80, 1.03, -0.91], [0.80, 1.03, 0.91], [0.62, 2.12, 0.78], [0.62, 2.12, -0.78], PALETTE.hull);
  b.box(-0.62, 2.20, 0, 2.62, 0.12, 1.68, upper);
  b.box(-0.66, 2.33, 0, 1.82, 0.14, 1.32, PALETTE.hull);
  b.box(0.72, 1.68, 0, 0.04, 0.42, 1.58, PALETTE.glassDark);
  b.box(0.74, 1.69, 0, 0.02, 0.32, 1.40, PALETTE.glass);
  for (const z of [-0.93, 0.93]) {
    b.box(-0.55, 1.66, z, 1.55, 0.30, 0.02, PALETTE.glassDark);
    b.box(-0.55, 1.67, z * 1.01, 1.40, 0.22, 0.01, PALETTE.glass);
  }
  // Twin uptakes and a heavy mast with an air-search radar.
  for (const z of [-0.36, 0.36]) {
    b.box(-2.10, 1.76, z, 0.52, 0.98, 0.44, upper);
    b.box(-2.10, 2.27, z, 0.56, 0.10, 0.48, PALETTE.darkMetal);
  }
  b.box(-2.85, 2.55, 0, 0.12, 1.30, 0.12, PALETTE.metal);
  b.box(-2.85, 3.14, 0, 1.86, 0.08, 0.12, PALETTE.metal);
  b.box(-2.85, 3.45, 0, 1.06, 0.30, 0.20, PALETTE.darkMetal);
  b.box(-2.85, 3.49, 0, 0.82, 0.04, 0.12, PALETTE.glassDark);
  // Boxy eight-cell naval SAM launcher on the quarterdeck.
  b.box(-3.75, 1.10, 0, 1.62, 0.62, 1.72, PALETTE.darkMetal);
  b.box(-3.75, 1.43, 0, 1.74, 0.12, 1.86, upper);
  for (const z of [-0.55, -0.18, 0.18, 0.55]) {
    for (const y of [1.18, 1.42]) {
      b.box(-3.06, y, z, 0.10, 0.16, 0.16, PALETTE.oliveDark);
      b.box(-2.97, y, z, 0.02, 0.12, 0.12, PALETTE.track);
    }
  }
  // Four anti-ship canisters amidships, canted outboard.
  for (const z of [-0.78, 0.78]) {
    b.box(-1.85, 1.06, z, 1.46, 0.22, 0.46, PALETTE.darkMetal);
    for (let i = 0; i < 2; i++) {
      b.cylinderX(-1.74, 1.20 + i * 0.16, z, 0.105, 1.30, 8, PALETTE.oliveDark);
      b.box(-1.02, 1.20 + i * 0.16, z, 0.16, 0.20, 0.18, PALETTE.warning);
    }
  }
  // Rails, anchors, rafts and team panels.
  for (const z of [-1.08, 1.08]) {
    b.box(0.40, 1.13, z, 10.30, 0.05, 0.035, PALETTE.metal);
    for (let i = 0; i < 10; i++) {
      b.box(-4.60 + i * 1.04, 1.20, z, 0.025, 0.16, 0.025, PALETTE.metal);
    }
    b.box(-0.40, 1.38, z * 1.13, 1.40, 0.10, 0.02, PALETTE.hull, 0.88);
    b.box(3.70, 1.16, z * 1.06, 0.90, 0.16, 0.16, PALETTE.oliveDark);
    b.box(5.70, 0.45, z * 0.76, 0.14, 0.24, 0.18, PALETTE.darkMetal);
  }
  b.box(5.10, 1.12, 0, 0.70, 0.16, 1.54, PALETTE.hullDark);
  b.box(5.50, 0.74, 0, 0.22, 0.22, 0.90, PALETTE.metal);
  // Stern transom, rudders and screws.
  b.box(-5.56, 0.58, 0, 0.40, 0.72, 2.16, PALETTE.hullDark);
  for (const z of [-0.58, 0.58]) {
    b.box(-5.76, 0.28, z, 0.20, 0.38, 0.14, PALETTE.metal);
    b.cylinderX(-5.82, 0.24, z, 0.14, 0.30, 6, PALETTE.darkMetal);
  }
  return b.build();
}

/**
 * Diesel-electric attack boat. A long, low black hull with a sail, bow dive
 * planes and a stern rudder. The periscope is a separate mesh so a dived boat
 * can show only the feather and wake that its sensors can actually justify.
 */
function buildSubmarineBody(): MeshBuffers {
  const b = new MeshBuilder();
  const hull: Color = [0.16, 0.19, 0.19];
  const upper: Color = [0.21, 0.24, 0.24];
  // Pressure hull with a tapered bow and stern.
  b.box(0.30, 0.38, 0, 6.40, 0.68, 1.34, hull);
  b.addQuad([3.50, 0.20, -0.67], [3.50, 0.20, 0.67], [4.55, 0.38, 0.09], [4.55, 0.38, -0.09], hull);
  b.addQuad([3.50, 0.72, -0.63], [3.50, 0.72, 0.63], [4.55, 0.44, 0.07], [4.55, 0.44, -0.07], upper);
  b.addQuad([3.50, 0.20, -0.67], [4.55, 0.38, -0.09], [4.55, 0.44, -0.07], [3.50, 0.72, -0.63], PALETTE.hullDark);
  b.addQuad([3.50, 0.20, 0.67], [3.50, 0.72, 0.63], [4.55, 0.44, 0.07], [4.55, 0.38, 0.09], PALETTE.hullDark);
  // Broad flat casing and a narrow deck walkway.
  b.box(0.30, 0.76, 0, 6.20, 0.10, 1.50, upper);
  b.box(0.30, 0.82, 0, 5.90, 0.04, 1.10, PALETTE.track);
  // Sail with a raked leading edge, bridge windows and a periscope well.
  b.box(-0.62, 1.08, 0, 1.35, 0.72, 0.70, upper);
  b.addQuad([0.06, 0.76, -0.34], [0.06, 0.76, 0.34], [-0.15, 1.44, 0.30], [-0.15, 1.44, -0.30], hull);
  b.box(-0.56, 1.46, 0, 1.20, 0.08, 0.62, upper);
  b.box(0.02, 1.12, 0, 0.03, 0.18, 0.46, PALETTE.glassDark);
  b.box(0.03, 1.13, 0, 0.02, 0.12, 0.38, PALETTE.glass);
  // Bow dive planes, stern planes and rudder.
  for (const z of [-0.95, 0.95]) {
    b.box(3.25, 0.50, z, 0.95, 0.08, 0.45, hull, 0.95);
    b.box(-3.95, 0.48, z, 0.75, 0.08, 0.30, hull);
  }
  b.box(-3.72, 0.55, 0, 0.55, 0.82, 0.08, hull);
  // Deck hatches, bollards and the torpedo-loading rail.
  for (const x of [-2.55, -1.25, 1.55, 2.55]) {
    b.box(x, 0.84, 0, 0.42, 0.06, 0.46, PALETTE.darkMetal);
  }
  for (const z of [-0.66, 0.66]) {
    b.box(2.60, 0.88, z, 0.12, 0.08, 0.12, PALETTE.metal);
  }
  // Stern propeller guard and shaft.
  b.box(-4.28, 0.38, 0, 0.30, 0.18, 0.18, PALETTE.darkMetal);
  b.cylinderX(-4.48, 0.38, 0, 0.08, 0.18, 6, PALETTE.metal);
  return b.build();
}

function buildSubmarinePeriscope(): MeshBuffers {
  const b = new MeshBuilder();
  // Origin is the waterline; the feather rises just above the sea surface.
  b.cylinder(0, 0.02, 0, 0.10, 0.08, 8, PALETTE.darkMetal);
  b.cylinder(0, 0.50, 0, 0.045, 1.00, 8, PALETTE.metal);
  b.box(0.02, 1.02, 0, 0.12, 0.12, 0.16, PALETTE.darkMetal);
  b.box(0.08, 1.03, 0, 0.10, 0.05, 0.09, PALETTE.glass);
  b.box(-0.06, 1.12, 0, 0.06, 0.04, 0.22, PALETTE.darkMetal);
  return b.build();
}

/**
 * Swedish littoral corvette. The silhouette is the point: a narrow hull with a
 * tumblehome topside (the sides slope *inward* from the waterline to the deck),
 * a plumb faceted prow, a low slab bridge, a flat rotating radar plate on a
 * composite mast and two low canister boxes amidships. No tall funnel and no
 * wide flare, so a Visby reads as a stealth corvette rather than a short
 * frigate at battle zoom.
 */
function buildVisbyBody(): MeshBuffers {
  const b = new MeshBuilder();
  const hull: Color = [0.37, 0.41, 0.42];
  const upper: Color = [0.44, 0.48, 0.48];
  // Narrow waterline hull with a shallow draught.
  b.box(0, 0.34, 0, 8.30, 0.36, 1.58, hull);
  b.box(0, 0.17, 0, 8.30, 0.08, 1.62, PALETTE.track);
  // Tumblehome sides: the deck is 0.56 half-beam against a 0.79 waterline.
  b.addQuad([-4.15, 0.16, -0.79], [4.15, 0.16, -0.79], [4.15, 0.62, -0.56], [-4.15, 0.62, -0.56], upper);
  b.addQuad([-4.15, 0.16, 0.79], [-4.15, 0.62, 0.56], [4.15, 0.62, 0.56], [4.15, 0.16, 0.79], upper);
  // Plumb, faceted prow: a sharp wedge rather than a flared bow.
  b.addQuad([4.15, 0.16, -0.79], [4.15, 0.16, 0.79], [4.85, 0.36, 0.09], [4.85, 0.36, -0.09], hull);
  b.addQuad([4.15, 0.62, -0.56], [4.15, 0.62, 0.56], [4.85, 0.46, 0.08], [4.85, 0.46, -0.08], upper);
  b.addQuad([4.15, 0.16, -0.79], [4.85, 0.36, -0.09], [4.85, 0.46, -0.08], [4.15, 0.62, -0.56], PALETTE.hullDark);
  b.addQuad([4.15, 0.16, 0.79], [4.15, 0.62, 0.56], [4.85, 0.46, 0.08], [4.85, 0.36, 0.09], PALETTE.hullDark);
  // Narrow deck and a short raised forecastle under the gun.
  b.box(-0.05, 0.66, 0, 8.30, 0.10, 1.18, PALETTE.hullDark);
  b.box(2.55, 0.72, 0, 2.30, 0.05, 1.02, upper);
  b.box(2.55, 0.75, 0, 1.30, 0.02, 0.62, PALETTE.hull, 0.88);
  // Low slab bridge with a single raked screen; no tall pilot house.
  b.box(-0.30, 0.98, 0, 1.80, 0.60, 0.86, upper);
  b.addQuad([0.58, 0.68, -0.43], [0.58, 0.68, 0.43], [0.46, 1.26, 0.36], [0.46, 1.26, -0.36], PALETTE.hull);
  b.box(-0.30, 1.32, 0, 1.66, 0.08, 0.78, upper);
  b.box(0.52, 1.02, 0, 0.03, 0.22, 0.66, PALETTE.glassDark);
  b.box(0.54, 1.03, 0, 0.02, 0.16, 0.58, PALETTE.glass);
  // Exhaust trunk instead of a funnel: low, boxed and capped.
  b.box(-0.95, 1.02, 0.26, 0.46, 0.30, 0.32, upper);
  b.box(-0.95, 1.18, 0.26, 0.50, 0.06, 0.36, PALETTE.darkMetal);
  // Composite mast carrying a flat rotating search plate.
  b.box(-1.35, 1.72, 0, 0.12, 1.10, 0.12, PALETTE.metal);
  b.box(-1.35, 2.08, 0, 0.90, 0.06, 0.10, PALETTE.metal);
  b.box(-1.35, 2.30, 0, 0.10, 0.42, 0.86, PALETTE.darkMetal);
  b.box(-1.35, 2.36, 0, 0.06, 0.27, 0.70, PALETTE.glassDark);
  b.box(-1.35, 2.56, 0, 0.05, 0.20, 0.05, PALETTE.metal);
  // Two low anti-ship canister boxes, canted outboard and flush with the deck.
  for (const z of [-0.40, 0.40]) {
    b.box(-2.35, 0.82, z, 1.10, 0.16, 0.30, PALETTE.darkMetal);
    for (const side of [-0.09, 0.09]) {
      b.cylinderX(-2.25, 0.92, z + side, 0.072, 0.95, 8, PALETTE.oliveDark);
      b.box(-1.80, 0.92, z + side, 0.12, 0.15, 0.13, PALETTE.warning);
    }
  }
  // Deck rail, team panels and mooring cleats.
  for (const z of [-0.57, 0.57]) {
    b.box(-0.05, 0.90, z, 7.90, 0.04, 0.03, PALETTE.metal);
    for (let i = 0; i < 7; i++) {
      b.box(-3.30 + i * 1.10, 0.95, z, 0.02, 0.12, 0.02, PALETTE.metal);
    }
    b.box(-0.30, 1.08, z, 1.30, 0.16, 0.02, PALETTE.hull, 0.88);
    b.box(4.05, 0.38, z * 1.10, 0.10, 0.16, 0.12, PALETTE.darkMetal);
  }
  // Stern transom and waterjet nozzles.
  b.box(-4.20, 0.42, 0, 0.24, 0.50, 1.10, PALETTE.hullDark);
  for (const z of [-0.30, 0.30]) {
    b.box(-4.32, 0.30, z, 0.16, 0.22, 0.18, PALETTE.darkMetal);
    b.cylinderX(-4.40, 0.28, z, 0.09, 0.16, 6, PALETTE.metal);
  }
  return b.build();
}

/**
 * Faceted 57 mm stealth mount for the Visby: slab sides, a short tube and no
 * muzzle brake. The local tip is 1.10 / 0.20, so the style offset 2.61 / 0.94
 * lands on the authored 2.6 reach and 0.8 height at the 0.70 ship scale.
 */
function buildVisbyTurret(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, -0.12, 0, 0.24, 0.20, 8, PALETTE.darkMetal);
  b.addQuad([-0.38, 0.00, -0.34], [0.20, 0.00, -0.30], [0.10, 0.30, -0.22], [-0.30, 0.30, -0.26], PALETTE.hull);
  b.addQuad([-0.38, 0.00, 0.34], [-0.30, 0.30, 0.26], [0.10, 0.30, 0.22], [0.20, 0.00, 0.30], PALETTE.hull);
  b.addQuad([-0.38, 0.00, -0.34], [-0.38, 0.00, 0.34], [-0.30, 0.30, 0.26], [-0.30, 0.30, -0.26], PALETTE.hullDark);
  b.addQuad([0.20, 0.00, -0.30], [0.10, 0.30, -0.22], [0.10, 0.30, 0.22], [0.20, 0.00, 0.30], PALETTE.hull);
  b.box(-0.06, 0.31, 0, 0.40, 0.03, 0.42, PALETTE.hull, 0.9);
  b.box(0.16, 0.14, 0, 0.24, 0.20, 0.24, PALETTE.hullDark);
  b.cylinderX(0.60, 0.20, 0, 0.032, 0.90, 7, PALETTE.darkMetal);
  b.cylinderX(1.05, 0.20, 0, 0.048, 0.10, 7, PALETTE.hullDark);
  return b.build();
}

/**
 * Iranian midget submarine. A third the length of the fleet boat with a
 * proportionally huge sail, two external torpedo bulges along the flanks and a
 * stubby rounded pressure hull. The bulges and the short, fat hull are what
 * separate it from the ocean-going submarine in a single glance.
 */
function buildGhadirBody(): MeshBuffers {
  const b = new MeshBuilder();
  const hull: Color = [0.12, 0.15, 0.15];
  const upper: Color = [0.17, 0.2, 0.2];
  // Short pressure hull with a faceted bow.
  b.box(0.40, 0.34, 0, 4.20, 0.62, 1.20, hull);
  b.addQuad([2.50, 0.18, -0.60], [2.50, 0.18, 0.60], [3.35, 0.36, 0.10], [3.35, 0.36, -0.10], hull);
  b.addQuad([2.50, 0.65, -0.56], [2.50, 0.65, 0.56], [3.35, 0.44, 0.08], [3.35, 0.44, -0.08], upper);
  b.addQuad([2.50, 0.18, -0.60], [3.35, 0.36, -0.10], [3.35, 0.44, -0.08], [2.50, 0.65, -0.56], PALETTE.hullDark);
  b.addQuad([2.50, 0.18, 0.60], [2.50, 0.65, 0.56], [3.35, 0.44, 0.08], [3.35, 0.36, 0.10], PALETTE.hullDark);
  // Short casing and a narrow deck walkway.
  b.box(0.40, 0.68, 0, 4.00, 0.10, 1.30, upper);
  b.box(0.40, 0.74, 0, 3.70, 0.04, 0.86, PALETTE.track);
  // Oversized sail with a raked leading edge, windows and a periscope well.
  b.box(-0.55, 1.02, 0, 1.30, 0.70, 0.74, upper);
  b.addQuad([0.10, 0.68, -0.37], [0.10, 0.68, 0.37], [-0.10, 1.38, 0.32], [-0.10, 1.38, -0.32], hull);
  b.box(-0.50, 1.40, 0, 1.16, 0.08, 0.66, upper);
  b.box(0.06, 1.06, 0, 0.03, 0.16, 0.50, PALETTE.glassDark);
  b.box(0.07, 1.07, 0, 0.02, 0.11, 0.42, PALETTE.glass);
  // External torpedo bulges: two fat tubes along the flanks.
  for (const z of [-0.68, 0.68]) {
    b.cylinderX(0.10, 0.44, z, 0.17, 2.50, 8, hull);
    b.box(-1.10, 0.44, z, 0.14, 0.22, 0.22, PALETTE.darkMetal);
    b.box(1.32, 0.44, z, 0.12, 0.20, 0.20, PALETTE.darkMetal);
  }
  // Team panels on the sail sides.
  for (const z of [-0.38, 0.38]) {
    b.box(-0.52, 1.10, z, 1.00, 0.14, 0.02, PALETTE.hull, 0.9);
  }
  // Stubby stern, shroud and a single screw.
  b.box(-1.72, 0.40, 0, 0.40, 0.52, 1.00, hull);
  b.box(-2.10, 0.34, 0, 0.26, 0.16, 0.16, PALETTE.darkMetal);
  b.cylinderX(-2.32, 0.34, 0, 0.09, 0.22, 6, PALETTE.metal);
  // Deck hatches and the snort base.
  for (const x of [-1.20, 0.90]) {
    b.box(x, 0.76, 0, 0.34, 0.05, 0.36, PALETTE.darkMetal);
  }
  return b.build();
}

/**
 * Twin feather for the midget boat: one short periscope and one snort mast, so
 * a dived Ghadir is still distinguishable from the fleet submarine.
 */
function buildGhadirPeriscope(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, 0.02, 0, 0.09, 0.08, 8, PALETTE.darkMetal);
  b.cylinder(-0.06, 0.42, 0, 0.035, 0.80, 8, PALETTE.metal);
  b.box(-0.06, 0.86, 0, 0.10, 0.10, 0.13, PALETTE.darkMetal);
  b.box(-0.02, 0.87, 0, 0.08, 0.045, 0.08, PALETTE.glass);
  b.box(0.10, 0.62, 0, 0.05, 0.62, 0.05, PALETTE.darkMetal);
  b.box(0.10, 0.94, 0, 0.09, 0.05, 0.16, PALETTE.darkMetal);
  return b.build();
}

/**
 * Rotary-wing attack helicopter. The roster had no helicopter mesh, so this is
 * authored rather than composed: a slim nose-forward fuselage, tail boom and
 * fin, stub wings with missile pods, skids, and a crossed rotor disc that still
 * reads as a turning blade at battle zoom. Forward is +X like every other unit.
 */
function buildAttackHelo(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.9, 0, 3.0, 0.9, 1.0, PALETTE.hull, 0.55);
  b.box(0.9, 1.2, 0, 1.1, 0.5, 0.85, PALETTE.glass, 0.2);
  b.box(1.6, 0.95, 0, 0.5, 0.4, 0.45, PALETTE.darkMetal, 0.3);
  b.box(1.45, 0.45, 0, 0.9, 0.22, 0.22, PALETTE.darkMetal);
  b.box(-2.4, 1.05, 0, 2.2, 0.28, 0.3, PALETTE.hull, 0.45);
  b.box(-3.4, 1.35, 0, 0.5, 0.75, 0.16, PALETTE.darkMetal, 0.3);
  b.box(-0.1, 0.95, 0, 0.9, 0.16, 3.4, PALETTE.hull, 0.4);
  b.box(-0.1, 0.75, 1.5, 0.8, 0.3, 0.34, PALETTE.darkMetal);
  b.box(-0.1, 0.75, -1.5, 0.8, 0.3, 0.34, PALETTE.darkMetal);
  b.cylinder(0, 1.55, 0, 0.12, 0.5, 8, PALETTE.darkMetal);
  b.box(0, 1.8, 0, 7.6, 0.07, 0.34, PALETTE.darkMetal, 0.2);
  b.box(0, 1.8, 0, 0.34, 0.07, 7.6, PALETTE.darkMetal, 0.2);
  b.box(-3.45, 1.35, 0.35, 0.1, 0.1, 1.2, PALETTE.darkMetal);
  b.box(0, 0.28, 0.55, 2.4, 0.12, 0.14, PALETTE.darkMetal);
  b.box(0, 0.28, -0.55, 2.4, 0.12, 0.14, PALETTE.darkMetal);
  return b.build();
}

/**
 * Visual-only scale per unit. The roster is now authored at the shared 1:1
 * world scale; the ships keep a presentation multiplier because their hulls are
 * authored around a shipyard slip rather than a 2 m soldier. Collision radii,
 * movement and picking are untouched.
 */
/* ------------------------------------------------------------------------
 * National exclusives.
 *
 * Each nation contributes exactly one extra unit, so the model has to carry
 * that identity on its own: a shared body would make a Polish Wilk read as a
 * baseline IFV at battle zoom. These are deliberately modest silhouettes that
 * sit inside the existing scale envelope rather than new proportions.
 * --------------------------------------------------------------------- */

function buildKestrelTeam(): MeshBuffers {
  const b = new MeshBuilder();
  addInfantryBase(b, INFANTRY_UNIFORM, { antenna: true });
  // Shoulder launcher angled up and forward; two hands steady the tube.
  beam(b, [0.02, 0.98, 0.16], [0.40, 1.22, 0.16], 0.10, 0.10, PALETTE.oliveDark);
  beam(b, [0.40, 1.22, 0.16], [0.60, 1.30, 0.16], 0.075, 0.075, PALETTE.darkMetal);
  b.box(0.60, 1.30, 0.16, 0.09, 0.09, 0.09, PALETTE.track);
  b.box(0.26, 1.14, 0.16, 0.10, 0.05, 0.07, PALETTE.glass);
  addArm(b, [0, 0.97, 0.14], [0.10, 0.96, 0.18], [0.22, 1.10, 0.16], INFANTRY_UNIFORM);
  addArm(b, [0, 0.97, -0.14], [0.06, 1.02, 0.00], [0.30, 1.18, 0.08], INFANTRY_UNIFORM);
  return b.build();
}

function buildHedgehogTeam(): MeshBuffers {
  const b = new MeshBuilder();
  addInfantryBase(b, INFANTRY_UNIFORM, { antenna: true });
  // A short launch tube, with the two ready rounds racked at the hip.
  b.cylinderX(0.04, 0.96, 0.22, 0.052, 0.52, 8, PALETTE.hullDark);
  b.cylinderX(-0.24, 0.96, 0.22, 0.065, 0.06, 8, PALETTE.darkMetal);
  b.cylinderX(0.31, 0.96, 0.22, 0.05, 0.04, 8, PALETTE.track);
  b.box(0.06, 1.06, 0.22, 0.08, 0.05, 0.05, PALETTE.darkMetal);
  b.box(0.075, 1.065, 0.22, 0.02, 0.02, 0.03, PALETTE.glass);
  for (const y of [0.78, 0.88]) b.cylinderX(-0.30, y, 0.04, 0.05, 0.34, 6, PALETTE.oliveDark);
  addArm(b, [0, 0.97, 0.14], [0.08, 0.86, 0.18], [0.14, 0.90, 0.24], INFANTRY_UNIFORM);
  addArm(b, [0, 0.97, -0.14], [0.05, 1.00, 0.06], [0.10, 1.02, 0.20], INFANTRY_UNIFORM);
  return b.build();
}

function buildTaszarTeam(): MeshBuffers {
  const b = new MeshBuilder();
  addInfantryBase(b, INFANTRY_UNIFORM, { pack: true });
  // Light mortar: baseplate on the ground, tube elevated forward, bipod braced.
  b.box(0.18, 0.32, 0.10, 0.26, 0.05, 0.22, PALETTE.metal);
  beam(b, [0.16, 0.34, 0.10], [0.50, 1.06, 0.10], 0.075, 0.075, PALETTE.oliveDark);
  b.box(0.515, 1.08, 0.10, 0.10, 0.06, 0.09, PALETTE.track);
  for (const z of [-0.04, 0.24]) {
    beam(b, [0.12, 0.34, z], [0.30, 0.70, z], 0.032, 0.032, PALETTE.darkMetal);
  }
  b.box(0.22, 0.74, 0.10, 0.10, 0.06, 0.12, PALETTE.darkMetal);
  addArm(b, [0, 0.97, 0.14], [0.14, 0.80, 0.20], [0.30, 0.92, 0.14], INFANTRY_UNIFORM);
  addArm(b, [0, 0.97, -0.14], [0.10, 0.86, -0.04], [0.22, 0.80, 0.02], INFANTRY_UNIFORM);
  return b.build();
}

/** Polish heavy IFV: a tracked hull with side skirts and a rear troop ramp. */
function buildWilkBody(): MeshBuffers {
  const b = new MeshBuilder();
  addTrackedRunningGear(b, {
    front: 2.30,
    rear: -2.00,
    halfTrack: 0.64,
    trackWidth: 0.34,
    wheelCount: 6,
    wheelStart: -1.32,
    wheelEnd: 1.70,
    wheelRadius: 0.22,
  });
  b.box(0, 0.54, 0, 3.85, 0.34, 1.30, PALETTE.hullDark);
  b.box(-0.05, 0.79, 0, 3.60, 0.24, 1.40, PALETTE.hull);
  b.addQuad(
    [1.75, 0.90, -0.68],
    [1.75, 0.90, 0.68],
    [2.28, 0.66, 0.56],
    [2.28, 0.66, -0.56],
    PALETTE.hullLight,
  );
  for (const z of [-0.71, 0.71]) b.box(-0.05, 0.50, z, 3.30, 0.40, 0.05, PALETTE.hullDark);
  // Driver's hatch, periscopes and the roof team panel.
  b.box(1.42, 0.93, 0.28, 0.44, 0.10, 0.44, PALETTE.hullDark);
  for (const z of [0.18, 0.38]) b.box(1.62, 1.00, z, 0.06, 0.06, 0.10, PALETTE.glass);
  b.box(0.15, 0.925, 0, 1.30, 0.02, 1.05, PALETTE.hull, 0.85);
  // Stowage, rear ramp and taillights.
  b.box(-1.20, 0.95, 0.55, 0.62, 0.22, 0.24, PALETTE.canvas);
  b.box(-1.20, 0.95, -0.55, 0.62, 0.22, 0.24, PALETTE.canvas);
  b.box(-1.92, 0.72, 0, 0.10, 0.62, 1.10, PALETTE.hullDark);
  for (const z of [-0.42, 0.42]) b.box(-1.98, 0.78, z, 0.04, 0.10, 0.12, PALETTE.red);
  return b.build();
}

/** Autocannon plus a two-round ATGM pod: the Wilk's reason to exist. */
function buildWilkTurret(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, 0.02, 0, 0.50, 0.06, 12, PALETTE.hullDark);
  b.box(-0.02, 0.20, 0, 0.94, 0.34, 0.82, PALETTE.hullDark);
  b.box(-0.06, 0.42, 0, 0.78, 0.16, 0.68, PALETTE.hull);
  b.cylinderX(0.62, 0.23, 0, 0.042, 0.96, 6, PALETTE.darkMetal);
  b.cylinderX(1.12, 0.23, 0, 0.058, 0.10, 6, PALETTE.hullDark);
  b.box(0.30, 0.23, 0, 0.24, 0.14, 0.22, PALETTE.metal);
  // Missile pod on the left cheek.
  b.box(0.18, 0.32, -0.42, 0.46, 0.24, 0.20, PALETTE.oliveDark);
  for (const y of [0.27, 0.37]) b.cylinderX(0.42, y, -0.42, 0.045, 0.10, 6, PALETTE.track);
  b.box(-0.04, 0.53, 0.18, 0.18, 0.13, 0.22, PALETTE.hullDark);
  b.box(-0.04, 0.575, 0.20, 0.10, 0.03, 0.12, PALETTE.glass);
  b.cylinder(-0.12, 0.50, -0.20, 0.11, 0.06, 10, PALETTE.hullDark);
  for (const z of [-0.30, 0.30]) b.cylinderX(0.02, 0.44, z, 0.025, 0.10, 4, PALETTE.darkMetal);
  for (const z of [-0.415, 0.415]) b.box(-0.02, 0.22, z, 0.46, 0.16, 0.018, PALETTE.hull, 0.82);
  return b.build();
}

/** British eight-wheeled deep-strike TEL with a cab and a flat launch deck. */
function buildStormShadowBody(): MeshBuffers {
  const b = new MeshBuilder();
  for (const x of [-1.55, -0.52, 0.52, 1.55]) {
    for (const z of [-0.68, 0.68]) {
      b.cylinderZ(x, 0.40, z, 0.40, 0.30, 12, PALETTE.rubber);
      b.cylinderZ(x, 0.40, z, 0.17, 0.32, 10, PALETTE.metal);
      b.box(x, 0.83, z * 1.04, 0.90, 0.06, 0.34, PALETTE.hullDark);
    }
  }
  b.box(0, 0.54, 0, 4.30, 0.34, 1.26, PALETTE.hullDark);
  b.box(0, 0.76, 0, 4.10, 0.18, 1.36, PALETTE.hull);
  // Cab-over crew cab and raked glazing.
  b.box(1.45, 1.02, 0, 1.10, 0.50, 1.24, PALETTE.hullLight);
  b.box(2.02, 1.06, 0, 0.04, 0.30, 1.02, PALETTE.glassDark);
  b.box(2.04, 1.10, 0, 0.03, 0.20, 0.86, PALETTE.glass);
  b.box(0.60, 0.92, 0, 1.50, 0.06, 1.30, PALETTE.hullDark);
  b.box(-1.10, 0.925, 0, 1.60, 0.02, 1.18, PALETTE.hull, 0.85);
  // Rear stabiliser legs and a hazard band across the tail.
  for (const z of [-0.52, 0.52]) b.box(-1.85, 0.42, z, 0.12, 0.60, 0.12, PALETTE.metal);
  b.box(-2.02, 0.42, 0, 0.10, 0.10, 1.90, PALETTE.warning);
  return b.build();
}

/** One sealed cruise-missile canister on an elevating cradle. */
function buildStormShadowLauncher(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, 0.02, 0, 0.48, 0.06, 12, PALETTE.hullDark);
  b.box(-0.10, 0.22, 0, 0.44, 0.38, 0.40, PALETTE.hullDark);
  b.box(0.05, 0.52, 0, 0.30, 0.22, 0.34, PALETTE.metal);
  b.cylinderX(-0.55, 0.72, 0, 0.20, 1.90, 12, PALETTE.olive);
  b.cylinderX(0.42, 0.72, 0, 0.205, 0.10, 12, PALETTE.hullDark);
  b.cylinderX(0.47, 0.72, 0, 0.15, 0.04, 10, PALETTE.track);
  b.box(-1.52, 0.72, 0, 0.10, 0.34, 0.34, PALETTE.hullDark);
  for (const z of [-0.26, 0.26]) b.box(-0.10, 0.66, z, 0.12, 0.26, 0.08, PALETTE.metal);
  b.box(-0.30, 0.72, 0, 0.10, 0.06, 0.40, PALETTE.warning);
  b.box(0.02, 0.86, 0.24, 0.16, 0.10, 0.14, PALETTE.glassDark);
  return b.build();
}

/** Russian thermobaric launcher: twelve tubes in a box on a tank chassis. */
function buildTospLauncher(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, 0.02, 0, 0.55, 0.06, 12, PALETTE.hullDark);
  b.box(-0.10, 0.28, 0, 1.05, 0.46, 1.02, PALETTE.hullDark);
  b.box(-0.16, 0.52, 0, 0.90, 0.12, 0.92, PALETTE.hull);
  for (const z of [-0.30, -0.10, 0.10, 0.30]) {
    for (const y of [0.34, 0.54]) b.cylinderX(0.55, y, z, 0.072, 1.30, 8, PALETTE.track);
  }
  b.box(0.50, 0.44, 0, 0.10, 0.40, 0.86, PALETTE.hullDark);
  b.box(-0.50, 0.62, 0.36, 0.20, 0.14, 0.18, PALETTE.hullDark);
  b.box(-0.50, 0.665, 0.40, 0.10, 0.03, 0.10, PALETTE.glass);
  for (const z of [-0.50, 0.50]) b.box(-0.02, 0.28, z, 0.96, 0.18, 0.018, PALETTE.hull, 0.82);
  return b.build();
}

/** Belarusian open scout buggy: an unarmoured tub, a roll hoop and optics. */
function buildSprutBody(): MeshBuffers {
  const b = new MeshBuilder();
  for (const x of [-0.72, 0.72]) {
    for (const z of [-0.62, 0.62]) {
      b.cylinderZ(x, 0.34, z, 0.34, 0.24, 12, PALETTE.rubber);
      b.cylinderZ(x, 0.34, z, 0.15, 0.26, 10, PALETTE.metal);
      b.box(x, 0.70, z * 1.02, 0.70, 0.05, 0.28, PALETTE.hullDark);
    }
  }
  b.box(0, 0.46, 0, 2.10, 0.28, 1.10, PALETTE.hullDark);
  b.box(-0.10, 0.62, 0, 1.60, 0.10, 1.18, PALETTE.hull);
  b.addQuad(
    [0.85, 0.72, -0.56],
    [0.85, 0.72, 0.56],
    [1.18, 0.50, 0.44],
    [1.18, 0.50, -0.44],
    PALETTE.hullLight,
  );
  for (const z of [-0.58, 0.58]) b.box(-0.10, 0.70, z, 1.60, 0.18, 0.05, PALETTE.hullDark);
  // Two seats and the roll hoop that carries the optics head.
  for (const x of [0.32, -0.28]) b.box(x, 0.80, 0.20, 0.34, 0.10, 0.40, PALETTE.oliveDark);
  for (const z of [-0.30, 0.30]) b.box(0.02, 1.14, z, 0.08, 0.72, 0.08, PALETTE.metal);
  b.box(0.02, 1.50, 0, 0.08, 0.08, 0.68, PALETTE.metal);
  b.box(-0.10, 1.62, 0.30, 0.22, 0.20, 0.22, PALETTE.hullDark);
  b.box(0.01, 1.63, 0.42, 0.10, 0.10, 0.03, PALETTE.glass);
  // Rear deck panel, spare wheel and stowage box.
  b.box(-0.92, 0.72, 0, 0.18, 0.34, 0.94, PALETTE.hull, 0.85);
  b.cylinderZ(-1.00, 0.74, 0, 0.26, 0.12, 12, PALETTE.rubber);
  return b.build();
}

const VISUAL_SCALE: Record<string, number> = {
  rifle: 1,
  atgm: 1,
  medic: 1,
  engineer: 1,
  tank: 1,
  spg: 1,
  recon: 1,
  pathfinder: 1,
  spearhead: 1,
  mlrs: 1,
  heavyHowitzer: 1,
  k9Thunder: 1,
  koksan: 1.0,
  cv90: 1,
  khordadSam: 1,
  gripen: 1,
  mohajer6: 1,
  bulsae4: 1,
  aa: 1,
  recovery: 1,
  harvester: 1,
  fighter: 1,
  interceptor: 1,
  uav: 1,
  deepReconUAV: 1,
  // A buggy is deliberately smaller than the armoured scout it complements.
  sprut: 0.85,
  ifv: 1,
  td: 1,
  rocketArtillery: 1,
  attackHelo: 1,
  missileBoat: 0.7,
  corvette: 0.7,
  submarine: 0.7,
  frigate: 0.7,
  navalSupport: 0.7,
  missileBoatEC: 0.7,
  corvetteEC: 0.7,
  submarineEC: 0.7,
  frigateEC: 0.7,
  navalSupportEC: 0.7,
  // National naval hulls. A littoral corvette and a midget boat are smaller
  // than the fleet hulls they fight beside, so both keep the ship multiplier.
  visby: 0.7,
  ghadir: 0.7,
};

export function unitVisualScale(id: string): number {
  return VISUAL_SCALE[id] ?? 1;
}

/**
 * Ground footprint used for the soft contact shadow, in world units. These
 * follow the scaled meshes rather than the collision radius, so a lone
 * infantryman gets a small shadow and a tank keeps its hull-shaped pool.
 */
const SHADOW_RADIUS: Record<string, [number, number]> = {
  rifle: [0.28, 0.22],
  atgm: [0.32, 0.22],
  medic: [0.28, 0.22],
  engineer: [2.0, 1.15],
  tank: [1.9, 0.95],
  spg: [2.0, 0.95],
  recon: [1.70, 0.88],
  pathfinder: [1.70, 0.88],
  spearhead: [2.05, 1.0],
  mlrs: [1.95, 0.90],
  heavyHowitzer: [2.05, 0.90],
  aa: [1.95, 1.05],
  recovery: [2.15, 1.05],
  harvester: [2.75, 1.30],
  fighter: [2.40, 2.20],
  interceptor: [2.40, 2.20],
  uav: [1.60, 1.00],
  deepReconUAV: [1.80, 1.00],
  kestrelTeam: [0.30, 0.22],
  hedgehogTeam: [0.32, 0.22],
  taszar: [0.30, 0.22],
  spikeTeam: [0.34, 0.24],
  gripen: [2.40, 1.00],
  mohajer6: [1.60, 0.90],
  bulsae4: [1.55, 0.95],
  khordadSam: [1.50, 0.95],
  wilk: [1.95, 0.98],
  stormShadow: [2.25, 1.00],
  tosp: [2.05, 1.00],
  sprut: [1.05, 0.75],
  missileBoat: [2.30, 0.80],
  corvette: [3.60, 1.10],
  submarine: [3.00, 0.85],
  frigate: [4.40, 1.30],
  visby: [3.20, 0.72],
  ghadir: [1.95, 0.48],
};

export function unitShadowRadius(id: string): [number, number] {
  return SHADOW_RADIUS[id] ?? [1.4, 1.4];
}

/**
 * Ground presence pool for foot units. At battle zoom a rifleman is only a few
 * pixels wide, so infantry also stamp a soft team-coloured ellipse on the
 * ground beneath the normal contact shadow. It is presentation only: no
 * entity, picking, collision or simulation state, and vehicles do not get one
 * because their painted roof panels carry ownership without a second decal.
 */
const GROUND_MARKER: Record<string, { rx: number; rz: number; alpha: number }> = {
  rifle: { rx: 0.52, rz: 0.28, alpha: 0.42 },
  atgm: { rx: 0.56, rz: 0.30, alpha: 0.42 },
  medic: { rx: 0.52, rz: 0.28, alpha: 0.42 },
  rifleEC: { rx: 0.52, rz: 0.28, alpha: 0.42 },
  atgmEC: { rx: 0.56, rz: 0.30, alpha: 0.42 },
  kestrelTeam: { rx: 0.52, rz: 0.28, alpha: 0.42 },
  hedgehogTeam: { rx: 0.56, rz: 0.30, alpha: 0.42 },
  taszar: { rx: 0.50, rz: 0.28, alpha: 0.42 },
  spikeTeam: { rx: 0.52, rz: 0.28, alpha: 0.42 },
};

export function unitGroundMarker(id: string): { rx: number; rz: number; alpha: number } | null {
  return GROUND_MARKER[id] ?? null;
}

/**
 * Height of the health-bar anchor above the unit origin. Models authored at the
 * shared 1:1 scale carry an anchor just above their own roof; legacy vehicles
 * that have not been reworked yet keep the old default until their turn.
 */
const BANNER_HEIGHT: Record<string, number> = {
  rifle: 1.35,
  atgm: 1.45,
  medic: 1.30,
  tank: 1.55,
  spg: 2.20,
  recon: 2.00,
  pathfinder: 2.00,
  mlrs: 2.35,
  heavyHowitzer: 2.35,
  engineer: 2.60,
  spearhead: 1.80,
  aa: 2.40,
  recovery: 3.00,
  harvester: 3.10,
  fighter: 1.75,
  interceptor: 1.95,
  uav: 1.45,
  deepReconUAV: 1.45,
  kestrelTeam: 1.45,
  hedgehogTeam: 1.45,
  taszar: 1.35,
  spikeTeam: 1.40,
  k9Thunder: 2.25,
  koksan: 2.45,
  cv90: 1.95,
  khordadSam: 2.30,
  gripen: 1.80,
  mohajer6: 1.60,
  bulsae4: 1.95,
  visby: 1.95,
  ghadir: 1.42,
  wilk: 1.75,
  stormShadow: 2.10,
  tosp: 2.05,
  sprut: 1.95,
  missileBoat: 2.05,
  corvette: 2.75,
  submarine: 2.10,
  frigate: 3.35,
};

export function unitBannerHeight(id: string): number {
  return BANNER_HEIGHT[id] ?? 5;
}

/**
 * Render-only altitude of an airborne unit above the ground, in world units.
 * The renderer, selection ring and health-bar anchor must all use the same
 * value; a separate overlay altitude left air bars floating metres above the
 * aircraft they describe.
 */
export const AIR_UNIT_ALTITUDE = 13;

const RECON_BODY = buildRecon();
const MBT_BODY = buildMbtBody();
const MBT_TURRET = buildMbtTurret();
/** The frigate carries the same 76 mm mount as the corvette. */
const CORVETTE_TURRET = buildCorvetteTurret();

const STYLES: Record<string, EntityStyle> = {
  rifle: { body: buildRifle(), turretOffset: [0, 0, 0], infantry: infantryRig() },
  atgm: { body: buildAtgm(), turretOffset: [0, 0, 0], infantry: infantryRig() },
  medic: { body: buildMedic(), turretOffset: [0, 0, 0], infantry: infantryRig() },
  engineer: { body: buildEngineer(), turretOffset: [0, 0, 0] },
  tank: {
    body: MBT_BODY,
    turret: MBT_TURRET,
    turretOffset: [0, 0.98, 0],
  },
  spg: {
    body: buildSpgBody(),
    turret: buildSpgTurret(),
    // The casemate mount is behind the hull centre; the 2.60 local tube tip
    // plus this offset lands on the authored 2.30 muzzle hardpoint.
    turretOffset: [-0.30, 0.95, 0],
  },
  recon: {
    body: RECON_BODY,
    turret: buildReconTurret(),
    turretOffset: [0, 1.0, 0],
  },
  // The Pathfinder is the same wheeled hull without the autocannon; the rear
  // optics mast stays visible, which is its role cue. Sharing the body mesh
  // keeps the pair from drifting into different scout proportions.
  pathfinder: { body: RECON_BODY, turretOffset: [0, 0, 0] },
  spearhead: {
    // The Polish variant shares the genuine MBT hull component but not its
    // turret: the add-on wedges, remote sight and longer gun are its identity.
    body: MBT_BODY,
    turret: buildSpearheadTurret(),
    turretOffset: [0, 1.0, 0],
  },
  mlrs: {
    body: buildMlrsBody(),
    turret: buildMlrsLauncher(),
    turretOffset: [0, 0, 0],
    // Hinge at the rear cradle; the stowed pack is flat and below the cab roof,
    // then rises only while the battery is laying on a target.
    launcherPivot: [-1.35, 1.10, 0],
    launcherElevation: 0.42,
  },
  heavyHowitzer: {
    body: buildHeavyHowitzerBody(),
    turret: buildHeavyHowitzerTurret(),
    turretOffset: [0, 0.85, 0],
  },
  // National exclusives. Each has its own hull or crew kit so the extra option
  // a nation brings is recognisable by silhouette, not only by its card.
  kestrelTeam: { body: buildKestrelTeam(), turretOffset: [0, 0, 0], infantry: infantryRig() },
  hedgehogTeam: { body: buildHedgehogTeam(), turretOffset: [0, 0, 0], infantry: infantryRig() },
  taszar: { body: buildTaszarTeam(), turretOffset: [0, 0, 0], infantry: infantryRig() },
  wilk: {
    body: buildWilkBody(),
    turret: buildWilkTurret(),
    turretOffset: [0, 1.0, 0],
  },
  stormShadow: {
    body: buildStormShadowBody(),
    turret: buildStormShadowLauncher(),
    turretOffset: [0, 0.95, 0],
  },
  tosp: {
    // A thermobaric launcher rides a tank chassis: the MBT hull is the correct
    // family cue, and the box salvo is what the player must learn to spot.
    body: MBT_BODY,
    turret: buildTospLauncher(),
    turretOffset: [0, 0.95, 0],
  },
  sprut: { body: buildSprutBody(), turretOffset: [0, 0, 0] },
  aa: {
    body: buildAA(),
    turret: buildAATurret(),
    // Local missile axis 0.24 + this mount lands on the authored 1.39 m
    // hardpoint without moving the launcher or its projectile spawn.
    turretOffset: [0, 1.15, 0],
  },
  recovery: { body: buildRecovery(), turretOffset: [0, 0, 0] },
  harvester: { body: buildHarvester(), turretOffset: [0, 0, 0], load: buildHarvesterLoad() },
  fighter: { body: buildFighter(), turretOffset: [0, 0, 0] },
  interceptor: { body: buildInterceptor(), turretOffset: [0, 0, 0] },
  uav: { body: buildUav(), turretOffset: [0, 0, 0] },
  deepReconUAV: { body: buildDeepReconUav(), turretOffset: [0, 0, 0] },
  missileBoat: {
    body: buildMissileBoatBody(),
    turret: buildMissileBoatTurret(),
    // 0.60 + 1.32 local = 1.34 at the 0.70 scale, the authored 1.35 reach;
    // 0.65 + 0.29 = 0.66 local, the authored 0.62 height.
    turretOffset: [0.60, 0.65, 0],
  },
  corvette: {
    body: buildCorvetteBody(),
    turret: CORVETTE_TURRET,
    // 2.90 + 1.40 local = 4.30 at the 0.70 scale, the authored 3.0 reach;
    // 1.05 + 0.22 = 1.27 local, the authored 0.90 height.
    turretOffset: [2.90, 1.05, 0],
  },
  submarine: {
    body: buildSubmarineBody(),
    turretOffset: [0, 0, 0],
    periscope: buildSubmarinePeriscope(),
    periscopeOffset: [0, 0.02, 0],
  },
  frigate: {
    body: buildFrigateBody(),
    // The frigate mounts the same 76 mm turret as the corvette on a longer
    // forecastle; the SAM box and extra canisters live on the hull instead.
    turret: CORVETTE_TURRET,
    // 3.60 + 1.40 local = 3.50 at the 0.70 scale, the authored 3.5 reach;
    // 1.15 + 0.22 = 0.96 local, the authored 0.95 height.
    turretOffset: [3.60, 1.15, 0],
  },
  // Slots the old shared baseline did not have. Each adopts the closest
  // authored hull and a turret from a different family, which is the same
  // composition the national variants already use; the five silhouettes stay
  // distinguishable from every existing unit.
  ifv: {
    body: buildSpgBody(),
    turret: buildReconTurret(),
    turretOffset: [0, 0.95, 0],
  },
  td: {
    body: RECON_BODY,
    turret: buildAATurret(),
    turretOffset: [0, 1.0, 0],
  },
  rocketArtillery: {
    body: buildSpgBody(),
    turret: buildMlrsLauncher(),
    turretOffset: [0, 1.0, 0],
  },
  attackHelo: { body: buildAttackHelo(), turretOffset: [0, 0, 0] },
  navalSupport: {
    body: buildMissileBoatBody(),
    turret: CORVETTE_TURRET,
    turretOffset: [1.2, 0.62, 0],
  },
  // National naval hulls are authored rather than borrowed from their family:
  // the tumblehome Swedish corvette and the short, bulged Iranian midget boat
  // are the two silhouettes a player has to be able to name at battle zoom.
  visby: {
    body: buildVisbyBody(),
    turret: buildVisbyTurret(),
    // 2.61 + 1.10 local = 3.71 at the 0.70 scale, the authored 2.6 reach;
    // 0.94 + 0.20 = 1.14 local, the authored 0.8 height.
    turretOffset: [2.61, 0.94, 0],
  },
  ghadir: {
    body: buildGhadirBody(),
    turretOffset: [0, 0, 0],
    periscope: buildGhadirPeriscope(),
    periscopeOffset: [0, 0.02, 0],
  },
};

/**
 * Alliance platforms currently share their canonical slot's authored mesh.
 * Their equipment differs in data — gun, armour, salvo, hull — but a bespoke
 * silhouette per platform is a separate art pass, so this keeps every unit
 * rendering a complete coherent model instead of the fallback box. Retire an
 * entry here as soon as that platform gets its own parts.
 */
const FAMILY_SHARED_STYLES: Record<string, string> = {
  rifleEC: 'rifle',
  atgmEC: 'atgm',
  reconEC: 'recon',
  ifvEC: 'ifv',
  tankEC: 'tank',
  tdEC: 'td',
  spgEC: 'spg',
  rocketArtilleryEC: 'rocketArtillery',
  aaEC: 'aa',
  uavEC: 'uav',
  interceptorEC: 'interceptor',
  fighterEC: 'fighter',
  attackHeloEC: 'attackHelo',
  missileBoatEC: 'missileBoat',
  corvetteEC: 'corvette',
  frigateEC: 'frigate',
  submarineEC: 'submarine',
  navalSupportEC: 'navalSupport',
  /*
   * Expansion-nation equipment shares its canonical family's rig for the same
   * reason the alliance platforms do: the data and the card carry the identity,
   * and a bespoke silhouette per hull is a separate art pass. Replace an entry
   * here when that unit gets its own parts.
   */
  k9Thunder: 'spg',
  cv90: 'ifv',
  khordadSam: 'aa',
  koksan: 'spg',
  spikeTeam: 'atgm',
  gripen: 'fighter',
  mohajer6: 'uav',
  bulsae4: 'td',
};

for (const [platform, slot] of Object.entries(FAMILY_SHARED_STYLES)) {
  const style = STYLES[slot];
  if (style) STYLES[platform] = style;
}

export function unitStyle(id: string): EntityStyle | undefined {
  return STYLES[id];
}

/** Placeholder style for unknown unit ids. */
export const FALLBACK_STYLE: EntityStyle = {
  body: (() => {
    const b = new MeshBuilder();
    b.box(0, 0.7, 0, 2.5, 1.4, 1.8, PALETTE.hull, 0.5);
    return b.build();
  })(),
  turretOffset: [0, 0, 0],
};
