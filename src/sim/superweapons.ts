/**
 * Strategic superweapon simulation helpers.
 *
 * Pure functions over committed state: no clock, no entity access and no
 * rendering. The Game owns when they are called; keeping the arithmetic here
 * means the save loader, the tests and the command path all agree about what a
 * cooldown, a phase or a salvo pattern means.
 */
import type { Cost, PlayerSuperweaponState, SuperweaponOperationState } from './types';
import type { SuperweaponFamilyDef, SuperweaponTargeting } from '../data/superweapons';
import { TICK_RATE } from './constants';

/** The authoritative answer the command, HUD and panel all read. */
export interface SuperweaponStatus {
  ok: boolean;
  reason: string;
  family: SuperweaponFamilyDef | null;
  targeting: SuperweaponTargeting | null;
  cost: Cost | null;
  enabled: boolean;
  hasCentre: boolean;
  /**
   * The whole authority chain, in authored order, with readable names.
   *
   * Names are carried for every node rather than only the missing ones: a panel
   * that had to fall back to an id for a completed technology would show
   * "fires2" beside "COMPLETE", which is exactly the kind of half-legible row
   * this layer exists to avoid.
   */
  requires: Array<{ id: string; name: string; ready: boolean }>;
  missingTechs: Array<{ id: string; name: string }>;
  /** National reload remaining, including while an operation is running. */
  cooldown: number;
  operation: SuperweaponOperationState | null;
  phase: 'none' | 'warning' | 'executing' | 'complete';
  countdown: number;
  affordable: boolean;
  ewActive: boolean;
  defenceActive: boolean;
}

export function createSuperweaponState(): PlayerSuperweaponState {
  return { cooldowns: {}, active: null, ewUntilTick: 0, defence: null };
}

/** Seconds left on one family's national reload; 0 when ready. */
export function cooldownSeconds(
  state: PlayerSuperweaponState | undefined,
  tick: number,
  familyId: string,
): number {
  const until = state?.cooldowns[familyId] ?? 0;
  return Math.max(0, (until - tick) / TICK_RATE);
}

/** Whether a committed operation is still running, including its warning. */
export function operationRunning(
  operation: SuperweaponOperationState | null | undefined,
  tick: number,
): boolean {
  return !!operation && tick < operation.endTick;
}

/** Phase implied by the authoritative clock, used by the UI and the tests. */
export function operationPhase(
  operation: SuperweaponOperationState | null | undefined,
  tick: number,
): 'none' | 'warning' | 'executing' | 'complete' {
  if (!operation) return 'none';
  if (tick < operation.executeTick) return 'warning';
  if (tick < operation.endTick) return 'executing';
  return 'complete';
}

/** Seconds until the operation leaves its current phase; 0 when complete. */
export function operationCountdown(
  operation: SuperweaponOperationState | null | undefined,
  tick: number,
): number {
  if (!operation) return 0;
  if (tick < operation.executeTick) return (operation.executeTick - tick) / TICK_RATE;
  return Math.max(0, (operation.endTick - tick) / TICK_RATE);
}

/**
 * Deterministic aim points for an area salvo.
 *
 * A round of a fixed pattern rather than a random spray: two identical
 * operations on the same grid always land on the same points, which keeps the
 * simulation hash and a replay honest. The pattern is a golden-angle spiral so
 * the impacts cover the aim area without clustering in its centre.
 */
export function salvoPoints(
  seed: number,
  count: number,
  spreadTiles: number,
): Array<{ x: number; z: number }> {
  const points: Array<{ x: number; z: number }> = [];
  const golden = 2.399963229728653;
  for (let i = 0; i < count; i++) {
    const fraction = Math.sqrt((i + 0.5) / count);
    const angle = i * golden + seed * 0.0001;
    points.push({
      x: Math.cos(angle) * fraction * spreadTiles,
      z: Math.sin(angle) * fraction * spreadTiles,
    });
  }
  return points;
}

/**
 * Vision multiplier an electronic attack imposes on one affected commander.
 *
 * Static structures keep their local optics; mobile ground formations lose
 * reach, and autonomous air systems lose the most because their picture depends
 * on the datalink the attack is aimed at. A commander with no attack running
 * gets exactly 1, so the function disappears from ordinary play.
 */
export function ewVisionFactor(
  state: PlayerSuperweaponState | undefined,
  tick: number,
  domain: string | undefined,
  effect: { vision: number; airVision: number } | undefined,
  isBuilding: boolean,
): number {
  if (!effect || !state || tick >= state.ewUntilTick || isBuilding) return 1;
  return domain === 'air' ? effect.airVision : effect.vision;
}

/** Radar and sensor-station reach under an electronic attack. */
export function ewScanFactor(
  state: PlayerSuperweaponState | undefined,
  tick: number,
): number {
  return state && tick < state.ewUntilTick ? 0.7 : 1;
}

/** Engagement-range multiplier an electronic attack imposes. */
export function ewRangeFactor(
  state: PlayerSuperweaponState | undefined,
  tick: number,
  effect: { range: number } | undefined,
): number {
  if (!effect || !state || tick >= state.ewUntilTick) return 1;
  return effect.range;
}
