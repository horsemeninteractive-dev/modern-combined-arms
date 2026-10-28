/**
 * Stereo placement for combat cues.
 *
 * The renderer's camera is a fixed-pitch isometric view, so the only useful
 * spatial axis for a stereo mix is screen-right. These helpers are pure so the
 * test suite can check distance gain and pan without a Web Audio graph.
 */

export interface ListenerGroundFrame {
  /** Camera focus on the ground plane. */
  x: number;
  z: number;
  /** Unit vector pointing to screen-right, projected on the ground. */
  rightX: number;
  rightZ: number;
  /** Distance at which an enemy cue reaches its quietest audible level. */
  reach: number;
}

export interface CombatMix {
  gain: number;
  pan: number;
}

/** Pan magnitude at full horizontal reach. Short of hard-panning keeps the mix usable. */
const MAX_PAN = 0.9;
/** Horizontal distance (as a share of reach) that maps to a full pan. */
const PAN_SPAN = 0.65;
/** Enemy fire beyond the visual reach is still audible, but bedded into the mix. */
const FAR_ENEMY_GAIN = 0.55;
const MIN_ENEMY_GAIN = 0.12;

export function panForOffset(lateral: number, reach: number): number {
  if (!Number.isFinite(lateral) || !Number.isFinite(reach) || reach <= 0) return 0;
  const ratio = lateral / (reach * PAN_SPAN);
  return Math.max(-MAX_PAN, Math.min(MAX_PAN, ratio * MAX_PAN));
}

function unitRight(frame: ListenerGroundFrame): { x: number; z: number } {
  const length = Math.hypot(frame.rightX, frame.rightZ);
  if (!Number.isFinite(length) || length <= 0.0001) return { x: 1, z: 0 };
  return { x: frame.rightX / length, z: frame.rightZ / length };
}

/**
 * Distance attenuation and stereo pan for one world-space combat event.
 *
 * Friendly cues stay at full gain: they are the player's own battle. Visible
 * enemy fire is attenuated toward the far edge of the framed battlefield. An
 * absent or malformed position falls back to the centre instead of throwing or
 * inventing a direction.
 */
export function combatMix(
  x: number,
  z: number,
  frame: ListenerGroundFrame,
  local: boolean,
): CombatMix {
  const fallback = local ? 1 : FAR_ENEMY_GAIN;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    !Number.isFinite(frame.x) ||
    !Number.isFinite(frame.z) ||
    !Number.isFinite(frame.reach) ||
    frame.reach <= 0
  ) {
    return { gain: fallback, pan: 0 };
  }

  const dx = x - frame.x;
  const dz = z - frame.z;
  const reach = Math.max(1, frame.reach);
  const distance = Math.hypot(dx, dz);
  const gain = local ? 1 : Math.max(MIN_ENEMY_GAIN, 1 - distance / reach) * FAR_ENEMY_GAIN;
  const right = unitRight(frame);
  const lateral = dx * right.x + dz * right.z;
  return { gain, pan: panForOffset(lateral, reach) };
}
