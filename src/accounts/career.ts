/**
 * Career progression vocabulary and rules.
 *
 * One XP model for campaign, skirmish and multiplayer, and one place that
 * decides what a completed match is worth. The account Worker recomputes XP
 * from validated fields with this module, never from a number the client sends,
 * and a guest's local ledger uses the identical function — so linking an
 * account cannot change what an already-played match was worth.
 *
 * The model is deliberately narrow: mode, outcome, AI difficulty and mission
 * length. Kills and losses are recorded for the service record but earn nothing,
 * because a farmable counter is not a measure of a completed operation.
 */
import { rankForXp, type RankSpec } from './ranks';
import type { AccountErrorCode } from './types';

export type CareerMode = 'campaign' | 'skirmish' | 'multiplayer';
export type CareerOutcome = 'victory' | 'defeat' | 'draw';
export type CareerDifficulty = 'recruit' | 'veteran' | 'elite';
/** `local` is a client-produced PvE result; `guest` an imported guest ledger;
 *  `authoritative` is reserved for a result the room service itself owns. */
export type CareerProvenance = 'local' | 'guest' | 'authoritative';

export const CAREER_MODES: readonly CareerMode[] = ['campaign', 'skirmish', 'multiplayer'];
export const CAREER_OUTCOMES: readonly CareerOutcome[] = ['victory', 'defeat', 'draw'];
export const CAREER_DIFFICULTIES: readonly CareerDifficulty[] = ['recruit', 'veteran', 'elite'];

/** Eight hours is longer than any real operation; beyond it a submitted
 *  duration is not credible and is rejected rather than trimmed. */
export const MAX_MATCH_SECONDS = 8 * 60 * 60;
export const MAX_MATCH_KILLS = 5_000;
export const MAX_CAREER_MATCHES_PER_DAY = 60;
export const MAX_GUEST_IMPORT_MATCHES = 200;

const BASE_XP: Record<CareerMode, number> = { campaign: 150, skirmish: 100, multiplayer: 120 };
const OUTCOME_FACTOR: Record<CareerOutcome, number> = { victory: 1, draw: 0.5, defeat: 0.3 };
const DIFFICULTY_FACTOR: Record<CareerDifficulty, number> = { recruit: 0.8, veteran: 1, elite: 1.25 };
const MAX_DURATION_BONUS = 60;

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
  difficulty: CareerDifficulty;
  durationSeconds: number;
  nation: string | null;
  kills: number;
  unitsLost: number;
  xp: number;
  provenance: CareerProvenance;
  recordedAt: number;
}

export interface CareerTotals {
  xp: number;
  matches: number;
  victories: number;
  defeats: number;
  draws: number;
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
  const base = BASE_XP[input.mode] ?? BASE_XP.skirmish;
  const seconds = Number.isFinite(input.durationSeconds) ? Math.max(0, input.durationSeconds) : 0;
  const durationBonus = Math.min(MAX_DURATION_BONUS, Math.floor(seconds / 60));
  const outcome = OUTCOME_FACTOR[input.outcome] ?? OUTCOME_FACTOR.defeat;
  const difficulty = DIFFICULTY_FACTOR[input.difficulty] ?? 1;
  return Math.max(0, Math.round((base + durationBonus) * outcome * difficulty));
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
    totals.kills += record.kills;
    totals.unitsLost += record.unitsLost;
    totals.playSeconds += record.durationSeconds;
  }
  return totals;
}

/** The career payload both the Worker and the browser render from. */
export interface CareerViewData {
  totals: CareerTotals;
  rank: RankSpec;
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
