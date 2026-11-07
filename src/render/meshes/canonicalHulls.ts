import { MeshBuilder, PALETTE, type Color } from '../geometry';
import type { MeshBuffers } from '../gl';
import type { Vec3 } from '../math';
import { beam } from '../meshKit';
import type { EntityStyle } from '../unitMeshes';

/**
 * Canonical-hull corrections.
 *
 * Three slots in the baseline roster never got a chassis of their own: the IFV
 * rendered on the howitzer's hull, the tank destroyer on the scout car's, and
 * the rocket battery on the howitzer's again. The turrets differed, so the
 * units were technically distinct, but a player looking down at a column saw
 * two howitzer hulls and read them as the same vehicle.
 *
 * Each model here is a purpose-built chassis for its role, and none of them
 * repeats the running-gear, deck layout or superstructure of the family it used
 * to borrow. Conventions match `unitMeshes`: +X is the nose, geometry is built
 * upward from y = 0, the origin is the hull centre, and the turret is authored
 * around its own ring so `turretOffset` plants it on the hull.
 */

const WEST_PAINT: Color = [0.30, 0.34, 0.30];
const WEST_PAINT_LIGHT: Color = [0.40, 0.44, 0.38];
const WEST_PAINT_DARK: Color = [0.20, 0.23, 0.20];
const WEST_BLACK: Color = [0.09, 0.10, 0.09];
/** Team colour weight for a panel that must read from the battle camera. */
const TEAM = 0.9;

/**
 * Single-sided plate with a guaranteed outward winding. `MeshBuilder` derives
 * the lighting normal from the vertex order, so a hand-written sloped plate can
 * end up lit as though it faced into the hull; passing the direction the plate
 * should face lets the helper flip it when the corners are given the other way
 * round.
 */
function face(
  b: MeshBuilder,
  corners: readonly [Vec3, Vec3, Vec3, Vec3],
  outward: Vec3,
  color: Color,
  team = 0,
): void {
  const [a, c, d, e] = corners;
  const ux = c[0] - a[0];
  const uy = c[1] - a[1];
  const uz = c[2] - a[2];
  const vx = e[0] - a[0];
  const vy = e[1] - a[1];
  const vz = e[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx * outward[0] + ny * outward[1] + nz * outward[2] >= 0) {
    b.addQuad(a, c, d, e, color, team);
  } else {
    b.addQuad(e, d, c, a, color, team);
  }
}

interface TrackGearOptions {
  front: number;
  rear: number;
  halfTrack: number;
  trackWidth: number;
  wheelCount: number;
  wheelRadius: number;
  wheelWidth: number;
  /** Height of the fender plate above the ground. */
  fender: number;
}

/**
 * Segmented track run. Separate lower and return belts with individual shoes,
 * swing arms and hub-stepped road wheels: the wheel count is the first thing
 * that separates a six-wheel IFV from a howitzer carrier.
 */
function trackGear(b: MeshBuilder, o: TrackGearOptions): void {
  const length = o.front - o.rear;
  const mid = (o.front + o.rear) / 2;
  for (const side of [-1, 1]) {
    const z = o.halfTrack * side;
    b.box(mid, 0.15, z, length, 0.26, o.trackWidth, WEST_BLACK);
    b.box(mid, 0.60, z, length, 0.10, o.trackWidth, WEST_BLACK);
    for (let i = 0; i < 12; i++) {
      const x = o.rear + 0.18 + (i * (length - 0.36)) / 11;
      b.box(x, 0.665, z, 0.14, 0.04, o.trackWidth + 0.014, PALETTE.darkMetal);
    }
    for (let i = 0; i < o.wheelCount; i++) {
      const t = o.wheelCount === 1 ? 0.5 : i / (o.wheelCount - 1);
      const x = o.rear + 0.52 + (length - 1.04) * t;
      b.box(x, 0.32, z * 0.66, 0.12, 0.10, 0.16, PALETTE.metal);
      b.cylinderZ(x, o.wheelRadius, z, o.wheelRadius, o.wheelWidth, 11, PALETTE.darkMetal);
      b.cylinderZ(x, o.wheelRadius, z, o.wheelRadius * 0.44, o.wheelWidth + 0.02, 9, PALETTE.metal);
      b.cylinderZ(x, o.wheelRadius, z, o.wheelRadius * 0.16, o.wheelWidth + 0.045, 7, PALETTE.track);
    }
    // Drive sprocket forward, idler aft, with a visible final drive.
    b.cylinderZ(o.front - 0.34, 0.21, z, 0.24, o.trackWidth + 0.02, 10, PALETTE.track);
    b.cylinderZ(o.front - 0.34, 0.21, z, 0.09, o.trackWidth + 0.05, 8, PALETTE.darkMetal);
    b.cylinderZ(o.rear + 0.20, 0.21, z, 0.22, o.trackWidth + 0.02, 10, PALETTE.track);
    b.cylinderZ(o.rear + 0.20, 0.21, z, 0.08, o.trackWidth + 0.05, 8, PALETTE.darkMetal);
    b.box(mid, o.fender, z * 1.07, length, 0.055, 0.36, WEST_PAINT_DARK);
  }
}

/** One axle pair with hub steps and a mudguard arch. */
function axlePair(b: MeshBuilder, x: number, halfTrack: number, radius: number): void {
  for (const side of [-1, 1]) {
    const z = halfTrack * side;
    b.cylinderZ(x, radius, z, radius, 0.28, 12, PALETTE.rubber);
    b.cylinderZ(x, radius, z, radius * 0.46, 0.30, 10, PALETTE.metal);
    b.cylinderZ(x, radius, z, radius * 0.18, 0.33, 8, PALETTE.darkMetal);
    b.box(x, radius * 2 + 0.10, z * 1.04, radius * 2.5, 0.06, 0.42, WEST_PAINT_DARK);
    // Leaf-spring pack behind the hub.
    b.box(x, radius * 0.62, z * 0.62, radius * 1.5, 0.07, 0.16, PALETTE.darkMetal);
  }
}

/* ------------------------------------------------------------------ */
/* Infantry fighting vehicle                                          */
/* ------------------------------------------------------------------ */

/**
 * Western tracked IFV: a boxy troop compartment with a rear ramp, six road
 * wheels, applique armour on the flanks and a driver's station at the nose.
 * The howitzer hull it replaces was a low casemate carrier with a rear turret
 * ring and no passenger volume at all; this one is visibly a carrier first.
 */
function buildIfvBody(): MeshBuffers {
  const b = new MeshBuilder();
  trackGear(b, {
    front: 1.68,
    rear: -1.68,
    halfTrack: 0.62,
    trackWidth: 0.26,
    wheelCount: 6,
    wheelRadius: 0.19,
    wheelWidth: 0.26,
    fender: 0.60,
  });
  // Lower hull, upper sides and the roofed troop compartment at the rear.
  b.box(0.02, 0.44, 0, 3.30, 0.32, 1.14, WEST_PAINT_DARK);
  b.box(0.04, 0.63, 0, 3.24, 0.16, 1.22, WEST_PAINT);
  b.box(-0.94, 0.84, 0, 1.34, 0.30, 1.18, WEST_PAINT);
  b.box(-0.94, 1.00, 0, 1.30, 0.04, 1.12, WEST_PAINT_LIGHT);
  // Sloped glacis with the driver's hatch set low and to the left.
  face(
    b,
    [
      [1.42, 0.71, -0.61],
      [1.42, 0.71, 0.61],
      [1.68, 0.51, 0.54],
      [1.68, 0.51, -0.54],
    ],
    [1, 1, 0],
    WEST_PAINT_LIGHT,
  );
  b.box(1.66, 0.38, 0, 0.24, 0.24, 1.16, WEST_PAINT_DARK);
  b.box(1.70, 0.48, 0, 0.16, 0.10, 0.98, PALETTE.metal);
  b.cylinder(1.10, 0.76, -0.30, 0.22, 0.06, 12, WEST_PAINT_DARK);
  b.cylinder(1.10, 0.80, -0.30, 0.17, 0.03, 10, WEST_PAINT_LIGHT);
  for (const z of [-0.06, 0.20, 0.44]) b.box(1.34, 0.76, z, 0.05, 0.06, 0.11, PALETTE.glassDark);
  // Headlights and a brush bar across the nose.
  for (const z of [-0.50, 0.50]) {
    b.box(1.60, 0.68, z, 0.07, 0.12, 0.16, PALETTE.glassDark);
    b.box(1.70, 0.30, z * 0.96, 0.18, 0.12, 0.12, PALETTE.metal);
  }
  beam(b, [1.76, 0.24, -0.52], [1.76, 0.86, -0.52], 0.05, 0.05, PALETTE.metal);
  beam(b, [1.76, 0.24, 0.52], [1.76, 0.86, 0.52], 0.05, 0.05, PALETTE.metal);
  beam(b, [1.76, 0.84, -0.58], [1.76, 0.84, 0.58], 0.05, 0.05, PALETTE.metal);
  // Applique armour blocks down both flanks, with a gap for the troop door.
  for (const z of [-0.66, 0.66]) {
    for (let i = 0; i < 4; i++) {
      b.box(0.52 - i * 0.46, 0.70, z, 0.42, 0.20, 0.06, WEST_PAINT_DARK);
    }
    b.box(-0.06, 0.585, z * 1.01, 1.90, 0.05, 0.03, WEST_PAINT, TEAM);
    // Firing ports: one per flank, small and dark against the armour.
    b.box(0.30, 0.86, z * 1.06, 0.16, 0.10, 0.03, PALETTE.darkMetal);
    b.box(-0.40, 0.86, z * 1.06, 0.16, 0.10, 0.03, PALETTE.darkMetal);
    // Pioneer tools strapped over the fender.
    b.box(-1.10, 0.68, z * 1.10, 0.62, 0.05, 0.04, PALETTE.metal);
    b.box(-0.30, 0.66, z * 1.10, 0.30, 0.06, 0.05, PALETTE.oliveDark);
  }
  // Troop compartment roof: two hatches, periscopes and a stowage rack.
  for (const z of [-0.30, 0.30]) {
    b.box(-0.68, 1.03, z, 0.44, 0.035, 0.36, WEST_PAINT_LIGHT);
    b.box(-0.68, 1.05, z, 0.34, 0.02, 0.26, WEST_PAINT_DARK);
    b.cylinderZ(-0.44, 1.04, z, 0.08, 0.12, 8, PALETTE.metal);
  }
  for (const z of [-0.42, 0.42]) {
    b.box(-1.30, 1.03, z, 0.70, 0.05, 0.20, PALETTE.oliveDark);
    b.box(-1.30, 1.06, z, 0.56, 0.02, 0.14, WEST_PAINT, TEAM);
  }
  b.cylinderZ(-1.48, 1.00, 0, 0.10, 1.06, 10, PALETTE.canvas);
  // Rear ramp: hinge barrel, ribs and the door frame around it.
  b.box(-1.58, 0.62, 0, 0.10, 0.82, 1.12, WEST_PAINT_DARK);
  b.box(-1.64, 0.62, 0, 0.06, 0.74, 0.96, WEST_PAINT);
  for (let i = 0; i < 4; i++) {
    b.box(-1.68, 0.34 + i * 0.20, 0, 0.03, 0.06, 0.88, WEST_PAINT_DARK);
  }
  b.cylinderZ(-1.55, 1.00, 0, 0.07, 0.90, 8, PALETTE.metal);
  for (const z of [-0.56, 0.56]) b.box(-1.62, 0.26, z, 0.10, 0.20, 0.10, PALETTE.darkMetal);
  // Exhaust and the turret ring the gun mount sits on.
  b.box(-0.34, 0.82, 0.66, 0.46, 0.12, 0.10, PALETTE.track);
  b.cylinder(0.10, 0.70, 0, 0.56, 0.06, 16, WEST_PAINT_DARK);
  b.box(0.10, 0.72, 0, 0.78, 0.02, 0.74, WEST_PAINT_LIGHT);
  return b.build();
}

/**
 * One-man autocannon turret. Slim 30 mm tube with a muzzle brake, a coaxial
 * machine gun beside it and an ATGM rail on the flank. The gun tip lands on
 * the authored 1.90 forward / 1.05 high hardpoint.
 */
function buildIfvTurret(): MeshBuffers {
  const b = new MeshBuilder();
  // Low, faceted shell: a wide base narrowing to a flat roof.
  b.cylinder(0, 0.01, 0, 0.44, 0.04, 12, WEST_PAINT_DARK);
  face(
    b,
    [
      [-0.40, 0.05, -0.34],
      [0.34, 0.05, -0.34],
      [0.28, 0.30, -0.26],
      [-0.34, 0.30, -0.26],
    ],
    [0, 0, -1],
    WEST_PAINT,
  );
  face(
    b,
    [
      [-0.40, 0.05, 0.34],
      [0.34, 0.05, 0.34],
      [0.28, 0.30, 0.26],
      [-0.34, 0.30, 0.26],
    ],
    [0, 0, 1],
    WEST_PAINT,
  );
  face(
    b,
    [
      [0.34, 0.05, -0.34],
      [0.34, 0.05, 0.34],
      [0.28, 0.30, 0.26],
      [0.28, 0.30, -0.26],
    ],
    [1, 0, 0],
    WEST_PAINT_LIGHT,
  );
  b.box(-0.04, 0.31, 0, 0.66, 0.02, 0.50, WEST_PAINT);
  // Roof team panel, the surface the isometric camera sees most of.
  b.box(-0.08, 0.325, 0, 0.42, 0.02, 0.32, WEST_PAINT, TEAM);
  b.box(-0.46, 0.16, 0, 0.20, 0.24, 0.44, WEST_PAINT_DARK);
  // 30 mm autocannon: trunnion, thermal sleeve, muzzle brake.
  b.box(0.30, 0.34, 0, 0.24, 0.16, 0.18, PALETTE.darkMetal);
  b.cylinderX(0.94, 0.33, 0, 0.036, 1.32, 7, PALETTE.darkMetal);
  b.cylinderX(0.72, 0.33, 0, 0.055, 0.42, 7, WEST_PAINT_DARK);
  b.cylinderX(1.68, 0.33, 0, 0.058, 0.16, 7, PALETTE.darkMetal);
  b.cylinderX(1.78, 0.33, 0, 0.030, 0.05, 6, PALETTE.track);
  // Coaxial machine gun and its ammunition box.
  b.cylinderX(0.62, 0.26, 0.22, 0.022, 0.52, 5, PALETTE.darkMetal);
  b.box(0.28, 0.24, 0.24, 0.16, 0.12, 0.10, PALETTE.oliveDark);
  // ATGM rail: a single ready round on the flank.
  b.box(0.10, 0.30, -0.34, 0.56, 0.12, 0.14, PALETTE.oliveDark);
  b.cylinderX(0.44, 0.30, -0.34, 0.055, 0.20, 6, PALETTE.darkMetal);
  // Sight head, commander's periscope, smoke dischargers and aerial.
  b.box(-0.06, 0.42, 0.10, 0.22, 0.16, 0.20, WEST_PAINT_DARK);
  b.box(-0.06, 0.47, 0.12, 0.13, 0.04, 0.14, PALETTE.glass);
  b.box(-0.24, 0.40, -0.10, 0.10, 0.10, 0.16, PALETTE.glassDark);
  for (const z of [-0.26, 0.26]) b.cylinderX(0.20, 0.24, z, 0.026, 0.10, 4, PALETTE.darkMetal);
  b.box(-0.40, 0.50, 0.24, 0.012, 0.40, 0.012, PALETTE.metal);
  for (const z of [-0.275, 0.275]) {
    b.box(-0.06, 0.17, z, 0.40, 0.14, 0.02, WEST_PAINT, 0.84);
  }
  return b.build();
}

/* ------------------------------------------------------------------ */
/* Wheeled tank destroyer                                             */
/* ------------------------------------------------------------------ */

/**
 * 6x6 guided-missile carrier: a low bonneted cab forward, an open-topped
 * fighting deck aft with a gun shield, outrigger legs stowed along the hull and
 * spare wheels on the rear plate. The scout car it replaces was a boat-hulled
 * amphibian with a cupola; nothing about this hull is meant to swim.
 */
function buildTdBody(): MeshBuffers {
  const b = new MeshBuilder();
  for (const x of [1.26, 0.02, -1.22]) axlePair(b, x, 0.62, 0.33);
  // Ladder chassis with the body sitting outboard of it.
  b.box(0.02, 0.46, 0, 3.42, 0.22, 1.04, PALETTE.darkMetal);
  for (const z of [-0.42, 0.42]) b.box(0.02, 0.58, z, 3.34, 0.12, 0.16, WEST_PAINT_DARK);
  b.box(0.02, 0.60, 0, 3.36, 0.16, 1.16, WEST_PAINT_DARK);
  // Bonneted cab forward: a short flat engine bonnet, then the driving cab.
  b.box(1.22, 0.78, 0, 0.90, 0.26, 1.12, WEST_PAINT);
  for (let i = 0; i < 4; i++) {
    b.box(1.52 - i * 0.16, 0.915, 0, 0.07, 0.03, 0.98, PALETTE.darkMetal);
  }
  b.box(0.44, 0.92, 0, 0.62, 0.42, 1.10, WEST_PAINT);
  b.box(0.74, 0.94, 0, 0.03, 0.24, 0.94, PALETTE.glassDark);
  b.box(0.76, 0.95, 0, 0.02, 0.18, 0.82, PALETTE.glass);
  b.box(0.44, 1.15, 0, 0.58, 0.04, 1.04, WEST_PAINT_LIGHT);
  b.box(0.30, 1.17, 0, 0.34, 0.02, 0.30, WEST_PAINT, TEAM);
  b.box(0.42, 0.62, 0, 0.60, 0.24, 1.06, WEST_PAINT_DARK);
  // Open-topped fighting deck aft: floor, low side walls, no roof.
  b.box(-0.92, 0.72, 0, 1.56, 0.06, 1.18, WEST_PAINT_LIGHT);
  for (const z of [-0.58, 0.58]) {
    b.box(-0.92, 0.82, z, 1.52, 0.22, 0.06, WEST_PAINT);
    for (const x of [-1.34, -1.06, -0.78, -0.50]) {
      b.box(x, 0.82, z * 1.02, 0.20, 0.18, 0.02, WEST_PAINT_DARK);
    }
    // Ammunition lockers hung on the deck walls.
    b.box(-1.16, 0.80, z * 1.06, 0.46, 0.16, 0.10, PALETTE.oliveDark);
    b.box(-0.60, 0.80, z * 1.06, 0.36, 0.14, 0.10, PALETTE.oliveDark);
  }
  // Rear bulkhead, two spare wheels and the towing eyes.
  b.box(-1.72, 0.72, 0, 0.14, 0.46, 1.16, WEST_PAINT_DARK);
  for (const z of [-0.30, 0.30]) {
    b.cylinderX(-1.80, 0.76, z, 0.22, 0.10, 12, PALETTE.rubber);
    b.cylinderX(-1.83, 0.76, z, 0.10, 0.06, 9, PALETTE.metal);
  }
  b.box(-1.86, 0.40, 0, 0.08, 0.12, 1.00, PALETTE.metal);
  // Outrigger legs stowed along the deck walls, with their pads.
  for (const z of [-0.70, 0.70]) {
    beam(b, [-1.58, 0.66, z], [-0.30, 0.66, z], 0.12, 0.12, PALETTE.metal);
    b.box(-1.62, 0.60, z, 0.16, 0.14, 0.20, PALETTE.darkMetal);
    b.box(-0.26, 0.60, z, 0.16, 0.14, 0.20, PALETTE.darkMetal);
  }
  // Stabiliser jacks at the front corners.
  for (const z of [-0.66, 0.66]) {
    b.box(1.04, 0.44, z, 0.16, 0.30, 0.16, PALETTE.metal);
    b.box(1.04, 0.24, z, 0.26, 0.06, 0.24, PALETTE.darkMetal);
  }
  // Gun pedestal and its traversing ring on the deck floor.
  b.cylinder(-0.62, 0.78, 0, 0.34, 0.10, 14, WEST_PAINT_DARK);
  b.box(-0.62, 0.84, 0, 0.56, 0.08, 0.52, WEST_PAINT);
  // Spare missile crates and the sensor mast behind the shield.
  b.box(-1.30, 0.86, 0.30, 0.40, 0.16, 0.28, PALETTE.oliveDark);
  b.box(-1.30, 0.86, -0.24, 0.32, 0.14, 0.24, PALETTE.oliveDark);
  b.box(-1.46, 0.80, 0, 0.03, 0.32, 0.03, PALETTE.metal);
  return b.build();
}

/**
 * Shielded anti-tank mount: a tall, narrow gun shield with a long barrel
 * through it, a sight head over the top edge and missile rails on the flanks.
 * The shield is why the vehicle survives at all, so it is the silhouette cue.
 */
function buildTdShield(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, 0.02, 0, 0.28, 0.06, 12, WEST_PAINT_DARK);
  // Shield plate, slightly raked, with a folded lip along the top.
  face(
    b,
    [
      [-0.16, 0.04, -0.52],
      [0.10, 0.04, -0.52],
      [0.14, 0.62, -0.46],
      [-0.14, 0.62, -0.46],
    ],
    [0, 0, -1],
    WEST_PAINT,
  );
  face(
    b,
    [
      [-0.16, 0.04, 0.52],
      [0.10, 0.04, 0.52],
      [0.14, 0.62, 0.46],
      [-0.14, 0.62, 0.46],
    ],
    [0, 0, 1],
    WEST_PAINT,
  );
  face(
    b,
    [
      [0.10, 0.04, -0.52],
      [0.10, 0.04, 0.52],
      [0.14, 0.62, 0.46],
      [0.14, 0.62, -0.46],
    ],
    [1, 0, 0],
    WEST_PAINT_LIGHT,
  );
  face(
    b,
    [
      [-0.16, 0.04, -0.52],
      [-0.16, 0.04, 0.52],
      [-0.14, 0.62, 0.46],
      [-0.14, 0.62, -0.46],
    ],
    [-1, 0, 0],
    WEST_PAINT_DARK,
  );
  b.box(-0.02, 0.635, 0, 0.34, 0.03, 1.02, WEST_PAINT_LIGHT);
  b.box(-0.02, 0.66, 0, 0.24, 0.02, 0.60, WEST_PAINT, TEAM);
  // Gun cradle behind the shield, thermal sleeve and the long tube.
  b.box(-0.20, 0.42, 0, 0.30, 0.20, 0.34, PALETTE.darkMetal);
  b.cylinderX(0.06, 0.40, 0, 0.045, 0.34, 7, PALETTE.darkMetal);
  b.cylinderX(0.62, 0.40, 0, 0.048, 1.10, 7, PALETTE.darkMetal);
  b.cylinderX(1.10, 0.40, 0, 0.062, 0.34, 7, WEST_PAINT_DARK);
  b.cylinderX(1.62, 0.40, 0, 0.052, 0.20, 7, PALETTE.darkMetal);
  b.cylinderX(1.76, 0.40, 0, 0.026, 0.05, 6, PALETTE.track);
  // Antenna-mounted ATGM rails either side of the shield.
  for (const z of [-0.40, 0.40]) {
    b.box(-0.14, 0.46, z, 0.36, 0.10, 0.12, PALETTE.oliveDark);
    b.cylinderX(0.06, 0.46, z, 0.042, 0.16, 6, PALETTE.darkMetal);
    beam(b, [-0.26, 0.20, z], [-0.26, 0.56, z * 0.45], 0.05, 0.05, PALETTE.metal);
  }
  // Sight box above the shield and the elevation gear under the cradle.
  b.box(-0.20, 0.50, 0.30, 0.20, 0.18, 0.18, WEST_PAINT_DARK);
  b.box(-0.20, 0.53, 0.34, 0.12, 0.05, 0.10, PALETTE.glass);
  b.cylinderZ(-0.22, 0.32, 0.34, 0.07, 0.30, 8, PALETTE.metal);
  // Shield foot plates and the traversing hand wheels.
  for (const z of [-0.30, 0.30]) {
    b.box(0.02, 0.08, z, 0.26, 0.04, 0.16, WEST_PAINT_DARK);
    b.cylinderZ(-0.06, 0.34, z, 0.05, 0.03, 8, PALETTE.darkMetal);
  }
  return b.build();
}

/* ------------------------------------------------------------------ */
/* Tracked rocket battery                                             */
/* ------------------------------------------------------------------ */

/**
 * Tracked MLRS: a wide, low carrier with the cab forward behind folding blast
 * shields, a long flat launch bed and a reload cradle at the stern. It is the
 * widest of the three hulls and the only one with its fighting load above the
 * deck rather than inside a turret.
 */
function buildMlrsBody(): MeshBuffers {
  const b = new MeshBuilder();
  trackGear(b, {
    front: 1.86,
    rear: -1.86,
    halfTrack: 0.68,
    trackWidth: 0.30,
    wheelCount: 6,
    wheelRadius: 0.20,
    wheelWidth: 0.30,
    fender: 0.62,
  });
  // Low slab-sided carrier with a full-length launch bed.
  b.box(0, 0.46, 0, 3.78, 0.34, 1.28, WEST_PAINT_DARK);
  b.box(0, 0.67, 0, 3.72, 0.14, 1.34, WEST_PAINT);
  b.box(-0.20, 0.76, 0, 3.30, 0.04, 1.26, WEST_PAINT_LIGHT);
  // Glacis and lower nose plate.
  face(
    b,
    [
      [1.66, 0.74, -0.66],
      [1.66, 0.74, 0.66],
      [1.92, 0.52, 0.58],
      [1.92, 0.52, -0.58],
    ],
    [1, 1, 0],
    WEST_PAINT_LIGHT,
  );
  b.box(1.84, 0.38, 0, 0.24, 0.24, 1.24, WEST_PAINT_DARK);
  // Cab forward, with the two blast shield plates standing between cab and pack.
  b.box(1.30, 0.98, 0, 0.62, 0.44, 1.20, WEST_PAINT);
  b.box(1.60, 0.99, 0, 0.03, 0.28, 1.02, PALETTE.glassDark);
  b.box(1.62, 1.00, 0, 0.02, 0.20, 0.90, PALETTE.glass);
  b.box(1.30, 1.22, 0, 0.56, 0.04, 1.14, WEST_PAINT_LIGHT);
  for (const z of [-1, 1]) {
    const inner = 0.42 * z;
    const outer = 0.56 * z;
    face(
      b,
      [
        [0.96, 0.78, inner],
        [0.96, 0.78, outer],
        [0.96, 1.34, outer * 0.94],
        [0.96, 1.34, inner * 0.94],
      ],
      [0, 0, z],
      WEST_PAINT_DARK,
    );
    face(
      b,
      [
        [0.98, 0.78, inner],
        [0.98, 0.78, outer],
        [0.98, 1.34, outer * 0.94],
        [0.98, 1.34, inner * 0.94],
      ],
      [0, 0, -z],
      WEST_PAINT,
    );
    b.box(0.97, 1.06, (inner + outer) / 2, 0.04, 0.56, 0.03, WEST_PAINT, TEAM);
  }
  // Cab roof hatch, wipers and headlights.
  b.box(1.30, 1.25, 0, 0.30, 0.05, 0.34, WEST_PAINT_DARK);
  b.box(1.30, 1.28, 0, 0.22, 0.02, 0.24, WEST_PAINT, TEAM);
  for (const z of [-0.56, 0.56]) {
    b.box(1.66, 0.62, z, 0.09, 0.14, 0.18, PALETTE.glassDark);
    b.box(1.78, 0.30, z, 0.16, 0.12, 0.14, PALETTE.metal);
    b.box(1.46, 1.02, z * 0.88, 0.03, 0.30, 0.03, PALETTE.metal);
  }
  // Launch bed rails and the turntable the pack elevates on.
  for (const z of [-0.50, 0.50]) {
    b.box(-0.30, 0.80, z, 2.90, 0.05, 0.10, PALETTE.metal);
    b.box(-0.30, 0.81, z, 2.70, 0.02, 0.03, WEST_PAINT, TEAM);
  }
  b.cylinder(-0.24, 0.80, 0, 0.62, 0.07, 18, WEST_PAINT_DARK);
  b.cylinder(-0.24, 0.84, 0, 0.50, 0.03, 16, PALETTE.darkMetal);
  // Reload cradle: A-frame, jib and hook, folded over the rear deck.
  beam(b, [-1.30, 0.82, -0.34], [-1.30, 1.46, -0.34], 0.09, 0.09, PALETTE.metal);
  beam(b, [-1.30, 0.82, 0.34], [-1.30, 1.46, 0.34], 0.09, 0.09, PALETTE.metal);
  beam(b, [-1.30, 1.44, -0.40], [-1.30, 1.44, 0.40], 0.09, 0.09, PALETTE.metal);
  beam(b, [-1.30, 1.40, 0], [-0.56, 1.24, 0], 0.07, 0.07, PALETTE.metal);
  b.cylinderZ(-0.56, 1.14, 0, 0.05, 0.03, 6, PALETTE.darkMetal);
  b.box(-1.30, 1.40, 0, 0.14, 0.10, 0.24, PALETTE.darkMetal);
  // Rear plate, tow hooks, spade and the rocket resupply boxes.
  b.box(-1.86, 0.52, 0, 0.10, 0.46, 1.20, WEST_PAINT_DARK);
  b.box(-1.94, 0.22, 0, 0.22, 0.12, 0.90, PALETTE.metal);
  for (const z of [-0.60, 0.60]) {
    b.box(-1.72, 0.46, z, 0.34, 0.16, 0.20, PALETTE.darkMetal);
    b.box(-1.90, 0.80, z * 0.90, 0.03, 0.10, 0.12, PALETTE.red);
  }
  b.box(-1.56, 0.92, 0.30, 0.44, 0.22, 0.24, PALETTE.oliveDark);
  b.box(-1.56, 0.92, -0.30, 0.44, 0.22, 0.24, PALETTE.oliveDark);
  b.box(-0.90, 0.80, 0.60, 0.60, 0.10, 0.06, PALETTE.canvas);
  b.box(-0.90, 0.80, -0.60, 0.60, 0.10, 0.06, PALETTE.canvas);
  // Cable reel and exhaust stack on the rear deck.
  b.cylinderZ(-1.44, 0.98, 0, 0.14, 0.20, 8, PALETTE.track);
  b.box(-1.10, 1.00, 0.56, 0.16, 0.28, 0.16, PALETTE.track);
  return b.build();
}

/**
 * Twelve-cell launcher pack on its elevating truss: two rows of six 227 mm
 * tubes, a blast plate at the rear and a trunnion block at the turntable. The
 * tube rims finish on the authored 1.80 forward / 1.15 high hardpoint.
 */
function buildMlrsPack(): MeshBuffers {
  const b = new MeshBuilder();
  // Trunnion and the two truss arms that carry the pack.
  b.cylinder(0, 0.02, 0, 0.44, 0.06, 14, WEST_PAINT_DARK);
  for (const z of [-0.34, 0.34]) {
    beam(b, [0, 0.04, z], [0.34, 0.24, z], 0.12, 0.10, WEST_PAINT_DARK);
  }
  // Pack body: a shallow box cradle under the tube bundle.
  b.box(0.76, 0.16, 0, 2.44, 0.10, 1.24, WEST_PAINT_DARK);
  b.box(0.76, 0.30, 0, 2.40, 0.22, 1.20, WEST_PAINT);
  // Two rows of six tubes. The rims stand proud of the pack face.
  for (const y of [0.22, 0.44]) {
    for (let i = 0; i < 6; i++) {
      const z = -0.50 + i * 0.20;
      b.cylinderX(1.90, y, z, 0.082, 2.30, 8, PALETTE.oliveDark);
      b.cylinderX(1.99, y, z, 0.094, 0.10, 8, PALETTE.darkMetal);
      b.cylinderX(2.02, y, z, 0.066, 0.04, 8, PALETTE.track);
    }
  }
  // Pack sides, roof rail and the painted team band along the top.
  for (const z of [-0.62, 0.62]) {
    b.box(0.76, 0.33, z, 2.36, 0.26, 0.05, WEST_PAINT_LIGHT);
    b.box(0.44, 0.34, z * 1.02, 1.30, 0.14, 0.02, WEST_PAINT, TEAM);
  }
  b.box(0.76, 0.55, 0, 2.36, 0.03, 1.22, WEST_PAINT_LIGHT);
  b.box(0.60, 0.57, 0, 1.50, 0.02, 0.70, WEST_PAINT, TEAM);
  // Rear blast plate, hinged so it can fold flat for reloading.
  face(
    b,
    [
      [-0.48, 0.06, -0.62],
      [-0.48, 0.06, 0.62],
      [-0.62, 0.56, 0.56],
      [-0.62, 0.56, -0.56],
    ],
    [-1, 0.3, 0],
    WEST_PAINT_DARK,
  );
  face(
    b,
    [
      [-0.48, 0.06, -0.62],
      [-0.48, 0.06, 0.62],
      [-0.62, 0.56, 0.56],
      [-0.62, 0.56, -0.56],
    ],
    [1, 0, 0],
    WEST_PAINT,
  );
  b.cylinderZ(-0.50, 0.58, 0, 0.06, 1.10, 8, PALETTE.metal);
  // Elevation quadrant on the near trunnion and the cable run to the cab.
  b.cylinderZ(0.16, 0.22, 0.42, 0.16, 0.06, 10, PALETTE.metal);
  for (let i = 0; i < 4; i++) {
    b.box(0.16, 0.22 + i * 0.02, 0.47, 0.22, 0.015, 0.02, PALETTE.darkMetal);
  }
  b.box(-0.30, 0.34, -0.50, 0.20, 0.14, 0.18, PALETTE.oliveDark);
  b.box(0.30, 0.10, 0.30, 0.44, 0.06, 0.06, PALETTE.track);
  return b.build();
}

export const CANONICAL_HULL_STYLES: Record<string, EntityStyle> = {
  ifv: {
    body: buildIfvBody(),
    turret: buildIfvTurret(),
    turretOffset: [0.10, 0.72, 0],
  },
  td: {
    body: buildTdBody(),
    turret: buildTdShield(),
    turretOffset: [-0.38, 0.78, 0],
  },
  rocketArtillery: {
    body: buildMlrsBody(),
    turret: buildMlrsPack(),
    turretOffset: [-0.24, 0.86, 0],
  },
};
