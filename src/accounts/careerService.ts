/**
 * The browser's view of a career.
 *
 * A guest and an account play the same way, so callers only ever ask this
 * service to load or record a match; it decides which ledger is authoritative.
 * The server owns a signed-in career. The local ledger is used only when there
 * is provably no session (a 401), never as a silent fallback after a failed
 * write — a signed-in result that failed to record must be reported, not quietly
 * filed where it can never be joined to the account.
 *
 * Achievements run through the same evaluator on both sides. For a guest the
 * facts come from the local ledger, which is why the ledger keeps the
 * accomplishment counters a match reported; the account service rebuilds the
 * same facts from its own match report.
 */
import type { CareerAccomplishments, CareerMatchInput, CareerViewData } from './career';
import { careerViewFrom, summariseCareer } from './career';
import { achievementById, awardForAchievement, type AchievementMatchFacts } from './achievements';
import { levelForXp } from './levels';
import { rankForXp } from './ranks';
import { buildCareerStats } from './stats';
import {
  guestCareerPayload,
  localCareerAllMatches,
  recordLocalMatch,
  type CareerStorage,
  type LocalCareerEntry,
} from './localCareer';
import {
  evaluateLocalAchievements,
  localMatchFacts,
  type LocalAchievementState,
} from './localAchievements';
import {
  AccountApiError,
  type AchievementSummary,
  type CareerRewards,
  type CareerView,
  type HttpAccountApi,
  type MatchResultView,
} from './client';

export interface CareerSnapshot {
  /** Account careers also carry the statistics breakdown and identity. */
  view: CareerView;
  source: 'account' | 'guest';
  /** True when the account career could not be read; the guest view is shown. */
  unavailable?: boolean;
}

export interface CareerRecordOutcome {
  snapshot: CareerSnapshot;
  award: number;
  rewards: CareerRewards | null;
  recorded: boolean;
  duplicate: boolean;
}

export const CAREER_HISTORY_LIMIT = 20;

/** A reward summary for one achievement, as the end card needs it. */
function rewardSummary(id: string): AchievementSummary | null {
  const definition = achievementById(id);
  if (!definition) return null;
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    tier: definition.tier,
    commendation: definition.commendation,
    reward: definition.reward ?? null,
    award: awardForAchievement(definition.id),
  };
}

function guestView(
  entries: readonly LocalCareerEntry[],
  state: LocalAchievementState,
): CareerView {
  return {
    ...careerViewFrom(state.totals, entries.slice(0, CAREER_HISTORY_LIMIT)),
    stats: state.stats,
    achievements: state.views,
    campaigns: state.completed.map((entry) => ({
      campaignId: entry.campaignId,
      completedAt: entry.completedAt,
    })),
    identity: null,
  };
}

export class CareerService {
  private readonly api: HttpAccountApi;
  private readonly storage: CareerStorage | null;

  constructor(api: HttpAccountApi, storage: CareerStorage | null) {
    this.api = api;
    this.storage = storage;
  }

  /** Rebuild, evaluate and persist the guest view. Null when storage is blocked. */
  private guestState(match: AchievementMatchFacts | null = null): {
    view: CareerView;
    state: LocalAchievementState;
  } | null {
    if (!this.storage) return null;
    const entries = localCareerAllMatches(this.storage);
    const state = evaluateLocalAchievements(this.storage, entries, match);
    return { view: guestView(entries, state), state };
  }

  private guestSnapshot(match: AchievementMatchFacts | null = null): CareerSnapshot {
    const built = this.guestState(match);
    if (!built) {
      // No storage: the career is empty, but the same screen must still render.
      const totals = summariseCareer([]);
      return {
        view: {
          ...careerViewFrom(totals, []),
          stats: buildCareerStats([]),
          achievements: [],
          campaigns: [],
          identity: null,
        },
        source: 'guest',
      };
    }
    return { view: built.view, source: 'guest' };
  }

  /** Read the career: the account's when signed in, the guest ledger otherwise. */
  async load(): Promise<CareerSnapshot> {
    try {
      const career = await this.api.career();
      return { view: career, source: 'account' };
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 401) return this.guestSnapshot();
      return { ...this.guestSnapshot(), unavailable: true };
    }
  }

  /**
   * Record one completed match.
   *
   * A 401 means the session ended between loading the menu and the result card;
   * the match then belongs to the local ledger, which is still transferable.
   * Every other failure is reported so the end screen can say the result was
   * not recorded.
   */
  async record(
    input: CareerMatchInput,
    stats?: CareerAccomplishments,
  ): Promise<CareerRecordOutcome> {
    try {
      const result = await this.api.recordMatch(input, stats);
      return {
        snapshot: { view: result.career, source: 'account' },
        award: result.award,
        rewards: result.rewards,
        recorded: result.recorded,
        duplicate: !result.recorded,
      };
    } catch (error) {
      if (!(error instanceof AccountApiError) || error.status !== 401) throw error;
    }
    if (!this.storage) {
      return {
        snapshot: this.guestSnapshot(),
        award: 0,
        rewards: null,
        recorded: false,
        duplicate: false,
      };
    }
    // The standing before the match is read first: the local ledger keeps only
    // the most recent rows, so it cannot be reconstructed afterwards.
    const before = summariseCareer(localCareerAllMatches(this.storage));
    const local = recordLocalMatch(this.storage, input, Date.now(), stats);
    const built = this.guestState(localMatchFacts(local.record));
    const view = built?.view ?? this.guestSnapshot().view;
    const rewards: CareerRewards = {
      achievements: (built?.state.newlyAwarded ?? [])
        .map(rewardSummary)
        .filter((entry): entry is AchievementSummary => entry !== null),
      levelBefore: levelForXp(before.xp).level.number,
      levelAfter: levelForXp(view.totals.xp).level.number,
      levelUp: levelForXp(view.totals.xp).level.number > levelForXp(before.xp).level.number,
      rankBefore: rankForXp(before.xp).rank,
      rankAfter: rankForXp(view.totals.xp).rank,
      promoted: rankForXp(view.totals.xp).rank.id !== rankForXp(before.xp).rank.id,
    };
    return {
      snapshot: { view, source: 'guest' },
      award: local.duplicate ? 0 : local.record.xp,
      rewards,
      recorded: !local.duplicate,
      duplicate: local.duplicate,
    };
  }

  /**
   * The account service's own answer for one authoritative match.
   *
   * `pending` means the room has not reported the match yet, which is normal for
   * a moment after the scoreboard appears. A guest has no authoritative award to
   * read and gets null, so the end screen can say so instead of inventing XP.
   */
  async matchOutcome(ref: string): Promise<MatchResultView | null> {
    try {
      return await this.api.matchResult(ref);
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 401) return null;
      throw error;
    }
  }

  /** The guest ledger as a migration payload; empty when nothing was played. */
  guestPayload(): CareerMatchInput[] {
    return this.storage ? guestCareerPayload(this.storage) : [];
  }

  /** Rebuild a view for a career the server just returned (after migration). */
  static fromAccount(view: CareerViewData): CareerSnapshot {
    return { view: view as CareerView, source: 'account' };
  }
}
