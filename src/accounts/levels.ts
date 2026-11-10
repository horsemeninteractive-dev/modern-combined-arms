/**
 * Career service levels.
 *
 * The formal rank ladder (`ranks.ts`) is deliberately short: sixteen ranks,
 * which is already more than most services promote through in a career. The
 * long-term progression target is fifty steps, so this module adds the missing
 * granularity as *service levels* between and inside those ranks. A level is
 * not a new rank and never invents a new badge; the formal rank remains the
 * authoritative title, and the level is the finer measure of time served.
 *
 * Thresholds are monotonic and deterministic. Level 50 is the top of the
 * service ladder; the final formal rank (General) is reached before it, so the
 * last levels represent seniority within the general officer rank rather than
 * another promotion. No real-world service's insignia is claimed.
 */
export const CAREER_LEVEL_COUNT = 50;

export interface CareerLevel {
  /** 1-based level number. */
  number: number;
  /** Career XP at which this level begins. */
  threshold: number;
}

/**
 * 25(n-1)^2 + 100(n-1). It reaches level 50 at 64,925 XP, comfortably above
 * General's 58,000 XP threshold, and grows quickly enough that the last levels
 * remain meaningful without requiring millions of matches.
 */
function thresholdFor(number: number): number {
  const step = Math.max(0, number - 1);
  return 25 * step * step + 100 * step;
}

export const CAREER_LEVELS: readonly CareerLevel[] = Object.freeze(
  Array.from({ length: CAREER_LEVEL_COUNT }, (_, index) => ({
    number: index + 1,
    threshold: thresholdFor(index + 1),
  })),
);

export interface LevelStanding {
  level: CareerLevel;
  /** XP earned inside the current level. */
  xpInto: number;
  /** XP the current level spans; null at level 50. */
  xpSpan: number | null;
  next: CareerLevel | null;
  /** 0..1 through the current level; 1 at level 50. */
  progress: number;
}

/** Resolve any finite XP total, clamping corrupt input rather than throwing. */
export function levelForXp(xp: number): LevelStanding {
  const total = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  let index = 0;
  for (let i = 0; i < CAREER_LEVELS.length; i++) {
    if (total >= CAREER_LEVELS[i].threshold) index = i;
    else break;
  }
  const level = CAREER_LEVELS[index];
  const next = CAREER_LEVELS[index + 1] ?? null;
  const xpInto = total - level.threshold;
  const xpSpan = next ? next.threshold - level.threshold : null;
  const progress = next && xpSpan && xpSpan > 0 ? Math.min(1, xpInto / xpSpan) : 1;
  return { level, xpInto, xpSpan, next, progress };
}
