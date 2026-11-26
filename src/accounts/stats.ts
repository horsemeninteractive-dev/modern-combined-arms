/**
 * Service-record aggregation.
 *
 * One grouping shape, `StatGroupRow`, is produced by the store and turned into
 * the payload the UI renders. D1 groups in SQL and the in-memory store groups in
 * JavaScript, but both feed the same builder, so the two can only disagree about
 * *how rows are grouped*, never about how a row becomes a statistic.
 *
 * Nothing here invents history: a mode or nation with no matches is simply
 * absent, and the UI shows an empty state instead of a zero that looks played.
 */
import type { CareerMode } from './career';

export interface StatGroupRow {
  mode: CareerMode;
  nation: string | null;
  matches: number;
  victories: number;
  defeats: number;
  draws: number;
  playSeconds: number;
  xp: number;
  unitsDestroyed: number;
  unitsLost: number;
  structuresDestroyed: number;
  structuresLost: number;
  structuresBuilt: number;
  sitesCaptured: number;
  superweaponsUsed: number;
  objectivesCompleted: number;
}

export interface StatBlock {
  matches: number;
  victories: number;
  defeats: number;
  draws: number;
  /** Survival runs: defeats on the record, excluded from the win rate. */
  outbreakMatches: number;
  /** 0..1, or null when nothing has been played. */
  winRate: number | null;
  playSeconds: number;
  xp: number;
  unitsDestroyed: number;
  unitsLost: number;
  structuresDestroyed: number;
  structuresLost: number;
  structuresBuilt: number;
  sitesCaptured: number;
  superweaponsUsed: number;
  objectivesCompleted: number;
}

export interface NationLine extends StatBlock {
  nation: string;
}

export interface CareerStats {
  overall: StatBlock;
  modes: Record<CareerMode, StatBlock>;
  nations: NationLine[];
}

export function emptyStatBlock(): StatBlock {
  return {
    matches: 0,
    victories: 0,
    defeats: 0,
    draws: 0,
    outbreakMatches: 0,
    winRate: null,
    playSeconds: 0,
    xp: 0,
    unitsDestroyed: 0,
    unitsLost: 0,
    structuresDestroyed: 0,
    structuresLost: 0,
    structuresBuilt: 0,
    sitesCaptured: 0,
    superweaponsUsed: 0,
    objectivesCompleted: 0,
  };
}

function add(into: StatBlock, row: StatGroupRow): void {
  into.matches += row.matches;
  into.victories += row.victories;
  into.defeats += row.defeats;
  into.draws += row.draws;
  if (row.mode === 'outbreak') into.outbreakMatches += row.matches;
  into.playSeconds += row.playSeconds;
  into.xp += row.xp;
  into.unitsDestroyed += row.unitsDestroyed;
  into.unitsLost += row.unitsLost;
  into.structuresDestroyed += row.structuresDestroyed;
  into.structuresLost += row.structuresLost;
  into.structuresBuilt += row.structuresBuilt;
  into.sitesCaptured += row.sitesCaptured;
  into.superweaponsUsed += row.superweaponsUsed;
  into.objectivesCompleted += row.objectivesCompleted;
}

function finalise(block: StatBlock): StatBlock {
  // A draw is neither a win nor a loss, so the rate is wins over decided
  // matches and draws are reported separately; an undecided record is null
  // rather than a misleading 0. A survival run is stored as a defeat but is not
  // a decided match, so it is excluded from the denominator as well.
  const decided = Math.max(0, block.victories + block.defeats - block.outbreakMatches);
  block.winRate = decided > 0 ? block.victories / decided : null;
  return block;
}

export function buildCareerStats(rows: readonly StatGroupRow[]): CareerStats {
  const overall = emptyStatBlock();
  const modes: Record<CareerMode, StatBlock> = {
    campaign: emptyStatBlock(),
    skirmish: emptyStatBlock(),
    multiplayer: emptyStatBlock(),
    outbreak: emptyStatBlock(),
  };
  const nations = new Map<string, StatBlock>();
  for (const row of rows) {
    add(overall, row);
    add(modes[row.mode] ?? modes.skirmish, row);
    if (row.nation) {
      const line = nations.get(row.nation) ?? emptyStatBlock();
      add(line, row);
      nations.set(row.nation, line);
    }
  }
  return {
    overall: finalise(overall),
    modes: {
      campaign: finalise(modes.campaign),
      skirmish: finalise(modes.skirmish),
      multiplayer: finalise(modes.multiplayer),
      outbreak: finalise(modes.outbreak),
    },
    nations: [...nations.entries()]
      .map(([nation, block]) => ({ nation, ...finalise(block) }))
      .sort((left, right) => right.matches - left.matches || left.nation.localeCompare(right.nation)),
  };
}

/** `1h 24m` / `6m` / `—`. Compact enough for a table cell. */
export function formatPlaytime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

export function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
