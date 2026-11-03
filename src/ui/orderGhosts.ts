/**
 * Fading impressions left where a right-click order was issued.
 *
 * They are presentation only: the order has already reached the command gate,
 * and a ghost never adds, moves or delays anything. Keeping the bookkeeping
 * here lets the overlay draw them and lets a test pin the fade without a canvas.
 */
export type OrderGhostKind = 'move' | 'attack';

export interface OrderGhost {
  x: number;
  y: number;
  kind: OrderGhostKind;
  /** `performance.now()` when the order landed. */
  born: number;
}

export const ORDER_GHOST_LIFE_MS = 760;
/** At most one click's worth of impressions; older ones are dropped. */
export const ORDER_GHOST_LIMIT = 6;

export function addOrderGhost(
  ghosts: OrderGhost[],
  ghost: OrderGhost,
): OrderGhost[] {
  ghosts.push(ghost);
  while (ghosts.length > ORDER_GHOST_LIMIT) ghosts.shift();
  return ghosts;
}

/** Drop finished ghosts in place; safe to call every frame. */
export function pruneOrderGhosts(ghosts: OrderGhost[], now: number): OrderGhost[] {
  let write = 0;
  for (let read = 0; read < ghosts.length; read += 1) {
    if (now - ghosts[read].born < ORDER_GHOST_LIFE_MS) {
      ghosts[write] = ghosts[read];
      write += 1;
    }
  }
  ghosts.length = write;
  return ghosts;
}

/** 0 at the click, 1 when the last echo has faded. */
export function ghostProgress(born: number, now: number): number {
  const age = now - born;
  if (!(age > 0)) return 0;
  return Math.min(1, age / ORDER_GHOST_LIFE_MS);
}

/** Fade is front-loaded so the mark is bright when it matters and gone quickly. */
export function ghostOpacity(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return Math.pow(1 - clamped, 1.7) * 0.65;
}

/** Each echo grows slightly as it fades, so the click leaves a visible spread. */
export function ghostScale(progress: number): number {
  return 1 + Math.max(0, Math.min(1, progress)) * 0.5;
}

/** Vertical drift in CSS pixels: the mark lifts away from the ground. */
export function ghostRise(progress: number): number {
  return Math.max(0, Math.min(1, progress)) * 12;
}

/** Stagger between the trail's echoes, in milliseconds. */
export const GHOST_ECHO_STAGGER_MS = 90;
export const GHOST_ECHOES = 3;
