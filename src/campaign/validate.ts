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
import { MUSIC_TRACKS_BY_ID } from '../ui/musicCatalogue';
import { isMissionId, validateMission } from '../mission/validate';
import type { MissionCinematicStep } from '../mission/types';
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

function cinematicStepSeconds(step: MissionCinematicStep): number {
  if (step.kind === 'camera') return step.durationSeconds + (step.holdSeconds ?? 0);
  if (step.kind === 'line') return step.durationSeconds + (step.pauseSeconds ?? 0);
  if (step.kind === 'sound') return step.durationSeconds ?? 0;
  if (step.kind === 'card' || step.kind === 'music') return step.durationSeconds ?? 0;
  if (step.kind === 'actor') return step.durationSeconds;
  return step.durationSeconds ?? 2.5;
}

/**
 * Authored media must stay inside the project, with no scheme or traversal.
 *
 * Campaign scenes are authored against no particular theatre, so entity and
 * position bounds are checked when the scene plays; media paths are not, because
 * a bad one would be requested immediately.
 */
function safeCinematicAsset(value: string): boolean {
  return /^(?!\/\/)(?!.*\.\.)[A-Za-z0-9._~!$&'()+,;=:@%/-]+$/.test(value);
}

function finitePosition(x: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(z);
}

function cinematicEaseValid(ease: string | undefined): boolean {
  return ease === undefined || ease === 'smooth' || ease === 'linear' || ease === 'cut';
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

  /* ---------------------------------------------------------------- */
  /* Campaign-level framing scenes                                     */
  /* ---------------------------------------------------------------- */

  const campaignCinematicIds = new Set<string>();
  (def.cinematics ?? []).forEach((cinematic, i) => {
    const base = `cinematics[${i}]`;
    if (!isMissionId(cinematic.id)) {
      issue(issues, 'error', 'campaign-cinematic-id', 'Campaign cinematic id is invalid.', `${base}.id`);
    }
    if (campaignCinematicIds.has(cinematic.id)) {
      issue(
        issues,
        'error',
        'campaign-cinematic-duplicate',
        `Campaign cinematic "${cinematic.id}" is authored twice.`,
        `${base}.id`,
      );
    }
    campaignCinematicIds.add(cinematic.id);
    if (!['campaignIntro', 'intermission', 'campaignFinale'].includes(cinematic.kind)) {
      issue(
        issues,
        'error',
        'campaign-cinematic-context',
        `Campaign cinematic "${cinematic.id}" uses unsupported context "${cinematic.kind}".`,
        `${base}.kind`,
      );
    }
    if (cinematic.steps.length === 0) {
      issue(
        issues,
        'error',
        'campaign-cinematic-empty',
        `Campaign cinematic "${cinematic.id}" has no timeline steps.`,
        `${base}.steps`,
      );
    }
    let total = 0;
    cinematic.steps.forEach((step, s) => {
      const path = `${base}.steps[${s}]`;
      total += cinematicStepSeconds(step);
      if (step.kind === 'camera') {
        if (!Number.isFinite(step.durationSeconds) || step.durationSeconds < 0) {
          issue(issues, 'error', 'campaign-cinematic-duration', 'Camera move duration must be zero or more.', `${path}.durationSeconds`);
        }
        if (step.holdSeconds !== undefined && (!Number.isFinite(step.holdSeconds) || step.holdSeconds < 0)) {
          issue(issues, 'error', 'campaign-cinematic-duration', 'Camera hold must be zero or more.', `${path}.holdSeconds`);
        }
        if (step.zoom !== undefined && (!Number.isFinite(step.zoom) || step.zoom <= 0 || step.zoom > 110)) {
          issue(issues, 'error', 'campaign-cinematic-zoom', 'Camera zoom must be above 0 and at most 110.', `${path}.zoom`);
        }
        if (
          step.rotationDegrees !== undefined &&
          (!Number.isFinite(step.rotationDegrees) ||
            step.rotationDegrees < -360 ||
            step.rotationDegrees > 360)
        ) {
          issue(issues, 'error', 'campaign-cinematic-rotation', 'Camera rotation must be between -360 and 360 degrees.', `${path}.rotationDegrees`);
        }
        if (step.shake !== undefined && (!Number.isFinite(step.shake) || step.shake < 0 || step.shake > 1)) {
          issue(issues, 'error', 'campaign-cinematic-shake', 'Camera shake must be between 0 and 1.', `${path}.shake`);
        }
        if (!cinematicEaseValid(step.ease)) {
          issue(issues, 'error', 'campaign-cinematic-ease', 'Camera ease must be smooth, linear or cut.', `${path}.ease`);
        }
        if (step.track && step.target.kind !== 'entity') {
          issue(
            issues,
            'warning',
            'campaign-cinematic-track-no-entity',
            'Camera tracking needs an entity target; this beat holds a fixed framing.',
            `${path}.track`,
          );
        }
        if (step.target.kind === 'position' && !finitePosition(step.target.x, step.target.z)) {
          issue(issues, 'error', 'campaign-cinematic-target', 'Camera position must be finite.', `${path}.target`);
        } else if (step.target.kind === 'entity' && step.target.entity.trim().length === 0) {
          issue(issues, 'error', 'campaign-cinematic-target', 'Camera focus entity is empty.', `${path}.target.entity`);
        }
      } else if (step.kind === 'line') {
        if (step.text.trim().length === 0) {
          issue(issues, 'error', 'campaign-cinematic-line', 'Dialogue beat has no text.', `${path}.text`);
        }
        if (step.speaker.trim().length === 0) {
          issue(issues, 'warning', 'campaign-cinematic-speaker', 'Dialogue beat has no speaker.', `${path}.speaker`);
        }
        if (!Number.isFinite(step.durationSeconds) || step.durationSeconds <= 0) {
          issue(issues, 'error', 'campaign-cinematic-duration', 'Dialogue beat needs a positive duration.', `${path}.durationSeconds`);
        }
        if (step.pauseSeconds !== undefined && (!Number.isFinite(step.pauseSeconds) || step.pauseSeconds < 0)) {
          issue(issues, 'error', 'campaign-cinematic-duration', 'Dialogue pause must be zero or more.', `${path}.pauseSeconds`);
        }
        if (step.portrait !== undefined && !safeCinematicAsset(step.portrait)) {
          issue(issues, 'error', 'campaign-cinematic-asset', 'Portrait path must be a project-relative asset.', `${path}.portrait`);
        }
        if (step.voice !== undefined && !safeCinematicAsset(step.voice)) {
          issue(issues, 'error', 'campaign-cinematic-asset', 'Voice path must be a project-relative asset.', `${path}.voice`);
        }
      } else if (step.kind === 'notify') {
        if (step.text.trim().length === 0) {
          issue(issues, 'error', 'campaign-cinematic-notice', 'Notice beat has no text.', `${path}.text`);
        }
        if (step.durationSeconds !== undefined && (!Number.isFinite(step.durationSeconds) || step.durationSeconds <= 0)) {
          issue(issues, 'error', 'campaign-cinematic-duration', 'Notice beat needs a positive duration.', `${path}.durationSeconds`);
        }
        if (step.heading !== undefined && step.heading.trim().length === 0) {
          issue(issues, 'error', 'campaign-cinematic-notice', 'Notice heading has no text.', `${path}.heading`);
        }
      } else if (step.kind === 'effect') {
        if (!['explosion', 'smoke', 'dust', 'muzzle'].includes(step.effect)) {
          issue(issues, 'error', 'campaign-cinematic-effect', `Unsupported effect "${String(step.effect)}".`, `${path}.effect`);
        }
        if (step.scale !== undefined && (!Number.isFinite(step.scale) || step.scale <= 0)) {
          issue(issues, 'error', 'campaign-cinematic-effect', 'Effect scale must be above zero.', `${path}.scale`);
        }
        if (step.durationSeconds !== undefined && (!Number.isFinite(step.durationSeconds) || step.durationSeconds <= 0)) {
          issue(issues, 'error', 'campaign-cinematic-duration', 'Effect beat needs a positive duration.', `${path}.durationSeconds`);
        }
        if (step.target.kind === 'position' && !finitePosition(step.target.x, step.target.z)) {
          issue(issues, 'error', 'campaign-cinematic-target', 'Effect position must be finite.', `${path}.target`);
        } else if (step.target.kind === 'entity' && step.target.entity.trim().length === 0) {
          issue(issues, 'error', 'campaign-cinematic-target', 'Effect target entity is empty.', `${path}.target.entity`);
        }
      } else if (step.kind === 'actor') {
        if (step.entity.trim().length === 0) {
          issue(issues, 'error', 'campaign-cinematic-actor', 'Actor beat names no entity.', `${path}.entity`);
        }
        if (!Number.isFinite(step.durationSeconds) || step.durationSeconds < 0) {
          issue(issues, 'error', 'campaign-cinematic-duration', 'Actor beat timing must be zero or more.', `${path}.durationSeconds`);
        }
        if (step.action === 'move') {
          if (!finitePosition(step.x, step.z)) {
            issue(issues, 'error', 'campaign-cinematic-target', 'Actor destination must be finite.', path);
          }
          if (!cinematicEaseValid(step.ease)) {
            issue(issues, 'error', 'campaign-cinematic-ease', 'Actor ease must be smooth, linear or cut.', `${path}.ease`);
          }
        } else if (step.action === 'turn') {
          if (!Number.isFinite(step.facingDegrees)) {
            issue(issues, 'error', 'campaign-cinematic-turn', 'Actor facing must be a finite number of degrees.', `${path}.facingDegrees`);
          }
          if (!cinematicEaseValid(step.ease)) {
            issue(issues, 'error', 'campaign-cinematic-ease', 'Actor ease must be smooth, linear or cut.', `${path}.ease`);
          }
        } else if (step.action === 'animate') {
          if (step.pose !== 'idle' && step.pose !== 'walk') {
            issue(
              issues,
              'error',
              'campaign-cinematic-pose',
              `Unsupported actor pose "${String(step.pose)}"; the renderer has idle and walk only.`,
              `${path}.pose`,
            );
          }
          if (!(step.durationSeconds > 0)) {
            issue(issues, 'error', 'campaign-cinematic-duration', 'Animation beat needs a positive duration.', `${path}.durationSeconds`);
          }
        } else if (step.action === 'fire') {
          if (step.scale !== undefined && (!Number.isFinite(step.scale) || step.scale <= 0)) {
            issue(issues, 'error', 'campaign-cinematic-effect', 'Fire beat scale must be above zero.', `${path}.scale`);
          }
          if (step.target.kind === 'restore') {
            issue(issues, 'error', 'campaign-cinematic-target', 'Fire needs a world position or entity target.', `${path}.target`);
          } else if (step.target.kind === 'position' && !finitePosition(step.target.x, step.target.z)) {
            issue(issues, 'error', 'campaign-cinematic-target', 'Fire target must be finite.', `${path}.target`);
          } else if (step.target.kind === 'entity' && step.target.entity.trim().length === 0) {
            issue(issues, 'error', 'campaign-cinematic-target', 'Fire target entity is empty.', `${path}.target.entity`);
          }
        } else if (step.action === 'enter' || step.action === 'leave') {
          if (step.structure.trim().length === 0) {
            issue(issues, 'error', 'campaign-cinematic-structure', 'Actor structure is empty.', `${path}.structure`);
          }
          if (step.structure === step.entity) {
            issue(issues, 'error', 'campaign-cinematic-structure', 'An actor cannot enter or leave itself.', `${path}.structure`);
          }
          if (step.action === 'leave' && !finitePosition(step.x, step.z)) {
            issue(issues, 'error', 'campaign-cinematic-target', 'Actor exit destination must be finite.', path);
          }
        }
      } else if (step.kind === 'card') {
        if (step.heading.trim().length === 0) {
          issue(issues, 'error', 'campaign-cinematic-card', 'Chapter card has no heading.', `${path}.heading`);
        }
        if (!Number.isFinite(step.durationSeconds) || step.durationSeconds <= 0) {
          issue(issues, 'error', 'campaign-cinematic-duration', 'Chapter card needs a positive duration.', `${path}.durationSeconds`);
        }
      } else if (step.kind === 'music') {
        if (!MUSIC_TRACKS_BY_ID.has(step.track)) {
          issue(
            issues,
            'error',
            'campaign-cinematic-music',
            `Music beat names "${step.track}", which is not an authored soundtrack track.`,
            `${path}.track`,
          );
        }
        if (
          step.durationSeconds !== undefined &&
          (!Number.isFinite(step.durationSeconds) || step.durationSeconds < 0)
        ) {
          issue(issues, 'error', 'campaign-cinematic-duration', 'Music beat timing must be zero or more.', `${path}.durationSeconds`);
        }
      } else if (step.kind === 'sound') {
        if (step.cue.trim().length === 0) {
          issue(issues, 'error', 'campaign-cinematic-sound', 'Sound beat has no cue name.', `${path}.cue`);
        }
        if (step.gain !== undefined && (!Number.isFinite(step.gain) || step.gain < 0 || step.gain > 1)) {
          issue(issues, 'error', 'campaign-cinematic-sound', 'Sound gain must be between 0 and 1.', `${path}.gain`);
        }
        if (step.durationSeconds !== undefined && (!Number.isFinite(step.durationSeconds) || step.durationSeconds < 0)) {
          issue(issues, 'error', 'campaign-cinematic-duration', 'Sound beat timing must be zero or more.', `${path}.durationSeconds`);
        }
      }
    });
    // Edge transitions are presentation only; the checks are structural so a
    // typo cannot silently become a cut in a scene the author wanted to dip.
    (['in', 'out'] as const).forEach((edge) => {
      const transition = cinematic.transition?.[edge];
      if (!transition) return;
      const edgePath = `${base}.transition.${edge}`;
      if (transition.kind !== 'cut' && transition.kind !== 'fade') {
        issue(
          issues,
          'error',
          'campaign-cinematic-transition',
          'Transition kind must be cut or fade.',
          `${edgePath}.kind`,
        );
      }
      if (!Number.isFinite(transition.durationSeconds) || transition.durationSeconds < 0) {
        issue(
          issues,
          'error',
          'campaign-cinematic-transition',
          'Transition duration must be zero or more.',
          `${edgePath}.durationSeconds`,
        );
      } else if (transition.kind === 'fade' && transition.durationSeconds === 0) {
        issue(
          issues,
          'warning',
          'campaign-cinematic-transition',
          'A zero-second fade is a cut; this transition has no effect.',
          `${edgePath}.durationSeconds`,
        );
      }
    });
    if (!(total > 0)) {
      issue(
        issues,
        'warning',
        'campaign-cinematic-zero-duration',
        `Campaign cinematic "${cinematic.id}" would finish on its first frame.`,
        `${base}.steps`,
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
