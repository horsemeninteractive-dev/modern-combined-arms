import { MeshBuilder, PALETTE, type Color } from '../geometry';
import type { MeshBuffers } from '../gl';
import type { EntityStyle } from '../unitMeshes';
import { beam } from '../meshKit';

/**
 * Hulls for the four shipped variants that used to borrow a neighbour's chassis.
 *
 * `spearhead`, `tosp`, `pathfinder` and `navalSupport` are all upgrade or
 * national options sitting next to a near-identical sibling on the build menu.
 * When they shared that sibling's hull the only cue that they were different
 * vehicles was the card text, which is invisible once the fight starts. Each
 * builder below is authored from scratch against the same conventions as the
 * baseline meshes: metres-as-world-units, geometry growing upward from y = 0,
 * nose toward +X, lateral spread along Z, and a turret authored around its own
 * local origin so `turretOffset` drops it onto the ring.
 */

/** Polish up-gunned MBT: a longer, heavier hull than the shared MBT. */
const SPEARHEAD_HULL: Color = [0.31, 0.34, 0.28];
const SPEARHEAD_DARK: Color = [0.22, 0.25, 0.21];
const TOSP_HULL: Color = [0.28, 0.31, 0.25];
const SCOUT_BODY: Color = [0.37, 0.41, 0.34];
const SCOUT_DARK: Color = [0.25, 0.29, 0.24];
const SHIP_HULL: Color = [0.32, 0.35, 0.36];
const SHIP_UPPER: Color = [0.40, 0.43, 0.43];

function roadWheel(b: MeshBuilder, x: number, z: number, radius: number): void {
  b.cylinderZ(x, radius, z, radius, 0.26, 10, PALETTE.rubber);
  b.cylinderZ(x, radius, z, radius * 0.58, 0.28, 10, PALETTE.metal);
  b.cylinderZ(x, radius, z, radius * 0.24, 0.30, 8, PALETTE.darkMetal);
}

/* ------------------------------------------------------------------------ */
/* Spearhead MBT                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Seven road wheels on a 3.7-unit run versus the baseline's six on 3.3, bolted
 * skirt armour instead of a plain liner, and a stepped arrow glacis: heavier
 * from every angle, not the same block with a new turret.
 */
function buildSpearheadBody(): MeshBuffers {
  const b = new MeshBuilder();
  for (const side of [-1, 1]) {
    const z = 0.76 * side;
    b.box(0, 0.17, z, 3.72, 0.34, 0.30, PALETTE.track);
    for (let i = 0; i < 9; i++) {
      b.box(-1.64 + i * 0.41, 0.355, z, 0.34, 0.05, 0.30, PALETTE.darkMetal);
    }
    for (let i = 0; i < 7; i++) {
      b.cylinderZ(-1.50 + i * 0.50, 0.18, z, 0.19, 0.30, 8, PALETTE.darkMetal);
      b.cylinderZ(-1.50 + i * 0.50, 0.18, z, 0.07, 0.32, 6, PALETTE.metal);
    }
    b.cylinderZ(-1.80, 0.19, z, 0.21, 0.30, 8, PALETTE.track);
    b.cylinderZ(1.80, 0.19, z, 0.21, 0.30, 8, PALETTE.track);
    // Four bolted skirt panels a side, each with a painted top stripe: the
    // panel joints are what separate this flank from the baseline's smooth run.
    for (let i = 0; i < 4; i++) {
      const px = -1.29 + i * 0.86;
      b.box(px, 0.56, z * 1.14, 0.80, 0.36, 0.07, SPEARHEAD_DARK);
      b.box(px, 0.755, z * 1.14, 0.82, 0.03, 0.09, SPEARHEAD_HULL, 0.9);
      for (const dx of [-0.30, 0.30]) {
        b.box(px + dx, 0.56, z * 1.18, 0.04, 0.30, 0.03, PALETTE.darkMetal);
      }
    }
    // Mud flaps over the front sprocket.
    b.box(1.80, 0.34, z * 1.10, 0.12, 0.30, 0.06, PALETTE.rubber);
  }
  b.box(0, 0.52, 0, 3.40, 0.34, 1.40, PALETTE.hullDark);
  b.box(0, 0.82, 0, 3.30, 0.28, 1.52, SPEARHEAD_HULL);
  // Stepped arrow glacis: two plates a side plus a central beak.
  for (const side of [-1, 1]) {
    b.addQuad(
      [1.65, 0.96, 0.76 * side],
      [1.92, 0.72, 0.72 * side],
      [1.74, 0.48, 0.62 * side],
      [1.52, 0.62, 0.70 * side],
      PALETTE.hullLight,
    );
  }
  b.addQuad([1.65, 0.96, -0.76], [1.65, 0.96, 0.76], [1.92, 0.72, 0.72], [1.92, 0.72, -0.72], SPEARHEAD_HULL);
  b.addQuad([1.52, 0.62, -0.70], [1.52, 0.62, 0.70], [1.74, 0.48, 0.62], [1.74, 0.48, -0.62], PALETTE.hullDark);
  b.box(1.60, 0.30, 0, 0.30, 0.24, 1.24, PALETTE.hullDark);
  b.addQuad([1.60, 0.30, -0.62], [1.60, 0.30, 0.62], [1.76, 0.10, 0.52], [1.76, 0.10, -0.52], PALETTE.track);
  // Sloped rear plate and engine deck.
  b.addQuad([-1.68, 0.94, -0.74], [-1.68, 0.94, 0.74], [-1.90, 0.68, 0.68], [-1.90, 0.68, -0.68], PALETTE.hullDark);
  b.box(-1.20, 0.94, 0, 0.70, 0.05, 1.32, PALETTE.hullDark);
  for (let i = 0; i < 5; i++) {
    b.box(-1.50 + i * 0.14, 0.975, 0, 0.045, 0.035, 1.10, PALETTE.darkMetal);
  }
  // Exhaust boxes, stowage bins and the tow cable coiled on the rear deck.
  for (const z of [-0.52, 0.52]) b.box(-1.78, 0.80, z, 0.16, 0.18, 0.28, PALETTE.darkMetal);
  b.box(0.44, 0.83, 0.80, 0.52, 0.16, 0.22, PALETTE.oliveDark);
  b.box(-0.30, 0.83, -0.82, 0.60, 0.16, 0.20, PALETTE.oliveDark);
  b.cylinderZ(-1.34, 0.86, 0, 0.07, 0.48, 6, PALETTE.canvas);
  // Headlights, mudguard steps, tow hooks.
  for (const z of [-0.56, 0.56]) {
    b.box(1.70, 0.80, z, 0.09, 0.13, 0.19, PALETTE.glassDark);
    b.box(1.80, 0.42, z * 0.92, 0.18, 0.15, 0.15, PALETTE.metal);
    b.box(1.30, 0.92, z * 1.02, 0.26, 0.03, 0.12, PALETTE.metal);
  }
  for (const z of [-0.92, 0.92]) {
    b.box(-1.62, 0.70, z, 0.30, 0.13, 0.03, SPEARHEAD_HULL, 0.9);
  }
  // Turret ring.
  b.cylinder(0, 0.985, 0, 0.54, 0.06, 16, PALETTE.hullDark);
  return b.build();
}

/**
 * Wedge turret with add-on armour, a commander's remote weapon station, a
 * bustle stowage rack and the longer gun. The remote sight is the detail that
 * reads at battle zoom as "not the baseline tank".
 */
function buildSpearheadTurret(): MeshBuffers {
  const b = new MeshBuilder();
  const y0 = 0.02;
  const y1 = 0.30;
  // Shell: narrow forward cheeks, wide rear bustle.
  b.addQuad([-0.86, y0, -0.56], [0.54, y0, -0.50], [0.40, y1, -0.36], [-0.76, y1, -0.42], SPEARHEAD_HULL);
  b.addQuad([-0.86, y0, 0.56], [-0.76, y1, 0.42], [0.40, y1, 0.36], [0.54, y0, 0.50], SPEARHEAD_HULL);
  b.addQuad([-0.86, y0, -0.56], [-0.86, y0, 0.56], [-0.76, y1, 0.42], [-0.76, y1, -0.42], PALETTE.hullDark);
  b.addQuad([0.54, y0, -0.50], [0.40, y1, -0.36], [0.40, y1, 0.36], [0.54, y0, 0.50], PALETTE.hullDark);
  b.addQuad([-0.76, y1, -0.42], [0.40, y1, -0.36], [0.40, y1, 0.36], [-0.76, y1, 0.42], PALETTE.hullLight);
  // The painted roof panel is the primary ownership read from above.
  b.box(-0.18, y1 + 0.018, 0, 0.82, 0.03, 0.60, SPEARHEAD_HULL, 0.92);
  // Arrow add-on armour across the cheeks: a wedge per side plus ribs.
  for (const side of [-1, 1]) {
    const z = 0.42 * side;
    b.addQuad([0.54, 0.03, z], [0.10, 0.03, z * 1.22], [0.16, 0.27, z * 1.30], [0.56, 0.25, z], PALETTE.hullDark);
    b.addQuad([0.10, 0.03, z * 1.22], [0.12, 0.31, z * 1.34], [0.16, 0.27, z * 1.30], [0.10, 0.03, z * 1.22], PALETTE.oliveDark);
    for (let i = 0; i < 3; i++) {
      b.box(-0.58 + i * 0.34, 0.19, z * 1.30, 0.28, 0.20, 0.04, PALETTE.oliveDark);
    }
    b.box(-0.12, 0.30, z * 1.34, 0.84, 0.05, 0.02, SPEARHEAD_HULL, 0.86);
  }
  // Breech and thermal-sleeved gun. The local tip lands on 2.20, the authored
  // forward muzzle offset above a 1.00 turret mount.
  b.box(0.48, 0.20, 0, 0.50, 0.42, 0.54, PALETTE.hullDark);
  b.cylinderX(1.30, 0.20, 0, 0.072, 1.20, 8, PALETTE.darkMetal);
  b.cylinderX(1.44, 0.20, 0, 0.098, 0.56, 8, PALETTE.hullDark);
  b.cylinderX(0.86, 0.20, 0, 0.115, 0.30, 8, PALETTE.hullDark);
  b.cylinderX(2.10, 0.20, 0, 0.088, 0.16, 8, PALETTE.darkMetal);
  b.cylinderX(2.18, 0.20, 0, 0.046, 0.04, 8, PALETTE.track);
  // Commander's remote weapon station: pedestal, sight block, machine gun.
  b.cylinder(-0.34, 0.36, 0.26, 0.13, 0.10, 10, PALETTE.hullDark);
  b.box(-0.34, 0.52, 0.26, 0.26, 0.20, 0.24, PALETTE.hullDark);
  b.box(-0.22, 0.55, 0.26, 0.03, 0.10, 0.16, PALETTE.glassDark);
  b.cylinderX(-0.14, 0.52, 0.26, 0.030, 0.46, 6, PALETTE.darkMetal);
  b.box(-0.34, 0.63, 0.26, 0.12, 0.05, 0.12, PALETTE.metal);
  // Gunner's optic, hatch and smoke dischargers.
  b.box(0.08, 0.335, -0.30, 0.18, 0.06, 0.12, PALETTE.glassDark);
  b.cylinder(-0.30, 0.34, -0.24, 0.15, 0.08, 10, SPEARHEAD_HULL);
  b.cylinder(-0.30, 0.40, -0.24, 0.10, 0.03, 10, PALETTE.hullDark);
  for (const z of [-0.50, 0.50]) {
    for (const dz of [-0.05, 0.05]) b.cylinderX(0.44, 0.30, z + dz, 0.028, 0.12, 4, PALETTE.darkMetal);
  }
  // Bustle stowage rack: open frame, two crates and a rolled tarp.
  b.box(-0.88, 0.22, 0, 0.30, 0.24, 0.90, PALETTE.oliveDark);
  for (const z of [-0.44, 0.44]) {
    b.box(-1.02, 0.24, z, 0.26, 0.20, 0.10, PALETTE.canvas);
    b.box(-0.98, 0.36, z, 0.34, 0.03, 0.03, PALETTE.metal);
  }
  b.box(-1.04, 0.10, 0, 0.26, 0.03, 0.94, PALETTE.metal);
  beam(b, [-0.30, 0.60, -0.34], [-0.34, 1.06, -0.40], 0.02, 0.02, PALETTE.metal);
  return b.build();
}

/* ------------------------------------------------------------------------ */
/* TOSP thermobaric launcher                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Tank-derived area-denial chassis: armoured cab forward with vision blocks,
 * a raised launch deck behind it, blast shields, and hydraulic rams feeding the
 * elevating pack. The silhouette is a workshop, not a gun tank.
 */
function buildTospBody(): MeshBuffers {
  const b = new MeshBuilder();
  for (const side of [-1, 1]) {
    const z = 0.74 * side;
    b.box(0, 0.17, z, 3.50, 0.34, 0.30, PALETTE.track);
    for (let i = 0; i < 8; i++) {
      b.box(-1.54 + i * 0.44, 0.355, z, 0.36, 0.05, 0.30, PALETTE.darkMetal);
    }
    for (let i = 0; i < 6; i++) {
      b.cylinderZ(-1.42 + i * 0.50, 0.18, z, 0.19, 0.30, 8, PALETTE.darkMetal);
    }
    b.cylinderZ(-1.72, 0.19, z, 0.21, 0.30, 8, PALETTE.track);
    b.cylinderZ(1.72, 0.19, z, 0.21, 0.30, 8, PALETTE.track);
    b.box(0, 0.55, z * 1.15, 3.30, 0.20, 0.07, PALETTE.hullDark);
    b.box(0.50, 0.70, z * 1.16, 1.10, 0.03, 0.06, TOSP_HULL, 0.9);
    b.box(1.66, 0.34, z * 1.10, 0.12, 0.30, 0.06, PALETTE.rubber);
  }
  b.box(0, 0.50, 0, 3.24, 0.32, 1.34, PALETTE.hullDark);
  b.box(0, 0.78, 0, 3.14, 0.24, 1.46, TOSP_HULL);
  // Armoured cab: sloped front plate, roof, vision blocks and a hatch.
  b.addQuad([1.58, 0.90, -0.72], [1.58, 0.90, 0.72], [1.36, 1.24, 0.64], [1.36, 1.24, -0.64], PALETTE.hullLight);
  b.box(0.80, 1.26, 0, 1.30, 0.16, 1.30, TOSP_HULL);
  b.box(0.80, 1.36, 0, 1.06, 0.03, 1.10, TOSP_HULL, 0.9);
  for (const z of [-0.44, 0.44]) {
    b.box(1.42, 1.10, z, 0.05, 0.10, 0.22, PALETTE.glassDark);
    b.box(1.44, 1.10, z, 0.02, 0.07, 0.16, PALETTE.glass);
  }
  b.cylinder(0.70, 1.36, 0.36, 0.16, 0.05, 10, PALETTE.hullDark);
  // Launch deck and the rails the pack's cradle rides on.
  b.box(-0.70, 0.94, 0, 2.10, 0.10, 1.36, PALETTE.hullDark);
  for (const z of [-0.52, 0.52]) {
    b.box(-0.70, 1.02, z, 2.00, 0.06, 0.10, PALETTE.metal);
  }
  // Blast shields between the cab and the pack, hinged flat when stowed.
  for (const side of [-1, 1]) {
    b.addQuad([0.16, 1.00, 0.70 * side], [0.16, 1.00, 0.30 * side], [0.02, 1.48, 0.28 * side], [0.02, 1.48, 0.68 * side], PALETTE.oliveDark);
  }
  // Rear deck: engine louvres, rams and the reload frame.
  b.box(-1.48, 0.92, 0, 0.44, 0.05, 1.30, PALETTE.hullDark);
  for (let i = 0; i < 4; i++) {
    b.box(-1.62 + i * 0.12, 0.955, 0, 0.04, 0.035, 1.12, PALETTE.darkMetal);
  }
  for (const z of [-0.40, 0.40]) {
    beam(b, [-1.30, 1.00, z], [-1.34, 1.44, z * 0.7], 0.07, 0.07, PALETTE.metal);
  }
  b.addQuad([-1.70, 1.22, -0.70], [-1.70, 1.22, 0.70], [-1.86, 0.86, 0.66], [-1.86, 0.86, -0.66], PALETTE.hullDark);
  // Fenders, stowage and the tow cable.
  for (const z of [-0.78, 0.78]) {
    b.box(0.90, 0.86, z, 0.70, 0.14, 0.22, PALETTE.oliveDark);
    b.box(1.66, 0.72, z * 0.90, 0.10, 0.12, 0.16, PALETTE.glassDark);
  }
  b.cylinderZ(-1.32, 0.86, 0.40, 0.07, 0.44, 6, PALETTE.canvas);
  b.box(-0.30, 1.04, -0.72, 0.60, 0.12, 0.10, PALETTE.metal);
  return b.build();
}

/**
 * Twelve thermobaric tubes in a 4 x 3 box on a turntable. An elevating cradle
 * under the pack is what makes it read as a launcher rather than a cargo box.
 * The local tube tips reach 2.45 so the pack's own mount bias still lands the
 * salvo on the authored 2.10 forward muzzle.
 */
function buildTospLauncher(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, 0.02, 0, 0.56, 0.06, 14, PALETTE.hullDark);
  b.box(-0.10, 0.16, 0, 1.24, 0.24, 1.14, PALETTE.hullDark);
  // Cradle trunnions and elevation rams.
  for (const z of [-0.58, 0.58]) {
    b.box(-0.10, 0.30, z, 0.90, 0.12, 0.08, PALETTE.metal);
  }
  for (const z of [-0.34, 0.34]) {
    beam(b, [-0.50, 0.22, z], [-0.30, 0.46, z], 0.07, 0.07, PALETTE.metal);
  }
  // Tube pack box with a blast plate at the rear and a cap rail at the front.
  b.box(0.10, 0.50, 0, 2.10, 0.56, 1.10, TOSP_HULL);
  b.box(-0.98, 0.50, 0, 0.10, 0.62, 1.14, PALETTE.hullDark);
  b.box(1.14, 0.50, 0, 0.08, 0.60, 1.12, PALETTE.hull);
  b.box(0.10, 0.79, 0, 1.60, 0.03, 1.00, TOSP_HULL, 0.92);
  // Twelve tubes in three rows of four. Tube mouths sit proud of the front cap.
  for (const z of [-0.44, -0.15, 0.15, 0.44]) {
    for (const y of [0.30, 0.50, 0.70]) {
      b.cylinderX(1.30, y, z, 0.085, 2.30, 8, PALETTE.track);
      b.cylinderX(2.42, y, z, 0.098, 0.06, 8, PALETTE.darkMetal);
    }
  }
  // Wiring conduits, a range-finder head and stowed crew kit on the pack roof.
  for (const y of [0.40, 0.60]) b.box(-0.60, y, 0.58, 0.70, 0.04, 0.04, PALETTE.metal);
  b.box(-0.44, 0.84, 0.40, 0.22, 0.14, 0.18, PALETTE.hullDark);
  b.box(-0.33, 0.85, 0.49, 0.10, 0.08, 0.02, PALETTE.glass);
  b.box(-0.30, 0.80, -0.34, 0.40, 0.10, 0.24, PALETTE.canvas);
  beam(b, [-0.80, 0.80, -0.50], [-0.84, 1.24, -0.54], 0.02, 0.02, PALETTE.metal);
  return b.build();
}

/* ------------------------------------------------------------------------ */
/* Pathfinder scout car                                                      */
/* ------------------------------------------------------------------------ */

/**
 * A lower, longer 4x4 than the armed scout: the bonnet runs to the axle line,
 * the cabin is raked back, and the rear carries a sensor mast plus a stowage
 * rack. Without the autocannon cupola the roofline is the recognition cue.
 */
function buildPathfinderBody(): MeshBuffers {
  const b = new MeshBuilder();
  for (const x of [-1.16, 1.14]) {
    for (const z of [-0.66, 0.66]) {
      roadWheel(b, x, z, 0.34);
      b.box(x, 0.74, z * 1.02, 0.78, 0.05, 0.30, SCOUT_DARK);
      b.box(x, 0.58, z * 1.08, 0.50, 0.16, 0.04, SCOUT_DARK);
    }
  }
  // Long, low body with a boat-tail rear and a raked bonnet.
  b.box(0.02, 0.50, 0, 2.56, 0.32, 1.14, SCOUT_DARK);
  b.box(-0.04, 0.70, 0, 2.44, 0.16, 1.26, SCOUT_BODY);
  b.addQuad([1.30, 0.78, -0.60], [1.30, 0.78, 0.60], [1.52, 0.56, 0.50], [1.52, 0.56, -0.50], PALETTE.hullLight);
  b.box(1.16, 0.66, 0, 0.44, 0.16, 1.04, SCOUT_BODY);
  b.addQuad([-1.24, 0.78, -0.62], [-1.24, 0.78, 0.62], [-1.42, 0.62, 0.50], [-1.42, 0.62, -0.50], SCOUT_DARK);
  // Raked two-seat cabin: glass band on three sides, thin roof.
  b.addQuad([0.86, 0.78, -0.58], [0.86, 0.78, 0.58], [0.56, 1.06, 0.52], [0.56, 1.06, -0.52], PALETTE.glassDark);
  b.box(-0.10, 1.02, 0, 1.20, 0.10, 1.12, SCOUT_BODY);
  b.box(-0.10, 1.08, 0, 0.96, 0.02, 0.90, SCOUT_BODY, 0.9);
  for (const z of [-0.56, 0.56]) {
    b.box(-0.10, 0.92, z, 1.10, 0.20, 0.02, PALETTE.glassDark);
    b.box(-0.10, 0.93, z * 1.01, 0.92, 0.14, 0.01, PALETTE.glass);
    b.box(0.52, 0.94, z * 1.02, 0.03, 0.24, 0.04, PALETTE.darkMetal);
  }
  for (const z of [-0.50, 0.50]) b.box(0.86, 1.12, z, 0.03, 0.03, 0.30, PALETTE.metal);
  // Roof rack and the long-range optics mast behind the cabin.
  b.box(-0.44, 1.14, 0, 0.56, 0.02, 1.00, PALETTE.metal);
  for (const z of [-0.46, 0.46]) b.box(-0.44, 1.20, z, 0.50, 0.10, 0.04, PALETTE.metal);
  b.box(-0.76, 1.32, 0, 0.09, 0.52, 0.09, PALETTE.metal);
  b.box(-0.76, 1.62, 0, 0.26, 0.20, 0.30, PALETTE.hullDark);
  b.box(-0.62, 1.62, 0, 0.03, 0.12, 0.20, PALETTE.glass);
  b.box(-0.76, 1.78, 0, 0.16, 0.10, 0.18, PALETTE.metal);
  b.box(-0.76, 1.80, 0.09, 0.08, 0.06, 0.02, PALETTE.glass);
  for (const z of [-0.20, 0.20]) beam(b, [-0.30, 1.16, z], [-0.76, 1.30, z * 0.5], 0.02, 0.02, PALETTE.metal);
  // Rear stowage rack with jerry cans, and a spare wheel on the tailgate.
  b.box(-1.14, 0.86, 0, 0.44, 0.03, 1.10, PALETTE.metal);
  for (const z of [-0.40, 0.00, 0.40]) {
    b.box(-1.14, 1.00, z, 0.30, 0.24, 0.26, PALETTE.canvas);
    b.box(-1.14, 1.12, z, 0.26, 0.02, 0.20, PALETTE.canvas);
  }
  b.box(-1.24, 0.72, 0, 0.10, 0.36, 1.00, SCOUT_BODY);
  b.cylinderZ(-1.32, 0.62, 0, 0.30, 0.12, 12, PALETTE.rubber);
  b.cylinderZ(-1.32, 0.62, 0, 0.12, 0.14, 8, PALETTE.metal);
  // Brush bar, mirrors and the roof marker aerial.
  for (const z of [-0.46, 0.46]) {
    b.box(1.50, 0.72, z, 0.03, 0.34, 0.03, PALETTE.metal);
  }
  b.box(1.50, 0.88, 0, 0.03, 0.03, 0.96, PALETTE.metal);
  for (const z of [-0.60, 0.60]) b.box(0.62, 1.06, z, 0.12, 0.02, 0.02, PALETTE.darkMetal);
  beam(b, [-0.40, 1.14, 0.36], [-0.52, 1.62, 0.40], 0.015, 0.015, PALETTE.metal);
  return b.build();
}

/* ------------------------------------------------------------------------ */
/* Fire support ship                                                         */
/* ------------------------------------------------------------------------ */

/**
 * A shore-bombardment monitor rather than a fast attack craft: high flared bow,
 * long forecastle with rocket cells, boxy bridge structure and a tripod mast
 * carrying the fire-control dome. The aft secondary mount is part of the hull so
 * only the main battery rotates.
 */
function buildNavalSupportBody(): MeshBuffers {
  const b = new MeshBuilder();
  // Hull: flat run amidships, one flared bow plate per side, transom aft.
  b.box(0.10, 0.44, 0, 12.00, 0.88, 2.30, SHIP_HULL);
  b.box(0.10, 0.08, 0, 11.80, 0.20, 2.10, PALETTE.hullDark);
  b.box(0.10, 0.42, 0, 11.90, 0.10, 2.34, PALETTE.track);
  b.addQuad([6.10, 0.06, -1.15], [6.10, 0.06, 1.15], [6.70, 0.66, 0.34], [6.70, 0.66, -0.34], SHIP_HULL);
  b.addQuad([6.10, 0.88, -1.15], [6.10, 0.88, 1.15], [6.70, 0.70, 0.34], [6.70, 0.70, -0.34], SHIP_UPPER);
  for (const side of [-1, 1]) {
    b.addQuad(
      [6.10, 0.06, 1.15 * side],
      [6.70, 0.66, 0.34 * side],
      [6.70, 0.70, 0.34 * side],
      [6.10, 0.88, 1.15 * side],
      PALETTE.hullDark,
    );
  }
  // Main deck, forecastle step and the painted deck band.
  b.box(0.10, 0.90, 0, 11.90, 0.06, 2.24, PALETTE.hullDark);
  b.box(3.90, 0.955, 0, 3.60, 0.05, 2.00, SHIP_UPPER);
  b.box(3.90, 0.985, 0, 3.10, 0.02, 1.60, SHIP_HULL, 0.92);
  b.box(-3.10, 0.955, 0, 5.40, 0.05, 2.00, SHIP_UPPER);
  // Rocket cells on the forecastle, angled over the bow.
  for (const z of [-0.62, 0.62]) {
    b.box(4.40, 1.16, z, 1.50, 0.34, 0.60, PALETTE.darkMetal);
    for (let i = 0; i < 3; i++) {
      b.cylinderX(4.10 + i * 0.36, 1.20, z, 0.07, 1.10, 8, PALETTE.oliveDark);
    }
    b.box(5.18, 1.16, z, 0.10, 0.38, 0.66, PALETTE.warning);
  }
  // Superstructure: two decks of bridge with a raked screen and bridge wings.
  b.box(1.10, 1.44, 0, 3.40, 1.02, 1.86, SHIP_UPPER);
  b.box(1.10, 2.02, 0, 3.10, 0.14, 1.72, PALETTE.hullDark);
  b.box(1.90, 2.28, 0, 1.50, 0.42, 1.50, SHIP_UPPER);
  b.addQuad([2.62, 2.10, -0.75], [2.62, 2.10, 0.75], [2.44, 2.48, 0.66], [2.44, 2.48, -0.66], PALETTE.hull);
  b.box(1.90, 2.50, 0, 1.44, 0.06, 1.44, SHIP_UPPER);
  for (const z of [-0.76, 0.76]) {
    b.box(1.10, 1.66, z, 3.20, 0.22, 0.03, PALETTE.glassDark);
    b.box(1.10, 1.67, z * 1.01, 3.00, 0.15, 0.02, PALETTE.glass);
    b.box(2.10, 1.64, z * 1.02, 0.80, 0.16, 0.02, PALETTE.glass);
    // Bridge wings.
    b.box(2.30, 1.66, z * 1.20, 0.70, 0.10, 0.34, SHIP_UPPER);
  }
  b.box(2.68, 1.68, 0, 0.03, 0.24, 1.20, PALETTE.glassDark);
  // Funnel, air intakes and boat davits.
  b.box(0.30, 2.02, 0, 0.86, 0.86, 0.92, SHIP_UPPER);
  b.box(0.30, 2.48, 0, 0.90, 0.08, 0.96, PALETTE.darkMetal);
  b.box(0.30, 2.54, 0, 0.60, 0.06, 0.66, PALETTE.track);
  for (const z of [-0.90, 0.90]) {
    b.box(-0.16, 1.60, z, 0.40, 0.26, 0.18, PALETTE.hullDark);
    b.box(0.10, 1.58, z * 1.16, 0.90, 0.10, 0.16, PALETTE.canvas);
    b.box(-0.30, 1.70, z * 1.10, 0.06, 0.24, 0.06, PALETTE.metal);
  }
  // Tripod mast with yards and the fire-control dome.
  beam(b, [1.60, 2.48, 0], [1.20, 3.58, 0], 0.10, 0.10, PALETTE.metal);
  beam(b, [1.60, 2.48, -0.30], [1.16, 3.20, -0.05], 0.05, 0.05, PALETTE.metal);
  beam(b, [1.60, 2.48, 0.30], [1.16, 3.20, 0.05], 0.05, 0.05, PALETTE.metal);
  b.box(1.22, 3.14, 0, 0.10, 0.05, 1.30, PALETTE.metal);
  b.sphere(1.22, 3.40, 0, 0.22, 4, 10, PALETTE.white);
  b.box(1.22, 3.40, 0, 0.36, 0.10, 0.10, PALETTE.hullDark);
  b.box(1.36, 3.40, 0, 0.04, 0.14, 0.14, PALETTE.glassDark);
  beam(b, [1.22, 3.58, 0], [1.10, 3.92, 0], 0.018, 0.018, PALETTE.metal);
  // Aft secondary mount baked into the hull: enclosed base, short barrel.
  b.cylinder(-3.40, 1.06, 0, 0.52, 0.16, 12, PALETTE.hullDark);
  b.box(-3.40, 1.28, 0, 0.80, 0.30, 0.72, SHIP_UPPER);
  b.box(-3.30, 1.40, 0, 0.50, 0.10, 0.46, PALETTE.hull);
  b.cylinderX(-2.72, 1.30, 0, 0.055, 0.70, 8, PALETTE.darkMetal);
  b.cylinderX(-2.34, 1.30, 0, 0.075, 0.10, 8, PALETTE.hullDark);
  // Stern ramp, capstan and the hangar-less aft deck lockers.
  b.box(-6.06, 0.60, 0, 0.16, 0.62, 2.20, PALETTE.hullDark);
  b.box(-5.70, 1.02, 0, 0.90, 0.06, 1.70, PALETTE.metal);
  for (const z of [-0.62, 0.62]) b.box(-5.20, 1.10, z, 0.44, 0.20, 0.30, PALETTE.oliveDark);
  for (const z of [-0.86, 0.86]) b.cylinder(-4.60, 1.06, z, 0.14, 0.14, 8, PALETTE.metal);
  // Deck-edge railings, bollards, anchors and life-raft canisters.
  for (const z of [-1.10, 1.10]) {
    b.box(0.10, 1.14, z, 11.40, 0.03, 0.03, PALETTE.metal);
    for (let i = 0; i < 9; i++) {
      b.box(-5.20 + i * 1.30, 1.06, z, 0.02, 0.16, 0.02, PALETTE.metal);
    }
    b.box(-2.10, 1.02, z, 0.60, 0.12, 0.16, PALETTE.white);
    b.box(2.80, 1.02, z, 0.60, 0.12, 0.16, PALETTE.white);
    b.cylinder(5.10, 1.04, z, 0.12, 0.16, 8, PALETTE.darkMetal);
  }
  for (const z of [-0.52, 0.52]) {
    b.addQuad([6.30, 0.50, z], [6.02, 0.62, z], [6.02, 0.90, z], [6.30, 0.72, z], PALETTE.darkMetal);
  }
  return b.build();
}

/** Single enclosed 5-inch mount for the fire-support hull. */
function buildNavalSupportGun(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, -0.14, 0, 0.44, 0.28, 12, PALETTE.hullDark);
  b.box(-0.30, 0.06, 0, 0.86, 0.20, 0.82, SHIP_UPPER);
  b.addQuad([-0.30, 0.16, -0.41], [0.52, 0.16, -0.30], [0.46, 0.34, -0.26], [-0.26, 0.34, -0.34], SHIP_UPPER);
  b.addQuad([-0.30, 0.16, 0.41], [-0.26, 0.34, 0.34], [0.46, 0.34, 0.26], [0.52, 0.16, 0.30], SHIP_UPPER);
  b.addQuad([-0.30, -0.04, -0.41], [-0.30, -0.04, 0.41], [-0.30, 0.16, 0.41], [-0.30, 0.16, -0.41], PALETTE.hullDark);
  b.box(0.02, 0.36, 0, 0.60, 0.03, 0.52, SHIP_HULL, 0.92);
  // Gun axis sits at local 0.26 so the mount lands the muzzle on the authored
  // 0.9 height; the tip reaches 0.80 local for the 3.0 forward offset.
  b.cylinderX(0.62, 0.26, 0, 0.062, 1.10, 8, PALETTE.darkMetal);
  b.cylinderX(0.68, 0.26, 0, 0.090, 0.34, 8, PALETTE.hullDark);
  b.cylinderX(1.16, 0.26, 0, 0.072, 0.10, 8, PALETTE.metal);
  // Sight hood and the crew hatch behind the shield.
  b.box(-0.10, 0.42, 0.22, 0.22, 0.10, 0.18, PALETTE.hullDark);
  b.box(-0.02, 0.43, 0.30, 0.10, 0.06, 0.02, PALETTE.glass);
  b.cylinder(-0.26, 0.40, -0.20, 0.12, 0.04, 10, PALETTE.hull);
  return b.build();
}

export const VARIANT_HULL_STYLES: Record<string, EntityStyle> = {
  spearhead: {
    body: buildSpearheadBody(),
    turret: buildSpearheadTurret(),
    turretOffset: [0, 1.0, 0],
  },
  tosp: {
    body: buildTospBody(),
    turret: buildTospLauncher(),
    // The pack rides the rear deck, so the mount is biased aft; the tube tips
    // still land on the authored 2.10 forward muzzle.
    turretOffset: [-0.35, 1.02, 0],
  },
  pathfinder: {
    body: buildPathfinderBody(),
    turretOffset: [0, 0, 0],
  },
  navalSupport: {
    body: buildNavalSupportBody(),
    turret: buildNavalSupportGun(),
    turretOffset: [3.55, 1.02, 0],
  },
};
