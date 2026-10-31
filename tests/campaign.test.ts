import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGNS,
  campaignById,
  clearedMissionCount,
  emptyCampaignProgress,
  isMissionCleared,
  isMissionUnlocked,
  missionById,
  nextMissionId,
  parseCampaignProgress,
  recordCampaignVictory,
  rememberCampaignSelection,
  resumeMissionId,
} from '../src/data/campaign';
import { ALLIANCES, NATIONS, opposingAllianceId } from '../src/data/factions';
import { BUILTIN_SCENARIOS, createEmptyScenario } from '../src/data/scenarios';
import { parseScenario } from '../src/sim/scenario';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');

describe('campaign prologue', () => {
  it('offers two coalitions with three operations each', () => {
    expect(CAMPAIGNS).toHaveLength(2);
    for (const campaign of CAMPAIGNS) {
      expect(campaign.missions).toHaveLength(3);
      expect(campaign.accent).toBe(ALLIANCES[campaign.allianceId].color);
      expect(campaign.name.length).toBeGreaterThan(0);
      expect(campaign.lede.length).toBeGreaterThan(0);
    }
  });

  it('stages every operation on a built-in theatre with a fixed cross-alliance command', () => {
    const mapIds = new Set(BUILTIN_SCENARIOS.map((entry) => entry.id));
    const missionIds = new Set<string>();

    for (const campaign of CAMPAIGNS) {
      for (const mission of campaign.missions) {
        expect(missionIds.has(mission.id), `${mission.id} is duplicated`).toBe(false);
        missionIds.add(mission.id);
        expect(mapIds.has(mission.mapId), `${mission.id} names an unknown theatre`).toBe(true);
        expect(mission.code).toMatch(/^[A-Z]+ \/ 0[1-3]$/);
        expect(mission.situation.length).toBeGreaterThan(0);
        expect(mission.threat.length).toBeGreaterThan(0);
        expect(mission.objectives.length).toBeGreaterThan(0);
        expect(new Set(mission.objectives).size).toBe(mission.objectives.length);
        expect(mission.objectives.every((objective) => objective.trim().length > 0)).toBe(true);

        const command = NATIONS[mission.playerNationId];
        const opposition = NATIONS[mission.opponentNationId];
        expect(command, `${mission.id} has no command nation`).toBeDefined();
        expect(opposition, `${mission.id} has no opposing nation`).toBeDefined();
        // Campaign sides are authored, not picked: the player's command belongs
        // to the campaign alliance and the opposition to the other one.
        expect(command.allianceId).toBe(campaign.allianceId);
        expect(opposition.allianceId).toBe(opposingAllianceId(campaign.allianceId));
      }
    }
  });

  it('falls back to the first campaign and operation for stale selections', () => {
    expect(campaignById('missing').id).toBe(CAMPAIGNS[0].id);
    expect(missionById(CAMPAIGNS[0], 'missing').id).toBe(CAMPAIGNS[0].missions[0].id);
  });
});

describe('campaign progression', () => {
  it('starts with only the first operation of each campaign unlocked', () => {
    const empty = emptyCampaignProgress();
    for (const campaign of CAMPAIGNS) {
      expect(isMissionUnlocked(empty, campaign, campaign.missions[0].id)).toBe(true);
      expect(isMissionUnlocked(empty, campaign, campaign.missions[1].id)).toBe(false);
      expect(isMissionUnlocked(empty, campaign, campaign.missions[2].id)).toBe(false);
      expect(resumeMissionId(empty, campaign)).toBe(campaign.missions[0].id);
      expect(clearedMissionCount(empty, campaign)).toBe(0);
    }
  });

  it('unlocks exactly the next operation after a victory', () => {
    const campaign = CAMPAIGNS[0];
    const [first, second, third] = campaign.missions;
    const afterFirst = recordCampaignVictory(emptyCampaignProgress(), campaign.id, first.id);

    expect(isMissionCleared(afterFirst, campaign.id, first.id)).toBe(true);
    expect(isMissionUnlocked(afterFirst, campaign, first.id)).toBe(true);
    expect(isMissionUnlocked(afterFirst, campaign, second.id)).toBe(true);
    expect(isMissionUnlocked(afterFirst, campaign, third.id)).toBe(false);
    expect(resumeMissionId(afterFirst, campaign)).toBe(second.id);
    expect(clearedMissionCount(afterFirst, campaign)).toBe(1);

    const afterSecond = recordCampaignVictory(afterFirst, campaign.id, second.id);
    expect(isMissionUnlocked(afterSecond, campaign, third.id)).toBe(true);
    expect(resumeMissionId(afterSecond, campaign)).toBe(third.id);
    expect(clearedMissionCount(afterSecond, campaign)).toBe(2);

    const afterThird = recordCampaignVictory(afterSecond, campaign.id, third.id);
    expect(clearedMissionCount(afterThird, campaign)).toBe(3);
    expect(resumeMissionId(afterThird, campaign)).toBe(third.id);
    expect(nextMissionId(campaign, third.id)).toBeNull();
  });

  it('does not duplicate a replay or unlock another campaign', () => {
    const campaign = CAMPAIGNS[0];
    const first = campaign.missions[0];
    const afterFirst = recordCampaignVictory(emptyCampaignProgress(), campaign.id, first.id);
    const replayed = recordCampaignVictory(afterFirst, campaign.id, first.id);
    const other = CAMPAIGNS[1];

    expect(replayed).toBe(afterFirst);
    expect(isMissionUnlocked(afterFirst, other, other.missions[1].id)).toBe(false);
    expect(recordCampaignVictory(afterFirst, 'missing', first.id)).toBe(afterFirst);
    expect(recordCampaignVictory(afterFirst, campaign.id, 'missing')).toBe(afterFirst);
  });

  it('remembers the last operation and drops a stale selection', () => {
    const campaign = CAMPAIGNS[1];
    const selected = rememberCampaignSelection(
      emptyCampaignProgress(),
      campaign.id,
      campaign.missions[1].id,
    );

    expect(selected.lastSelection).toEqual({
      campaignId: campaign.id,
      missionId: campaign.missions[1].id,
    });
    expect(parseCampaignProgress(JSON.parse(JSON.stringify(selected)))).toEqual(selected);
    expect(
      parseCampaignProgress({
        version: 1,
        cleared: {},
        lastSelection: { campaignId: 'missing', missionId: campaign.missions[0].id },
      }),
    ).toEqual(emptyCampaignProgress());
    expect(
      parseCampaignProgress({
        version: 1,
        cleared: {},
        lastSelection: { campaignId: campaign.id, missionId: 'missing' },
      }),
    ).toEqual(emptyCampaignProgress());
    expect(rememberCampaignSelection(selected, 'missing', 'missing')).toBe(selected);

    const cleared = recordCampaignVictory(selected, campaign.id, campaign.missions[1].id);
    expect(cleared.lastSelection).toEqual(selected.lastSelection);
  });

  it('rejects malformed or stale saved progress', () => {
    expect(parseCampaignProgress(null)).toEqual(emptyCampaignProgress());
    expect(parseCampaignProgress({ version: 2, cleared: {} })).toEqual(emptyCampaignProgress());
    expect(parseCampaignProgress({ version: 1, cleared: [] })).toEqual(emptyCampaignProgress());

    const parsed = parseCampaignProgress({
      version: 1,
      cleared: {
        [CAMPAIGNS[0].id]: [
          CAMPAIGNS[0].missions[1].id,
          'unknown-operation',
          CAMPAIGNS[0].missions[0].id,
          CAMPAIGNS[0].missions[0].id,
        ],
      },
    });
    expect(parsed.cleared[CAMPAIGNS[0].id]).toEqual([
      CAMPAIGNS[0].missions[0].id,
      CAMPAIGNS[0].missions[1].id,
    ]);
  });
});

describe('campaign provenance', () => {
  it('survives a scenario JSON round trip so a saved battle can unlock its next operation', () => {
    const scenario = createEmptyScenario(32, 32);
    scenario.meta.campaign = {
      campaignId: CAMPAIGNS[0].id,
      missionId: CAMPAIGNS[0].missions[0].id,
    };
    const roundTripped = parseScenario(JSON.parse(JSON.stringify(scenario)));
    expect(roundTripped.meta.campaign).toEqual(scenario.meta.campaign);
  });
});

describe('campaign screen', () => {
  it('mounts its own rail level, menu panel and deploy control', () => {
    expect(html).toContain('data-menu-view="campaign"');
    expect(html).toContain('data-menu-level="campaign"');
    expect(html).toContain('data-menu-panel="campaign"');
    expect(html).toContain('id="campaign-missions"');
    expect(html).toContain('id="campaign-map-canvas"');
    expect(html).toContain('id="btn-campaign-deploy"');
  });

  it('routes deployment through the campaign scenario, not the skirmish settings', () => {
    expect(app).toContain("on('btn-campaign-deploy', () => void this.startBattle(this.campaignScenario()));");
    expect(app).toContain("view === 'campaign'");
    expect(app).toContain("this.setMenuBackdrop(this.campaignScenario())");
  });
});
