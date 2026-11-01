import { buildingSensorProfile, unitSensorProfile, type SensorProfile } from '../data/sensors';
import { darknessAtLight, type DayNightState } from './dayNight';
import type { Entity } from './types';

/**
 * Night-fighting maths.
 *
 * Three separate quantities, deliberately kept apart:
 *
 *  - detection: how far a unit can *see* an enemy in the current light.
 *  - acquisition: how well it can identify and hold a target, which caps the
 *    range at which a weapon is actually usable and how long the crew needs
 *    before the first shot.
 *  - accuracy: a small hit-probability modifier once a shot is taken.
 *
 * A weapon's physical range never changes: a tank gun still throws a shell the
 * same distance at midnight. What changes is how far the crew can find, identify
 * and keep a target, which is why practical engagement range is separate.
 */

/** Deepest darkness still leaves a unit this fraction of its daytime vision. */
export const MIN_NIGHT_DETECTION = 0.45;

/**
 * Practical engagement range never drops below this fraction of the physical
 * range. A night-crippled army could still shoot at all, so the penalty is a
 * real disadvantage for optical crews without making darkness an armistice.
 */
export const MIN_ENGAGEMENT_FACTOR = 0.7;

export function sensorFor(entity: Pick<Entity, 'kind' | 'defId'>): SensorProfile {
  return entity.kind === 'building'
    ? buildingSensorProfile(entity.defId)
    : unitSensorProfile(entity.defId);
}

/**
 * All three quantities scale off the same gameplay darkness, so daylight and
 * dusk are exactly what they were before the clock existed: a fraction of 1 at
 * zero darkness.
 */
function qualityAt(base: number, darkness: number): number {
  return 1 - darkness * (1 - base);
}

/** Fraction of the authored vision radius available in the current light. */
export function visionFactor(profile: SensorProfile, dayNight: Pick<DayNightState, 'light'>): number {
  const darkness = darknessAtLight(dayNight.light);
  return Math.max(MIN_NIGHT_DETECTION, qualityAt(profile.nightVision, darkness));
}

/** Fraction of the physical weapon range that can be practically engaged. */
export function engagementFactor(
  profile: SensorProfile,
  dayNight: Pick<DayNightState, 'light'>,
): number {
  const darkness = darknessAtLight(dayNight.light);
  return Math.max(MIN_ENGAGEMENT_FACTOR, qualityAt(profile.acquire, darkness));
}

/** Hit-probability modifier: at most a quarter penalty, only for poor optics. */
export function accuracyFactor(
  profile: SensorProfile,
  dayNight: Pick<DayNightState, 'light'>,
): number {
  const darkness = darknessAtLight(dayNight.light);
  return 1 - darkness * (1 - profile.acquire) * 0.15;
}

/**
 * Ticks a crew needs on a new target before it may fire. None by day; deep in
 * the night an optical crew needs most of a second, thermal almost none.
 */
export function acquireTicksFor(
  profile: SensorProfile,
  dayNight: Pick<DayNightState, 'light'>,
): number {
  const darkness = darknessAtLight(dayNight.light);
  return Math.round(darkness * (1 - profile.acquire) * 10);
}

/** Whether a light source is actually emitting right now. */
export function illuminatorActive(
  entity: Entity,
  profile: SensorProfile,
  dayNight: Pick<DayNightState, 'light'>,
  moving: boolean,
): boolean {
  if (profile.illuminator === 'none') return false;
  if (darknessAtLight(dayNight.light) <= 0) return false;
  if (entity.kind === 'building') return true;
  if (entity.hp <= 0) return false;
  if (profile.illuminator === 'headlights') return moving;
  if (profile.illuminator === 'searchlight') return moving || entity.state === 'attacking';
  if (profile.illuminator === 'beacon') return true;
  return false;
}
