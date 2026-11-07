/**
 * Selection-box view of a structure's researched modules.
 *
 * The panel markup is thin on purpose: every decision a test can assert — which
 * modules a structure offers, whether each is installable, why it is not, and
 * whether it is already fitted — is made here from the authoritative
 * simulation. Availability comes from `Game.availableModules`, which already
 * resolves research, canonical building slot, ownership, liveness and remaining
 * capacity; readiness and the refusal wording come from `Game.moduleStatus`.
 * No research check is repeated in the interface.
 *
 * Installed modules are read from the entity itself, so a structure keeps
 * showing what it has bought even when nothing further is available.
 */
import { BUILDING_MODULES, moduleEffectSummary } from '../data/research';
import type { Game } from '../sim/game';

export type ModuleInstallState = 'available' | 'installed' | 'resources' | 'blocked';

export interface ModuleActionView {
  moduleId: string;
  name: string;
  icon: string;
  description: string;
  cost: { mats: number; req: number };
  /** Net grid contribution of one installation: +supply or −draw. */
  power: number;
  installed: boolean;
  /** Installations on this structure, and how many it can hold. */
  count: number;
  capacity: number;
  /** True when the command would be accepted right now. */
  ready: boolean;
  state: ModuleInstallState;
  /** Short button caption. */
  label: string;
  /** One-line reason or state for the button's second line and title. */
  detail: string;
}

/**
 * The module's own effect labels, in the panel's lower-case house style.
 *
 * Derived from the effects rather than from grid contribution: a servicing crew
 * and a sonar suite have no power line at all, and reporting them as "0 power"
 * was technically true and told the player nothing.
 */
function effectText(moduleId: string): string {
  const module = BUILDING_MODULES[moduleId];
  return module ? moduleEffectSummary(module).join(' · ').toLowerCase() : '';
}

/**
 * Modules this structure shows in its selection box.
 *
 * A structure with no researched module and nothing installed returns an empty
 * list, which keeps every ineligible structure's card exactly as it was. An
 * installed module stays in the list at its capacity, because the player needs
 * to see what the structure is actually generating.
 */
export function moduleActions(game: Game, owner: number, buildingId: number): ModuleActionView[] {
  const building = game.getEntity(buildingId);
  if (!building || building.kind !== 'building' || building.owner !== owner || building.hp <= 0) {
    return [];
  }
  if (building.construction) return [];
  const installedIds = building.modules ?? [];
  const views: ModuleActionView[] = [];
  const seen = new Set<string>();

  for (const moduleId of installedIds) {
    if (seen.has(moduleId)) continue;
    seen.add(moduleId);
    const module = BUILDING_MODULES[moduleId];
    if (!module) continue;
    const count = installedIds.filter((id) => id === moduleId).length;
    const capacity = module.capacity ?? 1;
    const effects = effectText(moduleId);
    views.push({
      moduleId,
      name: module.name,
      icon: module.icon,
      description: module.description,
      cost: module.cost,
      power: BUILDING_MODULES[moduleId]?.effects.reduce(
        (sum, effect) => (effect.kind === 'power' ? sum + effect.amount : sum),
        0,
      ) ?? 0,
      installed: true,
      count,
      capacity,
      ready: false,
      state: 'installed',
      label: 'INSTALLED',
      detail: `Installed${count > 1 ? ` ×${count}` : ''} — ${effects}`,
    });
  }

  for (const module of game.availableModules(owner, buildingId)) {
    if (seen.has(module.id)) continue;
    seen.add(module.id);
    const status = game.moduleStatus(owner, buildingId, module.id);
    const power = module.effects.reduce(
      (sum, effect) => (effect.kind === 'power' ? sum + effect.amount : sum),
      0,
    );
    const effects = effectText(module.id);
    const affordable = status.ok;
    // `availableModules` already excludes anything un-researched, ineligible or
    // over capacity, so a refusal here is about the bank or a state the two
    // resolvers do not share (a structure that just went up in smoke, say).
    const shortOfResources = /insufficient/i.test(status.reason);
    views.push({
      moduleId: module.id,
      name: module.name,
      icon: module.icon,
      description: module.description,
      cost: module.cost,
      power,
      installed: false,
      count: 0,
      capacity: module.capacity ?? 1,
      ready: affordable,
      state: affordable ? 'available' : shortOfResources ? 'resources' : 'blocked',
      label: affordable ? 'INSTALL' : shortOfResources ? 'NEED FUNDS' : 'BLOCKED',
      detail: affordable
        ? `${effects} · ${module.cost.mats}M · ${module.cost.req}R`
        : status.reason,
    });
  }

  return views;
}
