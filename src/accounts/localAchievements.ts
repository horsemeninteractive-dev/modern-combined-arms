/**
 * Guest achievements.
 *
 * A guest plays the same operations as an account holder, so the same
 * evaluator must run against the local ledger. Only the facts the local ledger
 * actually holds are used: mode, outcome, duration, nation, kills, losses and
 * the accomplishments the end card reported. Nothing is invented, and the
 * server re-evaluates from its own ledger after migration, so a hand-edited
 * local record can only change what this browser displays — never an account.
 */
import {
  buildAchievementView,
  pendingAchievementIds,
  type AchievementContext,
  type AchievementMatchFacts,
  type AchievementView,
} from './achievements';
import { summariseCareer, type CareerMatchRecord, type CareerTotals } from './career';
import { completedCampaignsFor } from './campaignLegacy';
import { buildCareerStats, type CareerStats } from './stats';

export const ACHIEVEMENT_STORAGE_KEY = 'mca.achievements.v1';
export const ACHIEVEMENT_STORAGE_VERSION = 1 as const;

export interface AchievementStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredAchievements {
  version: typeof ACHIEVEMENT_STORAGE_VERSION;
  earned: Array<{ id: string; awardedAt: number }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Earned ids and dates. Unknown or malformed rows are dropped, not trusted. */
export function readLocalAchievements(storage: AchievementStorage): Map<string, number> {
  const earned = new Map<string, number>();
  let raw: string | null;
  try {
    raw = storage.getItem(ACHIEVEMENT_STORAGE_KEY);
  } catch {
    return earned;
  }
  if (!raw) return earned;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return earned;
  }
  if (!isRecord(parsed) || parsed.version !== ACHIEVEMENT_STORAGE_VERSION) return earned;
  for (const entry of Array.isArray(parsed.earned) ? parsed.earned : []) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    const awardedAt = typeof entry.awardedAt === 'number' && Number.isFinite(entry.awardedAt)
      ? entry.awardedAt
      : 0;
    if (!earned.has(entry.id)) earned.set(entry.id, awardedAt);
  }
  return earned;
}

function writeLocalAchievements(storage: AchievementStorage, earned: Map<string, number>): void {
  const document: StoredAchievements = {
    version: ACHIEVEMENT_STORAGE_VERSION,
    earned: [...earned.entries()].map(([id, awardedAt]) => ({ id, awardedAt })),
  };
  try {
    storage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify(document));
  } catch {
    /* a blocked store costs the award after this session, nothing else */
  }
}

/** The guest's authoritative-in-this-browser totals and breakdown. */
export function localCareerStats(matches: readonly CareerMatchRecord[]): CareerStats {
  // The local ledger does not keep per-match structures lost or built, so those
  // two counters stay at zero rather than being guessed from kills.
  return buildCareerStats(
    matches.map((match) => ({
      mode: match.mode,
      nation: match.nation,
      matches: 1,
      victories: match.outcome === 'victory' ? 1 : 0,
      defeats: match.outcome === 'defeat' ? 1 : 0,
      draws: match.outcome === 'draw' ? 1 : 0,
      playSeconds: match.durationSeconds,
      xp: match.xp,
      unitsDestroyed: match.kills,
      unitsLost: match.unitsLost,
      structuresDestroyed: match.accomplishments?.structuresDestroyed ?? 0,
      structuresLost: 0,
      structuresBuilt: match.accomplishments?.structuresBuilt ?? 0,
      sitesCaptured: match.accomplishments?.sitesCaptured ?? 0,
      superweaponsUsed: match.accomplishments?.superweaponsUsed ?? 0,
      objectivesCompleted: match.accomplishments?.objectivesCompleted ?? 0,
    })),
  );
}

/** Everything the evaluator needs, rebuilt from the local ledger alone. */
export function localAchievementContext(
  matches: readonly CareerMatchRecord[],
  earnedIds: readonly string[],
  match: AchievementMatchFacts | null = null,
): { totals: CareerTotals; stats: CareerStats; context: AchievementContext; completed: ReturnType<typeof completedCampaignsFor> } {
  const totals = summariseCareer(matches);
  const stats = localCareerStats(matches);
  const completed = completedCampaignsFor(matches);
  return {
    totals,
    stats,
    completed,
    context: {
      totals,
      stats,
      earnedIds,
      match,
      completedCampaignIds: completed.map((entry) => entry.campaignId),
    },
  };
}

export interface LocalAchievementState {
  /** All earned ids and the moment they were earned. */
  awardedAt: Map<string, number>;
  /** Newly earned by this evaluation, for the notification queue. */
  newlyAwarded: string[];
  /** Every achievement with local progress. */
  views: AchievementView[];
  totals: CareerTotals;
  stats: CareerStats;
  completed: ReturnType<typeof completedCampaignsFor>;
}

/**
 * Evaluate and persist guest achievements.
 *
 * Idempotent: an already-earned id is never awarded twice, and the same match
 * replaying through the end card cannot add progress because the local ledger
 * itself refuses a duplicate reference.
 */
export function evaluateLocalAchievements(
  storage: AchievementStorage,
  matches: readonly CareerMatchRecord[],
  match: AchievementMatchFacts | null,
  now: number = Date.now(),
): LocalAchievementState {
  const earned = readLocalAchievements(storage);
  const { context, totals, stats, completed } = localAchievementContext(
    matches,
    [...earned.keys()],
    match,
  );
  const pending = pendingAchievementIds(context);
  if (pending.length > 0) {
    for (const id of pending) earned.set(id, now);
    writeLocalAchievements(storage, earned);
  }
  return {
    awardedAt: earned,
    newlyAwarded: pending,
    views: buildAchievementView(context, earned),
    totals,
    stats,
    completed,
  };
}

/** Match facts for the evaluator, from one recorded local match. */
export function localMatchFacts(match: CareerMatchRecord): AchievementMatchFacts {
  return {
    mode: match.mode,
    outcome: match.outcome,
    nation: match.nation,
    durationSeconds: match.durationSeconds,
    unitsDestroyed: match.kills,
    unitsLost: match.unitsLost,
    structuresDestroyed: match.accomplishments?.structuresDestroyed ?? 0,
    structuresBuilt: match.accomplishments?.structuresBuilt ?? 0,
    sitesCaptured: match.accomplishments?.sitesCaptured ?? 0,
    superweaponsUsed: match.accomplishments?.superweaponsUsed ?? 0,
    objectivesCompleted: match.accomplishments?.objectivesCompleted ?? 0,
  };
}
