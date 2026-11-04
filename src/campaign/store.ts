/**
 * Campaign save envelope.
 *
 * A campaign save is deliberately separate from a battle save: the battle save
 * carries the live `MissionRuntime`, while this file carries progress between
 * missions. Reading is definition-aware, so an operation removed from the
 * campaign cannot resurrect a stale run state.
 */
import { resumeMissionId, type CampaignDef, type CampaignProgress } from '../data/campaign';
import { normalizeCampaignState } from './state';
import {
  CAMPAIGN_SAVE_FORMAT,
  CAMPAIGN_SAVE_VERSION,
  type CampaignSaveDoc,
  type CampaignState,
} from './types';

export function emptyCampaignSave(): CampaignSaveDoc {
  return {
    format: CAMPAIGN_SAVE_FORMAT,
    version: CAMPAIGN_SAVE_VERSION,
    runs: {},
  };
}

function seedLegacyRun(def: CampaignDef, cleared: readonly string[]): CampaignState {
  const known = new Set(cleared);
  const completed = def.missions
    .filter((mission) => known.has(mission.id))
    .map((mission) => ({
      missionId: mission.id,
      outcome: 'victory' as const,
      legacy: true,
    }));
  const allComplete = completed.length === def.missions.length;
  const progress: CampaignProgress = {
    version: 1,
    cleared: cleared.length > 0 ? { [def.id]: [...cleared] } : {},
  };
  return {
    campaignId: def.id,
    definitionVersion: def.version,
    // A migrated deck never asked for a profile; the commander screen fills it
    // before the next deployment.
    commander: null,
    phase: allComplete ? 'complete' : 'briefing',
    currentMissionId: resumeMissionId(progress, def),
    completed,
    variables: Object.fromEntries(def.variables.map((variable) => [variable.id, variable.default])),
    veterans: def.roster.map((entry) => ({
      id: entry.id,
      name: entry.name,
      defId: entry.defId,
      role: entry.role,
      missions: [],
    })),
    preMission: null,
    deployments: [],
    pending: null,
  };
}

/**
 * Read a campaign save.
 *
 * Unknown campaigns, runs that no longer match their definition and a stale
 * selection are dropped. Missing runs stay missing so the deck offers a new
 * campaign instead of pretending one exists.
 */
export function parseCampaignSave(
  raw: unknown,
  defs: readonly CampaignDef[],
): CampaignSaveDoc {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyCampaignSave();
  const record = raw as Record<string, unknown>;
  if (record.format !== CAMPAIGN_SAVE_FORMAT) return emptyCampaignSave();
  if (record.version !== CAMPAIGN_SAVE_VERSION) return emptyCampaignSave();
  const source = record.runs;
  const runs: Record<string, CampaignState> = {};
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const def of defs) {
      const state = normalizeCampaignState(
        def,
        (source as Record<string, unknown>)[def.id],
      );
      if (state) runs[def.id] = state;
    }
  }
  let lastSelection: CampaignSaveDoc['lastSelection'];
  const selectionRaw = record.lastSelection;
  if (selectionRaw && typeof selectionRaw === 'object' && !Array.isArray(selectionRaw)) {
    const selection = selectionRaw as Record<string, unknown>;
    if (typeof selection.campaignId === 'string' && typeof selection.missionId === 'string') {
      const def = defs.find((entry) => entry.id === selection.campaignId);
      if (def?.missions.some((mission) => mission.id === selection.missionId)) {
        lastSelection = {
          campaignId: def.id,
          missionId: selection.missionId,
        };
      }
    }
  }
  return {
    format: CAMPAIGN_SAVE_FORMAT,
    version: CAMPAIGN_SAVE_VERSION,
    runs,
    ...(lastSelection ? { lastSelection } : {}),
  };
}

/**
 * Bring a pre-S4 `CampaignProgress` forward.
 *
 * The old deck stored only cleared ids. Those become accepted legacy records so
 * the roster does not lose operations the player already finished; no result is
 * invented, and legacy records are not debriefable. Campaign variables and the
 * veteran roster start at their authored defaults, because the old deck kept no
 * record of either.
 */
export function migrateLegacyCampaignProgress(
  progress: CampaignProgress,
  defs: readonly CampaignDef[],
): CampaignSaveDoc {
  const runs: Record<string, CampaignState> = {};
  for (const def of defs) {
    const cleared = progress.cleared[def.id] ?? [];
    if (cleared.length === 0) continue;
    runs[def.id] = seedLegacyRun(def, cleared);
  }
  let lastSelection: CampaignSaveDoc['lastSelection'];
  if (progress.lastSelection) {
    const def = defs.find((entry) => entry.id === progress.lastSelection?.campaignId);
    if (def?.missions.some((mission) => mission.id === progress.lastSelection?.missionId)) {
      lastSelection = {
        campaignId: def.id,
        missionId: progress.lastSelection.missionId,
      };
    }
  }
  return {
    format: CAMPAIGN_SAVE_FORMAT,
    version: CAMPAIGN_SAVE_VERSION,
    runs,
    ...(lastSelection ? { lastSelection } : {}),
  };
}
