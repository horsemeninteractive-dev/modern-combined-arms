/**
 * Campaign definitions and deck progression helpers.
 *
 * A campaign is authored data, not a second scenario format: every operation
 * embeds a real, versioned `MissionDoc` and deploys on a campaign theatre
 * authored for that operation. The mission document is what the authoritative
 * simulation runs, so campaign battles and skirmish battles share one runtime.
 *
 * The campaign layer (src/campaign) owns progress between missions. The helpers
 * at the bottom of this file are the deck's view of that progress: the cleared
 * set is derived from accepted mission records, never stored twice.
 *
 * The operations themselves live in `opsBaltic.ts` and `opsEastern.ts`, one
 * module per campaign, because twenty-four mission documents in one file cannot
 * be read or reviewed. This module stays the single catalogue.
 */
import type { MissionDoc } from '../mission/types';
import type { CampaignVeteranSlot } from '../campaign/types';
import { BALTIC_OPERATIONS } from './campaign/opsBaltic';
import { EASTERN_OPERATIONS } from './campaign/opsEastern';

/**
 * Definition version. Kept at 1 across the content expansion: the original
 * operation ids, orders and campaign variables are unchanged, so a run started
 * against the earlier deck still resolves its accepted records and its next
 * operation is simply the following entry in the longer chain. The version is
 * for *shape* changes, and the shape did not change.
 */
export const CAMPAIGN_DEFINITION_VERSION = 1;

export interface CampaignMission {
  id: string;
  /** Short operation code shared by the rail, dossier and brief. */
  code: string;
  name: string;
  /** Campaign theatre this operation deploys on; authored for this operation. */
  mapId: string;
  /** One-line operation type shown under the rail entry. */
  focus: string;
  situation: string;
  threat: string;
  /** Authored objectives for this operation, primary first. */
  objectives: readonly string[];
  /** The campaign side's fixed command. */
  playerNationId: string;
  /** The fixed opposing command. */
  opponentNationId: string;
  /** The authoritative, versioned mission document this operation runs. */
  mission: MissionDoc;
  /** Named individuals this operation may carry out of the campaign roster. */
  veterans: readonly CampaignVeteranSlot[];
}

export interface CampaignVariable {
  id: string;
  type: 'number' | 'boolean' | 'string';
  default: number | boolean | string;
  description?: string;
}

export interface CampaignRosterEntry {
  id: string;
  name: string;
  defId: string;
  role: 'veteran' | 'asset';
}

export interface CampaignDef {
  id: string;
  /** Definition version a run is started against and validated with. */
  version: number;
  name: string;
  /** Coalition label, also the campaign's colour source. */
  coalition: string;
  /** Alliance id the campaign fights for. */
  allianceId: string;
  /** Coalition colour, used for the tab mark and the player's map callouts. */
  accent: string;
  lede: string;
  note: string;
  /** Campaign-level persistent variables, written by mission consequences. */
  variables: readonly CampaignVariable[];
  /** The persistent named individuals the campaign starts with. */
  roster: readonly CampaignRosterEntry[];
  missions: readonly CampaignMission[];
}

/** Campaign variables every operation's consequences are allowed to write. */
const CAMPAIGN_VARIABLES: readonly CampaignVariable[] = [
  { id: 'standing', type: 'number', default: 0, description: 'Operations accepted for the coalition.' },
  { id: 'lastOperation', type: 'string', default: '', description: 'Most recently accepted operation.' },
];

export const CAMPAIGNS: readonly CampaignDef[] = [
  {
    id: 'baltic-line',
    version: CAMPAIGN_DEFINITION_VERSION,
    name: 'The Baltic Line',
    coalition: 'Atlantic Accord',
    allianceId: 'defender',
    accent: '#37b6e0',
    lede:
      'Twelve operations holding, then retaking, the Baltic approach: a beachhead on Kestrel Bay, the passes of Rust Valley, the foundry city, the granite uplands and finally the Kestrel Straits. Lithuania opens the line, Poland brings the armour, the United Kingdom fights for the sea lane, Finland screens the north and Sweden leads the counter-stroke. Finland and Sweden entered when the corridor reached the Gulf of Finland, opening a northern front the coalition now holds with Baltic and Scandinavian formations alike.',
    note: 'Fixed commands · blue versus red. Each operation is a standalone battle with its own theatre and force.',
    variables: CAMPAIGN_VARIABLES,
    roster: [
      { id: 'vet-kestrel', name: 'Sgt. Emilija Raudonė', defId: 'rifle', role: 'veteran' },
      { id: 'vet-vilkas', name: 'Cpl. Tomas Vilkas', defId: 'medic', role: 'veteran' },
    ],
    missions: BALTIC_OPERATIONS,
  },
  {
    id: 'eastern-corridor',
    version: CAMPAIGN_DEFINITION_VERSION,
    name: 'The Eastern Corridor',
    coalition: 'Eurasian Pact',
    allianceId: 'eastern',
    accent: '#ef6a4a',
    lede:
      'Twelve operations driving the corridor to the coast and then defending it: the Red Beach landing, the foundry pocket, the strait blockade, the armoured breach and the winter road. Russia lands the corps, Belarus fights the cities, Iran supplies the drones, North Korea the siege guns, and the corridor holds the straits at the end of the season. Iran and North Korea joined once the corridor became a long war, supplying the reach the corps could no longer afford itself.',
    note: 'Fixed commands · red versus blue. Each operation is a standalone battle with its own theatre and force.',
    variables: CAMPAIGN_VARIABLES,
    roster: [
      { id: 'vet-volkov', name: 'Sgt. Dmitri Volkov', defId: 'rifle', role: 'veteran' },
      { id: 'vet-amari', name: 'Cpl. Nadia Amari', defId: 'atgm', role: 'veteran' },
    ],
    missions: EASTERN_OPERATIONS,
  },
];

/** A campaign, or the first one for an unknown id. */
export function campaignById(id: string): CampaignDef {
  return CAMPAIGNS.find((campaign) => campaign.id === id) ?? CAMPAIGNS[0];
}

/** An operation in a campaign, or that campaign's first operation. */
export function missionById(campaign: CampaignDef, id: string): CampaignMission {
  return campaign.missions.find((mission) => mission.id === id) ?? campaign.missions[0];
}

/** The campaign and operation the player left open in the deck. */
export interface CampaignSelection {
  campaignId: string;
  missionId: string;
}

/**
 * The deck's persistent view of a campaign: operations the player has finished
 * and the last operation they had open.
 *
 * This is derived from authoritative campaign state by `campaignProgressOf`; it
 * is not a second stored source of truth.
 */
export interface CampaignProgress {
  version: 1;
  /** Campaign id -> cleared operation ids, in campaign order. */
  cleared: Record<string, string[]>;
  /** Restored on the next visit so the deck reopens where the player left it. */
  lastSelection?: CampaignSelection;
}

export function emptyCampaignProgress(): CampaignProgress {
  return { version: 1, cleared: {} };
}

export function isMissionCleared(
  progress: CampaignProgress,
  campaignId: string,
  missionId: string,
): boolean {
  return progress.cleared[campaignId]?.includes(missionId) ?? false;
}

/** The first operation is always open; later ones need the previous clear. */
export function isMissionUnlocked(
  progress: CampaignProgress,
  campaign: CampaignDef,
  missionId: string,
): boolean {
  const index = campaign.missions.findIndex((mission) => mission.id === missionId);
  if (index < 0) return false;
  if (index === 0) return true;
  return (
    isMissionCleared(progress, campaign.id, campaign.missions[index - 1].id) ||
    isMissionCleared(progress, campaign.id, missionId)
  );
}

export function clearedMissionCount(progress: CampaignProgress, campaign: CampaignDef): number {
  return campaign.missions.filter((mission) => isMissionCleared(progress, campaign.id, mission.id))
    .length;
}

/** The first open, unfinished operation; the last operation once all are clear. */
export function resumeMissionId(
  progress: CampaignProgress,
  campaign: CampaignDef,
): string {
  return (
    campaign.missions.find(
      (mission) =>
        isMissionUnlocked(progress, campaign, mission.id) &&
        !isMissionCleared(progress, campaign.id, mission.id),
    ) ?? campaign.missions[campaign.missions.length - 1]
  ).id;
}

/** The next operation in the authored order, or null at the end of a campaign. */
export function nextMissionId(campaign: CampaignDef, missionId: string): string | null {
  const index = campaign.missions.findIndex((mission) => mission.id === missionId);
  return index >= 0 ? (campaign.missions[index + 1]?.id ?? null) : null;
}

/** Remember the operation currently shown in the campaign deck. */
export function rememberCampaignSelection(
  progress: CampaignProgress,
  campaignId: string,
  missionId: string,
): CampaignProgress {
  const campaign = CAMPAIGNS.find((entry) => entry.id === campaignId);
  if (!campaign || !campaign.missions.some((mission) => mission.id === missionId)) {
    return progress;
  }
  if (
    progress.lastSelection?.campaignId === campaignId &&
    progress.lastSelection.missionId === missionId
  ) {
    return progress;
  }
  return { ...progress, lastSelection: { campaignId, missionId } };
}

/** Record a victory without duplicating a replay; unknown ids are ignored. */
export function recordCampaignVictory(
  progress: CampaignProgress,
  campaignId: string,
  missionId: string,
): CampaignProgress {
  const campaign = CAMPAIGNS.find((entry) => entry.id === campaignId);
  if (!campaign || !campaign.missions.some((mission) => mission.id === missionId)) {
    return progress;
  }
  if (isMissionCleared(progress, campaignId, missionId)) return progress;
  const cleared = new Set([...(progress.cleared[campaignId] ?? []), missionId]);
  return {
    version: 1,
    cleared: {
      ...progress.cleared,
      [campaignId]: campaign.missions
        .filter((mission) => cleared.has(mission.id))
        .map((mission) => mission.id),
    },
    ...(progress.lastSelection ? { lastSelection: progress.lastSelection } : {}),
  };
}

/** Reject stale, malformed or unknown progress instead of unlocking nonsense. */
export function parseCampaignProgress(raw: unknown): CampaignProgress {
  if (!raw || typeof raw !== 'object') return emptyCampaignProgress();
  const record = raw as { version?: unknown; cleared?: unknown; lastSelection?: unknown };
  if (record.version !== 1) return emptyCampaignProgress();
  const source = record.cleared;
  if (!source || typeof source !== 'object') return emptyCampaignProgress();
  const cleared: Record<string, string[]> = {};
  for (const campaign of CAMPAIGNS) {
    const entries = (source as Record<string, unknown>)[campaign.id];
    if (!Array.isArray(entries)) continue;
    const known = new Set(entries.filter((id): id is string => typeof id === 'string'));
    const ordered = campaign.missions
      .filter((mission) => known.has(mission.id))
      .map((mission) => mission.id);
    if (ordered.length > 0) cleared[campaign.id] = ordered;
  }
  // A stale or hand-edited selection is dropped without discarding the cleared
  // set; the menu then falls back to the first unfinished operation.
  const selectionRaw = record.lastSelection;
  let lastSelection: CampaignSelection | undefined;
  if (selectionRaw && typeof selectionRaw === 'object') {
    const selection = selectionRaw as Record<string, unknown>;
    const campaignId = selection.campaignId;
    const missionId = selection.missionId;
    if (typeof campaignId === 'string' && typeof missionId === 'string') {
      const campaign = CAMPAIGNS.find((entry) => entry.id === campaignId);
      if (campaign?.missions.some((mission) => mission.id === missionId)) {
        lastSelection = { campaignId, missionId };
      }
    }
  }
  return { version: 1, cleared, ...(lastSelection ? { lastSelection } : {}) };
}
