/**
 * Outbreak leaderboards: vocabulary, validation and ordering.
 *
 * Shared by the account Worker and the browser client. The router validates a
 * submitted run with the same parser the client uses to build it, and both sides
 * sort with one comparator, so what the deck draws is exactly the order the
 * service stores and returns.
 *
 * A run is reported by the client that simulated it, so these checks are a
 * plausibility envelope rather than proof: they bound every figure to what the
 * mode can physically produce and keep a malformed or scripted submission out
 * of the table. Identity, the clock and the best-run rule stay the service's.
 */
import type { OutbreakDifficulty } from '../sim/scenario';

/**
 * One board per authored map. Ground is a competition, not a filter: a run on
 * the city compound never ranks against one in the basin, because the two ask
 * different things of the player.
 *
 * The ids are listed here rather than imported from the scenario catalogue so
 * the account Worker does not pull the whole simulation data graph into its
 * bundle. `tests/outbreak-maps.test.ts` asserts this list matches the maps the
 * game actually ships, so a new theatre cannot ship without its boards.
 */
export const OUTBREAK_BOARD_MAPS: readonly string[] = Object.freeze([
  'outbreak-relay-basin',
  'outbreak-civic-square',
  'outbreak-tidewall-quay',
  'outbreak-frostline-junction',
]);

/** The basin: every board recorded before maps existed lives here. */
export const DEFAULT_OUTBREAK_BOARD_MAP = 'outbreak-relay-basin';

export function isOutbreakBoardMap(value: unknown): value is string {
  return typeof value === 'string' && OUTBREAK_BOARD_MAPS.includes(value);
}

/** The two boards. Solo and duo are separate competitions, never merged. */
export type OutbreakBoardMode = 'solo' | 'coop';

export const OUTBREAK_BOARD_MODES: readonly OutbreakBoardMode[] = Object.freeze(['solo', 'coop']);

/** A board difficulty is the mode's own difficulty, not a second vocabulary. */
export type OutbreakBoardDifficulty = OutbreakDifficulty;

export const OUTBREAK_BOARD_DIFFICULTIES: readonly OutbreakDifficulty[] = Object.freeze([
  'easy',
  'normal',
  'hard',
  'nightmare',
]);

/** Rows a board returns (and the per-mode/ difficulty page the deck reads). */
export const OUTBREAK_BOARD_LIMIT = 20;
export const MAX_OUTBREAK_BOARD_LIMIT = 50;

/** Highest wave a run may claim. The director's own numbers stay far below it. */
const MAX_WAVE = 999;
const MAX_KILLS = 1_000_000;
const MAX_RUN_SECONDS = 7 * 24 * 60 * 60;
const MAX_LOSSES = 100_000;
/** Every wave costs at least this long in preparation, on every difficulty. */
const MIN_SECONDS_PER_WAVE = 8;
/** The largest wave plans top out under 500 bodies; this leaves ample headroom. */
const MAX_KILLS_PER_WAVE = 600;

export function isOutbreakBoardMode(value: unknown): value is OutbreakBoardMode {
  return value === 'solo' || value === 'coop';
}

export function isOutbreakBoardDifficulty(value: unknown): value is OutbreakDifficulty {
  return (
    value === 'easy' || value === 'normal' || value === 'hard' || value === 'nightmare'
  );
}

/** One finished run as a client reports it. */
export interface OutbreakRunInput {
  mode: OutbreakBoardMode;
  /** The map the run was fought on; its own board. */
  map: string;
  difficulty: OutbreakDifficulty;
  /** Wave the Command Post fell on. */
  wave: number;
  wavesCompleted: number;
  zombiesKilled: number;
  durationSeconds: number;
  structuresLost: number;
  unitsLost: number;
  nations: string[];
}

/** One stored best run: the input plus the identity and clock the service owns. */
export interface OutbreakRunRecord extends OutbreakRunInput {
  accountId: string;
  callsign: string;
  players: number;
  recordedAt: number;
}

/** One row on a board, as the deck renders it. Never carries an account id. */
export interface OutbreakBoardEntry {
  rank: number;
  callsign: string;
  mode: OutbreakBoardMode;
  map: string;
  difficulty: OutbreakDifficulty;
  wave: number;
  wavesCompleted: number;
  zombiesKilled: number;
  durationSeconds: number;
  players: number;
  nations: string[];
  recordedAt: number;
  /** True for the reader's own row, so the table can mark it. */
  you: boolean;
}

export interface OutbreakBoard {
  mode: OutbreakBoardMode;
  map: string;
  difficulty: OutbreakDifficulty;
  entries: OutbreakBoardEntry[];
  /** The reader's own best run, even when it sits outside the top rows. */
  own: OutbreakBoardEntry | null;
  /** A guest can read a board but not post to it. */
  signedIn: boolean;
}

export type OutbreakRunParse =
  | { ok: true; value: OutbreakRunInput }
  | { ok: false; message: string };

function integer(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) return null;
  return value;
}

function nationList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) return null;
  const nations: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(entry)) return null;
    if (!nations.includes(entry)) nations.push(entry);
  }
  return nations;
}

/**
 * Validate one submitted run.
 *
 * The envelope is deliberately generous at the top — a long survival run is the
 * point of the mode — and strict where a value would be self-contradictory: a
 * run cannot hold more waves than it reached, cannot fall on a wave before it
 * finished one, cannot survive for less time than its waves need to spawn, and
 * cannot kill more bodies than the wave plans ever put on the field.
 */
export function parseOutbreakRun(body: Record<string, unknown>): OutbreakRunParse {
  if (!isOutbreakBoardMode(body.mode)) return { ok: false, message: 'That board is not one of ours.' };
  // A run that names no map is a run from before the maps shipped, and it was
  // fought in the basin: that is the only honest reading of an absent field.
  const map = body.map === undefined ? DEFAULT_OUTBREAK_BOARD_MAP : body.map;
  if (!isOutbreakBoardMap(map)) return { ok: false, message: 'That battlefield is not one of ours.' };
  if (!isOutbreakBoardDifficulty(body.difficulty)) {
    return { ok: false, message: 'That difficulty is not one of ours.' };
  }
  const wave = integer(body.wave, MAX_WAVE);
  const wavesCompleted = integer(body.wavesCompleted, MAX_WAVE);
  const zombiesKilled = integer(body.zombiesKilled, MAX_KILLS);
  const durationSeconds = integer(body.durationSeconds, MAX_RUN_SECONDS);
  const structuresLost = integer(body.structuresLost, MAX_LOSSES);
  const unitsLost = integer(body.unitsLost, MAX_LOSSES);
  const nations = nationList(body.nations, 2);
  if (wave === null || wave < 1) return { ok: false, message: 'A run has to reach a wave.' };
  if (wavesCompleted === null) return { ok: false, message: 'The run record is incomplete.' };
  if (wavesCompleted > wave || wave > wavesCompleted + 1) {
    return { ok: false, message: 'Those wave figures contradict each other.' };
  }
  if (zombiesKilled === null || durationSeconds === null) {
    return { ok: false, message: 'The run record is incomplete.' };
  }
  if (structuresLost === null || unitsLost === null || !nations) {
    return { ok: false, message: 'The run record is incomplete.' };
  }
  if (wave > 1 && durationSeconds < wavesCompleted * MIN_SECONDS_PER_WAVE) {
    return { ok: false, message: 'That run is shorter than its own waves allow.' };
  }
  if (zombiesKilled > MAX_KILLS_PER_WAVE * (wavesCompleted + 2)) {
    return { ok: false, message: 'That kill count is larger than the horde can field.' };
  }
  return {
    ok: true,
    value: {
      mode: body.mode,
      map,
      difficulty: body.difficulty,
      wave,
      wavesCompleted,
      zombiesKilled,
      durationSeconds,
      structuresLost,
      unitsLost,
      nations,
    },
  };
}

/** Ranking shared by the store's ordering and the deck's table. */
export function compareOutbreakRuns(
  a: Pick<
    OutbreakRunRecord,
    'wave' | 'wavesCompleted' | 'zombiesKilled' | 'durationSeconds' | 'recordedAt'
  >,
  b: Pick<
    OutbreakRunRecord,
    'wave' | 'wavesCompleted' | 'zombiesKilled' | 'durationSeconds' | 'recordedAt'
  >,
): number {
  if (a.wave !== b.wave) return b.wave - a.wave;
  if (a.wavesCompleted !== b.wavesCompleted) return b.wavesCompleted - a.wavesCompleted;
  if (a.zombiesKilled !== b.zombiesKilled) return b.zombiesKilled - a.zombiesKilled;
  if (a.durationSeconds !== b.durationSeconds) return b.durationSeconds - a.durationSeconds;
  // Two identical runs are not replaced; the earlier one keeps its place.
  return a.recordedAt - b.recordedAt;
}

/** Does this run beat the one already on the board? */
export function outbreakRunImproves(candidate: OutbreakRunRecord, current: OutbreakRunRecord): boolean {
  return compareOutbreakRuns(candidate, current) < 0;
}

function asEntry(value: unknown): OutbreakBoardEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const rank = integer(record.rank, 1_000_000);
  if (rank === null) return null;
  if (typeof record.callsign !== 'string') return null;
  if (!isOutbreakBoardMode(record.mode) || !isOutbreakBoardDifficulty(record.difficulty)) {
    return null;
  }
  const map = record.map === undefined ? DEFAULT_OUTBREAK_BOARD_MAP : record.map;
  if (!isOutbreakBoardMap(map)) return null;
  const numbers = {
    wave: integer(record.wave, MAX_WAVE),
    wavesCompleted: integer(record.wavesCompleted, MAX_WAVE),
    zombiesKilled: integer(record.zombiesKilled, MAX_KILLS),
    durationSeconds: integer(record.durationSeconds, MAX_RUN_SECONDS),
    players: integer(record.players, 8),
    recordedAt: integer(record.recordedAt, Number.MAX_SAFE_INTEGER),
  };
  if (Object.values(numbers).some((value) => value === null)) return null;
  return {
    rank,
    callsign: record.callsign,
    mode: record.mode,
    map,
    difficulty: record.difficulty,
    wave: numbers.wave!,
    wavesCompleted: numbers.wavesCompleted!,
    zombiesKilled: numbers.zombiesKilled!,
    durationSeconds: numbers.durationSeconds!,
    players: numbers.players!,
    nations: nationList(record.nations, 2) ?? [],
    recordedAt: numbers.recordedAt!,
    you: record.you === true,
  };
}

/**
 * Parse a board reply. Untrusted JSON: anything unrecognised is dropped rather
 * than trusted, and a reply with no usable shape is reported as malformed.
 */
export function parseOutbreakBoard(value: unknown): OutbreakBoard | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isOutbreakBoardMode(record.mode) || !isOutbreakBoardDifficulty(record.difficulty)) return null;
  const map = record.map === undefined ? DEFAULT_OUTBREAK_BOARD_MAP : record.map;
  if (!isOutbreakBoardMap(map)) return null;
  const entries = Array.isArray(record.entries)
    ? record.entries.map(asEntry).filter((entry): entry is OutbreakBoardEntry => entry !== null)
    : [];
  return {
    mode: record.mode,
    map,
    difficulty: record.difficulty,
    entries,
    own: asEntry(record.own),
    signedIn: record.signedIn === true,
  };
}
