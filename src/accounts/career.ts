/**
 * Career progression vocabulary and rules.
 *
 * One XP model for campaign, skirmish, multiplayer and survival, and one place
 * that decides what a completed match is worth. The account Worker recomputes XP
 * from validated fields with this module, never from a number the client sends,
 * and a guest's local ledger uses the identical function — so linking an
 * account cannot change what an already-played match was worth.
 *
 * The model is deliberately narrow. A decided operation pays by mode, outcome,
 * AI difficulty and mission length; kills and losses are recorded for the
 * service record and earn nothing, because a farmable counter is not a measure
 * of a completed operation. A survival run is the exception its own mode
 * defines: it has no victory and no mission length, so it pays for the waves it
 * held and the infected it killed — both capped, and once per run.
 */
import { rankForXp, type RankSpec } from './ranks';
import { levelForXp, type LevelStanding } from './levels';
import type { AccountErrorCode } from './types';
import {
  OUTBREAK_BOARD_DIFFICULTIES,
  type OutbreakBoardDifficulty as OutbreakDifficulty,
  type OutbreakRunInput,
} from './outbreakBoard';

export type CareerMode = 'campaign' | 'skirmish' | 'multiplayer' | 'outbreak';
export type CareerOutcome = 'victory' | 'defeat' | 'draw';
export type CareerDifficulty = 'recruit' | 'veteran' | 'elite';
/** `local` is a client-produced PvE result; `guest` an imported guest ledger;
 *  `authoritative` is reserved for a result the room service itself owns. */
export type CareerProvenance = 'local' | 'guest' | 'authoritative';

/** The modes a client may submit to `/matches`. A survival run is not one of
 *  them: only the run endpoint knows its waves and kills, and it alone decides
 *  what the run was worth. */
export const CAREER_MODES: readonly CareerMode[] = ['campaign', 'skirmish', 'multiplayer'];
export const CAREER_OUTCOMES: readonly CareerOutcome[] = ['victory', 'defeat', 'draw'];
export const CAREER_DIFFICULTIES: readonly CareerDifficulty[] = ['recruit', 'veteran', 'elite'];

/**
 * A difficulty a stored ledger row may carry. The match parser only accepts the
 * three AI difficulties; a survival row keeps the mode's own scale, because a
 * Nightmare run that paid like a Veteran one would be a false record.
 */
export type CareerRecordDifficulty = CareerDifficulty | OutbreakDifficulty;

export const CAREER_RECORD_DIFFICULTIES: readonly CareerRecordDifficulty[] = Object.freeze([
  ...CAREER_DIFFICULTIES,
  ...OUTBREAK_BOARD_DIFFICULTIES,
]);

export function isCareerDifficulty(value: unknown): value is CareerDifficulty {
  return CAREER_DIFFICULTIES.includes(value as CareerDifficulty);
}

export function isCareerRecordDifficulty(value: unknown): value is CareerRecordDifficulty {
  return CAREER_RECORD_DIFFICULTIES.includes(value as CareerRecordDifficulty);
}

/** Eight hours is longer than any real operation; beyond it a submitted
 *  duration is not credible and is rejected rather than trimmed. */
export const MAX_MATCH_SECONDS = 8 * 60 * 60;
export const MAX_MATCH_KILLS = 5_000;
/**
 * The most XP-paying rows one account may add in a day, per mode.
 *
 * Survival pays per run and the run is client-reported, so this is the ceiling
 * that stops varied or forged posts from farming rank: together with the run
 * endpoint's thirty submissions an hour, a day-long farm becomes two hours of
 * it. It is generous for play — sixty runs is several hours at any wave worth
 * posting — so it only ever binds on a script. A run over the cap is still
 * recorded, it simply pays nothing.
 */
export const MAX_CAREER_MATCHES_PER_DAY = 60;

/** The UTC midnight at or before `now`. Daily limits share one boundary. */
export function startOfUtcDay(now: number): number {
  return Math.floor(now / 86_400_000) * 86_400_000;
}
export const MAX_GUEST_IMPORT_MATCHES = 200;

const BASE_XP: Record<Exclude<CareerMode, 'outbreak'>, number> = {
  campaign: 150,
  skirmish: 100,
  multiplayer: 120,
};
const OUTCOME_FACTOR: Record<CareerOutcome, number> = { victory: 1, draw: 0.5, defeat: 0.3 };
const DIFFICULTY_FACTOR: Record<CareerDifficulty, number> = { recruit: 0.8, veteran: 1, elite: 1.25 };
const MAX_DURATION_BONUS = 60;

export interface CareerAccomplishments {
  objectivesCompleted?: number;
  sitesCaptured?: number;
  superweaponsUsed?: number;
  structuresDestroyed?: number;
  structuresBuilt?: number;
}

/**
 * A small, capped award for what was actually accomplished in a completed
 * operation. It is deliberately smaller than the base award and cannot be
 * farmed by repeating one event: the caps apply to the match, and the ledger
 * still pays only once per stable reference.
 */
export function careerAccomplishmentXp(stats: CareerAccomplishments): number {
  const objectives = Math.min(30, Math.max(0, Math.floor(stats.objectivesCompleted ?? 0)) * 5);
  const sites = Math.min(15, Math.max(0, Math.floor(stats.sitesCaptured ?? 0)) * 3);
  const superweapons = Math.min(15, Math.max(0, Math.floor(stats.superweaponsUsed ?? 0)) * 5);
  const structures = Math.min(
    20,
    Math.floor(Math.max(0, Math.floor(stats.structuresDestroyed ?? 0)) / 5),
  );
  return objectives + sites + superweapons + structures;
}

export interface CareerMatchInput {
  /** Client-stable idempotency key, unique per account. */
  ref: string;
  mode: CareerMode;
  outcome: CareerOutcome;
  difficulty: CareerDifficulty;
  durationSeconds: number;
  nation?: string | null;
  kills?: number;
  unitsLost?: number;
}

export interface CareerMatchRecord {
  ref: string;
  mode: CareerMode;
  outcome: CareerOutcome;
  difficulty: CareerRecordDifficulty;
  durationSeconds: number;
  nation: string | null;
  kills: number;
  unitsLost: number;
  xp: number;
  provenance: CareerProvenance;
  recordedAt: number;
  /** What the operation accomplished. Held by the guest ledger only; the
   *  account service keeps the same facts in its match report. */
  accomplishments?: CareerAccomplishments;
}

export interface CareerTotals {
  xp: number;
  matches: number;
  victories: number;
  defeats: number;
  draws: number;
  /** Survival runs. They are recorded as defeats but are not decided matches. */
  outbreakMatches: number;
  kills: number;
  unitsLost: number;
  playSeconds: number;
}

export const EMPTY_CAREER: CareerTotals = Object.freeze({
  xp: 0,
  matches: 0,
  victories: 0,
  defeats: 0,
  draws: 0,
  outbreakMatches: 0,
  kills: 0,
  unitsLost: 0,
  playSeconds: 0,
});

/**
 * XP for one completed match.
 *
 * Base by mode, plus one per full minute of play (capped), scaled by outcome and
 * the AI difficulty the player actually chose. A defeat still pays: the record
 * of an attempted operation is part of a career, and refusing all progress
 * would make a hard mission a dead end.
 */
export function careerXp(input: Pick<CareerMatchInput, 'mode' | 'outcome' | 'difficulty' | 'durationSeconds'>): number {
  // A survival run is paid from the run itself by `outbreakCareerXp`; its length
  // alone says nothing, because an idle run and a hard one last the same time.
  if (input.mode === 'outbreak') return 0;
  const base = BASE_XP[input.mode] ?? BASE_XP.skirmish;
  const seconds = Number.isFinite(input.durationSeconds) ? Math.max(0, input.durationSeconds) : 0;
  const durationBonus = Math.min(MAX_DURATION_BONUS, Math.floor(seconds / 60));
  const outcome = OUTCOME_FACTOR[input.outcome] ?? OUTCOME_FACTOR.defeat;
  const difficulty = DIFFICULTY_FACTOR[input.difficulty] ?? 1;
  return Math.max(0, Math.round((base + durationBonus) * outcome * difficulty));
}

/**
 * What one finished survival run is worth.
 *
 * Waves are the mode's own measure of a run, so they carry the bulk of the
 * award; infected are the second term, at one point per five killed. Both are
 * capped, so padding an easy wave cannot approach a deep Nightmare run, and the
 * mode's difficulty scales the whole thing. The numbers are the same order as a
 * decided match — a ten-wave Normal run pays about one campaign victory — so
 * survival advances a career without out-earning the operations it sits beside.
 *
 * A run is client-reported, which is why the caps are here and the ledger pays a
 * given run only once (see `outbreakCareerRef`).
 */
export const OUTBREAK_WAVE_XP = 10;
export const OUTBREAK_PAID_WAVES = 30;
export const OUTBREAK_KILLS_PER_XP = 5;
export const OUTBREAK_PAID_KILLS = 250;
const OUTBREAK_DIFFICULTY_FACTOR: Record<OutbreakDifficulty, number> = {
  easy: 0.75,
  normal: 1,
  hard: 1.25,
  nightmare: 1.5,
};

export function outbreakCareerXp(
  run: Pick<OutbreakRunInput, 'wavesCompleted' | 'zombiesKilled' | 'difficulty'>,
): number {
  const waves = Math.min(OUTBREAK_PAID_WAVES, Math.max(0, Math.floor(run.wavesCompleted)));
  const kills = Math.min(OUTBREAK_PAID_KILLS, Math.max(0, Math.floor(run.zombiesKilled)));
  const factor = OUTBREAK_DIFFICULTY_FACTOR[run.difficulty] ?? 1;
  return Math.max(
    0,
    Math.round((waves * OUTBREAK_WAVE_XP + Math.floor(kills / OUTBREAK_KILLS_PER_XP)) * factor),
  );
}

/**
 * The ledger key for one run: the board it was fought on and what it achieved.
 *
 * It is derived, not supplied, so a retried post and an identical replay are the
 * same row — the ledger's uniqueness does the rest, and a run pays once. A
 * better result is a different key, which is what lets an improved run pay for
 * the improvement without paying again for the old one.
 */
export function outbreakCareerRef(
  run: Pick<
    OutbreakRunInput,
    'map' | 'mode' | 'difficulty' | 'wave' | 'wavesCompleted' | 'zombiesKilled'
  >,
): string {
  return `outbreak:${run.map}:${run.mode}:${run.difficulty}:${run.wave}:${run.wavesCompleted}:${run.zombiesKilled}`;
}

/** One validated run as a career ledger row. */
export function outbreakCareerRecord(
  run: OutbreakRunInput,
  options: { now: number },
): CareerMatchRecord {
  return {
    ref: outbreakCareerRef(run),
    mode: 'outbreak',
    // A run ends when the Command Post falls, so the ledger calls it a defeat.
    outcome: 'defeat',
    difficulty: run.difficulty,
    durationSeconds: run.durationSeconds,
    nation: run.nations[0] ?? null,
    kills: run.zombiesKilled,
    unitsLost: run.unitsLost,
    xp: outbreakCareerXp(run),
    // The run is reported by the client that simulated it, like a local match.
    provenance: 'local',
    recordedAt: options.now,
  };
}

const REF_PATTERN = /^[A-Za-z0-9:_-]{8,96}$/;
const NATION_PATTERN = /^[a-z0-9-]{1,32}$/;

function integerInRange(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 0 || value > max) return null;
  return value;
}

export type CareerParseResult =
  | { ok: true; value: CareerMatchInput }
  | { ok: false; message: string; code: AccountErrorCode };

/**
 * Validate one submitted match. Every bound is explicit, so a crafted body can
 * neither inflate a career nor poison its history with free-form text.
 */
export function parseCareerMatch(raw: unknown): CareerParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'A match must be an object.', code: 'invalid-request' };
  }
  const record = raw as Record<string, unknown>;
  const ref = typeof record.ref === 'string' ? record.ref.trim() : '';
  if (!REF_PATTERN.test(ref)) {
    return { ok: false, message: 'Match reference is not valid.', code: 'invalid-request' };
  }
  // A survival run never comes through this parser: only the run endpoint knows
  // its waves and kills, and it alone decides what the run was worth.
  const mode = record.mode as CareerMode;
  if (!CAREER_MODES.includes(mode)) {
    return { ok: false, message: 'Match mode is not recognised.', code: 'invalid-request' };
  }
  const outcome = record.outcome as CareerOutcome;
  if (!CAREER_OUTCOMES.includes(outcome)) {
    return { ok: false, message: 'Match outcome is not recognised.', code: 'invalid-request' };
  }
  const difficulty = record.difficulty as CareerDifficulty;
  if (!CAREER_DIFFICULTIES.includes(difficulty)) {
    return { ok: false, message: 'AI difficulty is not recognised.', code: 'invalid-request' };
  }
  const durationSeconds = integerInRange(record.durationSeconds, MAX_MATCH_SECONDS);
  if (durationSeconds === null) {
    return { ok: false, message: 'Match duration is not valid.', code: 'invalid-request' };
  }
  const kills = record.kills === undefined ? 0 : integerInRange(record.kills, MAX_MATCH_KILLS);
  if (kills === null) {
    return { ok: false, message: 'Kill count is not valid.', code: 'invalid-request' };
  }
  const unitsLost = record.unitsLost === undefined ? 0 : integerInRange(record.unitsLost, MAX_MATCH_KILLS);
  if (unitsLost === null) {
    return { ok: false, message: 'Loss count is not valid.', code: 'invalid-request' };
  }
  let nation: string | null = null;
  if (record.nation !== undefined && record.nation !== null) {
    if (typeof record.nation !== 'string' || !NATION_PATTERN.test(record.nation)) {
      return { ok: false, message: 'Nation identifier is not valid.', code: 'invalid-request' };
    }
    nation = record.nation;
  }
  return {
    ok: true,
    value: { ref, mode, outcome, difficulty, durationSeconds, nation, kills, unitsLost },
  };
}

/** Fold a ledger into the totals the career view shows. Order is irrelevant. */
export function summariseCareer(records: readonly CareerMatchRecord[]): CareerTotals {
  const totals: CareerTotals = { ...EMPTY_CAREER };
  for (const record of records) {
    totals.xp += record.xp;
    totals.matches += 1;
    if (record.outcome === 'victory') totals.victories += 1;
    else if (record.outcome === 'defeat') totals.defeats += 1;
    else totals.draws += 1;
    if (record.mode === 'outbreak') totals.outbreakMatches += 1;
    totals.kills += record.kills;
    totals.unitsLost += record.unitsLost;
    totals.playSeconds += record.durationSeconds;
  }
  return totals;
}

/**
 * Win rate over decided operations.
 *
 * A survival run is recorded as a defeat — the Command Post fell — but it is not
 * a decided match, so it is excluded from the denominator. Playing Outbreak
 * therefore neither raises nor lowers the rate, while the run still counts as an
 * operation played and stays on the record. Null when nothing decided has been
 * played, so the UI can show a blank rather than a misleading 0%.
 */
export function careerWinRate(
  totals: Pick<CareerTotals, 'matches' | 'victories' | 'outbreakMatches'>,
): number | null {
  const decided = Math.max(0, totals.matches - totals.outbreakMatches);
  return decided > 0 ? totals.victories / decided : null;
}

/** The career payload both the Worker and the browser render from. */
export interface CareerViewData {
  totals: CareerTotals;
  rank: RankSpec;
  level: LevelStanding;
  next: { id: string; name: string; grade: string; xpRequired: number } | null;
  xpInto: number;
  xpSpan: number | null;
  progress: number;
  matches: CareerMatchRecord[];
}

export function careerViewFrom(totals: CareerTotals, matches: CareerMatchRecord[]): CareerViewData {
  const { rank, next, xpInto, xpSpan, progress } = rankForXp(totals.xp);
  return {
    totals,
    rank,
    level: levelForXp(totals.xp),
    next: next ? { id: next.id, name: next.name, grade: next.grade, xpRequired: next.threshold } : null,
    xpInto,
    xpSpan,
    progress,
    matches,
  };
}

/** A record built from a validated input; `now` keeps callers deterministic. */
export function careerRecord(
  input: CareerMatchInput,
  options: { provenance: CareerProvenance; now: number },
): CareerMatchRecord {
  return {
    ref: input.ref,
    mode: input.mode,
    outcome: input.outcome,
    difficulty: input.difficulty,
    durationSeconds: input.durationSeconds,
    nation: input.nation ?? null,
    kills: input.kills ?? 0,
    unitsLost: input.unitsLost ?? 0,
    xp: careerXp(input),
    provenance: options.provenance,
    recordedAt: options.now,
  };
}

export function isCareerMode(value: unknown): value is CareerMode {
  return CAREER_MODES.includes(value as CareerMode);
}
