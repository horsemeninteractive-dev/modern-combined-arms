/**
 * The battlefield's bed: the loops that make the map audible when nothing is
 * firing — engines, tracks, rotors, marching boots and working structures.
 *
 * Selection is pure so the mix can be tested without a Web Audio graph. The
 * audio engine only turns the resulting plan into oscillators; the app only
 * describes the world and projects it. Both sides therefore stay dumb, and the
 * interesting decision (which family a hull belongs to, what is close enough to
 * be heard, and how loud) lives here.
 *
 * Everything is positional in screen space rather than on the ground: the app
 * hands each source the camera's own projection, so a hull up the frame, a hull
 * to the right of the focus and the zoom level all move the mix the way the
 * picture does.
 */

/**
 * One moving family. A scout jeep, a main battle tank and a section on foot are
 * deliberately different voices, not the same engine at a different pitch.
 */
export type AmbienceKind =
  | 'foot'
  | 'buggy'
  | 'truck'
  | 'trackedLight'
  | 'trackedHeavy'
  | 'rotor'
  | 'jet'
  | 'naval'
  | 'facility';

export interface AmbienceCandidate {
  /** Entity id: the same hull keeps its voice across frames. */
  id: number;
  kind: AmbienceKind;
  /**
   * Screen position of the source in normalised device coordinates: -1 is the
   * left/top edge of the viewport, 1 the right/bottom. The app projects through
   * the live camera, so pan, loudness and brightness all follow the picture —
   * including zoom, which widens the same world distance in these units.
   */
  sx: number;
  sy: number;
  /** Loudness of the source in its own right, 0..1. */
  level: number;
  /** Frequency multiplier over the kind's base tone. */
  pitch?: number;
  /**
   * 0 standing still, 1 at full speed. Motion is a timbre control, not just a
   * volume: the engine opens the filter and starts the family's clatter only as
   * this rises, so a parked tank and a rolling one are different sounds rather
   * than the same drone at two levels.
   */
  motion?: number;
}

export interface AmbienceVoice {
  id: number;
  kind: AmbienceKind;
  gain: number;
  pan: number;
  pitch: number;
  /** 0 at the centre of the frame, 1 at the edge: distance dulls the voice. */
  muffle: number;
  /** 0 at rest, 1 under way: how much the engine opens and clatters. */
  motion: number;
}

export interface AmbienceMix {
  limit?: number;
  /**
   * Trim for the current framing. Close framing is the player leaning into the
   * battle, so the bed comes up with it; a wide view sits further back and
   * quieter instead of stacking every hull in the middle of the frame.
   */
  gainScale?: number;
}

/**
 * Live loops the bed may carry at once. Every voice is an oscillator, a noise
 * source, a filter, a panner and a modulation oscillator, so the ceiling is a
 * real cost on a busy map and only the nearest sources earn a slot.
 */
export const MAX_AMBIENCE_VOICES = 7;

/** Sources stay faintly audible past the frame edge, then fall silent. */
const AUDIBLE_SPAN = 1.45;
/** Gain falls away a little faster than linearly, so the focus dominates. */
const FALLOFF = 1.35;
/** Below this the voice contributes nothing but node churn. */
const SILENCE = 0.004;
const MIN_PITCH = 0.55;
const MAX_PITCH = 1.9;
/** Hard panning a whole bed is unpleasant; stop short of the edge. */
const MAX_PAN = 0.9;

export function clampAmbiencePitch(pitch: number | undefined): number {
  if (pitch === undefined || !Number.isFinite(pitch)) return 1;
  return Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch));
}

/**
 * Which candidates are audible this frame, nearest first.
 *
 * Distance is measured in screen space, which is what makes the mix positional:
 * a hull behind the focus and a hull up the frame both fall away, and zooming
 * in narrows the audible area around the focus instead of scaling the whole bed.
 * Panning is the horizontal half of the same offset.
 */
export function ambiencePlan(
  candidates: readonly AmbienceCandidate[],
  mix: AmbienceMix = {},
): AmbienceVoice[] {
  const scale = Number.isFinite(mix.gainScale) ? Math.max(0, mix.gainScale as number) : 1;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const scored: Array<{ distance: number; voice: AmbienceVoice }> = [];
  const seen = new Set<number>();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.sx) || !Number.isFinite(candidate.sy)) continue;
    if (!Number.isFinite(candidate.level) || candidate.level <= 0) continue;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const distance = Math.hypot(candidate.sx, candidate.sy);
    if (!Number.isFinite(distance) || distance >= AUDIBLE_SPAN) continue;
    const gain = Math.min(1, candidate.level) * scale * Math.pow(1 - distance / AUDIBLE_SPAN, FALLOFF);
    if (gain <= SILENCE) continue;
    scored.push({
      distance,
      voice: {
        id: candidate.id,
        kind: candidate.kind,
        gain,
        pan: Math.max(-MAX_PAN, Math.min(MAX_PAN, candidate.sx * MAX_PAN)),
        pitch: clampAmbiencePitch(candidate.pitch),
        muffle: Math.min(1, distance / AUDIBLE_SPAN),
        motion: Number.isFinite(candidate.motion)
          ? Math.max(0, Math.min(1, candidate.motion as number))
          : 0.5,
      },
    });
  }
  scored.sort((a, b) => a.distance - b.distance);
  const wanted = mix.limit ?? MAX_AMBIENCE_VOICES;
  const cap = Math.max(1, Math.min(MAX_AMBIENCE_VOICES, Math.floor(wanted)));
  return scored.slice(0, cap).map((entry) => entry.voice);
}

/**
 * How loud the bed sits for a given framing, from the camera's half-height.
 *
 * Reference is the battle framing (36 world units of half-height): zooming in
 * pushes the bed up to 1.6x as the player leans into the action, and pulling
 * out fades it to 0.35x so a whole map does not drone at once.
 */
export function framingGain(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.max(0.35, Math.min(1.6, 36 / zoom));
}

/**
 * A finished structure's own noise, or null for one that stands silent.
 *
 * Power generation is the loudest thing a base does — the turbine whine is how
 * a player learns their grid is alive — then the economy and production halls.
 * A bare defence emplacement is deliberately silent: guns have their own cues.
 */
export function structureAmbience(def: {
  power?: number;
  refinery?: boolean;
  airfield?: boolean;
  radar?: boolean;
  productionList?: readonly string[];
}): { pitch: number; level: number } | null {
  if (typeof def.power === 'number' && def.power > 0) return { pitch: 1.18, level: 0.58 };
  if (def.refinery) return { pitch: 0.84, level: 0.5 };
  if (def.productionList && def.productionList.length > 0) return { pitch: 1, level: 0.46 };
  if (def.airfield) return { pitch: 1.3, level: 0.42 };
  if (def.radar) return { pitch: 1.42, level: 0.32 };
  if (typeof def.power === 'number' && def.power < 0) return { pitch: 0.92, level: 0.3 };
  return null;
}

export interface UnitAmbienceInput {
  domain: string;
  moveClass: string;
  armour: string;
  role: string;
  speed: number;
  moving: boolean;
  harvesting: boolean;
  garrisoned: boolean;
  dived: boolean;
}

/**
 * The family a unit moves as. This is the whole reason a jeep no longer sounds
 * like a tank: the drive class picks the machinery, and armour weight separates
 * a light hull from a main battle tank within the same drive class.
 *
 * `moveClass` is the authored authority; armour and role only refine it. Infantry
 * on foot are their own family (boots, not pistons), helicopters get blades and
 * fixed-wing aircraft a turbine whine, and hulls in the water move as ships.
 */
export function driveProfile(input: {
  domain: string;
  moveClass: string;
  armour: string;
  role: string;
  speed: number;
}): AmbienceKind | null {
  if (input.moveClass === 'air' || input.domain === 'air') {
    return /rotary|helicopter/i.test(input.role) ? 'rotor' : 'jet';
  }
  if (input.moveClass === 'naval' || input.domain === 'naval') return 'naval';
  if (input.moveClass === 'foot' || input.armour === 'infantry') return 'foot';
  // A fast wheeled hull is a light petrol scout; a slow one is a laden truck,
  // launcher or recovery vehicle under a heavy diesel.
  if (input.moveClass === 'wheeled') return input.speed >= 3.1 ? 'buggy' : 'truck';
  if (input.moveClass === 'tracked') {
    return input.armour === 'heavy' ? 'trackedHeavy' : 'trackedLight';
  }
  return null;
}

/**
 * A unit's own movement voice, or null when it has nothing to say.
 *
 * A stationary hull is not silent — an idling diesel is how a player hears that
 * an army is parked just off the frame — but it is quieter and duller than one
 * under way. Each family carries its own loudness: a section on foot is a
 * whisper next to a tank, which is exactly how the battlefield should read.
 */
export function unitAmbience(
  input: UnitAmbienceInput,
): { kind: AmbienceKind; level: number; pitch: number; motion: number } | null {
  if (input.garrisoned || input.dived) return null;
  if (input.speed <= 0) return null;
  const kind = driveProfile({
    domain: input.domain,
    moveClass: input.moveClass,
    armour: input.armour,
    role: input.role,
    speed: input.speed,
  });
  if (!kind) return null;

  // A working harvester is a diesel under load, whatever its drive class.
  if (input.harvesting) return { kind: 'truck', level: 0.86, pitch: 0.6, motion: 0.85 };

  const pace = Math.min(1, Math.max(0, input.speed / 6));
  const moving = input.moving;
  // Idle is deliberately a different sound, not a quieter one: motion 0 closes
  // the filter to a smooth hum and takes the clatter out entirely, while a hull
  // under way opens up and throws its links, treads or blades.
  switch (kind) {
    case 'foot':
      // Boots carry a couple of tiles and stop: infantry never fill the frame.
      return moving
        ? { kind, level: 0.4, pitch: 0.98 + 0.1 * pace, motion: 0.75 + 0.25 * pace }
        : { kind, level: 0.1, pitch: 0.8, motion: 0 };
    case 'buggy':
      return moving
        ? { kind, level: 0.56 + 0.16 * pace, pitch: 1.04 + 0.14 * pace, motion: 0.6 + 0.4 * pace }
        : { kind, level: 0.16, pitch: 0.82, motion: 0 };
    case 'truck':
      return moving
        ? { kind, level: 0.66 + 0.2 * pace, pitch: 0.86 + 0.1 * pace, motion: 0.55 + 0.45 * pace }
        : { kind, level: 0.26, pitch: 0.72, motion: 0 };
    case 'trackedLight':
      return moving
        ? { kind, level: 0.7 + 0.2 * pace, pitch: 0.9 + 0.12 * pace, motion: 0.6 + 0.4 * pace }
        : { kind, level: 0.24, pitch: 0.74, motion: 0 };
    case 'trackedHeavy':
      return moving
        ? { kind, level: 0.84 + 0.16 * pace, pitch: 0.78 + 0.1 * pace, motion: 0.6 + 0.4 * pace }
        : { kind, level: 0.3, pitch: 0.66, motion: 0 };
    case 'rotor':
      // Blades never really stop on an aircraft still in the air.
      return moving
        ? { kind, level: 0.6 + 0.16 * pace, pitch: 0.94 + 0.12 * pace, motion: 0.9 }
        : { kind, level: 0.26, pitch: 0.9, motion: 0.35 };
    case 'jet':
      return moving
        ? { kind, level: 0.66 + 0.2 * pace, pitch: 1.1 + 0.16 * pace, motion: 0.9 }
        : { kind, level: 0.16, pitch: 0.96, motion: 0.1 };
    case 'naval':
      return moving
        ? { kind, level: 0.6 + 0.18 * pace, pitch: 0.8 + 0.1 * pace, motion: 0.5 + 0.4 * pace }
        : { kind, level: 0.22, pitch: 0.68, motion: 0 };
    default:
      return null;
  }
}
