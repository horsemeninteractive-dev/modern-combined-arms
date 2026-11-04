/**
 * Campaign validation.
 *
 * Definitions are checked against the live nation and unit catalogues and
 * against the embedded mission documents, so a campaign cannot name an
 * operation, nation, consequence or veteran that does not exist. Saved runs are
 * checked separately: a save that disagrees with its definition is a defect,
 * not something to repair silently.
 *
 * This does not prove a campaign is winnable. Mission reachability is
 * intentionally left to the trigger and objective layers; here the distinction
 * is between a structural error and a design warning.
 */
import { ALLIANCES, NATIONS } from '../data/factions';
import { UNITS } from '../data/units';
import { isMissionId, validateMission } from '../mission/validate';
import type { CampaignDef, CampaignMission } from '../data/campaign';
import { normaliseCommanderIdentity } from './identity';
import { isCampaignPhase, isKnownUnitDef } from './state';
import type {
  CampaignIssue,
  CampaignState,
  CampaignVeteranSlot,
} from './types';

export interface CampaignDefinitionContext {
  /** Built-in theatre ids, when the catalogue is available. */
  knownMapIds?: ReadonlySet<string>;
}

function issue(
  issues: CampaignIssue[],
  severity: CampaignIssue['severity'],
  code: string,
  message: string,
  path: string,
): void {
  issues.push({ severity, code, message, path });
}

function checkVeteranSlots(
  def: CampaignDef,
  mission: CampaignMission,
  index: number,
  issues: CampaignIssue[],
): void {
  const seenKeys = new Set<string>();
  const seenVeterans = new Set<string>();
  const staticEntityKeys = new Set(mission.mission.entities.map((entity) => entity.key));
  if (mission.veterans.length > 0 && !mission.mission.carryover.enabled) {
    issue(
      issues,
      'error',
      'veteran-carryover-disabled',
      `Operation "${mission.id}" assigns veterans but its mission document disables carryover.`,
      `missions[${index}].mission.carryover.enabled`,
    );
  }
  mission.veterans.forEach((slot, s) => {
    const path = `missions[${index}].veterans[${s}]`;
    if (!isMissionId(slot.key)) {
      issue(
        issues,
        'error',
        'veteran-key-invalid',
        `Veteran slot key "${slot.key}" is not a valid authored key.`,
        `${path}.key`,
      );
    }
    if (seenKeys.has(slot.key)) {
      issue(
        issues,
        'error',
        'veteran-key-duplicate',
        `Veteran slot key "${slot.key}" is used twice in this operation.`,
        `${path}.key`,
      );
    }
    seenKeys.add(slot.key);
    if (staticEntityKeys.has(slot.key)) {
      issue(
        issues,
        'error',
        'veteran-key-collides',
        `Veteran slot key "${slot.key}" collides with an authored mission entity.`,
        `${path}.key`,
      );
    }
    if (seenVeterans.has(slot.veteranId)) {
      issue(
        issues,
        'error',
        'veteran-assigned-twice',
        `Veteran "${slot.veteranId}" is assigned to two slots in this operation.`,
        `${path}.veteranId`,
      );
    }
    seenVeterans.add(slot.veteranId);
    const roster = def.roster.find((entry) => entry.id === slot.veteranId);
    if (!roster) {
      issue(
        issues,
        'error',
        'veteran-unknown',
        `Veteran slot names "${slot.veteranId}", which is not in the campaign roster.`,
        `${path}.veteranId`,
      );
      return;
    }
    if (roster.defId !== slot.defId) {
      issue(
        issues,
        'error',
        'veteran-def-mismatch',
        `Veteran "${roster.id}" is a ${roster.defId}, but the slot places a ${slot.defId}.`,
        `${path}.defId`,
      );
    }
    if (!isKnownUnitDef(slot.defId)) {
      issue(
        issues,
        'error',
        'veteran-unit-unknown',
        `Veteran slot uses unknown unit "${slot.defId}".`,
        `${path}.defId`,
      );
    }
    if (slot.x !== undefined && (!Number.isInteger(slot.x) || slot.x < 0)) {
      issue(
        issues,
        'error',
        'veteran-position-invalid',
        'Veteran slot x must be a non-negative integer tile.',
        `${path}.x`,
      );
    }
    if (slot.z !== undefined && (!Number.isInteger(slot.z) || slot.z < 0)) {
      issue(
        issues,
        'error',
        'veteran-position-invalid',
        'Veteran slot z must be a non-negative integer tile.',
        `${path}.z`,
      );
    }
    if (slot.x !== undefined && slot.z === undefined) {
      issue(
        issues,
        'error',
        'veteran-position-partial',
        'A veteran slot that authors x must also author z.',
        `${path}.z`,
      );
    }
    if (slot.z !== undefined && slot.x === undefined) {
      issue(
        issues,
        'error',
        'veteran-position-partial',
        'A veteran slot that authors z must also author x.',
        `${path}.x`,
      );
    }
  });
}

/**
 * Validate a campaign definition.
 *
 * Errors make the campaign unlaunchable; warnings describe design risks such as
 * an operation that carries no named personnel.
 */
export function validateCampaignDefinition(
  def: CampaignDef,
  context: CampaignDefinitionContext = {},
): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  if (!isMissionId(def.id)) {
    issue(issues, 'error', 'campaign-id-invalid', 'Campaign id is not a valid identifier.', 'id');
  }
  if (!Number.isInteger(def.version) || def.version < 1) {
    issue(issues, 'error', 'campaign-version-invalid', 'Campaign version must be a positive integer.', 'version');
  }
  if (def.name.trim().length === 0) {
    issue(issues, 'error', 'campaign-name-missing', 'Campaign has no name.', 'name');
  }
  if (!ALLIANCES[def.allianceId]) {
    issue(
      issues,
      'error',
      'campaign-alliance-unknown',
      `Campaign alliance "${def.allianceId}" does not exist.`,
      'allianceId',
    );
  }

  const variableIds = new Set<string>();
  def.variables.forEach((variable, i) => {
    const path = `variables[${i}]`;
    if (!isMissionId(variable.id)) {
      issue(issues, 'error', 'variable-id-invalid', 'Campaign variable id is invalid.', `${path}.id`);
    }
    if (variableIds.has(variable.id)) {
      issue(
        issues,
        'error',
        'variable-duplicate',
        `Campaign variable "${variable.id}" is declared twice.`,
        `${path}.id`,
      );
    }
    variableIds.add(variable.id);
    if (variable.type !== 'number' && variable.type !== 'boolean' && variable.type !== 'string') {
      issue(
        issues,
        'error',
        'variable-type-invalid',
        `Campaign variable "${variable.id}" has an unsupported type.`,
        `${path}.type`,
      );
    }
    if (typeof variable.default !== variable.type) {
      issue(
        issues,
        'error',
        'variable-default-type',
        `Campaign variable "${variable.id}" default is not a ${variable.type}.`,
        `${path}.default`,
      );
    }
    if (typeof variable.default === 'number' && !Number.isFinite(variable.default)) {
      issue(
        issues,
        'error',
        'variable-default-value',
        `Campaign variable "${variable.id}" default is not finite.`,
        `${path}.default`,
      );
    }
  });

  const rosterIds = new Set<string>();
  def.roster.forEach((entry, i) => {
    const path = `roster[${i}]`;
    if (!isMissionId(entry.id)) {
      issue(issues, 'error', 'roster-id-invalid', 'Roster id is invalid.', `${path}.id`);
    }
    if (rosterIds.has(entry.id)) {
      issue(
        issues,
        'error',
        'roster-duplicate',
        `Roster individual "${entry.id}" is listed twice.`,
        `${path}.id`,
      );
    }
    rosterIds.add(entry.id);
    if (entry.name.trim().length === 0) {
      issue(issues, 'error', 'roster-name-missing', 'Roster individual has no name.', `${path}.name`);
    }
    if (!UNITS[entry.defId]) {
      issue(
        issues,
        'error',
        'roster-unit-unknown',
        `Roster individual "${entry.id}" uses unknown unit "${entry.defId}".`,
        `${path}.defId`,
      );
    }
    if (entry.role !== 'veteran' && entry.role !== 'asset') {
      issue(
        issues,
        'error',
        'roster-role-invalid',
        `Roster individual "${entry.id}" has an unsupported role.`,
        `${path}.role`,
      );
    }
  });

  if (def.missions.length === 0) {
    issue(issues, 'error', 'campaign-empty', 'Campaign has no operations.', 'missions');
  }

  const missionIds = new Set<string>();
  def.missions.forEach((mission, index) => {
    const base = `missions[${index}]`;
    if (!isMissionId(mission.id)) {
      issue(issues, 'error', 'mission-id-invalid', 'Operation id is invalid.', `${base}.id`);
    }
    if (missionIds.has(mission.id)) {
      issue(issues, 'error', 'mission-id-duplicate', `Operation "${mission.id}" is listed twice.`, `${base}.id`);
    }
    missionIds.add(mission.id);
    if (mission.name.trim().length === 0) {
      issue(issues, 'error', 'mission-name-missing', 'Operation has no name.', `${base}.name`);
    }
    if (context.knownMapIds && !context.knownMapIds.has(mission.mapId)) {
      issue(
        issues,
        'error',
        'mission-map-unknown',
        `Operation "${mission.id}" uses unknown theatre "${mission.mapId}".`,
        `${base}.mapId`,
      );
    }

    const command = NATIONS[mission.playerNationId];
    const opposition = NATIONS[mission.opponentNationId];
    if (!command) {
      issue(
        issues,
        'error',
        'mission-command-unknown',
        `Operation "${mission.id}" names unknown command nation "${mission.playerNationId}".`,
        `${base}.playerNationId`,
      );
    } else if (command.allianceId !== def.allianceId) {
      issue(
        issues,
        'error',
        'mission-command-alliance',
        `Operation "${mission.id}" commands ${command.name}, which is not in ${def.allianceId}.`,
        `${base}.playerNationId`,
      );
    }
    if (!opposition) {
      issue(
        issues,
        'error',
        'mission-opposition-unknown',
        `Operation "${mission.id}" names unknown opponent "${mission.opponentNationId}".`,
        `${base}.opponentNationId`,
      );
    } else if (opposition.allianceId === def.allianceId) {
      issue(
        issues,
        'error',
        'mission-opposition-alliance',
        `Operation "${mission.id}" opposes ${opposition.name}, which is in the campaign alliance.`,
        `${base}.opponentNationId`,
      );
    }

    const doc = mission.mission;
    if (doc.id !== mission.id) {
      issue(
        issues,
        'error',
        'mission-doc-id',
        `Operation "${mission.id}" embeds mission document "${doc.id}".`,
        `${base}.mission.id`,
      );
    }
    if (!doc.campaign) {
      issue(
        issues,
        'error',
        'mission-campaign-missing',
        `Operation "${mission.id}" mission document has no campaign reference.`,
        `${base}.mission.campaign`,
      );
    } else {
      if (doc.campaign.campaignId !== def.id) {
        issue(
          issues,
          'error',
          'mission-campaign-id',
          `Operation "${mission.id}" belongs to campaign "${doc.campaign.campaignId}".`,
          `${base}.mission.campaign.campaignId`,
        );
      }
      if (doc.campaign.order !== index + 1) {
        issue(
          issues,
          'error',
          'mission-order',
          `Operation "${mission.id}" is authored #{${index + 1}} but its mission document says #${doc.campaign.order}.`,
          `${base}.mission.campaign.order`,
        );
      }
      if (doc.campaign.side && doc.campaign.side !== def.allianceId) {
        issue(
          issues,
          'error',
          'mission-side',
          `Operation "${mission.id}" mission side "${doc.campaign.side}" does not match ${def.allianceId}.`,
          `${base}.mission.campaign.side`,
        );
      }
    }

    for (const finding of validateMission(doc)) {
      // Info findings are useful while authoring a document standalone but
      // noise inside a campaign, where placements are added at launch.
      if (finding.severity === 'info') continue;
      issue(
        issues,
        finding.severity,
        `mission-${finding.code}`,
        finding.message,
        `${base}.mission.${finding.path}`,
      );
    }

    const missionVariables = new Set(def.variables.map((variable) => variable.id));
    doc.consequences.forEach((consequence, c) => {
      if (!missionVariables.has(consequence.key)) {
        issue(
          issues,
          'error',
          'consequence-variable-missing',
          `Operation "${mission.id}" writes undeclared campaign variable "${consequence.key}".`,
          `${base}.mission.consequences[${c}].key`,
        );
        return;
      }
      const declared = def.variables.find((variable) => variable.id === consequence.key);
      if (declared && typeof consequence.value !== declared.type) {
        issue(
          issues,
          'error',
          'consequence-variable-type',
          `Operation "${mission.id}" writes ${typeof consequence.value} to ${declared.type} variable "${consequence.key}".`,
          `${base}.mission.consequences[${c}].value`,
        );
      }
    });

    checkVeteranSlots(def, mission, index, issues);

    if (mission.veterans.length === 0) {
      issue(
        issues,
        'warning',
        'mission-no-veterans',
        `Operation "${mission.id}" carries no named personnel.`,
        `${base}.veterans`,
      );
    }
  });

  // A campaign's operation ids share one namespace with its mission documents;
  // this is what makes `meta.campaign.missionId` a stable reference.
  return issues;
}

/** Validate a loaded run against its definition. */
export function validateCampaignState(
  state: CampaignState,
  def: CampaignDef,
): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  if (state.campaignId !== def.id) {
    issue(issues, 'error', 'state-campaign-id', 'Run belongs to another campaign.', 'campaignId');
  }
  if (state.definitionVersion !== def.version) {
    issue(
      issues,
      'error',
      'state-version',
      `Run was started against definition version ${state.definitionVersion}; this build has ${def.version}.`,
      'definitionVersion',
    );
  }
  if (!isCampaignPhase(state.phase)) {
    issue(issues, 'error', 'state-phase', `Unknown campaign phase "${String(state.phase)}".`, 'phase');
  }
  if (state.commander) {
    try {
      normaliseCommanderIdentity(state.commander);
    } catch (error) {
      issue(
        issues,
        'error',
        'state-commander',
        error instanceof Error ? error.message : String(error),
        'commander',
      );
    }
  }
  const mission = def.missions.find((entry) => entry.id === state.currentMissionId);
  if (!mission) {
    issue(issues, 'error', 'state-mission-unknown', 'Run points at an unknown operation.', 'currentMissionId');
  }

  const completed = new Set<string>();
  state.completed.forEach((record, i) => {
    const path = `completed[${i}]`;
    if (!def.missions.some((entry) => entry.id === record.missionId)) {
      issue(
        issues,
        'error',
        'state-completed-unknown',
        `Accepted record names unknown operation "${record.missionId}".`,
        `${path}.missionId`,
      );
    }
    if (completed.has(record.missionId)) {
      issue(
        issues,
        'error',
        'state-completed-duplicate',
        `Operation "${record.missionId}" is accepted twice.`,
        `${path}.missionId`,
      );
    }
    completed.add(record.missionId);
    if (record.outcome !== 'victory' && record.outcome !== 'defeat') {
      issue(issues, 'error', 'state-outcome', 'Accepted record has an invalid outcome.', `${path}.outcome`);
    }
  });
  if (state.completed.some((record) => record.missionId === state.currentMissionId)) {
    issue(
      issues,
      'error',
      'state-current-completed',
      'The current operation has already been accepted.',
      'currentMissionId',
    );
  }

  const declaredVariables = new Map(def.variables.map((variable) => [variable.id, variable]));
  for (const [key, value] of Object.entries(state.variables)) {
    const declared = declaredVariables.get(key);
    if (!declared) {
      issue(
        issues,
        'error',
        'state-variable-unknown',
        `Run holds undeclared campaign variable "${key}".`,
        `variables.${key}`,
      );
      continue;
    }
    if (typeof value !== declared.type) {
      issue(
        issues,
        'error',
        'state-variable-type',
        `Campaign variable "${key}" holds ${typeof value}, expected ${declared.type}.`,
        `variables.${key}`,
      );
    }
  }
  for (const declared of def.variables) {
    if (!(declared.id in state.variables)) {
      issue(
        issues,
        'error',
        'state-variable-missing',
        `Run is missing campaign variable "${declared.id}".`,
        `variables.${declared.id}`,
      );
    }
  }

  const veteranIds = new Set<string>();
  state.veterans.forEach((veteran, i) => {
    const path = `veterans[${i}]`;
    if (veteranIds.has(veteran.id)) {
      issue(
        issues,
        'error',
        'state-veteran-duplicate',
        `Veteran "${veteran.id}" appears twice.`,
        `${path}.id`,
      );
    }
    veteranIds.add(veteran.id);
    const authored = def.roster.find((entry) => entry.id === veteran.id);
    if (!authored) {
      issue(
        issues,
        'error',
        'state-veteran-unknown',
        `Roster holds unknown individual "${veteran.id}".`,
        `${path}.id`,
      );
    } else if (authored.defId !== veteran.defId) {
      issue(
        issues,
        'error',
        'state-veteran-def',
        `Veteran "${veteran.id}" changed unit definition.`,
        `${path}.defId`,
      );
    }
    if (!UNITS[veteran.defId]) {
      issue(
        issues,
        'error',
        'state-veteran-unit',
        `Veteran "${veteran.id}" uses unknown unit "${veteran.defId}".`,
        `${path}.defId`,
      );
    }
  });

  if (state.phase === 'complete') {
    const all = def.missions.every((entry) => completed.has(entry.id));
    if (!all) {
      issue(
        issues,
        'error',
        'state-complete-early',
        'Campaign is marked complete before every operation was accepted.',
        'phase',
      );
    }
  }
  if (state.phase === 'playing' && !state.preMission) {
    issue(
      issues,
      'error',
      'state-no-snapshot',
      'A playing run has no pre-mission snapshot to retry from.',
      'preMission',
    );
  }
  if (state.phase === 'debrief' && !state.pending) {
    issue(issues, 'error', 'state-no-result', 'A debrief run has no pending result.', 'pending');
  }
  if (state.pending && state.pending.missionId !== state.currentMissionId) {
    issue(
      issues,
      'error',
      'state-pending-mission',
      'Pending result belongs to another operation.',
      'pending.missionId',
    );
  }

  const deploymentKeys = new Set<string>();
  const deploymentVeterans = new Set<string>();
  state.deployments.forEach((deployment, i) => {
    const path = `deployments[${i}]`;
    if (deploymentKeys.has(deployment.key)) {
      issue(
        issues,
        'error',
        'state-deployment-key',
        `Deployment key "${deployment.key}" is used twice.`,
        `${path}.key`,
      );
    }
    deploymentKeys.add(deployment.key);
    if (deploymentVeterans.has(deployment.veteranId)) {
      issue(
        issues,
        'error',
        'state-deployment-veteran',
        `Veteran "${deployment.veteranId}" is deployed twice.`,
        `${path}.veteranId`,
      );
    }
    deploymentVeterans.add(deployment.veteranId);
    if (!veteranIds.has(deployment.veteranId)) {
      issue(
        issues,
        'error',
        'state-deployment-missing',
        `Deployment names veteran "${deployment.veteranId}", who is not in the roster.`,
        `${path}.veteranId`,
      );
    }
  });

  return issues;
}

/** True when a definition is safe to offer in the deck. */
export function campaignDefinitionIsPlayable(
  def: CampaignDef,
  context: CampaignDefinitionContext = {},
): boolean {
  return !validateCampaignDefinition(def, context).some((entry) => entry.severity === 'error');
}

/** Slots in one operation, for authoring tests and the builder. */
export function missionVeteranSlots(
  def: CampaignDef,
  missionId: string,
): readonly CampaignVeteranSlot[] {
  return def.missions.find((mission) => mission.id === missionId)?.veterans ?? [];
}
