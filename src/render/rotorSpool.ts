/**
 * Rotor spool model.
 *
 * Blade speed is what ramps, not the blade angle, so a helicopter reads as a
 * machine starting up rather than as an animation being switched on: the
 * starter cranks the disc slowly, the engine then accelerates it toward full
 * rate, and a shutdown coasts for several seconds on the disc's own inertia.
 * Everything here is presentation-only; the simulation never reads rotor state.
 */

/** Normalised blade speed the starter motor reaches before combustion catches. */
export const ROTOR_IDLE = 0.15;
/** Seconds for the starter to crank the disc up to idle speed. */
const ROTOR_STARTER = 0.8;
/** Spool-up time constant: blades pass 95 % of full rate about four seconds in. */
const ROTOR_SPOOL_UP = 1.2;
/** Coast-down time constant; the disc turns for roughly five seconds on landing. */
const ROTOR_SPIN_DOWN = 1.35;
/** Blade speed below which the disc is treated as stopped. */
export const ROTOR_STOPPED = 0.02;

/**
 * Advance the normalised blade speed by one frame.
 *
 * `power` is 0 at rest and 1 at full rate. Spool-up is a starter phase followed
 * by an exponential acceleration toward full rate; coast-down is a pure
 * exponential decay, which is what keeps a landed disc turning visibly before it
 * stops instead of freezing mid-turn.
 */
export function stepRotorPower(power: number, aloft: boolean, dt: number): number {
  if (dt <= 0) return power;
  if (aloft) {
    if (power < ROTOR_IDLE) {
      return Math.min(ROTOR_IDLE, power + (dt * ROTOR_IDLE) / ROTOR_STARTER);
    }
    return power + (1 - power) * (1 - Math.exp(-dt / ROTOR_SPOOL_UP));
  }
  if (power <= 0) return 0;
  const next = power * Math.exp(-dt / ROTOR_SPIN_DOWN);
  return next < ROTOR_STOPPED ? 0 : next;
}
