/**
 * Standard-mapping gamepad helpers.
 *
 * The controller owns the browser Gamepad object; this module holds the small
 * pieces that can be reasoned about without a device: which focusable element a
 * direction should reach, and which control group comes next.
 */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

export interface FocusBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Pick the nearest visible control in one direction.
 *
 * `current` indexes into `boxes`; `-1` starts at the first control. The score
 * prefers forward travel and penalises lateral drift, so a menu column stays a
 * column instead of jumping to a wide button on the other side of the screen.
 */
export function nextFocusIndex(
  boxes: readonly FocusBox[],
  current: number,
  dx: number,
  dy: number,
): number {
  if (boxes.length === 0) return -1;
  if (current < 0 || current >= boxes.length) return 0;
  const from = center(boxes[current]);
  let best = -1;
  let bestScore = Infinity;
  boxes.forEach((box, index) => {
    if (index === current) return;
    const to = center(box);
    const forward = dx !== 0 ? (to.x - from.x) * dx : (to.y - from.y) * dy;
    // A control whose centre is level with, or behind, the current one is not
    // in that direction. The 1 px tolerance absorbs adjacent borders.
    if (forward <= 1) return;
    const lateral = dx !== 0 ? Math.abs(to.y - from.y) : Math.abs(to.x - from.x);
    const score = forward + lateral * 2.5;
    if (score < bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

/** The next 1–9 slot, wrapping in either direction. `0` means no slot yet. */
export function nextGroupSlot(current: number, direction: number): number {
  const start = current >= 1 && current <= 9 ? current : direction > 0 ? 0 : 10;
  return ((start - 1 + (direction > 0 ? 1 : -1) + 9) % 9) + 1;
}

/**
 * The next populated group for recall.
 *
 * Empty slots are skipped, so tapping left/right always lands on a group the
 * player can actually use. If the remembered slot has been cleared, the scan
 * starts from the first or last populated group.
 */
export function nextPopulatedGroup(
  groups: Iterable<number>,
  current: number,
  direction: number,
): number | null {
  const sorted = [...new Set(groups)]
    .filter((index) => index >= 1 && index <= 9)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const at = sorted.indexOf(current);
  if (at < 0) {
    if (direction > 0) return sorted.find((index) => index > current) ?? sorted[0];
    return [...sorted].reverse().find((index) => index < current) ?? sorted[sorted.length - 1];
  }
  const next = (at + (direction > 0 ? 1 : -1) + sorted.length) % sorted.length;
  return sorted[next];
}

function center(box: FocusBox): { x: number; y: number } {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}
