import { BUILDINGS, canSeizeStructure } from '../data/buildings';
import { ALL_UNITS } from '../data/units';
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

/**
 * A live mobile transport that eligible infantry may board.
 *
 * `friendly` lets the caller use the simulation's team relationship, so an
 * allied player's APC is a valid boarding target. Without it the helper keeps
 * its old player-identity rule for callers that do not have a game instance.
 */
export function isTransportTarget(
  target: Entity | null | undefined,
  localPlayerId: number,
  friendly = false,
): boolean {
  return (
    !!target &&
    target.kind === 'unit' &&
    target.hp > 0 &&
    target.owner >= 0 &&
    (friendly || target.owner === localPlayerId) &&
    !!ALL_UNITS[target.defId]?.transport
  );
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
 * in the group could also garrison it. Seizable sites are never attack targets;
 * with an engineer selected they take priority over the hostile branch, so an
 * unheld emplacement or a contested objective sends the engineer to capture.
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
    canSeizeStructure(target.defId, target.owner, localPlayerId, target.neutralStart === true) &&
    selected.some((e) => ALL_UNITS[e.defId]?.canCapture && !e.garrisonId)
  ) {
    return 'capture';
  }
  if (
    isRepairTarget(target, localPlayerId, occupants) &&
    selected.some((e) => ALL_UNITS[e.defId]?.canBuild)
  ) {
    return 'repair';
  }
  if (
    !hostile &&
    (isTransportTarget(target, localPlayerId, true) ||
      (target.kind === 'building' && !!BUILDINGS[target.defId]?.garrison)) &&
    selected.some(
      (e) =>
        e.kind === 'unit' &&
        !e.garrisonId &&
        !!ALL_UNITS[e.defId]?.canGarrison &&
        ALL_UNITS[e.defId]?.armour === 'infantry',
    )
  ) {
    return 'garrison';
  }
  if (target.owner !== localPlayerId && hostile) return 'attack';
  return 'move';
}
