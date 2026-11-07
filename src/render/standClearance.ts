import type { PropInstance } from './gl';

/**
 * Landing clearance markers.
 *
 * An airfield's stand paint says where aircraft *may* sit. This says which bay
 * one *is* being given, right now: the apron frame over the bay a hull on final
 * approach will set down on, waking up while it is inbound and going quiet the
 * moment it touches down. Aerial ports read as a bay rather than as furniture
 * once something is actually cleared in, which is the one thing the painted
 * stands could never tell a player.
 *
 * It is a prop batch, not a simulation object: no collision, no health, no
 * orders, and nothing at all on a map with no aircraft coming home.
 */

/** A bay an inbound hull has been cleared onto. */
export interface ClearedStand {
  kind: 'fixedWing' | 'helo';
  x: number;
  z: number;
  facing: number;
}

/**
 * Height of a marker above the facility's own ground.
 *
 * The highest painted marking on either facility tops out at 0.53, so 0.55
 * clears it by a hair — enough that the marker is never z-fighting the paint it
 * sits on, small enough that it does not read as a plate hovering over the slab.
 */
export const STAND_MARK_HEIGHT = 0.55;

/** Radians per second of the pulse. A beacon beat, not a strobe. */
const PULSE_RATE = 4.2;

/**
 * Brightness of the marker at a moment, 0.2 to 1.
 *
 * A squared sine is a fast rise and a long tail, which is how a signal lamp
 * reads: the eye catches the brightening well before it resolves a steady line.
 * The floor keeps the bay legible between beats — a marker that vanishes is a
 * glitch, and the bay it is on is real whether the pulse is up or not.
 */
export function standPulse(time: number): number {
  const beat = 0.5 + 0.5 * Math.sin(time * PULSE_RATE);
  return 0.2 + 0.8 * beat * beat;
}

/**
 * Fill the two instance arrays for the bays currently cleared.
 *
 * Fixed-wing bays take the apron frame and rotary pads take the ring, because a
 * stand is a long rectangle and a touchdown circle is not. `groundAt` is the
 * terrain height under the bay, so a field on a slope lights its marking on the
 * concrete instead of floating it.
 */
export function standMarkInstances(
  stands: ReadonlyArray<ClearedStand>,
  groundAt: (x: number, z: number) => number,
  frames: PropInstance[],
  rings: PropInstance[],
): void {
  frames.length = 0;
  rings.length = 0;
  for (const stand of stands) {
    const instance: PropInstance = {
      x: stand.x,
      y: groundAt(stand.x, stand.z) + STAND_MARK_HEIGHT,
      z: stand.z,
      rotation: stand.facing,
      scale: 1,
      color: [1, 1, 1],
    };
    if (stand.kind === 'helo') rings.push(instance);
    else frames.push(instance);
  }
}
