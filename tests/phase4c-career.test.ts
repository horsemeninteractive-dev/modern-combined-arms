import { describe, expect, it } from 'vitest';
import { AccountHarness, RESULT_TOKEN } from './accounts-harness';
import {
  ACHIEVEMENTS,
  buildAchievementView,
  pendingAchievementIds,
  type AchievementContext,
} from '../src/accounts/achievements';
import {
  careerAccomplishmentXp,
  careerXp,
  EMPTY_CAREER,
} from '../src/accounts/career';
import { CAREER_LEVELS, levelForXp } from '../src/accounts/levels';
import { matchIdFor } from '../src/accounts/matchCareer';
import { buildCareerStats } from '../src/accounts/stats';
import { COSMETICS, cosmeticById, isCosmeticUnlocked, validateEquip } from '../src/identity/cosmetics';

const match = {
  ref: 'skirmish:phase4c-0001',
  mode: 'skirmish' as const,
  outcome: 'victory' as const,
  difficulty: 'veteran' as const,
  durationSeconds: 600,
  nation: 'lithuania',
  kills: 14,
  unitsLost: 3,
};

function emptyContext(overrides: Partial<AchievementContext> = {}): AchievementContext {
  return {
    totals: { ...EMPTY_CAREER },
    stats: buildCareerStats([]),
    earnedIds: [],
    match: null,
    ...overrides,
  };
}

describe('Phase 4C service levels', () => {
  it('defines fifty strictly increasing levels beginning at zero', () => {
    expect(CAREER_LEVELS).toHaveLength(50);
    expect(CAREER_LEVELS[0].threshold).toBe(0);
    for (let i = 1; i < CAREER_LEVELS.length; i++) {
      expect(CAREER_LEVELS[i].threshold).toBeGreaterThan(CAREER_LEVELS[i - 1].threshold);
      expect(CAREER_LEVELS[i].number).toBe(i + 1);
    }
  });

  it('resolves boundaries, clamps corrupt XP and stops at level 50', () => {
    expect(levelForXp(0).level.number).toBe(1);
    expect(levelForXp(CAREER_LEVELS[1].threshold - 1).level.number).toBe(1);
    expect(levelForXp(CAREER_LEVELS[1].threshold).level.number).toBe(2);
    expect(levelForXp(CAREER_LEVELS[49].threshold).level.number).toBe(50);
    expect(levelForXp(CAREER_LEVELS[49].threshold).next).toBeNull();
    expect(levelForXp(-5).level.number).toBe(1);
    expect(levelForXp(Number.NaN).level.number).toBe(1);
  });

  it('keeps the formal rank ladder authoritative and independent of level', () => {
    const levels = [0, 400, 6_000, 58_000, 100_000].map((xp) => levelForXp(xp).level.number);
    const ranks = [0, 400, 6_000, 58_000, 100_000].map((xp) => {
      // Keep this assertion tied to the public ladder rather than a copy.
      return xp === 0 ? 'private' : xp >= 58_000 ? 'general' : 'other';
    });
    expect(levels[0]).toBe(1);
    expect(levels[4]).toBe(50);
    expect(ranks[0]).toBe('private');
    expect(ranks[4]).toBe('general');
  });
});

describe('Phase 4C XP and achievement definitions', () => {
  it('adds capped accomplishment XP without changing the base formula', () => {
    const base = careerXp(match);
    expect(careerAccomplishmentXp({})).toBe(0);
    expect(careerAccomplishmentXp({ objectivesCompleted: 2, sitesCaptured: 3, structuresDestroyed: 5 })).toBe(20);
    expect(
      careerAccomplishmentXp({
        objectivesCompleted: 999,
        sitesCaptured: 999,
        superweaponsUsed: 999,
        structuresDestroyed: 999_999,
      }),
    ).toBe(80);
    expect(base).toBe(110);
  });

  it('has unique, valid definitions and only references existing cosmetics', () => {
    const ids = new Set<string>();
    for (const definition of ACHIEVEMENTS) {
      expect(ids.has(definition.id)).toBe(false);
      ids.add(definition.id);
      expect(definition.requirement.target).toBeGreaterThan(0);
      if (definition.reward) {
        expect(cosmeticById(definition.reward.cosmeticId)?.category).toBeDefined();
      }
      if (definition.hidden) expect(definition.hidden).toBe(true);
    }
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(COSMETICS.find((item) => item.id === 'bg-frontline')?.unlock.kind).toBe('achievement');
    expect(COSMETICS.find((item) => item.id === 'frame-commendation')?.unlock.kind).toBe('achievement');
  });

  it('awards cumulative and one-match achievements once, including hidden ones', () => {
    const stats = buildCareerStats([]);
    stats.overall.matches = 1;
    stats.overall.victories = 1;
    stats.overall.unitsDestroyed = 25;
    const context = emptyContext({
      totals: { ...EMPTY_CAREER, xp: 150, matches: 1, victories: 1 },
      stats,
      match: {
        mode: 'skirmish',
        outcome: 'victory',
        nation: 'lithuania',
        durationSeconds: 300,
        unitsDestroyed: 25,
        unitsLost: 0,
        structuresDestroyed: 0,
        structuresBuilt: 0,
        sitesCaptured: 3,
        superweaponsUsed: 0,
        objectivesCompleted: 0,
      },
    });
    const pending = pendingAchievementIds(context);
    expect(pending).toContain('first-command');
    expect(pending).toContain('first-victory');
    expect(pending).toContain('combat-first');
    expect(pending).toContain('site-dominance');
    expect(pending).toContain('flawless-victory');
    expect(pendingAchievementIds({ ...context, earnedIds: pending })).toEqual([]);

    const hiddenBefore = buildAchievementView(context, new Map());
    expect(hiddenBefore.some((entry) => entry.id === 'flawless-victory')).toBe(false);
    const hiddenAfter = buildAchievementView(context, new Map([['flawless-victory', 1_700_000_000_000]]));
    expect(hiddenAfter.find((entry) => entry.id === 'flawless-victory')?.complete).toBe(true);
  });

  it('does not award a match condition without a victory', () => {
    const context = emptyContext({
      match: {
        mode: 'campaign',
        outcome: 'defeat',
        nation: 'poland',
        durationSeconds: 300,
        unitsDestroyed: 0,
        unitsLost: 0,
        structuresDestroyed: 0,
        structuresBuilt: 0,
        sitesCaptured: 3,
        superweaponsUsed: 0,
        objectivesCompleted: 0,
      },
    });
    expect(pendingAchievementIds(context)).not.toContain('flawless-victory');
    expect(pendingAchievementIds(context)).not.toContain('site-dominance');
  });

  it('gates earned cosmetics on the award, not on a client-side count', () => {
    const item = COSMETICS.find((entry) => entry.id === 'bg-frontline');
    if (!item) throw new Error('missing bg-frontline');
    expect(isCosmeticUnlocked(item, { xp: 999_999, matches: 999, wins: 999 })).toBe(false);
    expect(
      isCosmeticUnlocked(item, {
        xp: 0,
        matches: 0,
        wins: 0,
        achievements: ['multiplayer-first'],
      }),
    ).toBe(true);
    expect(validateEquip('background', 'bg-frontline', { xp: 0, matches: 0, wins: 0 })).toContain(
      'not been unlocked',
    );
  });
});

describe('Phase 4C result integration', () => {
  async function signedIn() {
    const harness = await AccountHarness.create();
    const signIn = await harness.signInGoogle('phase4c-officer');
    return { harness, cookie: `mca_session=${signIn.cookie}`, session: signIn.cookie };
  }

  it('records XP, level progress and commendations from a validated local result', async () => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/matches', {
      method: 'POST',
      cookie,
      body: {
        ...match,
        stats: { objectivesCompleted: 2, sitesCaptured: 3, structuresDestroyed: 5 },
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      recorded: boolean;
      award: { xp: number };
      rewards: { achievements: Array<{ id: string }>; levelUp: boolean; levelAfter: number };
      career: {
        totals: { xp: number; matches: number };
        level: { level: { number: number } };
        achievements: Array<{ id: string; complete: boolean }>;
      };
    };
    expect(body.recorded).toBe(true);
    expect(body.award.xp).toBe(130);
    expect(body.rewards.levelUp).toBe(true);
    expect(body.rewards.levelAfter).toBe(2);
    expect(body.rewards.achievements.map((entry) => entry.id)).toContain('first-command');
    expect(body.rewards.achievements.map((entry) => entry.id)).toContain('site-dominance');
    expect(body.career.totals.xp).toBe(130);
    expect(body.career.totals.matches).toBe(1);
    expect(body.career.level.level.number).toBe(2);
    expect(
      body.career.achievements.find((entry) => entry.id === 'first-command')?.complete,
    ).toBe(true);
  });

  it('does not duplicate a retried award or replay its notification', async () => {
    const { harness, cookie } = await signedIn();
    const first = await harness.request('/matches', { method: 'POST', cookie, body: match });
    expect(first.status).toBe(200);
    const second = await harness.request('/matches', { method: 'POST', cookie, body: match });
    const body = (await second.json()) as {
      recorded: boolean;
      award: { xp: number };
      rewards: { achievements: unknown[] };
      career: { totals: { matches: number }; achievements: Array<{ id: string; complete: boolean }> };
    };
    expect(body.recorded).toBe(false);
    expect(body.award.xp).toBe(0);
    expect(body.rewards.achievements).toEqual([]);
    expect(body.career.totals.matches).toBe(1);
    const completed = body.career.achievements.filter((entry) => entry.complete);
    expect(completed).toHaveLength(2);
    expect(new Set(completed.map((entry) => entry.id)).size).toBe(2);
  });

  it('rejects an invalid result before it can award anything', async () => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/matches', {
      method: 'POST',
      cookie,
      body: { ...match, ref: 'bad' },
    });
    expect(response.status).toBe(400);
    const career = await harness.request('/career', { cookie });
    const body = (await career.json()) as {
      career: { totals: { matches: number }; achievements: Array<{ complete: boolean }> };
    };
    expect(body.career.totals.matches).toBe(0);
    expect(body.career.achievements.every((entry) => !entry.complete)).toBe(true);
  });

  it('awards cumulative commendations after an idempotent guest migration', async () => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie,
      body: {
        guestId: 'g'.repeat(22),
        migrationKey: 'k'.repeat(20),
        profileDigest: 'a'.repeat(64),
        career: [{ ...match, ref: 'skirmish:guest-p4c' }],
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      career: { achievements: Array<{ id: string; complete: boolean }> };
    };
    expect(body.career.achievements.find((entry) => entry.id === 'first-command')?.complete).toBe(true);
    const repeat = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie,
      body: {
        guestId: 'g'.repeat(22),
        migrationKey: 'k'.repeat(20),
        profileDigest: 'a'.repeat(64),
        career: [{ ...match, ref: 'skirmish:guest-p4c' }],
      },
    });
    expect(repeat.status).toBe(200);
  });

  it('evaluates achievements from the authoritative multiplayer result', async () => {
    const harness = await AccountHarness.create();
    const signIn = await harness.signInGoogle('phase4c-mp');
    const startedAtMs = harness.now - 10 * 60_000;
    const matchId = matchIdFor('room-phase4c', startedAtMs);
    const result = await harness.request('/internal/mp-result', {
      method: 'POST',
      headers: { 'X-MCA-Result-Token': RESULT_TOKEN },
      body: {
        matchId,
        roomId: 'room-phase4c',
        mapId: 'kestrel-bay',
        startedAtMs,
        finishedAtMs: harness.now,
        winnerTeam: 0,
        players: [
          {
            team: 0,
            accountId: signIn.accountId,
            nation: 'lithuania',
            callsign: 'Sable',
            avatar: 'insignia',
            stats: {
              unitsDestroyed: 30,
              unitsLost: 0,
              structuresDestroyed: 4,
              structuresLost: 0,
              structuresBuilt: 8,
              sitesCaptured: 3,
              superweaponsUsed: 0,
              objectivesCompleted: 0,
            },
          },
          {
            team: 1,
            accountId: null,
            nation: 'russia',
            callsign: 'Vesper',
            avatar: 'insignia',
            stats: {
              unitsDestroyed: 5,
              unitsLost: 12,
              structuresDestroyed: 0,
              structuresLost: 3,
              structuresBuilt: 4,
              sitesCaptured: 0,
              superweaponsUsed: 0,
              objectivesCompleted: 0,
            },
          },
        ],
      },
    });
    expect(result.status).toBe(200);
    const outcome = await harness.request(`/career/results/${encodeURIComponent(matchId)}`, {
      cookie: `mca_session=${signIn.cookie}`,
    });
    const body = (await outcome.json()) as {
      status: string;
      achievements: Array<{ id: string }>;
    };
    expect(body.status).toBe('recorded');
    expect(body.achievements.map((entry) => entry.id)).toContain('multiplayer-first');
    expect(body.achievements.map((entry) => entry.id)).toContain('multiplayer-victory');
    expect(body.achievements.map((entry) => entry.id)).toContain('site-dominance');
  });

  it('returns per-match commendations with the service history', async () => {
    const { harness, cookie } = await signedIn();
    await harness.request('/matches', { method: 'POST', cookie, body: match });
    const history = await harness.request('/career/matches', { cookie });
    const body = (await history.json()) as {
      items: Array<{ achievements: Array<{ id: string }> }>;
    };
    expect(body.items[0]?.achievements.map((entry) => entry.id)).toContain('first-command');
  });

  it('validates an achievement-gated cosmetic against stored awards', async () => {
    const { harness, cookie, session } = await signedIn();
    const accountId = await harness.accountIdForCookie(session);
    if (!accountId) throw new Error('missing account');
    await harness.store.recordAchievements(accountId, [
      { achievementId: 'multiplayer-first', awardedAt: harness.now, matchRef: null },
    ]);
    const response = await harness.request('/flags', {
      method: 'POST',
      cookie,
      body: {
        designs: [],
        activeId: null,
        equipped: { frame: null, background: 'bg-frontline' },
        expectedRevision: 0,
      },
    });
    expect(response.status).toBe(200);
    const refused = await harness.request('/flags', {
      method: 'POST',
      cookie,
      body: {
        designs: [],
        activeId: null,
        equipped: { frame: 'frame-commendation', background: null },
        expectedRevision: 1,
      },
    });
    expect(refused.status).toBe(400);
  });
});
