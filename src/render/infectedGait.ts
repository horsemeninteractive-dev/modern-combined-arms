/**
 * How each infected archetype walks.
 *
 * Presentation only. The simulation never reads this module: a zombie is a
 * rigid body mesh on the same hip-pivot rig as a rifleman, and the two numbers
 * a stride already needs — the pace a foot unit ramps up when it has a path,
 * and the gait phase that goes with it — are both computed in the renderer.
 * Nothing here reaches the command queue, the director or the network.
 *
 * At battle zoom a body is a few pixels tall, so the read comes from silhouette
 * motion rather than detail: the whole body rocks about its feet, rises on each
 * step and waddles, while the legs swing from the hip. Every archetype is tuned
 * so its motion alone names it at the range a player actually watches them —
 * the shambler limps, the runner sprints, the brute stomps, the bloater rolls
 * and the crawler drags.
 */
export interface InfectedGaitProfile {
  /** Stride cadence relative to the shared foot pace (1 = a rifleman). */
  cadence: number;
  /** Body rise per step, in world units at full pace. */
  bob: number;
  /** Side-to-side roll about the spine, radians at full pace. */
  roll: number;
  /** Fore-aft lurch, radians at full pace. */
  pitch: number;
  /** Yaw waddle, radians at full pace. */
  sway: number;
  /** Constant forward stoop, radians, held even while standing still. */
  lean: number;
  /**
   * Weight of the second harmonic: 0 is an even stride, 1 is a hard limp where
   * one step drops the body further than the next.
   */
  hitch: number;
  /** Leg swing while standing still, radians. */
  legBase: number;
  /** Extra leg swing at full pace, radians. */
  legSwing: number;
  /** Extra forward lean at full commitment to a target, radians. */
  charge: number;
  /** Roll into a hard turn, radians at the reference yaw rate. */
  bank: number;
  /** Extra cadence at full commitment; a closing body strides harder. */
  drive: number;
}

/** Yaw rate, radians per second, treated as a hard pivot for banking. */
export const TURN_REFERENCE = 2;

/** What the fight is doing to the body this frame, both smoothed by the caller. */
export interface InfectedGaitResponse {
  /** Signed yaw rate in radians per second; positive turns to the body's right. */
  turn: number;
  /** 0..1 commitment to closing on a target: 0 idle, 1 at contact. */
  press: number;
}

export interface InfectedGaitPose {
  /** Stride phase in radians, already scaled by the archetype's cadence. */
  stride: number;
  /** Vertical rise, world units; never negative, so feet stay on the ground. */
  bob: number;
  /** Roll about the local forward axis, radians. */
  roll: number;
  /** Fore-aft lurch on top of `lean`, radians; positive leans forward. */
  pitch: number;
  /** Yaw waddle plus turn lead, radians. */
  sway: number;
  /** Stoop plus closing charge, radians; positive leans forward. */
  lean: number;
}

/**
 * The five profiles.
 *
 * Cadence carries most of the read: an infected mass at 0.62 of a rifleman's
 * stride is slow even when the wave is not, and a runner at 1.6 crosses open
 * ground faster than anything on the player's roster can walk. Amplitudes are
 * deliberately small in world units — a 0.075 rise on a brute is a visible
 * stomp at battle zoom without the model leaving its shadow.
 */
export const INFECTED_GAIT: Readonly<Record<string, InfectedGaitProfile>> = Object.freeze({
  zombieShambler: {
    cadence: 0.62,
    bob: 0.045,
    roll: 0.1,
    pitch: 0.055,
    sway: 0.055,
    lean: 0.1,
    hitch: 0.85,
    legBase: 0.1,
    legSwing: 0.55,
    charge: 0.16,
    bank: 0.1,
    drive: 0.35,
  },
  zombieRunner: {
    cadence: 1.6,
    bob: 0.03,
    roll: 0.055,
    pitch: 0.07,
    sway: 0.1,
    lean: 0.22,
    hitch: 0.1,
    legBase: 0.18,
    legSwing: 0.8,
    charge: 0.3,
    bank: 0.16,
    drive: 0.22,
  },
  zombieBrute: {
    cadence: 0.5,
    bob: 0.075,
    roll: 0.12,
    pitch: 0.045,
    sway: 0.03,
    lean: 0.06,
    hitch: 0.45,
    legBase: 0.06,
    legSwing: 0.4,
    charge: 0.1,
    bank: 0.14,
    drive: 0.5,
  },
  zombieBloater: {
    cadence: 0.44,
    bob: 0.03,
    roll: 0.17,
    pitch: 0.03,
    sway: 0.05,
    lean: 0.03,
    hitch: 0.6,
    legBase: 0.05,
    legSwing: 0.32,
    charge: 0.08,
    bank: 0.2,
    drive: 0.45,
  },
  zombieCrawler: {
    cadence: 1.15,
    bob: 0.022,
    roll: 0.09,
    pitch: 0.05,
    sway: 0.14,
    lean: 0.02,
    hitch: 0.35,
    legBase: 0.12,
    legSwing: 0.42,
    charge: 0.12,
    bank: 0.18,
    drive: 0.3,
  },
});

/** The gait of a definition, or null for anything that is not infected. */
export function infectedGaitProfile(defId: string): InfectedGaitProfile | null {
  return Object.hasOwn(INFECTED_GAIT, defId) ? INFECTED_GAIT[defId] : null;
}

const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : Number.isFinite(value) ? value : 0;

/**
 * Shape of the step at a given stride phase and pace.
 *
 * Pure and deterministic: the same phase and pace always produce the same pose,
 * and a stopped body produces no motion at all — only the constant stoop, which
 * is posture rather than animation. That is what keeps a waiting wave from
 * twitching in place.
 */
export function infectedGaitPose(
  profile: InfectedGaitProfile,
  phase: number,
  pace: number,
  response: InfectedGaitResponse = { turn: 0, press: 0 },
): InfectedGaitPose {
  const press = clamp01(response.press);
  // A turn is banked, not snapped: the reference rate is a hard pivot at walking
  // pace, so an ordinary course change reads as a lean into the corner rather
  // than a wall of roll. The sign is the caller's drawn yaw rate, so a right
  // turn banks right.
  const turn = Math.max(-1, Math.min(1, response.turn / TURN_REFERENCE));
  // A closing body strides harder and lurches further on every step.
  const stride = phase * profile.cadence * (1 + profile.drive * press);
  const amp = clamp01(pace);
  const lurch = 1 + 0.55 * press;
  // A limp is a step that is not the mirror of the one before it, so the hitch
  // rides the second harmonic: at 0 the body rocks evenly, at 1 it drops on
  // every other step.
  const rock = Math.sin(stride) + profile.hitch * 0.5 * Math.sin(stride * 2);
  return {
    stride,
    // (1 - cos 2p) / 2 rises twice per stride and never dips below the ground.
    bob: profile.bob * amp * (1 - Math.cos(stride * 2)) * 0.5,
    // The stride rock, plus weight thrown into a corner.
    roll: profile.roll * amp * rock * lurch + profile.bank * turn,
    pitch: profile.pitch * amp * Math.sin(stride * 2) * lurch,
    // The waddle, plus a yaw lead that points the body into the turn.
    sway: profile.sway * amp * Math.sin(stride) + profile.bank * 0.5 * turn,
    // Posture: the stoop it always carries, plus the charge it leans into as it
    // closes. Held rather than oscillated, so a body stopped at contact still
    // presses forward without twitching.
    lean: profile.lean + profile.charge * press,
  };
}

/**
 * Forward swing of one leg, radians. The caller flips the sign for the second
 * leg, which is what keeps the stride out of phase instead of hopping.
 */
export function infectedLegSwing(
  profile: InfectedGaitProfile,
  pose: InfectedGaitPose,
  pace: number,
): number {
  return profile.legBase + profile.legSwing * clamp01(pace) * Math.sin(pose.stride);
}
