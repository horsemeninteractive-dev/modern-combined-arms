import { describe, expect, it } from 'vitest';
import { AccountHarness } from './accounts-harness';
import {
  ACHIEVEMENTS,
  AWARDS,
  awardById,
  awardForAchievement,
  buildAchievementView,
  pendingAchievementIds,
  type AchievementContext,
} from '../src/accounts/achievements';
import {
  completedCampaignFor,
  completedCampaignsFor,
  parseCampaignRef,
} from '../src/accounts/campaignLegacy';
import { CAMPAIGNS } from '../src/data/campaign';
import { NATIONS, PLAYABLE_NATION_IDS } from '../src/data/factions';
import { EMPTY_CAREER, careerRecord, type CareerMatchRecord } from '../src/accounts/career';
import { buildCareerStats } from '../src/accounts/stats';
import {
  ACHIEVEMENT_STORAGE_KEY,
  evaluateLocalAchievements,
  localMatchFacts,
  readLocalAchievements,
} from '../src/accounts/localAchievements';
import {
  CAREER_STORAGE_KEY,
  readLocalCareer,
  recordLocalMatch,
  type CareerStorage,
} from '../src/accounts/localCareer';
import { CareerService } from '../src/accounts/careerService';
import { HttpAccountApi } from '../src/accounts/client';
import { COSMETICS } from '../src/identity/cosmetics';
import { commanderLegacyMarkup } from '../src/ui/commanderLegacy';
import { awardSvg } from '../src/ui/awards';

function memoryStorage(): CareerStorage & { dump(): Map<string, string> } {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    dump: () => data,
  };
}

/** An account API that always answers 401, which is what a guest session sees. */
function guestApi(): HttpAccountApi {
  return new HttpAccountApi('/api/account', async () =>
    new Response(JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'guest' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const skirmish = {
  ref: 'skirmish:phase4d-0001',
  mode: 'skirmish' as const,
  outcome: 'victory' as const,
  difficulty: 'veteran' as const,
  durationSeconds: 600,
  nation: 'lithuania',
  kills: 12,
  unitsLost: 0,
};

function campaignRef(campaignId: string, missionId: string): string {
  return `campaign:${campaignId}:${missionId}`;
}

function record(ref: string, overrides: Partial<CareerMatchRecord> = {}): CareerMatchRecord {
  return {
    ...careerRecord(
      {
        ref,
        mode: 'campaign',
        outcome: 'victory',
        difficulty: 'veteran',
        durationSeconds: 300,
        nation: 'lithuania',
      },
      { provenance: 'local', now: 1_700_000_000_000 },
    ),
    ...overrides,
  };
}

function emptyContext(overrides: Partial<AchievementContext> = {}): AchievementContext {
  return {
    totals: { ...EMPTY_CAREER },
    stats: buildCareerStats([]),
    earnedIds: [],
    match: null,
    ...overrides,
  };
}

describe('Phase 4D achievement and award registry', () => {
  it('keeps achievement ids unique and gives each one award', () => {
    const ids = new Set<string>();
    for (const definition of ACHIEVEMENTS) {
      expect(ids.has(definition.id)).toBe(false);
      ids.add(definition.id);
      const award = awardForAchievement(definition.id);
      expect(award, definition.id).not.toBeNull();
      expect(award?.achievementId).toBe(definition.id);
      expect(['medal', 'ribbon', 'commendation']).toContain(award?.type);
      expect(award?.visual.length).toBeGreaterThan(0);
    }
    const awardIds = new Set(AWARDS.map((award) => award.id));
    expect(awardIds.size).toBe(AWARDS.length);
    expect(AWARDS).toHaveLength(ACHIEVEMENTS.length);
    expect(awardById(AWARDS[0].id)?.id).toBe(AWARDS[0].id);
  });

  it('registers a national service achievement for every playable nation', () => {
    for (const nationId of PLAYABLE_NATION_IDS) {
      const definition = ACHIEVEMENTS.find((entry) => entry.id === `${nationId}-service`);
      expect(definition, nationId).toBeDefined();
      expect(definition?.category).toBe('national');
      expect(definition?.nation).toBe(nationId);
      expect(definition?.requirement.kind).toBe('metric');
      // The name of the nation comes from the registry, never a second copy.
      expect(awardForAchievement(`${nationId}-service`)?.nation).toBe(nationId);
      expect(awardForAchievement(`${nationId}-service`)?.name).toContain(NATIONS[nationId].name);
    }
    expect(PLAYABLE_NATION_IDS).toHaveLength(10);
  });

  it('references only campaigns and cosmetic rewards that exist', () => {
    const campaignIds = new Set(CAMPAIGNS.map((campaign) => campaign.id));
    for (const definition of ACHIEVEMENTS) {
      if (definition.campaign) expect(campaignIds.has(definition.campaign)).toBe(true);
      if (definition.reward) {
        expect(COSMETICS.some((item) => item.id === definition.reward!.cosmeticId)).toBe(true);
      }
      expect(definition.requirement.target).toBeGreaterThan(0);
    }
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(42);
  });

  it('does not award a nation ribbon for a nation the player never won with', () => {
    const context = emptyContext();
    const pending = pendingAchievementIds(context);
    expect(pending.some((id) => id.endsWith('-service'))).toBe(false);
  });
});

describe('Phase 4D campaign completion', () => {
  const campaign = CAMPAIGNS[0];

  it('parses only well-formed campaign references', () => {
    expect(parseCampaignRef(campaignRef('baltic-line', 'baltic-01'))).toEqual({
      campaignId: 'baltic-line',
      missionId: 'baltic-01',
    });
    expect(parseCampaignRef('skirmish:abc')).toBeNull();
    expect(parseCampaignRef('campaign:baltic-line')).toBeNull();
    expect(parseCampaignRef('campaign::baltic-01')).toBeNull();
    expect(parseCampaignRef('campaign:baltic line:baltic-01')).toBeNull();
  });

  it('completes a campaign only when every operation was won', () => {
    const all = campaign.missions.map((mission) =>
      record(campaignRef(campaign.id, mission.id)),
    );
    const finals = all[all.length - 1];
    expect(completedCampaignFor(finals, all)).toBe(campaign.id);
    expect(completedCampaignsFor(all).map((entry) => entry.campaignId)).toEqual([campaign.id]);

    const missingOne = all.filter((entry) => !entry.ref.endsWith(campaign.missions[3].id));
    expect(completedCampaignsFor(missingOne)).toEqual([]);
  });

  it('does not complete from a final-mission result alone', () => {
    const finalMission = campaign.missions[campaign.missions.length - 1];
    const only = record(campaignRef(campaign.id, finalMission.id));
    expect(completedCampaignFor(only, [only])).toBeNull();
    expect(completedCampaignsFor([only])).toEqual([]);
  });

  it('ignores a defeat on the final operation', () => {
    const all = campaign.missions.map((mission) =>
      record(campaignRef(campaign.id, mission.id)),
    );
    const final = all[all.length - 1];
    const defeat = { ...final, outcome: 'defeat' as const };
    const ledger = [...all.slice(0, -1), defeat];
    expect(completedCampaignFor(defeat, ledger)).toBeNull();
    expect(completedCampaignsFor(ledger)).toEqual([]);
  });
});

describe('Phase 4D account campaign rewards', () => {
  async function signedIn() {
    const harness = await AccountHarness.create();
    const signIn = await harness.signInGoogle('phase4d-officer');
    return { harness, cookie: `mca_session=${signIn.cookie}`, session: signIn.cookie };
  }

  it('records campaign completion, awards and permanence across a replay', async () => {
    const { harness, cookie, session } = await signedIn();
    const campaign = CAMPAIGNS[0];
    let last: Record<string, unknown> = {};
    for (const mission of campaign.missions) {
      const response = await harness.request('/matches', {
        method: 'POST',
        cookie,
        body: {
          ref: campaignRef(campaign.id, mission.id),
          mode: 'campaign',
          outcome: 'victory',
          difficulty: 'veteran',
          durationSeconds: 300,
          nation: mission.playerNationId,
        },
      });
      expect(response.status).toBe(200);
      last = (await response.json()) as Record<string, unknown>;
    }
    const career = last.career as {
      campaigns: Array<{ campaignId: string }>;
      achievements: Array<{ id: string; complete: boolean; award: { type: string } | null; awardedAt: number | null }>;
    };
    expect(career.campaigns.map((entry) => entry.campaignId)).toContain(campaign.id);
    const completed = career.achievements.filter((entry) => entry.complete).map((entry) => entry.id);
    expect(completed).toContain('campaign-complete');
    expect(completed).toContain(`${campaign.id}-complete`);
    expect(completed).not.toContain('campaign-veteran');
    const medal = career.achievements.find((entry) => entry.id === 'campaign-complete');
    expect(medal?.award?.type).toBe('medal');
    expect(medal?.awardedAt).toBeGreaterThan(0);

    const finalMission = campaign.missions[campaign.missions.length - 1];
    const replay = await harness.request('/matches', {
      method: 'POST',
      cookie,
      body: {
        ref: campaignRef(campaign.id, finalMission.id),
        mode: 'campaign',
        outcome: 'victory',
        difficulty: 'veteran',
        durationSeconds: 300,
        nation: 'lithuania',
      },
    });
    const replayBody = (await replay.json()) as {
      recorded: boolean;
      rewards: { achievements: unknown[] };
      career: { campaigns: unknown[]; achievements: Array<{ id: string; complete: boolean }> };
    };
    expect(replayBody.recorded).toBe(false);
    expect(replayBody.rewards.achievements).toEqual([]);
    expect(replayBody.career.campaigns).toHaveLength(1);

    const accountId = await harness.accountIdForCookie(session);
    if (!accountId) throw new Error('missing account');
    expect(await harness.store.careerCampaigns(accountId)).toHaveLength(1);
  });

  it('ignores a forged campaign claim on a single result', async () => {
    const { harness, cookie, session } = await signedIn();
    const campaign = CAMPAIGNS[0];
    const finalMission = campaign.missions[campaign.missions.length - 1];
    const response = await harness.request('/matches', {
      method: 'POST',
      cookie,
      body: {
        ref: campaignRef(campaign.id, finalMission.id),
        mode: 'campaign',
        outcome: 'victory',
        difficulty: 'veteran',
        durationSeconds: 300,
        nation: 'lithuania',
        campaignComplete: true,
        campaigns: [campaign.id],
        achievementIds: ['baltic-line-complete'],
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      career: { campaigns: unknown[]; achievements: Array<{ id: string; complete: boolean }> };
    };
    expect(body.career.campaigns).toEqual([]);
    expect(
      body.career.achievements.find((entry) => entry.id === 'baltic-line-complete')?.complete,
    ).toBe(false);
    const accountId = await harness.accountIdForCookie(session);
    if (!accountId) throw new Error('missing account');
    expect(await harness.store.careerCampaigns(accountId)).toEqual([]);
  });

  it('keeps awards separate from the cosmetic inventory', () => {
    const awardIds = new Set(AWARDS.map((award) => award.id));
    for (const item of COSMETICS) expect(awardIds.has(item.id)).toBe(false);
  });
});

describe('Phase 4D guest achievements', () => {
  it('awards once, persists and never duplicates across reloads', () => {
    const storage = memoryStorage();
    recordLocalMatch(storage, skirmish, 1_000);
    const matches = readLocalCareer(storage).matches;
    const first = evaluateLocalAchievements(storage, matches, null, 2_000);
    expect(first.newlyAwarded).toContain('first-command');
    expect(first.newlyAwarded).toContain('first-victory');
    const again = evaluateLocalAchievements(storage, matches, null, 3_000);
    expect(again.newlyAwarded).toEqual([]);
    expect(readLocalAchievements(storage).get('first-command')).toBe(2_000);
    expect(again.views.find((entry) => entry.id === 'first-command')?.complete).toBe(true);
  });

  it('records accomplishments for the metrics the local ledger can support', () => {
    const storage = memoryStorage();
    recordLocalMatch(storage, { ...skirmish, ref: 'skirmish:phase4d-0002' }, 1_000, {
      sitesCaptured: 3,
      objectivesCompleted: 2,
      structuresDestroyed: 6,
      structuresBuilt: 4,
      superweaponsUsed: 0,
    });
    const matches = readLocalCareer(storage).matches;
    // A one-match condition is evaluated against the match that earned it, not
    // against a reload with no event in hand.
    const state = evaluateLocalAchievements(storage, matches, localMatchFacts(matches[0]), 2_000);
    expect(state.stats.overall.sitesCaptured).toBe(3);
    expect(state.stats.overall.objectivesCompleted).toBe(2);
    expect(state.newlyAwarded).toContain('site-dominance');
    expect(storage.getItem(CAREER_STORAGE_KEY)).toContain('sitesCaptured');
  });

  it('reads a version 1 ledger without losing its history', () => {
    const storage = memoryStorage();
    const legacy = {
      version: 1,
      matches: [
        {
          ref: 'skirmish:phase4d-legacy',
          mode: 'skirmish',
          outcome: 'victory',
          difficulty: 'veteran',
          durationSeconds: 120,
          nation: 'poland',
          kills: 3,
          unitsLost: 1,
          xp: 999,
          provenance: 'local',
          recordedAt: 5_000,
        },
      ],
    };
    storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(legacy));
    const matches = readLocalCareer(storage).matches;
    expect(matches).toHaveLength(1);
    expect(matches[0].nation).toBe('poland');
    // XP is always recomputed from the shared rules, never trusted from storage.
    expect(matches[0].xp).toBeLessThan(999);
  });

  it('serves a guest career with achievements, awards and campaigns', async () => {
    const storage = memoryStorage();
    const service = new CareerService(guestApi(), storage);
    const campaign = CAMPAIGNS[0];
    for (const mission of campaign.missions) {
      await service.record({
        ref: campaignRef(campaign.id, mission.id),
        mode: 'campaign',
        outcome: 'victory',
        difficulty: 'veteran',
        durationSeconds: 300,
        nation: 'lithuania',
      });
    }
    const snapshot = await service.load();
    expect(snapshot.source).toBe('guest');
    expect(snapshot.view.campaigns?.map((entry) => entry.campaignId)).toContain(campaign.id);
    const completed = (snapshot.view.achievements ?? []).filter((entry) => entry.complete);
    expect(completed.map((entry) => entry.id)).toContain(`${campaign.id}-complete`);
    expect(completed.every((entry) => entry.award !== null)).toBe(true);
    expect(snapshot.view.stats?.modes.campaign.matches).toBe(campaign.missions.length);
  });

  it('returns guest rewards with award records and refuses a replayed result', async () => {
    const storage = memoryStorage();
    const service = new CareerService(guestApi(), storage);
    const first = await service.record(skirmish);
    expect(first.recorded).toBe(true);
    expect(first.award).toBeGreaterThan(0);
    expect(first.rewards?.achievements.map((entry) => entry.id)).toContain('first-command');
    expect(first.rewards?.achievements[0]?.award?.type).toBeDefined();
    const replay = await service.record(skirmish);
    expect(replay.recorded).toBe(false);
    expect(replay.award).toBe(0);
    expect(replay.rewards?.achievements).toEqual([]);
  });

  it('keeps one guest ledger out of another guest storage', () => {
    const first = memoryStorage();
    const second = memoryStorage();
    recordLocalMatch(first, skirmish, 1_000);
    evaluateLocalAchievements(first, readLocalCareer(first).matches, null, 1_100);
    expect(readLocalCareer(second).matches).toEqual([]);
    expect(readLocalAchievements(second).size).toBe(0);
    expect(first.getItem(ACHIEVEMENT_STORAGE_KEY)).toContain('first-command');
  });
});

describe('Phase 4D presentation', () => {
  it('renders award artwork deterministically and escapes the citation', () => {
    const award = awardForAchievement('campaign-complete');
    if (!award) throw new Error('missing award');
    const svg = awardSvg(award, { size: 40 });
    expect(svg).toBe(awardSvg(award, { size: 40 }));
    expect(svg).toContain('<svg');
    expect(svg).toContain('role="img"');
    const escaped = awardSvg({ ...award, name: '<script>alert(1)</script>' });
    expect(escaped).not.toContain('<script>');
  });

  it('draws each award type with its own silhouette', () => {
    const medal = AWARDS.find((award) => award.type === 'medal');
    const ribbon = AWARDS.find((award) => award.type === 'ribbon');
    const commendation = AWARDS.find((award) => award.type === 'commendation');
    expect(awardSvg(medal!)).toContain('viewBox="0 0 64 96"');
    expect(awardSvg(ribbon!)).toContain('viewBox="0 0 64 22"');
    expect(awardSvg(commendation!)).toContain('viewBox="0 0 64 64"');
  });

  it('renders Commander Legacy with complete data', () => {
    const context = emptyContext({ totals: { ...EMPTY_CAREER, xp: 4_000, matches: 6, victories: 4 } });
    const views = buildAchievementView(context, new Map([['first-command', 1_700_000_000_000]]));
    const html = commanderLegacyMarkup({
      snapshot: {
        source: 'account',
        view: {
          totals: { ...EMPTY_CAREER, xp: 4_000, matches: 6, victories: 4, defeats: 2, playSeconds: 7_200 },
          rank: { id: 'private', name: 'Private', abbreviation: 'PVT', grade: 'OR-1', tier: 'enlisted', threshold: 0, insignia: {} },
          level: { level: { number: 5, threshold: 3_000 }, xpInto: 1_000, xpSpan: 2_000, next: { number: 6, threshold: 5_000 }, progress: 0.5 },
          next: { id: 'corporal', name: 'Corporal', grade: 'OR-3', xpRequired: 5_000 },
          xpInto: 1_000,
          xpSpan: 2_000,
          progress: 0.5,
          matches: [],
          achievements: views,
          campaigns: [{ campaignId: CAMPAIGNS[0].id, completedAt: 1_700_000_000_000 }],
          stats: buildCareerStats([
            {
              mode: 'campaign',
              nation: 'lithuania',
              matches: 6,
              victories: 4,
              defeats: 2,
              draws: 0,
              playSeconds: 7_200,
              xp: 4_000,
              unitsDestroyed: 20,
              unitsLost: 5,
              structuresDestroyed: 2,
              structuresLost: 1,
              structuresBuilt: 4,
              sitesCaptured: 3,
              superweaponsUsed: 0,
              objectivesCompleted: 5,
            },
          ]),
          identity: null,
        },
      },
    });
    expect(html).toContain('SERVICE SUMMARY');
    expect(html).toContain('DECORATIONS');
    expect(html).toContain('NATIONAL SERVICE');
    expect(html).toContain('CAMPAIGN LEGACY');
    expect(html).toContain('MILESTONES');
    // Identity and standing are the account page head's job, so the showcase
    // does not restate the callsign it was not given.
    expect(html).not.toContain('Sable');
    expect(html).toContain(CAMPAIGNS[0].name);
    expect(html).toContain('Lithuania');
    expect(html).toContain('data-state="earned"');
    expect(html).toContain('not yet earned');
  });

  it('survives a guest with no breakdown, achievements or campaigns', () => {
    const html = commanderLegacyMarkup({
      snapshot: {
        source: 'guest',
        view: {
          totals: { ...EMPTY_CAREER },
          rank: { id: 'private', name: 'Private', abbreviation: 'PVT', grade: 'OR-1', tier: 'enlisted', threshold: 0, insignia: {} },
          level: { level: { number: 1, threshold: 0 }, xpInto: 0, xpSpan: null, next: null, progress: 0 },
          next: null,
          xpInto: 0,
          xpSpan: null,
          progress: 0,
          matches: [],
        },
      },
    });
    expect(html).toContain('No decorations yet');
    expect(html).toContain('Your milestones appear here');
    expect(html).not.toContain('undefined');
  });
});
