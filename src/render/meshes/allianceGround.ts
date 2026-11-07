import { MeshBuilder, PALETTE, type Color } from '../geometry';
import type { MeshBuffers } from '../gl';
import { beam } from '../meshKit';
import type { EntityStyle } from '../unitMeshes';

/**
 * Eastern-Coalition ground platforms.
 *
 * Every vehicle in this file replaces a borrowed canonical mesh. The alliance
 * fielded the same hulls as the baseline roster for a whole release, which made
 * a T-72 look identical to the western MBT beside it; these are authored
 * silhouettes so the two armies can be told apart at battle zoom, from the
 * direction a player actually looks at them: above and behind.
 *
 * Conventions are the same as `unitMeshes`: world units are metres at the
 * presentation scale, +X is the nose, geometry sits on y = 0, and the turret is
 * authored around its own ring with `turretOffset` lifting it onto the hull.
 * Paint is a shade greyer and greener than the baseline palette so an EC
 * column reads as one formation before any team colour is applied.
 */

const EC_PAINT: Color = [0.27, 0.30, 0.26];
const EC_PAINT_LIGHT: Color = [0.34, 0.37, 0.31];
const EC_PAINT_DARK: Color = [0.16, 0.19, 0.16];
const EC_BLACK: Color = [0.10, 0.11, 0.10];
const TEAM = 0.9;

interface TrackOptions {
  front: number;
  rear: number;
  halfTrack: number;
  trackWidth: number;
  wheelCount: number;
  wheelRadius: number;
  wheelWidth: number;
  /** Fender plates over the top run. */
  skirt?: boolean;
}

/** Segmented track run with road wheels, drive sprockets and return rollers. */
function trackRun(b: MeshBuilder, o: TrackOptions): void {
  const span = o.front - o.rear;
  const mid = (o.front + o.rear) / 2;
  for (const side of [-1, 1]) {
    const z = o.halfTrack * side;
    b.box(mid, 0.19, z, span, 0.38, o.trackWidth, EC_BLACK);
    // Top run: individual links rather than one smooth band.
    const links = o.wheelCount * 2;
    for (let i = 0; i < links; i++) {
      const x = o.rear + (span / links) * (i + 0.5);
      b.box(x, 0.385, z, span / links - 0.03, 0.05, o.trackWidth, PALETTE.darkMetal);
    }
    for (let i = 0; i < o.wheelCount; i++) {
      const t = o.wheelCount === 1 ? 0.5 : i / (o.wheelCount - 1);
      const x = o.rear + 0.34 + t * (span - 0.68);
      b.cylinderZ(x, o.wheelRadius, z, o.wheelRadius, o.wheelWidth, 10, PALETTE.darkMetal);
      b.cylinderZ(x, o.wheelRadius, z, o.wheelRadius * 0.44, o.wheelWidth + 0.03, 8, PALETTE.metal);
    }
    // Drive sprocket at the front, idler at the back, both slightly raised.
    b.cylinderZ(o.front - 0.06, 0.24, z, 0.23, o.wheelWidth, 9, PALETTE.track);
    b.cylinderZ(o.rear + 0.06, 0.24, z, 0.22, o.wheelWidth, 9, PALETTE.track);
    for (const x of [o.rear + 0.34, mid, o.front - 0.34]) {
      b.cylinderZ(x, 0.37, z, 0.07, o.wheelWidth * 0.8, 6, PALETTE.metal);
    }
    if (o.skirt !== false) {
      b.box(mid, 0.52, z * 1.16, span - 0.30, 0.24, 0.06, EC_PAINT_DARK);
      b.box(mid, 0.68, z * 1.10, span - 0.14, 0.06, 0.24, EC_PAINT_DARK);
    }
  }
}

/** One axle pair with visible hubs and a fender arch. */
function axle(b: MeshBuilder, x: number, zHalf: number, radius: number, width: number): void {
  for (const side of [-1, 1]) {
    const z = zHalf * side;
    b.cylinderZ(x, radius, z, radius, width, 12, PALETTE.rubber);
    b.cylinderZ(x, radius, z, radius * 0.42, width + 0.03, 10, PALETTE.metal);
    b.cylinderZ(x, radius, z, radius * 0.16, width + 0.05, 8, PALETTE.darkMetal);
    b.box(x, radius + radius + 0.06, z * 1.03, radius * 2.4, 0.06, width + 0.12, EC_PAINT_DARK);
  }
}

/**
 * T-72-family MBT: a lower, flatter hull than the baseline tank, with ERA
 * bricks laid over the glacis, ribbed external fuel drums across the rear deck
 * and the autoloader hump behind the turret ring.
 */
function buildEcTankBody(): MeshBuffers {
  const b = new MeshBuilder();
  trackRun(b, {
    front: 1.74,
    rear: -1.74,
    halfTrack: 0.66,
    trackWidth: 0.30,
    wheelCount: 6,
    wheelRadius: 0.20,
    wheelWidth: 0.30,
  });
  b.box(0, 0.44, 0, 3.34, 0.36, 1.24, EC_PAINT_DARK);
  b.box(0.02, 0.65, 0, 3.26, 0.14, 1.32, EC_PAINT);
  // Razor glacis: a shallow V rather than a single slab plate.
  b.addQuad(
    [1.58, 0.73, -0.62],
    [1.62, 0.73, 0],
    [1.94, 0.46, 0],
    [1.90, 0.46, -0.56],
    EC_PAINT_LIGHT,
  );
  b.addQuad(
    [1.62, 0.73, 0],
    [1.58, 0.73, 0.62],
    [1.90, 0.46, 0.56],
    [1.94, 0.46, 0],
    EC_PAINT_LIGHT,
  );
  b.box(1.82, 0.42, 0, 0.22, 0.22, 1.18, EC_PAINT_DARK);
  // ERA bricks in three rows across the glacis, tilted by stacking steps.
  for (let row = 0; row < 3; row++) {
    const x = 1.60 + row * 0.10;
    const y = 0.74 - row * 0.085;
    for (const z of [-0.44, -0.15, 0.15, 0.44]) {
      b.box(x, y + 0.04, z, 0.13, 0.09, 0.24, EC_PAINT, 0.0);
      b.box(x + 0.055, y + 0.09, z, 0.03, 0.02, 0.20, PALETTE.darkMetal);
    }
  }
  // Rear deck: louvres, three ribbed fuel drums and the autoloader hump.
  b.box(-1.16, 0.73, 0, 0.82, 0.05, 1.20, EC_PAINT_DARK);
  for (let i = 0; i < 5; i++) {
    b.box(-1.46 + i * 0.14, 0.76, 0, 0.05, 0.035, 1.02, PALETTE.darkMetal);
  }
  for (const z of [-0.52, 0, 0.52]) {
    b.cylinderX(-1.30, 0.94, z, 0.15, 0.94, 9, EC_PAINT);
    for (let i = 0; i < 3; i++) {
      b.cylinderX(-1.58 + i * 0.28, 0.94, z, 0.16, 0.045, 9, PALETTE.darkMetal);
    }
    b.box(-0.83, 0.94, z, 0.05, 0.16, 0.20, PALETTE.metal);
  }
  b.box(-1.70, 0.62, 0, 0.10, 0.34, 1.20, EC_PAINT_DARK);
  // Twin exhaust ports on the left rear plate (a T-72 cue at any zoom).
  for (const z of [0.36, 0.60]) {
    b.cylinderX(-1.76, 0.50, z, 0.09, 0.14, 8, PALETTE.darkMetal);
  }
  // Fenders, stowage boxes and the unditching log.
  for (const z of [-0.78, 0.78]) {
    b.box(0.10, 0.74, z, 2.60, 0.05, 0.20, EC_PAINT_DARK);
    b.box(-0.62, 0.80, z * 1.02, 0.72, 0.16, 0.10, PALETTE.oliveDark);
    b.box(0.62, 0.80, z * 1.02, 0.40, 0.12, 0.09, PALETTE.canvas);
    // Painted identification stripe high on the fender, the team surface.
    b.box(0.02, 0.775, z * 1.08, 1.30, 0.035, 0.02, EC_PAINT_LIGHT, TEAM);
  }
  b.cylinderZ(0.92, 0.86, 0, 0.09, 1.30, 6, PALETTE.sandbag);
  // IR searchlight pair and the driver's periscopes beside the glacis.
  b.box(1.52, 0.90, 0.30, 0.18, 0.16, 0.22, PALETTE.darkMetal);
  b.box(1.53, 0.90, 0.30, 0.03, 0.13, 0.18, PALETTE.glass);
  b.box(1.44, 0.80, -0.34, 0.10, 0.10, 0.14, PALETTE.glassDark);
  b.box(1.30, 0.79, -0.10, 0.10, 0.06, 0.22, PALETTE.glassDark);
  // Snorkel tube stowed across the rear deck.
  b.cylinderX(-0.62, 1.06, -0.66, 0.07, 1.14, 7, PALETTE.oliveDark);
  // Turret ring sits proud of the low roof.
  b.cylinder(0, 0.76, 0, 0.56, 0.06, 18, EC_PAINT_DARK);
  return b.build();
}

/** Cast dome turret, 125 mm smoothbore with thermal sleeve, cupola and searchlight. */
function buildEcTankTurret(): MeshBuffers {
  const b = new MeshBuilder();
  // Cast dome: three stacked rings narrow toward a rounded crown.
  b.cylinder(0, 0.04, 0, 0.62, 0.08, 16, EC_PAINT);
  b.cylinder(0, 0.17, 0, 0.58, 0.18, 16, EC_PAINT);
  b.cylinder(0, 0.30, 0, 0.48, 0.12, 14, EC_PAINT);
  b.sphere(-0.02, 0.35, 0, 0.46, 3, 14, EC_PAINT);
  // Painted recognition band over the crown; the dome is what a player sees.
  b.cylinder(-0.02, 0.345, 0, 0.30, 0.03, 14, EC_PAINT_LIGHT, TEAM);
  // Mantlet and the long smoothbore.
  b.box(0.55, 0.20, 0, 0.34, 0.30, 0.46, EC_PAINT_DARK);
  b.cylinderX(1.30, 0.20, 0, 0.05, 1.30, 8, PALETTE.darkMetal);
  b.cylinderX(1.15, 0.20, 0, 0.075, 0.66, 8, EC_PAINT_DARK);
  b.cylinderX(1.90, 0.20, 0, 0.07, 0.18, 8, PALETTE.darkMetal);
  b.cylinderX(2.24, 0.20, 0, 0.045, 0.08, 8, PALETTE.track);
  // Commander's cupola with the AA machine gun, loader's hatch behind.
  b.cylinder(-0.16, 0.42, 0.30, 0.17, 0.10, 10, EC_PAINT);
  b.box(-0.16, 0.49, 0.30, 0.22, 0.05, 0.22, EC_PAINT_LIGHT, TEAM);
  b.box(-0.16, 0.55, 0.30, 0.07, 0.07, 0.07, PALETTE.darkMetal);
  b.cylinderX(0.02, 0.58, 0.30, 0.022, 0.44, 5, PALETTE.darkMetal);
  b.cylinder(-0.18, 0.40, -0.26, 0.14, 0.05, 8, PALETTE.hullDark);
  // Sight, IR searchlight on the gun and the paired smoke dischargers.
  b.box(0.24, 0.40, -0.30, 0.20, 0.16, 0.22, EC_PAINT_DARK);
  b.box(0.26, 0.40, -0.41, 0.13, 0.10, 0.02, PALETTE.glass);
  b.box(0.92, 0.40, 0.30, 0.24, 0.20, 0.22, PALETTE.darkMetal);
  b.box(0.90, 0.40, 0.30, 0.06, 0.16, 0.17, PALETTE.glass);
  for (const z of [-0.34, -0.20, 0.20, 0.34]) {
    b.cylinderX(0.42, 0.32, z, 0.028, 0.14, 4, PALETTE.darkMetal);
  }
  // Stowage basket around the bustle and the whip aerial.
  b.box(-0.60, 0.16, 0, 0.34, 0.20, 0.90, PALETTE.darkMetal);
  b.box(-0.60, 0.26, 0.34, 0.30, 0.10, 0.14, PALETTE.oliveDark);
  b.box(-0.60, 0.26, -0.34, 0.30, 0.10, 0.14, PALETTE.oliveDark);
  b.box(-0.74, 0.55, -0.40, 0.012, 0.42, 0.012, PALETTE.metal);
  return b.build();
}

/**
 * BMP-family IFV: a low wedge prow, troop hatches over the rear compartment,
 * firing ports along the flanks and a small two-man turret carrying a 30 mm
 * cannon with an ATGM rail above it.
 */
function buildEcIfvBody(): MeshBuffers {
  const b = new MeshBuilder();
  trackRun(b, {
    front: 1.62,
    rear: -1.62,
    halfTrack: 0.60,
    trackWidth: 0.26,
    wheelCount: 6,
    wheelRadius: 0.17,
    wheelWidth: 0.26,
  });
  b.box(0, 0.40, 0, 3.16, 0.32, 1.12, EC_PAINT_DARK);
  b.box(-0.02, 0.59, 0, 3.08, 0.12, 1.20, EC_PAINT);
  // Faceted prow: two wedge plates meeting a narrow flat nose.
  b.addQuad(
    [1.50, 0.65, -0.58],
    [1.50, 0.65, 0.58],
    [1.80, 0.34, 0.30],
    [1.80, 0.34, -0.30],
    EC_PAINT_LIGHT,
  );
  b.addQuad(
    [1.50, 0.24, -0.56],
    [1.50, 0.24, 0.56],
    [1.80, 0.32, 0.30],
    [1.80, 0.32, -0.30],
    EC_PAINT_DARK,
  );
  b.box(1.66, 0.30, 0, 0.22, 0.24, 0.60, EC_PAINT_DARK);
  // Driver's hatch and vision blocks on the left of the prow.
  b.box(1.18, 0.70, -0.28, 0.30, 0.10, 0.28, EC_PAINT_LIGHT);
  b.box(1.34, 0.72, -0.28, 0.03, 0.06, 0.20, PALETTE.glassDark);
  b.box(1.30, 0.70, 0.06, 0.05, 0.06, 0.24, PALETTE.glassDark);
  // Folded amphibious wave screen on the glacis.
  b.box(1.02, 0.70, 0, 0.08, 0.16, 0.92, EC_PAINT_DARK);
  // Troop compartment: two roof hatches, periscopes and a rear door.
  for (const z of [-0.26, 0.26]) {
    b.box(-1.02, 0.67, z, 0.56, 0.06, 0.40, EC_PAINT_LIGHT, TEAM);
    b.box(-0.78, 0.71, z, 0.08, 0.04, 0.10, PALETTE.darkMetal);
  }
  b.box(-1.62, 0.52, 0, 0.08, 0.34, 1.00, EC_PAINT_DARK);
  b.box(-1.66, 0.52, 0.26, 0.03, 0.26, 0.20, PALETTE.darkMetal);
  // Firing ports and the side skirt that carries the team bands.
  for (const z of [-0.62, 0.62]) {
    b.box(0.10, 0.62, z, 2.80, 0.04, 0.10, EC_PAINT_DARK);
    b.box(0.10, 0.60, z * 1.09, 2.20, 0.03, 0.02, EC_PAINT_LIGHT, TEAM);
    for (const x of [-0.66, -0.02, 0.54]) {
      b.box(x, 0.50, z, 0.16, 0.10, 0.04, PALETTE.darkMetal);
    }
    b.box(-0.34, 0.70, z * 1.02, 0.60, 0.10, 0.05, PALETTE.oliveDark);
    b.box(0.62, 0.70, z * 1.02, 0.34, 0.08, 0.05, PALETTE.canvas);
  }
  // Left-side exhaust, rear swim vane and the tow eyes.
  b.cylinderX(-1.20, 0.50, -0.70, 0.10, 0.44, 8, PALETTE.darkMetal);
  b.box(-1.40, 0.24, 0, 0.20, 0.12, 0.70, PALETTE.metal);
  for (const z of [-0.34, 0.34]) {
    b.box(1.74, 0.26, z, 0.14, 0.12, 0.10, PALETTE.metal);
  }
  // 30 mm turret ring, set slightly left of centre as on the real vehicle.
  b.cylinder(-0.06, 0.66, 0, 0.42, 0.05, 14, EC_PAINT_DARK);
  return b.build();
}

function buildEcIfvTurret(): MeshBuffers {
  const b = new MeshBuilder();
  // Small conical turret: wide base, narrow roof.
  b.cylinder(0, 0.03, 0, 0.40, 0.06, 14, EC_PAINT_DARK);
  b.cylinder(0, 0.15, 0, 0.34, 0.20, 14, EC_PAINT);
  b.cylinder(0, 0.28, 0, 0.26, 0.10, 12, EC_PAINT_LIGHT);
  b.box(-0.02, 0.34, 0, 0.34, 0.05, 0.30, EC_PAINT_LIGHT, TEAM);
  // 30 mm cannon: thin, long, with a slotted muzzle brake.
  b.cylinderX(0.90, 0.16, 0, 0.032, 1.10, 7, PALETTE.darkMetal);
  b.cylinderX(1.47, 0.16, 0, 0.05, 0.12, 7, EC_PAINT_DARK);
  b.box(0.44, 0.16, 0, 0.20, 0.14, 0.18, PALETTE.metal);
  // ATGM rail above the cannon with one missile loaded.
  b.box(0.30, 0.42, 0.16, 0.66, 0.06, 0.06, PALETTE.metal);
  b.cylinderX(0.60, 0.50, 0.16, 0.055, 0.86, 8, PALETTE.oliveDark);
  b.cone(1.04, 0.50, 0.16, 0.055, 0.10, 8, PALETTE.darkMetal);
  b.box(0.18, 0.50, 0.16, 0.10, 0.08, 0.10, PALETTE.track);
  // Gunner's sight, commander's periscopes and smoke dischargers.
  b.box(0.16, 0.36, -0.18, 0.16, 0.12, 0.18, EC_PAINT_DARK);
  b.box(0.18, 0.38, -0.27, 0.10, 0.07, 0.02, PALETTE.glass);
  for (const z of [-0.20, 0.20]) {
    b.box(-0.14, 0.35, z, 0.10, 0.04, 0.10, PALETTE.glassDark);
  }
  for (const z of [-0.30, 0.30]) {
    b.cylinderX(0.10, 0.28, z, 0.025, 0.10, 4, PALETTE.darkMetal);
  }
  b.box(-0.30, 0.20, 0, 0.14, 0.14, 0.24, PALETTE.oliveDark);
  return b.build();
}

/**
 * Missile tank destroyer: a low, wide tracked chassis with a long rear deck and
 * a hydraulic pedestal carrying a two-cell box launcher. No gun tube at all —
 * the pedestal and the flat launch box are the recognition cues.
 */
function buildEcTdBody(): MeshBuffers {
  const b = new MeshBuilder();
  trackRun(b, {
    front: 1.86,
    rear: -1.86,
    halfTrack: 0.68,
    trackWidth: 0.30,
    wheelCount: 5,
    wheelRadius: 0.22,
    wheelWidth: 0.30,
  });
  b.box(0, 0.46, 0, 3.66, 0.34, 1.28, EC_PAINT_DARK);
  b.box(-0.10, 0.66, 0, 3.54, 0.14, 1.36, EC_PAINT);
  // Long raked glacis and a wide flat launch deck behind the cab.
  b.addQuad(
    [1.74, 0.72, -0.66],
    [1.74, 0.72, 0.66],
    [2.02, 0.44, 0.56],
    [2.02, 0.44, -0.56],
    EC_PAINT_LIGHT,
  );
  b.box(1.90, 0.40, 0, 0.20, 0.20, 1.20, EC_PAINT_DARK);
  b.box(-0.30, 0.735, 0, 2.20, 0.03, 1.24, EC_PAINT_DARK);
  b.box(-0.30, 0.755, 0, 1.98, 0.02, 1.10, EC_PAINT_LIGHT, TEAM);
  // Crew hatches forward of the pedestal, driver's periscopes.
  for (const z of [-0.30, 0.30]) {
    b.box(0.92, 0.76, z, 0.28, 0.05, 0.26, EC_PAINT_LIGHT);
    b.box(1.10, 0.78, z, 0.03, 0.05, 0.16, PALETTE.glassDark);
  }
  b.box(1.44, 0.60, 0, 0.10, 0.14, 0.66, PALETTE.glassDark);
  // Pedestal foot and the two hydraulic rams that lift the launch box.
  b.cylinder(-0.04, 0.80, 0, 0.42, 0.10, 14, PALETTE.darkMetal);
  for (const z of [-0.34, 0.34]) {
    beam(b, [-0.34, 0.78, z], [-0.34, 1.10, z], 0.10, 0.10, PALETTE.metal);
    beam(b, [0.30, 0.78, z], [-0.20, 1.06, z], 0.07, 0.07, PALETTE.darkMetal);
  }
  // Fenders with stowed reload canisters and the team stripe.
  for (const z of [-0.82, 0.82]) {
    b.box(0.20, 0.74, z, 2.60, 0.05, 0.20, EC_PAINT_DARK);
    b.box(-0.24, 0.80, z * 1.02, 0.84, 0.14, 0.10, PALETTE.oliveDark);
    b.box(0.56, 0.80, z * 1.02, 0.36, 0.12, 0.09, PALETTE.canvas);
    b.box(0.14, 0.775, z * 1.09, 1.10, 0.035, 0.02, EC_PAINT_LIGHT, TEAM);
  }
  // Rear plate, spare track links and the paired taillights.
  b.box(-1.86, 0.56, 0, 0.10, 0.36, 1.24, EC_PAINT_DARK);
  for (const z of [-0.40, 0.40]) {
    b.box(-1.92, 0.58, z, 0.05, 0.26, 0.30, PALETTE.track);
    b.box(-1.92, 0.80, z, 0.03, 0.09, 0.11, PALETTE.red);
  }
  b.box(-1.40, 0.86, 0, 0.30, 0.12, 0.90, PALETTE.oliveDark);
  // Mast aerial behind the launcher.
  b.box(-1.62, 1.18, -0.52, 0.012, 0.62, 0.012, PALETTE.metal);
  return b.build();
}

/** Pedestal-mounted two-cell ATGM box with a mast sight and blast deflector. */
function buildEcTdLauncher(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, 0.06, 0, 0.30, 0.14, 12, EC_PAINT_DARK);
  b.box(0.02, 0.24, 0, 0.34, 0.24, 0.52, EC_PAINT_DARK);
  // Trunnion cheeks either side of the box.
  for (const z of [-0.34, 0.34]) {
    b.box(0.02, 0.30, z, 0.18, 0.30, 0.08, PALETTE.metal);
  }
  // The launch box: two stacked cells with visible mouths and hinged covers.
  for (const y of [0.30, 0.50]) {
    b.box(-0.06, y, 0, 1.06, 0.17, 0.52, EC_PAINT);
    b.cylinderX(0.46, y, 0, 0.075, 0.06, 9, PALETTE.darkMetal);
    b.box(0.42, y + 0.10, 0, 1.06, 0.03, 0.42, EC_PAINT_DARK);
  }
  b.box(-0.06, 0.40, 0.28, 1.06, 0.40, 0.03, EC_PAINT_LIGHT, TEAM);
  b.box(-0.06, 0.40, -0.28, 1.06, 0.40, 0.03, EC_PAINT_LIGHT, TEAM);
  // Rear blast deflector and the sensor mast on the left cheek.
  b.box(-0.66, 0.40, 0, 0.10, 0.46, 0.62, PALETTE.metal);
  b.box(-0.72, 0.40, 0, 0.03, 0.38, 0.52, PALETTE.darkMetal);
  beam(b, [-0.30, 0.58, -0.26], [-0.30, 0.94, -0.26], 0.05, 0.05, PALETTE.metal);
  b.box(-0.30, 0.98, -0.26, 0.16, 0.10, 0.20, EC_PAINT_DARK);
  b.box(-0.30, 0.99, -0.35, 0.10, 0.06, 0.02, PALETTE.glass);
  // Command sight head and a stowed reload rail.
  b.box(0.10, 0.64, 0.24, 0.16, 0.10, 0.14, PALETTE.glassDark);
  b.box(-0.44, 0.20, 0, 0.20, 0.10, 0.34, PALETTE.oliveDark);
  return b.build();
}

/**
 * Eight-wheeled amphibious scout car. Four axles, a boat-shaped nose with a
 * folding wave breakwater, a rear water jet and a tall pair of whip aerials.
 */
function buildEcReconBody(): MeshBuffers {
  const b = new MeshBuilder();
  for (const x of [-1.30, -0.44, 0.44, 1.30]) axle(b, x, 0.66, 0.30, 0.28);
  // Boat hull: flat sides, pointed prow, shallow keel line.
  b.box(0, 0.46, 0, 2.80, 0.30, 1.16, EC_PAINT_DARK);
  b.box(-0.04, 0.66, 0, 2.70, 0.16, 1.26, EC_PAINT);
  b.addQuad(
    [1.34, 0.74, -0.63],
    [1.34, 0.74, 0.63],
    [1.86, 0.50, 0.24],
    [1.86, 0.50, -0.24],
    EC_PAINT_LIGHT,
  );
  b.addQuad(
    [1.34, 0.34, -0.60],
    [1.34, 0.34, 0.60],
    [1.86, 0.44, 0.24],
    [1.86, 0.44, -0.24],
    EC_PAINT_DARK,
  );
  // Faceted cabin with a wrap-around windscreen and roof hatch.
  b.box(0.78, 0.86, 0, 0.80, 0.32, 1.08, EC_PAINT_LIGHT);
  b.box(1.19, 0.90, 0, 0.04, 0.22, 0.94, PALETTE.glassDark);
  for (const side of [-1, 1]) {
    b.addQuad(
      [0.40, 0.70, side * 0.54],
      [1.18, 0.70, side * 0.50],
      [1.18, 1.02, side * 0.50],
      [0.40, 1.02, side * 0.54],
      PALETTE.glassDark,
    );
  }
  b.cylinder(0.74, 1.04, 0, 0.20, 0.06, 10, EC_PAINT_DARK);
  // Folding breakwater on the nose and the rear swim vane.
  b.box(1.24, 0.82, 0, 0.06, 0.20, 1.06, EC_PAINT_DARK, TEAM);
  b.box(-1.46, 0.70, 0, 0.06, 0.30, 1.02, EC_PAINT_DARK);
  // Water jet housing and propeller at the stern.
  b.cylinderX(-1.56, 0.36, 0, 0.20, 0.26, 10, PALETTE.darkMetal);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.boxRot(-1.70, 0.36 + Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0.04, 0.30, 0.10, a, PALETTE.metal);
  }
  // Side doors with team panels and the stowed pioneer tools.
  for (const side of [-1, 1]) {
    const z = side * 0.64;
    b.box(0.10, 0.86, z, 0.46, 0.30, 0.03, EC_PAINT, TEAM);
    b.box(0.10, 1.00, z * 1.01, 0.34, 0.12, 0.02, PALETTE.glassDark);
    b.box(-0.46, 0.88, z, 0.34, 0.26, 0.03, EC_PAINT_LIGHT);
    b.box(-0.46, 0.99, z * 1.02, 0.24, 0.10, 0.02, PALETTE.glassDark);
    b.box(-0.76, 0.80, z * 1.06, 0.50, 0.10, 0.06, PALETTE.oliveDark);
    b.box(1.52, 0.86, z * 1.10, 0.14, 0.12, 0.10, PALETTE.glassDark);
    b.box(0.62, 0.72, z * 1.02, 0.34, 0.06, 0.16, PALETTE.darkMetal);
  }
  // Twin whip aerials on the rear quarters, spare wheel and taillights.
  for (const z of [-0.50, 0.50]) {
    b.box(-1.14, 1.20, z, 0.012, 0.86, 0.012, PALETTE.metal);
  }
  b.cylinderZ(-1.22, 0.72, 0, 0.28, 0.16, 12, PALETTE.rubber);
  b.cylinderZ(-1.22, 0.72, 0, 0.12, 0.18, 8, PALETTE.metal);
  for (const z of [-0.40, 0.40]) b.box(-1.52, 0.56, z, 0.03, 0.09, 0.11, PALETTE.red);
  // Cupola ring for the machine-gun mount.
  b.cylinder(0.36, 0.68, 0, 0.34, 0.05, 12, EC_PAINT_DARK);
  return b.build();
}

/** Small shielded machine-gun cupola: the scout's only weapon. */
function buildEcReconTurret(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, 0.04, 0, 0.34, 0.07, 12, EC_PAINT_DARK);
  b.box(-0.04, 0.20, 0, 0.52, 0.24, 0.44, EC_PAINT);
  // Sloped mantlet plate and a heavy machine gun.
  b.addQuad(
    [0.24, 0.08, -0.22],
    [0.24, 0.08, 0.22],
    [0.34, 0.32, 0.18],
    [0.34, 0.32, -0.18],
    EC_PAINT_LIGHT,
  );
  b.box(0.34, 0.22, 0, 0.16, 0.16, 0.20, PALETTE.metal);
  b.cylinderX(0.78, 0.22, 0, 0.038, 0.90, 7, PALETTE.darkMetal);
  b.cylinderX(1.20, 0.22, 0, 0.05, 0.14, 7, PALETTE.darkMetal);
  b.box(0.52, 0.22, 0.14, 0.16, 0.12, 0.10, PALETTE.oliveDark);
  // Roof team panel, hatch, sight and the smoke dischargers.
  b.box(-0.06, 0.335, 0, 0.34, 0.03, 0.30, EC_PAINT_LIGHT, TEAM);
  b.cylinder(-0.16, 0.36, 0, 0.12, 0.05, 8, PALETTE.hullDark);
  b.box(-0.02, 0.36, 0.20, 0.12, 0.08, 0.10, PALETTE.glassDark);
  b.box(-0.02, 0.37, 0.26, 0.08, 0.05, 0.02, PALETTE.glass);
  for (const z of [-0.24, 0.24]) {
    b.cylinderX(-0.10, 0.30, z, 0.022, 0.09, 4, PALETTE.darkMetal);
  }
  b.box(-0.30, 0.24, 0, 0.10, 0.10, 0.24, PALETTE.oliveDark);
  return b.build();
}

/**
 * Tracked gun/missile air-defence vehicle. Wider and flatter than the tank,
 * with four stabiliser legs folded down at the rear and generator lockers on
 * both flanks; the turret carries a radar dish behind the cannon.
 */
function buildEcAaBody(): MeshBuffers {
  const b = new MeshBuilder();
  trackRun(b, {
    front: 1.72,
    rear: -1.72,
    halfTrack: 0.70,
    trackWidth: 0.32,
    wheelCount: 6,
    wheelRadius: 0.20,
    wheelWidth: 0.32,
  });
  b.box(0, 0.46, 0, 3.30, 0.34, 1.34, EC_PAINT_DARK);
  b.box(-0.02, 0.66, 0, 3.22, 0.14, 1.42, EC_PAINT);
  b.addQuad(
    [1.58, 0.73, -0.70],
    [1.58, 0.73, 0.70],
    [1.88, 0.48, 0.60],
    [1.88, 0.48, -0.60],
    EC_PAINT_LIGHT,
  );
  b.box(1.78, 0.44, 0, 0.20, 0.24, 1.30, EC_PAINT_DARK);
  // Flat equipment deck: four generator hatches and louvred exhaust vents.
  b.box(-0.20, 0.735, 0, 2.30, 0.03, 1.32, EC_PAINT_DARK);
  for (const z of [-0.44, -0.15, 0.15, 0.44]) {
    b.box(-1.10, 0.77, z, 0.50, 0.05, 0.24, PALETTE.darkMetal);
  }
  b.box(-0.10, 0.76, 0, 1.10, 0.02, 1.30, EC_PAINT_LIGHT, TEAM);
  // Flank generator lockers: the widest boxes on the vehicle.
  for (const z of [-0.84, 0.84]) {
    b.box(0.10, 0.62, z, 2.10, 0.26, 0.14, EC_PAINT_LIGHT);
    for (let i = 0; i < 4; i++) {
      b.box(-0.70 + i * 0.42, 0.62, z * 1.06, 0.30, 0.16, 0.02, PALETTE.darkMetal);
    }
    b.box(0.92, 0.80, z * 1.03, 0.44, 0.12, 0.10, PALETTE.oliveDark);
  }
  // Outrigger pads: raised leg, foot pad and the brace.
  for (const z of [-0.80, 0.80]) {
    beam(b, [-1.48, 0.60, z], [-1.62, 0.16, z * 0.90], 0.14, 0.12, PALETTE.metal);
    b.box(-1.66, 0.09, z * 0.90, 0.34, 0.08, 0.44, PALETTE.metal);
    beam(b, [-1.30, 0.70, z * 0.94], [-1.52, 0.44, z * 0.90], 0.08, 0.08, PALETTE.darkMetal);
  }
  // Driver's station, vision blocks and the brush bar at the nose.
  b.box(1.12, 0.80, -0.34, 0.40, 0.14, 0.46, EC_PAINT_LIGHT);
  b.box(1.30, 0.82, -0.34, 0.03, 0.08, 0.30, PALETTE.glassDark);
  for (const z of [-0.20, 0.20, 0.50]) {
    b.box(1.30, 0.78, z, 0.03, 0.06, 0.10, PALETTE.glassDark);
  }
  b.box(1.84, 0.84, 0, 0.04, 0.04, 1.10, PALETTE.metal);
  for (const z of [-0.52, 0.52]) {
    b.box(1.86, 0.70, z, 0.10, 0.28, 0.03, PALETTE.metal);
  }
  // Rear steps, taillights and the vehicle aerial farm.
  b.box(-1.72, 0.56, 0, 0.10, 0.34, 1.30, EC_PAINT_DARK);
  for (const z of [-0.46, 0.46]) {
    b.box(-1.78, 0.80, z, 0.03, 0.10, 0.12, PALETTE.red);
    b.box(-1.78, 0.30, z, 0.16, 0.06, 0.34, PALETTE.metal);
  }
  for (const z of [-0.62, 0.62]) {
    b.box(-1.40, 1.22, z, 0.012, 0.94, 0.012, PALETTE.metal);
  }
  // Turret ring.
  b.cylinder(0, 0.75, 0, 0.62, 0.06, 16, EC_PAINT_DARK);
  return b.build();
}

/** Twin-cannon mount with a scanning radar dish and four ready-round canisters. */
function buildEcAaTurret(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, 0.03, 0, 0.56, 0.06, 14, EC_PAINT_DARK);
  b.box(0, 0.20, 0, 1.00, 0.28, 0.86, EC_PAINT);
  b.addQuad(
    [0.44, 0.08, -0.40],
    [0.44, 0.08, 0.40],
    [0.56, 0.32, 0.30],
    [0.56, 0.32, -0.30],
    EC_PAINT_LIGHT,
  );
  // Painted roof band: the mount's team surface.
  b.box(-0.04, 0.345, 0, 0.80, 0.03, 0.66, EC_PAINT_LIGHT, TEAM);
  // Twin autocannon, one each side of the mantlet, with flash hiders.
  for (const z of [-0.16, 0.16]) {
    b.cylinderX(1.10, 0.18, z, 0.042, 1.50, 7, PALETTE.darkMetal);
    b.cylinderX(1.90, 0.18, z, 0.058, 0.14, 7, EC_PAINT_DARK);
    b.box(0.62, 0.18, z, 0.24, 0.10, 0.08, PALETTE.metal);
  }
  // Radar: pedestal, tilted dish and its feed horn, plus the folding mast.
  b.cylinder(-0.36, 0.42, 0, 0.10, 0.32, 8, PALETTE.metal);
  b.addQuad(
    [-0.30, 0.58, -0.38],
    [-0.30, 0.58, 0.38],
    [-0.66, 0.86, 0.24],
    [-0.66, 0.86, -0.24],
    EC_PAINT_LIGHT,
  );
  b.addQuad(
    [-0.32, 0.55, -0.38],
    [-0.32, 0.55, 0.38],
    [-0.68, 0.83, 0.24],
    [-0.68, 0.83, -0.24],
    PALETTE.darkMetal,
  );
  b.box(-0.48, 0.72, 0, 0.10, 0.06, 0.10, PALETTE.glass);
  b.box(-0.36, 0.90, 0, 0.05, 0.16, 0.05, PALETTE.metal);
  // Four missile canisters, two per cheek, angled up slightly.
  for (const z of [-0.52, 0.52]) {
    for (const y of [0.18, 0.36]) {
      b.box(-0.10, y, z, 0.92, 0.15, 0.16, EC_PAINT);
      b.cylinderX(0.38, y, z, 0.062, 0.06, 9, PALETTE.darkMetal);
      b.box(0.34, y + 0.09, z, 0.94, 0.025, 0.14, EC_PAINT_DARK);
    }
  }
  // Gunner's sight head and the smoke discharger bank.
  b.box(0.20, 0.42, 0, 0.18, 0.14, 0.26, EC_PAINT_DARK);
  b.box(0.22, 0.44, 0.16, 0.10, 0.08, 0.02, PALETTE.glass);
  b.cylinder(-0.44, 0.30, 0.42, 0.09, 0.06, 8, PALETTE.hullDark);
  for (const z of [-0.40, 0.40]) {
    b.cylinderX(-0.02, 0.30, z, 0.024, 0.10, 4, PALETTE.darkMetal);
  }
  return b.build();
}

/**
 * 152 mm self-propelled howitzer. The fighting compartment sits behind the
 * engine, so the casemate overhangs the tail; a spade is dug in at the rear and
 * the fenders carry the ready ammunition.
 */
function buildEcSpgBody(): MeshBuffers {
  const b = new MeshBuilder();
  trackRun(b, {
    front: 2.10,
    rear: -2.00,
    halfTrack: 0.62,
    trackWidth: 0.30,
    wheelCount: 6,
    wheelRadius: 0.22,
    wheelWidth: 0.30,
  });
  b.box(0.10, 0.50, 0, 4.00, 0.36, 1.20, EC_PAINT_DARK);
  b.box(0.04, 0.73, 0, 3.90, 0.16, 1.30, EC_PAINT);
  // Engine deck forward, driver's cab, and the raised rear turntable deck.
  b.box(1.10, 0.83, 0, 1.60, 0.06, 1.22, EC_PAINT_DARK);
  for (let i = 0; i < 5; i++) {
    b.box(0.52 + i * 0.24, 0.865, 0, 0.10, 0.035, 1.06, PALETTE.darkMetal);
  }
  b.box(1.46, 0.96, -0.26, 0.60, 0.20, 0.62, EC_PAINT_LIGHT);
  b.box(1.74, 0.98, -0.26, 0.04, 0.12, 0.50, PALETTE.glassDark);
  b.box(1.74, 0.86, 0.26, 0.04, 0.10, 0.46, PALETTE.glassDark);
  b.addQuad(
    [2.02, 0.80, -0.62],
    [2.02, 0.80, 0.62],
    [2.24, 0.56, 0.50],
    [2.24, 0.56, -0.50],
    EC_PAINT_LIGHT,
  );
  b.box(2.12, 0.38, 0, 0.20, 0.26, 1.18, EC_PAINT_DARK);
  // Rear deck turntable and the overhanging casemate support rails.
  b.cylinder(-0.62, 0.84, 0, 0.76, 0.08, 16, EC_PAINT_DARK);
  for (const z of [-0.50, 0.50]) {
    b.box(-0.80, 0.80, z, 1.30, 0.06, 0.08, PALETTE.metal);
  }
  // Fenders: ready-round tubes and the wide team stripe.
  for (const z of [-0.74, 0.74]) {
    b.box(0.10, 0.80, z, 3.20, 0.05, 0.22, EC_PAINT_DARK);
    b.box(0.20, 0.87, z * 1.04, 1.10, 0.13, 0.10, PALETTE.oliveDark);
    b.box(-1.24, 0.87, z * 1.04, 0.60, 0.11, 0.09, PALETTE.canvas);
    b.box(0.18, 0.835, z * 1.11, 1.60, 0.035, 0.02, EC_PAINT_LIGHT, TEAM);
    b.box(-0.70, 0.84, z * 1.08, 0.40, 0.10, 0.08, PALETTE.metal);
  }
  // Rear spade dug in behind the hull, plus the outrigger feet.
  b.box(-2.02, 0.34, 0, 0.22, 0.50, 0.92, PALETTE.darkMetal);
  b.addQuad(
    [-2.12, 0.58, -0.46],
    [-2.12, 0.58, 0.46],
    [-2.44, 0.06, 0.52],
    [-2.44, 0.06, -0.52],
    PALETTE.metal,
  );
  for (const z of [-0.66, 0.66]) {
    b.box(-1.72, 0.26, z, 0.30, 0.20, 0.24, PALETTE.metal);
    b.box(-1.92, 0.76, z * 0.86, 0.03, 0.10, 0.12, PALETTE.red);
  }
  // Stowage bins, tow cable and the pioneer tools along the right fender.
  b.box(-0.40, 1.00, 0.80, 0.70, 0.20, 0.14, PALETTE.oliveDark);
  b.box(-0.40, 1.00, -0.80, 0.70, 0.20, 0.14, PALETTE.oliveDark);
  b.cylinderX(0.30, 0.96, 0.78, 0.05, 1.40, 6, PALETTE.metal);
  b.box(1.02, 0.94, -0.78, 0.60, 0.06, 0.06, PALETTE.darkMetal);
  return b.build();
}

/** Slab-sided casemate with the long 152 mm tube and its recoil cradle. */
function buildEcSpgTurret(): MeshBuffers {
  const b = new MeshBuilder();
  // Tall, square fighting compartment that overhangs the rear deck.
  b.box(-0.20, 0.32, 0, 1.90, 0.64, 1.36, EC_PAINT);
  b.box(-0.24, 0.66, 0, 1.74, 0.06, 1.24, EC_PAINT_LIGHT);
  b.box(-0.22, 0.695, 0, 1.30, 0.02, 0.98, EC_PAINT_LIGHT, TEAM);
  b.box(-0.20, 0.32, 0.685, 1.86, 0.56, 0.03, EC_PAINT_DARK);
  b.box(-0.20, 0.32, -0.685, 1.86, 0.56, 0.03, EC_PAINT_DARK);
  // Sloped front plate with the gun aperture.
  b.addQuad(
    [0.74, 0.02, -0.66],
    [0.74, 0.02, 0.66],
    [0.96, 0.58, 0.56],
    [0.96, 0.58, -0.56],
    EC_PAINT_LIGHT,
  );
  // 152 mm tube: cradle, thermal sleeve, and a double-baffle muzzle brake.
  b.box(1.02, 0.34, 0, 0.34, 0.30, 0.44, EC_PAINT_DARK);
  b.cylinderX(1.52, 0.34, 0, 0.055, 1.30, 8, PALETTE.darkMetal);
  b.cylinderX(1.44, 0.34, 0, 0.08, 0.70, 8, EC_PAINT_DARK);
  b.cylinderX(2.06, 0.34, 0, 0.085, 0.18, 8, PALETTE.darkMetal);
  b.box(2.14, 0.34, 0, 0.08, 0.20, 0.24, PALETTE.darkMetal);
  // Recoil cylinders above the tube and the panoramic sight on the roof.
  for (const z of [-0.13, 0.13]) {
    b.cylinderX(1.16, 0.52, z, 0.05, 1.10, 7, PALETTE.metal);
  }
  b.cylinder(-0.30, 0.74, 0.30, 0.14, 0.10, 10, EC_PAINT_DARK);
  b.box(-0.30, 0.80, 0.30, 0.16, 0.06, 0.16, PALETTE.metal);
  b.box(-0.38, 0.84, 0.30, 0.10, 0.10, 0.10, PALETTE.glassDark);
  // Commander's cupola, loader hatch and the rear access door.
  b.cylinder(-0.62, 0.74, -0.30, 0.17, 0.08, 10, EC_PAINT);
  b.cylinder(-0.62, 0.80, -0.30, 0.12, 0.03, 8, PALETTE.hullDark);
  b.box(-0.06, 0.70, 0.42, 0.26, 0.03, 0.26, PALETTE.hullDark);
  b.box(-1.16, 0.34, 0, 0.05, 0.54, 0.66, PALETTE.darkMetal);
  b.box(-1.19, 0.34, 0, 0.02, 0.44, 0.54, EC_PAINT_DARK);
  // Spent-case rack and the antenna.
  b.box(-0.90, 0.16, 0.60, 0.30, 0.24, 0.10, PALETTE.oliveDark);
  b.box(-1.06, 1.02, -0.52, 0.012, 0.66, 0.012, PALETTE.metal);
  return b.build();
}

/**
 * Wheeled MLRS: a long four-axle chassis with a cab-over front and a box rocket
 * pack on a rotating bed. Distinct from the tracked launcher and from the
 * three-axle SAM carrier by wheel count and a completely flat rear deck.
 */
function buildEcMlrsBody(): MeshBuffers {
  const b = new MeshBuilder();
  for (const x of [-1.62, -0.62, 0.52, 1.52]) axle(b, x, 0.70, 0.34, 0.30);
  // Ladder chassis and the flat rear launch deck.
  b.box(0, 0.50, 0, 4.30, 0.26, 1.20, EC_PAINT_DARK);
  b.box(-0.42, 0.70, 0, 3.40, 0.14, 1.28, EC_PAINT);
  b.box(-0.42, 0.78, 0, 3.20, 0.03, 1.16, EC_PAINT_DARK);
  // Cab-over front: full-width cab, split windscreen and a roof hatch.
  b.box(1.44, 1.00, 0, 0.96, 0.60, 1.20, EC_PAINT_LIGHT);
  b.box(1.93, 1.04, 0, 0.04, 0.36, 1.06, PALETTE.glassDark);
  b.box(1.95, 1.04, 0, 0.02, 0.28, 0.06, EC_PAINT_DARK);
  b.box(1.42, 1.32, 0, 0.70, 0.06, 1.26, EC_PAINT, TEAM);
  b.box(1.30, 1.36, 0, 0.28, 0.05, 0.34, PALETTE.hullDark);
  for (const z of [-0.54, 0.54]) {
    b.box(1.92, 0.92, z, 0.04, 0.16, 0.12, PALETTE.glassDark);
    b.box(1.96, 0.62, z * 1.10, 0.10, 0.22, 0.10, PALETTE.metal);
    b.box(1.90, 1.14, z, 0.03, 0.34, 0.03, PALETTE.metal);
    b.box(0.62, 0.86, z * 0.98, 0.90, 0.16, 0.10, PALETTE.oliveDark);
    b.box(-0.30, 0.88, z * 1.04, 1.10, 0.10, 0.06, EC_PAINT_LIGHT, TEAM);
    b.box(-1.40, 0.84, z * 1.06, 0.44, 0.14, 0.10, PALETTE.canvas);
  }
  // Rotating bed, its ring bearing and the stowed stabiliser jacks.
  b.cylinder(-0.90, 0.80, 0, 0.72, 0.10, 16, PALETTE.darkMetal);
  for (const z of [-0.72, 0.72]) {
    beam(b, [-1.86, 0.66, z], [-1.96, 0.18, z], 0.12, 0.12, PALETTE.metal);
    b.box(-1.98, 0.09, z, 0.36, 0.08, 0.36, PALETTE.metal);
  }
  // Rear plate, mud flaps and taillights.
  b.box(-2.14, 0.60, 0, 0.10, 0.36, 1.20, EC_PAINT_DARK);
  for (const z of [-0.46, 0.46]) {
    b.box(-2.18, 0.82, z, 0.03, 0.10, 0.12, PALETTE.red);
    b.box(-2.06, 0.30, z, 0.06, 0.30, 0.34, PALETTE.rubber);
  }
  // Crew step and the cable reel beside the cab.
  b.box(1.06, 0.44, -0.74, 0.34, 0.06, 0.16, PALETTE.darkMetal);
  b.cylinderZ(0.90, 0.80, 0.74, 0.14, 0.16, 10, PALETTE.oliveDark);
  return b.build();
}

/** Rotating rocket bed: four-by-two tube pack with a blast shield. */
function buildEcMlrsLauncher(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, 0.05, 0, 0.60, 0.10, 14, EC_PAINT_DARK);
  b.box(0.10, 0.14, 0, 1.50, 0.12, 1.20, PALETTE.metal);
  // Trunnion towers carrying the pack.
  for (const z of [-0.58, 0.58]) {
    b.box(-0.24, 0.34, z, 0.30, 0.36, 0.10, PALETTE.metal);
    b.cylinderZ(-0.24, 0.48, z, 0.07, 0.12, 8, PALETTE.darkMetal);
  }
  // The pack: eight cells in two rows, each with a visible mouth.
  for (let row = 0; row < 2; row++) {
    const y = 0.46 + row * 0.24;
    for (const z of [-0.42, -0.14, 0.14, 0.42]) {
      b.box(0.44, y, z, 1.42, 0.20, 0.24, EC_PAINT);
      b.cylinderX(1.14, y, z, 0.085, 0.06, 10, PALETTE.darkMetal);
      b.box(-0.28, y, z, 0.06, 0.18, 0.20, PALETTE.darkMetal);
    }
  }
  // Painted top deck with the team panel, and a blast shield at the rear.
  b.box(0.44, 0.72, 0, 1.40, 0.03, 1.10, EC_PAINT_LIGHT, TEAM);
  b.box(-0.36, 0.58, 0, 0.10, 0.46, 1.16, PALETTE.darkMetal);
  // Ladder and handrails on the near side, sight unit forward.
  b.box(0.30, 0.22, 0.64, 0.90, 0.04, 0.04, PALETTE.metal);
  for (const x of [0.02, 0.30, 0.58]) {
    b.box(x, 0.16, 0.64, 0.03, 0.16, 0.03, PALETTE.metal);
  }
  b.box(0.72, 0.62, -0.34, 0.18, 0.14, 0.20, PALETTE.glassDark);
  b.box(0.74, 0.64, -0.45, 0.11, 0.08, 0.02, PALETTE.glass);
  b.box(-0.52, 0.30, 0.50, 0.24, 0.16, 0.10, PALETTE.oliveDark);
  return b.build();
}

export const ALLIANCE_GROUND_STYLES: Record<string, EntityStyle> = {
  tankEC: {
    body: buildEcTankBody(),
    turret: buildEcTankTurret(),
    turretOffset: [0, 0.72, 0],
  },
  ifvEC: {
    body: buildEcIfvBody(),
    turret: buildEcIfvTurret(),
    turretOffset: [0.06, 0.64, 0],
  },
  tdEC: {
    body: buildEcTdBody(),
    turret: buildEcTdLauncher(),
    turretOffset: [0.02, 0.78, 0],
  },
  reconEC: {
    body: buildEcReconBody(),
    turret: buildEcReconTurret(),
    // The cupola ring sits on the cabin roof at 1.07, not on the hull deck.
    turretOffset: [0.36, 1.03, 0],
  },
  aaEC: {
    body: buildEcAaBody(),
    turret: buildEcAaTurret(),
    turretOffset: [0, 0.74, 0],
  },
  spgEC: {
    body: buildEcSpgBody(),
    turret: buildEcSpgTurret(),
    turretOffset: [-0.34, 0.80, 0],
  },
  rocketArtilleryEC: {
    body: buildEcMlrsBody(),
    turret: buildEcMlrsLauncher(),
    turretOffset: [-0.90, 0.82, 0],
  },
};
