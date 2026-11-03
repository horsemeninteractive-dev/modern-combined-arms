/**
 * Selection-box view of a unit's researched abilities.
 *
 * The panel markup is thin on purpose: everything a test can assert — which
 * abilities a hull shows, whether each is ready, and what the button says while
 * it reloads — is decided here from the authoritative simulation, so the HUD
 * cannot display an ability the player has not researched or hide one that is
 * merely reloading.
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
    const detail = status.ok
      ? 'Ready'
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
      label: status.ok ? 'READY' : status.cooldown > 0 ? `${Math.ceil(status.cooldown)}s` : 'BLOCKED',
      detail,
    });
  }
  return views;
}
