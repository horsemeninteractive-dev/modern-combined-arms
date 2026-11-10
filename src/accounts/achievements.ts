/**
 * Career achievements and commendations.
 *
 * Definitions are data, not conditionals scattered through routes. Evaluation
 * is a pure function over the account's authoritative totals, grouped match
 * statistics, the current validated match report and the awards already held.
 * The same function produces both the award decision and the progress the
 * service record displays, so the two cannot disagree.
 *
 * Every initial award is one-time. A repeated match reference cannot re-award
 * anything because the ledger refuses it and awards are uniquely keyed by
 * `(accountId, achievementId)` in the store.
 */
import type { CareerMode, CareerOutcome, CareerTotals } from './career';
import type { CareerStats } from './stats';
import { levelForXp } from './levels';
import { NATIONS, PLAYABLE_NATION_IDS } from '../data/factions';

export type AchievementCategory =
  | 'operational'
  | 'combat'
  | 'command'
  | 'national'
  | 'multiplayer'
  | 'campaign'
  | 'career';

export type AchievementTier = 'bronze' | 'silver' | 'gold';

export interface AchievementMatchFacts {
  mode: CareerMode;
  outcome: CareerOutcome;
  nation: string | null;
  durationSeconds: number;
  unitsDestroyed: number;
  unitsLost: number;
  structuresDestroyed: number;
  structuresBuilt: number;
  sitesCaptured: number;
  superweaponsUsed: number;
  objectivesCompleted: number;
}

type Metric =
  | { kind: 'matches'; mode?: CareerMode }
  | { kind: 'wins'; mode?: CareerMode }
  | { kind: 'units-destroyed'; mode?: CareerMode }
  | { kind: 'structures-destroyed'; mode?: CareerMode }
  | { kind: 'sites-captured'; mode?: CareerMode }
  | { kind: 'superweapons-used'; mode?: CareerMode }
  | { kind: 'objectives-completed'; mode?: CareerMode }
  | { kind: 'nations-played' }
  | { kind: 'nations-won' }
  | { kind: 'nation-wins'; nation: string }
  | { kind: 'campaigns-completed'; campaignId?: string }
  | { kind: 'career-level' }
  | { kind: 'achievements-earned' };

type MatchCondition =
  | { kind: 'flawless-victory'; minDurationSeconds: number }
  | { kind: 'site-dominance'; minimumSites: number }
  | { kind: 'campaign-flawless'; minDurationSeconds: number };

export type AwardType = 'medal' | 'ribbon' | 'commendation';

/** An earned award record. Awards are never part of the cosmetic inventory. */
export interface AwardDefinition {
  id: string;
  achievementId: string;
  name: string;
  description: string;
  type: AwardType;
  /** Deterministic visual token consumed by the procedural renderer. */
  visual: string;
  priority: number;
  hidden: boolean;
  nation: string | null;
  campaign: string | null;
  mode: CareerMode | null;
}

interface AwardOverride {
  type?: AwardType;
  name?: string;
  description?: string;
  visual?: string;
  priority?: number;
}

type Requirement =
  | { kind: 'metric'; metric: Metric; target: number }
  | { kind: 'match'; condition: MatchCondition; target: 1 };

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  tier: AchievementTier;
  /** Earned records only; never equipable and never a rank substitute. */
  commendation: string;
  hidden?: boolean;
  reward?: { kind: 'cosmetic'; cosmeticId: string };
  award?: AwardOverride;
  /** Account-wide by default; campaign awards are scoped to one campaign. */
  scope?: 'account' | 'campaign';
  mode?: CareerMode;
  nation?: string;
  campaign?: string;
  /** Stable display order, lower first. */
  order?: number;
  repeatable?: false;
  requirement: Requirement;
}

const BASE_ACHIEVEMENTS: readonly AchievementDefinition[] = Object.freeze([
  {
    id: 'first-command',
    name: 'First Command',
    description: 'Complete your first operation.',
    category: 'career',
    tier: 'bronze',
    commendation: 'Service Entry',
    requirement: { kind: 'metric', metric: { kind: 'matches' }, target: 1 },
  },
  {
    id: 'steady-service',
    name: 'Steady Service',
    description: 'Complete ten operations.',
    category: 'career',
    tier: 'bronze',
    commendation: 'Service Record',
    requirement: { kind: 'metric', metric: { kind: 'matches' }, target: 10 },
  },
  {
    id: 'long-service',
    name: 'Long Service',
    description: 'Complete fifty operations.',
    category: 'career',
    tier: 'silver',
    commendation: 'Long Service',
    requirement: { kind: 'metric', metric: { kind: 'matches' }, target: 50 },
  },
  {
    id: 'first-victory',
    name: 'First Victory',
    description: 'Win your first operation.',
    category: 'career',
    tier: 'bronze',
    commendation: 'Victory Badge',
    requirement: { kind: 'metric', metric: { kind: 'wins' }, target: 1 },
  },
  {
    id: 'field-command',
    name: 'Field Command',
    description: 'Win ten operations.',
    category: 'command',
    tier: 'silver',
    commendation: 'Field Command',
    requirement: { kind: 'metric', metric: { kind: 'wins' }, target: 10 },
  },
  {
    id: 'operational-veteran',
    name: 'Operational Veteran',
    description: 'Win twenty-five operations.',
    category: 'command',
    tier: 'gold',
    commendation: 'Operational Veteran',
    requirement: { kind: 'metric', metric: { kind: 'wins' }, target: 25 },
  },
  {
    id: 'combat-first',
    name: 'Combat First',
    description: 'Destroy twenty-five enemy units.',
    category: 'combat',
    tier: 'bronze',
    commendation: 'Combat Badge',
    requirement: { kind: 'metric', metric: { kind: 'units-destroyed' }, target: 25 },
  },
  {
    id: 'armoured-fist',
    name: 'Armoured Fist',
    description: 'Destroy two hundred and fifty enemy units.',
    category: 'combat',
    tier: 'silver',
    commendation: 'Armoured Fist',
    requirement: { kind: 'metric', metric: { kind: 'units-destroyed' }, target: 250 },
  },
  {
    id: 'demolition',
    name: 'Demolition',
    description: 'Destroy fifty enemy structures.',
    category: 'combat',
    tier: 'silver',
    commendation: 'Demolition',
    requirement: { kind: 'metric', metric: { kind: 'structures-destroyed' }, target: 50 },
  },
  {
    id: 'strategic-sites',
    name: 'Strategic Sites',
    description: 'Capture ten strategic sites.',
    category: 'command',
    tier: 'silver',
    commendation: 'Strategic Sites',
    requirement: { kind: 'metric', metric: { kind: 'sites-captured' }, target: 10 },
  },
  {
    id: 'thunderbolt',
    name: 'Thunderbolt',
    description: 'Deploy a superweapon.',
    category: 'command',
    tier: 'gold',
    commendation: 'Strategic Strike',
    requirement: { kind: 'metric', metric: { kind: 'superweapons-used' }, target: 1 },
  },
  {
    id: 'combined-arms',
    name: 'Combined Arms',
    description: 'Complete twenty-five objectives.',
    category: 'command',
    tier: 'silver',
    commendation: 'Combined Arms',
    requirement: { kind: 'metric', metric: { kind: 'objectives-completed' }, target: 25 },
  },
  {
    id: 'campaign-first',
    name: 'Campaign Service',
    description: 'Win your first campaign operation.',
    category: 'campaign',
    tier: 'bronze',
    commendation: 'Campaign Service',
    requirement: { kind: 'metric', metric: { kind: 'wins', mode: 'campaign' }, target: 1 },
  },
  {
    id: 'campaign-service',
    name: 'Campaign Veteran',
    description: 'Win ten campaign operations.',
    category: 'campaign',
    tier: 'gold',
    commendation: 'Campaign Veteran',
    requirement: { kind: 'metric', metric: { kind: 'wins', mode: 'campaign' }, target: 10 },
  },
  {
    id: 'multiplayer-first',
    name: 'Coalition Service',
    description: 'Complete your first multiplayer match.',
    category: 'multiplayer',
    tier: 'bronze',
    commendation: 'Coalition Service',
    reward: { kind: 'cosmetic', cosmeticId: 'bg-frontline' },
    requirement: { kind: 'metric', metric: { kind: 'matches', mode: 'multiplayer' }, target: 1 },
  },
  {
    id: 'multiplayer-victory',
    name: 'Coalition Victory',
    description: 'Win a multiplayer match against a human opponent.',
    category: 'multiplayer',
    tier: 'silver',
    commendation: 'Coalition Victory',
    requirement: { kind: 'metric', metric: { kind: 'wins', mode: 'multiplayer' }, target: 1 },
  },
  {
    id: 'multiplayer-service',
    name: 'Frontline Service',
    description: 'Complete ten multiplayer matches.',
    category: 'multiplayer',
    tier: 'silver',
    commendation: 'Frontline Service',
    requirement: { kind: 'metric', metric: { kind: 'matches', mode: 'multiplayer' }, target: 10 },
  },
  {
    id: 'coalition-command',
    name: 'Coalition Command',
    description: 'Win five multiplayer matches.',
    category: 'multiplayer',
    tier: 'gold',
    commendation: 'Coalition Command',
    requirement: { kind: 'metric', metric: { kind: 'wins', mode: 'multiplayer' }, target: 5 },
  },
  {
    id: 'national-service',
    name: 'National Service',
    description: 'Play matches with five different nations.',
    category: 'national',
    tier: 'silver',
    commendation: 'National Service',
    requirement: { kind: 'metric', metric: { kind: 'nations-played' }, target: 5 },
  },
  {
    id: 'allied-command',
    name: 'Allied Command',
    description: 'Win with three different nations.',
    category: 'national',
    tier: 'gold',
    commendation: 'Allied Command',
    requirement: { kind: 'metric', metric: { kind: 'nations-won' }, target: 3 },
  },
  {
    id: 'career-officer',
    name: 'Career Officer',
    description: 'Reach service level 10.',
    category: 'career',
    tier: 'silver',
    commendation: 'Career Officer',
    requirement: { kind: 'metric', metric: { kind: 'career-level' }, target: 10 },
  },
  {
    id: 'career-command',
    name: 'Career Command',
    description: 'Reach service level 25.',
    category: 'career',
    tier: 'gold',
    commendation: 'Career Command',
    reward: { kind: 'cosmetic', cosmeticId: 'frame-commendation' },
    requirement: { kind: 'metric', metric: { kind: 'career-level' }, target: 25 },
  },
  {
    id: 'decorated',
    name: 'Decorated',
    description: 'Earn five commendations.',
    category: 'career',
    tier: 'gold',
    commendation: 'Decorated Service',
    requirement: { kind: 'metric', metric: { kind: 'achievements-earned' }, target: 5 },
  },
  {
    id: 'site-dominance',
    name: 'Site Dominance',
    description: 'Win a match while capturing at least three strategic sites.',
    category: 'command',
    tier: 'silver',
    commendation: 'Site Dominance',
    requirement: { kind: 'match', condition: { kind: 'site-dominance', minimumSites: 3 }, target: 1 },
  },
  {
    id: 'flawless-victory',
    name: 'Flawless Victory',
    description: 'Win a match of at least three minutes without losing a unit.',
    category: 'combat',
    tier: 'gold',
    commendation: 'Flawless Victory',
    hidden: true,
    award: { type: 'medal', name: 'Unblemished Service Medal', priority: 12 },
    order: 90,
    requirement: { kind: 'match', condition: { kind: 'flawless-victory', minDurationSeconds: 180 }, target: 1 },
  },
  {
    id: 'campaign-operations',
    name: 'Campaign Operations',
    description: 'Win twelve campaign operations.',
    category: 'campaign',
    tier: 'gold',
    commendation: 'Campaign Operations',
    mode: 'campaign',
    order: 30,
    award: { type: 'medal', name: 'Campaign Operations Medal', priority: 18 },
    requirement: { kind: 'metric', metric: { kind: 'wins', mode: 'campaign' }, target: 12 },
  },
  {
    id: 'campaign-objectives',
    name: 'Campaign Objectives',
    description: 'Complete sixty objectives in campaign operations.',
    category: 'campaign',
    tier: 'silver',
    commendation: 'Campaign Objectives',
    mode: 'campaign',
    order: 31,
    award: { type: 'commendation', name: 'Objective Citation', priority: 42 },
    requirement: { kind: 'metric', metric: { kind: 'objectives-completed', mode: 'campaign' }, target: 60 },
  },
  {
    id: 'campaign-flawless',
    name: 'Campaign Without Loss',
    description: 'Win a campaign operation of at least three minutes without losing a unit.',
    category: 'campaign',
    tier: 'gold',
    commendation: 'Campaign Without Loss',
    hidden: true,
    mode: 'campaign',
    order: 32,
    award: { type: 'medal', name: 'Campaign Efficiency Medal', priority: 16 },
    requirement: { kind: 'match', condition: { kind: 'campaign-flawless', minDurationSeconds: 180 }, target: 1 },
  },
  {
    id: 'campaign-complete',
    name: 'Campaign Complete',
    description: 'Complete a full campaign.',
    category: 'campaign',
    tier: 'gold',
    commendation: 'Campaign Completion',
    scope: 'campaign',
    order: 33,
    award: { type: 'medal', name: 'Campaign Service Medal', priority: 10 },
    requirement: { kind: 'metric', metric: { kind: 'campaigns-completed' }, target: 1 },
  },
  {
    id: 'baltic-line-complete',
    name: 'The Baltic Line',
    description: 'Complete The Baltic Line campaign.',
    category: 'campaign',
    tier: 'gold',
    commendation: 'Baltic Line Commendation',
    scope: 'campaign',
    campaign: 'baltic-line',
    order: 34,
    award: { type: 'medal', name: 'Baltic Line Medal', visual: 'baltic', priority: 8 },
    requirement: { kind: 'metric', metric: { kind: 'campaigns-completed', campaignId: 'baltic-line' }, target: 1 },
  },
  {
    id: 'eastern-corridor-complete',
    name: 'The Eastern Corridor',
    description: 'Complete The Eastern Corridor campaign.',
    category: 'campaign',
    tier: 'gold',
    commendation: 'Eastern Corridor Commendation',
    scope: 'campaign',
    campaign: 'eastern-corridor',
    order: 35,
    award: { type: 'medal', name: 'Eastern Corridor Medal', visual: 'eastern', priority: 8 },
    requirement: { kind: 'metric', metric: { kind: 'campaigns-completed', campaignId: 'eastern-corridor' }, target: 1 },
  },
  {
    id: 'campaign-veteran',
    name: 'Campaign Veteran',
    description: 'Complete both campaigns.',
    category: 'campaign',
    tier: 'gold',
    commendation: 'Campaign Veteran',
    scope: 'campaign',
    order: 36,
    award: { type: 'medal', name: 'Campaign Veteran Medal', priority: 7 },
    requirement: { kind: 'metric', metric: { kind: 'campaigns-completed' }, target: 2 },
  },
]);

const NATION_SERVICE: Readonly<
  Record<string, { title: string; description: string; target: number; tier: AchievementTier }>
> = Object.freeze({
  lithuania: {
    title: 'Iron Wolf Service',
    description: 'Win four operations commanding Lithuanian forces.',
    target: 4,
    tier: 'silver',
  },
  poland: {
    title: 'Winged Hussar Service',
    description: 'Win four operations commanding Polish forces.',
    target: 4,
    tier: 'silver',
  },
  uk: {
    title: 'Island Watch',
    description: 'Win four operations commanding United Kingdom forces.',
    target: 4,
    tier: 'silver',
  },
  finland: {
    title: 'Winter Line',
    description: 'Win three operations commanding Finnish forces.',
    target: 3,
    tier: 'bronze',
  },
  sweden: {
    title: 'Northern Shield',
    description: 'Win three operations commanding Swedish forces.',
    target: 3,
    tier: 'bronze',
  },
  russia: {
    title: 'Deep Battle Service',
    description: 'Win four operations commanding Russian forces.',
    target: 4,
    tier: 'silver',
  },
  belarus: {
    title: 'Western Marches',
    description: 'Win three operations commanding Belarusian forces.',
    target: 3,
    tier: 'bronze',
  },
  hungary: {
    title: 'Danube Guard',
    description: 'Win three operations commanding Hungarian forces.',
    target: 3,
    tier: 'bronze',
  },
  iran: {
    title: 'Persian Gate',
    description: 'Win three operations commanding Iranian forces.',
    target: 3,
    tier: 'bronze',
  },
  northKorea: {
    title: 'Eastern Citadel',
    description: 'Win three operations commanding North Korean forces.',
    target: 3,
    tier: 'bronze',
  },
});

const NATION_ACHIEVEMENTS: readonly AchievementDefinition[] = Object.freeze(
  PLAYABLE_NATION_IDS.map((nationId, index) => {
    const nation = NATIONS[nationId];
    const service = NATION_SERVICE[nationId] ?? {
      title: `${nation.name} Service`,
      description: `Win three operations commanding ${nation.name} forces.`,
      target: 3,
      tier: 'bronze' as const,
    };
    return {
      id: `${nationId}-service`,
      name: service.title,
      description: service.description,
      category: 'national' as const,
      tier: service.tier,
      commendation: `${nation.name} Service`,
      nation: nationId,
      order: 200 + index,
      award: { type: 'ribbon' as const, name: `${nation.name} Service Ribbon`, visual: nationId, priority: 55 },
      requirement: {
        kind: 'metric' as const,
        metric: { kind: 'nation-wins' as const, nation: nationId },
        target: service.target,
      },
    };
  }),
);

export const ACHIEVEMENTS: readonly AchievementDefinition[] = Object.freeze([
  ...BASE_ACHIEVEMENTS,
  ...NATION_ACHIEVEMENTS,
]);

export const AWARDS: readonly AwardDefinition[] = Object.freeze(
  [...ACHIEVEMENTS]
    .sort((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.id.localeCompare(right.id))
    .map((definition, index) => {
      const override = definition.award ?? {};
      const type: AwardType =
        override.type ??
        (definition.category === 'national'
          ? 'ribbon'
          : definition.category === 'campaign' || definition.category === 'career'
            ? definition.tier === 'gold'
              ? 'medal'
              : 'ribbon'
            : definition.tier === 'gold'
              ? 'commendation'
              : 'commendation');
      return {
        id: `award-${definition.id}`,
        achievementId: definition.id,
        name: override.name ?? definition.commendation,
        description: override.description ?? definition.description,
        type,
        visual: override.visual ?? definition.id,
        priority: override.priority ?? 100 + index,
        hidden: definition.hidden === true,
        nation: definition.nation ?? null,
        campaign: definition.campaign ?? null,
        mode: definition.mode ?? null,
      };
    }),
);

export interface AchievementAward {
  achievementId: string;
  awardedAt: number;
  matchRef: string | null;
}

export interface AchievementView {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  tier: AchievementTier;
  commendation: string;
  hidden: boolean;
  reward: { kind: 'cosmetic'; cosmeticId: string } | null;
  award: AwardDefinition | null;
  scope: 'account' | 'campaign';
  mode: CareerMode | null;
  nation: string | null;
  campaign: string | null;
  order: number;
  awardedAt: number | null;
  progress: number;
  target: number;
  complete: boolean;
}

export interface AchievementContext {
  totals: CareerTotals;
  stats: CareerStats;
  earnedIds: readonly string[];
  match: AchievementMatchFacts | null;
  completedCampaignIds?: readonly string[];
}

function modeBlock(stats: CareerStats, mode: CareerMode | undefined) {
  return mode ? stats.modes[mode] : stats.overall;
}

function metricValue(metric: Metric, context: AchievementContext, pendingCount: number): number {
  const { totals, stats } = context;
  switch (metric.kind) {
    case 'matches':
      return metric.mode ? stats.modes[metric.mode].matches : totals.matches;
    case 'wins':
      return metric.mode ? stats.modes[metric.mode].victories : totals.victories;
    case 'units-destroyed':
      return modeBlock(stats, metric.mode).unitsDestroyed;
    case 'structures-destroyed':
      return modeBlock(stats, metric.mode).structuresDestroyed;
    case 'sites-captured':
      return modeBlock(stats, metric.mode).sitesCaptured;
    case 'superweapons-used':
      return modeBlock(stats, metric.mode).superweaponsUsed;
    case 'objectives-completed':
      return modeBlock(stats, metric.mode).objectivesCompleted;
    case 'nations-played':
      return stats.nations.length;
    case 'nations-won':
      return stats.nations.filter((nation) => nation.victories > 0).length;
    case 'nation-wins':
      return stats.nations.find((nation) => nation.nation === metric.nation)?.victories ?? 0;
    case 'campaigns-completed': {
      const completed = context.completedCampaignIds ?? [];
      return metric.campaignId
        ? completed.filter((campaignId) => campaignId === metric.campaignId).length
        : completed.length;
    }
    case 'career-level':
      return levelForXp(totals.xp).level.number;
    case 'achievements-earned':
      return context.earnedIds.length + pendingCount;
  }
}

function conditionMet(condition: MatchCondition, match: AchievementMatchFacts): boolean {
  if (match.outcome !== 'victory') return false;
  switch (condition.kind) {
    case 'flawless-victory':
      return match.durationSeconds >= condition.minDurationSeconds && match.unitsLost === 0;
    case 'site-dominance':
      return match.sitesCaptured >= condition.minimumSites;
    case 'campaign-flawless':
      return (
        match.mode === 'campaign' &&
        match.durationSeconds >= condition.minDurationSeconds &&
        match.unitsLost === 0
      );
  }
}

function conditionProgress(condition: MatchCondition, match: AchievementMatchFacts): number {
  return conditionMet(condition, match) ? 1 : 0;
}

function qualifies(
  definition: AchievementDefinition,
  context: AchievementContext,
  pendingCount: number,
): boolean {
  const requirement = definition.requirement;
  if (requirement.kind === 'metric') {
    return metricValue(requirement.metric, context, pendingCount) >= requirement.target;
  }
  return context.match ? conditionMet(requirement.condition, context.match) : false;
}

function progressOf(
  definition: AchievementDefinition,
  context: AchievementContext,
  earnedCount: number,
): { progress: number; target: number } {
  const requirement = definition.requirement;
  if (requirement.kind === 'metric') {
    return {
      progress: Math.min(requirement.target, metricValue(requirement.metric, context, earnedCount)),
      target: requirement.target,
    };
  }
  return {
    progress: context.match ? conditionProgress(requirement.condition, context.match) : 0,
    target: 1,
  };
}

/**
 * Return the IDs that should now be awarded. Repeatable achievements are not
 * part of this collection; every award is unique and permanent.
 */
export function pendingAchievementIds(context: AchievementContext): string[] {
  const earned = new Set(context.earnedIds);
  const pending: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of ACHIEVEMENTS) {
      if (earned.has(definition.id)) continue;
      if (!qualifies(definition, context, pending.length)) continue;
      pending.push(definition.id);
      earned.add(definition.id);
      changed = true;
    }
  }
  return pending;
}

/** Every visible achievement, with authoritative progress and award dates. */
export function buildAchievementView(
  context: AchievementContext,
  awardedAt: ReadonlyMap<string, number>,
): AchievementView[] {
  return ACHIEVEMENTS.filter((definition) => !definition.hidden || awardedAt.has(definition.id)).map(
    (definition) => {
      const { progress, target } = progressOf(definition, context, context.earnedIds.length);
      const awarded = awardedAt.get(definition.id) ?? null;
      return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        tier: definition.tier,
        commendation: definition.commendation,
        hidden: definition.hidden === true,
        reward: definition.reward ?? null,
        award: AWARDS.find((award) => award.achievementId === definition.id) ?? null,
        scope: definition.scope ?? 'account',
        mode: definition.mode ?? null,
        nation: definition.nation ?? null,
        campaign: definition.campaign ?? null,
        order: definition.order ?? 100,
        awardedAt: awarded,
        progress: awarded ? target : progress,
        target,
        complete: awarded !== null,
      };
    },
  );
}

export function achievementById(id: string): AchievementDefinition | null {
  return ACHIEVEMENTS.find((entry) => entry.id === id) ?? null;
}

export function awardById(id: string): AwardDefinition | null {
  return AWARDS.find((entry) => entry.id === id) ?? null;
}

export function awardForAchievement(id: string): AwardDefinition | null {
  return AWARDS.find((entry) => entry.achievementId === id) ?? null;
}

export const ACHIEVEMENT_CATEGORY_LABEL: Record<AchievementCategory, string> = {
  operational: 'Operational',
  combat: 'Combat',
  command: 'Command',
  national: 'National Service',
  multiplayer: 'Multiplayer',
  campaign: 'Campaign',
  career: 'Career',
};
