/**
 * Read-only campaign outlook for a pending mission result.
 *
 * The debrief must be able to say what *would* change without changing it. This
 * module derives that answer from the same definition and pending result the
 * acceptance transaction will use, but it never mutates the campaign state or
 * the veteran roster. `acceptCampaignResult` remains the only writer.
 */
import type { CampaignDef } from '../data/campaign';
import type { MissionValue } from '../mission';
import type { CampaignState } from './types';

export interface CampaignOutlookConsequence {
  key: string;
  value: MissionValue;
  /** Campaign variable description, when the definition authored one. */
  description?: string;
}

export interface CampaignOutlookVeteran {
  id: string;
  name: string;
  /** True when the captured result says this individual did not survive. */
  lost: boolean;
  survived: boolean;
}

export interface CampaignOutlook {
  missionId: string;
  missionName: string;
  consequences: CampaignOutlookConsequence[];
  veterans: CampaignOutlookVeteran[];
  nextMissionId: string | null;
  nextMissionName: string | null;
  finalOperation: boolean;
}

/**
 * What accepting the pending result would do, or null when no result is
 * pending. A result whose operation or deployment cannot be resolved returns
 * null rather than inventing campaign consequences.
 */
export function campaignResultOutlook(
  state: CampaignState,
  def: CampaignDef,
): CampaignOutlook | null {
  if (state.phase !== 'debrief' || !state.pending) return null;
  const pending = state.pending;
  if (pending.missionId !== state.currentMissionId) return null;
  const index = def.missions.findIndex((entry) => entry.id === pending.missionId);
  if (index < 0) return null;
  const mission = def.missions[index];
  const next = def.missions[index + 1] ?? null;

  const consequences = mission.mission.consequences.map((consequence) => {
    const declared = def.variables.find((entry) => entry.id === consequence.key);
    return {
      key: consequence.key,
      value: consequence.value,
      ...(consequence.description ?? declared?.description
        ? { description: consequence.description ?? declared?.description }
        : {}),
    };
  });

  const veterans = pending.deployments.map((deployment) => {
    const entity = pending.result.entities.find((entry) => entry.key === deployment.key);
    const roster = state.veterans.find((entry) => entry.id === deployment.veteranId);
    const survived = entity?.survived ?? false;
    return {
      id: deployment.veteranId,
      name: roster?.name ?? deployment.veteranId,
      lost: !survived,
      survived,
    };
  });

  return {
    missionId: mission.id,
    missionName: mission.name,
    consequences,
    veterans,
    nextMissionId: next?.id ?? null,
    nextMissionName: next?.name ?? null,
    finalOperation: next === null,
  };
}
