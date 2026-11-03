import { createIslandAssault } from '../src/data/scenarios';
import { RESEARCH } from '../src/data/research';
import { validateScenario, type Scenario } from '../src/sim/scenario';
import type { Game } from '../src/sim/game';

export const island: Scenario = createIslandAssault();

export function islandCopy(): Scenario {
  return JSON.parse(JSON.stringify(island)) as Scenario;
}

/**
 * Complete the whole tree for one seat.
 *
 * Roster, facility and pricing suites ask whether a nation can field its own
 * equipment through the right building, not whether the tree is still open.
 * Granting research here keeps those questions about roster resolution; the
 * research suites own the locking behaviour.
 */
export function completeResearch(game: Game, owner = 0): void {
  const player = game.player(owner);
  if (player) player.research.completed = RESEARCH.techs.map((tech) => tech.id);
}

/**
 * Island Assault plus authored fixture content. The battle now starts with a
 * command post, an engineer, two MBTs and five riflemen, so tests that need a
 * facility or another unit add it here instead of relying on old start data.
 */
export function islandWith(extra: {
  structures?: Scenario['structures'];
  units?: Scenario['units'];
}): Scenario {
  const scenario = createIslandAssault();
  if (extra.structures) scenario.structures.push(...extra.structures);
  if (extra.units) scenario.units.push(...extra.units);
  return scenario;
}

/**
 * Island Assault with a chosen player nation and a shipyard afloat.
 *
 * National naval hulls are shipyard units, so the roster and research suites
 * need a map with navigable water and a yard that already stands. Everything
 * else about the fixture stays the shared island battle.
 */
export function harbourWith(nation: string): Scenario {
  const scenario = createIslandAssault();
  scenario.meta.id = 'harbour-fixture';
  scenario.players[0].factionId = nation;
  scenario.structures.push({ defId: 'shipyard', owner: 0, x: 12, z: 37 });
  return scenario;
}

export function validationSummary(scenario: Scenario): string {
  return validateScenario(scenario)
    .map((i) => `${i.severity.toUpperCase()} ${i.code}: ${i.message}${i.x !== undefined ? ` @${i.x},${i.z}` : ''}`)
    .join('\n');
}

export function findUnitPosition(
  scenario: Scenario,
  defId: string,
  owner: number,
): { x: number; z: number } | undefined {
  const u = scenario.units.find((n) => n.defId === defId && n.owner === owner);
  return u ? { x: u.x, z: u.z } : undefined;
}
