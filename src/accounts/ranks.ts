/**
 * The universal rank ladder.
 *
 * One ladder for the whole game, independent of nation and faction: a rank is a
 * career milestone, not a national appointment, so an Eastern colonel and a
 * Defender colonel sit at the same rung. The names and grades follow the common
 * NATO pattern, and the insignia describe the shapes an authentic rank badge
 * uses (chevrons, rockers, bars, stars, wreath) without claiming to belong to
 * any one army.
 *
 * Pure data and pure functions: imported by the account Worker, the browser and
 * the tests, so the rank a player is shown is always the rank the server
 * computed.
 */

export type RankTier = 'enlisted' | 'nco' | 'company' | 'field' | 'general';

/** What the badge is drawn from. Counts are shapes, not pixels. */
export interface RankInsigniaSpec {
  chevrons?: number;
  rockers?: number;
  bars?: number;
  stars?: number;
  wreath?: boolean;
}

export interface RankSpec {
  id: string;
  /** Full title, e.g. `Sergeant First Class`. */
  name: string;
  /** Short form for tight UI, e.g. `SFC`. */
  abbreviation: string;
  /** NATO-style grade, shown as the authoritative label. */
  grade: string;
  tier: RankTier;
  /** Career XP at which this rank begins. Strictly increasing. */
  threshold: number;
  insignia: RankInsigniaSpec;
}

export const RANKS: readonly RankSpec[] = Object.freeze([
  {
    id: 'private',
    name: 'Private',
    abbreviation: 'PVT',
    grade: 'OR-1',
    tier: 'enlisted',
    threshold: 0,
    insignia: { chevrons: 1 },
  },
  {
    id: 'corporal',
    name: 'Corporal',
    abbreviation: 'CPL',
    grade: 'OR-4',
    tier: 'nco',
    threshold: 400,
    insignia: { chevrons: 2 },
  },
  {
    id: 'sergeant',
    name: 'Sergeant',
    abbreviation: 'SGT',
    grade: 'OR-5',
    tier: 'nco',
    threshold: 1_100,
    insignia: { chevrons: 3 },
  },
  {
    id: 'staff-sergeant',
    name: 'Staff Sergeant',
    abbreviation: 'SSG',
    grade: 'OR-6',
    tier: 'nco',
    threshold: 2_300,
    insignia: { chevrons: 3, rockers: 1 },
  },
  {
    id: 'sergeant-first-class',
    name: 'Sergeant First Class',
    abbreviation: 'SFC',
    grade: 'OR-7',
    tier: 'nco',
    threshold: 3_900,
    insignia: { chevrons: 3, rockers: 2 },
  },
  {
    id: 'master-sergeant',
    name: 'Master Sergeant',
    abbreviation: 'MSG',
    grade: 'OR-8',
    tier: 'nco',
    threshold: 6_000,
    insignia: { chevrons: 3, rockers: 3 },
  },
  {
    id: 'sergeant-major',
    name: 'Sergeant Major',
    abbreviation: 'SGM',
    grade: 'OR-9',
    tier: 'nco',
    threshold: 8_600,
    insignia: { chevrons: 3, rockers: 3, stars: 1 },
  },
  {
    id: 'second-lieutenant',
    name: 'Second Lieutenant',
    abbreviation: '2LT',
    grade: 'OF-1',
    tier: 'company',
    threshold: 11_800,
    insignia: { bars: 1 },
  },
  {
    id: 'first-lieutenant',
    name: 'First Lieutenant',
    abbreviation: '1LT',
    grade: 'OF-1',
    tier: 'company',
    threshold: 15_600,
    insignia: { bars: 2 },
  },
  {
    id: 'captain',
    name: 'Captain',
    abbreviation: 'CPT',
    grade: 'OF-2',
    tier: 'company',
    threshold: 20_000,
    insignia: { bars: 3 },
  },
  {
    id: 'major',
    name: 'Major',
    abbreviation: 'MAJ',
    grade: 'OF-3',
    tier: 'field',
    threshold: 25_000,
    insignia: { stars: 1 },
  },
  {
    id: 'lieutenant-colonel',
    name: 'Lieutenant Colonel',
    abbreviation: 'LTC',
    grade: 'OF-4',
    tier: 'field',
    threshold: 30_500,
    insignia: { stars: 2 },
  },
  {
    id: 'colonel',
    name: 'Colonel',
    abbreviation: 'COL',
    grade: 'OF-5',
    tier: 'field',
    threshold: 36_500,
    insignia: { stars: 3 },
  },
  {
    id: 'brigadier',
    name: 'Brigadier',
    abbreviation: 'BRIG',
    grade: 'OF-6',
    tier: 'general',
    threshold: 43_000,
    insignia: { stars: 1, wreath: true },
  },
  {
    id: 'major-general',
    name: 'Major General',
    abbreviation: 'MG',
    grade: 'OF-7',
    tier: 'general',
    threshold: 50_000,
    insignia: { stars: 2, wreath: true },
  },
  {
    id: 'general',
    name: 'General',
    abbreviation: 'GEN',
    grade: 'OF-9',
    tier: 'general',
    threshold: 58_000,
    insignia: { stars: 3, wreath: true },
  },
]);

export interface RankStanding {
  rank: RankSpec;
  index: number;
  /** XP earned inside the current rank. */
  xpInto: number;
  /** XP the current rank spans; null at the top of the ladder. */
  xpSpan: number | null;
  next: RankSpec | null;
  /** 0..1 through the current rank; 1 at the top of the ladder. */
  progress: number;
}

/**
 * Resolve a career XP total to a rank. Any finite XP total resolves: negative
 * or non-finite input is clamped to 0 rather than throwing, so a corrupt local
 * ledger cannot break the menu.
 */
export function rankForXp(xp: number): RankStanding {
  const total = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (total >= RANKS[i].threshold) index = i;
    else break;
  }
  const rank = RANKS[index];
  const next = RANKS[index + 1] ?? null;
  const xpInto = total - rank.threshold;
  const xpSpan = next ? next.threshold - rank.threshold : null;
  const progress = next && xpSpan && xpSpan > 0 ? Math.min(1, xpInto / xpSpan) : 1;
  return { rank, index, xpInto, xpSpan, next, progress };
}

/** Total career XP needed for the next rank, or null at the top. */
export function nextRankAt(xp: number): number | null {
  return rankForXp(xp).next?.threshold ?? null;
}
