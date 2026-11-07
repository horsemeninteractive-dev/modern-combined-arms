/**
 * Selection-box view of a unit's researched abilities.
 *
 * The panel markup is thin on purpose: everything a test can assert — which
 * abilities a hull shows, whether each is ready, what the button says while it
 * reloads and whether a timed effect is currently running — is decided here from
 * the authoritative simulation, so the HUD cannot display an ability the player
 * has not researched or hide one that is merely reloading.
 */
import { abilityForUpgrade } from '../data/abilities';
import type { Game } from '../sim/game';

export interface AbilityActionView {
  upgradeId: string;
  name: string;
  icon: string;
  description: string;
  /** True when the command would be accepted right now. */
  ready: boolean;
  /** Seconds of reload left; 0 when ready. */
  cooldown: number;
  /** Short button caption. */
  label: string;
  /** One-line reason or state for the button's second line and title. */
  detail: string;
  /** True while a timed effect from this ability is running. */
  active: boolean;
  /** Seconds of active effect left; 0 when it is not running. */
  activeRemaining: number;
  /** The trade-off the crew accepts by using it. */
  note: string;
}

/**
 * Abilities this hull could use, in catalogue order.
 *
 * A hull with no researched ability returns an empty list, which is what keeps
 * the selection box of a tank or a rifle section exactly as it was. An ability
 * on reload stays in the list: the player needs to see the capability and when
 * it returns, not just its absence.
 */
export function abilityActions(game: Game, owner: number, unitId: number): AbilityActionView[] {
  const unit = game.getEntity(unitId);
  if (!unit || unit.kind !== 'unit' || unit.owner !== owner || unit.hp <= 0) return [];
  const views: AbilityActionView[] = [];
  for (const upgrade of game.availableUpgrades(owner, unitId)) {
    const ability = abilityForUpgrade(upgrade.id);
    if (!ability) continue;
    const status = game.abilityStatus(owner, unitId, upgrade.id);
    const activeRemaining = game.effectRemaining(unitId, upgrade.id);
    const detail =
      activeRemaining > 0
        ? `Active — ${Math.ceil(activeRemaining)}s remaining`
        : status.ok
          ? ability.note
          : status.cooldown > 0
            ? `Reloading — ${Math.ceil(status.cooldown)}s`
            : status.reason;
    views.push({
      upgradeId: upgrade.id,
      name: upgrade.name,
      icon: upgrade.icon,
      description: upgrade.description,
      ready: status.ok,
      cooldown: status.cooldown,
      label:
        activeRemaining > 0
          ? 'ACTIVE'
          : status.ok
            ? 'READY'
            : status.cooldown > 0
              ? `${Math.ceil(status.cooldown)}s`
              : 'BLOCKED',
      detail,
      active: activeRemaining > 0,
      activeRemaining,
      note: ability.note,
    });
  }
  return views;
}
