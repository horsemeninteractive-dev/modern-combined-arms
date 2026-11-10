/**
 * Campaign completion derivation.
 *
 * The account service never accepts "campaign complete" as a client claim.
 * A campaign is complete only when the ledger contains victories for every
 * authored operation in that campaign and the newly recorded match is its final
 * operation. The authored catalogue is the authority; the match reference only
 * identifies which campaign and operation were played.
 */
import { CAMPAIGNS } from '../data/campaign';
import type { CareerMatchRecord } from './career';

export interface CampaignRef {
  campaignId: string;
  missionId: string;
}

export function parseCampaignRef(ref: string): CampaignRef | null {
  if (!ref.startsWith('campaign:')) return null;
  const rest = ref.slice('campaign:'.length);
  const separator = rest.indexOf(':');
  if (separator <= 0 || separator === rest.length - 1) return null;
  const campaignId = rest.slice(0, separator);
  const missionId = rest.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(campaignId) || !/^[A-Za-z0-9_-]{1,96}$/.test(missionId)) {
    return null;
  }
  return { campaignId, missionId };
}

/** A campaign the ledger proves complete, with the moment it was earned. */
export interface CampaignCompletion {
  campaignId: string;
  completedAt: number;
}

/** Mission ids this ledger won, per campaign. */
function victoriesByCampaign(
  matches: readonly CareerMatchRecord[],
): Map<string, { missions: Set<string>; at: number }> {
  const won = new Map<string, { missions: Set<string>; at: number }>();
  for (const match of matches) {
    if (match.mode !== 'campaign' || match.outcome !== 'victory') continue;
    const ref = parseCampaignRef(match.ref);
    if (!ref) continue;
    const entry = won.get(ref.campaignId) ?? { missions: new Set<string>(), at: 0 };
    entry.missions.add(ref.missionId);
    // The completion date is the newest winning operation, which is the final
    // mission whenever the campaign really is finished.
    entry.at = Math.max(entry.at, match.recordedAt);
    won.set(ref.campaignId, entry);
  }
  return won;
}

function isComplete(campaignId: string, won: Set<string>): boolean {
  const campaign = CAMPAIGNS.find((entry) => entry.id === campaignId);
  if (!campaign || campaign.missions.length === 0) return false;
  const finalMission = campaign.missions[campaign.missions.length - 1];
  return (
    won.has(finalMission.id) && campaign.missions.every((mission) => won.has(mission.id))
  );
}

/**
 * Return the campaign id this match completes, or null. The ledger is the
 * source: fabricated final-mission results without the preceding victories do
 * not complete a campaign.
 */
export function completedCampaignFor(
  record: CareerMatchRecord,
  matches: readonly CareerMatchRecord[],
): string | null {
  if (record.mode !== 'campaign' || record.outcome !== 'victory') return null;
  const ref = parseCampaignRef(record.ref);
  if (!ref) return null;
  const campaign = CAMPAIGNS.find((entry) => entry.id === ref.campaignId);
  if (!campaign) return null;
  const finalMission = campaign.missions[campaign.missions.length - 1];
  if (!finalMission || finalMission.id !== ref.missionId) return null;
  const won = victoriesByCampaign(matches).get(campaign.id)?.missions ?? new Set<string>();
  return isComplete(campaign.id, won) ? campaign.id : null;
}

/**
 * Every campaign a whole ledger proves complete, oldest first.
 *
 * Guests have no completion table, so their legacy view derives it here with
 * exactly the rule the account service applies when it records a completion.
 */
export function completedCampaignsFor(
  matches: readonly CareerMatchRecord[],
): CampaignCompletion[] {
  const won = victoriesByCampaign(matches);
  const completions: CampaignCompletion[] = [];
  for (const campaign of CAMPAIGNS) {
    const entry = won.get(campaign.id);
    if (!entry || !isComplete(campaign.id, entry.missions)) continue;
    completions.push({ campaignId: campaign.id, completedAt: entry.at });
  }
  return completions.sort((left, right) => left.completedAt - right.completedAt);
}
