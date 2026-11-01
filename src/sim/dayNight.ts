import { TICK_RATE } from './constants';

/**
 * Authoritative day/night clock.
 *
 * The clock is a pure function of the authoritative tick and the scenario's
 * authored start time: no wall clock, no frame delta, no per-client state. Every
 * peer that simulates the same tick therefore derives the same hour, the same
 * phase and the same light level, and a restored room resumes the exact time it
 * was snapshotted at.
 *
 * `dayLengthMinutes` is the real number of minutes one in-game day takes, so a
 * 30-minute match at the default 60-minute cycle advances twelve in-game hours.
 * Zero freezes the clock at `startHour` for campaign missions that want a fixed
 * time of day.
 */

export type DayPhase = 'dawn' | 'morning' | 'day' | 'dusk' | 'night';

export const DAY_PHASES: readonly DayPhase[] = ['dawn', 'morning', 'day', 'dusk', 'night'];

export const HOURS_PER_DAY = 24;
export const MINUTES_PER_DAY = HOURS_PER_DAY * 60;

/**
 * Real minutes one in-game day takes when a scenario does not say otherwise:
 * four real hours, so an in-game hour lasts ten real minutes. A standard
 * skirmish therefore sees one phase, and a long match crosses dusk into night
 * near its end rather than being plunged into darkness three minutes in.
 */
export const DEFAULT_DAY_LENGTH_MINUTES = 240;

/** Deepest night still leaves this much ambient light: never pitch black. */
export const NIGHT_LIGHT_FLOOR = 0.06;

/**
 * Ambient light at which night fighting starts. Above this the battlefield is
 * bright enough that sensors, engagement range and accuracy are unaffected.
 */
export const NIGHT_STARTS_LIGHT = 0.5;

/** Gameplay darkness for an ambient light level: 0 in daylight, 1 at full night. */
export function darknessAtLight(light: number): number {
  const clamp = Math.max(0, Math.min(1, light));
  if (clamp >= NIGHT_STARTS_LIGHT) return 0;
  return 1 - clamp / NIGHT_STARTS_LIGHT;
}

export interface DayNightConfig {
  /** In-game hour the match starts at, 0..24. */
  startHour: number;
  /** Real minutes per in-game day; 0 freezes the clock. */
  dayLengthMinutes: number;
}

export interface DayNightState {
  /** In-game hour, 0..24. */
  hour: number;
  phase: DayPhase;
  /** 0 = full night, 1 = full daylight. */
  light: number;
  /** Convenience inverse of `light`, 0 by day. */
  night: number;
  /**
   * Gameplay darkness, 0 until the light actually starts to go. Dusk and early
   * dawn are dim to look at but still fight like daylight, so a scenario
   * authored at dusk keeps its balance; the penalties ramp in from
   * `NIGHT_STARTS_LIGHT` down to full night.
   */
  darkness: number;
  /** Whole in-game day counter, starting at 0. */
  day: number;
  /** True when the clock is frozen at the scenario's start hour. */
  frozen: boolean;
}

/** Authored start hours per legacy phase label, so old scenarios keep their look. */
export const PHASE_START_HOURS: Record<'dawn' | 'day' | 'dusk' | 'night', number> = {
  dawn: 5.5,
  day: 12,
  dusk: 18,
  night: 22,
};

export function normaliseStartHour(value: unknown, fallback = PHASE_START_HOURS.dusk): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const wrapped = ((n % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  return wrapped;
}

export function normaliseDayLength(value: unknown, fallback = DEFAULT_DAY_LENGTH_MINUTES): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  // 24 in-game hours in under a minute is a strobe, not a day; an hour per day
  // is a curiosity. The band keeps the setting meaningful without hard limits
  // leaking into any single UI.
  if (n > 0 && n < 1) return 1;
  return Math.min(240, n);
}

export function configFromPhase(phase: string | undefined, dayLengthMinutes?: number): DayNightConfig {
  const key = (phase === 'dawn' || phase === 'day' || phase === 'dusk' || phase === 'night'
    ? phase
    : 'dusk') as keyof typeof PHASE_START_HOURS;
  return {
    startHour: PHASE_START_HOURS[key],
    dayLengthMinutes: normaliseDayLength(dayLengthMinutes, DEFAULT_DAY_LENGTH_MINUTES),
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Ambient light for an hour: dusk and dawn ramp, night sits on a floor. */
export function lightAtHour(hour: number): number {
  const h = ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  if (h < 4) return NIGHT_LIGHT_FLOOR;
  if (h < 7) return NIGHT_LIGHT_FLOOR + (1 - NIGHT_LIGHT_FLOOR) * smoothstep(4, 7, h);
  if (h < 16.5) return 1;
  if (h < 19.8) return 1 - (1 - NIGHT_LIGHT_FLOOR) * smoothstep(16.5, 19.8, h);
  return NIGHT_LIGHT_FLOOR;
}

export function phaseAtHour(hour: number): DayPhase {
  const h = ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  if (h >= 4.5 && h < 7) return 'dawn';
  if (h >= 7 && h < 11) return 'morning';
  if (h >= 11 && h < 16.5) return 'day';
  if (h >= 16.5 && h < 19.5) return 'dusk';
  return 'night';
}

/** Authoritative time for a tick. Pure: same tick, same config, same answer. */
export function dayNightAt(tick: number, config: DayNightConfig): DayNightState {
  const startHour = normaliseStartHour(config.startHour);
  const dayLength = normaliseDayLength(config.dayLengthMinutes);
  const safeTick = Number.isFinite(tick) && tick > 0 ? tick : 0;
  const elapsedSeconds = safeTick / TICK_RATE;
  let hour = startHour;
  let day = 0;
  if (dayLength > 0) {
    const daySeconds = dayLength * 60;
    const days = elapsedSeconds / daySeconds;
    day = Math.floor(days);
    hour = (startHour + days * HOURS_PER_DAY) % HOURS_PER_DAY;
  }
  const light = lightAtHour(hour);
  return {
    hour,
    phase: phaseAtHour(hour),
    light,
    night: 1 - light,
    darkness: darknessAtLight(light),
    day,
    frozen: dayLength <= 0,
  };
}

/** Twenty-four hour clock label, e.g. `18:42`. */
export function formatHour(hour: number): string {
  const h = ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  const hours = Math.floor(h);
  const minutes = Math.floor((h - hours) * 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** The phase a start hour is usually called, folding morning into day. */
export function phaseForStartHour(hour: number): 'dawn' | 'day' | 'dusk' | 'night' {
  const phase = phaseAtHour(hour);
  if (phase === 'morning') return 'day';
  return phase;
}

export const PHASE_LABELS: Record<DayPhase, string> = {
  dawn: 'Dawn',
  morning: 'Morning',
  day: 'Day',
  dusk: 'Dusk',
  night: 'Night',
};

/** Short HUD hint about what the current light is doing to visibility. */
export function phaseOpportunity(phase: DayPhase): string {
  if (phase === 'night') return 'Night — visual detection and acquisition degraded';
  if (phase === 'dusk') return 'Dusk — light falling, ranges shortening';
  if (phase === 'dawn') return 'Dawn — light returning, thermal no longer decisive';
  return 'Day — full visual detection';
}
