import { createIslandAssault } from '../src/data/scenarios';
import { validateScenario, type Scenario } from '../src/sim/scenario';

export const island: Scenario = createIslandAssault();

export function islandCopy(): Scenario {
  return JSON.parse(JSON.stringify(island)) as Scenario;
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
