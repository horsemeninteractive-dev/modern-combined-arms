import { MeshBuilder, PALETTE, shade, type Color } from '../geometry';
import type { MeshBuffers } from '../gl';
import { beam } from '../meshKit';
import type { EntityStyle } from '../unitMeshes';

/**
 * National-exclusive silhouettes.
 *
 * Six units used to borrow a canonical family mesh (`spg`, `ifv`, `aa`, `td`,
 * `atgm`), so a K9, a Koksan and a baseline SPG all rendered as the same
 * vehicle. Each model here is authored against its real-world inspiration and
 * differs from its old donor in running gear, hull proportions, turret shape
 * and weapon fit, which is what lets a player name the nation at battle zoom
 * without reading the card.
 *
 * Conventions follow `unitMeshes`: the origin is the hull centre on the ground,
 * +X is forward, world units are ~2 m, and the turret mesh is authored around
 * its own ring so `turretOffset` places it on the hull.
 */

/* National paint schemes. Kept close enough to the shared palette that a
 * nation's fleet still belongs to the same army, but separate enough that the
 * six silhouettes do not read as a single recoloured family. */
const K9_GREEN: Color = [0.31, 0.35, 0.27];
const K9_LIGHT: Color = [0.39, 0.43, 0.33];
const CV_DARK: Color = [0.23, 0.28, 0.22];
const CV_GREEN: Color = [0.29, 0.35, 0.26];
const IRAN_SAND: Color = [0.52, 0.47, 0.35];
const IRAN_LIGHT: Color = [0.61, 0.56, 0.42];
const IRAN_TRIM: Color = [0.24, 0.22, 0.17];
const KOKSAN_OLIVE: Color = [0.25, 0.28, 0.20];
const KOKSAN_DARK: Color = [0.17, 0.19, 0.14];
const BULSAE_OLIVE: Color = [0.27, 0.30, 0.22];
const BULSAE_DARK: Color = [0.19, 0.21, 0.16];
const SPIKE_UNIFORM: Color = [0.44, 0.42, 0.31];
const SPIKE_HELMET: Color = [0.50, 0.48, 0.36];

interface TrackOptions {
  front: number;
  rear: number;
  halfTrack: number;
  trackWidth: number;
  wheelCount: number;
  wheelRadius: number;
  wheelWidth: number;
  /** Height of the hull fender above the ground. */
  fender: number;
}

/**
 * Tracked running gear for the national hulls: separate lower and return
 * belts, road wheels on swing arms, a front sprocket and a rear idler. The
 * wheels are solid discs with a hub step so the wheel count stays readable —
 * six on the K9, seven on the CV90, five on the small Bulsae chassis.
 */
function addTrackedGear(b: MeshBuilder, o: TrackOptions): void {
  const length = o.front - o.rear;
  const mid = (o.front + o.rear) / 2;
  for (const side of [-1, 1]) {
    const z = o.halfTrack * side;
    b.box(mid, 0.16, z, length, 0.24, o.trackWidth, PALETTE.track);
    b.box(mid, 0.60, z, length, 0.11, o.trackWidth, PALETTE.track);
    // Track shoes on the return run: small plates, so the belt is not a slab.
    for (let i = 0; i < 11; i++) {
      const x = o.rear + 0.20 + (i * (length - 0.40)) / 10;
      b.box(x, 0.665, z, 0.13, 0.04, o.trackWidth + 0.012, PALETTE.darkMetal);
    }
    for (let i = 0; i < o.wheelCount; i++) {
      const t = o.wheelCount === 1 ? 0.5 : i / (o.wheelCount - 1);
      const x = o.rear + 0.46 + (length - 0.92) * t;
      b.box(x, 0.34, z * 0.74, 0.11, 0.09, 0.13, PALETTE.metal);
      b.cylinderZ(x, o.wheelRadius, z, o.wheelRadius, o.wheelWidth, 12, PALETTE.darkMetal);
      b.cylinderZ(x, o.wheelRadius, z, o.wheelRadius * 0.42, o.wheelWidth + 0.02, 9, PALETTE.metal);
      b.cylinderZ(x, o.wheelRadius, z, o.wheelRadius * 0.16, o.wheelWidth + 0.04, 7, PALETTE.track);
    }
    b.cylinderZ(o.front - 0.40, 0.22, z, 0.25, o.trackWidth + 0.02, 10, PALETTE.track);
    b.cylinderZ(o.front - 0.40, 0.22, z, 0.10, o.trackWidth + 0.04, 8, PALETTE.darkMetal);
    b.cylinderZ(o.rear + 0.18, 0.22, z, 0.23, o.trackWidth + 0.02, 10, PALETTE.track);
    b.cylinderZ(o.rear + 0.18, 0.22, z, 0.09, o.trackWidth + 0.04, 8, PALETTE.darkMetal);
    b.box(mid, o.fender, z * 1.06, length, 0.06, 0.34, PALETTE.hullDark);
  }
}

/** A road wheel for the wheeled launcher, with a visible hub. */
function addWheel(b: MeshBuilder, x: number, z: number, radius: number, width: number): void {
  b.cylinderZ(x, radius, z, radius, width, 13, PALETTE.rubber);
  b.cylinderZ(x, radius, z, radius * 0.44, width + 0.02, 10, PALETTE.metal);
  b.cylinderZ(x, radius, z, radius * 0.17, width + 0.05, 8, PALETTE.darkMetal);
}

/* ------------------------------------------------------------------ */
/* K9 Thunder — South Korean 155 mm self-propelled howitzer           */
/* ------------------------------------------------------------------ */

/**
 * Large welded turret with a long-barrelled 155 mm gun, a rear ammunition
 * bustle and a two-man roof. The donor SPG is a slab-sided casemate with a
 * muzzle brake sitting low on the glacis; this is a taller, turreted vehicle
 * with a six-wheel suspension and a hydraulic spade folded at the stern.
 */
function buildK9Body(): MeshBuffers {
  const b = new MeshBuilder();
  addTrackedGear(b, {
    front: 2.30,
    rear: -2.28,
    halfTrack: 0.62,
    trackWidth: 0.30,
    wheelCount: 6,
    wheelRadius: 0.215,
    wheelWidth: 0.28,
    fender: 0.74,
  });
  // Lower hull and the wide, flat fighting deck.
  b.box(0, 0.50, 0, 4.06, 0.34, 1.16, PALETTE.hullDark);
  b.box(0.06, 0.72, 0, 3.92, 0.16, 1.30, K9_GREEN);
  b.box(0.10, 0.82, 0, 3.60, 0.05, 1.22, K9_LIGHT);
  // Sloped glacis with the driver's plate set to the left of centre.
  b.addQuad(
    [1.92, 0.80, -0.64],
    [1.92, 0.80, 0.64],
    [2.18, 0.58, 0.56],
    [2.18, 0.58, -0.56],
    K9_GREEN,
  );
  b.box(2.02, 0.44, 0, 0.30, 0.24, 1.16, PALETTE.hullDark);
  b.box(1.62, 0.92, 0.30, 0.44, 0.20, 0.52, K9_LIGHT);
  b.box(1.84, 0.95, 0.30, 0.035, 0.12, 0.44, PALETTE.glassDark);
  for (const z of [0.18, 0.42]) b.box(1.85, 0.98, z, 0.03, 0.07, 0.10, PALETTE.glass);
  // Engine deck grilles behind the driver, with lift handles.
  for (let i = 0; i < 5; i++) {
    b.box(1.20 - i * 0.14, 0.855, -0.28, 0.07, 0.03, 0.60, PALETTE.darkMetal);
  }
  b.box(1.24, 0.87, -0.28, 0.66, 0.02, 0.66, PALETTE.hull, 0.6);
  // Headlights, brush guard and towing eyes.
  for (const z of [-0.44, 0.44]) {
    b.box(2.10, 0.66, z, 0.10, 0.14, 0.16, PALETTE.glassDark);
    b.box(2.10, 0.66, z * 1.06, 0.06, 0.16, 0.20, PALETTE.metal);
    b.box(2.24, 0.50, z * 0.86, 0.12, 0.10, 0.10, PALETTE.metal);
  }
  // Flank: fender bins, a tow cable and the team band.
  for (const z of [-0.655, 0.655]) {
    b.box(-0.05, 0.635, z, 3.30, 0.035, 0.02, K9_LIGHT, 0.86);
    b.box(0.30, 0.70, z * 1.02, 0.86, 0.18, 0.05, PALETTE.oliveDark);
    b.box(-1.02, 0.70, z * 1.02, 0.56, 0.14, 0.05, PALETTE.canvas);
    b.box(-0.42, 0.60, z * 1.05, 1.30, 0.035, 0.035, PALETTE.metal);
  }
  // Rear engine access, exhaust and the folded hydraulic spade.
  b.box(-1.98, 0.66, 0, 0.10, 0.44, 1.12, PALETTE.hullDark);
  b.box(-2.05, 0.44, 0.30, 0.16, 0.22, 0.20, PALETTE.darkMetal);
  beam(b, [-1.98, 0.36, -0.44], [-2.42, 0.20, -0.36], 0.14, 0.12, PALETTE.metal);
  beam(b, [-1.98, 0.36, 0.44], [-2.42, 0.20, 0.36], 0.14, 0.12, PALETTE.metal);
  b.box(-2.52, 0.13, 0, 0.20, 0.22, 1.28, PALETTE.metal);
  b.box(-2.60, 0.06, 0, 0.10, 0.10, 1.20, PALETTE.darkMetal);
  for (const z of [-0.42, 0.42]) b.box(-2.02, 0.78, z, 0.03, 0.08, 0.10, PALETTE.red);
  // Turret ring.
  b.cylinder(-0.14, 0.86, 0, 0.80, 0.10, 18, PALETTE.hullDark);
  b.cylinder(-0.14, 0.90, 0, 0.72, 0.04, 18, K9_GREEN);
  return b.build();
}

function buildK9Turret(): MeshBuffers {
  const b = new MeshBuilder();
  const y0 = 0;
  const y1 = 0.56;
  const y2 = 0.92;
  // Faceted welded body: narrow at the ring, widest at the bustle.
  const b0: [number, number, number] = [-1.16, y0, -0.58];
  const b1: [number, number, number] = [0.78, y0, -0.50];
  const b2: [number, number, number] = [0.78, y0, 0.50];
  const b3: [number, number, number] = [-1.16, y0, 0.58];
  const m0: [number, number, number] = [-1.32, y1, -0.70];
  const m1: [number, number, number] = [0.94, y1, -0.62];
  const m2: [number, number, number] = [0.94, y1, 0.62];
  const m3: [number, number, number] = [-1.32, y1, 0.70];
  const t0: [number, number, number] = [-1.24, y2, -0.62];
  const t1: [number, number, number] = [0.78, y2, -0.54];
  const t2: [number, number, number] = [0.78, y2, 0.54];
  const t3: [number, number, number] = [-1.24, y2, 0.62];
  b.addQuad(b3, b2, m2, m3, K9_GREEN);
  b.addQuad(b0, m0, m1, b1, K9_GREEN);
  b.addQuad(m3, m2, t2, t3, shade(K9_GREEN, 0.96));
  b.addQuad(m0, t0, t1, m1, shade(K9_GREEN, 0.96));
  b.addQuad(t0, t3, t2, t1, K9_LIGHT);
  b.addQuad(b0, b3, m3, m0, PALETTE.hullDark);
  // Rear ammunition bustle carrying the ready rounds.
  b.box(-1.30, 0.42, 0, 0.62, 0.60, 1.24, K9_GREEN);
  b.box(-1.36, 0.72, 0, 0.50, 0.06, 1.10, K9_LIGHT);
  for (const z of [-0.40, -0.16, 0.16, 0.40]) {
    b.box(-1.62, 0.46, z, 0.06, 0.44, 0.20, PALETTE.oliveDark);
  }
  // Mantlet and the 155 mm tube with its bore evacuator and muzzle brake. The
  // assembly lands the tube tip on the authored 2.40 muzzle reach at the
  // authored 1.35 height once the turret mount is applied.
  b.addQuad([0.78, y0, -0.50], [0.94, y1, -0.62], [0.94, y1, 0.62], [0.78, y0, 0.50], K9_GREEN);
  b.box(0.72, 0.36, 0, 0.48, 0.50, 0.86, PALETTE.hullDark);
  b.cylinderX(1.52, 0.41, 0, 0.085, 1.90, 8, PALETTE.darkMetal);
  b.cylinderX(1.22, 0.41, 0, 0.135, 0.32, 8, K9_GREEN);
  b.cylinderX(2.40, 0.41, 0, 0.125, 0.22, 8, PALETTE.hullDark);
  for (const x of [2.32, 2.48]) b.cylinderX(x, 0.41, 0, 0.152, 0.05, 8, PALETTE.track);
  b.cylinderX(2.52, 0.41, 0, 0.075, 0.03, 8, PALETTE.track);
  // Recoil slides above the tube and the gunner's sight on the left cheek.
  for (const z of [-0.16, 0.16]) b.cylinderX(0.95, 0.63, z, 0.05, 0.90, 7, PALETTE.metal);
  b.box(0.34, 0.80, -0.34, 0.30, 0.16, 0.26, PALETTE.hullDark);
  b.box(0.34, 0.875, -0.34, 0.20, 0.04, 0.16, PALETTE.glassDark);
  // Commander's cupola with a machine gun, loader's hatch and periscopes.
  b.cylinder(-0.56, 0.98, 0.28, 0.18, 0.10, 12, K9_GREEN);
  b.cylinder(-0.56, 1.06, 0.28, 0.13, 0.05, 12, K9_LIGHT);
  b.box(-0.44, 1.10, 0.28, 0.30, 0.05, 0.08, PALETTE.darkMetal);
  b.cylinderX(-0.30, 1.10, 0.28, 0.022, 0.44, 6, PALETTE.darkMetal);
  b.cylinder(-0.30, 1.00, 0.28, 0.05, 0.16, 8, PALETTE.metal);
  b.cylinder(-0.62, 0.96, -0.30, 0.15, 0.06, 12, PALETTE.hullDark);
  for (const z of [-0.34, 0.34]) b.box(-0.94, 0.96, z, 0.12, 0.05, 0.07, PALETTE.glassDark);
  // Roof team surface, smoke dischargers and the antenna.
  b.box(-0.20, 0.945, 0, 1.30, 0.02, 0.78, K9_GREEN, 0.9);
  for (const z of [-0.54, 0.54]) {
    for (const x of [0.44, 0.58]) b.cylinderX(x, 0.66, z, 0.035, 0.14, 5, PALETTE.darkMetal);
    b.box(-0.20, 0.44, z * 1.24, 0.86, 0.24, 0.02, K9_GREEN, 0.84);
  }
  b.box(-1.06, 0.92, 0.42, 0.014, 0.40, 0.014, PALETTE.metal);
  b.box(-0.86, 0.80, -0.42, 0.30, 0.18, 0.20, PALETTE.canvas);
  return b.build();
}

/* ------------------------------------------------------------------ */
/* CV90 — Swedish/Norwegian tracked IFV with a 40 mm cannon           */
/* ------------------------------------------------------------------ */

/**
 * Low wedge-nosed hull with seven road wheels, side stowage bins and a rear
 * troop door, topped by a compact two-man turret and a very long, slim 40 mm
 * cannon. The donor IFV is a tall SPG hull with a scout's 25 mm turret; this
 * one is flatter, pointed and unmistakably a troop carrier.
 */
function buildCv90Body(): MeshBuffers {
  const b = new MeshBuilder();
  addTrackedGear(b, {
    front: 2.26,
    rear: -2.16,
    halfTrack: 0.56,
    trackWidth: 0.28,
    wheelCount: 7,
    wheelRadius: 0.19,
    wheelWidth: 0.26,
    fender: 0.66,
  });
  // Low hull: a flat floor pan with a wedge bow that meets at a centre ridge.
  b.box(0, 0.42, 0, 4.00, 0.28, 1.02, CV_DARK);
  b.box(0.04, 0.62, 0, 3.80, 0.16, 1.16, CV_GREEN);
  b.addQuad([1.90, 0.70, -0.58], [1.90, 0.70, 0.58], [2.24, 0.30, 0.30], [2.24, 0.30, -0.30], CV_GREEN);
  b.addQuad([1.90, 0.70, 0.00], [1.90, 0.70, 0.58], [2.24, 0.30, 0.30], [2.24, 0.30, 0.00], shade(CV_GREEN, 0.92));
  b.addQuad([1.90, 0.70, 0.00], [1.90, 0.70, -0.58], [2.24, 0.30, -0.30], [2.24, 0.30, 0.00], shade(CV_GREEN, 0.86));
  b.box(2.10, 0.42, 0, 0.30, 0.22, 0.96, CV_DARK);
  // Driver's hatch and periscopes on the left of the bow.
  b.box(1.50, 0.76, -0.30, 0.46, 0.14, 0.48, CV_GREEN);
  b.box(1.52, 0.815, -0.30, 0.30, 0.03, 0.34, CV_DARK);
  for (const z of [-0.44, -0.16]) b.box(1.72, 0.72, z, 0.03, 0.08, 0.12, PALETTE.glass);
  // Engine deck and cooling louvres on the right of the bow.
  for (let i = 0; i < 4; i++) {
    b.box(1.44 - i * 0.12, 0.705, 0.32, 0.06, 0.02, 0.44, PALETTE.darkMetal);
  }
  // Side stowage bins along the sponsons: the CV90's most recognisable flank.
  for (const z of [-0.60, 0.60]) {
    b.box(-0.10, 0.70, z, 2.30, 0.16, 0.06, CV_DARK);
    for (const x of [-1.02, -0.42, 0.18, 0.78]) {
      b.box(x, 0.70, z * 1.04, 0.50, 0.13, 0.03, shade(CV_GREEN, 0.98));
    }
    b.box(0.10, 0.60, z * 1.07, 2.00, 0.03, 0.02, CV_GREEN, 0.86);
  }
  // Rear troop door with a hinge line, handle and a step.
  b.box(-1.94, 0.60, 0, 0.08, 0.54, 1.02, CV_DARK);
  b.box(-1.99, 0.62, 0, 0.04, 0.42, 0.68, shade(CV_GREEN, 0.94));
  b.box(-2.02, 0.66, 0.24, 0.03, 0.10, 0.10, PALETTE.metal);
  b.box(-2.00, 0.32, 0, 0.16, 0.06, 0.72, PALETTE.darkMetal);
  // Roof hatches, exhaust and the towing pintle.
  b.box(-0.66, 0.755, 0.30, 0.46, 0.05, 0.40, CV_GREEN);
  b.box(-1.42, 0.74, -0.28, 0.16, 0.14, 0.22, PALETTE.darkMetal);
  b.box(-2.06, 0.28, 0, 0.14, 0.12, 0.24, PALETTE.metal);
  // Headlight clusters and brush bar.
  for (const z of [-0.36, 0.36]) {
    b.box(2.16, 0.52, z, 0.10, 0.12, 0.16, PALETTE.glassDark);
    b.box(2.16, 0.52, z * 1.08, 0.05, 0.14, 0.18, PALETTE.metal);
  }
  b.box(2.20, 0.42, 0, 0.04, 0.04, 0.92, PALETTE.metal);
  // Turret ring, low on the hull.
  b.cylinder(0.24, 0.70, 0, 0.58, 0.06, 16, PALETTE.hullDark);
  return b.build();
}

function buildCv90Turret(): MeshBuffers {
  const b = new MeshBuilder();
  // Compact, faceted two-man turret; much narrower than the SPG casemate.
  b.cylinder(0, -0.05, 0, 0.44, 0.10, 14, PALETTE.hullDark);
  b.box(-0.04, 0.20, 0, 0.94, 0.32, 0.78, CV_GREEN);
  b.addQuad([-0.50, 0.36, -0.39], [0.44, 0.36, -0.39], [0.38, 0.60, -0.32], [-0.44, 0.60, -0.32], CV_GREEN);
  b.addQuad([-0.50, 0.36, 0.39], [-0.44, 0.60, 0.32], [0.38, 0.60, 0.32], [0.44, 0.36, 0.39], CV_GREEN);
  b.box(-0.04, 0.62, 0, 0.84, 0.04, 0.62, CV_DARK);
  // Sloped front plate with the trunnion and the 40 mm cannon.
  b.addQuad([0.44, 0.04, -0.39], [0.44, 0.04, 0.39], [0.40, 0.36, 0.34], [0.40, 0.36, -0.34], CV_GREEN);
  b.box(0.32, 0.30, 0, 0.34, 0.20, 0.30, PALETTE.metal);
  b.cylinderX(1.06, 0.36, 0, 0.042, 1.24, 7, PALETTE.darkMetal);
  b.cylinderX(0.68, 0.36, 0, 0.070, 0.40, 8, CV_DARK);
  b.cylinderX(1.71, 0.36, 0, 0.055, 0.10, 7, PALETTE.hullDark);
  // Coaxial machine gun in its own small port.
  b.cylinderX(0.54, 0.26, 0.24, 0.020, 0.30, 5, PALETTE.darkMetal);
  // Commander's independent sight, loader's hatch and roof periscopes.
  b.box(-0.16, 0.74, -0.18, 0.26, 0.20, 0.24, PALETTE.hullDark);
  b.box(-0.16, 0.80, -0.30, 0.16, 0.10, 0.03, PALETTE.glass);
  b.cylinder(-0.18, 0.68, 0.22, 0.13, 0.08, 12, CV_GREEN);
  b.cylinder(-0.18, 0.73, 0.22, 0.09, 0.04, 12, CV_DARK);
  b.box(0.12, 0.655, 0.24, 0.30, 0.02, 0.06, PALETTE.glassDark);
  // Roof team band, smoke dischargers and the antenna base.
  b.box(-0.06, 0.645, 0, 0.68, 0.02, 0.44, CV_GREEN, 0.9);
  for (const z of [-0.34, 0.34]) {
    for (const x of [-0.30, -0.18]) b.cylinderX(x, 0.46, z, 0.028, 0.10, 5, PALETTE.darkMetal);
    b.box(-0.04, 0.22, z * 1.03, 0.50, 0.18, 0.02, CV_GREEN, 0.86);
  }
  b.box(-0.40, 0.60, 0.30, 0.012, 0.30, 0.012, PALETTE.metal);
  return b.build();
}

/* ------------------------------------------------------------------ */
/* Khordad — Iranian 6x6 wheeled SAM launcher                         */
/* ------------------------------------------------------------------ */

/**
 * A truck, not a tracked SPAA: three axles, a cab-over front body, a raised
 * boxed canister pack on a rear pedestal, four stabiliser jacks and a search
 * radar on the cab roof. The donor AA is a tracked-style 6x6 with a flat
 * four-tube pack lying along the deck; this launcher tilts its pack up and
 * carries its radar high, which is the silhouette cue.
 */
function buildKhordadBody(): MeshBuffers {
  const b = new MeshBuilder();
  for (const x of [-1.52, 0.06, 1.52]) {
    for (const z of [-0.64, 0.64]) addWheel(b, x, z, 0.37, 0.30);
    for (const z of [-0.64, 0.64]) {
      b.box(x, 0.79, z * 1.03, 0.90, 0.06, 0.38, PALETTE.hullDark);
    }
  }
  // Ladder chassis rails, then the flat cargo deck.
  for (const z of [-0.42, 0.42]) b.box(-0.10, 0.48, z, 3.90, 0.22, 0.16, PALETTE.hullDark);
  b.box(-0.10, 0.62, 0, 3.86, 0.10, 1.20, IRAN_SAND);
  b.box(-0.34, 0.72, 0, 2.30, 0.16, 1.26, IRAN_LIGHT);
  // Cab-over front body with a flat two-piece screen and roof hatch. The cab is
  // deliberately low: the launch pack rides above it, which is the whole point
  // of the silhouette and the reason this reads as a truck and not an SPAA.
  b.box(1.36, 0.96, 0, 1.02, 0.60, 1.26, IRAN_SAND);
  b.box(1.30, 1.26, 0, 1.12, 0.06, 1.32, IRAN_LIGHT);
  b.box(1.86, 0.98, 0, 0.04, 0.34, 1.08, PALETTE.glassDark);
  b.box(1.88, 0.98, 0, 0.02, 0.26, 0.94, PALETTE.glass);
  for (const z of [-0.62, 0.62]) {
    b.box(1.36, 0.94, z, 0.82, 0.30, 0.03, PALETTE.glassDark);
    b.box(1.36, 0.94, z * 1.03, 0.84, 0.24, 0.02, IRAN_SAND, 0.84);
    b.box(1.52, 0.68, z * 1.10, 0.14, 0.14, 0.14, PALETTE.metal);
    b.box(1.90, 0.60, z * 1.05, 0.10, 0.14, 0.16, PALETTE.glassDark);
    b.box(0.98, 1.16, z * 1.06, 0.03, 0.24, 0.03, PALETTE.metal);
  }
  b.box(1.18, 1.29, 0, 0.30, 0.05, 0.34, PALETTE.hullDark);
  b.box(0.98, 1.26, 0, 0.03, 0.03, 1.12, PALETTE.metal);
  // Crew door on each side of the cab with a step and grab handle.
  for (const z of [-0.645, 0.645]) {
    b.box(1.10, 1.00, z, 0.52, 0.50, 0.02, IRAN_SAND, 0.7);
    b.box(1.04, 0.62, z * 1.08, 0.42, 0.05, 0.14, PALETTE.darkMetal);
    b.box(0.86, 1.08, z * 1.02, 0.03, 0.24, 0.03, PALETTE.darkMetal);
  }
  // Search radar: mast over the cab with a tilted planar array.
  beam(b, [0.86, 1.30, 0], [0.86, 1.72, 0], 0.08, 0.08, PALETTE.metal);
  b.box(0.86, 1.76, 0, 0.14, 0.10, 0.14, PALETTE.darkMetal);
  b.addQuad([0.90, 1.80, -0.30], [0.90, 1.80, 0.30], [0.72, 2.06, 0.26], [0.72, 2.06, -0.26], PALETTE.darkMetal);
  b.box(0.81, 1.93, 0, 0.02, 0.22, 0.50, PALETTE.glassDark);
  b.box(0.90, 1.92, 0, 0.04, 0.26, 0.58, IRAN_LIGHT);
  // Rear deck rails and the four stabiliser jacks.
  for (const z of [-0.56, 0.56]) b.box(-1.44, 0.82, z, 2.00, 0.05, 0.06, PALETTE.metal);
  for (const x of [-1.72, 0.42]) {
    for (const z of [-0.58, 0.58]) {
      beam(b, [x, 0.78, z * 1.10], [x, 0.10, z * 1.32], 0.09, 0.09, PALETTE.metal);
      b.box(x, 0.05, z * 1.34, 0.22, 0.08, 0.22, PALETTE.darkMetal);
    }
  }
  // Rear step, lights and the deck team band.
  b.box(-2.02, 0.44, 0, 0.10, 0.34, 1.10, PALETTE.hullDark);
  b.box(-2.10, 0.24, 0, 0.20, 0.06, 0.86, PALETTE.metal);
  for (const z of [-0.44, 0.44]) b.box(-2.06, 0.66, z, 0.03, 0.10, 0.12, PALETTE.red);
  for (const z of [-0.615, 0.615]) b.box(-1.20, 0.735, z, 1.70, 0.03, 0.02, IRAN_LIGHT, 0.86);
  // Launcher pedestal base, mounted on the rear deck.
  b.cylinder(-0.86, 0.80, 0, 0.34, 0.10, 14, PALETTE.darkMetal);
  return b.build();
}

function buildKhordadLauncher(): MeshBuffers {
  const b = new MeshBuilder();
  // The whole pack sits on a pedestal and elevates; the pedestal reaches just
  // under the truck bed instead of hanging through the chassis.
  b.cylinder(0, -0.13, 0, 0.26, 0.20, 12, PALETTE.darkMetal);
  b.cylinder(0, -0.04, 0, 0.38, 0.08, 14, IRAN_SAND);
  b.box(0.00, 0.20, 0, 0.78, 0.46, 0.96, IRAN_TRIM);
  // Two trunnion ears either side of the pack.
  for (const z of [-0.54, 0.54]) {
    b.box(-0.04, 0.42, z, 0.28, 0.36, 0.08, PALETTE.metal);
    b.cylinderZ(-0.04, 0.50, z * 1.06, 0.07, 0.10, 8, PALETTE.darkMetal);
  }
  // Four boxed canisters in one raised pack. The pack rides above the cab roof
  // and reaches forward over it, which is what makes this launcher readable at
  // battle zoom: a long box over the cab, not the donor's flat deck of tubes.
  const cells: Array<[number, number]> = [
    [-0.38, -0.13],
    [-0.13, -0.13],
    [-0.38, 0.13],
    [-0.13, 0.13],
  ];
  for (const [z, lift] of cells) {
    beam(b, [-0.72, 0.52 + lift, z], [2.30, 0.62 + lift, z], 0.26, 0.24, IRAN_SAND);
    // Muzzle cap and the rear blast ring of each cell.
    b.box(2.36, 0.62 + lift, z, 0.06, 0.24, 0.26, PALETTE.darkMetal);
    b.box(-0.76, 0.52 + lift, z, 0.06, 0.22, 0.24, PALETTE.warning);
  }
  // Cradle spine and elevation ram holding the pack up off the deck.
  beam(b, [-0.60, 0.36, 0], [1.10, 0.48, 0], 0.36, 0.12, IRAN_LIGHT);
  beam(b, [-0.16, 0.10, 0.34], [0.60, 0.40, 0.34], 0.08, 0.08, PALETTE.metal);
  // A painted retention band across the pack, plus the sight head and aerial.
  beam(b, [0.58, 0.62, -0.60], [0.58, 0.86, 0.60], 0.18, 0.02, IRAN_SAND, 0.88);
  b.box(1.36, 0.88, 0.42, 0.22, 0.16, 0.20, IRAN_TRIM);
  b.box(1.36, 0.92, 0.53, 0.14, 0.08, 0.03, PALETTE.glass);
  b.box(-0.56, 0.86, -0.36, 0.012, 0.34, 0.012, PALETTE.metal);
  return b.build();
}

/* ------------------------------------------------------------------ */
/* Koksan — North Korean 170 mm self-propelled gun                    */
/* ------------------------------------------------------------------ */

/**
 * A very long chassis carrying a 170 mm gun that overhangs the bow, with an
 * open-topped gun shield and no turret bustle. The donor SPG has a short,
 * enclosed casemate; this vehicle's gun reaches far past the nose and its
 * fighting compartment is open, which is the giveaway at any zoom.
 */
function buildKoksanBody(): MeshBuffers {
  const b = new MeshBuilder();
  addTrackedGear(b, {
    front: 2.52,
    rear: -2.46,
    halfTrack: 0.64,
    trackWidth: 0.30,
    wheelCount: 6,
    wheelRadius: 0.22,
    wheelWidth: 0.28,
    fender: 0.72,
  });
  // Long, low hull with a full-width engine deck forward.
  b.box(0, 0.48, 0, 4.70, 0.30, 1.20, KOKSAN_DARK);
  b.box(0.10, 0.68, 0, 4.40, 0.14, 1.34, KOKSAN_OLIVE);
  b.box(0.20, 0.76, 0, 3.90, 0.04, 1.26, shade(KOKSAN_OLIVE, 1.06));
  b.addQuad([2.24, 0.74, -0.66], [2.24, 0.74, 0.66], [2.52, 0.52, 0.56], [2.52, 0.52, -0.56], KOKSAN_OLIVE);
  // Engine louvres and a raised driver's hood on the left.
  for (let i = 0; i < 5; i++) b.box(1.90 - i * 0.13, 0.785, 0.30, 0.06, 0.02, 0.50, PALETTE.darkMetal);
  b.box(1.74, 0.90, -0.28, 0.50, 0.20, 0.56, shade(KOKSAN_OLIVE, 0.92));
  b.box(1.96, 0.93, -0.28, 0.035, 0.12, 0.46, PALETTE.glassDark);
  for (const z of [-0.44, -0.14]) b.box(1.97, 0.96, z, 0.03, 0.07, 0.10, PALETTE.glass);
  // Flank stowage, spare track links and the team band.
  for (const z of [-0.685, 0.685]) {
    b.box(0.10, 0.62, z, 3.90, 0.03, 0.02, KOKSAN_OLIVE, 0.86);
    for (let i = 0; i < 4; i++) {
      b.box(1.10 - i * 0.34, 0.70, z * 1.02, 0.28, 0.12, 0.05, PALETTE.darkMetal);
    }
    b.box(-1.30, 0.72, z * 1.02, 1.10, 0.16, 0.05, PALETTE.canvas);
    b.box(-1.36, 0.86, z * 1.04, 0.86, 0.05, 0.06, PALETTE.oliveDark);
  }
  // Rear plate, exhaust stack, lights and a recoil spade.
  b.box(-2.14, 0.62, 0, 0.10, 0.40, 1.14, PALETTE.hullDark);
  b.box(-2.20, 0.96, 0.40, 0.16, 0.42, 0.18, PALETTE.darkMetal);
  b.box(-2.20, 1.16, 0.40, 0.20, 0.05, 0.22, PALETTE.track);
  for (const z of [-0.44, 0.44]) b.box(-2.18, 0.76, z, 0.03, 0.09, 0.11, PALETTE.red);
  beam(b, [-2.14, 0.30, 0], [-2.56, 0.16, 0], 0.24, 0.16, PALETTE.metal);
  b.box(-2.66, 0.10, 0, 0.18, 0.18, 1.10, PALETTE.metal);
  // Open gun mount: a ring on the rear deck, no enclosed casemate.
  b.cylinder(-0.34, 0.80, 0, 0.72, 0.10, 16, PALETTE.hullDark);
  b.cylinder(-0.34, 0.845, 0, 0.60, 0.04, 16, KOKSAN_OLIVE);
  for (const z of [-0.58, 0.58]) b.box(-0.90, 0.86, z, 0.34, 0.12, 0.10, PALETTE.metal);
  return b.build();
}

function buildKoksanMount(): MeshBuffers {
  const b = new MeshBuilder();
  // Open-topped shield: a sloped front plate and two short side plates, all
  // one-sided surfaces so the vehicle reads as a gun mount, not a turret.
  b.addQuad([0.60, 0.02, -0.68], [0.60, 0.02, 0.68], [0.72, 0.80, 0.60], [0.72, 0.80, -0.60], KOKSAN_OLIVE);
  b.addQuad([0.72, 0.80, -0.60], [0.72, 0.80, 0.60], [0.64, 0.84, 0.60], [0.64, 0.84, -0.60], PALETTE.darkMetal);
  b.addQuad([-0.78, 0.02, -0.68], [0.60, 0.02, -0.68], [0.72, 0.74, -0.60], [-0.72, 0.60, -0.60], shade(KOKSAN_OLIVE, 0.90));
  b.addQuad([0.60, 0.02, 0.68], [-0.78, 0.02, 0.68], [-0.72, 0.60, 0.60], [0.72, 0.74, 0.60], shade(KOKSAN_OLIVE, 0.94));
  // Open rear: only a low lip, so the breech and crew are visible.
  b.box(-0.74, 0.30, 0, 0.10, 0.24, 1.30, PALETTE.darkMetal);
  // Deck of the mount and the gun cradle running the length of the vehicle.
  b.box(-0.10, 0.06, 0, 1.30, 0.10, 1.20, PALETTE.hullDark);
  b.box(-0.10, 0.16, 0, 1.10, 0.10, 0.42, PALETTE.metal);
  // Breech block with an open loading tray, well forward of the rear plate.
  b.box(-0.14, 0.48, 0, 0.54, 0.34, 0.52, PALETTE.darkMetal);
  b.box(0.06, 0.66, 0, 0.34, 0.04, 0.46, PALETTE.hullDark);
  b.box(-0.30, 0.60, 0, 0.20, 0.16, 0.44, PALETTE.metal);
  // 170 mm tube: recoil sleeve, a long exposed barrel and a plain muzzle. The
  // tube runs the whole length of the mount and lands its tip on the authored
  // 2.60 muzzle reach at the authored 1.40 height.
  b.cylinderX(0.78, 0.54, 0, 0.14, 0.86, 9, PALETTE.darkMetal);
  b.cylinderX(1.98, 0.54, 0, 0.098, 1.76, 9, PALETTE.darkMetal);
  b.cylinderX(1.15, 0.54, 0, 0.16, 0.24, 9, KOKSAN_OLIVE);
  b.cylinderX(2.88, 0.54, 0, 0.115, 0.12, 9, PALETTE.hullDark);
  // Twin recoil cylinders and the elevation gear.
  for (const z of [-0.24, 0.24]) b.cylinderX(0.86, 0.72, z, 0.055, 0.94, 7, PALETTE.metal);
  beam(b, [-0.34, 0.18, 0.54], [0.24, 0.46, 0.54], 0.10, 0.10, PALETTE.metal);
  // Layer's sight and the gunner's seat, both open to the sky.
  b.box(0.24, 0.72, -0.40, 0.16, 0.26, 0.14, PALETTE.hullDark);
  b.box(0.24, 0.80, -0.47, 0.10, 0.10, 0.02, PALETTE.glass);
  b.box(-0.44, 0.24, 0.40, 0.18, 0.40, 0.18, PALETTE.canvas);
  b.box(-0.44, 0.46, 0.40, 0.24, 0.06, 0.24, PALETTE.canvas);
  // Shield team flash, ammunition rack and a stowed rammer.
  for (const z of [-0.685, 0.685]) b.box(0.00, 0.40, z, 0.90, 0.26, 0.02, KOKSAN_OLIVE, 0.88);
  b.box(-0.66, 0.18, -0.42, 0.30, 0.24, 0.30, PALETTE.oliveDark);
  for (const y of [0.24, 0.34]) b.cylinderX(-0.66, y, -0.42, 0.06, 0.34, 6, PALETTE.darkMetal);
  return b.build();
}

/* ------------------------------------------------------------------ */
/* Bulsae-4 — North Korean tracked missile carrier                    */
/* ------------------------------------------------------------------ */

/**
 * A small tracked chassis with a long boxed missile rack on a rear pedestal and
 * a remote machine gun on the rack itself. The donor tank destroyer is a scout
 * hull with an anti-aircraft pack; this is a low, narrow carrier whose missile
 * rack stands well above its deck line and overhangs the bow.
 */
function buildBulsaeBody(): MeshBuffers {
  const b = new MeshBuilder();
  addTrackedGear(b, {
    front: 2.04,
    rear: -2.06,
    halfTrack: 0.52,
    trackWidth: 0.26,
    wheelCount: 5,
    wheelRadius: 0.20,
    wheelWidth: 0.26,
    fender: 0.66,
  });
  // Narrow hull with a pointed glacis and a rear engine deck.
  b.box(0, 0.44, 0, 3.90, 0.28, 0.96, BULSAE_DARK);
  b.box(0.02, 0.64, 0, 3.70, 0.14, 1.06, BULSAE_OLIVE);
  b.addQuad([1.82, 0.70, -0.52], [1.82, 0.70, 0.52], [2.02, 0.46, 0.40], [2.02, 0.46, -0.40], BULSAE_OLIVE);
  b.box(1.94, 0.34, 0, 0.20, 0.20, 0.88, BULSAE_DARK);
  // Driver's hatch and periscopes on the left of the bow.
  b.box(1.34, 0.76, -0.26, 0.40, 0.12, 0.42, BULSAE_OLIVE);
  b.box(1.36, 0.81, -0.26, 0.26, 0.02, 0.30, BULSAE_DARK);
  for (const z of [-0.38, -0.14]) b.box(1.52, 0.72, z, 0.03, 0.08, 0.11, PALETTE.glass);
  // Engine louvres and exhaust on the right flank.
  for (let i = 0; i < 4; i++) b.box(1.28 - i * 0.12, 0.715, 0.28, 0.06, 0.02, 0.38, PALETTE.darkMetal);
  b.box(-1.86, 0.86, 0.38, 0.14, 0.30, 0.16, PALETTE.darkMetal);
  b.box(-1.86, 1.00, 0.38, 0.18, 0.04, 0.20, PALETTE.track);
  // Side skirts, stowage and the painted team band.
  for (const z of [-0.575, 0.575]) {
    b.box(-0.10, 0.60, z, 3.10, 0.03, 0.02, BULSAE_OLIVE, 0.86);
    b.box(0.34, 0.66, z * 1.02, 0.66, 0.14, 0.05, PALETTE.oliveDark);
    b.box(-1.10, 0.66, z * 1.02, 0.50, 0.12, 0.05, PALETTE.canvas);
  }
  // Reload rack on the front deck: the launch box itself carries the machine
  // gun, so the hull stays clear for the long rack above it.
  b.box(0.90, 0.78, 0.28, 0.56, 0.08, 0.20, BULSAE_DARK);
  for (const x of [0.70, 0.86, 1.02]) b.cylinderX(x, 0.86, 0.28, 0.055, 0.44, 7, PALETTE.oliveDark);
  // Rear plate, lights and the launcher pedestal base.
  b.box(-1.94, 0.56, 0, 0.08, 0.38, 0.92, BULSAE_DARK);
  for (const z of [-0.34, 0.34]) b.box(-1.98, 0.68, z, 0.03, 0.08, 0.10, PALETTE.red);
  b.cylinder(-0.55, 0.76, 0, 0.30, 0.10, 12, PALETTE.darkMetal);
  return b.build();
}

function buildBulsaeLauncher(): MeshBuffers {
  const b = new MeshBuilder();
  // Short pedestal that seats on the deck, then a yoked launch box.
  b.cylinder(0, -0.06, 0, 0.22, 0.12, 12, PALETTE.darkMetal);
  b.cylinder(0, -0.02, 0, 0.32, 0.06, 12, BULSAE_OLIVE);
  for (const z of [-0.42, 0.42]) {
    b.box(-0.10, 0.20, z, 0.22, 0.34, 0.08, PALETTE.metal);
    b.cylinderZ(-0.10, 0.26, z * 1.06, 0.06, 0.10, 8, PALETTE.darkMetal);
  }
  // Eight missiles ride in one long boxed rack that overhangs the bow. The box
  // is what separates this carrier from a turreted tank destroyer: there is no
  // gun at all, just a launcher with a missile nose showing.
  beam(b, [-0.55, 0.30, 0], [1.95, 0.52, 0], 0.68, 0.36, BULSAE_OLIVE);
  b.box(2.00, 0.52, 0, 0.08, 0.38, 0.70, PALETTE.darkMetal);
  b.box(-0.62, 0.27, 0, 0.10, 0.34, 0.66, PALETTE.warning);
  // Missile nose and fins just proud of the muzzle cap, landing the rocket tip
  // on the authored 1.60 muzzle reach.
  b.cylinderX(2.08, 0.53, 0, 0.075, 0.16, 8, PALETTE.hullLight);
  for (const [dz, dy] of [
    [0, 0.15],
    [0, -0.15],
    [0.15, 0],
    [-0.15, 0],
  ]) {
    b.box(2.02, 0.53 + dy, dz, 0.10, 0.02, 0.10, PALETTE.metal);
  }
  // Rail guides, a blast deflector at the rear and the retention band.
  for (const z of [-0.30, 0.30]) beam(b, [-0.50, 0.36, z], [1.90, 0.58, z], 0.05, 0.05, PALETTE.metal);
  b.addQuad([-0.68, 0.10, -0.40], [-0.68, 0.10, 0.40], [-0.78, 0.56, 0.34], [-0.78, 0.56, -0.34], PALETTE.darkMetal);
  beam(b, [0.70, 0.48, -0.36], [0.70, 0.74, 0.36], 0.12, 0.02, BULSAE_OLIVE, 0.88);
  // Remote machine gun on the rack roof with its own small shield.
  b.cylinder(0.60, 0.68, 0.24, 0.15, 0.08, 10, PALETTE.hullDark);
  b.box(0.58, 0.78, 0.24, 0.16, 0.14, 0.16, PALETTE.darkMetal);
  b.cylinderX(0.86, 0.80, 0.24, 0.020, 0.44, 6, PALETTE.darkMetal);
  b.cylinderX(0.78, 0.80, 0.24, 0.045, 0.16, 7, PALETTE.metal);
  b.addQuad([0.72, 0.74, 0.10], [0.72, 0.74, 0.38], [0.68, 0.92, 0.36], [0.68, 0.92, 0.12], BULSAE_DARK);
  // Sighting head, aerial and a rear counterweight.
  b.box(1.30, 0.66, -0.32, 0.20, 0.16, 0.18, PALETTE.hullDark);
  b.box(1.30, 0.70, -0.42, 0.12, 0.08, 0.03, PALETTE.glass);
  b.box(-0.40, 0.78, 0.30, 0.012, 0.30, 0.012, PALETTE.metal);
  b.box(-0.72, 0.22, 0, 0.14, 0.24, 0.50, PALETTE.darkMetal);
  return b.build();
}

/* ------------------------------------------------------------------ */
/* Spike team — Israeli ATGM team behind a tripod launcher            */
/* ------------------------------------------------------------------ */

/**
 * Two-man team around a tripod-mounted quad launcher. The gunner stands with
 * the control unit while the assistant crouches behind the pod, and the
 * launcher is a boxed four-cell pod rather than the baseline team's single
 * carried tube. Gunner legs use the same hip-pivot rig as every other
 * infantryman so the team walks with the rest of the roster.
 */
function buildTeamLeg(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, -0.14, 0, 0.11, 0.26, 0.12, PALETTE.oliveDark);
  b.box(0.03, -0.29, 0.005, 0.10, 0.06, 0.13, PALETTE.hullDark);
  b.box(0.04, -0.39, 0, 0.095, 0.18, 0.11, PALETTE.olive);
  b.box(0.02, -0.49, 0, 0.08, 0.08, 0.10, PALETTE.oliveDark);
  b.box(0.06, -0.535, 0, 0.18, 0.07, 0.11, PALETTE.darkMetal);
  return b.build();
}

const TEAM_LEG = buildTeamLeg();
const TEAM_HIP_Y = 0.57;

/**
 * One figure, measured from the pelvis up so the proportions match the rest of
 * the infantry roster (1.2 world units from boot sole to helmet crown).
 */
function addTeamTorso(b: MeshBuilder, x: number, z: number, pelvisY: number): void {
  const y = pelvisY;
  b.box(x, y, z, 0.16, 0.12, 0.22, PALETTE.oliveDark);
  b.box(x, y + 0.07, z, 0.17, 0.05, 0.24, PALETTE.darkMetal);
  b.box(x, y + 0.16, z, 0.17, 0.16, 0.24, SPIKE_UNIFORM);
  b.box(x + 0.01, y + 0.30, z, 0.19, 0.18, 0.29, SPIKE_UNIFORM);
  // Chest rig with the missile-cell pouches this team carries.
  b.box(x + 0.105, y + 0.30, z, 0.035, 0.18, 0.24, PALETTE.oliveDark);
  for (const dz of [-0.09, 0.09]) {
    b.box(x + 0.125, y + 0.26, z + dz, 0.05, 0.08, 0.08, PALETTE.canvas);
  }
  b.box(x, y + 0.39, z + 0.15, 0.15, 0.12, 0.11, SPIKE_UNIFORM, 0.9);
  b.box(x, y + 0.39, z - 0.15, 0.15, 0.12, 0.11, SPIKE_UNIFORM, 0.9);
  b.box(x, y + 0.44, z, 0.065, 0.05, 0.075, PALETTE.oliveDark);
  b.sphere(x + 0.01, y + 0.50, z, 0.095, 4, 7, PALETTE.oliveDark);
  // Helmet with a team-coloured cover, a brim and a goggle strap.
  b.sphere(x + 0.005, y + 0.55, z, 0.095, 3, 7, SPIKE_HELMET, 1);
  b.box(x + 0.085, y + 0.52, z, 0.05, 0.035, 0.19, SPIKE_HELMET, 1);
  b.box(x + 0.08, y + 0.49, z, 0.02, 0.03, 0.13, PALETTE.glassDark);
}

function buildSpikeTeam(): MeshBuffers {
  const b = new MeshBuilder();
  // Gunner: the animated figure at the origin, hands on the control unit. The
  // pelvis sits on the animated hip rig, so this figure keeps the roster's
  // walking legs while the loader beside him kneels on his own folded legs.
  addTeamTorso(b, 0, 0, TEAM_HIP_Y);
  b.box(-0.12, 0.34, -0.10, 0.10, 0.28, 0.19, PALETTE.oliveDark);
  b.box(0.02, 0.97, 0.14, 0.15, 0.12, 0.11, SPIKE_UNIFORM, 0.9);
  // Assistant kneeling behind the pod, one spare cell shouldered and a crate
  // of reloads on the ground beside him.
  addTeamTorso(b, -0.30, 0.36, 0.44);
  beam(b, [-0.30, 0.44, 0.42], [-0.46, 0.22, 0.42], 0.11, 0.11, PALETTE.oliveDark);
  beam(b, [-0.46, 0.22, 0.42], [-0.44, 0.06, 0.42], 0.095, 0.095, PALETTE.olive);
  b.box(-0.43, 0.05, 0.42, 0.19, 0.07, 0.12, PALETTE.darkMetal);
  beam(b, [-0.30, 0.44, 0.30], [-0.12, 0.16, 0.32], 0.10, 0.10, PALETTE.oliveDark);
  beam(b, [-0.12, 0.16, 0.32], [-0.04, 0.04, 0.32], 0.09, 0.09, PALETTE.olive);
  b.box(-0.30, 0.90, 0.42, 0.28, 0.16, 0.16, PALETTE.oliveDark);
  b.box(-0.10, 0.90, 0.42, 0.08, 0.14, 0.14, PALETTE.darkMetal);
  b.box(-0.46, 0.86, 0.42, 0.10, 0.12, 0.12, PALETTE.track);
  b.box(-0.56, 0.14, 0.16, 0.20, 0.16, 0.26, PALETTE.oliveDark);
  b.box(-0.56, 0.23, 0.16, 0.22, 0.02, 0.28, PALETTE.canvas);
  // Tripod: three braced legs and the pintle the pod pivots on.
  b.cylinderX(0.38, 0.86, 0, 0.05, 0.22, 6, PALETTE.metal);
  b.box(0.40, 0.92, 0, 0.16, 0.10, 0.16, PALETTE.darkMetal);
  beam(b, [0.40, 0.86, 0], [0.66, 0.02, 0.26], 0.05, 0.05, PALETTE.metal);
  beam(b, [0.40, 0.86, 0], [0.66, 0.02, -0.26], 0.05, 0.05, PALETTE.metal);
  beam(b, [0.40, 0.86, 0], [0.20, 0.02, 0], 0.05, 0.05, PALETTE.metal);
  for (const z of [-0.26, 0.26]) b.box(0.66, 0.03, z, 0.16, 0.05, 0.10, PALETTE.darkMetal);
  // Four-cell boxed launcher on the pintle, angled slightly up.
  b.box(0.40, 1.02, 0, 0.56, 0.46, 0.62, PALETTE.oliveDark);
  b.box(0.66, 1.02, 0, 0.06, 0.44, 0.60, PALETTE.darkMetal);
  for (const [dz, dy] of [
    [-0.15, 0.11],
    [0.15, 0.11],
    [-0.15, -0.11],
    [0.15, -0.11],
  ]) {
    b.cylinderX(0.70, 1.02 + dy, dz, 0.075, 0.10, 8, PALETTE.track);
    b.cylinderX(0.62, 1.02 + dy, dz, 0.085, 0.06, 8, PALETTE.hullDark);
  }
  // Sight head on the left of the pod, plus the painted team band.
  b.box(0.34, 1.28, -0.20, 0.24, 0.18, 0.20, PALETTE.hullDark);
  b.box(0.46, 1.28, -0.20, 0.03, 0.10, 0.14, PALETTE.glass);
  b.box(0.40, 1.26, 0, 0.34, 0.04, 0.56, SPIKE_UNIFORM, 0.88);
  // Cable from the pod to the gunner's control unit, and a reload cell.
  beam(b, [0.16, 0.84, 0.06], [-0.02, 0.70, 0.10], 0.025, 0.025, PALETTE.darkMetal);
  b.box(0.02, 0.74, 0.14, 0.14, 0.10, 0.12, PALETTE.darkMetal);
  b.box(0.02, 0.70, 0.14, 0.10, 0.06, 0.08, PALETTE.glassDark);
  b.cylinderX(-0.14, 0.20, 0.30, 0.08, 0.60, 8, PALETTE.oliveDark);
  b.box(-0.44, 0.22, 0.30, 0.12, 0.14, 0.20, PALETTE.canvas);
  // Gunner's arms reaching forward to the control unit.
  beam(b, [0, 0.97, 0.14], [0.02, 0.80, 0.16], 0.075, 0.075, SPIKE_UNIFORM);
  beam(b, [0.02, 0.80, 0.16], [0.04, 0.74, 0.16], 0.065, 0.065, SPIKE_UNIFORM);
  beam(b, [0, 0.97, -0.14], [0.10, 0.86, 0.02], 0.075, 0.075, SPIKE_UNIFORM);
  beam(b, [0.10, 0.86, 0.02], [0.08, 0.78, 0.10], 0.065, 0.065, SPIKE_UNIFORM);
  b.box(0.04, 0.74, 0.16, 0.07, 0.06, 0.07, PALETTE.darkMetal);
  return b.build();
}

/* ------------------------------------------------------------------ */
/* Style table                                                        */
/* ------------------------------------------------------------------ */

export const NATIONAL_STYLES: Record<string, EntityStyle> = {
  k9Thunder: {
    body: buildK9Body(),
    turret: buildK9Turret(),
    turretOffset: [-0.14, 0.94, 0],
  },
  cv90: {
    body: buildCv90Body(),
    turret: buildCv90Turret(),
    turretOffset: [0.24, 0.74, 0],
  },
  khordadSam: {
    body: buildKhordadBody(),
    turret: buildKhordadLauncher(),
    turretOffset: [-0.86, 1.02, 0],
  },
  koksan: {
    body: buildKoksanBody(),
    turret: buildKoksanMount(),
    turretOffset: [-0.34, 0.86, 0],
  },
  bulsae4: {
    body: buildBulsaeBody(),
    turret: buildBulsaeLauncher(),
    turretOffset: [-0.55, 0.82, 0],
  },
  spikeTeam: {
    body: buildSpikeTeam(),
    turretOffset: [0, 0, 0],
    infantry: { leg: TEAM_LEG, hip: [0, TEAM_HIP_Y, 0.09], hipOffset: TEAM_HIP_Y },
  },
};
