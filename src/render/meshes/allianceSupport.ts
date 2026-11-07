import { MeshBuilder, PALETTE, shade, type Color } from '../geometry';
import type { MeshBuffers } from '../gl';
import type { Vec3 } from '../math';
import { beam } from '../meshKit';
import type { EntityStyle } from '../unitMeshes';

/**
 * Eastern-Coalition platforms.
 *
 * These seven units used to borrow a canonical slot's mesh, which made an
 * alliance tank, rifleman or frigate indistinguishable from the baseline unit's
 * at battle zoom. Every model here is authored rather than borrowed, and each
 * one differs from its donor in at least three readable ways: running gear or
 * hull form, superstructure/profile, weapon shape, and stowage or paint.
 *
 * Conventions shared with the rest of the roster:
 *  - ground units sit on y = 0 and are authored at 1:1 world scale;
 *  - ships are authored at slipway scale (visual scale 0.70) with the bow
 *    toward +X and the waterline at y = 0;
 *  - infantry is 1.2 world units tall, with the legs split into their own mesh
 *    so the renderer can swing them from the hip;
 *  - every body carries a team-coloured panel that reads from above.
 */

const EC_SKIN: Color = [0.52, 0.41, 0.30];
/** Cool green-grey drab: deliberately not the baseline khaki. */
const EC_UNIFORM: Color = [0.35, 0.38, 0.31];
const EC_UNIFORM_DARK: Color = [0.25, 0.28, 0.23];
/** EC vehicles and ships wear a greener haze-grey than the baseline steel. */
const EC_HULL: Color = [0.29, 0.33, 0.32];
const EC_HULL_LIGHT: Color = [0.36, 0.40, 0.38];
const EC_HULL_DARK: Color = [0.20, 0.23, 0.23];
const EC_DECK: Color = [0.26, 0.29, 0.28];

// ── Infantry ────────────────────────────────────────────────────────────────

/** Hip height in the torso mesh, matching the renderer's rig convention. */
const HIP_Y = 0.57;

/**
 * One EC leg, origin at the hip joint with the sole at local Y = -HIP_Y. A
 * wider stance, gaiters and an ankle-holstered knife separate it from the
 * baseline straight-legged animation.
 */
function buildEcLeg(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, -0.14, 0.01, 0.115, 0.27, 0.13, EC_UNIFORM_DARK);
  // Knee pad with a raised cap.
  b.box(0.045, -0.30, 0.01, 0.085, 0.075, 0.135, EC_UNIFORM);
  b.box(0.055, -0.29, 0.01, 0.045, 0.05, 0.10, EC_UNIFORM_DARK);
  // Bloused trouser over a tall gaiter.
  b.box(0.01, -0.40, 0.005, 0.10, 0.18, 0.115, EC_UNIFORM);
  b.box(0.02, -0.475, 0.005, 0.09, 0.10, 0.105, EC_UNIFORM_DARK);
  b.box(0.02, -0.44, 0.005, 0.095, 0.02, 0.11, EC_HULL_DARK);
  // Boot with a squared toe cap.
  b.box(0.07, -0.545, 0, 0.19, 0.06, 0.11, PALETTE.darkMetal);
  b.box(0.155, -0.545, 0, 0.05, 0.045, 0.10, PALETTE.metal);
  // Sheathed knife strapped to the outside of the shin.
  b.box(-0.035, -0.42, 0.055, 0.03, 0.13, 0.035, PALETTE.oliveDark);
  return b.build();
}

const EC_LEG = buildEcLeg();

function ecInfantryRig(): NonNullable<EntityStyle['infantry']> {
  return { leg: EC_LEG, hip: [0, HIP_Y, 0.09], hipOffset: HIP_Y };
}

/** Oriented arm between a shoulder, an elbow and a hand. */
function arm(b: MeshBuilder, shoulder: Vec3, elbow: Vec3, hand: Vec3, color: Color): void {
  beam(b, shoulder, elbow, 0.085, 0.085, color);
  beam(b, elbow, hand, 0.075, 0.075, color);
  const glow = shade(EC_SKIN, 0.92);
  b.box(hand[0], hand[1], hand[2], 0.075, 0.075, 0.075, glow);
}

/**
 * Torso, webbing and head for an EC soldier. The kit is the identification
 * cue: a soft field cap with goggles instead of a helmet shell, a poncho roll
 * across the shoulders, and X-pattern webbing with side pouches rather than the
 * baseline front plate.
 */
function addEcSoldier(b: MeshBuilder, uniform: Color): void {
  // Pelvis and belt.
  b.box(0, 0.58, 0, 0.17, 0.12, 0.23, EC_UNIFORM_DARK);
  b.box(0, 0.65, 0, 0.18, 0.055, 0.25, PALETTE.darkMetal);
  // Torso, widening to the chest.
  b.box(0, 0.74, 0, 0.18, 0.16, 0.25, uniform);
  b.box(0.005, 0.88, 0, 0.20, 0.18, 0.30, uniform);
  // X-pattern webbing across the chest.
  beam(b, [-0.055, 1.00, 0.10], [0.02, 0.74, -0.10], 0.045, 0.02, PALETTE.canvas);
  beam(b, [-0.055, 0.80, 0.10], [0.02, 1.00, -0.10], 0.045, 0.02, PALETTE.canvas);
  // Side pouches instead of a chest plate.
  b.box(0.02, 0.80, 0.165, 0.13, 0.12, 0.06, PALETTE.oliveDark);
  b.box(0.02, 0.80, -0.165, 0.13, 0.12, 0.06, PALETTE.oliveDark);
  // Poncho roll packed across the shoulders.
  b.cylinderZ(-0.135, 0.99, 0, 0.075, 0.30, 8, PALETTE.canvas);
  b.box(-0.135, 0.99, 0, 0.13, 0.13, 0.02, PALETTE.canvas);
  // Shoulder caps carry a team tint; the head and shoulders read from above.
  b.box(0, 0.97, 0.155, 0.16, 0.13, 0.115, uniform, 0.9);
  b.box(0, 0.97, -0.155, 0.16, 0.13, 0.115, uniform, 0.9);
  // Neck and head.
  b.box(0, 1.02, 0, 0.07, 0.05, 0.08, EC_SKIN);
  b.sphere(0.005, 1.08, 0, 0.095, 4, 7, EC_SKIN);
  // Soft field cap: a squashed crown, a swept peak and a band.
  b.sphere(0.0, 1.135, 0, 0.10, 3, 8, EC_UNIFORM);
  b.box(0.0, 1.145, 0, 0.10, 0.03, 0.19, EC_UNIFORM, 1);
  b.box(0.075, 1.13, 0, 0.075, 0.028, 0.16, EC_UNIFORM_DARK);
  b.box(0.115, 1.115, 0, 0.07, 0.02, 0.14, EC_UNIFORM_DARK);
  b.box(0.0, 1.105, 0, 0.105, 0.022, 0.20, EC_UNIFORM_DARK);
  // Goggles pushed up onto the cap, and the strap around the back.
  b.box(0.085, 1.115, 0, 0.03, 0.045, 0.155, PALETTE.glassDark);
  b.box(0.098, 1.117, 0.045, 0.02, 0.028, 0.05, PALETTE.glass);
  b.box(0.098, 1.117, -0.045, 0.02, 0.028, 0.05, PALETTE.glass);
  b.box(-0.02, 1.11, 0, 0.115, 0.022, 0.185, PALETTE.oliveDark);
  // Team patch on the shoulder and a bedroll strap across the back.
  b.box(0.0, 0.985, -0.215, 0.085, 0.05, 0.015, uniform, 0.95);
  b.box(-0.145, 0.90, 0, 0.02, 0.04, 0.20, PALETTE.canvas);
  // Canteen and entrenching tool on the belt.
  b.box(-0.10, 0.68, 0.13, 0.07, 0.12, 0.07, PALETTE.oliveDark);
  b.box(-0.10, 0.70, -0.13, 0.06, 0.14, 0.05, PALETTE.darkMetal);
}

/**
 * EC bullpup rifle: the magazine and action sit *behind* the pistol grip, so the
 * weapon reads as a short, chunky block with a long barrel and a slotted brake
 * instead of the baseline rifle's conventional receiver-and-stock line.
 */
function addEcRifle(b: MeshBuilder): void {
  // Bullpup body, cheek rest and pistol grip.
  b.box(0.10, 0.90, 0.22, 0.44, 0.10, 0.075, PALETTE.hullDark);
  b.box(0.02, 0.945, 0.22, 0.20, 0.03, 0.06, PALETTE.oliveDark);
  b.box(0.02, 0.80, 0.22, 0.07, 0.13, 0.06, PALETTE.track);
  // Magazine well and a straight box magazine behind the grip.
  b.box(-0.14, 0.80, 0.22, 0.09, 0.16, 0.055, PALETTE.oliveDark);
  b.box(-0.15, 0.74, 0.22, 0.07, 0.06, 0.05, PALETTE.darkMetal);
  // Handguard, barrel and slotted muzzle brake.
  b.box(0.38, 0.905, 0.22, 0.24, 0.065, 0.06, PALETTE.oliveDark);
  b.cylinderX(0.60, 0.90, 0.22, 0.022, 0.30, 7, PALETTE.darkMetal);
  b.box(0.755, 0.90, 0.22, 0.11, 0.05, 0.055, PALETTE.darkMetal);
  for (const dx of [-0.028, 0, 0.028]) {
    b.box(0.755 + dx, 0.90, 0.22, 0.012, 0.062, 0.062, PALETTE.track);
  }
  // Carry handle with an optic between its posts.
  b.box(0.10, 0.975, 0.22, 0.26, 0.028, 0.05, PALETTE.darkMetal);
  b.box(0.10, 0.998, 0.22, 0.13, 0.045, 0.055, PALETTE.glassDark);
  b.box(0.10, 1.005, 0.22, 0.09, 0.022, 0.035, PALETTE.glass);
  // Folding bipod under the handguard.
  for (const dz of [-0.045, 0.045]) {
    beam(b, [0.43, 0.875, 0.22 + dz], [0.52, 0.79, 0.22 + dz * 2.2], 0.02, 0.02, PALETTE.metal);
  }
}

function buildEcRifle(): MeshBuffers {
  const b = new MeshBuilder();
  addEcSoldier(b, EC_UNIFORM);
  addEcRifle(b);
  // Trigger hand and support hand under the handguard.
  arm(b, [0, 0.97, 0.14], [0.02, 0.87, 0.18], [0.03, 0.84, 0.22], EC_UNIFORM);
  arm(b, [0, 0.97, -0.14], [0.14, 0.92, 0.08], [0.38, 0.91, 0.20], EC_UNIFORM);
  return b.build();
}

/**
 * EC anti-armour team: a gunner on the grips of a pedestal tripod and a loader
 * crouched beside a missile crate. The launcher is a boxed tube on a pintle
 * mount, elevated well above shoulder height, which is the clearest break from
 * the baseline tube-on-the-shoulder pose.
 */
function buildEcAtgm(): MeshBuffers {
  const b = new MeshBuilder();
  addEcSoldier(b, EC_UNIFORM);
  // Gunner's hands on the traversing grips.
  arm(b, [0, 0.97, 0.14], [0.12, 0.92, 0.12], [0.24, 0.90, 0.10], EC_UNIFORM);
  arm(b, [0, 0.97, -0.14], [0.10, 0.86, -0.14], [0.24, 0.84, -0.12], EC_UNIFORM);
  // Pedestal tripod: three braced legs into a pintle head.
  const pintle: Vec3 = [0.34, 0.62, 0];
  beam(b, [0.12, 0.02, 0.02], pintle, 0.05, 0.05, PALETTE.darkMetal);
  beam(b, [0.56, 0.02, 0.30], pintle, 0.05, 0.05, PALETTE.darkMetal);
  beam(b, [0.56, 0.02, -0.30], pintle, 0.05, 0.05, PALETTE.darkMetal);
  b.box(0.34, 0.10, 0.02, 0.10, 0.05, 0.10, PALETTE.metal);
  b.box(0.34, 0.58, 0, 0.12, 0.10, 0.12, PALETTE.metal);
  b.cylinder(0.34, 0.68, 0, 0.075, 0.10, 8, PALETTE.darkMetal);
  // Boxed launcher tube, elevated 12 degrees on the pintle.
  beam(b, [0.30, 0.74, 0], [0.96, 0.88, 0], 0.22, 0.22, PALETTE.oliveDark);
  b.box(0.28, 0.755, 0, 0.16, 0.24, 0.24, PALETTE.darkMetal);
  // Frontal cover plate with the missile aperture and blast venturi aft.
  b.box(0.985, 0.885, 0, 0.03, 0.22, 0.22, PALETTE.hullDark);
  b.box(0.995, 0.885, 0, 0.02, 0.13, 0.13, PALETTE.track);
  b.box(0.24, 0.755, 0, 0.06, 0.17, 0.17, PALETTE.hullDark);
  // Day sight and thermal box on the left of the tube.
  b.box(0.62, 1.02, 0.14, 0.20, 0.13, 0.10, PALETTE.hullDark);
  b.box(0.72, 1.02, 0.14, 0.03, 0.08, 0.075, PALETTE.glass);
  b.box(0.62, 1.10, 0.14, 0.18, 0.02, 0.09, PALETTE.darkMetal);
  // Loader: crouched behind the gunner with a spare missile crate.
  b.box(-0.46, 0.30, -0.30, 0.19, 0.24, 0.24, EC_UNIFORM);
  b.box(-0.46, 0.46, -0.30, 0.16, 0.14, 0.20, EC_UNIFORM_DARK);
  b.sphere(-0.40, 0.58, -0.30, 0.09, 4, 7, EC_SKIN);
  b.sphere(-0.405, 0.625, -0.30, 0.095, 3, 8, EC_UNIFORM, 0.9);
  b.box(-0.505, 0.635, -0.30, 0.075, 0.02, 0.15, EC_UNIFORM);
  // Folded legs and one knee on the ground.
  b.box(-0.30, 0.12, -0.30, 0.22, 0.16, 0.16, EC_UNIFORM_DARK);
  b.box(-0.52, 0.10, -0.44, 0.14, 0.20, 0.18, EC_UNIFORM_DARK);
  // Arms cradling the crate.
  arm(b, [-0.46, 0.44, -0.20], [-0.40, 0.34, -0.10], [-0.34, 0.26, -0.14], EC_UNIFORM);
  arm(b, [-0.46, 0.42, -0.40], [-0.40, 0.32, -0.46], [-0.32, 0.24, -0.40], EC_UNIFORM);
  // Spare missile crate on the ground.
  b.box(-0.20, 0.11, -0.50, 0.44, 0.22, 0.20, PALETTE.oliveDark);
  b.box(-0.20, 0.225, -0.50, 0.40, 0.02, 0.17, PALETTE.canvas);
  for (const x of [-0.34, -0.06]) {
    b.box(x, 0.11, -0.50, 0.03, 0.24, 0.21, PALETTE.darkMetal);
  }
  // Ammunition satchel and a team panel on the pintle shield.
  b.box(-0.52, 0.30, -0.08, 0.16, 0.14, 0.10, PALETTE.canvas);
  b.box(0.34, 0.50, 0, 0.14, 0.05, 0.14, EC_UNIFORM, 0.95);
  return b.build();
}

// ── Ships ───────────────────────────────────────────────────────────────────

/**
 * Faceted chine hull with a sharp prow. Shared by the two EC small combatants:
 * the slab sides, hard chine and vertical stem are the family cue, and each
 * builder adds its own deck layout on top.
 */
function ecChineHull(
  b: MeshBuilder,
  options: { length: number; halfBeam: number; rise: number; hull: Color; upper: Color },
): void {
  const half = options.length / 2;
  const bow = half - 0.35;
  const beam = options.halfBeam;
  const deckY = options.rise;
  // Keel box keeps a bottom face for the low camera angles.
  b.box(0, 0.20, 0, options.length - 0.4, 0.24, beam * 1.1, options.hull);
  // Port and starboard chine panels from keel to deck edge (no flare curve:
  // one straight facet per side).
  b.addQuad(
    [-half, 0.12, -beam * 0.55],
    [bow, 0.12, -beam * 0.55],
    [bow - 0.25, deckY, -beam],
    [-half, deckY, -beam],
    options.upper,
  );
  b.addQuad(
    [-half, 0.12, beam * 0.55],
    [-half, deckY, beam],
    [bow - 0.25, deckY, beam],
    [bow, 0.12, beam * 0.55],
    options.upper,
  );
  // Bow: two facets meeting on the stem, plus the stem itself.
  b.addQuad(
    [bow, 0.12, -beam * 0.55],
    [bow, 0.12, beam * 0.55],
    [half, 0.30, 0.06],
    [half, 0.30, -0.06],
    options.hull,
  );
  b.addQuad([bow - 0.25, deckY, -beam], [bow - 0.25, deckY, beam], [half - 0.1, 0.62, 0.05], [half - 0.1, 0.62, -0.05], options.upper);
  b.addQuad([bow, 0.12, -beam * 0.55], [half, 0.30, -0.06], [half - 0.1, 0.62, -0.05], [bow - 0.25, deckY, -beam], EC_HULL_DARK);
  b.addQuad([bow, 0.12, beam * 0.55], [bow - 0.25, deckY, beam], [half - 0.1, 0.62, 0.05], [half, 0.30, 0.06], EC_HULL_DARK);
  // Waterline boot-topping and the deck plate.
  b.box(0, 0.10, -beam * 0.58, options.length - 0.6, 0.06, 0.04, PALETTE.track);
  b.box(0, 0.10, beam * 0.58, options.length - 0.6, 0.06, 0.04, PALETTE.track);
  b.box(-0.1, deckY - 0.04, 0, options.length - 0.5, 0.08, beam * 1.94, EC_DECK);
  b.box(-0.1, deckY - 0.02, 0, options.length - 1.2, 0.02, beam * 1.30, EC_HULL, 0.88);
}

/** Small stealth-cupola gun mount for the EC fast attack craft. */
function buildEcFastGun(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, -0.08, 0, 0.19, 0.22, 10, PALETTE.darkMetal);
  // Faceted one-piece cupola with a slab roof.
  b.addQuad([-0.26, 0.02, -0.28], [0.22, 0.02, -0.28], [0.14, 0.28, -0.20], [-0.22, 0.28, -0.20], EC_HULL);
  b.addQuad([-0.26, 0.02, 0.28], [-0.22, 0.28, 0.20], [0.14, 0.28, 0.20], [0.22, 0.02, 0.28], EC_HULL);
  b.addQuad([-0.26, 0.02, -0.28], [-0.26, 0.02, 0.28], [-0.22, 0.28, 0.20], [-0.22, 0.28, -0.20], EC_HULL_DARK);
  b.box(-0.04, 0.29, 0, 0.42, 0.03, 0.42, EC_HULL_LIGHT, 0.9);
  // Autocannon with a long slim barrel and a slotted flash hider.
  b.box(0.24, 0.17, 0, 0.24, 0.14, 0.16, PALETTE.darkMetal);
  b.cylinderX(0.66, 0.19, 0, 0.032, 0.62, 7, PALETTE.darkMetal);
  b.box(0.96, 0.19, 0, 0.09, 0.05, 0.05, PALETTE.track);
  // Local sight head.
  b.box(-0.02, 0.36, 0.14, 0.12, 0.10, 0.10, PALETTE.glassDark);
  b.box(0.045, 0.365, 0.14, 0.02, 0.065, 0.065, PALETTE.glass);
  return b.build();
}

/**
 * Hydrofoil fast attack craft. Where the baseline boat is a plain planing hull
 * with two canisters, this one carries a faceted chine hull, a bow canard foil
 * on visible struts, a four-cell box launcher canted up and aft instead of
 * level amidships, and a single low mast; it reads as a different class at any
 * zoom.
 */
function buildEcMissileBoat(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(-3.0, 0.48, 0, 0.28, 0.56, 1.36, EC_HULL_DARK);
  ecChineHull(b, { length: 6.40, halfBeam: 0.80, rise: 0.82, hull: EC_HULL, upper: EC_HULL_LIGHT });
  // Bow canard foil: above the waterline, so the foil is actually visible.
  for (const z of [-0.44, 0.44]) {
    b.box(2.30, 0.62, z, 0.10, 0.44, 0.10, PALETTE.metal);
  }
  b.box(2.30, 0.86, 0, 0.42, 0.075, 1.62, EC_HULL_LIGHT);
  for (const z of [-0.80, 0.80]) {
    b.box(2.30, 0.80, z, 0.36, 0.20, 0.09, EC_HULL_DARK);
  }
  // Low, faceted bridge well forward; the boat's profile is dominated by the
  // launcher rather than a tall pilot house.
  b.box(1.62, 1.10, 0, 1.20, 0.48, 1.06, EC_HULL_LIGHT);
  b.addQuad([2.24, 0.90, -0.53], [2.24, 0.90, 0.53], [2.10, 1.34, 0.42], [2.10, 1.34, -0.42], EC_HULL);
  b.box(1.62, 1.37, 0, 1.10, 0.09, 0.92, EC_HULL);
  b.box(2.22, 1.12, 0, 0.04, 0.20, 0.82, PALETTE.glassDark);
  b.box(2.24, 1.13, 0, 0.02, 0.14, 0.70, PALETTE.glass);
  b.box(1.62, 1.44, 0, 0.34, 0.05, 0.34, PALETTE.darkMetal);
  // Four-cell box launcher, canted up and aft behind the bridge.
  beam(b, [-0.55, 1.06, 0], [-1.35, 1.50, 0], 0.78, 0.42, EC_HULL_DARK);
  b.box(-1.35, 1.56, 0, 0.10, 0.52, 0.82, PALETTE.hullDark);
  for (const z of [-0.20, 0.20]) {
    for (const y of [-0.11, 0.11]) {
      b.box(-1.40, 1.56 + y, z, 0.06, 0.17, 0.33, PALETTE.oliveDark);
      b.box(-1.44, 1.56 + y, z, 0.02, 0.13, 0.29, PALETTE.track);
    }
  }
  b.box(-0.55, 1.04, 0, 0.66, 0.10, 0.86, PALETTE.metal);
  b.box(-1.20, 1.14, 0, 0.20, 0.30, 0.20, PALETTE.darkMetal);
  // Short lattice mast with a small flat search plate and a whip aerial.
  b.box(-0.10, 1.60, 0, 0.09, 0.72, 0.09, PALETTE.metal);
  b.box(-0.10, 1.90, 0, 0.62, 0.05, 0.07, PALETTE.metal);
  b.box(-0.10, 2.04, 0, 0.07, 0.28, 0.52, PALETTE.darkMetal);
  b.box(-0.10, 2.22, -0.20, 0.03, 0.42, 0.03, PALETTE.metal);
  // Exhaust trunk at the waterline with cooling louvres.
  for (const z of [-0.42, 0.42]) {
    b.box(-2.80, 0.52, z, 0.30, 0.26, 0.16, PALETTE.darkMetal);
    for (let i = 0; i < 3; i++) b.box(-2.80, 0.44 + i * 0.08, z * 1.02, 0.26, 0.03, 0.02, PALETTE.track);
  }
  // Rails, cleats, raft and the team panel along both sides.
  for (const z of [-0.79, 0.79]) {
    b.box(-0.2, 0.98, z, 5.60, 0.04, 0.03, PALETTE.metal);
    for (let i = 0; i < 5; i++) b.box(-2.50 + i * 1.10, 1.04, z, 0.02, 0.12, 0.02, PALETTE.metal);
    b.box(0.90, 0.90, z * 1.01, 1.30, 0.09, 0.02, EC_HULL_LIGHT, 0.9);
    b.box(-2.30, 0.86, z * 1.02, 0.62, 0.14, 0.13, PALETTE.oliveDark);
    b.box(3.30, 0.40, z * 0.52, 0.12, 0.20, 0.13, PALETTE.darkMetal);
  }
  // Stern transom, water-jet nozzles and trim tabs.
  b.box(-3.10, 0.34, 0, 0.16, 0.44, 1.10, EC_HULL_DARK);
  for (const z of [-0.34, 0.34]) {
    b.cylinderX(-3.22, 0.30, z, 0.14, 0.24, 8, PALETTE.darkMetal);
    b.box(-3.04, 0.14, z, 0.30, 0.05, 0.28, PALETTE.metal);
  }
  return b.build();
}

/** Slab-sided stealth cupola for the EC corvette. */
function buildEcStealthGun(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, -0.14, 0, 0.26, 0.30, 10, PALETTE.darkMetal);
  // Angular, all-round-sloped cupola with a single forward facet.
  b.box(-0.06, 0.10, 0, 0.66, 0.24, 0.62, EC_HULL);
  b.addQuad([-0.39, 0.02, -0.31], [0.27, 0.02, -0.31], [0.19, 0.26, -0.22], [-0.33, 0.26, -0.22], EC_HULL_LIGHT);
  b.addQuad([-0.39, 0.02, 0.31], [-0.33, 0.26, 0.22], [0.19, 0.26, 0.22], [0.27, 0.02, 0.31], EC_HULL_LIGHT);
  b.addQuad([-0.39, 0.02, -0.31], [-0.39, 0.02, 0.31], [-0.33, 0.26, 0.22], [-0.33, 0.26, -0.22], EC_HULL_DARK);
  b.box(-0.06, 0.275, 0, 0.64, 0.03, 0.52, EC_HULL_LIGHT, 0.9);
  b.box(0.30, 0.14, 0, 0.26, 0.20, 0.34, EC_HULL_DARK);
  b.box(0.44, 0.20, 0, 0.10, 0.12, 0.24, PALETTE.glassDark);
  // Long single barrel with a thermal sleeve.
  b.cylinderX(0.86, 0.20, 0, 0.042, 0.94, 8, PALETTE.darkMetal);
  b.cylinderX(0.72, 0.20, 0, 0.062, 0.34, 8, EC_HULL_DARK);
  b.cylinderX(1.34, 0.20, 0, 0.052, 0.08, 8, EC_HULL_DARK);
  b.box(-0.28, 0.16, 0, 0.20, 0.04, 0.46, EC_HULL_LIGHT, 0.9);
  return b.build();
}

/**
 * Slab-sided corvette. Flush deck (no forecastle or quarterdeck step), one
 * boxy superstructure block with vertical sides, a lattice mast instead of the
 * baseline's tapered pole and a stern helicopter deck: a very different
 * plan-view from the borrowed donor's stepped flush-deck arrangement.
 */
function buildEcCorvette(): MeshBuffers {
  const b = new MeshBuilder();
  // Vertical slab hull with a plumb bow and a narrow transom.
  b.box(0, 0.42, 0, 9.40, 0.56, 1.86, EC_HULL);
  b.box(0, 0.72, 0, 9.30, 0.16, 1.90, EC_HULL_LIGHT);
  b.addQuad([4.65, 0.16, -0.93], [4.65, 0.16, 0.93], [5.45, 0.40, 0.10], [5.45, 0.40, -0.10], EC_HULL);
  b.addQuad([4.65, 0.72, -0.95], [4.65, 0.72, 0.95], [5.45, 0.50, 0.09], [5.45, 0.50, -0.09], EC_HULL_LIGHT);
  b.addQuad([4.65, 0.16, -0.93], [5.45, 0.40, -0.10], [5.45, 0.50, -0.09], [4.65, 0.72, -0.95], EC_HULL_DARK);
  b.addQuad([4.65, 0.16, 0.93], [4.65, 0.72, 0.95], [5.45, 0.50, 0.09], [5.45, 0.40, 0.10], EC_HULL_DARK);
  // Flush deck plate with the team stripe running fore and aft.
  b.box(-0.05, 0.84, 0, 9.20, 0.10, 1.84, EC_DECK);
  b.box(0.10, 0.90, 0, 6.60, 0.02, 0.36, EC_HULL_LIGHT, 0.9);
  // One slab superstructure block; the bridge face is vertical, not raked.
  b.box(-0.55, 1.30, 0, 2.90, 0.90, 1.64, EC_HULL_LIGHT);
  b.box(-0.55, 1.80, 0, 3.00, 0.10, 1.70, EC_HULL);
  b.box(-0.55, 1.90, 0, 2.10, 0.12, 1.24, EC_HULL_LIGHT);
  b.box(0.90, 1.42, 0, 0.04, 0.30, 1.44, PALETTE.glassDark);
  b.box(0.92, 1.43, 0, 0.02, 0.22, 1.30, PALETTE.glass);
  for (const z of [-0.84, 0.84]) {
    b.box(-0.50, 1.44, z, 1.60, 0.24, 0.02, PALETTE.glassDark);
    b.box(-0.50, 1.45, z * 1.01, 1.44, 0.17, 0.01, PALETTE.glass);
  }
  // Bridge wings, and the funnel faired into the block's aft face.
  for (const z of [-0.92, 0.92]) {
    b.box(0.72, 1.58, z, 0.34, 0.34, 0.18, EC_HULL_LIGHT);
    b.box(0.72, 1.68, z * 1.06, 0.30, 0.05, 0.16, EC_HULL, 0.9);
  }
  b.box(-1.90, 1.86, 0, 0.62, 0.62, 0.68, EC_HULL);
  b.box(-1.90, 2.20, 0, 0.66, 0.08, 0.72, PALETTE.darkMetal);
  // Lattice mast: four posts converging on a flat radar plate.
  for (const dx of [-0.26, 0.26]) {
    for (const dz of [-0.18, 0.18]) {
      beam(b, [-1.20 + dx, 1.96, dz], [-1.20 + dx * 0.25, 3.06, dz * 0.25], 0.045, 0.045, PALETTE.metal);
    }
  }
  for (const y of [2.24, 2.62, 2.96]) {
    b.box(-1.20, y, 0, 0.62 - (y - 2.24) * 0.6, 0.03, 0.42 - (y - 2.24) * 0.42, PALETTE.metal);
  }
  b.box(-1.20, 3.16, 0, 0.30, 0.06, 0.86, PALETTE.darkMetal);
  b.box(-1.20, 3.22, 0, 0.16, 0.05, 0.78, PALETTE.glassDark);
  // Two twin launcher boxes amidships, mounted flat rather than canted.
  for (const z of [-0.66, 0.66]) {
    b.box(-2.30, 1.00, z, 1.20, 0.22, 0.44, EC_HULL_DARK);
    for (const dz of [-0.11, 0.11]) {
      b.cylinderX(-2.30, 1.14, z + dz, 0.085, 1.02, 8, PALETTE.oliveDark);
      b.box(-1.76, 1.14, z + dz, 0.10, 0.16, 0.16, PALETTE.warning);
    }
  }
  // Stern flight deck with a painted ring and tie-downs.
  b.cylinder(-3.60, 0.90, 0, 0.78, 0.015, 12, EC_HULL_LIGHT, 0.92);
  b.cylinder(-3.60, 0.905, 0, 0.52, 0.012, 12, EC_DECK);
  for (const x of [-2.90, -4.20]) {
    for (const z of [-0.42, 0.42]) b.box(x, 0.895, z, 0.09, 0.02, 0.09, PALETTE.track);
  }
  // Rails, anchors, rafts and life-buoy stations.
  for (const z of [-0.92, 0.92]) {
    b.box(0.10, 1.02, z, 8.70, 0.05, 0.03, PALETTE.metal);
    for (let i = 0; i < 8; i++) b.box(-4.10 + i * 1.15, 1.09, z, 0.025, 0.15, 0.025, PALETTE.metal);
    b.box(-0.50, 1.26, z * 1.03, 1.30, 0.09, 0.02, EC_HULL_LIGHT, 0.9);
    b.box(2.10, 1.00, z * 1.02, 0.78, 0.14, 0.14, PALETTE.oliveDark);
    b.box(4.10, 0.40, z * 0.66, 0.12, 0.22, 0.16, PALETTE.darkMetal);
  }
  b.box(4.00, 0.96, 0, 0.58, 0.14, 1.24, EC_HULL_DARK);
  b.box(4.36, 0.60, 0, 0.20, 0.20, 0.72, PALETTE.metal);
  // Stern transom, shafts and screws.
  b.box(-4.70, 0.50, 0, 0.32, 0.60, 1.74, EC_HULL_DARK);
  for (const z of [-0.44, 0.44]) {
    b.box(-4.88, 0.24, z, 0.18, 0.32, 0.12, PALETTE.metal);
    b.cylinderX(-4.92, 0.20, z, 0.12, 0.24, 6, PALETTE.darkMetal);
  }
  return b.build();
}

/** Angular twin mount for the EC frigate. */
function buildEcTwinMount(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, -0.16, 0, 0.28, 0.32, 10, PALETTE.darkMetal);
  b.addQuad([-0.40, 0.02, -0.36], [0.34, 0.02, -0.36], [0.24, 0.32, -0.26], [-0.34, 0.32, -0.26], EC_HULL);
  b.addQuad([-0.40, 0.02, 0.36], [-0.34, 0.32, 0.26], [0.24, 0.32, 0.26], [0.34, 0.02, 0.36], EC_HULL);
  b.addQuad([-0.40, 0.02, -0.36], [-0.40, 0.02, 0.36], [-0.34, 0.32, 0.26], [-0.34, 0.32, -0.26], EC_HULL_DARK);
  b.box(-0.03, 0.335, 0, 0.70, 0.03, 0.56, EC_HULL_LIGHT, 0.9);
  // Twin barrels side by side with a shared recoil sleeve.
  b.box(0.34, 0.20, 0, 0.30, 0.22, 0.46, EC_HULL_DARK);
  for (const z of [-0.13, 0.13]) {
    b.cylinderX(0.94, 0.20, z, 0.038, 0.90, 8, PALETTE.darkMetal);
    b.cylinderX(1.30, 0.20, z, 0.048, 0.12, 8, EC_HULL_DARK);
  }
  b.box(-0.10, 0.44, 0.20, 0.14, 0.12, 0.11, PALETTE.glassDark);
  b.box(-0.06, 0.47, 0.20, 0.03, 0.06, 0.07, PALETTE.glass);
  return b.build();
}

/**
 * Fleet escort with a stepped two-tier bridge, a stern hangar and a tripod mast
 * carrying a big rotating air-search array. The donor's single-tier bridge and
 * box SAM farm are gone; the plan view reads as a different class.
 */
function buildEcFrigate(): MeshBuffers {
  const b = new MeshBuilder();
  // Hull with a single hard chine and a plumb, slightly raked bow.
  b.box(0.20, 0.46, 0, 11.60, 0.60, 2.24, EC_HULL);
  b.box(0.20, 0.78, 0, 11.50, 0.16, 2.30, EC_HULL_LIGHT);
  b.addQuad([5.60, 0.18, -1.12], [5.60, 0.18, 1.12], [6.55, 0.44, 0.12], [6.55, 0.44, -0.12], EC_HULL);
  b.addQuad([5.60, 0.78, -1.14], [5.60, 0.78, 1.14], [6.55, 0.56, 0.10], [6.55, 0.56, -0.10], EC_HULL_LIGHT);
  b.addQuad([5.60, 0.18, -1.12], [6.55, 0.44, -0.12], [6.55, 0.56, -0.10], [5.60, 0.78, -1.14], EC_HULL_DARK);
  b.addQuad([5.60, 0.18, 1.12], [5.60, 0.78, 1.14], [6.55, 0.56, 0.10], [6.55, 0.44, 0.12], EC_HULL_DARK);
  // Continuous flush deck with a team stripe forward.
  b.box(0.10, 0.90, 0, 11.40, 0.10, 2.22, EC_DECK);
  b.box(0.30, 0.96, 0, 7.20, 0.02, 0.40, EC_HULL_LIGHT, 0.9);
  // Tier one: wide operations block. Tier two: narrow bridge on top of it.
  b.box(-1.10, 1.36, 0, 3.40, 0.82, 2.10, EC_HULL_LIGHT);
  b.box(-1.10, 1.80, 0, 3.50, 0.08, 2.16, EC_HULL);
  b.box(-0.30, 1.90, 0, 1.90, 0.34, 1.56, EC_HULL_LIGHT);
  b.box(-0.30, 2.10, 0, 2.00, 0.08, 1.62, EC_HULL);
  b.box(0.66, 1.48, 0, 0.04, 0.26, 1.86, PALETTE.glassDark);
  b.box(0.68, 1.49, 0, 0.02, 0.19, 1.72, PALETTE.glass);
  b.box(0.66, 2.02, 0, 0.04, 0.22, 1.44, PALETTE.glassDark);
  b.box(0.68, 2.03, 0, 0.02, 0.16, 1.32, PALETTE.glass);
  for (const z of [-1.06, 1.06]) {
    b.box(-1.10, 1.44, z, 3.10, 0.22, 0.02, PALETTE.glassDark);
    b.box(-1.10, 1.45, z * 1.01, 2.92, 0.16, 0.01, PALETTE.glass);
  }
  // Bridge wings with signal lamps.
  for (const z of [-1.14, 1.14]) {
    b.box(0.40, 1.94, z, 0.44, 0.22, 0.22, EC_HULL_LIGHT);
    b.box(0.40, 2.06, z * 1.02, 0.10, 0.08, 0.10, PALETTE.warning);
  }
  // Two slim uptakes faired into the block, capped in black.
  for (const dx of [-2.20, -1.60]) {
    b.box(dx, 1.94, 0, 0.34, 0.58, 0.72, EC_HULL);
    b.box(dx, 2.22, 0, 0.38, 0.08, 0.78, PALETTE.darkMetal);
  }
  // Tripod mast with a big rotating array and a yardarm.
  const mastFoot: Vec3 = [-2.72, 1.86, 0];
  const mastHead: Vec3 = [-2.86, 3.30, 0];
  beam(b, mastFoot, mastHead, 0.12, 0.12, PALETTE.metal);
  for (const z of [-1.00, 1.00]) {
    beam(b, [-2.20, 1.84, z * 0.42], [-2.84, 2.72, z * 0.35], 0.075, 0.075, PALETTE.metal);
  }
  b.box(-2.84, 2.74, 0, 0.09, 0.08, 2.10, PALETTE.metal);
  b.box(-2.84, 3.34, 0, 0.10, 0.26, 1.80, PALETTE.darkMetal);
  b.box(-2.90, 3.35, 0, 0.04, 0.20, 1.66, PALETTE.glassDark);
  b.box(-2.84, 3.60, 0, 0.05, 0.40, 0.05, PALETTE.metal);
  b.box(-2.60, 3.98, 0, 0.44, 0.04, 0.04, PALETTE.metal);
  // Amidships missile deck: two flat four-cell box launchers.
  for (const z of [-0.72, 0.72]) {
    b.box(-3.60, 1.06, z, 1.40, 0.28, 0.56, EC_HULL_DARK);
    for (const dz of [-0.13, 0.13]) {
      for (const y of [1.06, 1.20]) {
        b.box(-3.60, y, z + dz, 1.28, 0.10, 0.11, PALETTE.oliveDark);
        b.box(-2.96, y, z + dz, 0.05, 0.08, 0.09, PALETTE.track);
      }
    }
  }
  // Stern hangar with a roller door and the flight deck aft of it.
  b.box(-4.70, 1.24, 0, 2.30, 0.70, 2.00, EC_HULL_LIGHT);
  b.box(-4.70, 1.60, 0, 2.36, 0.08, 2.06, EC_HULL);
  b.box(-3.56, 1.18, 0, 0.05, 0.52, 1.40, PALETTE.darkMetal);
  for (let i = 0; i < 4; i++) b.box(-3.56, 0.98 + i * 0.13, 0, 0.06, 0.04, 1.34, PALETTE.track);
  b.cylinder(-5.90, 0.94, 0, 0.62, 0.015, 12, EC_HULL_LIGHT, 0.92);
  b.cylinder(-5.90, 0.945, 0, 0.40, 0.012, 12, EC_DECK);
  // Rails, anchors, rafts, cranes and team panels.
  for (const z of [-1.11, 1.11]) {
    b.box(0.10, 1.10, z, 10.60, 0.05, 0.03, PALETTE.metal);
    for (let i = 0; i < 9; i++) b.box(-5.00 + i * 1.20, 1.17, z, 0.025, 0.15, 0.025, PALETTE.metal);
    b.box(-1.10, 1.34, z * 1.03, 1.44, 0.09, 0.02, EC_HULL_LIGHT, 0.9);
    b.box(3.60, 1.06, z * 1.02, 0.86, 0.14, 0.14, PALETTE.oliveDark);
    b.box(5.20, 0.44, z * 0.72, 0.14, 0.22, 0.16, PALETTE.darkMetal);
  }
  b.box(4.70, 1.02, 0, 0.64, 0.14, 1.54, EC_HULL_DARK);
  b.box(5.10, 0.66, 0, 0.22, 0.22, 0.86, PALETTE.metal);
  // Stern transom, twin shafts and screws.
  b.box(-5.72, 0.54, 0, 0.36, 0.68, 2.12, EC_HULL_DARK);
  for (const z of [-0.56, 0.56]) {
    b.box(-5.94, 0.26, z, 0.20, 0.34, 0.14, PALETTE.metal);
    b.cylinderX(-6.00, 0.22, z, 0.14, 0.28, 6, PALETTE.darkMetal);
  }
  return b.build();
}

/** Sail-mounted snorkel and attack periscope for the EC boat. */
function buildEcPeriscope(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, 0.02, 0, 0.10, 0.08, 8, PALETTE.darkMetal);
  // Attack periscope with a slim head.
  b.cylinder(-0.12, 0.52, 0, 0.042, 1.04, 8, PALETTE.metal);
  b.box(-0.10, 1.06, 0, 0.13, 0.10, 0.16, PALETTE.darkMetal);
  b.box(-0.04, 1.07, 0, 0.09, 0.04, 0.08, PALETTE.glass);
  // Snorkel mast with its angled intake head.
  b.cylinder(0.14, 0.44, 0.08, 0.05, 0.88, 7, PALETTE.darkMetal);
  b.box(0.14, 0.90, 0.08, 0.16, 0.05, 0.16, PALETTE.hullDark);
  b.box(0.20, 0.94, 0.08, 0.10, 0.04, 0.12, PALETTE.track);
  // Radar-warning whip.
  b.box(0.04, 0.40, -0.12, 0.02, 0.74, 0.02, PALETTE.metal);
  return b.build();
}

/**
 * Diesel-electric boat with a rounded (cylindrical) pressure-hull casing rather
 * than the donor's flat-sided box, a taller sail with a snorkel, a bow sonar
 * dome and a clean uncluttered deck.
 */
function buildEcSubmarine(): MeshBuffers {
  const b = new MeshBuilder();
  const hull: Color = [0.14, 0.17, 0.17];
  const upper: Color = [0.19, 0.22, 0.22];
  // Rounded casing: a long cylinder with tapered ends.
  b.cylinderX(0.30, 0.42, 0, 0.72, 8.40, 12, hull);
  b.box(0.30, 0.30, 0, 8.40, 0.22, 1.10, hull);
  // Bow: rounded sonar dome plus a raked upper forebody.
  b.sphere(4.46, 0.42, 0, 0.66, 5, 12, hull);
  b.addQuad([4.40, 0.70, -0.62], [4.40, 0.70, 0.62], [4.86, 0.94, 0.20], [4.86, 0.94, -0.20], upper);
  b.box(4.62, 0.30, 0, 0.30, 0.10, 0.62, PALETTE.track);
  // Stern: a tapered tail fairing to the propulsor, not a squared transom.
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2;
    const a1 = ((i + 1) / 10) * Math.PI * 2;
    const p0: Vec3 = [-4.05, 0.42 + Math.sin(a0) * 0.66, Math.cos(a0) * 0.62];
    const p1: Vec3 = [-4.05, 0.42 + Math.sin(a1) * 0.66, Math.cos(a1) * 0.62];
    b.addTriangle(p0, p1, [-5.02, 0.42, 0], hull);
  }
  b.box(-5.24, 0.42, 0, 0.18, 0.24, 0.24, PALETTE.darkMetal);
  b.cylinderX(-5.42, 0.42, 0, 0.30, 0.14, 10, PALETTE.metal);
  // Sail with a raked leading edge, bridge windows and a periscope well.
  b.box(-0.55, 1.12, 0, 1.50, 0.86, 0.74, upper);
  b.addQuad([0.20, 0.74, -0.37], [0.20, 0.74, 0.37], [-0.02, 1.56, 0.31], [-0.02, 1.56, -0.31], hull);
  b.box(-0.50, 1.58, 0, 1.34, 0.08, 0.66, upper);
  b.box(0.16, 1.20, 0, 0.04, 0.20, 0.50, PALETTE.glassDark);
  b.box(0.18, 1.21, 0, 0.02, 0.14, 0.42, PALETTE.glass);
  // Sail-mounted snorkel and periscope bases.
  b.cylinder(-0.10, 1.68, 0, 0.075, 0.16, 8, PALETTE.darkMetal);
  b.cylinder(0.16, 1.66, 0.08, 0.06, 0.12, 7, PALETTE.darkMetal);
  // Bow and stern planes, plus a lower rudder.
  for (const z of [-1.05, 1.05]) {
    b.box(3.60, 0.56, z, 1.00, 0.09, 0.58, hull, 0.95);
    b.box(-3.90, 0.52, z, 0.82, 0.09, 0.38, hull);
  }
  b.box(-4.10, 0.60, 0, 0.62, 0.92, 0.09, hull);
  // Deck hatches, cleats and the team panel on the casing side.
  for (const x of [-3.10, -1.90, 1.30, 2.60]) {
    b.box(x, 1.14, 0, 0.44, 0.05, 0.50, PALETTE.darkMetal);
  }
  for (const z of [-0.74, 0.74]) {
    b.box(0.30, 0.62, z, 1.60, 0.09, 0.02, upper, 0.92);
    b.box(2.90, 0.70, z * 0.86, 0.12, 0.09, 0.12, PALETTE.metal);
    b.box(-2.60, 0.70, z * 0.86, 0.12, 0.09, 0.12, PALETTE.metal);
  }
  // Torpedo-loading rail along the foredeck.
  b.box(2.10, 1.16, 0, 1.90, 0.05, 0.10, PALETTE.metal);
  b.box(3.06, 1.16, 0, 0.16, 0.12, 0.34, PALETTE.darkMetal);
  return b.build();
}

/** Close-in weapon mount for the replenishment ship. */
function buildEcCiws(): MeshBuffers {
  const b = new MeshBuilder();
  b.cylinder(0, -0.14, 0, 0.20, 0.24, 9, PALETTE.darkMetal);
  b.box(0, 0.04, 0, 0.44, 0.20, 0.40, EC_HULL);
  b.box(-0.02, 0.17, 0, 0.52, 0.04, 0.48, EC_HULL_LIGHT, 0.9);
  // Rotating white radome and the single-barrel gun under it.
  b.sphere(-0.04, 0.28, 0, 0.16, 4, 10, PALETTE.white);
  b.box(0.26, 0.08, 0, 0.26, 0.12, 0.16, EC_HULL_DARK);
  b.cylinderX(0.58, 0.09, 0, 0.03, 0.44, 7, PALETTE.darkMetal);
  b.box(0.78, 0.09, 0, 0.06, 0.045, 0.045, PALETTE.track);
  return b.build();
}

/**
 * Replenishment / landing ship: a boxy, high-sided hull with a stern ramp, a
 * deck crane on a kingpost and container rails strapped along the working deck.
 * The donor is a narrow fast attack craft, so the scale and plan view differ at
 * a glance.
 */
function buildEcNavalSupport(): MeshBuffers {
  const b = new MeshBuilder();
  // High, slab-sided hull with a squared bow and a stern ramp.
  b.box(0, 0.52, 0, 10.40, 0.76, 2.40, EC_HULL);
  b.box(0, 0.90, 0, 10.30, 0.14, 2.46, EC_HULL_LIGHT);
  b.addQuad([5.20, 0.16, -1.20], [5.20, 0.16, 1.20], [5.94, 0.42, 0.20], [5.94, 0.42, -0.20], EC_HULL);
  b.addQuad([5.20, 0.90, -1.22], [5.20, 0.90, 1.22], [5.94, 0.60, 0.16], [5.94, 0.60, -0.16], EC_HULL_LIGHT);
  b.addQuad([5.20, 0.16, -1.20], [5.94, 0.42, -0.20], [5.94, 0.60, -0.16], [5.20, 0.90, -1.22], EC_HULL_DARK);
  b.addQuad([5.20, 0.16, 1.20], [5.20, 0.90, 1.22], [5.94, 0.60, 0.16], [5.94, 0.42, 0.20], EC_HULL_DARK);
  // Working deck with a painted lane and cargo tie-down strip.
  b.box(0.10, 1.00, 0, 10.20, 0.10, 2.36, EC_DECK);
  b.box(0.20, 1.06, 0, 6.60, 0.02, 1.10, EC_HULL_LIGHT, 0.9);
  for (let i = 0; i < 9; i++) b.box(-3.40 + i * 0.86, 1.07, 0, 0.10, 0.02, 1.00, PALETTE.track);
  // Forward superstructure: two tiers and a squat funnel.
  b.box(3.30, 1.62, 0, 2.20, 1.24, 2.20, EC_HULL_LIGHT);
  b.box(3.30, 2.24, 0, 2.28, 0.10, 2.26, EC_HULL);
  b.box(3.90, 2.44, 0, 1.20, 0.34, 1.72, EC_HULL_LIGHT);
  b.box(4.50, 1.76, 0, 0.04, 0.34, 2.00, PALETTE.glassDark);
  b.box(4.52, 1.77, 0, 0.02, 0.26, 1.86, PALETTE.glass);
  for (const z of [-1.12, 1.12]) {
    b.box(3.30, 1.72, z, 2.00, 0.26, 0.02, PALETTE.glassDark);
    b.box(3.30, 1.73, z * 1.01, 1.84, 0.19, 0.01, PALETTE.glass);
  }
  b.box(2.60, 3.10, 0, 0.54, 0.92, 0.62, EC_HULL);
  b.box(2.60, 3.52, 0, 0.58, 0.08, 0.66, PALETTE.darkMetal);
  for (let i = 0; i < 3; i++) b.box(2.30, 3.06 + i * 0.14, -0.32, 0.42, 0.05, 0.02, PALETTE.track);
  // Navigation mast with yardarm and a pair of deck floodlights.
  b.box(3.20, 3.20, 0, 0.10, 1.30, 0.10, PALETTE.metal);
  b.box(3.20, 3.56, 0, 1.70, 0.06, 0.09, PALETTE.metal);
  b.box(3.20, 3.86, 0, 0.52, 0.12, 0.14, PALETTE.darkMetal);
  for (const z of [-0.62, 0.62]) {
    b.box(3.70, 2.60, z, 0.16, 0.14, 0.16, PALETTE.white);
  }
  // Kingpost crane amidships with boom, cable and hook.
  b.box(-0.60, 1.76, 0, 0.30, 1.52, 0.30, EC_HULL_DARK);
  b.box(-0.60, 2.52, 0, 0.44, 0.10, 0.44, PALETTE.metal);
  beam(b, [-0.44, 2.44, 0], [1.20, 1.42, 0], 0.20, 0.18, PALETTE.warning);
  b.box(1.14, 1.36, 0, 0.16, 0.12, 0.16, PALETTE.darkMetal);
  b.box(1.28, 1.06, 0, 0.025, 0.58, 0.025, PALETTE.metal);
  b.box(1.28, 0.74, 0, 0.20, 0.16, 0.20, PALETTE.metal);
  // Container rails: six boxes strapped down the working deck.
  for (const x of [-2.30, -3.20, -4.10]) {
    for (const z of [-0.52, 0.52]) {
      b.box(x, 1.30, z, 0.84, 0.58, 0.96, PALETTE.oliveDark);
      b.box(x, 1.60, z, 0.86, 0.04, 0.98, PALETTE.canvas);
      for (const dz of [-0.30, 0.30]) b.box(x, 1.30, z + dz, 0.86, 0.58, 0.03, PALETTE.track);
    }
  }
  // Deck-cargo team panel, lashing eyes and a life raft rack.
  b.box(-2.30, 1.10, 0, 1.10, 0.02, 0.30, EC_HULL_LIGHT, 0.95);
  for (const z of [-1.16, 1.16]) {
    b.box(0.10, 1.14, z, 9.90, 0.05, 0.03, PALETTE.metal);
    for (let i = 0; i < 8; i++) b.box(-4.60 + i * 1.24, 1.21, z, 0.025, 0.16, 0.025, PALETTE.metal);
    b.box(-1.40, 1.06, z * 1.02, 1.60, 0.09, 0.02, EC_HULL_LIGHT, 0.9);
    b.box(1.80, 1.06, z * 1.02, 0.90, 0.14, 0.14, PALETTE.oliveDark);
    b.box(5.10, 0.46, z * 0.72, 0.14, 0.24, 0.18, PALETTE.darkMetal);
  }
  // Stern ramp, hinges and the rope-and-stanchion guard.
  b.addQuad([-5.20, 0.30, -1.18], [-5.20, 0.30, 1.18], [-6.05, 0.72, 1.06], [-6.05, 0.72, -1.06], PALETTE.metal);
  b.addQuad([-5.20, 0.30, 1.18], [-5.20, 0.30, -1.18], [-6.05, 0.24, -1.06], [-6.05, 0.24, 1.06], EC_HULL_DARK);
  b.box(-5.24, 0.68, 0, 0.16, 0.72, 2.36, EC_HULL_DARK);
  for (const z of [-0.70, 0, 0.70]) {
    b.box(-5.34, 0.34, z, 0.18, 0.22, 0.18, PALETTE.metal);
  }
  for (const z of [-1.16, 1.16]) {
    b.box(-6.00, 0.90, z, 0.06, 0.44, 0.06, PALETTE.metal);
  }
  // Twin shafts, screws and a bow thruster tunnel.
  for (const z of [-0.62, 0.62]) {
    b.box(-5.10, 0.26, z, 0.34, 0.34, 0.14, PALETTE.metal);
    b.cylinderX(-5.22, 0.24, z, 0.14, 0.26, 6, PALETTE.darkMetal);
  }
  b.cylinderZ(4.60, 0.34, 0, 0.18, 2.20, 10, PALETTE.track);
  return b.build();
}

export const ALLIANCE_SUPPORT_STYLES: Record<string, EntityStyle> = {
  rifleEC: { body: buildEcRifle(), turretOffset: [0, 0, 0], infantry: ecInfantryRig() },
  atgmEC: { body: buildEcAtgm(), turretOffset: [0, 0, 0], infantry: ecInfantryRig() },
  missileBoatEC: {
    body: buildEcMissileBoat(),
    turret: buildEcFastGun(),
    // Deck is at 0.82; the mount's pedestal reaches it from its own local base.
    turretOffset: [1.10, 0.84, 0],
  },
  corvetteEC: {
    body: buildEcCorvette(),
    turret: buildEcStealthGun(),
    turretOffset: [3.10, 0.92, 0],
  },
  frigateEC: {
    body: buildEcFrigate(),
    turret: buildEcTwinMount(),
    turretOffset: [3.90, 0.98, 0],
  },
  submarineEC: {
    body: buildEcSubmarine(),
    turretOffset: [0, 0, 0],
    periscope: buildEcPeriscope(),
    periscopeOffset: [0, 0.02, 0],
  },
  navalSupportEC: {
    body: buildEcNavalSupport(),
    turret: buildEcCiws(),
    turretOffset: [1.90, 1.06, 0],
  },
};
