import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import type { Entity } from '../sim/types';

export type ContextOrder = 'capture' | 'repair' | 'garrison' | 'attack' | 'move';

/** A completed friendly structure that is below full integrity. */
export function isRepairTarget(
  target: Entity | null | undefined,
  localPlayerId: number,
): target is Entity {
  return (
    !!target &&
    target.owner === localPlayerId &&
    target.kind === 'building' &&
    target.hp > 0 &&
    target.hp < target.maxHp &&
    !target.construction
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
 * A garrisonable building takes priority when eligible infantry are selected:
 * the explicit right-click is the occupation order. Capturable objectives are
 * never attack targets; with an engineer selected they always take priority
 * over the hostile branch, so neutral and enemy-held objectives send the
 * engineer to capture. A damaged friendly structure similarly takes priority
 * over movement when an engineer is selected. Anything else follows the
 * existing hostile-attack / move rules.
 */
export function contextOrderFor(
  target: Entity | null | undefined,
  selected: readonly Entity[],
  localPlayerId: number,
  hostile: boolean,
): ContextOrder {
  if (!target) return 'move';
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
  if (
    BUILDINGS[target.defId]?.capturable &&
    target.owner !== localPlayerId &&
    selected.some((e) => UNITS[e.defId]?.canCapture && !e.garrisonId)
  ) {
    return 'capture';
  }
  if (isRepairTarget(target, localPlayerId) && selected.some((e) => UNITS[e.defId]?.canBuild)) {
    return 'repair';
  }
  if (target.owner !== localPlayerId && hostile) return 'attack';
  return 'move';
}
