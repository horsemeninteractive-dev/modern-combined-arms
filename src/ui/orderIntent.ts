import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import type { Entity } from '../sim/types';

export type ContextOrder = 'capture' | 'repair' | 'garrison' | 'attack' | 'move';

/**
 * A structure an engineer may be sent to work on: the team's own, or a neutral
 * garrisonable shelter. A neutral shelter held by hostile infantry is refused;
 * `occupants` lets the caller supply the live garrison list. A paused
 * construction site of the player's own is included: resuming it is the same
 * order, and the alternative was a site that could never be restarted.
 */
export function isRepairTarget(
  target: Entity | null | undefined,
  localPlayerId: number,
  occupants: readonly Entity[] = [],
): target is Entity {
  if (!target || target.kind !== 'building' || target.hp <= 0) return false;
  // A paused construction site of your own is the same order: it needs an
  // engineer, not a medic. Without this, right-clicking a site whose builder
  // had been called away fell through to a plain move and nothing ever happened.
  if (target.construction) return target.owner === localPlayerId && target.buildProgress < 1;
  if (target.hp >= target.maxHp) return false;
  if (target.owner === localPlayerId) return true;
  if (target.owner !== -1 || !BUILDINGS[target.defId]?.garrison) return false;
  return !occupants.some((unit) => unit.owner !== localPlayerId);
}

/** A standing building whose data definition permits infantry occupation. */
export function isGarrisonTarget(target: Entity | null | undefined): target is Entity {
  return (
    !!target &&
    target.kind === 'building' &&
    target.hp > 0 &&
    !target.construction &&
    !!BUILDINGS[target.defId]?.garrison
  );
}

/**
 * Resolve a battlefield right-click on a picked entity.
 *
 * A damaged structure takes priority over occupation when an engineer is
 * selected: the explicit right-click is then a repair order, even if infantry
 * in the group could also garrison it. Capturable objectives are never attack
 * targets; with an engineer selected they always take priority over the hostile
 * branch, so neutral and enemy-held objectives send the engineer to capture.
 * Anything else follows the existing garrison / hostile-attack / move rules.
 */
export function contextOrderFor(
  target: Entity | null | undefined,
  selected: readonly Entity[],
  localPlayerId: number,
  hostile: boolean,
  occupants: readonly Entity[] = [],
): ContextOrder {
  if (!target) return 'move';
  if (
    BUILDINGS[target.defId]?.capturable &&
    target.owner !== localPlayerId &&
    selected.some((e) => UNITS[e.defId]?.canCapture && !e.garrisonId)
  ) {
    return 'capture';
  }
  if (
    isRepairTarget(target, localPlayerId, occupants) &&
    selected.some((e) => UNITS[e.defId]?.canBuild)
  ) {
    return 'repair';
  }
  if (
    target.kind === 'building' &&
    !hostile &&
    BUILDINGS[target.defId]?.garrison &&
    selected.some(
      (e) => e.kind === 'unit' && !e.garrisonId && UNITS[e.defId]?.canGarrison,
    )
  ) {
    return 'garrison';
  }
  if (target.owner !== localPlayerId && hostile) return 'attack';
  return 'move';
}
