/**
 * Campaign scenario assembly.
 *
 * A campaign battle is an ordinary built-in theatre plus three authored
 * additions: the operation's command pair, the mission document, and any named
 * veterans whose deployment survived the roster check. It is parsed again after
 * the additions, so the mission's entity references are validated against the
 * placements that were actually created.
 *
 * Kept out of the app shell so the exact launch scenario can be tested without a
 * browser.
 */
import { identityAlliance, identityDef } from '../data/factions';
import type { CampaignDef, CampaignMission } from '../data/campaign';
import { cloneScenario, parseScenario, type Scenario } from '../sim/scenario';
import type { MissionDoc } from '../mission/types';
import { campaignDeploymentsFor } from './state';
import { CampaignFormatError, type CampaignState } from './types';

export interface CampaignScenarioInput {
  def: CampaignDef;
  mission: CampaignMission;
  /** Authoritative run, or null while previewing a campaign that has not begun. */
  state: CampaignState | null;
  /** Built-in theatre the operation deploys on. */
  base: Scenario;
}

/** Offsets from the player's start, used when a veteran slot authors no tile. */
const VETERAN_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [3, 3],
  [-3, 3],
  [3, -3],
  [-3, -3],
];

/**
 * Build the launch scenario for one operation.
 *
 * The static mission document is copied, never mutated: deployments add entity
 * metadata and carryover references to the copy. Calling this twice with the
 * same run produces the same scenario bytes.
 */
export function buildCampaignScenario(input: CampaignScenarioInput): Scenario {
  const { def, mission, state, base } = input;
  const scenario = cloneScenario(base);
  const command = identityDef(mission.playerNationId);
  const opposition = identityDef(mission.opponentNationId);
  scenario.meta = {
    ...scenario.meta,
    name: mission.name,
    description: mission.situation,
    campaign: { campaignId: def.id, missionId: mission.id },
  };
  // The map's objective list is authored for a free skirmish. A campaign
  // operation carries its own brief into the HUD, briefing and save.
  scenario.objectives = [...mission.objectives];
  if (scenario.players[0]) {
    scenario.players[0].factionId = command.id;
    scenario.players[0].name = `${command.name} Task Force`;
    scenario.players[0].color = identityAlliance(command.id).color;
    scenario.players[0].isAI = false;
  }
  if (scenario.players[1]) {
    scenario.players[1].factionId = opposition.id;
    scenario.players[1].name = `${opposition.name} Task Force`;
    scenario.players[1].color = identityAlliance(opposition.id).color;
    scenario.players[1].isAI = true;
  }

  // The operation completes on the opposing command post being lost, so both
  // headquarters must carry the authored keys the mission document names.
  const ownHq = scenario.structures.find(
    (structure) => structure.defId === 'commandPost' && structure.owner === 0,
  );
  const enemyHq = scenario.structures.find(
    (structure) => structure.defId === 'commandPost' && structure.owner === 1,
  );
  if (!ownHq || !enemyHq) {
    throw new CampaignFormatError(
      `Theatre "${mission.mapId}" has no command posts for operation "${mission.id}".`,
    );
  }
  ownHq.key = 'own-hq';
  enemyHq.key = 'enemy-hq';

  const deployments = state ? campaignDeploymentsFor(state, def, mission.id) : [];
  const doc = JSON.parse(JSON.stringify(mission.mission)) as MissionDoc;
  const start = scenario.players[0] ?? { startX: 8, startZ: 8 };
  let placed = 0;
  for (const deployment of deployments) {
    const slot = mission.veterans.find((entry) => entry.key === deployment.key);
    const veteran = state?.veterans.find((entry) => entry.id === deployment.veteranId);
    if (!slot || !veteran) continue;
    const offset = VETERAN_OFFSETS[placed % VETERAN_OFFSETS.length];
    placed++;
    const x = Math.max(1, Math.min(scenario.width - 2, slot.x ?? start.startX + offset[0]));
    const z = Math.max(1, Math.min(scenario.height - 2, slot.z ?? start.startZ + offset[1]));
    scenario.units.push({ defId: veteran.defId, owner: 0, x, z, key: slot.key });
    doc.entities.push({ key: slot.key, name: veteran.name, role: 'veteran' });
    doc.carryover.assets.push(slot.key);
  }
  scenario.mission = doc;

  return parseScenario(JSON.parse(JSON.stringify(scenario)));
}

/** Deployments the launch would place, without building the whole scenario. */
export function campaignScenarioDeployments(
  state: CampaignState | null,
  def: CampaignDef,
  mission: CampaignMission,
) {
  return state ? campaignDeploymentsFor(state, def, mission.id) : [];
}
