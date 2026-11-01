import type { UnitDef } from './types';

/**
 * Battlefield weather.
 *
 * Weather is authored on the scenario and constant for the whole battle, so it
 * needs no clock, no sync message and no per-client state: every peer reads the
 * same scenario and therefore the same profile. That keeps it deterministic by
 * construction — the multiplayer room never has to stream it.
 *
 * Every number below is a multiplier on something the simulation already
 * computes, which is deliberate. Light is already modelled by `dayNight` and
 * the sensors that read it, elevation already gates line of sight, and terrain
 * already sets movement cost and cover. Weather adds one more independent
 * factor, so the four stack instead of replacing each other: a rain-swept
 * night on soft ground is genuinely worse than any one of them alone.
 *
 *   detection  shortened by visibility
 *   engagement shortened by acquisition
 *   precision  reduced by accuracy (direct) and dispersion (indirect)
 *   mobility   reduced by groundSpeed / airSpeed
 */

export type WeatherKind = 'clear' | 'overcast' | 'fog' | 'rain' | 'storm' | 'snow' | 'blizzard';

export interface WeatherProfile {
  kind: WeatherKind;
  label: string;
  /** One line for a briefing panel. */
  hint: string;
  /** Fraction of the authored vision radius. */
  visibility: number;
  /** Fraction of the practical (identify-and-hold) engagement range. */
  acquisition: number;
  /** Direct-fire hit-probability multiplier. */
  accuracy: number;
  /** Indirect-fire scatter multiplier; above 1 means a wider pattern. */
  dispersion: number;
  /** Ground movement multiplier. */
  groundSpeed: number;
  /** Air movement multiplier. */
  airSpeed: number;
  /** Wind, tiles per second. Drives smoke drift and precipitation angle. */
  wind: readonly [number, number];
  /**
   * Precipitation intensity, where 1 is a steady fall. This is a multiplier on
   * the renderer's emission rate rather than a 0..1 fraction, so a storm can be
   * twice the rain of a plain wet day instead of both capping at "full".
   */
  precipitation: number;
  /** How much the sky is lifted/flattened, 0..1. */
  gloom: number;
  /**
   * How far the light is knocked down, 0..1. Gloom lifts the ambient floor so
   * shadows stop reading as hard edges; dim is the other half of the same sky —
   * a storm is genuinely darker to look at, not merely flatter.
   */
  dim: number;
  /**
   * How wet the ground is, 0..1. Wet ground darkens and takes a specular sheen
   * from the sun; snow is bright and matte rather than wet, so it stays at 0.
   */
  wet: number;
  /** Fraction of the sun's cast shadows that survive; overcast kills them. */
  shadow: number;
  /**
   * Atmospheric thickness, 0..1 per world unit of view distance. Drives the
   * distance haze every lit shader applies and the density of drifting mist, so
   * a fog map really does fade out instead of merely being dimmer.
   */
  haze: number;
  /**
   * Sea state, 0..1. Drives wave height, whitecaps and spray in the renderer,
   * and is the physical cause of the two naval penalties below: at 0 the water
   * is glass, at 1 it is a breaking sea.
   */
  sea: number;
  /** Naval movement multiplier. A head sea is a drag on a hull, not a wall. */
  navalSpeed: number;
  /**
   * Naval detection multiplier. Spray, a working deck and a hull that will not
   * hold a steady glass all shorten a watch's reach in a seaway.
   */
  navalVision: number;
}

/**
 * `clear` is the identity everywhere, so a scenario that never asked for
 * weather fights exactly the battle it did before this module existed.
 */
export const WEATHER: Record<WeatherKind, WeatherProfile> = {
  clear: {
    kind: 'clear',
    label: 'Clear',
    hint: 'Full visibility, full engagement range, dry ground.',
    visibility: 1,
    acquisition: 1,
    accuracy: 1,
    dispersion: 1,
    groundSpeed: 1,
    airSpeed: 1,
    wind: [0.25, 0.1],
    precipitation: 0,
    gloom: 0,
    dim: 0,
    wet: 0,
    shadow: 1,
    haze: 0.00012,
    sea: 0.12,
    navalSpeed: 1,
    navalVision: 1,
  },
  overcast: {
    kind: 'overcast',
    label: 'Overcast',
    hint: 'Flat light: slightly shorter identification, no mobility cost.',
    visibility: 0.94,
    acquisition: 0.96,
    accuracy: 0.97,
    dispersion: 1.05,
    groundSpeed: 1,
    airSpeed: 0.98,
    wind: [0.6, 0.25],
    precipitation: 0,
    gloom: 0.35,
    dim: 0.06,
    wet: 0,
    shadow: 0.55,
    haze: 0.00042,
    sea: 0.24,
    navalSpeed: 0.99,
    navalVision: 0.98,
  },
  fog: {
    kind: 'fog',
    label: 'Fog',
    hint: 'Ground mist: detection cut to half range, no mobility cost, dry going.',
    visibility: 0.52,
    acquisition: 0.7,
    accuracy: 0.86,
    dispersion: 1.2,
    groundSpeed: 0.99,
    airSpeed: 0.92,
    wind: [0.35, 0.15],
    precipitation: 0,
    gloom: 0.72,
    dim: 0.12,
    wet: 0.12,
    shadow: 0.2,
    // Fog is the whole point of the profile: about 0.85 extinction across a
    // full screen of view, so the far bank is gone and the near ground reads.
    haze: 0.0126,
    sea: 0.3,
    navalSpeed: 0.98,
    navalVision: 0.86,
  },
  rain: {
    kind: 'rain',
    label: 'Rain',
    hint: 'Wet optics and soft ground: shorter detection, slower hulls, wider artillery patterns.',
    visibility: 0.78,
    acquisition: 0.84,
    accuracy: 0.88,
    dispersion: 1.35,
    groundSpeed: 0.91,
    airSpeed: 0.95,
    wind: [1.6, 0.6],
    precipitation: 1,
    gloom: 0.62,
    dim: 0.2,
    wet: 0.85,
    shadow: 0.3,
    haze: 0.00132,
    sea: 0.52,
    navalSpeed: 0.93,
    navalVision: 0.9,
  },
  storm: {
    kind: 'storm',
    label: 'Storm',
    hint: 'Driving rain and gale: detection collapses, aircraft crawl, direct fire is a coin toss.',
    visibility: 0.6,
    acquisition: 0.68,
    accuracy: 0.74,
    dispersion: 1.75,
    groundSpeed: 0.86,
    airSpeed: 0.78,
    wind: [3.2, -1.1],
    precipitation: 2,
    gloom: 0.88,
    dim: 0.46,
    wet: 1,
    shadow: 0.1,
    haze: 0.00287,
    sea: 0.94,
    navalSpeed: 0.76,
    navalVision: 0.68,
  },
  snow: {
    kind: 'snow',
    label: 'Snow',
    hint: 'Whiteout haze and frozen going: shortened detection, heavy mobility penalty.',
    visibility: 0.7,
    acquisition: 0.76,
    accuracy: 0.82,
    dispersion: 1.4,
    groundSpeed: 0.8,
    airSpeed: 0.86,
    wind: [1.1, 0.4],
    precipitation: 1.1,
    gloom: 0.6,
    dim: 0.14,
    wet: 0,
    shadow: 0.45,
    haze: 0.00166,
    sea: 0.42,
    navalSpeed: 0.94,
    navalVision: 0.92,
  },
  blizzard: {
    kind: 'blizzard',
    label: 'Blizzard',
    hint: 'Whiteout and killing wind: sight falls away, armour crawls, aircraft barely fly.',
    visibility: 0.36,
    acquisition: 0.48,
    accuracy: 0.58,
    dispersion: 2,
    groundSpeed: 0.62,
    airSpeed: 0.5,
    wind: [3.8, -1.6],
    precipitation: 2.1,
    gloom: 0.96,
    dim: 0.34,
    wet: 0,
    shadow: 0.08,
    haze: 0.00802,
    sea: 1,
    navalSpeed: 0.62,
    navalVision: 0.55,
  },
};

export const WEATHER_KINDS: readonly WeatherKind[] = [
  'clear',
  'overcast',
  'fog',
  'rain',
  'storm',
  'snow',
  'blizzard',
];

export function isWeatherKind(value: unknown): value is WeatherKind {
  return typeof value === 'string' && (WEATHER_KINDS as readonly string[]).includes(value);
}

/** Never throws: an unknown or missing kind is a clear day. */
export function normaliseWeather(value: unknown): WeatherKind {
  return isWeatherKind(value) ? value : 'clear';
}

export function weatherFor(value: unknown): WeatherProfile {
  return WEATHER[normaliseWeather(value)];
}

/**
 * Movement multiplier for a domain.
 *
 * Every domain is taxed by its own half of the weather. Aircraft lose to wind,
 * hulls to a head sea, and ground units to the state of the going. A naval
 * unit in a flat calm is still at 1, so a sea battle on a clear day is exactly
 * the battle it was before this existed.
 */
export function weatherSpeedFactor(
  domain: UnitDef['domain'],
  profile: WeatherProfile,
): number {
  if (domain === 'air') return profile.airSpeed;
  if (domain === 'naval') return profile.navalSpeed;
  return profile.groundSpeed;
}

/** Combined profile + light for a one-line briefing. */
export function weatherHint(value: unknown): string {
  return weatherFor(value).hint;
}
