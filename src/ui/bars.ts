/**
 * Shared presentation rules for the battlefield's health and supply readouts.
 *
 * The overlay canvas and the DOM selection panel must agree about what "wounded"
 * means and how many pips a partially spent magazine shows, so the tone ramp and
 * the pip layout live here instead of being re-derived in each renderer. These
 * are pure functions: no canvas, no DOM, no simulation.
 */

export type HealthTone = 'ok' | 'wounded' | 'critical';
export type SupplyTone = 'ok' | 'low' | 'critical';

/** Tick marks across a health bar. Ten reads as a scale, not as noise. */
export const HEALTH_SEGMENTS = 10;
/** More pips than this stop being countable at battle zoom. */
export const MAX_AMMO_PIPS = 12;

export const HEALTH_COLORS: Readonly<Record<HealthTone, string>> = Object.freeze({
  ok: '#86c791',
  wounded: '#e0a34a',
  critical: '#ef6c4d',
});

/** The bar's soft rim, used for the low-health pulse and the damage hatch. */
export const HEALTH_SOFT_COLORS: Readonly<Record<HealthTone, string>> = Object.freeze({
  ok: '#b6e3bd',
  wounded: '#f1c27e',
  critical: '#ffb29b',
});

export function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * The same two breakpoints the battlefield bar has always used: above 60% a
 * hull is sound, above 30% it is wounded, and below that it is critical.
 */
export function healthTone(fraction: number): HealthTone {
  const f = clampFraction(fraction);
  return f > 0.6 ? 'ok' : f > 0.3 ? 'wounded' : 'critical';
}

export function healthColor(fraction: number): string {
  return HEALTH_COLORS[healthTone(fraction)];
}

export function healthSoftColor(fraction: number): string {
  return HEALTH_SOFT_COLORS[healthTone(fraction)];
}

export function healthPercent(fraction: number): number {
  return Math.round(clampFraction(fraction) * 100);
}

/**
 * How many of the bar's cells carry fill. A partly filled cell rounds up so a
 * structure at 4% still shows one lit cell instead of an empty-looking track.
 */
export function healthSegments(fraction: number, segments = HEALTH_SEGMENTS): number {
  const f = clampFraction(fraction);
  if (f <= 0) return 0;
  const count = Math.max(1, Math.round(segments));
  return Math.min(count, Math.ceil(f * count - 1e-9));
}

/**
 * Critical hulls pulse. The return value is an additive 0..1 weight for the
 * bar's outer glow; it is zero for every other tone and when the player has
 * asked for reduced motion.
 */
export function healthPulse(fraction: number, now: number, reducedMotion = false): number {
  if (reducedMotion || healthTone(fraction) !== 'critical') return 0;
  return 0.5 + 0.5 * Math.sin(now / 180);
}

/** One pip per round, live ones first. A cap keeps a long battery readable. */
export function ammoPips(ammo: number, maxAmmo: number): boolean[] {
  const max = Math.max(0, Math.min(MAX_AMMO_PIPS, Math.round(maxAmmo)));
  if (max === 0) return [];
  const live = Math.max(0, Math.min(max, Math.round(ammo)));
  return Array.from({ length: max }, (_, index) => index < live);
}

/** Endurance tone: half a tank is workable, a fifth is a decision. */
export function supplyTone(fraction: number): SupplyTone {
  const f = clampFraction(fraction);
  return f > 0.5 ? 'ok' : f > 0.2 ? 'low' : 'critical';
}

export function fuelFraction(fuel: number, maxFuel: number): number {
  if (!Number.isFinite(maxFuel) || maxFuel <= 0) return 0;
  return clampFraction(fuel / maxFuel);
}

export function fuelPercent(fuel: number, maxFuel: number): number {
  return Math.round(fuelFraction(fuel, maxFuel) * 100);
}

/**
 * How much of a turnaround is done, 0..1, for the ring over a servicing hull.
 *
 * The simulation counts the timer down from `serviceTotal`, so the ring reads
 * the complement: empty when the crew starts, full the moment the hull is
 * declared ready. A hull with no service model reports 0 rather than a full
 * ring that never happened.
 */
export function serviceProgress(serviceTimer: number, serviceTotal: number): number {
  if (!Number.isFinite(serviceTimer) || !Number.isFinite(serviceTotal) || serviceTotal <= 0) return 0;
  return clampFraction(1 - serviceTimer / serviceTotal);
}

/**
 * Only aircraft and ships carry the sustained-consumption model that makes a
 * service strip worthwhile; a tank's ammunition already lives in its stat row.
 */
export function hasServiceStrip(domain: string | undefined): boolean {
  return domain === 'air' || domain === 'naval';
}

/** Row height of the fuel rail and the ammunition pips, in overlay pixels. */
export const SERVICE_ROW_HEIGHT = 3;

/**
 * Layout for the selected aircraft's or ship's service strip.
 *
 * The strip lives under the hull's health plate. A six-round ship and a fuel
 * rail cannot share one row inside a 36px plate, so the rail and the magazine
 * get a row each and the pip pitch tightens only when a rack would still
 * overrun the plate. Both callers read the same numbers, so the drawn strip
 * can never spill sideways out of the bar it belongs to.
 */
export interface ServiceStripLayout {
  /** Height of the fuel rail, or 0 when the hull has no endurance model. */
  fuelRow: number;
  /** Height of the magazine row, or 0 when the hull carries no rounds. */
  ammoRow: number;
  rowGap: number;
  pipWidth: number;
  pipGap: number;
  ammoWidth: number;
  contentHeight: number;
}

export function serviceStripLayout(
  ammo: number,
  maxAmmo: number,
  maxFuel: number,
  width: number,
): ServiceStripLayout {
  const pips = ammoPips(ammo, maxAmmo);
  const usable = Math.max(1, width);
  let pipWidth = 3;
  let pipGap = 2;
  const rack = (): number =>
    pips.length > 0 ? pips.length * (pipWidth + pipGap) - pipGap : 0;
  if (pips.length > 1 && rack() > usable) pipGap = 1;
  while (pipWidth > 1 && rack() > usable) {
    pipWidth -= 1;
    pipGap = 1;
  }
  const fuelRow = maxFuel > 0 ? SERVICE_ROW_HEIGHT : 0;
  const ammoRow = pips.length > 0 ? SERVICE_ROW_HEIGHT : 0;
  const rowGap = fuelRow > 0 && ammoRow > 0 ? 2 : 0;
  return {
    fuelRow,
    ammoRow,
    rowGap,
    pipWidth,
    pipGap,
    ammoWidth: rack(),
    contentHeight: fuelRow + rowGap + ammoRow,
  };
}
